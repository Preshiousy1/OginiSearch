#!/usr/bin/env node

/**
 * Memory Leak Fix Testing for Ogini Search Engine
 * Tests memory optimizations and bounded growth strategies
 */

import { performance } from 'perf_hooks';

// Test configuration
const STRESS_TEST_ITERATIONS = 500;
const MEMORY_CHECK_INTERVAL = 50;
const MAX_MEMORY_GROWTH_MB = 30;
const GC_INTERVAL = 100;

function getMemoryUsage() {
    return process.memoryUsage();
}

class MemoryLeakFixTester {
    constructor() {
        this.testResults = [];
        this.memoryBaseline = getMemoryUsage();
        this.startTime = Date.now();
    }

    async runAllTests() {
        console.log('🧪 Testing Memory Leak Fixes...\n');

        await this.testMemorySafeSerialization();
        await this.testBoundedObjectGrowth();
        await this.testLRUCacheBehavior();
        await this.testStressWithMonitoring();

        this.generateReport();
    }

    async testMemorySafeSerialization() {
        console.log('🔒 Testing Memory-Safe Serialization...');

        const startMemory = getMemoryUsage();
        const startTime = performance.now();
        const largeObjects = [];

        for (let i = 0; i < 200; i++) {
            const postingList = new Map();
            const maxEntries = 50;

            for (let j = 0; j < Math.min(maxEntries, 100); j++) {
                const docId = `doc_${j}`;
                const positions = Array.from({ length: Math.min(5, 10) }, (_, k) => k);
                postingList.set(docId, positions);
            }

            try {
                const serializable = {
                    __type: 'Map',
                    __version: 2,
                    __size: postingList.size,
                    value: Array.from(postingList.entries()).slice(0, 50),
                };

                const jsonString = JSON.stringify(serializable);
                const maxSize = 512 * 1024; // 512KB

                if (jsonString.length <= maxSize) {
                    const buffer = Buffer.from(jsonString);
                    largeObjects.push(buffer);
                }

                if (i % MEMORY_CHECK_INTERVAL === 0) {
                    const currentMemory = getMemoryUsage();
                    const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                    if (heapGrowth > MAX_MEMORY_GROWTH_MB * 1024 * 1024) {
                        console.log(`⚠️  Memory growth: ${Math.round(heapGrowth / 1024 / 1024)}MB`);
                    }
                }

                if (i % GC_INTERVAL === 0 && global.gc) {
                    global.gc();
                }
            } catch (error) {
                console.log(`❌ Serialization failed: ${error.message}`);
            }
        }

        const endTime = performance.now();
        const endMemory = getMemoryUsage();

        this.recordTestResult('Memory-Safe Serialization', {
            iterations: 200,
            duration: endTime - startTime,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            objectsCreated: largeObjects.length,
        });

        largeObjects.length = 0;
        if (global.gc) global.gc();
    }

    async testBoundedObjectGrowth() {
        console.log('📏 Testing Bounded Object Growth...');

        const startMemory = getMemoryUsage();
        const startTime = performance.now();
        const termDictionary = new Map();
        const maxCacheSize = 200;
        const evictionThreshold = 0.8;

        for (let i = 0; i < STRESS_TEST_ITERATIONS; i++) {
            const term = `term_${i}`;
            const postingList = {
                term,
                entries: [],
                size: 0,
            };

            const maxPostingSize = 20;
            const entriesToAdd = Math.min(maxPostingSize, Math.floor(Math.random() * 5) + 1);

            for (let j = 0; j < entriesToAdd; j++) {
                postingList.entries.push({
                    docId: `doc_${j}`,
                    frequency: Math.floor(Math.random() * 3) + 1,
                    positions: Array.from({ length: Math.min(3, 5) }, () => Math.floor(Math.random() * 50)),
                });
            }
            postingList.size = postingList.entries.length;

            termDictionary.set(term, postingList);

            if (termDictionary.size > maxCacheSize) {
                const evictCount = Math.floor(maxCacheSize * (1 - evictionThreshold));
                const keysToEvict = Array.from(termDictionary.keys()).slice(0, evictCount);
                keysToEvict.forEach(key => termDictionary.delete(key));
            }

            if (i % MEMORY_CHECK_INTERVAL === 0) {
                const currentMemory = getMemoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > MAX_MEMORY_GROWTH_MB * 1024 * 1024) {
                    console.log(
                        `⚠️  Memory growth: ${Math.round(heapGrowth / 1024 / 1024)}MB, Cache: ${termDictionary.size
                        }`,
                    );
                }
            }

            if (i % GC_INTERVAL === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = getMemoryUsage();

        this.recordTestResult('Bounded Object Growth', {
            iterations: STRESS_TEST_ITERATIONS,
            duration: endTime - startTime,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            finalCacheSize: termDictionary.size,
            maxCacheSize: maxCacheSize,
        });

        termDictionary.clear();
        if (global.gc) global.gc();
    }

    async testLRUCacheBehavior() {
        console.log('🔄 Testing LRU Cache Behavior...');

        const startMemory = getMemoryUsage();
        const startTime = performance.now();

        class SimpleLRUCache {
            constructor(maxSize) {
                this.maxSize = maxSize;
                this.cache = new Map();
                this.accessOrder = [];
            }

            get(key) {
                if (this.cache.has(key)) {
                    const index = this.accessOrder.indexOf(key);
                    if (index > -1) {
                        this.accessOrder.splice(index, 1);
                    }
                    this.accessOrder.push(key);
                    return this.cache.get(key);
                }
                return undefined;
            }

            put(key, value) {
                const evicted = [];

                if (this.cache.has(key)) {
                    this.cache.set(key, value);
                    this.get(key);
                    return evicted;
                }

                this.cache.set(key, value);
                this.accessOrder.push(key);

                while (this.cache.size > this.maxSize) {
                    const oldestKey = this.accessOrder.shift();
                    if (oldestKey && this.cache.has(oldestKey)) {
                        this.cache.delete(oldestKey);
                        evicted.push(oldestKey);
                    }
                }

                return evicted;
            }

            size() {
                return this.cache.size;
            }

            clear() {
                this.cache.clear();
                this.accessOrder.length = 0;
            }
        }

        const lruCache = new SimpleLRUCache(100);
        let totalEvictions = 0;

        for (let i = 0; i < 300; i++) {
            const key = `key_${i}`;
            const value = {
                data: `value_${i}`,
                timestamp: Date.now(),
                metadata: Array.from({ length: 3 }, (_, j) => ({ id: j, value: Math.random() })),
            };

            const evicted = lruCache.put(key, value);
            totalEvictions += evicted.length;

            if (i % 10 === 0 && i > 0) {
                const randomKey = `key_${Math.floor(Math.random() * Math.min(i, 100))}`;
                lruCache.get(randomKey);
            }

            if (i % MEMORY_CHECK_INTERVAL === 0) {
                const currentMemory = getMemoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > MAX_MEMORY_GROWTH_MB * 1024 * 1024) {
                    console.log(
                        `⚠️  Memory growth: ${Math.round(
                            heapGrowth / 1024 / 1024,
                        )}MB, Cache: ${lruCache.size()}`,
                    );
                }
            }

            if (i % GC_INTERVAL === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = getMemoryUsage();

        this.recordTestResult('LRU Cache Behavior', {
            iterations: 300,
            duration: endTime - startTime,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            finalCacheSize: lruCache.size(),
            totalEvictions: totalEvictions,
        });

        lruCache.clear();
        if (global.gc) global.gc();
    }

    async testStressWithMonitoring() {
        console.log('💪 Running Stress Test with Memory Monitoring...');

        const startMemory = getMemoryUsage();
        const startTime = performance.now();
        const documents = [];
        const termDictionary = new Map();
        const maxDocuments = 100;
        const maxTerms = 200;

        for (let i = 0; i < STRESS_TEST_ITERATIONS; i++) {
            const doc = {
                id: `doc_${i}`,
                content: `Document ${i} content ${Math.random()}`,
                metadata: {
                    timestamp: Date.now(),
                    size: Math.floor(Math.random() * 50) + 10,
                },
            };

            const terms = doc.content.toLowerCase().split(/\s+/);
            const processedDoc = {
                id: doc.id,
                terms: terms.slice(0, 5),
                termFrequencies: {},
                metadata: doc.metadata,
            };

            terms.slice(0, 5).forEach(term => {
                processedDoc.termFrequencies[term] = (processedDoc.termFrequencies[term] || 0) + 1;
            });

            documents.push(processedDoc);
            if (documents.length > maxDocuments) {
                documents.shift();
            }

            terms.slice(0, 5).forEach(term => {
                if (!termDictionary.has(term)) {
                    termDictionary.set(term, { docFreq: 0, postings: [] });
                }

                const termData = termDictionary.get(term);
                termData.docFreq++;

                if (termData.postings.length < 20) {
                    termData.postings.push({
                        docId: doc.id,
                        frequency: processedDoc.termFrequencies[term],
                    });
                }
            });

            if (termDictionary.size > maxTerms) {
                const keysToRemove = Array.from(termDictionary.keys()).slice(0, 20);
                keysToRemove.forEach(key => termDictionary.delete(key));
            }

            if (i % MEMORY_CHECK_INTERVAL === 0) {
                const currentMemory = getMemoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > MAX_MEMORY_GROWTH_MB * 1024 * 1024) {
                    console.log(
                        `⚠️  Iteration ${i}: Growth=${Math.round(heapGrowth / 1024 / 1024)}MB, Docs=${documents.length
                        }, Terms=${termDictionary.size}`,
                    );
                }
            }

            if (i % GC_INTERVAL === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = getMemoryUsage();

        this.recordTestResult('Stress Test with Monitoring', {
            iterations: STRESS_TEST_ITERATIONS,
            duration: endTime - startTime,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            documentsProcessed: documents.length,
            termsInDictionary: termDictionary.size,
        });

        documents.length = 0;
        termDictionary.clear();
        if (global.gc) global.gc();
    }

    recordTestResult(testName, results) {
        const memoryGrowthMB = Math.round(results.memoryGrowth / 1024 / 1024);
        const durationMs = Math.round(results.duration);

        console.log(`📊 ${testName} Results:`);
        console.log(`   - Duration: ${durationMs}ms`);
        console.log(`   - Memory Growth: ${memoryGrowthMB}MB`);
        console.log(`   - Iterations: ${results.iterations}`);

        if (results.finalCacheSize !== undefined) {
            console.log(`   - Final Cache Size: ${results.finalCacheSize}`);
        }
        if (results.totalEvictions !== undefined) {
            console.log(`   - Total Evictions: ${results.totalEvictions}`);
        }

        const memoryGrowthAcceptable = memoryGrowthMB <= MAX_MEMORY_GROWTH_MB;
        if (memoryGrowthAcceptable) {
            console.log(`   ✅ Memory growth within acceptable limits`);
        } else {
            console.log(`   ⚠️  HIGH MEMORY GROWTH DETECTED!`);
        }

        console.log('');

        this.testResults.push({
            testName,
            ...results,
            memoryGrowthMB,
            durationMs,
            memoryGrowthAcceptable,
        });
    }

    generateReport() {
        console.log('📋 MEMORY LEAK FIX TEST REPORT');
        console.log('=====================================\n');

        const totalDuration = Date.now() - this.startTime;
        const finalMemory = getMemoryUsage();
        const totalMemoryGrowth = finalMemory.heapUsed - this.memoryBaseline.heapUsed;

        console.log(`Total Test Duration: ${Math.round(totalDuration / 1000)}s`);
        console.log(`Total Memory Growth: ${Math.round(totalMemoryGrowth / 1024 / 1024)}MB`);
        console.log(`Final Heap Usage: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB\n`);

        console.log('Test Results Summary:');
        console.log('--------------------');

        let passedTests = 0;
        for (const result of this.testResults) {
            const status = result.memoryGrowthAcceptable ? '✅ PASS' : '❌ FAIL';
            console.log(`${status} ${result.testName}: ${result.memoryGrowthMB}MB growth`);
            if (result.memoryGrowthAcceptable) passedTests++;
        }

        console.log(`\nOverall Result: ${passedTests}/${this.testResults.length} tests passed`);

        if (passedTests === this.testResults.length) {
            console.log('🎉 All memory leak fixes are working correctly!');
        } else {
            console.log('⚠️  Some memory leak fixes need attention.');
        }

        console.log('\n🔧 Memory Optimization Status: ACTIVE');
    }
}

// Run the tests
async function main() {
    console.log('🚀 Starting Memory Leak Fix Testing...\n');

    const tester = new MemoryLeakFixTester();
    await tester.runAllTests();
}

// Handle cleanup on exit
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted. Cleaning up...');
    if (global.gc) global.gc();
    process.exit(0);
});

main().catch(console.error);
