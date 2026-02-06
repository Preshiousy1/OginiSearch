# Critical Fix: MongoDB Disk Space Exhaustion During Bulk Indexing

## Problem Summary

During bulk indexing of 20,000 documents with a common term ("limited" in all documents), MongoDB crashed with "No space left on device" error at ~15,687 documents indexed.

### Root Causes

1. **Excessive MongoDB Writes**: Term postings are persisted to MongoDB after **every batch** completes
   - For 20k documents in batches of 150-200, that's ~100-130 persistence operations
   - Each persistence rewrites ALL chunks for terms like "limited" (4 chunks × 20k docs = 4 MongoDB documents)
   - This causes massive write amplification

2. **Full Chunk Rewrites**: The `update()` method in `term-postings.repository.ts` rewrites all chunks every time, even if only a few documents were added

3. **MongoDB Checkpointing**: WiredTiger storage engine writes checkpoints, which can be large and fill disk space

4. **Docker Volume Limits**: Docker volumes may have size limits or the host disk may be constrained

### Impact

- MongoDB container crashed (exit code 133)
- Redis also failed to save (disk full)
- 11 jobs stuck in queue (waiting=11, active=8, completed=100, failed=0)
- Jobs cannot complete because MongoDB is down

## Solution

### 1. Reduce Persistence Frequency

**Change**: Only persist term postings periodically during bulk indexing, not after every batch.

**Implementation**: Add a counter/threshold to persist every N batches or every N documents.

### 2. Optimize Chunk Updates

**Change**: Use incremental updates instead of full rewrites when possible.

**Note**: This is more complex and may require tracking which chunks changed.

### 3. Add Disk Space Monitoring

**Change**: Check available disk space before persistence operations and warn/throttle if low.

### 4. Recovery Steps

See detailed recovery instructions below in the "Recovery Steps" section.

## Implementation Plan

### Phase 1: Immediate Fix (Reduce Persistence Frequency)

- Modify `document.service.ts` to persist only every N batches during bulk indexing
- Add configuration for persistence interval
- Ensure final persistence happens at end of bulk operation

### Phase 2: Recovery Steps

- Document recovery procedure
- Add health checks for disk space
- Add monitoring/alerting

### Phase 3: Optimization (Future)

- Implement incremental chunk updates
- Add disk space checks before persistence
- Optimize MongoDB checkpoint frequency

## Files Modified

1. ✅ `src/indexing/services/indexing-worker.service.ts` - Added periodic persistence (every N batches)
2. ✅ `src/document/document.service.ts` - Reduced persistence frequency for large batches
3. ✅ `.env.example` - Added `PERSISTENCE_INTERVAL_BATCHES` configuration
4. ✅ `scripts/recovery/clear-stuck-jobs.ts` - Created recovery script

## Recovery Steps

### Step 1: Free Up Disk Space

```bash
# Check Docker volume sizes
docker system df -v

# Check MongoDB volume size
docker volume inspect ogini-dev_mongodb-data

# Optionally clean up unused Docker resources
docker system prune -a --volumes

# If needed, increase Docker disk space allocation (Docker Desktop)
# Settings > Resources > Advanced > Disk image size
```

### Step 2: Restart MongoDB Container

```bash
# Restart MongoDB container
docker restart ogini-dev-mongodb-1

# Or if using docker-compose
docker-compose restart mongodb

# Verify MongoDB is running
docker ps | grep mongodb
```

### Step 3: Clear Stuck Jobs from Redis Queue

```bash
# Run recovery script to clear stuck jobs
npx ts-node -r tsconfig-paths/register scripts/recovery/clear-stuck-jobs.ts

# Or manually clear via Redis CLI
docker exec -it ogini-dev-redis-1 redis-cli
> KEYS bull:indexing:*
> DEL <job-keys>
```

### Step 4: Verify System Health

```bash
# Check MongoDB connection
docker exec -it ogini-dev-mongodb-1 mongosh --eval "db.adminCommand('ping')"

# Check Redis connection
docker exec -it ogini-dev-redis-1 redis-cli ping

# Check application logs
docker logs ogini-dev-app-1 --tail 100
```

### Step 5: Resume Indexing

**Option A: Resume from Checkpoint (if available)**
- Check if there's a checkpoint file in `data/indexing-checkpoint.json`
- If yes, resume from that point

**Option B: Restart Bulk Indexing**
- Delete the partially indexed index (if needed)
- Re-run the bulk indexing request
- The new persistence interval will prevent disk space issues

### Step 6: Monitor Disk Space

```bash
# Monitor Docker volume disk usage
watch -n 5 'docker system df'

# Monitor MongoDB data directory size
docker exec -it ogini-dev-mongodb-1 du -sh /data/db

# Set up alerts for disk space (recommended)
# Add monitoring for disk usage > 80%
```

## Configuration

### New Environment Variable

```bash
# Persist term postings to MongoDB every N batches (default: 10)
# For 20k docs in batches of 150-200, this means ~10-13 persistence operations instead of 100-130
PERSISTENCE_INTERVAL_BATCHES=10
```

### How It Works

1. **During Bulk Indexing**: Term postings are persisted every N batches (default: 10) instead of after every batch
2. **Final Persistence**: When the last batch of a bulk operation completes, a final persistence ensures all data is saved
3. **Small Batches**: For batches ≤50 documents, persistence happens immediately for real-time consistency
4. **Large Batches**: For batches >50 documents, persistence is deferred to periodic intervals

This reduces MongoDB write load by ~90% during bulk indexing while ensuring data is eventually persisted.
