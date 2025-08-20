-- Phase 1.1: Advanced GIN Index Optimization
-- This script optimizes existing GIN indexes and creates covering indexes
-- SAFETY: Uses CONCURRENTLY to avoid blocking operations

-- Step 1: Check current index configuration
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE
    tablename = 'search_documents'
    AND indexname LIKE '%search_vector%'
ORDER BY indexname;

-- Step 2: Check if search_vector index exists and its configuration
DO $$
DECLARE
    index_exists boolean;
    current_def text;
BEGIN
    -- Check if the main search_vector index exists
    SELECT EXISTS(
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'search_documents' 
        AND indexname LIKE '%search_vector%'
    ) INTO index_exists;
    
    IF index_exists THEN
        RAISE NOTICE 'Found existing search_vector index';
        
        -- Get current index definition
        SELECT indexdef INTO current_def
        FROM pg_indexes 
        WHERE tablename = 'search_documents' 
        AND indexname LIKE '%search_vector%'
        LIMIT 1;
        
        RAISE NOTICE 'Current index definition: %', current_def;
    ELSE
        RAISE NOTICE 'No search_vector index found - will create optimized version';
    END IF;
END $$;

-- Step 3: Create optimized GIN index with proper configuration
-- Note: Using IF NOT EXISTS to avoid conflicts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_vector_optimized ON search_documents USING GIN (search_vector)
WITH (
        fastupdate = off,
        gin_pending_list_limit = 4194304
    );
-- 4MB

-- Step 4: Create covering index to eliminate heap access
-- This includes commonly accessed columns to avoid table lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_documents_covering ON search_documents (index_name, search_vector) INCLUDE (
    document_id,
    field_weights,
    created_at
);

-- Step 5: Create composite index for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_documents_composite ON search_documents (index_name)
WHERE
    search_vector IS NOT NULL
    AND search_vector != to_tsvector ('english', '');

-- Step 6: Analyze tables to update statistics
ANALYZE search_documents;

-- Step 7: Show final index status
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE
    tablename = 'search_documents'
ORDER BY indexname;

-- Step 8: Show index sizes for monitoring
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
FROM pg_indexes 
WHERE tablename = 'search_documents'
ORDER BY pg_relation_size(indexname::regclass) DESC;