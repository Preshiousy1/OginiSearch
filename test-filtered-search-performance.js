#!/usr/bin/env node

/**
 * Filtered Search Performance Test
 * Tests SQL-level limiting and performance for various search scenarios
 */

const test1 = {
    name: "Wildcard Search - Size Limiting Test",
    requests: [
        {
            name: "Size 2",
            query: {
                query: { wildcard: { field: "name", value: "tech*" } },
                size: 2
            }
        },
        {
            name: "Size 5",
            query: {
                query: { wildcard: { field: "name", value: "tech*" } },
                size: 5
            }
        },
        {
            name: "Size 10",
            query: {
                query: { wildcard: { field: "name", value: "tech*" } },
                size: 10
            }
        }
    ]
};

const test2 = {
    name: "Filtered Wildcard Search - Performance Test",
    requests: [
        {
            name: "Simple Filter",
            query: {
                query: { wildcard: { field: "name", value: "smart*" } },
                filter: { bool: { must: [{ term: { field: "is_active", value: true } }] } },
                size: 3
            }
        },
        {
            name: "Complex Filter",
            query: {
                query: { wildcard: { field: "name", value: "tech*" } },
                filter: {
                    bool: {
                        must: [
                            { term: { field: "is_active", value: true } },
                            { term: { field: "is_verified", value: true } }
                        ]
                    }
                },
                size: 5
            }
        }
    ]
};

const test3 = {
    name: "Match vs Wildcard Performance",
    requests: [
        {
            name: "Match Query",
            query: {
                query: { match: { value: "technology" } },
                size: 3
            }
        },
        {
            name: "Wildcard Query",
            query: {
                query: { wildcard: { field: "name", value: "tech*" } },
                size: 3
            }
        }
    ]
};

async function runTest(testSuite) {
    console.log(`\n🧪 ${testSuite.name}`);
    console.log("=".repeat(50));

    for (const request of testSuite.requests) {
        try {
            const start = Date.now();

            const response = await fetch('http://localhost:3000/api/indices/businesses/_search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.query)
            });

            const data = await response.json();
            const clientTime = Date.now() - start;

            if (response.ok) {
                console.log(`✅ ${request.name}:`);
                console.log(`   Hits Returned: ${data.data.hits.length}`);
                console.log(`   Total Available: ${data.data.total}`);
                console.log(`   Server Time: ${data.took}ms`);
                console.log(`   Client Time: ${clientTime}ms`);
                console.log(`   Status: ${response.status}`);

                // Validate SQL-level limiting
                const expectedSize = request.query.size || 10;
                if (data.data.hits.length <= expectedSize) {
                    console.log(`   ✅ SQL Limiting: Correct (≤${expectedSize})`);
                } else {
                    console.log(`   ❌ SQL Limiting: Failed (got ${data.data.hits.length}, expected ≤${expectedSize})`);
                }

            } else {
                console.log(`❌ ${request.name}: HTTP ${response.status}`);
                console.log(`   Error: ${data.message || 'Unknown error'}`);
            }

        } catch (error) {
            console.log(`❌ ${request.name}: ${error.message}`);
        }

        console.log();
    }
}

async function main() {
    console.log("🚀 Filtered Search Performance Test Suite");
    console.log("Testing SQL-level limiting and performance optimization");

    await runTest(test1);
    await runTest(test2);
    await runTest(test3);

    console.log("\n🎯 Performance Targets:");
    console.log("   First-time queries: < 500ms");
    console.log("   Cached queries: < 10ms");
    console.log("   SQL Limiting: Must respect 'size' parameter");
    console.log("   Filter Logic: Must properly apply filters at DB level");
}

main().catch(console.error); 