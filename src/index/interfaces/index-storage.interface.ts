export interface IndexStorage {
  getDocumentCount(indexName: string): Promise<number>;
  getFields(indexName: string): Promise<string[]>;
  getFieldStats(field: string): Promise<{ totalLength: number; docCount: number } | null>;
  updateFieldStats(field: string, stats: { totalLength: number; docCount: number }): Promise<void>;
}
