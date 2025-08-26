-- =====================================================
-- COMPREHENSIVE POSTGRESQL INDEX OPTIMIZATION
-- =====================================================
-- Fix index size limitations AND cleanup duplicate indexes for optimal performance

-- Step 1: Drop the problematic covering index (if it exists)
DROP INDEX IF EXISTS idx_documents_search_covering_generic;

-- Step 2: Drop old duplicate indexes that are causing performance issues
DROP INDEX IF EXISTS idx_documents_search_vector;

DROP INDEX IF EXISTS idx_documents_materialized_vector;

DROP INDEX IF EXISTS idx_documents_composite_search;

DROP INDEX IF EXISTS idx_documents_index_name;

DROP INDEX IF EXISTS idx_documents_search_vector_optimized;

DROP INDEX IF EXISTS idx_documents_materialized_vector_optimized;

DROP INDEX IF EXISTS idx_documents_non_empty_search;

DROP INDEX IF EXISTS idx_documents_index_name_optimized;

DROP INDEX IF EXISTS idx_documents_search_lightweight_safe;

-- Step 3: Create optimized indexes that don't exceed size limits
CREATE INDEX IF NOT EXISTS idx_documents_basic_lookup ON documents (index_name, document_id);

CREATE INDEX IF NOT EXISTS idx_documents_search_vector_gin ON documents USING GIN (search_vector)
WHERE
    search_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_materialized_vector_gin ON documents USING GIN (materialized_vector)
WHERE
    materialized_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_index_name_filter ON documents (index_name)
WHERE
    search_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_document_id_lookup ON documents (document_id);

CREATE INDEX IF NOT EXISTS idx_documents_search_pattern ON documents (
    index_name,
    document_id,
    created_at
)
WHERE
    search_vector IS NOT NULL;

-- Step 4: Analyze tables to update statistics
ANALYZE documents;

-- Step 5: Show final index list
SELECT 'Final Index List' as info, indexname, tablename
FROM pg_indexes
WHERE
    tablename = 'documents'
ORDER BY indexname;

-- Step 6: Show results
SELECT 'Comprehensive index optimization completed successfully' as status;