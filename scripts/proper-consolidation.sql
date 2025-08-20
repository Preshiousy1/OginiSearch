-- =====================================================
-- PROPER TABLE CONSOLIDATION - BATCHED MIGRATION
-- =====================================================
-- This script properly consolidates the dual-table architecture
-- by migrating data in batches and creating optimized indexes

-- Step 1: Add search columns to documents table (if not already added)
DO $$
BEGIN
    -- Add search_vector column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE documents ADD COLUMN search_vector TSVECTOR DEFAULT to_tsvector('english', '');
        RAISE NOTICE 'Added search_vector column to documents table';
    END IF;

    -- Add field_weights column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'field_weights'
    ) THEN
        ALTER TABLE documents ADD COLUMN field_weights JSONB DEFAULT '{}';
        RAISE NOTICE 'Added field_weights column to documents table';
    END IF;

    -- Add materialized_vector column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'materialized_vector'
    ) THEN
        ALTER TABLE documents ADD COLUMN materialized_vector TSVECTOR;
        RAISE NOTICE 'Added materialized_vector column to documents table';
    END IF;
END $$;

-- Step 2: Migrate data in batches (to avoid timeouts)
DO $$
DECLARE
    batch_size INTEGER := 10000;
    total_docs INTEGER;
    processed_docs INTEGER := 0;
    batch_count INTEGER := 0;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO total_docs FROM search_documents;
    RAISE NOTICE 'Total documents to migrate: %', total_docs;
    
    -- Migrate in batches
    WHILE processed_docs < total_docs LOOP
        -- Update batch
        UPDATE documents d 
        SET 
            search_vector = sd.search_vector,
            field_weights = sd.field_weights,
            materialized_vector = COALESCE(sd.materialized_vector, sd.search_vector)
        FROM search_documents sd 
        WHERE d.document_id = sd.document_id 
            AND d.index_name = sd.index_name
            AND d.search_vector IS NULL
            AND sd.document_id IN (
                SELECT document_id FROM search_documents 
                WHERE search_vector IS NOT NULL 
                LIMIT batch_size
            );
        
        GET DIAGNOSTICS processed_docs = ROW_COUNT;
        batch_count := batch_count + 1;
        
        RAISE NOTICE 'Batch %: Migrated % documents', batch_count, processed_docs;
        
        -- Small delay to prevent overwhelming the database
        PERFORM pg_sleep(0.1);
    END LOOP;
    
    RAISE NOTICE 'Migration completed: % batches processed', batch_count;
END $$;

-- Step 3: Create optimized indexes
-- Drop old indexes that are no longer needed
DROP INDEX IF EXISTS idx_search_vector;

DROP INDEX IF EXISTS idx_search_documents_index_name;

DROP INDEX IF EXISTS idx_field_weights;

-- Create new optimized indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_search_vector ON documents USING GIN (search_vector);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_materialized_vector ON documents USING GIN (materialized_vector);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_field_weights ON documents USING GIN (field_weights jsonb_path_ops);

-- Create covering index for search queries (includes all needed columns)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_search_covering ON documents (index_name, document_id) INCLUDE (
    content,
    metadata,
    search_vector,
    field_weights,
    materialized_vector
);

-- Create composite index for fast filtering and searching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_composite_search ON documents (index_name)
WHERE
    search_vector IS NOT NULL;

-- Step 4: Analyze table for query optimization
ANALYZE documents;

-- Step 5: Verify migration
DO $$ DECLARE doc_count INTEGER;

search_doc_count INTEGER;

migrated_count INTEGER;

BEGIN
-- Count documents
SELECT COUNT(*) INTO doc_count
FROM documents;

-- Count search documents
SELECT COUNT(*) INTO search_doc_count
FROM search_documents;

-- Count documents with search vectors
SELECT COUNT(*) INTO migrated_count
FROM documents
WHERE
    search_vector IS NOT NULL;

RAISE NOTICE 'Migration Summary:';

RAISE NOTICE 'Documents table: % records',
doc_count;

RAISE NOTICE 'Search documents table: % records',
search_doc_count;

RAISE NOTICE 'Documents with search vectors: % records',
migrated_count;

IF migrated_count > 0 THEN RAISE NOTICE 'Migration completed successfully!';

ELSE RAISE NOTICE 'WARNING: No documents have search vectors!';

END IF;

END $$;

DO $$ BEGIN RAISE NOTICE 'Proper table consolidation completed!';

END $$;