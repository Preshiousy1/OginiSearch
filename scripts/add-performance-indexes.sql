-- =====================================================
-- GENERIC PERFORMANCE INDEXES MIGRATION
-- =====================================================
-- This script adds generic optimized indexes for better search performance
-- These optimizations work for ANY index structure, not specific fields

-- Step 1: Add generic performance indexes (field-agnostic)

-- Optimize the existing search_vector index for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_search_vector_optimized ON documents USING GIN (search_vector)
WITH (fastupdate = off);

-- Optimize the materialized_vector index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_materialized_vector_optimized ON documents USING GIN (materialized_vector)
WITH (fastupdate = off);

-- Add a generic covering index for common search patterns (without specific fields)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_search_covering_generic ON documents (index_name, document_id) INCLUDE (
    search_vector,
    materialized_vector
);

-- Add a partial index for documents with non-empty search vectors (faster queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_non_empty_search ON documents USING GIN (search_vector)
WHERE
    search_vector IS NOT NULL
    AND search_vector != to_tsvector ('english', '');

-- Add a generic index for index_name lookups (faster filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_index_name_optimized ON documents (index_name)
WHERE
    search_vector IS NOT NULL;

-- Step 2: Analyze tables to update statistics
ANALYZE documents;

-- Step 3: Verify indexes were created
SELECT indexname, indexdef
FROM pg_indexes
WHERE
    tablename = 'documents'
    AND indexname LIKE 'idx_documents_%'
ORDER BY indexname;

-- Step 4: Show index usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE
    tablename = 'documents'
ORDER BY idx_scan DESC;