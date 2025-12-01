#!/usr/bin/env ts-node

/**
 * PostgreSQL Query Execution Plan Analyzer
 *
 * This script analyzes query execution plans for search queries
 * to identify performance bottlenecks and optimization opportunities.
 */

import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') });

interface QueryPlan {
  query: string;
  plan: string;
  executionTime: number;
  cost: {
    startup: number;
    total: number;
  };
  operations: Array<{
    type: string;
    table?: string;
    index?: string;
    cost: string;
    rows: number;
    width: number;
  }>;
}

class QueryPlanAnalyzer {
  private dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
  }

  /**
   * Analyze a search query execution plan (buildOptimizedSingleQuery)
   */
  async analyzeSearchQuery(
    indexName: string,
    searchTerm: string,
    size = 10,
    from = 0,
  ): Promise<QueryPlan> {
    const normalizedTerm = searchTerm.trim().toLowerCase();

    // This matches the optimized query from buildOptimizedSingleQuery
    // Check if name_lower column exists first
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
        AND column_name = 'name_lower'
    `;
    const columnCheck = await this.dataSource.query(checkColumnQuery);
    const hasNameLower = columnCheck.length > 0;

    let dataQuery: string;
    let params: any[];

    if (hasNameLower) {
      // FAST PATH: Use indexed name_lower column
      dataQuery = `
        SELECT
          document_id,
          content,
          metadata,
          CASE 
            WHEN name_lower = $1 THEN 1000.0
            WHEN name_lower LIKE $1 || '%' THEN 500.0
            ELSE 100.0
          END as rank
        FROM documents
        WHERE index_name = $2
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            name_lower LIKE $1 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $1)
          )
        ORDER BY rank DESC, name_lower
        LIMIT $3 OFFSET $4
      `;
      params = [normalizedTerm, indexName, size, from];
    } else {
      // FALLBACK PATH
      dataQuery = `
        SELECT
          document_id,
          content,
          metadata,
          CASE 
            WHEN lower(COALESCE(content->>'name', content->>'business_name', '')) = $1 THEN 1000.0
            WHEN lower(COALESCE(content->>'name', content->>'business_name', '')) LIKE $1 || '%' THEN 500.0
            ELSE 100.0
          END as rank
        FROM documents
        WHERE index_name = $2
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            lower(COALESCE(content->>'name', content->>'business_name', '')) LIKE $1 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $1)
          )
        ORDER BY rank DESC, lower(COALESCE(content->>'name', content->>'business_name', ''))
        LIMIT $3 OFFSET $4
      `;
      params = [normalizedTerm, indexName, size, from];
    }

    // Get EXPLAIN ANALYZE plan
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${dataQuery}`;

    const planResult = await this.dataSource.query(explainQuery, params);

    // Handle different result formats
    let planJson: any;
    if (Array.isArray(planResult) && planResult.length > 0) {
      const firstRow = planResult[0];
      if (firstRow['QUERY PLAN']) {
        const plan = firstRow['QUERY PLAN'];
        planJson = Array.isArray(plan)
          ? plan[0]
          : typeof plan === 'string'
          ? JSON.parse(plan)
          : plan;
      } else if (firstRow['Plan']) {
        planJson = firstRow;
      } else {
        // Try to parse as JSON directly
        planJson = typeof firstRow === 'string' ? JSON.parse(firstRow) : firstRow;
      }
    } else {
      throw new Error('No plan result returned');
    }

    return this.parsePlan(planJson, dataQuery);
  }

  /**
   * Analyze the optimized query (buildOptimizedSingleQuery)
   */
  async analyzeOptimizedQuery(
    indexName: string,
    searchTerm: string,
    size = 10,
    from = 0,
  ): Promise<QueryPlan> {
    // This is the optimized query from buildOptimizedSingleQuery
    // We need to check what it actually generates
    const normalizedTerm = searchTerm.trim().toLowerCase();

    // Simplified version - actual may vary
    const optimizedQuery = `
      SELECT
        document_id,
        content,
        metadata,
        CASE 
          WHEN name_lower = $1 THEN 1000.0
          WHEN name_lower LIKE $1 || '%' THEN 500.0
          ELSE 100.0
        END as rank
      FROM documents
      WHERE index_name = $2
        AND is_active = true
        AND is_verified = true
        AND is_blocked = false
        AND (
          name_lower LIKE $1 || '%'
          OR weighted_search_vector @@ plainto_tsquery('english', $1)
        )
      ORDER BY rank DESC, name_lower
      LIMIT $3 OFFSET $4
    `;

    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${optimizedQuery}`;

    const [planResult] = await this.dataSource.query(explainQuery, [
      normalizedTerm,
      indexName,
      size,
      from,
    ]);

    const plan = planResult[0]['QUERY PLAN'];
    const planJson = Array.isArray(plan) ? plan[0] : JSON.parse(plan);

    return this.parsePlan(planJson, optimizedQuery);
  }

  /**
   * Analyze count query (buildCountQuery)
   */
  async analyzeCountQuery(indexName: string, searchTerm: string): Promise<QueryPlan> {
    const normalizedTerm = searchTerm.trim().toLowerCase();

    // Check if name_lower column exists
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
        AND column_name = 'name_lower'
    `;
    const columnCheck = await this.dataSource.query(checkColumnQuery);
    const hasNameLower = columnCheck.length > 0;

    let countQuery: string;
    let params: any[];

    if (hasNameLower) {
      countQuery = `
        SELECT COUNT(*) as total_count
        FROM documents
        WHERE index_name = $1
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            name_lower LIKE $2 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $2)
          )
      `;
      params = [indexName, normalizedTerm];
    } else {
      countQuery = `
        SELECT COUNT(*) as total_count
        FROM documents
        WHERE index_name = $1
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            lower(COALESCE(content->>'name', content->>'business_name', '')) LIKE $2 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $2)
          )
      `;
      params = [indexName, normalizedTerm];
    }

    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${countQuery}`;

    const planResult = await this.dataSource.query(explainQuery, params);

    // Handle different result formats
    let planJson: any;
    if (Array.isArray(planResult) && planResult.length > 0) {
      const firstRow = planResult[0];
      if (firstRow['QUERY PLAN']) {
        const plan = firstRow['QUERY PLAN'];
        planJson = Array.isArray(plan)
          ? plan[0]
          : typeof plan === 'string'
          ? JSON.parse(plan)
          : plan;
      } else if (firstRow['Plan']) {
        planJson = firstRow;
      } else {
        planJson = typeof firstRow === 'string' ? JSON.parse(firstRow) : firstRow;
      }
    } else {
      throw new Error('No plan result returned');
    }

    return this.parsePlan(planJson, countQuery);
  }

  /**
   * Parse query plan JSON into structured format
   */
  private parsePlan(planJson: any, query: string): QueryPlan {
    const operations: Array<{
      type: string;
      table?: string;
      index?: string;
      cost: string;
      rows: number;
      width: number;
    }> = [];

    const extractOperations = (node: any, depth = 0): void => {
      if (!node) return;

      const op = {
        type: node['Node Type'] || 'Unknown',
        table: node['Relation Name'] || undefined,
        index: node['Index Name'] || undefined,
        cost: `${node['Startup Cost']?.toFixed(2) || 0}..${node['Total Cost']?.toFixed(2) || 0}`,
        rows: node['Actual Rows'] || node['Plan Rows'] || 0,
        width: node['Actual Total Width'] || node['Plan Width'] || 0,
      };

      operations.push(op);

      if (node['Plans']) {
        node['Plans'].forEach((child: any) => extractOperations(child, depth + 1));
      }
    };

    extractOperations(planJson['Plan']);

    return {
      query,
      plan: JSON.stringify(planJson, null, 2),
      executionTime: planJson['Execution Time'] || 0,
      cost: {
        startup: planJson['Plan']?.['Startup Cost'] || 0,
        total: planJson['Plan']?.['Total Cost'] || 0,
      },
      operations,
    };
  }

  /**
   * Check existing indexes
   */
  async checkIndexes(): Promise<any[]> {
    const query = `
      SELECT 
        i.indexname, 
        i.indexdef,
        COALESCE(s.idx_scan, 0) as index_scans,
        COALESCE(s.idx_tup_read, 0) as tuples_read,
        COALESCE(s.idx_tup_fetch, 0) as tuples_fetched
      FROM pg_indexes i
      LEFT JOIN pg_stat_user_indexes s ON i.indexname = s.indexrelname::regclass::text
      WHERE i.tablename = 'documents'
      ORDER BY COALESCE(s.idx_scan, 0) DESC
    `;

    return await this.dataSource.query(query);
  }

  /**
   * Check table statistics
   */
  async checkTableStats(): Promise<any> {
    const query = `
      SELECT 
        schemaname,
        relname as tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as total_size,
        pg_size_pretty(pg_relation_size(schemaname||'.'||relname)) as table_size,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables
      WHERE relname = 'documents'
    `;

    const [result] = await this.dataSource.query(query);
    return result;
  }

  /**
   * Convert search term to tsquery format
   */
  private convertToTsQuery(searchTerm: string): string {
    // Simple conversion - match production logic
    const terms = searchTerm
      .trim()
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => term.toLowerCase());

    if (terms.length === 0) return '';

    if (terms.length === 1) {
      return `${terms[0]}:*`;
    }

    return terms.join(' | ');
  }

  /**
   * Generate analysis report
   */
  async generateReport(indexName: string, searchTerms: string[]): Promise<void> {
    console.log('\n' + '='.repeat(80));
    console.log('PostgreSQL Query Execution Plan Analysis');
    console.log('='.repeat(80) + '\n');

    // Check table statistics
    console.log('📊 Table Statistics:');
    console.log('-'.repeat(80));
    const tableStats = await this.checkTableStats();
    console.log(JSON.stringify(tableStats, null, 2));
    console.log('');

    // Check indexes
    console.log('📑 Existing Indexes:');
    console.log('-'.repeat(80));
    const indexes = await this.checkIndexes();
    indexes.forEach((idx: any) => {
      console.log(`\nIndex: ${idx.indexname}`);
      console.log(`  Definition: ${idx.indexdef}`);
      console.log(`  Scans: ${idx.index_scans || 0}`);
      console.log(`  Tuples Read: ${idx.tuples_read || 0}`);
      console.log(`  Tuples Fetched: ${idx.tuples_fetched || 0}`);
    });
    console.log('');

    // Analyze queries for each search term
    for (const searchTerm of searchTerms) {
      console.log('\n' + '='.repeat(80));
      console.log(`Query Analysis: "${searchTerm}"`);
      console.log('='.repeat(80) + '\n');

      try {
        // Analyze data query
        console.log('📈 Data Query Plan:');
        console.log('-'.repeat(80));
        const dataPlan = await this.analyzeSearchQuery(indexName, searchTerm);
        console.log(`Execution Time: ${dataPlan.executionTime}ms`);
        console.log(`Total Cost: ${dataPlan.cost.total}`);
        console.log('\nOperations:');
        dataPlan.operations.forEach((op, i) => {
          console.log(`  ${i + 1}. ${op.type}`);
          if (op.table) console.log(`     Table: ${op.table}`);
          if (op.index) console.log(`     Index: ${op.index}`);
          console.log(`     Cost: ${op.cost}`);
          console.log(`     Rows: ${op.rows}`);
          console.log(`     Width: ${op.width}`);
        });

        // Analyze count query
        console.log('\n📊 Count Query Plan:');
        console.log('-'.repeat(80));
        const countPlan = await this.analyzeCountQuery(indexName, searchTerm);
        console.log(`Execution Time: ${countPlan.executionTime}ms`);
        console.log(`Total Cost: ${countPlan.cost.total}`);
        console.log('\nOperations:');
        countPlan.operations.forEach((op, i) => {
          console.log(`  ${i + 1}. ${op.type}`);
          if (op.table) console.log(`     Table: ${op.table}`);
          if (op.index) console.log(`     Index: ${op.index}`);
          console.log(`     Cost: ${op.cost}`);
          console.log(`     Rows: ${op.rows}`);
        });

        // Recommendations
        console.log('\n💡 Recommendations:');
        console.log('-'.repeat(80));
        this.generateRecommendations(dataPlan, countPlan, indexes);
      } catch (error: any) {
        console.error(`❌ Error analyzing query for "${searchTerm}":`, error.message);
      }
    }
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(dataPlan: QueryPlan, countPlan: QueryPlan, indexes: any[]): void {
    const recommendations: string[] = [];

    // Check for sequential scans
    const hasSeqScan = dataPlan.operations.some(
      op => op.type === 'Seq Scan' || op.type === 'Parallel Seq Scan',
    );
    if (hasSeqScan) {
      recommendations.push(
        '⚠️  Sequential scan detected! Create GIN indexes on search_vector and materialized_vector columns.',
      );
    }

    // Check for missing GIN indexes
    const hasGinIndex = indexes.some(
      (idx: any) =>
        idx.indexdef?.toLowerCase().includes('gin') &&
        (idx.indexdef?.toLowerCase().includes('search_vector') ||
          idx.indexdef?.toLowerCase().includes('materialized_vector')),
    );
    if (!hasGinIndex) {
      recommendations.push(
        '⚠️  No GIN indexes found on search_vector or materialized_vector. Create them for faster full-text search.',
      );
    }

    // Check execution time
    if (dataPlan.executionTime > 200) {
      recommendations.push(
        `⚠️  Query execution time (${dataPlan.executionTime}ms) exceeds target (<200ms). Consider index optimization.`,
      );
    }

    // Check for high cost
    if (dataPlan.cost.total > 1000) {
      recommendations.push(
        `⚠️  High query cost (${dataPlan.cost.total}). Review query plan and indexes.`,
      );
    }

    // Check index usage
    const indexScans = dataPlan.operations.filter(
      op => op.type.includes('Index') || op.type.includes('Bitmap'),
    );
    if (indexScans.length === 0) {
      recommendations.push('⚠️  No index scans detected. Queries may be using sequential scans.');
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ Query plan looks good! No immediate optimizations needed.');
    }

    recommendations.forEach(rec => console.log(rec));
  }
}

// Main execution
async function main() {
  // Use environment variables from Docker or .env file
  const host = process.env.POSTGRES_HOST || process.env.DB_HOST || 'pgbouncer';
  const port = parseInt(process.env.POSTGRES_PORT || process.env.DB_PORT || '6432');
  const username = process.env.POSTGRES_USER || process.env.DB_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || 'postgres';
  const database = process.env.POSTGRES_DB || process.env.DB_NAME || 'ogini_search_dev';

  console.log(`Connecting to PostgreSQL: ${username}@${host}:${port}/${database}`);

  const dataSource = new DataSource({
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Connected to PostgreSQL database\n');

    const analyzer = new QueryPlanAnalyzer(dataSource);

    // Analyze queries for common search terms
    const indexName = process.env.DEFAULT_INDEX || 'businesses';
    const searchTerms =
      process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['restaurant', 'smartphone'];

    await analyzer.generateReport(indexName, searchTerms);

    await dataSource.destroy();
    console.log('\n✅ Analysis complete!');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
