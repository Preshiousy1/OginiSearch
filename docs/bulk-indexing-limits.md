# Bulk Indexing Limits and Recommendations

## Current Configuration

### Redis Memory
- **Default (docker-compose.yml)**: 1GB (updated from 256MB)
- **Production**: Should be configured based on expected load

### Batch Size
- **Default**: 200 documents per batch
- **Configurable**: Via `batchSize` option in `queueBulkIndexing()`

## Recommended Limits

### Based on Redis Memory

| Redis Memory | Max Concurrent Batches | Max Documents (batchSize=200) | Max Documents (batchSize=100) |
|--------------|------------------------|-------------------------------|------------------------------|
| 256MB        | ~50-100                | 10,000 - 20,000              | 5,000 - 10,000              |
| 512MB        | ~100-200               | 20,000 - 40,000              | 10,000 - 20,000             |
| 1GB          | ~200-400               | 40,000 - 80,000              | 20,000 - 40,000             |
| 2GB          | ~400-800               | 80,000 - 160,000             | 40,000 - 80,000             |

### Memory Calculation

Each batch requires:
- **Indexing job**: ~5-10KB (minimal payload with MongoDB reference)
- **Persistence job**: ~5-10KB (minimal payload with MongoDB reference)
- **Bull metadata**: ~1-2KB per job
- **Redis overhead**: ~20-30% for data structures

**Example for 40,000 documents (batchSize=200, 200 batches)**:
- 200 indexing jobs × ~8KB = ~1.6MB
- 200 persistence jobs × ~8KB = ~1.6MB
- Bull metadata: ~400KB
- **Total**: ~3.6MB + 30% overhead = **~4.7MB** for job metadata

**However**, Redis also stores:
- Active job locks
- Completed/failed job history (if `removeOnComplete: false`)
- Queue state and statistics
- Other application data

**Safe estimate**: Use **10-20% of Redis memory** for queue jobs, rest for other data.

### Recommendations

1. **For 40,000 documents**:
   - **Minimum Redis**: 512MB (tight, may have eviction)
   - **Recommended Redis**: 1GB (comfortable)
   - **Batch size**: 200 documents (200 batches)

2. **For 100,000+ documents**:
   - **Minimum Redis**: 2GB
   - **Recommended Redis**: 4GB
   - **Batch size**: 200-500 documents
   - **Consider**: Splitting into multiple bulk operations

3. **Best Practices**:
   - **Monitor Redis memory usage** during indexing
   - **Use smaller batch sizes** (100-150) if you see eviction warnings
   - **Increase Redis memory** rather than reducing batch size (better performance)
   - **Use MongoDB payload store** (already implemented) to prevent data loss from eviction

## Why Some Batches Are Unrecoverable

When you see "payload key not found" errors:

1. **Batch was already persisted**: Payload was deleted after successful persistence, but duplicate persistence jobs remain in the queue
   - **Solution**: The system now checks if batches were already persisted and skips gracefully

2. **Batch never indexed**: Indexing job payload was evicted before the batch could run
   - **Solution**: Use the new MongoDB indexing payload store (already implemented) - this prevents indexing jobs from being lost

3. **Payload expired**: Payloads have a 7-day TTL in MongoDB
   - **Solution**: Re-index the missing batches

## Increasing Redis Memory

### Local Development (docker-compose.yml)
```yaml
redis:
  command: redis-server --appendonly yes --maxmemory 1gb --maxmemory-policy allkeys-lru
```

### Production (Railway/Cloud)
Set Redis memory limit in your Redis provider's configuration:
- **Railway**: Configure in Redis service settings
- **AWS ElastiCache**: Set `maxmemory` parameter
- **Redis Cloud**: Set in plan configuration

### Verify Redis Memory
```bash
redis-cli INFO memory
# Look for: used_memory_human and maxmemory_human
```

## Monitoring

Watch for these indicators:
- **"Unnamed indexing job"** warnings → Redis evicting indexing job payloads (use MongoDB payload store)
- **"Payload key not found"** errors → Duplicate persistence jobs or payloads deleted
- **High Redis memory usage** → Increase Redis memory or reduce batch size
- **Slow indexing** → Reduce concurrency or increase Redis memory
