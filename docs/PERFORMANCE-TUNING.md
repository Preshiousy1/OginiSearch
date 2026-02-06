# Performance Tuning Guide

This guide covers performance optimization settings for bulk indexing and general system throughput.

## Bulk Indexing Performance

### Queue Concurrency

The most impactful setting for bulk indexing speed is **`INDEXING_CONCURRENCY`**, which controls how many indexing jobs run in parallel.

**Default**: `5` concurrent jobs

**Recommendations**:
- **Local development**: `INDEXING_CONCURRENCY=10` to `12` (tune based on CPU cores and available memory)
- **Production (4-8 CPU cores)**: `INDEXING_CONCURRENCY=10` to `15`
- **Production (8+ CPU cores)**: `INDEXING_CONCURRENCY=15` to `20`

**How to set**:
```bash
export INDEXING_CONCURRENCY=10
# or in .env file:
INDEXING_CONCURRENCY=10
```

**Impact**: For 10,000 documents with batch size 100:
- Default (5): ~100 batches ÷ 5 = 20 rounds → slower
- Optimized (10): ~100 batches ÷ 10 = 10 rounds → ~2x faster

### Batch Size Optimization

The system automatically optimizes batch sizes based on request size:

- **Small requests (≤50 docs)**: Real-time mode, batch size 10
- **Medium requests (51-1000 docs)**: Background mode, batch size 100
- **Large requests (>1000 docs)**: Background mode, batch size 150-200 (scales with request size, capped at 200)

This reduces the number of jobs for large bulk operations, improving throughput.

### Other Queue Settings

- **`BULK_INDEXING_CONCURRENCY`**: Controls concurrency for bulk-specific queue (default: 1, rarely used for HTTP bulk endpoint)
- **`DOC_PROCESSING_CONCURRENCY`**: Controls document processing workers (default: 8)

## Measuring Performance

Use the bulk indexing measurement script:

```bash
# Generate test data (10k documents)
BULK_DOC_COUNT=10000 npm run bulk:generate

# Measure with default settings
npm run bulk:measure

# Measure with optimized concurrency
INDEXING_CONCURRENCY=10 npm run bulk:measure
```

The script reports:
- Total documents processed
- Time taken (seconds)
- Throughput (documents/second)

## Expected Performance

With optimized settings (`INDEXING_CONCURRENCY=10`):

- **10,000 documents**: ~3-5 minutes (target: <5 min)
- **Throughput**: ~30-50 documents/second

Actual performance depends on:
- CPU cores and speed
- Available memory
- MongoDB and Redis performance
- Document complexity (field count, text length)

## Monitoring

Check queue health and stats:

```bash
# Queue health
curl http://localhost:3000/bulk-indexing/health

# Detailed queue stats
curl http://localhost:3000/bulk-indexing/stats
```

Look for:
- `queues.totalActive`: Should decrease as indexing progresses
- `queues.totalFailed`: Should be 0 (or investigate failures)

## Troubleshooting

**Slow indexing**:
1. Increase `INDEXING_CONCURRENCY` (start with 10, increase gradually)
2. Check CPU/memory usage - don't exceed available resources
3. Monitor MongoDB and Redis performance
4. Check for failed jobs in queue stats

**Memory issues**:
1. Reduce `INDEXING_CONCURRENCY` if memory is constrained
2. Ensure `NODE_OPTIONS` includes appropriate memory limits
3. Monitor with `curl http://localhost:3000/api/memory/stats`

**Queue backlog**:
1. Increase concurrency if CPU/memory allow
2. Check for stuck/failed jobs
3. Consider pausing other operations during bulk indexing
