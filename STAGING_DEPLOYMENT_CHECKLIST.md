# Staging Deployment Checklist - Typo Tolerance Optimizations

## Overview
This checklist ensures all database optimizations are properly deployed on staging to achieve the 10ms typo tolerance performance target.

## Prerequisites
- [ ] Staging environment is running
- [ ] Database connection is healthy
- [ ] All code changes have been deployed

## Database Optimization Deployment Steps

### 1. Fix Index Size Limitations (CRITICAL - Run First)
```bash
curl -X POST http://staging-url/debug/fix-index-size-limitation
```
**Purpose**: Resolves "index row size exceeds btree version 4 maximum" errors and removes conflicting indexes.

### 2. Setup Typo Tolerance Optimization (CORE OPTIMIZATION)
```bash
curl -X POST http://staging-url/debug/setup-typo-tolerance-optimization
```
**Purpose**: Creates the materialized view (`search_terms`) and database functions for ultra-fast typo tolerance.

### 3. Add Missing Typo Functions (BACKUP FUNCTIONS)
```bash
curl -X POST http://staging-url/debug/add-typo-functions
```
**Purpose**: Adds the `fast_similarity_search` and `get_index_typo_stats` functions with optimized parameters.

### 4. Refresh Materialized View (DATA SYNC)
```bash
curl -X POST http://staging-url/debug/refresh-typo-tolerance-view
```
**Purpose**: Ensures the materialized view contains the latest document data.

## Verification Steps

### 5. Check Database Health
```bash
curl http://staging-url/debug/health/businesses
```
**Expected**: Should show document counts and table/index information.

### 6. Verify Typo Tolerance Statistics
```bash
curl http://staging-url/debug/typo-tolerance-stats/businesses
```
**Expected**: Should show term counts, frequencies, and top terms for the businesses index.

### 7. Test Typo Tolerance Performance
```bash
curl -X POST http://staging-url/debug/test-typo-tolerance \
  -H "Content-Type: application/json" \
  -d '{"indexName": "businesses", "query": "bannk"}'
```
**Expected**: Should return corrections in ~20-25ms with "bank" as a suggestion.

## Performance Targets
- **Typo tolerance response time**: ≤ 25ms (target: 10ms)
- **SymSpell initialization**: Should complete at startup
- **Cache hit rate**: Should be high for repeated queries

## Troubleshooting

### If Step 1 Fails
- Check PostgreSQL logs for specific index errors
- May need to manually drop problematic indexes first

### If Step 2 Fails
- Verify PostgreSQL extensions are enabled (`pg_trgm`, `btree_gin`)
- Check if `search_terms` materialized view already exists

### If Step 3 Fails
- Functions may already exist, this is usually safe to skip
- Check PostgreSQL function creation permissions

### If Performance is Still Slow
- Verify materialized view was refreshed after data changes
- Check if SymSpell indexes are being built at startup (check logs)
- Ensure database has sufficient memory allocated

## Post-Deployment Monitoring

### Key Metrics to Monitor
1. **Response Times**: Typo tolerance should be < 25ms
2. **Error Rates**: Should be minimal
3. **Cache Performance**: High hit rates for repeated queries
4. **Database Load**: Should be optimized with materialized views

### Log Messages to Watch For
- `✅ SymSpell indexes initialized in Xms`
- `⚡ SymSpell correction completed in Xms`
- `📊 Indexes built: X` (where X > 0)

## Rollback Plan (If Needed)
If issues occur, you can:
1. Drop the materialized view: `DROP MATERIALIZED VIEW IF EXISTS search_terms;`
2. Remove functions: `DROP FUNCTION IF EXISTS fast_similarity_search;`
3. The system will fallback to the spell-checker service

## Success Criteria
- [ ] All 4 deployment steps complete successfully
- [ ] Typo tolerance response times ≤ 25ms
- [ ] SymSpell indexes built at startup
- [ ] Materialized view contains expected term counts
- [ ] Test queries return relevant corrections

## Notes
- The system now uses **mnemonist SymSpell** for ultra-fast corrections
- **Startup initialization** builds indexes once for optimal performance
- **Fallback to spell-checker** ensures reliability if SymSpell fails
- **Generic implementation** works for any index without hardcoded values
