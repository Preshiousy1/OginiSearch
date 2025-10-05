-- Precomputed Field-Weighted Ranking Implementation
-- This script implements field weights directly in tsvector during indexing
-- This eliminates the need for real-time field weight calculations during search

-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS "tsearch2";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create or replace the search vector generation function with field weights
CREATE OR REPLACE FUNCTION generate_weighted_search_vector(
    index_name_param text,
    content_data jsonb
) RETURNS tsvector AS $$
DECLARE
    name_vector tsvector;
    title_vector tsvector;
    category_vector tsvector;
    subcategory_vector tsvector;
    description_vector tsvector;
    tags_vector tsvector;
    location_vector tsvector;
    profile_vector tsvector;
    combined_vector tsvector;
BEGIN
    -- Extract and create weighted vectors for each field
    
    -- A-weight (highest priority): name and title fields
    name_vector := COALESCE(
        setweight(to_tsvector('english', COALESCE(content_data->>'name', '')), 'A'),
        ''::tsvector
    );
    
    title_vector := COALESCE(
        setweight(to_tsvector('english', COALESCE(content_data->>'title', '')), 'A'),
        ''::tsvector
    );
    
    -- B-weight (high priority): category fields
    category_vector := COALESCE(
        setweight(to_tsvector('english', COALESCE(content_data->>'category_name', '')), 'B'),
        ''::tsvector
    );
    
    subcategory_vector := COALESCE(
        setweight(to_tsvector('english', 
            array_to_string(
                ARRAY(SELECT jsonb_array_elements_text(content_data->'sub_category_name')), 
                ' '
            )
        ), 'B'),
        ''::tsvector
    );
    
    -- C-weight (medium priority): description and location
    description_vector := COALESCE(
        setweight(to_tsvector('english', COALESCE(content_data->>'description', '')), 'C'),
        ''::tsvector
    );
    
    location_vector := COALESCE(
        setweight(to_tsvector('english', COALESCE(content_data->>'location_text', '')), 'C'),
        ''::tsvector
    );
    
    -- D-weight (lowest priority): tags and profile
    tags_vector := COALESCE(
        setweight(to_tsvector('english', COALESCE(content_data->>'tags', '')), 'D'),
        ''::tsvector
    );
    
    profile_vector := COALESCE(
        setweight(to_tsvector('english', COALESCE(content_data->>'profile', '')), 'D'),
        ''::tsvector
    );
    
    -- Combine all vectors with their respective weights
    combined_vector := name_vector || title_vector || category_vector || 
                      subcategory_vector || description_vector || 
                      location_vector || tags_vector || profile_vector;
    
    RETURN combined_vector;
END;
$$ LANGUAGE plpgsql;

-- Create or replace the trigger function to automatically update search vectors
CREATE OR REPLACE FUNCTION update_weighted_search_vector() RETURNS trigger AS $$
BEGIN
    -- Generate the weighted search vector using the new function
    NEW.weighted_search_vector := generate_weighted_search_vector(NEW.index_name, NEW.content);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add the new weighted_search_vector column if it doesn't exist
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS weighted_search_vector tsvector;

-- Create the trigger to automatically update weighted search vectors
DROP TRIGGER IF EXISTS update_weighted_search_vector_trigger ON documents;

CREATE TRIGGER update_weighted_search_vector_trigger
    BEFORE INSERT OR UPDATE OF content, index_name ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_weighted_search_vector();

-- Create optimized GIN index on the weighted search vector
DROP INDEX IF EXISTS idx_documents_weighted_search_vector;

CREATE INDEX CONCURRENTLY idx_documents_weighted_search_vector ON documents USING GIN (weighted_search_vector)
WITH (fastupdate = off);

-- Update existing documents with weighted search vectors
-- This will be done in batches to avoid locking the table
DO $$ DECLARE batch_size INTEGER := 1000;

offset_val INTEGER := 0;

total_count INTEGER;

BEGIN
-- Get total count
SELECT COUNT(*) INTO total_count
FROM documents;

RAISE NOTICE 'Updating % documents with weighted search vectors...',
total_count;

-- Update in batches
WHILE offset_val < total_count
LOOP
UPDATE documents
SET
    weighted_search_vector = generate_weighted_search_vector (index_name, content)
WHERE
    document_id IN (
        SELECT document_id
        FROM documents
        ORDER BY document_id
        LIMIT batch_size
        OFFSET
            offset_val
    );

offset_val := offset_val + batch_size;

RAISE NOTICE 'Updated % of % documents',
offset_val,
total_count;

END
LOOP;

RAISE NOTICE 'Weighted search vector update completed';

END $$;

-- Analyze the table to update statistics
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
    AND indexname LIKE '%weighted%'
ORDER BY idx_scan DESC;