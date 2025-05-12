#!/bin/bash

# Set environment variables
export NODE_ENV=test
export PERFORMANCE_TEST=true
#connect to existing mongodb instance
export MONGODB_URI=mongodb://mongodb:27017/connectsearch


# Wait for MongoDB to be ready
echo "Waiting for MongoDB to be ready..."
sleep 5

# Create performance results directory
mkdir -p performance-results

# Run performance tests
echo "Running performance tests..."
npx jest --config jest.config.js test/performance --json --outputFile=performance-results/results.json

# Generate performance report
echo "Generating performance report..."
node scripts/generate-performance-report.mjs


# Check if tests passed
if [ $? -eq 0 ]; then
  echo "Performance tests completed successfully"
  echo "Results are available in performance-results/"
else
  echo "Performance tests failed"
  exit 1
fi 