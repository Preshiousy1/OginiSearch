import { Injectable, Logger, Inject } from '@nestjs/common';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { TermDictionary } from '../index/term-dictionary';
import { IndexService } from '../index/index.service';

@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    private readonly documentStorageService: DocumentStorageService,
    private readonly indexService: IndexService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: TermDictionary,
  ) {}

  async storeDocument(indexName: string, documentId: string, document: any): Promise<void> {
    await this.documentStorageService.storeDocument(indexName, {
      documentId,
      content: document,
      metadata: document.metadata || {},
    });
  }

  async updateTermDictionary(
    indexName: string,
    terms: Map<string, { docId: string; positions: number[] }>,
  ): Promise<void> {
    for (const [term, { docId, positions }] of terms.entries()) {
      await this.termDictionary.addPosting(`${indexName}:${term}`, docId, positions);
    }
  }

  async bulkStoreDocuments(
    indexName: string,
    documents: Array<{ documentId: string; content: any; metadata?: any }>,
    options: { skipDuplicates?: boolean } = {},
  ): Promise<{
    successCount: number;
    errors: Array<{ documentId: string; error: string }>;
  }> {
    return this.documentStorageService.bulkStoreDocuments(
      indexName,
      documents.map(doc => ({
        documentId: doc.documentId,
        content: doc.content,
        metadata: doc.metadata || {},
      })),
      options,
    );
  }

  async checkIndexExists(indexName: string): Promise<void> {
    const index = await this.indexService.getIndex(indexName);
    if (!index) {
      throw new Error(`Index ${indexName} does not exist`);
    }
  }
}
