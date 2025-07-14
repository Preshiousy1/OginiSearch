import { Index, IndexMappings, IndexSettings } from './index.interface';
import { ProcessedDocument } from '../../document/interfaces/document-processor.interface';

export interface IndexStorage {
  getIndex(name: string): Promise<Index | null>;
  createIndex(
    index: Partial<Index> & { name: string; settings: IndexSettings; mappings: IndexMappings },
  ): Promise<Index>;
  updateIndex(name: string, updates: Partial<Index>, fromBulk?: boolean): Promise<Index>;
  listIndices(status?: string): Promise<Index[]>;
  deleteIndex(name: string): Promise<void>;
  clearIndex(name: string): Promise<void>;
  storeProcessedDocument(indexName: string, document: ProcessedDocument): Promise<void>;
  getProcessedDocument(indexName: string, documentId: string): Promise<ProcessedDocument | null>;
  deleteProcessedDocument(indexName: string, documentId: string): Promise<void>;
  getAllDocuments(indexName: string): Promise<Array<{ id: string; source: any }>>;
  getDocumentCount(indexName: string): Promise<number>;
  getFields(indexName: string): Promise<string[]>;
  getFieldStats(field: string): Promise<{ totalLength: number; docCount: number } | null>;
  updateFieldStats(field: string, stats: { totalLength: number; docCount: number }): Promise<void>;
  storeIndexStats(indexName: string, stats: Record<string, any>): Promise<void>;
  getIndexStats(indexName: string): Promise<Record<string, any> | null>;
  addTermToIndex(
    indexName: string,
    term: string,
    documentId: string,
    positions: number[],
  ): Promise<void>;
  removeTermFromIndex(indexName: string, term: string, documentId: string): Promise<void>;
}
