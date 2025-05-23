#!/usr/bin/env node

/**
 * Isolated Component Testing for Memory Leaks
 * 
 * This script tests individual components of the indexing pipeline
 * to isolate memory leak sources.
 */

const { performance } = require('perf_hooks');

// Test configuration
const ITERATIONS = 1000;
const MEMORY_CHECK_INTERVAL = 100;
const FORCE_GC_INTERVAL = 250;

class ComponentTester {
    constructor() {
        this.memoryResults = {};
        this.testResults = [];
    }

    async runAllTests() {
        console.log('🧪 Starting isolated component testing...\n');

        // Test 1: Term Dictionary Memory Management
        await this.testTermDictionary();

        // Test 2: Document Processing
        await this.testDocumentProcessing();

        // Test 3: RocksDB Operations
        await this.testRocksDBOperations();

        // Test 4: Posting Lists
        await this.testPostingLists();

        // Test 5: Combined Indexing Flow
        await this.testCombinedIndexing();

        // Generate summary report
        this.generateSummaryReport();
    }

    async testTermDictionary() {
        console.log('📚 Testing Term Dictionary Memory Management...');

        const startMemory = process.memoryUsage();
        const startTime = performance.now();

        // Simulate term dictionary operations
        const termMap = new Map();
        const termList = new Set();

        for (let i = 0; i < ITERATIONS; i++) {
            const term = `term_${i}_${Math.random().toString(36).substr(2, 9)}`;

            // Simulate adding terms to dictionary
            termMap.set(term, {
                docFreq: Math.floor(Math.random() * 100),
                postings: Array.from({ length: 10 }, (_, j) => ({
                    docId: j,
                    frequency: Math.floor(Math.random() * 5) + 1,
                    positions: Array.from({ length: 3 }, () => Math.floor(Math.random() * 100))
                }))
            });

            termList.add(term);

            // Check memory every 100 iterations
            if (i % MEMORY_CHECK_INTERVAL === 0) {
                const currentMemory = process.memoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > 50 * 1024 * 1024) { // 50MB growth
                    console.log(`⚠️  Memory growth detected at iteration ${i}: ${Math.round(heapGrowth / 1024 / 1024)}MB`);
                }
            }

            // Force GC periodically
            if (i % FORCE_GC_INTERVAL === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = process.memoryUsage();

        this.recordTestResult('Term Dictionary', {
            iterations: ITERATIONS,
            duration: endTime - startTime,
            memoryStart: startMemory,
            memoryEnd: endMemory,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            objectsCreated: termMap.size + termList.size
        });

        // Cleanup
        termMap.clear();
        termList.clear();

        if (global.gc) global.gc();

        console.log(`✅ Term Dictionary test completed in ${Math.round(endTime - startTime)}ms\n`);
    }

    async testDocumentProcessing() {
        console.log('📄 Testing Document Processing...');

        const startMemory = process.memoryUsage();
        const startTime = performance.now();

        const documents = [];

        for (let i = 0; i < ITERATIONS; i++) {
            // Create test document
            const doc = {
                id: `doc_${i}`,
                source: {
                    title: `Document ${i} with some text content`,
                    description: 'This is a test document with various fields for processing',
                    content: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Document ${i} contains multiple terms for analysis.`,
                    tags: ['tag1', 'tag2', 'tag3'],
                    metadata: {
                        createdAt: new Date().toISOString(),
                        category: 'test',
                        priority: Math.floor(Math.random() * 5) + 1
                    }
                }
            };

            // Simulate document processing
            const processedDoc = {
                id: doc.id,
                source: { ...doc.source },
                fields: {},
                fieldLengths: {}
            };

            // Process each field
            for (const [fieldName, fieldValue] of Object.entries(doc.source)) {
                if (typeof fieldValue === 'string') {
                    const terms = fieldValue.toLowerCase().split(/\s+/).filter(term => term.length > 0);
                    const termFrequencies = {};

                    terms.forEach(term => {
                        termFrequencies[term] = (termFrequencies[term] || 0) + 1;
                    });

                    processedDoc.fields[fieldName] = {
                        original: fieldValue,
                        terms,
                        termFrequencies,
                        length: terms.length
                    };

                    processedDoc.fieldLengths[fieldName] = terms.length;
                }
            }

            documents.push(processedDoc);

            // Memory check
            if (i % MEMORY_CHECK_INTERVAL === 0) {
                const currentMemory = process.memoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > 50 * 1024 * 1024) {
                    console.log(`⚠️  Memory growth at iteration ${i}: ${Math.round(heapGrowth / 1024 / 1024)}MB`);
                }
            }

            if (i % FORCE_GC_INTERVAL === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = process.memoryUsage();

        this.recordTestResult('Document Processing', {
            iterations: ITERATIONS,
            duration: endTime - startTime,
            memoryStart: startMemory,
            memoryEnd: endMemory,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            documentsProcessed: documents.length
        });

        // Cleanup
        documents.length = 0;

        if (global.gc) global.gc();

        console.log(`✅ Document Processing test completed in ${Math.round(endTime - startTime)}ms\n`);
    }

    async testRocksDBOperations() {
        console.log('🗄️  Testing RocksDB Operations (Mock)...');

        const startMemory = process.memoryUsage();
        const startTime = performance.now();

        // Mock RocksDB storage
        const mockStorage = new Map();

        for (let i = 0; i < ITERATIONS; i++) {
            const key = `key_${i}`;
            const value = {
                documentId: `doc_${i}`,
                content: `This is document ${i} with some content`,
                metadata: {
                    timestamp: Date.now(),
                    size: Math.floor(Math.random() * 1000) + 100
                }
            };

            // Simulate put operation
            mockStorage.set(key, JSON.stringify(value));

            // Simulate get operation
            const retrieved = mockStorage.get(key);
            if (retrieved) {
                JSON.parse(retrieved);
            }

            // Memory check
            if (i % MEMORY_CHECK_INTERVAL === 0) {
                const currentMemory = process.memoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > 50 * 1024 * 1024) {
                    console.log(`⚠️  Memory growth at iteration ${i}: ${Math.round(heapGrowth / 1024 / 1024)}MB`);
                }
            }

            if (i % FORCE_GC_INTERVAL === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = process.memoryUsage();

        this.recordTestResult('RocksDB Operations', {
            iterations: ITERATIONS,
            duration: endTime - startTime,
            memoryStart: startMemory,
            memoryEnd: endMemory,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            keysStored: mockStorage.size
        });

        // Cleanup
        mockStorage.clear();

        if (global.gc) global.gc();

        console.log(`✅ RocksDB Operations test completed in ${Math.round(endTime - startTime)}ms\n`);
    }

    async testPostingLists() {
        console.log('📋 Testing Posting Lists...');

        const startMemory = process.memoryUsage();
        const startTime = performance.now();

        const postingLists = new Map();

        for (let i = 0; i < ITERATIONS; i++) {
            const term = `term_${i % 100}`; // Reuse some terms

            if (!postingLists.has(term)) {
                postingLists.set(term, {
                    term,
                    postings: []
                });
            }

            const postingList = postingLists.get(term);
            postingList.postings.push({
                docId: `doc_${i}`,
                frequency: Math.floor(Math.random() * 5) + 1,
                positions: Array.from({ length: 3 }, () => Math.floor(Math.random() * 100))
            });

            // Memory check
            if (i % MEMORY_CHECK_INTERVAL === 0) {
                const currentMemory = process.memoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > 50 * 1024 * 1024) {
                    console.log(`⚠️  Memory growth at iteration ${i}: ${Math.round(heapGrowth / 1024 / 1024)}MB`);
                }
            }

            if (i % FORCE_GC_INTERVAL === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = process.memoryUsage();

        this.recordTestResult('Posting Lists', {
            iterations: ITERATIONS,
            duration: endTime - startTime,
            memoryStart: startMemory,
            memoryEnd: endMemory,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            uniqueTerms: postingLists.size,
            totalPostings: Array.from(postingLists.values()).reduce((sum, list) => sum + list.postings.length, 0)
        });

        // Cleanup
        postingLists.clear();

        if (global.gc) global.gc();

        console.log(`✅ Posting Lists test completed in ${Math.round(endTime - startTime)}ms\n`);
    }

    async testCombinedIndexing() {
        console.log('🔄 Testing Combined Indexing Flow...');

        const startMemory = process.memoryUsage();
        const startTime = performance.now();

        // Simulate full indexing pipeline
        const index = {
            documents: new Map(),
            terms: new Map(),
            postings: new Map(),
            stats: { docCount: 0, termCount: 0 }
        };

        for (let i = 0; i < Math.min(ITERATIONS, 500); i++) { // Reduce iterations for combined test
            const docId = `doc_${i}`;
            const doc = {
                title: `Document ${i} title`,
                content: `Content for document ${i} with various terms`,
                tags: ['tag1', 'tag2']
            };

            // 1. Process document
            const processedDoc = {
                id: docId,
                fields: {}
            };

            for (const [field, value] of Object.entries(doc)) {
                const terms = value.toString().toLowerCase().split(/\s+/);
                processedDoc.fields[field] = { terms, termFrequencies: {} };

                terms.forEach(term => {
                    processedDoc.fields[field].termFrequencies[term] =
                        (processedDoc.fields[field].termFrequencies[term] || 0) + 1;
                });
            }

            // 2. Store document
            index.documents.set(docId, processedDoc);

            // 3. Update inverted index
            for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
                for (const term of fieldData.terms) {
                    const termKey = `${field}:${term}`;

                    if (!index.terms.has(termKey)) {
                        index.terms.set(termKey, { docFreq: 0, postings: [] });
                    }

                    const termData = index.terms.get(termKey);
                    termData.docFreq++;
                    termData.postings.push({
                        docId,
                        frequency: fieldData.termFrequencies[term]
                    });
                }
            }

            // 4. Update stats
            index.stats.docCount++;
            index.stats.termCount = index.terms.size;

            // Memory check
            if (i % 50 === 0) {
                const currentMemory = process.memoryUsage();
                const heapGrowth = currentMemory.heapUsed - startMemory.heapUsed;

                if (heapGrowth > 50 * 1024 * 1024) {
                    console.log(`⚠️  Memory growth at iteration ${i}: ${Math.round(heapGrowth / 1024 / 1024)}MB`);
                }
            }

            if (i % 100 === 0 && global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        const endMemory = process.memoryUsage();

        this.recordTestResult('Combined Indexing', {
            iterations: Math.min(ITERATIONS, 500),
            duration: endTime - startTime,
            memoryStart: startMemory,
            memoryEnd: endMemory,
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            documentsIndexed: index.stats.docCount,
            uniqueTerms: index.stats.termCount
        });

        // Cleanup
        index.documents.clear();
        index.terms.clear();
        index.postings.clear();

        if (global.gc) global.gc();

        console.log(`✅ Combined Indexing test completed in ${Math.round(endTime - startTime)}ms\n`);
    }

    recordTestResult(testName, results) {
        const memoryGrowthMB = Math.round(results.memoryGrowth / 1024 / 1024);
        const durationMs = Math.round(results.duration);

        console.log(`📊 ${testName} Results:`);
        console.log(`   - Duration: ${durationMs}ms`);
        console.log(`   - Memory Growth: ${memoryGrowthMB}MB`);
        console.log(`   - Iterations: ${results.iterations}`);

        this.testResults.push({
            testName,
            ...results,
            memoryGrowthMB,
            durationMs
        });
    }

    generateSummaryReport() {
        console.log('\n📋 MEMORY LEAK ANALYSIS SUMMARY');
        console.log('=====================================\n');

        this.testResults.forEach(result => {
            const memoryPerIteration = result.memoryGrowthMB / result.iterations;
            const leakRisk = this.assessLeakRisk(result.memoryGrowthMB, result.iterations);

            console.log(`🧪 ${result.testName}:`);
            console.log(`   Memory Growth: ${result.memoryGrowthMB}MB (${memoryPerIteration.toFixed(3)}MB per operation)`);
            console.log(`   Duration: ${result.durationMs}ms`);
            console.log(`   Leak Risk: ${leakRisk}`);
            console.log('');
        });

        // Identify the most problematic component
        const worstOffender = this.testResults.reduce((worst, current) =>
            current.memoryGrowthMB > worst.memoryGrowthMB ? current : worst
        );

        console.log(`🚨 MOST PROBLEMATIC COMPONENT: ${worstOffender.testName}`);
        console.log(`   Memory Growth: ${worstOffender.memoryGrowthMB}MB`);
        console.log(`   This component should be prioritized for memory optimization.\n`);

        // Recommendations
        this.generateRecommendations();
    }

    assessLeakRisk(memoryGrowthMB, iterations) {
        const memoryPerIteration = memoryGrowthMB / iterations;

        if (memoryPerIteration > 0.1) return '🔴 HIGH';
        if (memoryPerIteration > 0.05) return '🟡 MEDIUM';
        if (memoryPerIteration > 0.01) return '🟠 LOW';
        return '🟢 MINIMAL';
    }

    generateRecommendations() {
        console.log('💡 RECOMMENDATIONS:');
        console.log('==================\n');

        this.testResults.forEach(result => {
            if (result.memoryGrowthMB > 20) {
                console.log(`🔧 ${result.testName}:`);

                if (result.testName.includes('Term Dictionary')) {
                    console.log('   - Implement more aggressive LRU eviction');
                    console.log('   - Use WeakMap for temporary references');
                    console.log('   - Batch persist operations to disk');
                } else if (result.testName.includes('Document Processing')) {
                    console.log('   - Process documents in smaller chunks');
                    console.log('   - Clear intermediate processing objects');
                    console.log('   - Use streaming for large document processing');
                } else if (result.testName.includes('RocksDB')) {
                    console.log('   - Ensure proper connection cleanup');
                    console.log('   - Use batch operations more efficiently');
                    console.log('   - Monitor RocksDB memory usage');
                } else if (result.testName.includes('Combined')) {
                    console.log('   - Add memory pressure monitoring');
                    console.log('   - Implement backpressure in indexing queue');
                    console.log('   - Force GC at regular intervals');
                }
                console.log('');
            }
        });
    }
}

// Run the tests
const tester = new ComponentTester();
tester.runAllTests().catch(console.error); 