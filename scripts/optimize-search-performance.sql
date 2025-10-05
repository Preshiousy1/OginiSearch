-- Performance optimization for field-weighted search queries
-- This script adds indexes to improve search performance
-- Safe for production deployment on staging and live environments

-- Ensure required extensions are available
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Create GIN indexes on JSON fields for faster ILIKE operations
-- These indexes will significantly improve search performance for field-weighted queries

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_name_gin ON documents USING GIN (
    (content ->> 'name') gin_trgm_ops
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_title_gin ON documents USING GIN (
    (content ->> 'title') gin_trgm_ops
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_category_gin ON documents USING GIN (
    (content ->> 'category_name') gin_trgm_ops
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_subcategory_gin ON documents USING GIN (
    (
        content ->> 'sub_category_name'
    ) gin_trgm_ops
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_description_gin ON documents USING GIN (
    (content ->> 'description') gin_trgm_ops
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_tags_gin ON documents USING GIN (
    (content ->> 'tags') gin_trgm_ops
);

-- Create composite indexes for common search patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_search_optimized ON documents (index_name, document_id)
WHERE
    search_vector IS NOT NULL;

-- Create partial indexes for active documents
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_active_search ON documents (index_name, document_id)
WHERE
    search_vector IS NOT NULL
    AND content ->> 'is_active' = 'true';

-- Optimize the search_vector index
DROP INDEX IF EXISTS idx_documents_search_vector;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_search_vector_optimized ON documents USING GIN (search_vector)
WITH (fastupdate = off);

-- Create index for materialized_vector if it exists
DROP INDEX IF EXISTS idx_documents_materialized_vector;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_materialized_vector_optimized ON documents USING GIN (materialized_vector)
WITH (fastupdate = off);

-- Analyze tables to update statistics
ANALYZE documents;

-- Show index usage statistics
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