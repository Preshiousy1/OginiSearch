#!/bin/bash

# Memory Testing Script for Ogini Search Engine
echo "🧪 Running Memory Optimization Tests..."

# Ensure we have garbage collection available
export NODE_OPTIONS="--max-old-space-size=1024 --expose-gc"

# Test environment settings
export NODE_ENV=test
export MAX_CACHE_SIZE=1000
export EVICTION_THRESHOLD=0.5
export GC_INTERVAL=10000

echo "⚙️  Test memory settings:"
echo "   - Max heap size: 1024MB (conservative)"
echo "   - Cache size: ${MAX_CACHE_SIZE} (small)"
echo "   - Eviction threshold: ${EVICTION_THRESHOLD} (aggressive)"

echo ""
echo "🔬 Running memory leak tests..."

# Run memory leak validation
node --expose-gc scripts/testing/memory-leak-test.mjs

echo ""
echo "📊 Running performance tests..."

# Run performance tests if available
if [ -f "scripts/run-performance-tests.sh" ]; then
    ./scripts/run-performance-tests.sh
else
    echo "⚠️  Performance tests script not found"
fi

echo ""
echo "🧹 Cleaning up test artifacts..."

# Clean up any test artifacts
npm run cleanup:heap

echo "✅ Memory testing completed!" 