import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { IndexService } from '../index/index.service';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import {
  IndexDocumentDto,
  DocumentResponseDto,
  BulkResponseDto,
  DeleteByQueryResponseDto,
} from '../api/dtos/document.dto';
import { v4 as uuidv4 } from 'uuid';
import { SearchService } from '../search/search.service';
import { IndexingService } from '../indexing/indexing.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { SearchQueryDto } from 'src/api/dtos/search.dto';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly documentStorage: DocumentStorageService,
    private readonly indexService: IndexService,
    private readonly indexingService: IndexingService,
    private readonly searchService: SearchService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
  ) {}

  async indexDocument(
    indexName: string,
    documentDto: IndexDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.logger.log(`Indexing document in ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Generate ID if not provided
    const documentId = documentDto.id || uuidv4();

    // Store document in storage
    const storedDocument = await this.documentStorage.storeDocument(indexName, {
      documentId,
      content: documentDto.document,
      metadata: {},
    });

    // Index the document for search
    await this.indexingService.indexDocument(indexName, documentId, documentDto.document);

    // After storing the document in DB:
    for (const [field, value] of Object.entries(documentDto.document)) {
      if (typeof value === 'string') {
        const tokens = value.toLowerCase().split(/\W+/).filter(Boolean);
        const tokenPositions: Record<string, number[]> = {};
        tokens.forEach((token, idx) => {
          if (!tokenPositions[token]) tokenPositions[token] = [];
          tokenPositions[token].push(idx);
        });

        for (const [token, positions] of Object.entries(tokenPositions)) {
          const frequency = positions.length;

          // Add to field-specific posting list
          this.termDictionary.addPosting(`${field}:${token}`, {
            docId: documentId,
            frequency,
            positions,
            metadata: { field },
          });

          // Add to _all field posting list
          this.termDictionary.addPosting(`_all:${token}`, {
            docId: documentId,
            frequency,
            positions,
            metadata: { field },
          });
        }
      }
    }

    return {
      id: documentId,
      index: indexName,
      version: 1, // Simple versioning for now
      found: true,
      source: documentDto.document,
    };
  }

  async bulkIndexDocuments(
    indexName: string,
    documents: IndexDocumentDto[],
  ): Promise<BulkResponseDto> {
    this.logger.log(`Bulk indexing ${documents.length} documents in ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    const startTime = Date.now();
    const results = [];
    let hasErrors = false;

    // Process each document
    for (const doc of documents) {
      try {
        const documentId = doc.id || uuidv4();

        // Store document
        await this.documentStorage.storeDocument(indexName, {
          documentId,
          content: doc.document,
          metadata: {},
        });

        // Index document
        await this.indexingService.indexDocument(indexName, documentId, doc.document);

        // After storing the document in DB:
        for (const [field, value] of Object.entries(doc.document)) {
          if (typeof value === 'string') {
            const tokens = value.toLowerCase().split(/\W+/).filter(Boolean);
            const tokenPositions: Record<string, number[]> = {};
            tokens.forEach((token, idx) => {
              if (!tokenPositions[token]) tokenPositions[token] = [];
              tokenPositions[token].push(idx);
            });

            for (const [token, positions] of Object.entries(tokenPositions)) {
              const frequency = positions.length;

              // Add to field-specific posting list
              this.termDictionary.addPosting(`${field}:${token}`, {
                docId: documentId,
                frequency,
                positions,
                metadata: { field },
              });

              // Add to _all field posting list
              this.termDictionary.addPosting(`_all:${token}`, {
                docId: documentId,
                frequency,
                positions,
                metadata: { field },
              });
            }
          }
        }

        results.push({
          documentId,
          index: indexName,
          success: true,
          status: 201,
        });
      } catch (error) {
        hasErrors = true;
        results.push({
          documentId: doc.id || 'unknown',
          index: indexName,
          success: false,
          status: 400,
          error: error.message,
        });
      }
    }

    return {
      items: results,
      took: Date.now() - startTime,
      errors: hasErrors,
    };
  }

  async getDocument(indexName: string, id: string): Promise<DocumentResponseDto> {
    this.logger.log(`Getting document ${id} from ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Retrieve document
    const document = await this.documentStorage.getDocument(indexName, id);

    if (!document) {
      throw new NotFoundException(`Document with id ${id} not found in index ${indexName}`);
    }

    return {
      id: id,
      index: indexName,
      version: 1,
      found: true,
      source: document.content,
    };
  }

  async updateDocument(
    indexName: string,
    id: string,
    document: Record<string, any>,
  ): Promise<DocumentResponseDto> {
    this.logger.log(`Updating document ${id} in ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Check if document exists
    const existingDoc = await this.documentStorage.getDocument(indexName, id);
    if (!existingDoc) {
      throw new NotFoundException(`Document with id ${id} not found in index ${indexName}`);
    }

    // Update document
    const updatedDoc = await this.documentStorage.updateDocument(indexName, id, document, {
      metadata: existingDoc.metadata,
    });

    // Reindex document
    await this.indexingService.indexDocument(indexName, id, document);

    // After storing the document in DB:
    for (const [field, value] of Object.entries(document)) {
      if (typeof value === 'string') {
        const tokens = value.toLowerCase().split(/\W+/).filter(Boolean);
        const tokenPositions: Record<string, number[]> = {};
        tokens.forEach((token, idx) => {
          if (!tokenPositions[token]) tokenPositions[token] = [];
          tokenPositions[token].push(idx);
        });

        for (const [token, positions] of Object.entries(tokenPositions)) {
          const frequency = positions.length;

          // Add to field-specific posting list
          this.termDictionary.addPosting(`${field}:${token}`, {
            docId: id,
            frequency,
            positions,
            metadata: { field },
          });

          // Add to _all field posting list
          this.termDictionary.addPosting(`_all:${token}`, {
            docId: id,
            frequency,
            positions,
            metadata: { field },
          });
        }
      }
    }

    return {
      id,
      index: indexName,
      version: 2, // Increment version on update
      found: true,
      source: document,
    };
  }

  async deleteDocument(indexName: string, id: string): Promise<void> {
    this.logger.log(`Deleting document ${id} from ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Delete from storage
    const deleted = await this.documentStorage.deleteDocument(indexName, id);

    if (!deleted) {
      throw new NotFoundException(`Document with id ${id} not found in index ${indexName}`);
    }

    // Remove from index
    await this.indexingService.removeDocument(indexName, id);
  }

  async deleteByQuery(indexName: string, query: SearchQueryDto): Promise<DeleteByQueryResponseDto> {
    this.logger.log(`Deleting documents by query in ${indexName}: ${query.query}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    const startTime = Date.now();

    try {
      // Search for documents matching the query
      const searchResults = await this.searchService.search(indexName, query);
      const documentIds = searchResults.data.hits.map(hit => hit.id);

      if (documentIds.length === 0) {
        return {
          deleted: 0,
          took: Date.now() - startTime,
          failures: [],
        };
      }

      // Delete documents from storage
      const deleted = await this.documentStorage.bulkDeleteDocuments(indexName, documentIds);

      // Remove documents from index
      for (const id of documentIds) {
        await this.indexingService.removeDocument(indexName, id);
      }

      return {
        deleted,
        took: Date.now() - startTime,
        failures: [],
      };
    } catch (error) {
      this.logger.error(`Error deleting by query: ${error.message}`);
      throw new BadRequestException(`Invalid query: ${error.message}`);
    }
  }

  private async checkIndexExists(indexName: string): Promise<void> {
    try {
      await this.indexService.getIndex(indexName);
    } catch (error) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }
  }
}
