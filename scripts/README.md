# Scripts Directory

This directory contains utility scripts for the Ogini Search Engine organized by environment and purpose.

## Directory Structure

```
scripts/
├── development/          # Development environment scripts
│   └── start-debug.sh   # Development server with debug settings
├── production/          # Production environment scripts
│   └── start-optimized.sh # Production server with optimizations
├── testing/             # Testing and validation scripts
│   ├── run-memory-tests.sh # Memory optimization tests
│   └── memory-leak-test.mjs # Memory leak validation
├── cleanup-heap-snapshots.sh # Maintenance script
├── run-performance-tests.sh  # Performance testing
├── verify-coverage.sh        # Coverage validation
└── generate-performance-report.js # Performance reporting
```

## Environment Scripts

### Development Environment

#### `development/start-debug.sh`
Starts the server with development-optimized settings using a build-and-run approach for maximum compatibility:
- 2GB heap size for development
- Verbose logging and debugging
- Memory monitoring enabled
- Trace garbage collection

**Note**: Uses `build + direct execution` instead of NestJS watch mode to avoid module resolution issues with certain dependency versions.

**Usage:**
```bash
npm run dev:start
# or directly:
./scripts/development/start-debug.sh
```

**Settings:**
- Max heap: 2048MB
- Cache size: 5,000 items
- Eviction threshold: 70%
- Memory monitoring: 15s intervals

### Production Environment

#### `production/start-optimized.sh`
Starts the server with production-optimized settings:
- 4GB heap size for production workloads
- Minimal logging for performance
- Optimized memory settings
- Production batch sizes

**Usage:**
```bash
npm run prod:start
# or directly:
./scripts/production/start-optimized.sh
```

**Settings:**
- Max heap: 4096MB
- Cache size: 10,000 items
- Eviction threshold: 80%
- Memory monitoring: 30s intervals

## Testing Scripts

### `testing/run-memory-tests.sh`
Comprehensive memory optimization testing:
- Validates memory leak fixes
- Tests bounded object growth
- Verifies LRU cache behavior
- Runs stress tests with monitoring

**Usage:**
```bash
npm run test:memory
# or directly:
./scripts/testing/run-memory-tests.sh
```

### `testing/memory-leak-test.mjs`
Standalone memory leak validation script:
- Memory-safe serialization tests
- Bounded object growth validation
- LRU cache behavior verification
- Stress testing with real-time monitoring

**Usage:**
```bash
node --expose-gc scripts/testing/memory-leak-test.mjs
```

## Maintenance Scripts

### `cleanup-heap-snapshots.sh`
Automatically cleans up memory profiling artifacts:
- Removes heap snapshots older than 1 day
- Removes CPU profiles older than 1 day
- Removes large profiling files (>10MB) immediately
- Cleans up V8 logs and trace files

**Usage:**
```bash
npm run cleanup:heap
# or directly:
./scripts/cleanup-heap-snapshots.sh
```

**Automatic cleanup rules:**
- ✅ `.heapsnapshot` files: removed after 1 day or if >10MB
- ✅ `.cpuprofile` files: removed after 1 day or if >5MB
- ✅ V8 logs: removed after 1 day
- ✅ Trace files: removed after 3 days
- ✅ Core dumps: removed after 1 day
- ✅ Empty `profiles/` directories: removed immediately

### `verify-coverage.sh`
Validates test coverage meets thresholds:
- Statements: 80%
- Branches: 80%
- Functions: 80%
- Lines: 80%

**Usage:**
```bash
npm run coverage:verify
```

## Performance Scripts

### `run-performance-tests.sh`
Runs performance benchmarks and generates reports:
- Executes Jest performance tests
- Generates JSON results
- Creates HTML and Markdown reports

**Usage:**
```bash
./scripts/run-performance-tests.sh
```

### `generate-performance-report.js`
Generates performance test reports from JSON results:
- Creates HTML dashboard
- Generates Markdown summary
- Handles missing or invalid data

## Docker Integration

All Docker configurations now consistently use npm scripts for maximum maintainability:

### Development (docker-compose.yml)
```yaml
command: npm run dev:start
```
- Uses `development/start-debug.sh` via npm script
- 2GB heap, debug logging, memory monitoring
- Hot reload capabilities with volume mounts

### Production (Dockerfile)
```dockerfile
CMD ["npm", "run", "prod:start"]
```
- Uses `production/start-optimized.sh` via npm script
- 4GB heap, optimized settings, minimal logging
- Multi-stage build with production dependencies only

### Production Compose (docker-compose.prod.yml)
- Uses Dockerfile CMD (npm run prod:start)
- Production-ready MongoDB setup
- Health checks and restart policies
- Persistent volume mounts for data

**Benefits of npm script integration:**
- ✅ **Consistent interface** across all environments
- ✅ **Easy maintenance** - change script logic in one place
- ✅ **Clear documentation** - scripts are defined in package.json
- ✅ **IDE integration** - npm scripts are discoverable in editors

## NPM Script Integration

All scripts are integrated with npm commands:

```json
{
  "scripts": {
    "dev:start": "./scripts/development/start-debug.sh",
    "prod:start": "./scripts/production/start-optimized.sh",
    "test:memory": "./scripts/testing/run-memory-tests.sh",
    "cleanup:heap": "./scripts/cleanup-heap-snapshots.sh",
    "coverage:verify": "./scripts/verify-coverage.sh"
  }
}
```

## Memory Optimization Features

All scripts include memory optimization settings:
- **Memory-Safe Serialization**: Limits object sizes to prevent JSON memory spikes
- **LRU Cache with Pressure Handling**: Automatically evicts old data when memory usage is high
- **Bounded Object Growth**: Limits array sizes, string lengths, and posting list sizes
- **Real-time Memory Monitoring**: Tracks heap usage and triggers cleanup when needed
- **Automatic Profiling Cleanup**: Prevents disk space accumulation from debug files

## Environment-Specific Settings

| Setting | Development | Production | Testing |
|---------|-------------|------------|---------|
| Max Heap | 2048MB | 4096MB | 1024MB |
| Cache Size | 5,000 | 10,000 | 1,000 |
| Eviction Threshold | 70% | 80% | 50% |
| GC Interval | 30s | 60s | 10s |
| Memory Monitoring | 15s | 30s | 5s |
| Logging | Debug | Info | Debug |
| Batch Size | 50 | 100 | 10 |

## Automation Tips

### Cron Job for Automatic Cleanup
```bash
# Clean up profiling files daily at 2 AM
0 2 * * * cd /path/to/ConnectSearch && ./scripts/cleanup-heap-snapshots.sh >> /var/log/ogini-cleanup.log 2>&1
```

### CI/CD Integration
```bash
# Pre-deployment validation
npm run test:memory
npm run coverage:verify
npm run cleanup:heap
```

### Docker Health Checks
All startup scripts are compatible with Docker health checks and container orchestration. 