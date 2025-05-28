# Index Persistence Fix

## Problem Description

Your search system was losing index metadata and term postings on server restart because:

1. **Index metadata** was stored only in RocksDB (not persistent across restarts)
2. **Term postings** were stored only in RocksDB (not persistent across restarts)  
3. **Documents** were stored in MongoDB (persistent)

This created a mismatch where documents existed but indices were lost on restart.

## Solution Implemented

### 1. Dual Storage Architecture

**Index Metadata** is now stored in both:
- **RocksDB**: For fast read performance during runtime
- **MongoDB**: For persistence across restarts

**Term Postings** remain in RocksDB but will be rebuilt from documents.

### 2. Automatic Restoration

- **IndexRestorationService**: Automatically restores indices from MongoDB to RocksDB on startup
- **Fallback Logic**: If RocksDB fails, system falls back to MongoDB

### 3. Migration Support

- **IndexMigrationService**: Migrates existing RocksDB indices to MongoDB
- **Migration Script**: `scripts/migrate-indices.ts` for one-time migration

## How to Fix Your Current System

### Step 1: Run the Migration (One-time)

If you have existing indices in RocksDB that need to be preserved:

```bash
# Run the migration script to move existing indices to MongoDB
npm run ts-node scripts/migrate-indices.ts
```

### Step 2: Restart Your Application

The new system will:
1. Automatically restore indices from MongoDB to RocksDB on startup
2. Store new indices in both systems
3. Provide fallback to MongoDB if RocksDB fails

### Step 3: Rebuild Term Postings (If Needed)

If search functionality is broken due to lost term postings:

```bash
# Re-index all documents to rebuild term postings
curl -X POST http://localhost:3000/api/indices/{index-name}/reindex
```

## Architecture Changes

### Before (Problematic)
```
┌─────────────┐    ┌─────────────┐
│   RocksDB   │    │   MongoDB   │
│             │    │             │
│ • Indices   │    │ • Documents │
│ • Terms     │    │             │
│ • Stats     │    │             │
└─────────────┘    └─────────────┘
     ↑                    ↑
   Lost on              Persistent
   restart
```

### After (Fixed)
```
┌─────────────┐    ┌─────────────┐
│   RocksDB   │    │   MongoDB   │
│             │    │             │
│ • Indices*  │    │ • Documents │
│ • Terms     │    │ • Indices*  │
│ • Stats     │    │             │
└─────────────┘    └─────────────┘
     ↑                    ↑
  Performance           Persistence
   (Runtime)            (Backup)
```

*Indices stored in both systems

## Key Benefits

1. **No More Data Loss**: Indices persist across restarts
2. **Fast Performance**: RocksDB still used for runtime operations
3. **Automatic Recovery**: System self-heals from MongoDB on startup
4. **Backward Compatible**: Existing functionality unchanged
5. **Graceful Degradation**: Falls back to MongoDB if RocksDB fails

## Monitoring

Check logs for:
- `Index restoration completed` - Successful startup restoration
- `Restored index: {name}` - Individual index restorations
- `Failed to restore index` - Issues requiring attention

## Future Improvements

Consider implementing:
1. **Term Posting Persistence**: Store term postings in MongoDB for complete persistence
2. **Incremental Sync**: Sync only changed indices between systems
3. **Health Checks**: Monitor sync status between RocksDB and MongoDB 