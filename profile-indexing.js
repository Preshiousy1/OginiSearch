#!/usr/bin/env node

/**
 * Memory Profiling Script for Ogini Indexing Pipeline
 * 
 * This script profiles the memory usage during document indexing
 * to identify memory leaks and bottlenecks.
 */

const inspector = require('inspector');
const fs = require('fs');
const path = require('path');

// Configuration
const PROFILE_DIR = './profiles';
const HEAP_SNAPSHOT_INTERVAL = 5000; // Take heap snapshot every 5 seconds
const ENABLE_CPU_PROFILING = true;
const ENABLE_HEAP_PROFILING = true;

class MemoryProfiler {
    constructor() {
        this.heapSnapshotCount = 0;
        this.profilingStartTime = Date.now();
        this.memoryUsageHistory = [];

        // Ensure profile directory exists
        if (!fs.existsSync(PROFILE_DIR)) {
            fs.mkdirSync(PROFILE_DIR, { recursive: true });
        }
    }

    startProfiling() {
        console.log('🔍 Starting memory profiling...');

        if (ENABLE_CPU_PROFILING) {
            this.startCPUProfiling();
        }

        if (ENABLE_HEAP_PROFILING) {
            this.startHeapProfiling();
        }

        // Monitor memory usage
        this.startMemoryMonitoring();

        // Set up graceful shutdown
        process.on('SIGINT', () => this.stopProfiling());
        process.on('SIGTERM', () => this.stopProfiling());
    }

    startCPUProfiling() {
        console.log('📊 Starting CPU profiling...');
        inspector.open();
        const session = new inspector.Session();
        session.connect();

        session.post('Profiler.enable', () => {
            session.post('Profiler.start', () => {
                console.log('✅ CPU profiling started');

                // Store session for later cleanup
                this.cpuSession = session;
            });
        });
    }

    startHeapProfiling() {
        console.log('💾 Starting heap profiling...');

        // Take initial heap snapshot
        this.takeHeapSnapshot('initial');

        // Take periodic snapshots
        this.heapSnapshotTimer = setInterval(() => {
            this.takeHeapSnapshot(`snapshot-${this.heapSnapshotCount++}`);
        }, HEAP_SNAPSHOT_INTERVAL);
    }

    takeHeapSnapshot(label = 'snapshot') {
        const session = new inspector.Session();
        session.connect();

        session.post('HeapProfiler.enable', () => {
            session.post('HeapProfiler.takeHeapSnapshot', null, (err, data) => {
                if (err) {
                    console.error('❌ Failed to take heap snapshot:', err);
                    return;
                }

                const filename = `${PROFILE_DIR}/heap-${label}-${Date.now()}.heapsnapshot`;
                const writeStream = fs.createWriteStream(filename);

                session.on('HeapProfiler.addHeapSnapshotChunk', (m) => {
                    writeStream.write(m.params.chunk);
                });

                session.on('HeapProfiler.reportHeapSnapshotProgress', (m) => {
                    if (m.params.finished) {
                        writeStream.end();
                        console.log(`📸 Heap snapshot saved: ${filename}`);
                        session.disconnect();
                    }
                });
            });
        });
    }

    startMemoryMonitoring() {
        console.log('📈 Starting memory monitoring...');

        this.memoryTimer = setInterval(() => {
            const memUsage = process.memoryUsage();
            const timestamp = Date.now();

            const usage = {
                timestamp,
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024),
                arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024)
            };

            this.memoryUsageHistory.push(usage);

            // Log memory stats every 10 seconds
            if (this.memoryUsageHistory.length % 10 === 0) {
                console.log(`🧠 Memory: RSS=${usage.rss}MB, Heap=${usage.heapUsed}/${usage.heapTotal}MB, External=${usage.external}MB`);

                // Check for memory leaks (heap growth over time)
                this.detectMemoryLeaks();
            }

            // Save memory history periodically
            if (this.memoryUsageHistory.length % 60 === 0) {
                this.saveMemoryHistory();
            }
        }, 1000);
    }

    detectMemoryLeaks() {
        if (this.memoryUsageHistory.length < 30) return;

        const recent = this.memoryUsageHistory.slice(-30);
        const firstHeap = recent[0].heapUsed;
        const lastHeap = recent[recent.length - 1].heapUsed;
        const growth = lastHeap - firstHeap;
        const growthPercent = (growth / firstHeap) * 100;

        if (growthPercent > 50) {
            console.log(`⚠️  MEMORY LEAK DETECTED: Heap grew by ${growth}MB (${growthPercent.toFixed(1)}%) in 30 seconds`);

            // Take emergency heap snapshot
            this.takeHeapSnapshot('leak-detected');

            // Force garbage collection if available
            if (global.gc) {
                console.log('🗑️  Forcing garbage collection...');
                global.gc();

                setTimeout(() => {
                    const afterGC = process.memoryUsage();
                    console.log(`📊 After GC: Heap=${Math.round(afterGC.heapUsed / 1024 / 1024)}MB`);
                }, 1000);
            }
        }
    }

    saveMemoryHistory() {
        const filename = `${PROFILE_DIR}/memory-history-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(this.memoryUsageHistory, null, 2));
        console.log(`💾 Memory history saved: ${filename}`);
    }

    stopProfiling() {
        console.log('\n🛑 Stopping profiling...');

        // Stop CPU profiling
        if (this.cpuSession) {
            this.cpuSession.post('Profiler.stop', (err, { profile }) => {
                if (err) {
                    console.error('❌ Error stopping CPU profiler:', err);
                    return;
                }

                const cpuFilename = `${PROFILE_DIR}/cpu-profile-${Date.now()}.cpuprofile`;
                fs.writeFileSync(cpuFilename, JSON.stringify(profile));
                console.log(`📊 CPU profile saved: ${cpuFilename}`);

                this.cpuSession.disconnect();
            });
        }

        // Stop heap profiling
        if (this.heapSnapshotTimer) {
            clearInterval(this.heapSnapshotTimer);
            this.takeHeapSnapshot('final');
        }

        // Stop memory monitoring
        if (this.memoryTimer) {
            clearInterval(this.memoryTimer);
            this.saveMemoryHistory();
        }

        // Generate report
        this.generateReport();

        console.log('✅ Profiling stopped. Check the ./profiles directory for results.');
        process.exit(0);
    }

    generateReport() {
        const duration = Date.now() - this.profilingStartTime;
        const report = {
            duration: duration,
            totalSnapshots: this.heapSnapshotCount,
            memoryUsageHistory: this.memoryUsageHistory,
            summary: {
                maxHeapUsed: Math.max(...this.memoryUsageHistory.map(m => m.heapUsed)),
                maxRSS: Math.max(...this.memoryUsageHistory.map(m => m.rss)),
                finalHeapUsed: this.memoryUsageHistory[this.memoryUsageHistory.length - 1]?.heapUsed || 0,
                finalRSS: this.memoryUsageHistory[this.memoryUsageHistory.length - 1]?.rss || 0,
            }
        };

        const reportFilename = `${PROFILE_DIR}/profiling-report-${Date.now()}.json`;
        fs.writeFileSync(reportFilename, JSON.stringify(report, null, 2));
        console.log(`📋 Profiling report saved: ${reportFilename}`);
    }
}

// Start profiling
const profiler = new MemoryProfiler();
profiler.startProfiling();

console.log('🚀 Memory profiler is running. The server will start in 3 seconds...');
console.log('💡 Use Ctrl+C to stop profiling and generate reports.');

// Start the actual Ogini server after a short delay
setTimeout(() => {
    console.log('🌟 Starting Ogini server with profiling...');
    require('./dist/src/main.js');
}, 3000); 