#!/usr/bin/env bash
# Curl-based search API tests against bulk-test-10000.
# For full tests with latency and accuracy assertions, use: npm run test:search-api
# (scripts/testing/test-search-api.ts). This script requires Node to parse JSON.
# Usage: ./scripts/testing/test-search-api.sh [BASE_URL]

set -e
BASE_URL="${1:-http://localhost:3000}"
INDEX="bulk-test-10000"
API="${BASE_URL}/api/indices/${INDEX}/_search"
MAX_MS=200
FAILED=0
PASSED=0
# NestJS Post returns 201 by default; we accept 200 or 201.

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

run_search() {
  local name="$1"
  local body="$2"
  local expected_min_total="${3:-}"
  local start end ms status total took

  start=$(date +%s%3N)
  response=$(curl -s -w "\n%{http_code}" -X POST "${API}?from=0&size=10" \
    -H "accept: application/json" \
    -H "Content-Type: application/json" \
    -d "${body}") || true
  end=$(date +%s%3N)
  ms=$(( end - start ))

  status=$(echo "$response" | tail -n1)
  body_only=$(echo "$response" | sed '$d')
  total=$(echo "$body_only" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try { const j=JSON.parse(d); console.log(j.data?.total ?? -1); } catch(e){ console.log(-2); } });" 2>/dev/null || echo "-1")
  took=$(echo "$body_only" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try { const j=JSON.parse(d); console.log(j.took ?? -1); } catch(e){ console.log(-2); } });" 2>/dev/null || echo "-1")

  if [[ "$status" != "200" && "$status" != "201" ]]; then
    echo -e "${RED}FAIL${NC} $name (HTTP $status)"
    ((FAILED++))
    return 1
  fi
  if [[ "$took" =~ ^[0-9]+$ ]] && [[ "$took" -gt "$MAX_MS" ]]; then
    echo -e "${RED}FAIL${NC} $name (took ${took}ms > ${MAX_MS}ms)"
    ((FAILED++))
    return 1
  fi
  if [[ -n "$expected_min_total" ]] && [[ "$total" =~ ^[0-9]+$ ]] && [[ "$total" -lt "$expected_min_total" ]]; then
    echo -e "${RED}FAIL${NC} $name (total=$total, expected >= $expected_min_total)"
    ((FAILED++))
    return 1
  fi
  echo -e "${GREEN}PASS${NC} $name (total=$total, took=${took}ms)"
  ((PASSED++))
  return 0
}

# Get index document count for accuracy checks (direct list documents)
get_index_total() {
  curl -s "${BASE_URL}/api/indices/${INDEX}/documents?limit=1&offset=0" | \
    node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try { const j=JSON.parse(d); console.log(j.total ?? 0); } catch(e){ console.log(0); } });" 2>/dev/null || echo "0"
}

echo "=============================================="
echo "Search API tests – index: $INDEX, base: $BASE_URL, max latency: ${MAX_MS}ms"
echo "=============================================="

# 1) Match query (field + value) – all 10k docs have "limited" in title
run_search "Match query (title: limited)" \
  '{"query":{"match":{"field":"title","value":"limited"}},"size":10,"from":0}' \
  10000

# 2) Match all documents
run_search "Match all documents" \
  '{"query":{"match_all":{"boost":1.0}},"size":10,"from":0}' \
  10000

# 3) Match all using string query
run_search "Match all (string *)" \
  '{"query":"*","size":10,"from":0}' \
  10000

# 4) Match all using empty string (auto-detected)
run_search "Match all (empty string)" \
  '{"query":{"match":{"value":""}},"size":10,"from":0}'

# 5) Wildcard object – field specified
run_search "Wildcard object (title: lim*)" \
  '{"query":{"wildcard":{"field":"title","value":"lim*"}},"size":10,"from":0}' \
  10000

# 6) Wildcard string – prefix (no field)
run_search "Wildcard string prefix (lim*)" \
  '{"query":"lim*","size":10,"from":0}' \
  1

# 7) Wildcard string – contains
run_search "Wildcard string contains (*limited*)" \
  '{"query":"*limited*","size":10,"from":0}' \
  1

# 8) Wildcard string – suffix
run_search "Wildcard string suffix (*limited)" \
  '{"query":"*limited","size":10,"from":0}' \
  1

# 9) Auto-detected wildcard in match query
run_search "Auto-detected wildcard in match (title: lim*)" \
  '{"query":{"match":{"field":"title","value":"lim*"}},"size":10,"from":0}' \
  1

# 10) Complex wildcard pattern (object)
run_search "Complex wildcard (title smart*phone?)" \
  '{"query":{"wildcard":{"title":{"value":"smart*phone?","boost":1.5}}},"size":10,"from":0}'

# 11) Multiple wildcard characters
run_search "Wildcard multi (PROD-??-*-2024)" \
  '{"query":{"wildcard":{"field":"sku","value":"PROD-??-*-2024"}},"size":10,"from":0}'

# 12) Single character wildcard
run_search "Single char wildcard (activ?)" \
  '{"query":{"wildcard":{"field":"status","value":"activ?"}},"size":10,"from":0}'

# 13) Field-specific wildcard object
run_search "Field-specific wildcard (email *@company.com)" \
  '{"query":{"wildcard":{"email":{"value":"*@company.com","boost":2.0}}},"size":10,"from":0}'

# 14) Term query with filter (term filter)
run_search "Match + term filter (metadata.author)" \
  '{"query":{"match":{"field":"title","value":"limited"}},"filter":{"term":{"field":"metadata.author","value":"user5"}},"size":20,"from":0}' \
  1

# 15) Multi-field search
run_search "Multi-field (value only, fields array)" \
  '{"query":{"match":{"value":"limited"}},"fields":["title","content"],"size":10,"from":0}' \
  10000

# 16) Wildcard across multiple fields
run_search "Wildcard multi-field (smart*)" \
  '{"query":{"match":{"value":"smart*"}},"fields":["title","content","tags"],"size":10,"from":0}'

# 17) Complex query with filter and sort (term filter + sort)
run_search "Complex: wildcard + filter + sort" \
  '{"query":{"wildcard":{"field":"title","value":"*limited*"}},"filter":{"term":{"field":"metadata.author","value":"user0"}},"sort":"metadata.views:asc","size":20,"from":0}' \
  1

# 18) Simple string query (no object) – match word
run_search "String query (limited)" \
  '{"query":"limited","size":10,"from":0}' \
  1

# 19) Pagination: from/size in body
run_search "Pagination (from=100, size=5)" \
  '{"query":{"match":{"field":"title","value":"limited"}},"size":5,"from":100}'

# 20) Wildcard without field – object with value only (if supported)
run_search "Wildcard object value only (*limited*)" \
  '{"query":{"wildcard":{"value":"*limited*"}},"size":10,"from":0}' \
  1

# 21) Match in content (all docs have content)
run_search "Match content (engine)" \
  '{"query":{"match":{"field":"content","value":"engine"}},"size":10,"from":0}' \
  1

# 22) Match in tags
run_search "Match tags" \
  '{"query":{"match":{"field":"tags","value":"data"}},"size":10,"from":0}' \
  1

echo "=============================================="
echo "Results: $PASSED passed, $FAILED failed"
echo "=============================================="
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
