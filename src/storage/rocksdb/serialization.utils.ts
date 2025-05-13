import { ProcessedDocument } from '../../document/interfaces/document-processor.interface';

/**
 * Utility class for serializing and deserializing data for RocksDB storage
 */
export class SerializationUtils {
  /**
   * Serializes a posting list (document IDs and their positions)
   */
  static serializePostingList(postings: Map<string, number[]>): Buffer {
    const serializable = {
      __type: 'Map',
      value: Array.from(postings.entries()).map(([docId, positions]) => [docId, positions]),
    };
    return Buffer.from(JSON.stringify(serializable));
  }

  /**
   * Deserializes a posting list from buffer
   */
  static deserializePostingList(data: Buffer | object): Map<string, number[]> {
    try {
      let parsed;
      if (Buffer.isBuffer(data)) {
        parsed = JSON.parse(data.toString());
      } else if (typeof data === 'object') {
        parsed = data;
      } else {
        throw new Error('Invalid data type for posting list deserialization');
      }

      // Handle Map format
      if (parsed && parsed.__type === 'Map' && Array.isArray(parsed.value)) {
        return new Map(parsed.value);
      }

      // Handle legacy array format
      if (Array.isArray(parsed)) {
        return new Map(parsed.map(entry => [entry.docId, entry.positions || []]));
      }

      // Handle direct object representation
      if (typeof parsed === 'object' && parsed !== null) {
        return new Map(Object.entries(parsed));
      }

      throw new Error('Invalid posting list data format');
    } catch (error) {
      throw new Error(`Failed to deserialize posting list: ${error.message}`);
    }
  }

  /**
   * Serializes a processed document
   */
  static serializeDocument(document: ProcessedDocument): Buffer {
    return Buffer.from(
      JSON.stringify(document, (key, value) => {
        if (value instanceof Map) {
          return { __type: 'Map', value: Array.from(value.entries()) };
        }
        if (value instanceof Set) {
          return { __type: 'Set', value: Array.from(value) };
        }
        return value;
      }),
    );
  }

  /**
   * Deserializes a document from buffer
   */
  static deserializeDocument(data: Buffer | object): ProcessedDocument {
    try {
      let parsed;
      if (Buffer.isBuffer(data)) {
        parsed = JSON.parse(data.toString());
      } else {
        parsed = data;
      }

      // Revive special types
      const reviveValue = (obj: any): any => {
        if (obj && typeof obj === 'object') {
          if (obj.__type === 'Map') {
            return new Map(obj.value);
          }
          if (obj.__type === 'Set') {
            return new Set(obj.value);
          }
          for (const key in obj) {
            obj[key] = reviveValue(obj[key]);
          }
        }
        return obj;
      };

      return reviveValue(parsed) as ProcessedDocument;
    } catch (error) {
      throw new Error(`Failed to deserialize document: ${error.message}`);
    }
  }

  /**
   * Serializes index statistics
   */
  static serializeIndexStats(stats: Record<string, any>): Buffer {
    return Buffer.from(
      JSON.stringify(stats, (key, value) => {
        if (value instanceof Map) {
          return { __type: 'Map', value: Array.from(value.entries()) };
        }
        if (value instanceof Set) {
          return { __type: 'Set', value: Array.from(value) };
        }
        if (value instanceof Date) {
          return { __type: 'Date', value: value.toISOString() };
        }
        return value;
      }),
    );
  }

  /**
   * Deserializes index statistics
   */
  static deserializeIndexStats(data: Buffer | object): Record<string, any> {
    try {
      let parsed;
      if (Buffer.isBuffer(data)) {
        parsed = JSON.parse(data.toString());
      } else {
        parsed = data;
      }

      return JSON.parse(JSON.stringify(parsed), (key, value) => {
        if (value && typeof value === 'object') {
          if (value.__type === 'Map') {
            return new Map(value.value);
          }
          if (value.__type === 'Set') {
            return new Set(value.value);
          }
          if (value.__type === 'Date') {
            return new Date(value.value);
          }
        }
        return value;
      });
    } catch (error) {
      throw new Error(`Failed to deserialize index stats: ${error.message}`);
    }
  }

  /**
   * Creates a formatted key for terms in an index
   */
  static createTermKey(indexName: string, term: string): string {
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
