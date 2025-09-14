/* eslint-disable @typescript-eslint/no-var-requires */
const { parentPort, workerData } = require('worker_threads');

/**
 * Worker thread for processing typo tolerance calculations
 * This runs in parallel to avoid blocking the main search thread
 */
async function processFieldForTypoTolerance(indexName, field, query) {
    try {
        // Simulate the similarity calculation that would normally be done in the main thread
        // In a real implementation, this would use a database connection or similarity library

        // For now, return a simple result to demonstrate the worker pattern
        const mockResults = [`${field}_term_1`, `${field}_term_2`, `${field}_term_3`];

        return mockResults;
    } catch (error) {
        console.error(`Worker error for field ${field}:`, error.message);
        return [];
    }
}

// Process the field and send result back to main thread
const { indexName, field, query } = workerData;
processFieldForTypoTolerance(indexName, field, query)
    .then(result => {
        parentPort.postMessage(result);
    })
    .catch(error => {
        parentPort.postMessage([]);
    });
