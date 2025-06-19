import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  // Redis connection settings
  redis: {
    // Support Railway's REDIS_URL format (preferred)
    url: process.env.REDIS_URL || undefined,
    // Individual connection parameters (fallback)
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || undefined,
    // Connection pool settings for high throughput
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    lazyConnect: true,
    // Connection pool
    family: 4,
    keepAlive: true,
    // Performance optimizations
    maxMemoryPolicy: 'allkeys-lru',
  },

  // Bull queue settings
  bull: {
    // Default job options
    defaultJobOptions: {
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50, // Keep last 50 failed jobs
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },

    // Queue-specific settings
    queues: {
      indexing: {
        name: 'indexing',
        concurrency: parseInt(process.env.INDEXING_CONCURRENCY, 10) || 5,
        maxStalledCount: 1,
        stalledInterval: 30 * 1000, // 30 seconds
        maxConcurrency: 10,
      },

      'bulk-indexing': {
        name: 'bulk-indexing',
        concurrency: parseInt(process.env.BULK_INDEXING_CONCURRENCY, 10) || 1,
        maxStalledCount: 1,
        stalledInterval: 60 * 1000, // 1 minute
        maxConcurrency: 2, // Limited for bulk operations
      },

      'document-processing': {
        name: 'document-processing',
        concurrency: parseInt(process.env.DOC_PROCESSING_CONCURRENCY, 10) || 8,
        maxStalledCount: 2,
        stalledInterval: 15 * 1000, // 15 seconds
        maxConcurrency: 15,
      },
    },
  },

  // Bulk indexing performance settings
  bulkIndexing: {
    // Batch processing
    defaultBatchSize: parseInt(process.env.BULK_BATCH_SIZE, 10) || 500,
    maxBatchSize: parseInt(process.env.BULK_MAX_BATCH_SIZE, 10) || 2000,
    minBatchSize: parseInt(process.env.BULK_MIN_BATCH_SIZE, 10) || 100,

    // Concurrency controls
    defaultConcurrency: parseInt(process.env.BULK_DEFAULT_CONCURRENCY, 10) || 3,
    maxConcurrency: parseInt(process.env.BULK_MAX_CONCURRENCY, 10) || 8,

    // Memory management
    maxMemoryUsage: parseFloat(process.env.BULK_MAX_MEMORY_USAGE) || 0.8, // 80%
    gcInterval: parseInt(process.env.BULK_GC_INTERVAL, 10) || 1000, // ms

    // Performance optimizations
    skipValidation: process.env.BULK_SKIP_VALIDATION === 'true',
    enableCompression: process.env.BULK_ENABLE_COMPRESSION !== 'false',

    // Duplicate detection
    duplicateCheckTtl: parseInt(process.env.DUPLICATE_CHECK_TTL, 10) || 3600, // 1 hour
    enableFastDeduplication: process.env.ENABLE_FAST_DEDUPLICATION !== 'false',

    // Database optimizations
    fetchTimeout: parseInt(process.env.BULK_FETCH_TIMEOUT, 10) || 30000, // 30 seconds
    indexTimeout: parseInt(process.env.BULK_INDEX_TIMEOUT, 10) || 60000, // 60 seconds

    // Retry settings
    maxRetries: parseInt(process.env.BULK_MAX_RETRIES, 10) || 3,
    retryDelay: parseInt(process.env.BULK_RETRY_DELAY, 10) || 5000, // 5 seconds

    // Progress tracking
    progressUpdateInterval: parseInt(process.env.BULK_PROGRESS_INTERVAL, 10) || 1000, // 1 second
    enableRealtimeProgress: process.env.ENABLE_REALTIME_PROGRESS !== 'false',

    // Resume capability
    enableResume: process.env.ENABLE_BULK_RESUME !== 'false',
    checkpointInterval: parseInt(process.env.BULK_CHECKPOINT_INTERVAL, 10) || 5000, // Every 5000 docs
  },

  // Document processing settings
  documentProcessing: {
    // Text analysis performance
    enableParallelAnalysis: process.env.ENABLE_PARALLEL_ANALYSIS !== 'false',
    analysisWorkers: parseInt(process.env.ANALYSIS_WORKERS, 10) || 4,

    // Field processing
    maxFieldLength: parseInt(process.env.MAX_FIELD_LENGTH, 10) || 1000000, // 1MB
    enableFieldTruncation: process.env.ENABLE_FIELD_TRUNCATION === 'true',

    // Tokenization
    maxTokensPerField: parseInt(process.env.MAX_TOKENS_PER_FIELD, 10) || 10000,
    enableTokenCaching: process.env.ENABLE_TOKEN_CACHING !== 'false',

    // Stemming and normalization
    enableStemming: process.env.ENABLE_STEMMING !== 'false',
    enableNormalization: process.env.ENABLE_NORMALIZATION !== 'false',

    // Language detection
    enableLanguageDetection: process.env.ENABLE_LANGUAGE_DETECTION === 'true',
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en',
  },

  // Monitoring and alerting
  monitoring: {
    // Queue monitoring
    enableQueueMonitoring: process.env.ENABLE_QUEUE_MONITORING !== 'false',
    monitoringInterval: parseInt(process.env.MONITORING_INTERVAL, 10) || 30000, // 30 seconds

    // Performance thresholds
    slowJobThreshold: parseInt(process.env.SLOW_JOB_THRESHOLD, 10) || 60000, // 1 minute
    stuckJobThreshold: parseInt(process.env.STUCK_JOB_THRESHOLD, 10) || 300000, // 5 minutes

    // Memory monitoring
    memoryWarningThreshold: parseFloat(process.env.MEMORY_WARNING_THRESHOLD) || 0.7, // 70%
    memoryCriticalThreshold: parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD) || 0.9, // 90%

    // Rate monitoring
    minExpectedRate: parseInt(process.env.MIN_EXPECTED_RATE, 10) || 100, // docs/sec
    maxAcceptableErrorRate: parseFloat(process.env.MAX_ERROR_RATE) || 0.05, // 5%

    // Alerting
    enableAlerts: process.env.ENABLE_ALERTS === 'true',
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
    alertSlackChannel: process.env.ALERT_SLACK_CHANNEL,
  },

  // Development and debugging
  development: {
    // Logging
    enableDebugLogging: process.env.NODE_ENV === 'development',
    logJobProgress: process.env.LOG_JOB_PROGRESS === 'true',
    logBatchDetails: process.env.LOG_BATCH_DETAILS === 'true',

    // Testing
    enableTestMode: process.env.ENABLE_TEST_MODE === 'true',
    testBatchSize: parseInt(process.env.TEST_BATCH_SIZE, 10) || 10,
    testConcurrency: parseInt(process.env.TEST_CONCURRENCY, 10) || 1,

    // Performance profiling
    enableProfiling: process.env.ENABLE_PROFILING === 'true',
    profilingInterval: parseInt(process.env.PROFILING_INTERVAL, 10) || 10000, // 10 seconds
  },

  // Railway-specific optimizations
  railway: {
    // Resource constraints awareness
    isRailwayEnvironment: process.env.RAILWAY_ENVIRONMENT === 'production',
    railwayMemoryLimit: parseInt(process.env.RAILWAY_MEMORY_LIMIT, 10) || 512, // MB
    railwayCpuLimit: parseFloat(process.env.RAILWAY_CPU_LIMIT) || 0.5, // vCPU

    // Optimizations for Railway hobby plan
    hobbyPlanOptimizations: {
      reducedBatchSize: 250,
      reducedConcurrency: 2,
      increasedRetryDelay: 3000,
      enableMemoryOptimizations: true,
      enableNetworkOptimizations: true,
    },

    // Connection pooling for Railway
    maxConnections: parseInt(process.env.RAILWAY_MAX_CONNECTIONS, 10) || 5,
    connectionTimeout: parseInt(process.env.RAILWAY_CONNECTION_TIMEOUT, 10) || 10000,
  },
}));

// Helper function to get environment-specific settings
export function getOptimizedSettings() {
  const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production';
  const isHobbyPlan = process.env.RAILWAY_PLAN === 'hobby';

  if (isRailway && isHobbyPlan) {
    return {
      batchSize: 250,
      concurrency: 2,
      maxMemoryUsage: 0.7, // More conservative on hobby plan
      enableFastDeduplication: true,
      skipValidation: true, // Skip validation for performance
      gcInterval: 500, // More frequent GC
    };
  }

  if (isRailway) {
    return {
      batchSize: 400,
      concurrency: 3,
      maxMemoryUsage: 0.75,
      enableFastDeduplication: true,
      skipValidation: false,
      gcInterval: 1000,
    };
  }

  // Local development or other environments
  return {
    batchSize: 500,
    concurrency: 5,
    maxMemoryUsage: 0.8,
    enableFastDeduplication: true,
    skipValidation: false,
    gcInterval: 2000,
  };
}
