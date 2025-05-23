import { ProcessedDocument } from '../../document/interfaces/document-processor.interface';
import { Logger } from '@nestjs/common';

/**
 * Memory-safe serialization utilities that prevent memory spikes
 * during JSON operations by chunking large objects and limiting size
 */
export class SerializationUtils {
  private static readonly logger = new Logger(SerializationUtils.name);
  private static readonly MAX_OBJECT_SIZE = 10 * 1024 * 1024; // 10MB limit
  private static readonly CHUNK_SIZE = 1000; // Process in chunks of 1000 items
  private static readonly MAX_ARRAY_LENGTH = 10000; // Limit array sizes

  /**
   * Safely serialize posting list with size limits
   */
  static serializePostingList(postings: Map<string, number[]>): Buffer {
    try {
      // Limit the number of postings to prevent memory issues
      const limitedPostings = new Map();
      let count = 0;

      for (const [docId, positions] of postings) {
        if (count >= this.MAX_ARRAY_LENGTH) {
          this.logger.warn(`Posting list truncated at ${this.MAX_ARRAY_LENGTH} entries`);
          break;
        }

        // Limit position arrays
        const limitedPositions = positions.slice(0, 100);
        limitedPostings.set(docId, limitedPositions);
        count++;
      }

      const serializable = {
        __type: 'Map',
        __version: 2,
        __size: limitedPostings.size,
        value: Array.from(limitedPostings.entries()),
      };

      const jsonString = JSON.stringify(serializable);

      // Check size before creating buffer
      if (jsonString.length > this.MAX_OBJECT_SIZE) {
        throw new Error(`Serialized posting list too large: ${jsonString.length} bytes`);
      }

      return Buffer.from(jsonString);
    } catch (error) {
      this.logger.error(`Failed to serialize posting list: ${error.message}`);
      // Return minimal fallback
      return Buffer.from(JSON.stringify({ __type: 'Map', value: [], __error: true }));
    }
  }

  /**
   * Safely deserialize posting list with error handling
   */
  static deserializePostingList(data: Buffer | object): Map<string, number[]> {
    try {
      let parsed;
      if (Buffer.isBuffer(data)) {
        const str = data.toString();
        if (str.length > this.MAX_OBJECT_SIZE) {
          throw new Error(`Data too large to parse: ${str.length} bytes`);
        }
        parsed = JSON.parse(str);
      } else if (typeof data === 'object') {
        parsed = data;
      } else {
        throw new Error('Invalid data type for posting list deserialization');
      }

      // Handle Map format
      if (parsed && parsed.__type === 'Map' && Array.isArray(parsed.value)) {
        const result = new Map();
        const entries = parsed.value.slice(0, this.MAX_ARRAY_LENGTH);

        for (const [docId, positions] of entries) {
          if (Array.isArray(positions)) {
            result.set(docId, positions.slice(0, 100)); // Limit positions
          } else {
            result.set(docId, []);
          }
        }
        return result;
      }

      // Handle legacy formats with limits
      if (Array.isArray(parsed)) {
        const result = new Map();
        const limitedArray = parsed.slice(0, this.MAX_ARRAY_LENGTH);

        for (const entry of limitedArray) {
          if (entry && entry.docId) {
            const positions = Array.isArray(entry.positions) ? entry.positions.slice(0, 100) : [];
            result.set(entry.docId, positions);
          }
        }
        return result;
      }

      // Handle direct object representation
      if (typeof parsed === 'object' && parsed !== null) {
        const result = new Map();
        const entries = Object.entries(parsed).slice(0, this.MAX_ARRAY_LENGTH);

        for (const [docId, positions] of entries) {
          if (Array.isArray(positions)) {
            result.set(docId, positions.slice(0, 100));
          } else {
            result.set(docId, []);
          }
        }
        return result;
      }

      return new Map();
    } catch (error) {
      this.logger.error(`Failed to deserialize posting list: ${error.message}`);
      return new Map();
    }
  }

  /**
   * Safely serialize document with chunked processing
   */
  static serializeDocument(document: ProcessedDocument): Buffer {
    try {
      // Create a memory-safe copy of the document
      const safeDocument = this.createSafeDocumentCopy(document);

      const jsonString = JSON.stringify(safeDocument, this.createSafeReplacer());

      // Check size
      if (jsonString.length > this.MAX_OBJECT_SIZE) {
        this.logger.warn(
          `Document too large, creating minimal version: ${jsonString.length} bytes`,
        );
        return this.createMinimalDocumentBuffer(document);
      }

      return Buffer.from(jsonString);
    } catch (error) {
      this.logger.error(`Failed to serialize document: ${error.message}`);
      return this.createMinimalDocumentBuffer(document);
    }
  }

  /**
   * Create a memory-safe copy of document with size limits
   */
  private static createSafeDocumentCopy(document: ProcessedDocument): any {
    const safeDoc: any = {
      id: document.id,
      source: this.limitObjectSize(document.source),
      fields: {},
      fieldLengths: {},
    };

    // Process fields with limits
    const fieldEntries = Object.entries(document.fields || {}).slice(0, 50); // Limit fields

    for (const [fieldName, fieldData] of fieldEntries) {
      if (fieldData && typeof fieldData === 'object') {
        safeDoc.fields[fieldName] = {
          original: this.limitStringSize(fieldData.original),
          terms: Array.isArray(fieldData.terms) ? fieldData.terms.slice(0, 1000) : [],
          termFrequencies: this.limitObjectSize(fieldData.termFrequencies),
          length: fieldData.length || 0,
        };
      }
    }

    // Process field lengths with limits
    const lengthEntries = Object.entries(document.fieldLengths || {}).slice(0, 50);
    for (const [fieldName, length] of lengthEntries) {
      safeDoc.fieldLengths[fieldName] = typeof length === 'number' ? length : 0;
    }

    return safeDoc;
  }

  /**
   * Create a safe JSON replacer that handles special types
   */
  private static createSafeReplacer() {
    const seen = new WeakSet();

    return (key: string, value: any) => {
      // Prevent circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }

      // Handle special types
      if (value instanceof Map) {
        const entries = Array.from(value.entries()).slice(0, this.MAX_ARRAY_LENGTH);
        return { __type: 'Map', value: entries };
      }

      if (value instanceof Set) {
        const values = Array.from(value).slice(0, this.MAX_ARRAY_LENGTH);
        return { __type: 'Set', value: values };
      }

      if (value instanceof Date) {
        return { __type: 'Date', value: value.toISOString() };
      }

      // Limit array sizes
      if (Array.isArray(value) && value.length > this.MAX_ARRAY_LENGTH) {
        return value.slice(0, this.MAX_ARRAY_LENGTH);
      }

      // Limit string sizes
      if (typeof value === 'string' && value.length > 10000) {
        return value.substring(0, 10000) + '...[truncated]';
      }

      return value;
    };
  }

  /**
   * Create minimal document buffer as fallback
   */
  private static createMinimalDocumentBuffer(document: ProcessedDocument): Buffer {
    const minimal = {
      id: document.id,
      source: { title: 'Document too large to serialize' },
      fields: {},
      fieldLengths: {},
      __minimal: true,
    };
    return Buffer.from(JSON.stringify(minimal));
  }

  /**
   * Limit object size by truncating properties
   */
  private static limitObjectSize(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;

    const limited: any = {};
    const entries = Object.entries(obj).slice(0, 100); // Limit properties

    for (const [key, value] of entries) {
      if (typeof value === 'string') {
        limited[key] = this.limitStringSize(value);
      } else if (Array.isArray(value)) {
        limited[key] = value.slice(0, 100);
      } else if (typeof value === 'object' && value !== null) {
        limited[key] = this.limitObjectSize(value);
      } else {
        limited[key] = value;
      }
    }

    return limited;
  }

  /**
   * Limit string size
   */
  private static limitStringSize(str: any): string {
    if (typeof str !== 'string') return String(str).substring(0, 1000);
    return str.length > 1000 ? str.substring(0, 1000) + '...[truncated]' : str;
  }

  /**
   * Safely deserialize document with error handling
   */
  static deserializeDocument(data: Buffer | object): ProcessedDocument {
    try {
      let parsed;
      if (Buffer.isBuffer(data)) {
        const str = data.toString();
        if (str.length > this.MAX_OBJECT_SIZE) {
          throw new Error(`Document data too large: ${str.length} bytes`);
        }
        parsed = JSON.parse(str);
      } else {
        parsed = data;
      }

      // Revive special types safely
      const revived = this.reviveValueSafe(parsed);

      // Ensure required properties exist
      return {
        id: revived.id || 'unknown',
        source: revived.source || {},
        fields: revived.fields || {},
        fieldLengths: revived.fieldLengths || {},
      };
    } catch (error) {
      this.logger.error(`Failed to deserialize document: ${error.message}`);
      return {
        id: 'error',
        source: { error: 'Failed to deserialize' },
        fields: {},
        fieldLengths: {},
      };
    }
  }

  /**
   * Safely revive special types
   */
  private static reviveValueSafe(obj: any): any {
    if (obj && typeof obj === 'object') {
      if (obj.__type === 'Map' && Array.isArray(obj.value)) {
        const map = new Map();
        const entries = obj.value.slice(0, this.MAX_ARRAY_LENGTH);
        for (const [key, value] of entries) {
          map.set(key, this.reviveValueSafe(value));
        }
        return map;
      }

      if (obj.__type === 'Set' && Array.isArray(obj.value)) {
        const values = obj.value.slice(0, this.MAX_ARRAY_LENGTH);
        return new Set(values.map(v => this.reviveValueSafe(v)));
      }

      if (obj.__type === 'Date' && obj.value) {
        return new Date(obj.value);
      }

      // Process regular objects
      const result: any = {};
      const entries = Object.entries(obj).slice(0, 100);
      for (const [key, value] of entries) {
        result[key] = this.reviveValueSafe(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Safely serialize index stats with chunking
   */
  static serializeIndexStats(stats: Record<string, any>): Buffer {
    try {
      const safeStats = this.limitObjectSize(stats);
      const jsonString = JSON.stringify(safeStats, this.createSafeReplacer());

      if (jsonString.length > this.MAX_OBJECT_SIZE) {
        this.logger.warn(
          `Index stats too large, creating minimal version: ${jsonString.length} bytes`,
        );
        return Buffer.from(
          JSON.stringify({
            __minimal: true,
            timestamp: new Date().toISOString(),
            error: 'Stats too large to serialize',
          }),
        );
      }

      return Buffer.from(jsonString);
    } catch (error) {
      this.logger.error(`Failed to serialize index stats: ${error.message}`);
      return Buffer.from(
        JSON.stringify({
          __error: true,
          message: error.message,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  /**
   * Safely deserialize index stats
   */
  static deserializeIndexStats(data: Buffer | object): Record<string, any> {
    try {
      let parsed;
      if (Buffer.isBuffer(data)) {
        const str = data.toString();
        if (str.length > this.MAX_OBJECT_SIZE) {
          throw new Error(`Stats data too large: ${str.length} bytes`);
        }
        parsed = JSON.parse(str);
      } else {
        parsed = data;
      }

      return this.reviveValueSafe(parsed) || {};
    } catch (error) {
      this.logger.error(`Failed to deserialize index stats: ${error.message}`);
      return {
        __error: true,
        message: error.message,
        timestamp: new Date().toISOString(),
      };
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

  /**
   * Check if an object is safe to serialize
   */
  static isSafeToSerialize(obj: any): boolean {
    try {
      const jsonString = JSON.stringify(obj);
      return jsonString.length <= this.MAX_OBJECT_SIZE;
    } catch {
      return false;
    }
  }

  /**
   * Get estimated object size in bytes
   */
  static getEstimatedSize(obj: any): number {
    try {
      return JSON.stringify(obj).length;
    } catch {
      return 0;
    }
  }

  /**
   * Create chunked serialization for very large objects
   */
  static serializeInChunks<T>(items: T[], chunkSize: number = this.CHUNK_SIZE): Buffer[] {
    const chunks: Buffer[] = [];

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      try {
        const chunkData = {
          __chunk: true,
          __index: Math.floor(i / chunkSize),
          __total: Math.ceil(items.length / chunkSize),
          data: chunk,
        };
        chunks.push(Buffer.from(JSON.stringify(chunkData)));
      } catch (error) {
        this.logger.error(
          `Failed to serialize chunk ${Math.floor(i / chunkSize)}: ${error.message}`,
        );
      }
    }

    return chunks;
  }

  /**
   * Deserialize chunked data
   */
  static deserializeChunks(chunks: Buffer[]): any[] {
    const result: any[] = [];

    for (const chunk of chunks) {
      try {
        const parsed = JSON.parse(chunk.toString());
        if (parsed.__chunk && Array.isArray(parsed.data)) {
          result.push(...parsed.data);
        }
      } catch (error) {
        this.logger.error(`Failed to deserialize chunk: ${error.message}`);
      }
    }

    return result;
  }
}
