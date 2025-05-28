#!/bin/bash

# Development Debug Script for Ogini Search Engine
echo "🔧 Starting Ogini in DEVELOPMENT DEBUG mode..."

# Kill any existing processes on port 3000
echo "🔪 Killing any existing processes on port 3000..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 2

# Development Node.js memory settings
export NODE_OPTIONS="--max-old-space-size=2048 --expose-gc"

# Development memory settings
export MAX_CACHE_SIZE=5000
export EVICTION_THRESHOLD=0.7
export GC_INTERVAL=30000
export MEMORY_MONITOR_INTERVAL=15000
export LOG_MEMORY_STATS=true
export LOG_LEVEL=debug

# Development batch sizes
export BATCH_SIZE=50
export TERM_CHUNK_SIZE=25
export FIELD_CHUNK_SIZE=5

# Development RocksDB settings
export ROCKSDB_CACHE_SIZE=64MB
export ROCKSDB_WRITE_BUFFER_SIZE=32MB

echo "⚙️  Development debug settings:"
echo "   - Max heap size: 2048MB"
echo "   - Cache size: ${MAX_CACHE_SIZE}"
echo "   - Eviction threshold: ${EVICTION_THRESHOLD}"
echo "   - Memory monitoring: ${MEMORY_MONITOR_INTERVAL}ms"

echo ""
echo "🚀 Building and starting development server..."

# Build and run without garbage collection tracing
npm run build && node --trace-warnings dist/src/main.js 