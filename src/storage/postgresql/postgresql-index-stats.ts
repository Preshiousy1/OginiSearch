import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IndexStats } from '../../index/interfaces/scoring.interface';

@Injectable()
export class PostgreSQLIndexStats implements IndexStats {
  private readonly logger = new Logger(PostgreSQLIndexStats.name);
  private readonly statementCache = new Map<string, string>();
  private currentIndex = '';

  // Cache for stats
  private documentFrequencyCache = new Map<string, number>();
  private fieldLengthCache = new Map<string, number>();
  private totalDocsCache = 0;
  private fieldLengthsCache = new Map<string, Map<string, number>>();

  constructor(private readonly dataSource: DataSource) {}

  get totalDocuments(): number {
    return this.totalDocsCache;
  }

  setIndex(indexName: string): void {
    this.currentIndex = indexName;
    this.refreshCache(); // Refresh cache when index changes
  }

  getDocumentFrequency(term: string): number {
    return this.documentFrequencyCache.get(term) || 0;
  }

  getAverageFieldLength(field: string): number {
    return this.fieldLengthCache.get(field) || 0;
  }

  getFieldLength(docId: string | number, field: string): number {
    const docKey = String(docId);
    return this.fieldLengthsCache.get(docKey)?.get(field) || 0;
  }

  updateDocumentStats(
    docId: string | number,
    fieldLengths: Record<string, number>,
    isRemoval = false,
  ): void {
    // Update cache immediately, database update will happen asynchronously
    const docKey = String(docId);
    if (isRemoval) {
      this.fieldLengthsCache.delete(docKey);
      this.totalDocsCache--;
    } else {
      const fieldMap = new Map(Object.entries(fieldLengths));
      this.fieldLengthsCache.set(docKey, fieldMap);
      this.totalDocsCache++;
    }
    this.updateDocumentStatsAsync(docId, fieldLengths, isRemoval);
  }

  updateTermStats(term: string, docId: string | number, isRemoval = false): void {
    const currentFreq = this.documentFrequencyCache.get(term) || 0;
    this.documentFrequencyCache.set(term, currentFreq + (isRemoval ? -1 : 1));
    this.updateTermStatsAsync(term, docId, isRemoval);
  }

  private async updateDocumentStatsAsync(
    docId: string | number,
    fieldLengths: Record<string, number>,
    isRemoval: boolean,
  ): Promise<void> {
    try {
      // Implement database update logic here
      this.logger.debug(`Updating document stats for ${docId}`);
    } catch (error) {
      this.logger.error(`Failed to update document stats: ${error.message}`);
    }
  }

  private async updateTermStatsAsync(
    term: string,
    docId: string | number,
    isRemoval: boolean,
  ): Promise<void> {
    try {
      // Implement database update logic here
      this.logger.debug(`Updating term stats for ${term}`);
    } catch (error) {
      this.logger.error(`Failed to update term stats: ${error.message}`);
    }
  }

  private async refreshCache(): Promise<void> {
    try {
      // Refresh total documents
      const totalQuery = this.getCachedStatement(
        'total_documents',
        'SELECT COUNT(*) as total FROM search_documents WHERE index_name = $1',
      );
      const totalResult = await this.dataSource.query(totalQuery, [this.currentIndex]);
      this.totalDocsCache = parseInt(totalResult[0]?.total || '0', 10);

      // Refresh field lengths (implement as needed)
      // ... add field length caching logic here

      this.logger.debug(`Cache refreshed for index ${this.currentIndex}`);
    } catch (error) {
      this.logger.error(`Failed to refresh cache: ${error.message}`);
    }
  }

  private getCachedStatement(key: string, sql: string): string {
    if (!this.statementCache.has(key)) {
      this.statementCache.set(key, sql);
    }
    return this.statementCache.get(key)!;
  }
}
