#!/bin/bash

# Continuous reindexing script for businesses index
BASE_URL="https://oginisearch-production.up.railway.app/debug/reindex-search-vectors/businesses"

echo "🚀 Starting continuous reindexing for businesses..."

# Get initial status
initial_result=$(curl -s "$BASE_URL")
initial_remaining=$(echo "$initial_result" | jq -r '.results.emptyVectorsAfter')
total_docs=$(echo "$initial_result" | jq -r '.results.totalDocuments')

echo "Initial status: $initial_remaining remaining out of $total_docs total"
echo ""

batch_count=0
start_time=$(date +%s)

while true; do
    batch_count=$((batch_count + 1))
    
    # Run reindexing batch
    result=$(curl -s "$BASE_URL")
    remaining=$(echo "$result" | jq -r '.results.emptyVectorsAfter // 0')
    updated=$(echo "$result" | jq -r '.results.documentsUpdated // 0')
    
    # Calculate progress
    completed=$((total_docs - remaining))
    percent=$(echo "scale=2; $completed * 100 / $total_docs" | bc)
    
    echo "Batch $batch_count: Updated $updated docs | $completed/$total_docs ($percent%) | $remaining remaining"
    
    # Check completion
    if [ "$remaining" = "0" ]; then
        echo ""
        echo "🎉 Businesses reindexing COMPLETE!"
        break
    fi
    
    # Check if no progress
    if [ "$updated" = "0" ]; then
        echo "⚠️  No documents updated, stopping..."
        break
    fi
    
    # Progress summary every 20 batches
    if [ $((batch_count % 20)) = 0 ]; then
        current_time=$(date +%s)
        elapsed=$((current_time - start_time))
        docs_per_second=$(echo "scale=2; ($total_docs - $initial_remaining + $completed - ($total_docs - $initial_remaining)) / $elapsed" | bc)
        estimated_remaining_seconds=$(echo "scale=0; $remaining / ($docs_per_second + 1)" | bc)
        
        echo ""
        echo "📊 Progress Summary:"
        echo "   • Batches completed: $batch_count"
        echo "   • Time elapsed: ${elapsed}s"
        echo "   • Estimated completion: ~${estimated_remaining_seconds}s"
        echo ""
    fi
    
    # Small delay between batches
    sleep 1
done

# Final summary
end_time=$(date +%s)
total_time=$((end_time - start_time))
echo ""
echo "✅ Reindexing completed in $total_time seconds with $batch_count batches"
echo "📊 Final status:"
curl -s "$BASE_URL" | jq '{completed: (.results.totalDocuments - .results.emptyVectorsAfter), total: .results.totalDocuments, percent: ((.results.totalDocuments - .results.emptyVectorsAfter) * 100 / .results.totalDocuments)}' 