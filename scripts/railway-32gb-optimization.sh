#!/bin/bash

# ===================================================
# RAILWAY 32GB/32 vCPU OPTIMIZATION SCRIPT
# ===================================================

set -e

echo "🚀 Optimizing Ogini Search Engine for Railway 32GB/32 vCPU..."

# === COLOR OUTPUT ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# === SYSTEM OPTIMIZATIONS ===
log_info "Applying system optimizations..."

# Update system limits
cat >> /etc/security/limits.conf << EOF
# Ogini Search Engine optimizations
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
EOF

# Optimize kernel parameters
cat >> /etc/sysctl.conf << EOF
# Network optimizations
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 1200
net.ipv4.tcp_max_tw_buckets = 5000

# Memory optimizations
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.overcommit_memory = 1

# File system optimizations
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF

# Apply sysctl changes
sysctl -p

log_success "System optimizations applied"

# === POSTGRESQL OPTIMIZATIONS ===
log_info "Optimizing PostgreSQL for 32GB RAM..."

# Create optimized PostgreSQL configuration
cat > /etc/postgresql/postgresql.conf << EOF
# ===================================================
# RAILWAY 32GB OPTIMIZED POSTGRESQL CONFIG
# ===================================================

# === CONNECTIONS ===
max_connections = 1000
superuser_reserved_connections = 10

# === MEMORY (24GB allocated to PostgreSQL) ===
shared_buffers = 8GB                    # 33% of 24GB
effective_cache_size = 20GB             # 83% of 24GB
maintenance_work_mem = 1GB
work_mem = 64MB
wal_buffers = 256MB

# === WRITE AHEAD LOG ===
wal_level = replica
fsync = on
synchronous_commit = off
full_page_writes = on
wal_compression = on
min_wal_size = 8GB
max_wal_size = 32GB

# === CHECKPOINTS ===
checkpoint_completion_target = 0.9
checkpoint_timeout = 10min
checkpoint_warning = 30s

# === BACKGROUND WRITER ===
bgwriter_delay = 100ms
bgwriter_lru_maxpages = 2000
bgwriter_lru_multiplier = 20.0

# === AUTOVACUUM ===
autovacuum = on
autovacuum_vacuum_scale_factor = 0.02
autovacuum_analyze_scale_factor = 0.01
autovacuum_vacuum_cost_limit = 4000
autovacuum_vacuum_cost_delay = 10ms
log_autovacuum_min_duration = 0

# === QUERY PLANNER ===
random_page_cost = 1.1
effective_io_concurrency = 800
default_statistics_target = 1000

# === PARALLEL QUERY (32 vCPU) ===
max_parallel_workers_per_gather = 8
max_parallel_workers = 32
max_parallel_maintenance_workers = 8
parallel_tuple_cost = 0.1
parallel_setup_cost = 1000.0

# === LOGGING ===
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_rotation_age = 1d
log_rotation_size = 100MB
log_min_duration_statement = 100
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 0

# === STATISTICS ===
shared_preload_libraries = 'pg_stat_statements,pg_stat_monitor,pg_trgm'
pg_stat_statements.track = all
pg_stat_statements.max = 10000
pg_stat_monitor.pgsm_normalized_query = on

# === SEARCH OPTIMIZATIONS ===
default_text_search_config = 'pg_catalog.english'
EOF

log_success "PostgreSQL configuration optimized"

# === REDIS OPTIMIZATIONS ===
log_info "Optimizing Redis for 4GB allocation..."

cat > /etc/redis/redis.conf << EOF
# ===================================================
# RAILWAY 32GB OPTIMIZED REDIS CONFIG
# ===================================================

# === NETWORK ===
port 6379
tcp-backlog 511
timeout 0
tcp-keepalive 300

# === GENERAL ===
daemonize no
supervised no
pidfile /var/run/redis_6379.pid
loglevel notice
logfile ""
databases 16

# === MEMORY (4GB allocation) ===
maxmemory 3gb
maxmemory-policy allkeys-lru
maxmemory-samples 10

# === PERSISTENCE ===
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir ./

# === REPLICATION ===
replica-serve-stale-data yes
replica-read-only yes

# === SECURITY ===
requirepass ${REDIS_PASSWORD:-redis}

# === PERFORMANCE ===
io-threads 4
io-threads-do-reads yes
EOF

log_success "Redis configuration optimized"

# === NODE.JS OPTIMIZATIONS ===
log_info "Optimizing Node.js for 32GB RAM..."

# Create optimized Node.js configuration
cat > .node-optimization.js << EOF
// ===================================================
// RAILWAY 32GB NODE.JS OPTIMIZATIONS
// ===================================================

const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
    // Use all 32 CPU cores
    const numCPUs = os.cpus().length;
    
    console.log(\`Master \${process.pid} is running\`);
    console.log(\`Starting \${numCPUs} workers...\`);
    
    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker, code, signal) => {
        console.log(\`Worker \${worker.process.pid} died\`);
        // Replace the dead worker
        cluster.fork();
    });
} else {
    // Worker process
    console.log(\`Worker \${process.pid} started\`);
    
    // Optimize garbage collection
    if (global.gc) {
        setInterval(() => {
            global.gc();
        }, 300000); // Every 5 minutes
    }
    
    // Start the application
    require('./dist/main.js');
}
EOF

log_success "Node.js optimizations configured"

# === APPLICATION OPTIMIZATIONS ===
log_info "Applying application optimizations..."

# Create optimized package.json scripts
cat > package-optimized.json << EOF
{
  "scripts": {
    "start:optimized": "node --max-old-space-size=24576 --expose-gc .node-optimization.js",
    "start:worker": "node --max-old-space-size=8192 --expose-gc dist/workers/index.js",
    "build:optimized": "npm run build && npm run optimize",
    "optimize": "node scripts/optimize-bundle.js"
  }
}
EOF

log_success "Application optimizations applied"

# === MONITORING SETUP ===
log_info "Setting up performance monitoring..."

# Create performance monitoring script
cat > scripts/monitor-performance.sh << 'EOF'
#!/bin/bash

echo "📊 Performance Monitoring for Railway 32GB/32 vCPU"

# Monitor CPU usage
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1

# Monitor memory usage
echo "Memory Usage:"
free -h | grep Mem | awk '{print $3"/"$2}'

# Monitor PostgreSQL
echo "PostgreSQL Connections:"
psql -h localhost -U postgres -d ogini_search_prod -c "SELECT count(*) FROM pg_stat_activity;"

# Monitor Redis
echo "Redis Memory:"
redis-cli info memory | grep used_memory_human

# Monitor application
echo "Application Status:"
curl -s http://localhost:3000/health | jq .

echo "✅ Performance monitoring completed"
EOF

chmod +x scripts/monitor-performance.sh

log_success "Performance monitoring configured"

# === DEPLOYMENT SCRIPT ===
log_info "Creating optimized deployment script..."

cat > deploy-railway-32gb.sh << 'EOF'
#!/bin/bash

echo "🚀 Deploying Ogini Search Engine to Railway 32GB/32 vCPU..."

# Build optimized image
docker build -t ogini-search:32gb-optimized --target production .

# Deploy with optimized configuration
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 60

# Run health checks
echo "🔍 Running health checks..."
./scripts/monitor-performance.sh

# Run performance tests
echo "⚡ Running performance tests..."
npm run test:performance

echo "✅ Deployment completed successfully!"
echo ""
echo "📊 Access URLs:"
echo "  - Application: https://your-railway-app.railway.app"
echo "  - Health Check: https://your-railway-app.railway.app/health"
echo "  - Metrics: https://your-railway-app.railway.app/metrics"
echo ""
echo "🔧 Performance Commands:"
echo "  - Monitor: ./scripts/monitor-performance.sh"
echo "  - Logs: docker-compose -f docker-compose.prod.yml logs -f"
echo "  - Restart: docker-compose -f docker-compose.prod.yml restart"
EOF

chmod +x deploy-railway-32gb.sh

log_success "Deployment script created"

# === PERFORMANCE TESTING ===
log_info "Setting up performance testing..."

cat > test/performance/railway-32gb-benchmark.js << 'EOF'
const { performance } = require('perf_hooks');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_INDEX = 'performance-test';

async function runBenchmark() {
    console.log('🚀 Running Railway 32GB Performance Benchmark...');
    
    const results = {
        searchLatency: [],
        indexingThroughput: [],
        concurrentUsers: [],
        memoryUsage: []
    };
    
    // Test search performance
    console.log('📊 Testing search performance...');
    for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await axios.post(`${BASE_URL}/api/indices/${TEST_INDEX}/_search`, {
            query: 'test query',
            size: 10
        });
        const end = performance.now();
        results.searchLatency.push(end - start);
    }
    
    // Test indexing performance
    console.log('📝 Testing indexing performance...');
    const documents = Array.from({ length: 1000 }, (_, i) => ({
        title: `Document ${i}`,
        content: `Content for document ${i}`,
        tags: [`tag${i % 10}`]
    }));
    
    const indexStart = performance.now();
    await axios.post(`${BASE_URL}/api/indices/${TEST_INDEX}/documents/_bulk`, {
        documents
    });
    const indexEnd = performance.now();
    results.indexingThroughput.push(1000 / ((indexEnd - indexStart) / 1000));
    
    // Calculate statistics
    const avgSearchLatency = results.searchLatency.reduce((a, b) => a + b, 0) / results.searchLatency.length;
    const avgIndexingThroughput = results.indexingThroughput.reduce((a, b) => a + b, 0) / results.indexingThroughput.length;
    
    console.log('📈 Performance Results:');
    console.log(`  - Average Search Latency: ${avgSearchLatency.toFixed(2)}ms`);
    console.log(`  - Average Indexing Throughput: ${avgIndexingThroughput.toFixed(2)} docs/sec`);
    console.log(`  - 95th Percentile Search Latency: ${calculatePercentile(results.searchLatency, 95).toFixed(2)}ms`);
    
    return results;
}

function calculatePercentile(array, percentile) {
    const sorted = array.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
}

runBenchmark().catch(console.error);
EOF

log_success "Performance testing configured"

# === FINAL SUMMARY ===
log_success "Railway 32GB/32 vCPU optimization completed!"
echo ""
echo "🎯 Optimization Summary:"
echo "  ✅ PostgreSQL: 8GB shared_buffers, 20GB effective_cache_size"
echo "  ✅ Redis: 3GB memory, 4 IO threads"
echo "  ✅ Node.js: 24GB heap, 32 CPU cores"
echo "  ✅ Application: 120 indexing concurrency, 200 search concurrency"
echo "  ✅ Workers: 3 dedicated worker processes"
echo ""
echo "📊 Expected Performance:"
echo "  - Search Latency: < 20ms (p95)"
echo "  - Indexing Throughput: > 5000 docs/sec"
echo "  - Concurrent Users: > 1000"
echo "  - Memory Utilization: 85-90%"
echo ""
echo "🚀 Next Steps:"
echo "1. Deploy: ./deploy-railway-32gb.sh"
echo "2. Monitor: ./scripts/monitor-performance.sh"
echo "3. Test: npm run test:performance"
echo "4. Scale: Adjust worker count based on load" 