import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';

export interface OptimizationProgress {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  currentStatement: number;
  totalStatements: number;
  currentPhase: string;
  errorCount: number;
  errors: Array<{ statement: string; error: string }>;
  startTime?: number;
  endTime?: number;
  estimatedTimeRemaining?: number;
}

@Injectable()
export class DatabaseOptimizationService {
  private readonly logger = new Logger(DatabaseOptimizationService.name);

  constructor(
    @InjectQueue('database-optimization') private optimizationQueue: Queue,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  /**
   * Queue database optimization job
   */
  async queueOptimization(): Promise<{ jobId: string; message: string }> {
    const job = await this.optimizationQueue.add('run-optimization', {
      startedAt: Date.now(),
    });

    this.logger.log(`Database optimization job queued: ${job.id}`);

    return {
      jobId: job.id.toString(),
      message:
        'Database optimization queued. This will run in the background and may take 2-4 hours.',
    };
  }

  /**
   * Get optimization progress
   */
  async getProgress(jobId: string): Promise<OptimizationProgress | null> {
    const job = await this.optimizationQueue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress: any = job.progress();

    return {
      jobId: jobId,
      status: this.mapJobState(state),
      currentStatement: progress?.currentStatement || 0,
      totalStatements: progress?.totalStatements || 82,
      currentPhase: progress?.currentPhase || 'queued',
      errorCount: progress?.errorCount || 0,
      errors: progress?.errors || [],
      startTime: progress?.startTime,
      endTime: progress?.endTime,
      estimatedTimeRemaining: progress?.estimatedTimeRemaining,
    };
  }

  /**
   * Cancel optimization job
   */
  async cancelOptimization(jobId: string): Promise<{ success: boolean; message: string }> {
    const job = await this.optimizationQueue.getJob(jobId);
    if (!job) {
      return { success: false, message: 'Job not found' };
    }

    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      return { success: false, message: `Job already ${state}` };
    }

    await job.remove();
    return { success: true, message: 'Optimization job cancelled' };
  }

  private mapJobState(state: string): 'queued' | 'running' | 'completed' | 'failed' {
    switch (state) {
      case 'active':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'waiting':
      case 'delayed':
        return 'queued';
      default:
        return 'queued';
    }
  }

  /**
   * Process optimization (called by Bull processor)
   */
  async processOptimization(job: any): Promise<any> {
    const startTime = Date.now();
    this.logger.log('Starting database optimization process...');

    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'complete-search-optimization.sql');

      if (!fs.existsSync(scriptPath)) {
        throw new Error('Optimization script not found');
      }

      const script = fs.readFileSync(scriptPath, 'utf8');

      // Clean the script
      const cleanScript = this.cleanScript(script);

      // Parse statements
      const statements = this.parseStatements(cleanScript);

      this.logger.log(`Parsed ${statements.length} statements`);

      await job.progress({
        currentStatement: 0,
        totalStatements: statements.length,
        currentPhase: 'Starting optimization',
        errorCount: 0,
        errors: [],
        startTime,
      });

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      // Execute statements with progress updates
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const phase = this.identifyPhase(statement, i, statements.length);

        try {
          await this.dataSource.query(statement);
          successCount++;

          // Update progress every statement
          const progress = {
            currentStatement: i + 1,
            totalStatements: statements.length,
            currentPhase: phase,
            errorCount,
            errors: errors.slice(-5), // Keep last 5 errors
            startTime,
            estimatedTimeRemaining: this.estimateTimeRemaining(i + 1, statements.length, startTime),
          };

          await job.progress(progress);

          // Log progress every 5 statements
          if ((i + 1) % 5 === 0) {
            this.logger.log(
              `Progress: ${i + 1}/${statements.length} - ${phase} - ETA: ${this.formatTime(
                progress.estimatedTimeRemaining,
              )}`,
            );
          }
        } catch (error) {
          errorCount++;
          const preview = statement.substring(0, 100).replace(/\n/g, ' ');
          errors.push({
            statement: preview + '...',
            error: error.message,
          });

          this.logger.warn(`Error executing statement ${i + 1}: ${error.message}`);

          // Continue execution even with errors (some may be non-critical)
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Get final statistics
      const vectorCoverage = await this.dataSource.query(`
        SELECT 
          COUNT(*) as total_documents,
          COUNT(CASE WHEN weighted_search_vector IS NOT NULL THEN 1 END) as documents_with_vectors,
          ROUND((COUNT(CASE WHEN weighted_search_vector IS NOT NULL THEN 1 END)::FLOAT / 
                 NULLIF(COUNT(*), 0) * 100)::numeric, 2) as vector_coverage_percent
        FROM documents
      `);

      const indexCount = await this.dataSource.query(`
        SELECT COUNT(*) as index_count
        FROM pg_indexes 
        WHERE tablename = 'documents'
      `);

      await job.progress({
        currentStatement: statements.length,
        totalStatements: statements.length,
        currentPhase: 'Completed',
        errorCount,
        errors: errors.slice(-10),
        startTime,
        endTime,
      });

      return {
        status: errorCount === 0 ? 'success' : 'partial_success',
        message:
          errorCount === 0
            ? 'Complete search optimization executed successfully'
            : 'Optimization completed with some errors',
        execution: {
          total_statements: statements.length,
          successful: successCount,
          errors: errorCount,
          error_details: errors.slice(-10),
        },
        statistics: {
          ...vectorCoverage[0],
          total_indexes: indexCount[0].index_count,
        },
        executionTime: `${(duration / 1000).toFixed(2)}s`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Optimization process failed:', error);
      throw error;
    }
  }

  private cleanScript(script: string): string {
    return script
      .replace(/\\timing on/g, '')
      .replace(/\\set ON_ERROR_STOP on/g, '')
      .replace(/^BEGIN;/gm, '')
      .replace(/^COMMIT;/gm, '')
      .replace(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/gi, 'CREATE INDEX IF NOT EXISTS')
      .replace(/CREATE INDEX CONCURRENTLY/gi, 'CREATE INDEX IF NOT EXISTS')
      .replace(
        /DROP INDEX IF EXISTS ([^;]+);[\s\n]*CREATE INDEX CONCURRENTLY/gi,
        'CREATE INDEX IF NOT EXISTS',
      );
  }

  private parseStatements(script: string): string[] {
    const statements: string[] = [];
    let currentStatement = '';
    let inDollarQuote = false;
    let blockType: 'DO' | 'FUNCTION' | null = null;
    let functionEndingSeen = false;

    const lines = script.split('\n');

    for (const line of lines) {
      if (!currentStatement && (line.trim() === '' || line.trim().startsWith('--'))) {
        continue;
      }

      currentStatement += line + '\n';

      if (!inDollarQuote) {
        if (line.match(/DO\s+\$\$/i)) {
          inDollarQuote = true;
          blockType = 'DO';
        } else if (
          line.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i) ||
          line.match(/RETURNS/i) ||
          currentStatement.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i)
        ) {
          if (line.match(/AS\s+\$\$/i) || line.match(/\)\s+AS\s+\$\$/i)) {
            inDollarQuote = true;
            blockType = 'FUNCTION';
          }
        }
      } else {
        if (blockType === 'DO' && line.match(/END\s+\$\$;/i)) {
          inDollarQuote = false;
          blockType = null;
          if (currentStatement.trim()) {
            statements.push(currentStatement.trim());
          }
          currentStatement = '';
          continue;
        } else if (blockType === 'FUNCTION' && line.match(/\$\$\s*LANGUAGE/i)) {
          functionEndingSeen = true;
          inDollarQuote = false;

          if (line.includes(';')) {
            blockType = null;
            functionEndingSeen = false;
            if (currentStatement.trim()) {
              statements.push(currentStatement.trim());
            }
            currentStatement = '';
            continue;
          }
        }
      }

      if (!inDollarQuote && line.trim().endsWith(';')) {
        if (currentStatement.trim()) {
          statements.push(currentStatement.trim());
        }
        currentStatement = '';
        blockType = null;
        functionEndingSeen = false;
      }
    }

    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    return statements.filter(s => s && !s.startsWith('--'));
  }

  private identifyPhase(statement: string, index: number, total: number): string {
    const upper = statement.toUpperCase();

    if (upper.includes('CREATE EXTENSION')) return 'Setting up extensions';
    if (upper.includes('ALTER SYSTEM')) return 'Configuring PostgreSQL';
    if (upper.includes('ALTER TABLE') && upper.includes('ADD COLUMN'))
      return 'Adding materialized columns';
    if (upper.includes('CREATE OR REPLACE FUNCTION')) return 'Creating helper functions';
    if (upper.includes('CREATE TRIGGER')) return 'Setting up triggers';
    if (upper.includes('UPDATE documents') && upper.includes('weighted_search_vector'))
      return `Populating search vectors (${Math.floor((index / total) * 100)}%)`;
    if (upper.includes('CREATE INDEX')) return 'Creating indexes';
    if (upper.includes('CREATE MATERIALIZED VIEW')) return 'Creating materialized views';
    if (upper.includes('ANALYZE')) return 'Analyzing table statistics';
    if (upper.includes('CREATE OR REPLACE VIEW')) return 'Creating monitoring views';

    return 'Processing...';
  }

  private estimateTimeRemaining(current: number, total: number, startTime: number): number {
    if (current === 0) return 0;

    const elapsed = Date.now() - startTime;
    const avgTimePerStatement = elapsed / current;
    const remaining = total - current;

    return Math.floor(avgTimePerStatement * remaining);
  }

  private formatTime(ms: number): string {
    if (!ms || ms < 0) return 'unknown';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
