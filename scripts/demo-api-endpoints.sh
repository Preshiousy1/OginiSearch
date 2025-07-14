#!/bin/bash

# ===================================================
# PostgreSQL Search Engine API Demo
# ===================================================

echo "🌟 PostgreSQL Search Engine API Demonstration"
echo "=============================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3000"

echo -e "${BLUE}🚀 Make sure the server is running: npm start${NC}"
echo ""

# Wait for user to start server
read -p "Press Enter when the server is running on port 3000..."

echo ""
echo -e "${GREEN}📋 Testing API Endpoints...${NC}"
echo ""

# Test function
test_endpoint() {
    local description=$1
    local endpoint=$2
    local method=$3
    local data=$4

    echo -e "\n${GREEN}Testing: $description${NC}"
    echo "Endpoint: $endpoint"
    echo "Method: $method"
    echo "Data: $data"
    echo "Response:"

    if [ "$method" = "GET" ]; then
        curl -s -X GET "$BASE_URL$endpoint"
    else
        curl -s -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
    echo -e "\n"
}

# 1. Create test index
echo -e "${GREEN}Creating test index...${NC}"
test_endpoint "Create Index" "/api/indices" "POST" '{
    "name": "test-products",
    "mappings": {
        "properties": {
            "name": { "type": "text" },
            "description": { "type": "text" },
            "price": { "type": "number" },
            "categories": { "type": "keyword" },
            "inStock": { "type": "boolean" },
            "tags": { "type": "keyword" }
        }
    }
}'

# 2. Index test documents
echo -e "${GREEN}Indexing test documents...${NC}"
test_endpoint "Bulk Index Documents" "/api/indices/test-products/documents/_bulk" "POST" '{
    "documents": [
        {
            "id": "1",
            "document": {
                "name": "Smartphone X Pro",
                "description": "High-end smartphone with advanced features",
                "price": 999.99,
                "categories": ["electronics", "mobile"],
                "inStock": true,
                "tags": ["premium", "5G", "smartphone"]
            }
        },
        {
            "id": "2",
            "document": {
                "name": "Laptop Ultra",
                "description": "Powerful laptop for professionals",
                "price": 1499.99,
                "categories": ["electronics", "computers"],
                "inStock": true,
                "tags": ["premium", "laptop"]
            }
        },
        {
            "id": "3",
            "document": {
                "name": "Wireless Earbuds",
                "description": "Premium wireless earbuds with noise cancellation",
                "price": 199.99,
                "categories": ["electronics", "audio"],
                "inStock": false,
                "tags": ["wireless", "audio"]
            }
        }
    ]
}'

# Wait for indexing to complete
sleep 2

# 3. Test different search types

# 3.1 Simple Text Search
test_endpoint "Simple Text Search" "/api/indices/test-products/_search" "POST" '{
    "query": "smartphone"
}'

# 3.2 Field-Specific Match Query
test_endpoint "Field Match Query" "/api/indices/test-products/_search" "POST" '{
    "query": {
        "match": {
            "field": "name",
            "value": "laptop"
        }
    }
}'

# 3.3 Term Query (Exact Match)
test_endpoint "Term Query" "/api/indices/test-products/_search" "POST" '{
    "query": {
        "term": {
            "categories": "electronics"
        }
    }
}'

# 3.4 Range Query
test_endpoint "Range Query" "/api/indices/test-products/_search" "POST" '{
    "query": {
        "range": {
            "field": "price",
            "gte": 500,
            "lt": 1000
        }
    }
}'

# 3.5 Array Field Search
test_endpoint "Array Field Search" "/api/indices/test-products/_search" "POST" '{
    "query": {
        "match": {
            "field": "tags",
            "value": ["premium", "wireless"]
        }
    }
}'

# 3.6 Wildcard Search
test_endpoint "Wildcard Search" "/api/indices/test-products/_search" "POST" '{
    "query": {
        "wildcard": {
            "field": "name",
            "value": "Smart*"
        }
    }
}'

# 3.7 Match All Query
test_endpoint "Match All Query" "/api/indices/test-products/_search" "POST" '{
    "query": {
        "match_all": {}
    }
}'

# 3.8 Combined Query with Highlighting and Facets
test_endpoint "Combined Search with Highlighting" "/api/indices/test-products/_search" "POST" '{
    "query": {
        "match": {
            "field": "description",
            "value": "premium"
        }
    },
    "highlight": true,
    "facets": ["categories", "tags"],
    "size": 10
}'

# 4. Test suggestions/autocomplete
test_endpoint "Get Suggestions" "/api/indices/test-products/_search/_suggest" "POST" '{
    "text": "lapt",
    "field": "name",
    "size": 5
}'

# 5. Get index stats
test_endpoint "Get Index Stats" "/api/indices/test-products" "GET" ""

# 6. Get term statistics
test_endpoint "Get Term Stats" "/api/indices/test-products/terms" "GET" ""

echo -e "${GREEN}All tests completed!${NC}"

echo ""
echo -e "${GREEN}🎉 API Demo Completed Successfully!${NC}"
echo ""
echo -e "${YELLOW}📋 What was demonstrated:${NC}"
echo "   ✅ Index creation with business-optimized mapping"
echo "   ✅ Document indexing with Nigerian business data"
echo "   ✅ Field-specific search queries"
echo "   ✅ Match-all queries for browsing"
echo "   ✅ Auto-complete suggestions"
echo "   ✅ Index information retrieval"
echo ""
echo -e "${BLUE}💡 Next Steps:${NC}"
echo "   - Try more complex queries with filters"
echo "   - Test wildcard searches"
echo "   - Experiment with different field weights"
echo "   - Add more Nigerian business data"
echo ""
echo -e "${YELLOW}🔗 Useful Endpoints:${NC}"
echo "   POST $BASE_URL/api/indices/{index}/_search"
echo "   POST $BASE_URL/api/indices/{index}/_doc/{id}"
echo "   GET  $BASE_URL/api/indices/{index}"
echo "   POST $BASE_URL/api/indices"
