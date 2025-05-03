import { Injectable, Logger } from '@nestjs/common';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { DocumentProcessorService } from '../document/document-processor.service';
import { IndexStatsService } from '../index/index-stats.service';
import { ProcessedDocument } from '../document/interfaces/document-processor.interface';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly indexStorage: IndexStorageService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly indexStats: IndexStatsService,
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

        // Get existing postings for this term
        const postings =
          (await this.indexStorage.getTermPostings(indexName, fieldTerm)) || new Map();

        // Add or update posting for this document
        const positions = fieldData.positions?.[term] || [];
        postings.set(documentId, positions);

        // Store updated postings
        await this.indexStorage.storeTermPostings(indexName, fieldTerm, postings);
      }
    }

    // 4. Update index statistics
    await this.updateIndexStats(indexName, processedDoc);
  }

  async removeDocument(indexName: string, documentId: string): Promise<void> {
    this.logger.debug(`Removing document ${documentId} from index ${indexName}`);

    // 1. Get the processed document to find its terms
    const processedDoc = await this.indexStorage.getProcessedDocument(indexName, documentId);

    if (!processedDoc) {
      this.logger.warn(`Document ${documentId} not found in index ${indexName}`);
      return;
    }

    // 2. Remove document from all term posting lists
    for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
      for (const term of fieldData.terms) {
        const fieldTerm = `${field}:${term}`;

        // Get existing postings for this term
        const postings = await this.indexStorage.getTermPostings(indexName, fieldTerm);

        if (postings && postings.has(documentId)) {
          // Remove document from posting list
          postings.delete(documentId);

          // If no more documents for this term, remove the term
          if (postings.size === 0) {
            await this.indexStorage.deleteTermPostings(indexName, fieldTerm);
          } else {
            // Otherwise update the posting list
            await this.indexStorage.storeTermPostings(indexName, fieldTerm, postings);
          }
        }
      }
    }

    // 3. Remove the processed document
    await this.indexStorage.deleteProcessedDocument(indexName, documentId);

    // 4. Update index statistics (remove document stats)
    await this.indexStats.updateDocumentStats(documentId, {}, true);
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
