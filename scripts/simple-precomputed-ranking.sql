-- Simple Precomputed Field-Weighted Ranking Implementation
-- This script creates a single function that can be executed atomically

-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Add the weighted_search_vector column if it doesn't exist
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS weighted_search_vector tsvector;

-- Create or replace the search vector generation function with field weights
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
        -- D-weight (lowest priority): tags and profile
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'tags', '')), 'D'), ''::tsvector) ||
        COALESCE(setweight(to_tsvector('english', COALESCE(content_data->>'profile', '')), 'D'), ''::tsvector);
END;
$$ LANGUAGE plpgsql;

-- Create or replace the trigger function
CREATE OR REPLACE FUNCTION update_weighted_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.weighted_search_vector := generate_weighted_search_vector(NEW.index_name, NEW.content);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS update_weighted_search_vector_trigger ON documents;

CREATE TRIGGER update_weighted_search_vector_trigger
    BEFORE INSERT OR UPDATE OF content, index_name ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_weighted_search_vector();

-- Create optimized GIN index on the weighted search vector
DROP INDEX IF EXISTS idx_documents_weighted_search_vector;

CREATE INDEX idx_documents_weighted_search_vector ON documents USING GIN (weighted_search_vector)
WITH (fastupdate = off);

-- Update existing documents with weighted search vectors (in batches)
UPDATE documents
SET
    weighted_search_vector = generate_weighted_search_vector (index_name, content)
WHERE
    weighted_search_vector IS NULL;

-- Analyze the table to update statistics
ANALYZE documents;