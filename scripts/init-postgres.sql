-- =====================================================
-- OGINI SEARCH ENGINE - POSTGRESQL INITIALIZATION
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE EXTENSION IF NOT EXISTS "unaccent";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create indices table
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

-- Create documents table for document storage
CREATE TABLE IF NOT EXISTS documents (
    document_id VARCHAR(255) NOT NULL,
    index_name VARCHAR(255) NOT NULL,
    content JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (document_id, index_name),
        FOREIGN KEY (index_name) REFERENCES indices (index_name) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create search_documents table for search functionality
CREATE TABLE IF NOT EXISTS search_documents (
    document_id VARCHAR(255) NOT NULL,
    index_name VARCHAR(255) NOT NULL,
    search_vector TSVECTOR NOT NULL DEFAULT to_tsvector ('english', ''),
    field_weights JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (document_id, index_name),
        FOREIGN KEY (index_name) REFERENCES indices (index_name) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (document_id, index_name) REFERENCES documents (document_id, index_name) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create GIN index for full text search
CREATE INDEX IF NOT EXISTS idx_search_vector ON search_documents USING GIN (search_vector);

-- Create index on index_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_documents_index_name ON documents (index_name);

CREATE INDEX IF NOT EXISTS idx_search_documents_index_name ON search_documents (index_name);

-- Create index on field_weights for weighted searches
CREATE INDEX IF NOT EXISTS idx_field_weights ON search_documents USING GIN (field_weights jsonb_path_ops);

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add timestamp triggers
CREATE TRIGGER update_indices_updated_at
    BEFORE UPDATE ON indices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_search_documents_updated_at
    BEFORE UPDATE ON search_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create a function to generate search vector from document content
CREATE OR REPLACE FUNCTION generate_search_vector(doc_content JSONB)
RETURNS TSVECTOR AS $$
DECLARE
    title_weight TEXT := 'A';
    description_weight TEXT := 'B';
    categories_weight TEXT := 'C';
    search_vector TSVECTOR;
    title_vector TSVECTOR;
    description_vector TSVECTOR;
    categories_vector TSVECTOR;
BEGIN
    -- Generate vectors for each field
    title_vector := to_tsvector('english', COALESCE(doc_content->>'title', ''));
    description_vector := to_tsvector('english', COALESCE(doc_content->>'description', ''));
    
    -- Handle categories array
    IF jsonb_typeof(doc_content->'categories') = 'array' THEN
        categories_vector := to_tsvector('english', (
            SELECT string_agg(value::text, ' ')
            FROM jsonb_array_elements_text(doc_content->'categories')
        ));
    ELSIF doc_content->>'categories' IS NOT NULL THEN
        categories_vector := to_tsvector('english', doc_content->>'categories');
    ELSE
        categories_vector := to_tsvector('english', '');
    END IF;

    -- Combine vectors with weights
    search_vector := title_vector || description_vector || categories_vector;

    RETURN search_vector;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update search_vector in search_documents
CREATE OR REPLACE FUNCTION update_search_documents_vector()
RETURNS TRIGGER AS $$
DECLARE
    doc_content JSONB;
BEGIN
    -- Get the document content from the documents table
    SELECT content INTO doc_content
    FROM documents
    WHERE document_id = NEW.document_id AND index_name = NEW.index_name;

    IF doc_content IS NOT NULL THEN
        NEW.search_vector := generate_search_vector(doc_content);
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_search_documents_vector ON search_documents;

CREATE TRIGGER update_search_documents_vector
    BEFORE INSERT OR UPDATE ON search_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_search_documents_vector();

-- Log initialization completion
DO $$
BEGIN
    RAISE NOTICE 'Ogini Search Engine PostgreSQL initialization completed successfully';
    RAISE NOTICE 'Created tables: documents, search_documents, indices';
    RAISE NOTICE 'Created indexes: GIN indexes for search_vector and field_weights';
    RAISE NOTICE 'Created triggers: Automatic timestamp updates and search vector generation';
    RAISE NOTICE 'Database is ready for search operations';
END $$;