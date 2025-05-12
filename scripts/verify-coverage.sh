#!/bin/bash

# Set coverage thresholds
STATEMENTS_THRESHOLD=80
BRANCHES_THRESHOLD=80
FUNCTIONS_THRESHOLD=80
LINES_THRESHOLD=80

# Run coverage report
echo "Running coverage report..."
npm run test:cov

# Check if coverage meets thresholds
COVERAGE_FILE="coverage/coverage-summary.json"

if [ -f "$COVERAGE_FILE" ]; then
    echo "Checking coverage thresholds..."
    
    # Extract coverage percentages
    STATEMENTS=$(jq -r '.total.statements.pct' "$COVERAGE_FILE")
    BRANCHES=$(jq -r '.total.branches.pct' "$COVERAGE_FILE")
    FUNCTIONS=$(jq -r '.total.functions.pct' "$COVERAGE_FILE")
    LINES=$(jq -r '.total.lines.pct' "$COVERAGE_FILE")
    
    # Check each threshold
    FAILED=0
    
    if (( $(echo "$STATEMENTS < $STATEMENTS_THRESHOLD" | bc -l) )); then
        echo "❌ Statements coverage ($STATEMENTS%) is below threshold ($STATEMENTS_THRESHOLD%)"
        FAILED=1
    else
        echo "✅ Statements coverage: $STATEMENTS%"
    fi
    
    if (( $(echo "$BRANCHES < $BRANCHES_THRESHOLD" | bc -l) )); then
        echo "❌ Branches coverage ($BRANCHES%) is below threshold ($BRANCHES_THRESHOLD%)"
        FAILED=1
    else
        echo "✅ Branches coverage: $BRANCHES%"
    fi
    
    if (( $(echo "$FUNCTIONS < $FUNCTIONS_THRESHOLD" | bc -l) )); then
        echo "❌ Functions coverage ($FUNCTIONS%) is below threshold ($FUNCTIONS_THRESHOLD%)"
        FAILED=1
    else
        echo "✅ Functions coverage: $FUNCTIONS%"
    fi
    
    if (( $(echo "$LINES < $LINES_THRESHOLD" | bc -l) )); then
        echo "❌ Lines coverage ($LINES%) is below threshold ($LINES_THRESHOLD%)"
        FAILED=1
    else
        echo "✅ Lines coverage: $LINES%"
    fi
    
    if [ $FAILED -eq 1 ]; then
        echo "Coverage check failed. Please add more tests."
        exit 1
    else
        echo "All coverage thresholds met!"
    fi
else
    echo "Coverage report not found. Please run tests first."
    exit 1
fi 