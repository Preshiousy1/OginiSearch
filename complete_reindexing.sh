#!/bin/bash

BASE_URL="https://oginisearch-production.up.railway.app/debug/reindex-search-vectors"
INDEXES=("quote_requests" "listings" "businesses")

echo "🚀 Starting complete reindexing process..."

for index in "${INDEXES[@]}"; do
  echo ""
  echo "=== Processing $index ==="
  
  while true; do
    # Get current status
    result=$(curl -s "$BASE_URL/$index")
    remaining=$(echo "$result" | jq -r '.results.emptyVectorsAfter // 0')
    updated=$(echo "$result" | jq -r '.results.documentsUpdated // 0')
    
    echo "📊 $index: $updated docs updated, $remaining remaining"
    
    # Break if complete or error
    if [ "$remaining" = "0" ] || [ "$remaining" = "null" ] || [ "$updated" = "0" ]; then
      echo "✅ $index reindexing complete!"
      break
    fi
    
    # Small delay between batches
    sleep 2
  done
done

echo ""
echo "🎉 All reindexing complete! Testing search performance..."

# Test search performance
for term in "business*" "tech*" "smart*"; do
  echo -n "Testing $term: "
  result=$(curl -s -X POST "$BASE_URL/../../../api/indices/businesses/_search" \
    -H 'Content-Type: application/json' \
    -d "{\"query\":{\"wildcard\":{\"field\":\"name\",\"value\":\"$term\"}},\"size\":2}")
  took=$(echo "$result" | jq -r '.took // "error"')
  hits=$(echo "$result" | jq -r '.data.hits | length // 0')
  echo "${took}ms, $hits hits"
done

echo "✅ Reindexing process completed successfully!"
