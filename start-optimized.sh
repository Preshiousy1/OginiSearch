#!/bin/bash

# Production Optimized Script for Ogini Search Engine
echo "🚀 Starting Ogini in PRODUCTION mode with memory optimizations..."

# Production Node.js memory settings
export NODE_OPTIONS="--max-old-space-size=4096 --expose-gc"

# Production memory settings
export MAX_CACHE_SIZE=10000
export EVICTION_THRESHOLD=0.8
export GC_INTERVAL=60000
export MEMORY_MONITOR_INTERVAL=30000
export LOG_MEMORY_STATS=false
export LOG_LEVEL=info

# Production batch sizes
export BATCH_SIZE=100
export TERM_CHUNK_SIZE=50
export FIELD_CHUNK_SIZE=10

# Production RocksDB settings
export ROCKSDB_CACHE_SIZE=128MB
export ROCKSDB_WRITE_BUFFER_SIZE=64MB

echo "⚙️  Production optimization settings:"
echo "   - Max heap size: 4096MB"
echo "   - Cache size: ${MAX_CACHE_SIZE}"
echo "   - Eviction threshold: ${EVICTION_THRESHOLD}"
echo "   - GC interval: ${GC_INTERVAL}ms"

echo ""
echo "🎯 Starting production server..."

# Start with minimal logging for production
node dist/src/main.js