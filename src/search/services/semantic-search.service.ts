import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface SemanticSearchResult {
  id: string;
  score: number;
  similarity: number;
  text: string;
  metadata?: Record<string, any>;
}

export interface SemanticSearchOptions {
  model?: string;
  dimensions?: number;
  similarityThreshold?: number;
  maxResults?: number;
  includeMetadata?: boolean;
}

@Injectable()
export class SemanticSearchService {
  private readonly logger = new Logger(SemanticSearchService.name);
  private readonly defaultModel = 'text-embedding-ada-002';
  private readonly defaultDimensions = 1536;
  private readonly defaultSimilarityThreshold = 0.7;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate embeddings for text using OpenAI API
   */
  async generateEmbedding(text: string, model?: string): Promise<EmbeddingResult> {
    try {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }

      const embeddingModel = model || this.defaultModel;

      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          model: embeddingModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const embedding = data.data[0].embedding;

      return {
        text,
        embedding,
        model: embeddingModel,
        dimensions: embedding.length,
      };
    } catch (error) {
      this.logger.error(`Failed to generate embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Store embedding in PostgreSQL with pgvector
   */
  async storeEmbedding(
    indexName: string,
    documentId: string,
    embedding: number[],
    text: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO document_embeddings (index_name, document_id, embedding, text, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (index_name, document_id) 
        DO UPDATE SET 
          embedding = EXCLUDED.embedding,
          text = EXCLUDED.text,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;

      await this.dataSource.query(query, [
        indexName,
        documentId,
        embedding,
        text,
        metadata ? JSON.stringify(metadata) : null,
      ]);

      this.logger.debug(`Stored embedding for document ${documentId} in index ${indexName}`);
    } catch (error) {
      this.logger.error(`Failed to store embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform semantic search using vector similarity
   */
  async semanticSearch(
    indexName: string,
    queryText: string,
    options: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult[]> {
    try {
      const {
        model = this.defaultModel,
        similarityThreshold = this.defaultSimilarityThreshold,
        maxResults = 10,
        includeMetadata = true,
      } = options;

      // Generate embedding for query
      const queryEmbedding = await this.generateEmbedding(queryText, model);

      // Perform vector similarity search
      const query = `
        SELECT 
          document_id as id,
          text,
          ${includeMetadata ? 'metadata,' : ''}
          1 - (embedding <=> $1) as similarity,
          (1 - (embedding <=> $1)) * 100 as score
        FROM document_embeddings 
        WHERE index_name = $2 
          AND 1 - (embedding <=> $1) >= $3
        ORDER BY embedding <=> $1
        LIMIT $4
      `;

      const results = await this.dataSource.query(query, [
        queryEmbedding.embedding,
        indexName,
        similarityThreshold,
        maxResults,
      ]);

      return results.map((row: any) => ({
        id: row.id,
        score: parseFloat(row.score),
        similarity: parseFloat(row.similarity),
        text: row.text,
        metadata: includeMetadata && row.metadata ? JSON.parse(row.metadata) : undefined,
      }));
    } catch (error) {
      this.logger.error(`Semantic search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform hybrid search combining semantic and keyword search
   */
  async hybridSearch(
    indexName: string,
    queryText: string,
    keywordResults: any[],
    options: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult[]> {
    try {
      // Get semantic search results
      const semanticResults = await this.semanticSearch(indexName, queryText, options);

      // Create a map of semantic results by document ID
      const semanticMap = new Map(semanticResults.map(result => [result.id, result]));

      // Combine results using Reciprocal Rank Fusion (RRF)
      const combinedResults = keywordResults.map((keywordResult, index) => {
        const semanticResult = semanticMap.get(keywordResult.id);

        // RRF formula: 1 / (k + rank)
        const k = 60; // RRF constant
        const keywordRank = index + 1;
        const semanticRank = semanticResult
          ? semanticResults.findIndex(r => r.id === semanticResult.id) + 1
          : keywordResults.length + 1;

        const keywordScore = 1 / (k + keywordRank);
        const semanticScore = semanticResult ? 1 / (k + semanticRank) : 0;

        // Weighted combination (can be tuned)
        const combinedScore = 0.6 * keywordScore + 0.4 * semanticScore;

        return {
          id: keywordResult.id,
          score: combinedScore,
          similarity: semanticResult?.similarity || 0,
          text: semanticResult?.text || keywordResult.source?.name || '',
          metadata: semanticResult?.metadata || keywordResult.source,
          keywordRank,
          semanticRank,
          keywordScore,
          semanticScore,
        };
      });

      // Sort by combined score
      return combinedResults.sort((a, b) => b.score - a.score).slice(0, options.maxResults || 10);
    } catch (error) {
      this.logger.error(`Hybrid search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Batch generate embeddings for multiple documents
   */
  async batchGenerateEmbeddings(
    documents: Array<{ id: string; text: string; metadata?: Record<string, any> }>,
    model?: string,
  ): Promise<EmbeddingResult[]> {
    try {
      const results: EmbeddingResult[] = [];

      // Process in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);

        const batchPromises = batch.map(doc => this.generateEmbedding(doc.text, model));

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Add small delay between batches
        if (i + batchSize < documents.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return results;
    } catch (error) {
      this.logger.error(`Batch embedding generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize pgvector extension and create embeddings table
   */
  async initializeVectorDatabase(): Promise<void> {
    try {
      // Enable pgvector extension
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');

      // Create embeddings table
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS document_embeddings (
          id SERIAL PRIMARY KEY,
          index_name VARCHAR(255) NOT NULL,
          document_id VARCHAR(255) NOT NULL,
          embedding vector(1536),
          text TEXT NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(index_name, document_id)
        )
      `);

      // Create index for vector similarity search
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_document_embeddings_similarity 
        ON document_embeddings 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      // Create index for index_name lookups
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_document_embeddings_index_name 
        ON document_embeddings (index_name)
      `);

      this.logger.log('Vector database initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize vector database: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats(indexName?: string): Promise<{
    totalEmbeddings: number;
    indexCounts: Record<string, number>;
    averageDimensions: number;
  }> {
    try {
      let query = `
        SELECT 
          COUNT(*) as total,
          index_name,
          AVG(array_length(embedding, 1)) as avg_dimensions
        FROM document_embeddings
      `;

      const params: any[] = [];
      if (indexName) {
        query += ' WHERE index_name = $1';
        params.push(indexName);
      }

      query += ' GROUP BY index_name';

      const results = await this.dataSource.query(query, params);

      const totalEmbeddings = results.reduce(
        (sum: number, row: any) => sum + parseInt(row.total),
        0,
      );
      const indexCounts = results.reduce((acc: Record<string, number>, row: any) => {
        acc[row.index_name] = parseInt(row.total);
        return acc;
      }, {});
      const averageDimensions =
        results.length > 0
          ? results.reduce((sum: number, row: any) => sum + parseFloat(row.avg_dimensions), 0) /
            results.length
          : 0;

      return {
        totalEmbeddings,
        indexCounts,
        averageDimensions,
      };
    } catch (error) {
      this.logger.error(`Failed to get embedding stats: ${error.message}`);
      throw error;
    }
  }
}
