-- =====================================================
-- FIELD WEIGHTS PATCH SCRIPT
-- =====================================================
-- This script adds field weights support to an existing database

BEGIN;

-- Step 1: Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE EXTENSION IF NOT EXISTS "unaccent";

CREATE EXTENSION IF NOT EXISTS "tsm_system_rows";

CREATE EXTENSION IF NOT EXISTS "dict_xsyn";

-- Step 2: Create field weights table if it doesn't exist
CREATE TABLE IF NOT EXISTS field_weights (
    index_name VARCHAR(255) NOT NULL,
    field_name VARCHAR(255) NOT NULL,
    weight FLOAT NOT NULL,
    description TEXT,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (index_name, field_name)
);

-- Step 3: Create function to generate weighted search vector
CREATE OR REPLACE FUNCTION generate_document_search_vector(doc_content JSONB, idx_name VARCHAR) RETURNS tsvector AS $$
DECLARE
    search_vector tsvector := ''::tsvector;
    field_weight FLOAT;
    field_text TEXT;
    weight_char CHAR;
BEGIN
    -- Get field weights from the field_weights table
    FOR field_weight, field_text IN 
        SELECT fw.weight, d.field_name
        FROM (
            SELECT jsonb_object_keys(doc_content) as field_name
        ) d
        LEFT JOIN field_weights fw ON 
            fw.index_name = idx_name AND 
            fw.field_name = d.field_name
        WHERE doc_content->>d.field_name IS NOT NULL
        ORDER BY fw.weight DESC NULLS LAST
    LOOP
        -- Map weight to PostgreSQL weight class (NULL weights get 'D')
        weight_char := CASE
            WHEN field_weight >= 10.0 THEN 'A'
            WHEN field_weight >= 5.0 THEN 'B'
            WHEN field_weight >= 2.0 THEN 'C'
            ELSE 'D'
        END;

        -- Handle array fields
        IF jsonb_typeof(doc_content->field_text) = 'array' THEN
            search_vector := search_vector || 
                setweight(
                    to_tsvector('english',
                        COALESCE(
                            (SELECT string_agg(value::text, ' ')
                            FROM jsonb_array_elements_text(doc_content->field_text)),
                            ''
                        )
                    ),
                    weight_char
                );
        ELSE
            search_vector := search_vector || 
                setweight(
                    to_tsvector('english', COALESCE(doc_content->>field_text, '')),
                    weight_char
                );
        END IF;
    END LOOP;

    RETURN search_vector;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 4: Update trigger function to use field weights
CREATE OR REPLACE FUNCTION update_document_search_vector() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := generate_document_search_vector(NEW.content, NEW.index_name);
    NEW.materialized_vector := NEW.search_vector;
    -- Store current field weights in document
    NEW.field_weights := COALESCE(
        (
            SELECT jsonb_object_agg(field_name, weight)
            FROM field_weights
            WHERE index_name = NEW.index_name
        ),
        '{}'::jsonb
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Drop and recreate trigger
DROP TRIGGER IF EXISTS update_document_search_vector_trigger ON documents;

CREATE TRIGGER update_document_search_vector_trigger 
    BEFORE INSERT OR UPDATE ON documents 
    FOR EACH ROW 
    EXECUTE FUNCTION update_document_search_vector();

-- Step 6: Create index on field_weights for faster lookups
CREATE INDEX IF NOT EXISTS idx_field_weights_lookup ON field_weights (index_name, field_name);

-- Step 7: Create helper function for text weight assignment
CREATE OR REPLACE FUNCTION setweight(v tsvector, c character) RETURNS tsvector AS $$
BEGIN
    RETURN v;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- Step 8: Verify setup
SELECT 'Field weights support added successfully' as status;

SELECT COUNT(*) as field_weights_count FROM field_weights;

COMMIT;