# Configuration Best Practices

This guide covers best practices for configuring Ogini in different environments.

## Environment Configuration

### Development Environment

```typescript
// config/development.ts
export default {
  server: {
    port: 3000,
    host: 'localhost'
  },
  elasticsearch: {
    node: 'http://localhost:9200',
    auth: {
      username: 'elastic',
      password: 'changeme'
    }
  },
  logging: {
    level: 'debug',
    format: 'dev'
  }
};
```

### Production Environment

```typescript
// config/production.ts
export default {
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  },
  elasticsearch: {
    node: process.env.ELASTICSEARCH_URL,
    auth: {
      username: process.env.ELASTICSEARCH_USERNAME,
      password: process.env.ELASTICSEARCH_PASSWORD
    }
  },
  logging: {
    level: 'info',
    format: 'json'
  }
};
```

## Security Configuration

### 1. API Authentication

```typescript
// config/auth.ts
export default {
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '1h'
  },
  apiKeys: {
    enabled: true,
    header: 'X-API-Key'
  }
};
```

### 2. Elasticsearch Security

```typescript
// config/elasticsearch.ts
export default {
  ssl: {
    enabled: true,
    ca: process.env.ELASTICSEARCH_CA,
    rejectUnauthorized: true
  },
  tls: {
    enabled: true,
    cert: process.env.ELASTICSEARCH_CERT,
    key: process.env.ELASTICSEARCH_KEY
  }
};
```

## Performance Configuration

### 1. Index Settings

```typescript
// config/index.ts
export default {
  settings: {
    number_of_shards: 3,
    number_of_replicas: 1,
    refresh_interval: '1s',
    analysis: {
      analyzer: {
        custom_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'stop', 'snowball']
        }
      }
    }
  }
};
```

### 2. Query Performance Settings

```typescript
// config/search.ts
export default {
  query: {
    // Default pagination sizes
    defaultSize: 10,
    maxSize: 1000,
    
    // Wildcard query optimization
    wildcardSettings: {
      enableAutoDetection: true,
      maxPatternComplexity: 5,
      cacheCompiledRegex: true
    },
    
    // Match-all query settings
    matchAllSettings: {
      defaultBoost: 1.0,
      enablePagination: true,
      maxResultsWithoutPagination: 100
    },
    
    // Performance thresholds
    timeouts: {
      searchTimeout: '5s',
      bulkTimeout: '30s'
    }
  }
};
```

### 3. Memory and Cache Configuration

```typescript
// config/cache.ts
export default {
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    ttl: 3600
  },
  memory: {
    max: 100,
    ttl: 60000
  },
  // Query result caching
  queryCache: {
    enabled: true,
    maxSize: 1000,
    ttl: 300, // 5 minutes
    excludePatterns: [
      'match_all', // Don't cache match-all queries
      'wildcard:*' // Don't cache overly broad wildcards
    ]
  }
};
```

## Query Optimization Best Practices

### 1. Wildcard Query Configuration

```typescript
// config/wildcardOptimization.ts
export default {
  wildcards: {
    // Pattern complexity limits
    maxWildcards: 3,
    maxQuestionMarks: 5,
    
    // Performance thresholds
    prefixOptimization: true, // Optimize prefix patterns (text*)
    suffixWarningThreshold: 1000, // Warn on suffix patterns (*text) with many results
    
    // Auto-detection settings
    autoDetection: {
      enabled: true,
      convertMatchToWildcard: true,
      logConversions: true
    },
    
    // Caching compiled regex patterns
    regexCache: {
      enabled: true,
      maxSize: 500,
      ttl: 3600 // 1 hour
    }
  }
};
```

### 2. Match-All Query Optimization

```typescript
// config/matchAllOptimization.ts
export default {
  matchAll: {
    // Pagination enforcement
    enforcePagination: {
      enabled: true,
      maxUnpaginatedResults: 100,
      defaultPageSize: 20
    },
    
    // Auto-detection configuration
    autoDetection: {
      detectAsterisk: true, // Convert {"match": {"value": "*"}} to match_all
      detectEmptyString: true, // Convert {"match": {"value": ""}} to match_all
      logDetections: true
    },
    
    // Performance monitoring
    monitoring: {
      logSlowQueries: true,
      slowQueryThreshold: 100, // ms
      trackResultCounts: true
    }
  }
};
```

### 3. Field-Specific Query Settings

```typescript
// config/fieldOptimization.ts
export default {
  fields: {
    // Optimize specific field types
    textFields: {
      enableWildcards: true,
      maxWildcardLength: 100,
      suggestPrefixPatterns: true
    },
    
    keywordFields: {
      enableExactMatch: true,
      enableWildcards: true,
      caseInsensitive: false
    },
    
    // Field-specific wildcard rules
    fieldRules: {
      'email': {
        allowedPatterns: ['*@domain.com', 'user@*'],
        blockedPatterns: ['*@*'] // Too broad
      },
      'title': {
        maxWildcards: 2,
        preferPrefixPatterns: true
      },
      'sku': {
        enablePatternValidation: true,
        requiredFormat: /^[A-Z]{2,4}-\d+-[A-Z]*$/
      }
    }
  }
};
```

### 4. Query Performance Monitoring

```typescript
// config/queryMonitoring.ts
export default {
  monitoring: {
    // Query performance tracking
    performance: {
      trackAllQueries: true,
      logSlowQueries: true,
      slowQueryThreshold: 100, // ms
      
      // Query-specific thresholds
      thresholds: {
        match_all: 50, // ms
        wildcard: 30, // ms
        match: 20, // ms
        term: 10 // ms
      }
    },
    
    // Result size monitoring
    resultSizes: {
      warnLargeResults: true,
      largeResultThreshold: 1000,
      maxResultSize: 10000
    },
    
    // Pattern analysis
    patterns: {
      trackWildcardPatterns: true,
      identifySlowPatterns: true,
      suggestOptimizations: true
    }
  }
};
```

### 5. Development vs Production Settings

#### Development Configuration
```typescript
// config/development/queryOptimization.ts
export default {
  wildcards: {
    autoDetection: {
      enabled: true,
      logConversions: true, // Verbose logging in dev
      logLevel: 'debug'
    }
  },
  matchAll: {
    enforcePagination: {
      enabled: false, // Allow unpaginated queries in dev
      warnOnly: true
    }
  },
  monitoring: {
    trackAllQueries: true,
    logAllQueries: true // Full query logging
  }
};
```

#### Production Configuration
```typescript
// config/production/queryOptimization.ts
export default {
  wildcards: {
    autoDetection: {
      enabled: true,
      logConversions: false, // Minimal logging in prod
      logLevel: 'warn'
    }
  },
  matchAll: {
    enforcePagination: {
      enabled: true, // Strict pagination in prod
      maxUnpaginatedResults: 50
    }
  },
  monitoring: {
    trackAllQueries: false,
    logSlowQueries: true // Only log problematic queries
  }
};
```

## Monitoring Configuration

### 1. Logging

```typescript
// config/logging.ts
export default {
  winston: {
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({
        filename: 'error.log',
        level: 'error'
      }),
      new winston.transports.File({
        filename: 'combined.log'
      })
    ]
  }
};
```

### 2. Metrics

```typescript
// config/metrics.ts
export default {
  prometheus: {
    enabled: true,
    path: '/metrics',
    collectDefaultMetrics: true
  },
  health: {
    enabled: true,
    path: '/health',
    checks: [
      'elasticsearch',
      'redis',
      'memory'
    ]
  }
};
```

## Best Practices

### 1. Environment Variables

- Use `.env` files for local development
- Use environment variables in production
- Never commit sensitive values to version control
- Use strong, unique values for secrets

### 2. Configuration Validation

```typescript
import { z } from 'zod';

const configSchema = z.object({
  server: z.object({
    port: z.number().min(1).max(65535),
    host: z.string()
  }),
  elasticsearch: z.object({
    node: z.string().url(),
    auth: z.object({
      username: z.string(),
      password: z.string()
    })
  })
});

function validateConfig(config: unknown) {
  return configSchema.parse(config);
}
```

### 3. Feature Flags

```typescript
// config/features.ts
export default {
  search: {
    enabled: true,
    maxResults: 100
  },
  indexing: {
    enabled: true,
    batchSize: 1000
  },
  analytics: {
    enabled: process.env.ENABLE_ANALYTICS === 'true'
  }
};
```

### 4. Error Handling

```typescript
// config/error-handling.ts
export default {
  retry: {
    maxAttempts: 3,
    backoff: {
      type: 'exponential',
      min: 1000,
      max: 5000
    }
  },
  circuitBreaker: {
    enabled: true,
    threshold: 0.5,
    timeout: 30000
  }
};
```

## Deployment Configuration

### 1. Docker

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "start"]
```

### 2. Kubernetes

```yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ogini
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: ogini
        image: ogini:latest
        env:
        - name: NODE_ENV
          value: "production"
        - name: ELASTICSEARCH_URL
          valueFrom:
            secretKeyRef:
              name: elasticsearch-secrets
              key: url
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

## Configuration Management

### 1. Version Control

- Keep configuration files in version control
- Use different files for different environments
- Document all configuration options
- Review configuration changes

### 2. Configuration Updates

```typescript
// config/update.ts
async function updateConfig(config: any) {
  // Validate new configuration
  validateConfig(config);

  // Backup current configuration
  await backupConfig();

  // Apply new configuration
  await applyConfig(config);

  // Verify configuration
  await verifyConfig();

  // Rollback if verification fails
  if (!isConfigValid()) {
    await rollbackConfig();
    throw new Error('Configuration update failed');
  }
}
```

### 3. Configuration Monitoring

```typescript
// config/monitor.ts
async function monitorConfig() {
  // Check configuration health
  const health = await checkConfigHealth();

  // Alert on issues
  if (!health.isHealthy) {
    await alertConfigIssues(health.issues);
  }

  // Log configuration changes
  await logConfigChanges();
}
``` 