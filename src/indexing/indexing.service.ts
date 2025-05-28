import { Injectable, Logger, Inject } from '@nestjs/common';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { DocumentProcessorService } from '../document/document-processor.service';
import { IndexStatsService } from '../index/index-stats.service';
import { ProcessedDocument } from '../document/interfaces/document-processor.interface';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { PersistentTermDictionaryService } from '../storage/index-storage/persistent-term-dictionary.service';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly indexStorage: IndexStorageService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly indexStats: IndexStatsService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
    private readonly persistentTermDictionary: PersistentTermDictionaryService,
  ) {}

  async indexDocument(indexName: string, documentId: string, document: any): Promise<void> {
    this.logger.debug(`Processing and indexing document ${documentId} in index ${indexName}`);

    // 1. Process the document (tokenization, normalization)
    const processedDoc = this.documentProcessor.processDocument({
      id: documentId,
      source: document,
    });

    // 2. Store the processed document
    await this.indexStorage.storeProcessedDocument(indexName, processedDoc);

    // 3. Update inverted index for each field and term
    for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
      for (const term of fieldData.terms) {
        const fieldTerm = `${field}:${term}`;
        const positions = fieldData.positions?.[term] || [];
        const frequency = fieldData.termFrequencies[term] || 1;

        // Add to in-memory term dictionary
        const postingList = await this.termDictionary.addTerm(fieldTerm);
        postingList.addEntry({
          docId: documentId,
          frequency,
          positions,
          metadata: { field },
        });

        // Save to both RocksDB and MongoDB via PersistentTermDictionaryService
        await this.persistentTermDictionary.saveTermPostings(indexName, fieldTerm, postingList);

        // Also add to _all field for cross-field search
        const allFieldTerm = `_all:${term}`;
        const allPostingList = await this.termDictionary.addTerm(allFieldTerm);
        allPostingList.addEntry({
          docId: documentId,
          frequency,
          positions,
          metadata: { field },
        });

        // Save _all field term postings to both RocksDB and MongoDB
        await this.persistentTermDictionary.saveTermPostings(
          indexName,
          allFieldTerm,
          allPostingList,
        );
      }
    }

    // 4. Update index statistics
    await this.updateIndexStats(indexName, processedDoc);

    // 5. Update index metadata document count
    const index = await this.indexStorage.getIndex(indexName);
    if (index) {
      index.documentCount = (index.documentCount || 0) + 1;
      await this.indexStorage.updateIndex(indexName, index);
    }
  }

  async removeDocument(indexName: string, documentId: string): Promise<void> {
    this.logger.debug(`Removing document ${documentId} from index ${indexName}`);

    // 1. Get the processed document to find its terms
    const processedDoc = await this.indexStorage.getProcessedDocument(indexName, documentId);

    if (!processedDoc) {
      this.logger.warn(
        `Document ${documentId} not found in processed document store for index ${indexName}`,
      );
      return;
    }

    // 2. Remove document from all term posting lists
    if (processedDoc.fields) {
      for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
        if (!fieldData || !fieldData.terms) continue;

        for (const term of fieldData.terms) {
          // Remove from field-specific posting list
          const fieldTerm = `${field}:${term}`;
          try {
            const postingList = await this.termDictionary.getPostingList(fieldTerm);
            if (postingList) {
              const removed = postingList.removeEntry(documentId);
              if (removed) {
                if (postingList.size() === 0) {
                  // Remove term completely from both RocksDB and MongoDB
                  await this.persistentTermDictionary.deleteTermPostings(indexName, fieldTerm);
                  await this.termDictionary.removeTerm(fieldTerm);
                } else {
                  // Update the posting list in both RocksDB and MongoDB
                  await this.persistentTermDictionary.saveTermPostings(
                    indexName,
                    fieldTerm,
                    postingList,
                  );
                }
              }
            }

            // Also remove from _all field posting list
            const allFieldTerm = `_all:${term}`;
            const allPostingList = await this.termDictionary.getPostingList(allFieldTerm);
            if (allPostingList) {
              const removed = allPostingList.removeEntry(documentId);
              if (removed) {
                if (allPostingList.size() === 0) {
                  // Remove term completely from both RocksDB and MongoDB
                  await this.persistentTermDictionary.deleteTermPostings(indexName, allFieldTerm);
                  await this.termDictionary.removeTerm(allFieldTerm);
                } else {
                  // Update the posting list in both RocksDB and MongoDB
                  await this.persistentTermDictionary.saveTermPostings(
                    indexName,
                    allFieldTerm,
                    allPostingList,
                  );
                }
              }
            }
          } catch (error) {
            this.logger.warn(
              `Error removing term ${fieldTerm} for document ${documentId}: ${error.message}`,
            );
            // Continue with next term
          }
        }
      }
    }

    try {
      // 3. Remove the processed document
      await this.indexStorage.deleteProcessedDocument(indexName, documentId);
    } catch (error) {
      this.logger.warn(`Error removing processed document ${documentId}: ${error.message}`);
    }

    try {
      // 4. Update index statistics (remove document stats)
      await this.indexStats.updateDocumentStats(documentId, {}, true);
    } catch (error) {
      this.logger.warn(`Error updating stats for document ${documentId}: ${error.message}`);
    }

    try {
      // 5. Update index metadata document count
      const index = await this.indexStorage.getIndex(indexName);
      if (index) {
        index.documentCount = Math.max(0, (index.documentCount || 0) - 1);
        await this.indexStorage.updateIndex(indexName, index);
      }
    } catch (error) {
      this.logger.warn(`Error updating index metadata for ${indexName}: ${error.message}`);
    }
  }

  async updateAll(indexName: string): Promise<void> {
    this.logger.log(`Rebuilding entire index for ${indexName}`);

    // 1. Get all documents from storage
    const documents = await this.indexStorage.getAllDocuments(indexName);

    // 2. Clear existing index data
    await this.indexStorage.clearIndex(indexName);

    // 3. Reindex all documents
    for (const doc of documents) {
      await this.indexDocument(indexName, doc.id, doc.source);
    }

    this.logger.log(`Completed rebuilding index ${indexName}`);
  }

  private async updateIndexStats(
    indexName: string,
    processedDoc: ProcessedDocument,
  ): Promise<void> {
    // 1. Update document count
    await this.indexStats.updateDocumentStats(processedDoc.id, processedDoc.fieldLengths);

    // 3. Update term statistics for each field and term
    for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
      for (const [term, frequency] of Object.entries(fieldData.termFrequencies)) {
        const fieldTerm = `${field}:${term}`;
        await this.indexStats.updateTermStats(fieldTerm, processedDoc.id);
      }
    }
  }
}
