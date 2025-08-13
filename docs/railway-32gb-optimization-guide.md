# Railway 32GB/32 vCPU Optimization Guide

## Overview
This guide documents the comprehensive optimizations made to maximize performance on Railway's 32 vCPU and 32GB RAM plan.

## Resource Allocation Strategy

### Total Resources: 32 vCPU, 32GB RAM

| Component | CPU Cores | Memory | Purpose |
|-----------|-----------|---------|---------|
| **Main Application** | 24 cores | 24GB | Primary search engine and API |
| **PostgreSQL** | 6 cores | 20GB | Database with optimized caching |
| **Redis** | 1 core | 3GB | Session and query caching |
| **Worker-1** | 3 cores | 6GB | Background indexing |
| **Worker-2** | 3 cores | 6GB | Background indexing |
| **Worker-3** | 3 cores | 6GB | Background indexing |
| **System/OS** | 2 cores | 2GB | Operating system overhead |

## PostgreSQL Optimizations

### Memory Configuration (20GB allocated)
```sql
shared_buffers = 8GB                    -- 40% of allocated memory
effective_cache_size = 20GB             -- 100% of allocated memory
maintenance_work_mem = 1GB              -- Large maintenance operations
work_mem = 64MB                         -- Per-query memory
wal_buffers = 256MB                     -- Write-ahead log buffers
```

### Performance Settings
```sql
max_connections = 1000                  -- High concurrency support
max_parallel_workers = 32               -- Utilize all CPU cores
max_parallel_workers_per_gather = 8     -- Parallel query execution
effective_io_concurrency = 800          -- High I/O concurrency
default_statistics_target = 1000        -- Better query planning
```

### Autovacuum Optimization
```sql
autovacuum_vacuum_scale_factor = 0.02   -- More aggressive cleanup
autovacuum_analyze_scale_factor = 0.01  -- Frequent statistics updates
autovacuum_vacuum_cost_limit = 4000     -- Higher cost limit
autovacuum_vacuum_cost_delay = 10ms     -- Faster response
```

## Application Optimizations

### Node.js Configuration
```bash
NODE_OPTIONS=--max-old-space-size=24576 --expose-gc --optimize-for-size=false
```

### Concurrency Settings
```bash
INDEXING_CONCURRENCY=120                -- High indexing throughput
BULK_INDEXING_CONCURRENCY=80            -- Bulk operations
DOC_PROCESSING_CONCURRENCY=100          -- Document processing
SEARCH_CONCURRENCY=200                  -- Search operations
WORKER_CONCURRENCY=150                  -- Background workers
```

### Memory Management
```bash
MAX_CACHE_SIZE=50000                    -- Large in-memory cache
CACHE_TTL=3600                          -- 1-hour cache TTL
QUERY_CACHE_SIZE=10000                  -- Query result caching
INDEX_CACHE_SIZE=20000                  -- Index metadata caching
ANALYSIS_CACHE_SIZE=10000               -- Text analysis caching
```

## Redis Optimizations

### Memory Configuration (3GB allocated)
```bash
maxmemory 3gb                           -- 3GB memory limit
maxmemory-policy allkeys-lru            -- LRU eviction
io-threads 4                            -- Multi-threaded I/O
maxclients 10000                        -- High connection limit
```

### Persistence Settings
```bash
save 900 1                              -- Save every 15 minutes if 1+ changes
save 300 10                             -- Save every 5 minutes if 10+ changes
save 60 10000                           -- Save every minute if 10000+ changes
```

## Worker Scaling

### Dedicated Worker Processes
- **3 Worker Instances**: Each with 3 CPU cores and 6GB RAM
- **Specialized Tasks**: Indexing, bulk operations, document processing
- **Load Distribution**: Automatic job distribution across workers

### Worker Configuration
```bash
WORKER_MODE=true
INDEXING_CONCURRENCY=60                 -- Per-worker indexing
BULK_INDEXING_CONCURRENCY=40            -- Per-worker bulk operations
DOC_PROCESSING_CONCURRENCY=50           -- Per-worker document processing
```

## Performance Expectations

### Search Performance
- **Average Response Time**: < 20ms
- **95th Percentile**: < 50ms
- **99th Percentile**: < 100ms
- **Concurrent Searches**: 1000+ simultaneous

### Indexing Performance
- **Document Indexing**: 5000+ docs/sec
- **Bulk Operations**: 10000+ docs/batch
- **Real-time Updates**: < 1 second latency
- **Background Processing**: Continuous without blocking

### Memory Utilization
- **Application**: 85-90% of allocated memory
- **PostgreSQL**: 90-95% of allocated memory
- **Redis**: 80-85% of allocated memory
- **System**: 10-15% overhead

## Monitoring and Alerting

### Key Metrics
- **CPU Utilization**: Target < 80%
- **Memory Usage**: Target < 90%
- **Disk I/O**: Monitor for bottlenecks
- **Network Latency**: < 10ms internal

### Alert Thresholds
- **High CPU**: > 85% for 5 minutes
- **High Memory**: > 90% for 2 minutes
- **Slow Queries**: > 100ms average
- **Connection Limits**: > 80% of max connections

## Deployment Commands

### Production Deployment
```bash
# Deploy optimized stack
./deploy-railway-32gb.sh

# Monitor performance
./scripts/monitor-performance.sh

# Run performance tests
npm run test:performance
```

### Health Checks
```bash
# Application health
curl https://your-app.railway.app/health

# Database health
docker exec ogini-postgres-prod pg_isready

# Redis health
docker exec ogini-redis-prod redis-cli ping
```

## Scaling Recommendations

### Vertical Scaling (Current)
- **CPU**: 32 vCPU provides excellent performance
- **Memory**: 32GB allows for large caches and high concurrency
- **Storage**: SSD storage for optimal I/O performance

### Horizontal Scaling (Future)
- **Read Replicas**: Add PostgreSQL read replicas for search queries
- **Worker Scaling**: Increase worker instances based on indexing load
- **Cache Clustering**: Redis cluster for distributed caching

## Troubleshooting

### Common Issues
1. **High Memory Usage**: Check for memory leaks in application
2. **Slow Queries**: Analyze PostgreSQL query plans
3. **Connection Limits**: Monitor connection pool usage
4. **Worker Failures**: Check worker logs and restart if needed

### Performance Tuning
1. **Query Optimization**: Use EXPLAIN ANALYZE for slow queries
2. **Index Tuning**: Monitor index usage and create missing indexes
3. **Cache Warming**: Pre-populate cache with popular queries
4. **Connection Pooling**: Optimize connection pool settings

## Cost Optimization

### Resource Efficiency
- **CPU Utilization**: Target 70-80% for optimal cost/performance
- **Memory Usage**: Target 85-90% to maximize value
- **Storage**: Use compression and cleanup old data
- **Network**: Optimize query patterns to reduce bandwidth

### Monitoring Costs
- **Railway Pricing**: Monitor usage against plan limits
- **Database Costs**: Optimize query patterns to reduce I/O
- **Storage Costs**: Implement data retention policies
- **Network Costs**: Cache frequently accessed data

## Security Considerations

### Database Security
- **SSL/TLS**: Enabled for all connections
- **Authentication**: Strong password policies
- **Network Security**: Isolated network with firewall rules
- **Backup Security**: Encrypted backups with access controls

### Application Security
- **API Security**: Rate limiting and authentication
- **Input Validation**: Sanitize all user inputs
- **Error Handling**: Secure error messages
- **Logging**: Audit logs for security monitoring

This optimization guide ensures maximum performance and efficiency on Railway's 32GB/32 vCPU plan while maintaining security and reliability. 