#!/usr/bin/env node

/**
 * Comprehensive test script for:
 * 1. Worker thread threshold logic (based on actual returned results, not requested size)
 * 2. Cache logging and storage verification
 * 3. Query plan execution time extraction
 *
 * NOTE: Worker threads are now triggered by actual returned results (results.length >= 50),
 * not by requested page size. This is because the database may return many results for
 * ranking even if the requested size is small.
 */

const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const INDEX_NAME = 'businesses';

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    log('\n' + '='.repeat(60), 'cyan');
    log(title, 'bright');
    log('='.repeat(60), 'cyan');
}

async function testWorkerThreadThreshold() {
    logSection('TEST 1: Worker Thread Threshold Logic (Based on Actual Returned Results)');

    const testCases = [
        {
            name: 'Small request (size=10) - workers if DB returns >= 50 results',
            query: 'bakery',
            size: 10,
            note: 'Workers triggered by actual returned results, not requested size',
        },
        {
            name: 'Medium request (size=100) - workers if DB returns >= 50 results',
            query: 'supermarket',
            size: 100,
            note: 'Workers triggered by actual returned results, not requested size',
        },
        {
            name: 'Large request (size=500) - workers if DB returns >= 50 results',
            query: 'electronics',
            size: 500,
            note: 'Workers triggered by actual returned results, not requested size',
        },
        {
            name: 'Very large request (size=1000) - workers if DB returns >= 50 results',
            query: 'furniture',
            size: 1000,
            note: 'Workers triggered by actual returned results, not requested size',
        },
    ];

    const WORKER_THRESHOLD = 50; // Matches RANKING_WORKER_THRESHOLD default

    for (const testCase of testCases) {
        log(`\n📊 Testing: ${testCase.name}`, 'yellow');
        log(`   Query: "${testCase.query}", Requested Size: ${testCase.size}`, 'blue');
        log(`   💡 ${testCase.note}`, 'cyan');

        try {
            const startTime = Date.now();
            const response = await axios.post(
                `${BASE_URL}/api/indices/${INDEX_NAME}/_search`,
                {
                    query: testCase.query,
                    size: testCase.size,
                },
                { timeout: 30000 },
            );

            const duration = Date.now() - startTime;
            const hits = response.data.data?.hits?.length || 0;
            const total = parseInt(response.data.data?.total || '0');

            log(`   ✅ Response received in ${duration}ms`, 'green');
            log(`   📈 Results: ${hits} hits returned, ${total} total in DB`, 'blue');

            // NEW LOGIC: Workers are triggered by actual returned results (hits), not requested size
            const hitsMet = hits >= WORKER_THRESHOLD;
            const totalMet = total >= WORKER_THRESHOLD;
            const shouldUseWorkers = hitsMet || totalMet;

            if (shouldUseWorkers) {
                const reason = hitsMet
                    ? `returned results (${hits} hits >= ${WORKER_THRESHOLD})`
                    : `total results (${total} total >= ${WORKER_THRESHOLD})`;
                log(`   ✅ Expected worker threads (${reason})`, 'green');
                log(
                    `   💡 Check application logs for "Using worker threads" message with reason: "${hitsMet ? `returned results (${hits})` : `total results (${total})`}"`,
                    'cyan',
                );
            } else {
                log(
                    `   ✅ Expected NO worker threads (${hits} hits < ${WORKER_THRESHOLD} AND ${total} total < ${WORKER_THRESHOLD})`,
                    'green',
                );
                log(`   💡 Workers only used when actual returned results >= ${WORKER_THRESHOLD}`, 'cyan');
                log(`   💡 Current: ${hits} hits < ${WORKER_THRESHOLD} threshold, so workers will NOT be used`, 'yellow');
            }

            // Additional info
            if (hits !== testCase.size) {
                log(
                    `   📝 Note: DB returned ${hits} results, but requested size was ${testCase.size}`,
                    'yellow',
                );
                log(`   📝 This is why we check actual results, not requested size!`, 'yellow');
            }
        } catch (error) {
            log(`   ❌ Error: ${error.message}`, 'red');
            if (error.response) {
                log(`   Status: ${error.response.status}`, 'red');
                log(`   Data: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
            }
        }
    }
}

async function testCacheLogging() {
    logSection('TEST 2: Cache Logging and Storage');

    const testQueries = [
        { query: 'gym', size: 10 },
        { query: 'salon', size: 20 },
        { query: 'clinic', size: 15 },
    ];

    log('\n🔄 Step 1: First requests (should be cache MISS)', 'yellow');
    for (const testQuery of testQueries) {
        log(`\n📝 Query: "${testQuery.query}" (size=${testQuery.size})`, 'blue');
        try {
            const startTime = Date.now();
            const response = await axios.post(
                `${BASE_URL}/api/indices/${INDEX_NAME}/_search`,
                testQuery,
                { timeout: 15000 },
            );
            const duration = Date.now() - startTime;
            log(`   ✅ First request: ${duration}ms`, 'green');
            log(`   💡 Check logs for "Cache MISS" message`, 'cyan');
        } catch (error) {
            log(`   ❌ Error: ${error.message}`, 'red');
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
    }

    log('\n🔄 Step 2: Check cache stats', 'yellow');
    try {
        const statsResponse = await axios.get(`${BASE_URL}/debug/cache-stats`);
        const stats = statsResponse.data;
        log(`   📊 Redis keys: ${stats.redis?.keys || 0}`, 'blue');
        log(`   📊 Redis hits: ${stats.redis?.hits || 0}`, 'blue');
        log(`   📊 Redis misses: ${stats.redis?.misses || 0}`, 'blue');
        if (stats.redis?.keys > 0) {
            log(`   ✅ Cache is storing keys!`, 'green');
        } else {
            log(`   ⚠️  No cache keys found - check Redis connection and logs`, 'yellow');
        }
    } catch (error) {
        log(`   ❌ Error getting cache stats: ${error.message}`, 'red');
    }

    log('\n🔄 Step 3: Second requests (should be cache HIT)', 'yellow');
    for (const testQuery of testQueries) {
        log(`\n📝 Query: "${testQuery.query}" (size=${testQuery.size})`, 'blue');
        try {
            const startTime = Date.now();
            const response = await axios.post(
                `${BASE_URL}/api/indices/${INDEX_NAME}/_search`,
                testQuery,
                { timeout: 15000 },
            );
            const duration = Date.now() - startTime;
            log(`   ✅ Second request: ${duration}ms`, 'green');
            if (duration < 100) {
                log(`   🚀 Very fast! Likely cache HIT`, 'green');
            }
            log(`   💡 Check logs for "Cache HIT" message`, 'cyan');
        } catch (error) {
            log(`   ❌ Error: ${error.message}`, 'red');
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
    }

    log('\n🔄 Step 4: Final cache stats', 'yellow');
    try {
        const statsResponse = await axios.get(`${BASE_URL}/debug/cache-stats`);
        const stats = statsResponse.data;
        log(`   📊 Redis keys: ${stats.redis?.keys || 0}`, 'blue');
        log(`   📊 Redis hits: ${stats.redis?.hits || 0}`, 'blue');
        log(`   📊 Redis misses: ${stats.redis?.misses || 0}`, 'blue');
        const hitRate =
            stats.redis?.hits && stats.redis?.misses
                ? ((stats.redis.hits / (stats.redis.hits + stats.redis.misses)) * 100).toFixed(2)
                : '0.00';
        log(`   📊 Cache hit rate: ${hitRate}%`, 'blue');
    } catch (error) {
        log(`   ❌ Error getting cache stats: ${error.message}`, 'red');
    }
}

async function testQueryPlanExtraction() {
    logSection('TEST 3: Query Plan Execution Time Extraction');

    const testQueries = [
        { query: 'barbershop', size: 10 },
        { query: 'laundry', size: 20 },
    ];

    for (const testQuery of testQueries) {
        log(`\n📊 Testing query: "${testQuery.query}" (size=${testQuery.size})`, 'yellow');

        try {
            log(`   🔍 Executing query plan analysis...`, 'blue');
            const response = await axios.post(
                `${BASE_URL}/debug/analyze-query-plan`,
                {
                    query: testQuery.query,
                    indexName: INDEX_NAME,
                    size: testQuery.size,
                },
                { timeout: 30000 },
            );

            const result = response.data;

            if (result.status === 'error') {
                log(`   ❌ Error: ${result.error}`, 'red');
                continue;
            }

            log(`   ✅ Query plan analysis completed`, 'green');
            log(`   📈 Search took: ${result.searchTook}ms`, 'blue');
            log(`   📈 Plan execution time: ${result.planExecutionTime}ms`, 'blue');
            log(`   📈 Plan total cost: ${result.planTotalCost}`, 'blue');

            if (result.planExecutionTime > 0) {
                log(`   ✅ Execution time extracted successfully!`, 'green');
                log(
                    `   📊 Overhead: ${result.analysis.overhead}ms (${result.analysis.overheadPercent}%)`,
                    'blue',
                );
            } else {
                log(`   ⚠️  Execution time is 0 - check query plan parsing`, 'yellow');
                if (result.plan) {
                    log(
                        `   💡 Plan structure: ${JSON.stringify(Object.keys(result.plan || {})).substring(
                            0,
                            100,
                        )}`,
                        'cyan',
                    );
                }
            }

            // Verify plan structure
            if (result.plan) {
                const hasExecutionTime = result.plan['Execution Time'] !== undefined;
                const hasPlan = result.plan['Plan'] !== undefined;
                log(`   🔍 Plan structure check:`, 'blue');
                log(
                    `      - Has 'Execution Time': ${hasExecutionTime}`,
                    hasExecutionTime ? 'green' : 'yellow',
                );
                log(`      - Has 'Plan': ${hasPlan}`, hasPlan ? 'green' : 'yellow');
            } else {
                log(`   ⚠️  No plan data returned`, 'yellow');
            }
        } catch (error) {
            log(`   ❌ Error: ${error.message}`, 'red');
            if (error.response) {
                log(`   Status: ${error.response.status}`, 'red');
                log(`   Data: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
            }
        }
    }
}

async function runAllTests() {
    log('\n🚀 Starting Comprehensive Fix Verification Tests', 'bright');
    log(`   Base URL: ${BASE_URL}`, 'cyan');
    log(`   Index: ${INDEX_NAME}`, 'cyan');

    try {
        // Test 1: Worker thread threshold
        await testWorkerThreadThreshold();

        // Test 2: Cache logging
        await testCacheLogging();

        // Test 3: Query plan extraction
        await testQueryPlanExtraction();

        logSection('✅ ALL TESTS COMPLETED');
        log('\n📋 Summary:', 'bright');
        log(
            '   1. Worker Thread Threshold: Workers triggered by actual returned results (>= 50), not requested size',
            'cyan',
        );
        log(
            '      - Check logs for "Using worker threads" with reason: "returned results (X)"',
            'cyan',
        );
        log(
            '   2. Cache Logging: Check application logs for "Cache SET", "Cache HIT", "Cache MISS" messages',
            'cyan',
        );
        log('   3. Query Plan Extraction: Verify planExecutionTime > 0 in responses', 'cyan');
        log(
            '\n💡 Key Change: Worker threads now check actual DB results (results.length >= 50), not requested page size',
            'yellow',
        );
        log(
            '💡 This ensures workers are used when we actually have many results to rank, regardless of page size',
            'yellow',
        );
    } catch (error) {
        log(`\n❌ Test suite error: ${error.message}`, 'red');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    process.exit(1);
});
