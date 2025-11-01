-- ================================================================
-- COMPLETE SEARCH ENGINE OPTIMIZATION SCRIPT
-- ================================================================
-- Purpose: Comprehensive database optimization for sub-200ms search
-- Version: 2.0
-- Date: October 28, 2025
-- Estimated Runtime: 2-4 hours for 600K documents
-- ================================================================

-- SAFETY: This script uses CONCURRENTLY where possible to avoid locks
-- Run during low-traffic period if possible

\timing on \set ON_ERROR_STOP on

BEGIN;

-- ================================================================
-- SECTION 1: EXTENSIONS AND PREREQUISITES
-- ================================================================

DO $$ 
BEGIN
    RAISE NOTICE '🚀 Starting Complete Search Optimization';
    RAISE NOTICE 'Time: %', clock_timestamp();
END $$;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Configure PostgreSQL for better search performance
ALTER SYSTEM SET shared_buffers = '4GB';

ALTER SYSTEM SET effective_cache_size = '12GB';

ALTER SYSTEM SET maintenance_work_mem = '1GB';

ALTER SYSTEM SET work_mem = '50MB';

ALTER SYSTEM SET random_page_cost = 1.1;

ALTER SYSTEM SET effective_io_concurrency = 200;

ALTER SYSTEM SET max_parallel_workers_per_gather = 4;

ALTER SYSTEM SET max_parallel_workers = 8;

ALTER SYSTEM SET max_worker_processes = 8;

-- Note: Requires PostgreSQL restart to take effect
-- Run: SELECT pg_reload_conf(); -- to reload without restart

COMMIT;

-- ================================================================
-- SECTION 2: ADD MISSING COLUMNS (GENERATED/MATERIALIZED)
-- ================================================================

DO $$ 
BEGIN
    RAISE NOTICE '📊 Adding materialized columns for faster queries...';
END $$;

BEGIN;

-- Add weighted search vector column if not exists
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS weighted_search_vector tsvector;

-- Add materialized search vector (for complex field-weighted ranking)
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS materialized_vector tsvector;

-- Add dedicated search columns (extracted from JSONB for performance)
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS name TEXT GENERATED ALWAYS AS (content ->> 'name') STORED;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS category TEXT GENERATED ALWAYS AS (content ->> 'category_name') STORED;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS description TEXT GENERATED ALWAYS AS (content ->> 'description') STORED;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS location TEXT GENERATED ALWAYS AS (content ->> 'location_text') STORED;

-- Add materialized boolean filter columns
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS is_active boolean 
  GENERATED ALWAYS AS ((content->>'is_active')::boolean) STORED;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS is_verified boolean 
  GENERATED ALWAYS AS ((content->>'is_verified')::boolean) STORED;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS is_blocked boolean 
  GENERATED ALWAYS AS ((content->>'is_blocked')::boolean) STORED;

-- Add timestamp for better cache management
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

COMMIT;

-- ================================================================
-- SECTION 3: SEARCH VECTOR GENERATION FUNCTIONS
-- ================================================================

DO $$ 
BEGIN
    RAISE NOTICE '⚙️ Creating search vector generation functions...';
END $$;

BEGIN;

-- Function to generate field-weighted search vectors
CREATE OR REPLACE FUNCTION generate_weighted_search_vector(
    index_name_param text,
    content_data jsonb
) RETURNS tsvector AS $$
BEGIN
    RETURN 
        -- A-weight (highest priority): name and title fields
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'name', '')), 'A'), ''::tsvector) ||
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'title', '')), 'A'), ''::tsvector) ||
        -- B-weight (high priority): category fields  
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'category_name', '')), 'B'), ''::tsvector) ||
        COALESCE(setweight(to_tsvector('english', 
            CASE 
                WHEN jsonb_typeof(content_data->'sub_category_name') = 'array' 
                THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(content_data->'sub_category_name')), ' ')
                ELSE COALESCE(content_data->>'sub_category_name', '')
            END
        ), 'B'), ''::tsvector) ||
        -- C-weight (medium priority): description and location
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'description', '')), 'C'), ''::tsvector) ||
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'location_text', '')), 'C'), ''::tsvector) ||
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'profile', '')), 'C'), ''::tsvector) ||
        -- D-weight (lowest priority): tags and other fields
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'tags', '')), 'D'), ''::tsvector);
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Function to generate simple search vector (fallback)
CREATE OR REPLACE FUNCTION generate_simple_search_vector(
    content_data jsonb
) RETURNS tsvector AS $$
BEGIN
    RETURN to_tsvector('english',
        COALESCE(content_data->>'name', '') || ' ' ||
        COALESCE(content_data->>'title', '') || ' ' ||
        COALESCE(content_data->>'category_name', '') || ' ' ||
        COALESCE(content_data->>'description', '') || ' ' ||
        COALESCE(content_data->>'tags', '')
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Trigger function for automatic vector updates
CREATE OR REPLACE FUNCTION update_document_search_vectors() RETURNS trigger AS $$
BEGIN
    NEW.weighted_search_vector := generate_weighted_search_vector(NEW.index_name, NEW.content);
    NEW.search_vector := generate_simple_search_vector(NEW.content);
    NEW.materialized_vector := NEW.weighted_search_vector; -- Copy for fallback
    NEW.last_modified_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS update_search_vectors_trigger ON documents;

-- Create new trigger
CREATE TRIGGER update_search_vectors_trigger
    BEFORE INSERT OR UPDATE OF content, index_name ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_document_search_vectors();

COMMIT;

-- ================================================================
-- SECTION 4: POPULATE SEARCH VECTORS (BATCH PROCESSING)
-- ================================================================

DO $$ 
DECLARE
    batch_size INT := 10000;
    total_rows BIGINT;
    processed_rows BIGINT := 0;
    start_time TIMESTAMP;
BEGIN
    RAISE NOTICE '🔄 Populating search vectors in batches...';
    start_time := clock_timestamp();
    
    SELECT COUNT(*) INTO total_rows FROM documents WHERE weighted_search_vector IS NULL;
    RAISE NOTICE 'Total documents to process: %', total_rows;
    
    WHILE EXISTS (SELECT 1 FROM documents WHERE weighted_search_vector IS NULL LIMIT 1) LOOP
        UPDATE documents
        SET 
            weighted_search_vector = generate_weighted_search_vector(index_name, content),
            search_vector = generate_simple_search_vector(content),
            materialized_vector = generate_weighted_search_vector(index_name, content),
            last_modified_at = CURRENT_TIMESTAMP
        WHERE document_id IN (
            SELECT document_id 
            FROM documents 
            WHERE weighted_search_vector IS NULL 
            LIMIT batch_size
        );
        
        processed_rows := processed_rows + batch_size;
        RAISE NOTICE 'Processed % of % documents (%.1f%%) - Elapsed: %', 
            LEAST(processed_rows, total_rows), 
            total_rows,
            (LEAST(processed_rows, total_rows)::FLOAT / NULLIF(total_rows, 0) * 100),
            age(clock_timestamp(), start_time);
        
        -- Brief pause to avoid overwhelming the system
        PERFORM pg_sleep(0.1);
    END LOOP;
    
    RAISE NOTICE '✅ Vector population complete! Total time: %', age(clock_timestamp(), start_time);
END $$;

-- ================================================================
-- SECTION 5: CREATE OPTIMIZED INDEXES
-- ================================================================

DO $$ 
BEGIN
    RAISE NOTICE '🔨 Creating optimized indexes (this may take 30-60 minutes)...';
    RAISE NOTICE 'Using CONCURRENTLY to avoid locking table';
END $$;

-- 5.1: PRIMARY SEARCH INDEXES (MOST CRITICAL)

-- GIN index on weighted search vector (PRIMARY)
DROP INDEX IF EXISTS idx_documents_weighted_search_vector;

CREATE INDEX CONCURRENTLY idx_documents_weighted_search_vector ON documents USING GIN (weighted_search_vector)
WITH (fastupdate = off);

-- GIN index on regular search vector (FALLBACK)
DROP INDEX IF EXISTS idx_documents_search_vector;

CREATE INDEX CONCURRENTLY idx_documents_search_vector ON documents USING GIN (search_vector)
WITH (fastupdate = off);

-- GIN index on materialized vector (BACKUP)
DROP INDEX IF EXISTS idx_documents_materialized_vector;

CREATE INDEX CONCURRENTLY idx_documents_materialized_vector ON documents USING GIN (materialized_vector)
WITH (fastupdate = off);

-- 5.2: FILTER INDEXES (CRITICAL FOR PERFORMANCE)

-- Partial indexes for active/verified documents (most common query)
DROP INDEX IF EXISTS idx_documents_active_verified;

CREATE INDEX CONCURRENTLY idx_documents_active_verified ON documents (
    index_name,
    is_active,
    is_verified,
    is_blocked,
    document_id
)
WHERE
    is_active = true
    AND is_verified = true
    AND is_blocked = false;

-- Individual filter indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_is_active ON documents (is_active)
WHERE
    is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_is_verified ON documents (is_verified)
WHERE
    is_verified = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_is_blocked ON documents (is_blocked)
WHERE
    is_blocked = false;

-- 5.3: TRIGRAM INDEXES FOR WILDCARD SEARCHES

-- Name field trigram index (critical for "fazsion*" type queries)
DROP INDEX IF EXISTS idx_documents_name_trgm;

CREATE INDEX CONCURRENTLY idx_documents_name_trgm ON documents USING GIN (name gin_trgm_ops);

-- Category trigram index
DROP INDEX IF EXISTS idx_documents_category_trgm;

CREATE INDEX CONCURRENTLY idx_documents_category_trgm ON documents USING GIN (category gin_trgm_ops)
WHERE
    category IS NOT NULL;

-- Description trigram index (lower priority)
DROP INDEX IF EXISTS idx_documents_description_trgm;

CREATE INDEX CONCURRENTLY idx_documents_description_trgm ON documents USING GIN (description gin_trgm_ops)
WHERE
    description IS NOT NULL
    AND length(description) > 0;

-- 5.4: COMPOSITE INDEXES FOR COMMON QUERY PATTERNS

-- Index for queries filtered by index_name + filters
DROP INDEX IF EXISTS idx_documents_index_filters;

CREATE INDEX CONCURRENTLY idx_documents_index_filters ON documents (
    index_name,
    is_active,
    is_verified,
    is_blocked
) INCLUDE (document_id, name, category);

-- Index for name-based searches
DROP INDEX IF EXISTS idx_documents_name_lower;

CREATE INDEX CONCURRENTLY idx_documents_name_lower ON documents (index_name, lower(name))
WHERE
    name IS NOT NULL;

-- 5.5: JSONB INDEXES (EMERGENCY FALLBACK)

-- GIN index on content JSONB for path-specific queries
DROP INDEX IF EXISTS idx_documents_content_gin;

CREATE INDEX CONCURRENTLY idx_documents_content_gin ON documents USING GIN (content jsonb_path_ops);

-- Specific path indexes for most-used fields
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_name ON documents USING GIN (
    (content -> 'name') jsonb_path_ops
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_category ON documents USING GIN (
    (content -> 'category_name') jsonb_path_ops
);

-- 5.6: SUPPORTING INDEXES

-- Index for document retrieval by ID
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_id_index ON documents (document_id, index_name);

-- Index for last_modified (cache invalidation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_last_modified ON documents (
    index_name,
    last_modified_at DESC
);

-- ================================================================
-- SECTION 6: OPTIMIZE TABLE STATISTICS
-- ================================================================

DO $$ 
BEGIN
    RAISE NOTICE '📊 Analyzing table statistics...';
END $$;

-- Increase statistics target for better query planning
ALTER TABLE documents ALTER COLUMN index_name SET STATISTICS 1000;

ALTER TABLE documents
ALTER COLUMN weighted_search_vector
SET
    STATISTICS 1000;

ALTER TABLE documents ALTER COLUMN name SET STATISTICS 1000;

ALTER TABLE documents ALTER COLUMN is_active SET STATISTICS 1000;

ALTER TABLE documents ALTER COLUMN is_verified SET STATISTICS 1000;

-- Full analyze
ANALYZE VERBOSE documents;

-- ================================================================
-- SECTION 7: CREATE MATERIALIZED VIEWS (OPTIONAL BUT RECOMMENDED)
-- ================================================================

DO $$ 
BEGIN
    RAISE NOTICE '👁️ Creating materialized views for popular queries...';
END $$;

-- Materialized view for active/verified documents
DROP MATERIALIZED VIEW IF EXISTS active_documents;

CREATE MATERIALIZED VIEW active_documents AS
SELECT
    document_id,
    index_name,
    name,
    category,
    description,
    weighted_search_vector,
    content,
    metadata
FROM documents
WHERE
    is_active = true
    AND is_verified = true
    AND is_blocked = false;

-- Indexes on materialized view
CREATE UNIQUE INDEX ON active_documents (document_id);

CREATE INDEX ON active_documents (index_name);

CREATE INDEX ON active_documents USING GIN (weighted_search_vector);

CREATE INDEX ON active_documents USING GIN (name gin_trgm_ops);

-- ================================================================
-- SECTION 8: CREATE HELPER FUNCTIONS
-- ================================================================

DO $$ 
BEGIN
    RAISE NOTICE '🛠️ Creating helper functions...';
END $$;

-- Function for prefix wildcard search
CREATE OR REPLACE FUNCTION search_with_prefix(
    p_index_name text,
    p_query text,
    p_limit int DEFAULT 10,
    p_offset int DEFAULT 0
) RETURNS TABLE (
    document_id text,
    name text,
    rank real
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.document_id,
        d.name,
        ts_rank_cd(d.weighted_search_vector, to_tsquery('english', p_query || ':*')) as rank
    FROM documents d
    WHERE d.index_name = p_index_name
      AND d.is_active = true
      AND d.is_verified = true
      AND d.is_blocked = false
      AND d.weighted_search_vector @@ to_tsquery('english', p_query || ':*')
    ORDER BY rank DESC, d.name
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function for exact match boost
CREATE OR REPLACE FUNCTION search_with_boost(
    p_index_name text,
    p_query text,
    p_limit int DEFAULT 10
) RETURNS TABLE (
    document_id text,
    name text,
    final_rank real
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.document_id,
        d.name,
        CASE 
            WHEN lower(d.name) = lower(p_query) THEN 1000.0
            WHEN lower(d.name) LIKE lower(p_query) || '%' THEN 500.0
            ELSE ts_rank_cd(d.weighted_search_vector, plainto_tsquery('english', p_query))
        END as final_rank
    FROM documents d
    WHERE d.index_name = p_index_name
      AND d.is_active = true
      AND d.is_verified = true
      AND d.is_blocked = false
      AND (
          lower(d.name) LIKE lower(p_query) || '%'
          OR d.weighted_search_vector @@ plainto_tsquery('english', p_query)
      )
    ORDER BY final_rank DESC, d.name
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ================================================================
-- SECTION 9: MAINTENANCE PROCEDURES
-- ================================================================

-- Function to refresh search vectors for specific index
CREATE OR REPLACE FUNCTION refresh_index_vectors(p_index_name text)
RETURNS void AS $$
BEGIN
    UPDATE documents
    SET 
        weighted_search_vector = generate_weighted_search_vector(index_name, content),
        search_vector = generate_simple_search_vector(content),
        last_modified_at = CURRENT_TIMESTAMP
    WHERE index_name = p_index_name;
    
    RAISE NOTICE 'Refreshed vectors for index: %', p_index_name;
END;
$$ LANGUAGE plpgsql;

-- Function to vacuum and analyze
CREATE OR REPLACE FUNCTION maintain_documents_table()
RETURNS void AS $$
BEGIN
    VACUUM ANALYZE documents;
    REFRESH MATERIALIZED VIEW CONCURRENTLY active_documents;
    RAISE NOTICE 'Maintenance complete at %', clock_timestamp();
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- SECTION 10: PERFORMANCE MONITORING VIEWS
-- ================================================================

-- View for slow queries
CREATE OR REPLACE VIEW slow_search_queries AS
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time,
    stddev_exec_time
FROM pg_stat_statements
WHERE
    query LIKE '%documents%'
    AND query NOT LIKE '%pg_stat_statements%'
ORDER BY mean_exec_time DESC
LIMIT 50;

-- View for index usage
CREATE OR REPLACE VIEW index_usage_stats AS
SELECT
    schemaname,
    relname as tablename,
    indexrelname as indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty (pg_relation_size (indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE
    schemaname = 'public'
    AND relname = 'documents'
ORDER BY idx_scan DESC;

-- ================================================================
-- FINAL VALIDATION
-- ================================================================

DO $$ 
DECLARE
    vector_coverage FLOAT;
    index_count INT;
    table_size TEXT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '═════════════════════════════════════════════════════';
    RAISE NOTICE '✅ OPTIMIZATION COMPLETE!';
    RAISE NOTICE '═════════════════════════════════════════════════════';
    RAISE NOTICE '';
    
    -- Check vector coverage
    SELECT 
        (COUNT(CASE WHEN weighted_search_vector IS NOT NULL THEN 1 END)::FLOAT / 
         NULLIF(COUNT(*), 0) * 100)
    INTO vector_coverage
    FROM documents;
    
    RAISE NOTICE '📊 Vector Coverage: %.2f%%', vector_coverage;
    
    -- Count indexes
    SELECT COUNT(*) 
    INTO index_count
    FROM pg_indexes 
    WHERE tablename = 'documents';
    
    RAISE NOTICE '🔨 Total Indexes: %', index_count;
    
    -- Table size
    SELECT pg_size_pretty(pg_total_relation_size('documents'))
    INTO table_size;
    
    RAISE NOTICE '💾 Total Table Size: %', table_size;
    
    RAISE NOTICE '';
    RAISE NOTICE '🎯 Next Steps:';
    RAISE NOTICE '  1. Restart PostgreSQL to apply configuration changes';
    RAISE NOTICE '  2. Deploy updated application code';
    RAISE NOTICE '  3. Monitor query performance using slow_search_queries view';
    RAISE NOTICE '  4. Run maintain_documents_table() daily';
    RAISE NOTICE '';
    RAISE NOTICE '📈 Expected Performance:';
    RAISE NOTICE '  • Simple queries: <50ms';
    RAISE NOTICE '  • Wildcard queries: <100ms';
    RAISE NOTICE '  • Complex queries: <200ms';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  IMPORTANT: Deploy new search queries that use the optimized indexes!';
    RAISE NOTICE '';
END $$;

-- ================================================================
-- END OF OPTIMIZATION SCRIPT
-- ================================================================