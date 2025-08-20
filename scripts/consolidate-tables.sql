-- =====================================================
-- TABLE CONSOLIDATION MIGRATION
-- =====================================================
-- This script consolidates the dual-table architecture (documents + search_documents)
-- into a single optimized documents table for better performance

-- Step 1: Add search columns to documents table
DO $$
BEGIN
    -- Add search_vector column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE documents ADD COLUMN search_vector TSVECTOR DEFAULT to_tsvector('english', '');
        RAISE NOTICE 'Added search_vector column to documents table';
    ELSE
        RAISE NOTICE 'search_vector column already exists in documents table';
    END IF;

    -- Add field_weights column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'field_weights'
    ) THEN
        ALTER TABLE documents ADD COLUMN field_weights JSONB DEFAULT '{}';
        RAISE NOTICE 'Added field_weights column to documents table';
    ELSE
        RAISE NOTICE 'field_weights column already exists in documents table';
    END IF;

    -- Add materialized_vector column for optimization
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'materialized_vector'
    ) THEN
        ALTER TABLE documents ADD COLUMN materialized_vector TSVECTOR;
        RAISE NOTICE 'Added materialized_vector column to documents table';
    ELSE
        RAISE NOTICE 'materialized_vector column already exists in documents table';
    END IF;
END $$;

-- Step 2: Migrate data from search_documents to documents
UPDATE documents d
SET
    search_vector = sd.search_vector,
    field_weights = sd.field_weights
FROM search_documents sd
WHERE
    d.document_id = sd.document_id
    AND d.index_name = sd.index_name
    AND sd.search_vector IS NOT NULL;

-- Step 3: Create optimized indexes on the consolidated table
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

-- Step 4: Generate materialized vectors for existing documents
UPDATE documents 
SET materialized_vector = COALESCE(search_vector, to_tsvector('english', content::text))
WHERE materialized_vector IS NULL;

-- Step 5: Create optimized search function for single table
CREATE OR REPLACE FUNCTION generate_document_search_vector(doc_content JSONB)
RETURNS TSVECTOR AS $$
DECLARE
    search_vector TSVECTOR;
    title_vector TSVECTOR;
    description_vector TSVECTOR;
    name_vector TSVECTOR;
    tags_vector TSVECTOR;
BEGIN
    -- Generate vectors for common fields
    title_vector := to_tsvector('english', COALESCE(doc_content->>'title', ''));
    description_vector := to_tsvector('english', COALESCE(doc_content->>'description', ''));
    name_vector := to_tsvector('english', COALESCE(doc_content->>'name', ''));
    
    -- Handle tags array
    IF jsonb_typeof(doc_content->'tags') = 'array' THEN
        tags_vector := to_tsvector('english', (
            SELECT string_agg(value::text, ' ')
            FROM jsonb_array_elements_text(doc_content->'tags')
        ));
    ELSE
        tags_vector := to_tsvector('english', COALESCE(doc_content->>'tags', ''));
    END IF;

    -- Combine vectors
    search_vector := title_vector || description_vector || name_vector || tags_vector;
    RETURN search_vector;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create trigger to automatically update search vectors
CREATE OR REPLACE FUNCTION update_document_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := generate_document_search_vector(NEW.content);
    NEW.materialized_vector := COALESCE(NEW.search_vector, to_tsvector('english', NEW.content::text));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old trigger if exists
DROP TRIGGER IF EXISTS update_search_documents_vector ON search_documents;

-- Create new trigger on documents table
DROP TRIGGER IF EXISTS update_document_search_vector_trigger ON documents;

CREATE TRIGGER update_document_search_vector_trigger
    BEFORE INSERT OR UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_document_search_vector();

-- Step 7: Update existing documents with proper search vectors
UPDATE documents
SET
    search_vector = generate_document_search_vector (content)
WHERE
    search_vector IS NULL
    OR search_vector = to_tsvector ('english', '');

-- Step 8: Analyze table for query optimization
ANALYZE documents;

-- Step 9: Verify migration
DO $$
DECLARE
    doc_count INTEGER;
    search_doc_count INTEGER;
    migrated_count INTEGER;
BEGIN
    -- Count documents
    SELECT COUNT(*) INTO doc_count FROM documents;
    
    -- Count search documents (should be same or less)
    SELECT COUNT(*) INTO search_doc_count FROM search_documents;
    
    -- Count documents with search vectors
    SELECT COUNT(*) INTO migrated_count FROM documents WHERE search_vector IS NOT NULL;
    
    RAISE NOTICE 'Migration Summary:';
    RAISE NOTICE 'Documents table: % records', doc_count;
    RAISE NOTICE 'Search documents table: % records', search_doc_count;
    RAISE NOTICE 'Documents with search vectors: % records', migrated_count;
    
    IF migrated_count > 0 THEN
        RAISE NOTICE 'Migration completed successfully!';
    ELSE
        RAISE NOTICE 'WARNING: No documents have search vectors!';
    END IF;
END $$;

-- Step 10: Clean up (commented out for safety - uncomment after verification)
-- DROP TABLE IF EXISTS search_documents CASCADE;
-- DROP FUNCTION IF EXISTS generate_search_vector(JSONB);
-- DROP FUNCTION IF EXISTS update_search_documents_vector();

DO $$
BEGIN
    RAISE NOTICE 'Table consolidation migration completed!';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Verify search functionality works correctly';
    RAISE NOTICE '2. Test performance improvements';
    RAISE NOTICE '3. Uncomment cleanup commands in this script';
    RAISE NOTICE '4. Update application code to use single table';
END $$;