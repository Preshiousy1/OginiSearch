import { ProcessedDocument } from '../../document/interfaces/document-processor.interface';

/**
 * Utility class for serializing and deserializing data for RocksDB storage
 */
export class SerializationUtils {
  /**
   * Serializes a posting list (document IDs and their positions)
   */
  static serializePostingList(postings: Map<string, number[]>): Buffer {
    const serializable = Array.from(postings.entries()).map(([docId, positions]) => ({
      docId,
      positions,
    }));
    return Buffer.from(JSON.stringify(serializable));
  }

  /**
   * Deserializes a posting list from buffer
   */
  static deserializePostingList(buffer: Buffer): Map<string, number[]> {
    const parsed = JSON.parse(buffer.toString());
    return new Map(parsed.map(entry => [entry.docId, entry.positions]));
  }

  /**
   * Serializes a processed document
   */
  static serializeDocument(document: ProcessedDocument): Buffer {
    return Buffer.from(JSON.stringify(document));
  }

  /**
   * Deserializes a document from buffer
   */
  static deserializeDocument(buffer: Buffer): ProcessedDocument {
    return JSON.parse(buffer.toString());
  }

  /**
   * Serializes index statistics
   */
  static serializeIndexStats(stats: Record<string, any>): Buffer {
    return Buffer.from(JSON.stringify(stats));
  }

  /**
   * Deserializes index statistics from buffer
   */
  static deserializeIndexStats(buffer: Buffer): Record<string, any> {
    return JSON.parse(buffer.toString());
  }

  /**
   * Creates a formatted key for terms in an index
   */
  static createTermKey(indexName: string, term: string): string {
    // Ensure term is encoded properly for use in keys
    const encodedTerm = encodeURIComponent(term);
    return `term:${indexName}:${encodedTerm}`;
  }

  /**
   * Creates a formatted key for documents in an index
   */
  static createDocumentKey(indexName: string, documentId: string): string {
    return `doc:${indexName}:${documentId}`;
  }

  /**
   * Creates a formatted key for index metadata
   */
  static createIndexMetadataKey(indexName: string): string {
    return `index:${indexName}`;
  }

  /**
   * Creates a formatted key for index statistics
   */
  static createStatsKey(indexName: string, statName: string): string {
    return `stats:${indexName}:${statName}`;
  }
}
