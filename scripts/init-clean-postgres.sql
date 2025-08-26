-- =====================================================
-- COMPREHENSIVE DATABASE CLEANUP AND INITIALIZATION
-- =====================================================
-- This script completely clears the database and sets up a fresh schema
-- Run this script to start with a completely clean database

-- Step 1: Drop all existing tables and functions
DROP SCHEMA IF EXISTS public CASCADE;

CREATE SCHEMA IF NOT EXISTS public;

GRANT ALL ON SCHEMA public TO postgres;

GRANT ALL ON SCHEMA public TO public;

-- Step 2: Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE EXTENSION IF NOT EXISTS "unaccent";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Step 3: Create indices table
CREATE TABLE IF NOT EXISTS indices (
    index_name VARCHAR(255) PRIMARY KEY,
    settings JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    document_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Step 4: Create optimized documents table with search vectors built-in
CREATE TABLE IF NOT EXISTS documents (
    document_id VARCHAR(255) NOT NULL,
    index_name VARCHAR(255) NOT NULL,
    content JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    search_vector TSVECTOR NOT NULL DEFAULT to_tsvector ('english', ''),
    materialized_vector TSVECTOR,
    field_weights JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (document_id, index_name),
        FOREIGN KEY (index_name) REFERENCES indices (index_name) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 5: Create optimized indexes from the start
-- REMOVED: Old indexes that cause performance issues and conflicts
-- CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING GIN (search_vector) WITH (fastupdate = off);
-- CREATE INDEX IF NOT EXISTS idx_documents_materialized_vector ON documents USING GIN (materialized_vector) WITH (fastupdate = off);

-- Removed field_weights index that can cause size issues
-- CREATE INDEX IF NOT EXISTS idx_documents_field_weights ON documents USING GIN (field_weights jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_documents_content ON documents USING GIN (content);

-- REMOVED: Problematic covering index that causes index size limit errors
-- CREATE INDEX IF NOT EXISTS idx_documents_search_covering ON documents (index_name, document_id) INCLUDE (
--     content,
--     metadata,
--     search_vector,
--     field_weights,
--     materialized_vector
-- );

-- REMOVED: Old duplicate indexes that cause performance issues
-- CREATE INDEX IF NOT EXISTS idx_documents_composite_search ON documents (index_name) WHERE search_vector IS NOT NULL;
-- CREATE INDEX IF NOT EXISTS idx_documents_index_name ON documents (index_name);
-- CREATE INDEX IF NOT EXISTS idx_documents_search_vector_optimized ON documents USING GIN (search_vector) WITH (fastupdate = off);
-- CREATE INDEX IF NOT EXISTS idx_documents_materialized_vector_optimized ON documents USING GIN (materialized_vector) WITH (fastupdate = off);
-- CREATE INDEX IF NOT EXISTS idx_documents_non_empty_search ON documents USING GIN (search_vector) WHERE search_vector IS NOT NULL AND search_vector != to_tsvector ('english', '');
-- CREATE INDEX IF NOT EXISTS idx_documents_index_name_optimized ON documents (index_name) WHERE search_vector IS NOT NULL;
-- CREATE INDEX IF NOT EXISTS idx_documents_search_lightweight_safe ON documents (index_name, document_id);

-- Optimized index structure (exactly matching fix script)
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

-- REMOVED: Problematic covering index that causes btree size limit errors
-- CREATE INDEX IF NOT EXISTS idx_documents_search_covering_generic ON documents (index_name, document_id) INCLUDE (
--     search_vector,
--     materialized_vector
-- );

-- Add GIN trigram index for wildcard queries (much faster than ILIKE)
CREATE INDEX IF NOT EXISTS idx_documents_content_trgm 
ON documents USING GIN ((content::text) gin_trgm_ops);

-- Step 6: Update timestamp function and triggers
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_indices_updated_at BEFORE UPDATE ON indices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 7: Create optimized search vector generation function
CREATE OR REPLACE FUNCTION generate_document_search_vector(doc_content JSONB) RETURNS TSVECTOR AS $$
DECLARE
    search_vector TSVECTOR;
    title_vector TSVECTOR;
    description_vector TSVECTOR;
    name_vector TSVECTOR;
    tags_vector TSVECTOR;
    profile_vector TSVECTOR;
    slug_vector TSVECTOR;
BEGIN
    title_vector := to_tsvector('english', COALESCE(doc_content->>'title', ''));
    description_vector := to_tsvector('english', COALESCE(doc_content->>'description', ''));
    name_vector := to_tsvector('english', COALESCE(doc_content->>'name', ''));
    profile_vector := to_tsvector('english', COALESCE(doc_content->>'profile', ''));
    slug_vector := to_tsvector('english', COALESCE(doc_content->>'slug', ''));
    IF jsonb_typeof(doc_content->'tags') = 'array' THEN
        tags_vector := to_tsvector('english', (SELECT string_agg(value::text, ' ') FROM jsonb_array_elements_text(doc_content->'tags')));
    ELSE
        tags_vector := to_tsvector('english', COALESCE(doc_content->>'tags', ''));
    END IF;
    search_vector := title_vector || description_vector || name_vector || profile_vector || slug_vector || tags_vector;
    RETURN search_vector;
END;
$$ LANGUAGE plpgsql;

-- Step 8: Create trigger to automatically update search vectors
CREATE OR REPLACE FUNCTION update_document_search_vector() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := generate_document_search_vector(NEW.content);
    NEW.materialized_vector := COALESCE(NEW.search_vector, to_tsvector('english', NEW.content::text));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_document_search_vector_trigger BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();

-- Step 9: Verify setup
SELECT 'Database initialization completed successfully' as status;

SELECT COUNT(*) as indices_count FROM indices;

SELECT COUNT(*) as documents_count FROM documents;