-- Drop triggers
DROP TRIGGER IF EXISTS update_indices_updated_at ON indices;

DROP TRIGGER IF EXISTS update_search_documents_updated_at ON search_documents;

DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;

DROP TRIGGER IF EXISTS update_search_documents_vector ON search_documents;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column ();

DROP FUNCTION IF EXISTS generate_search_vector (JSONB);

DROP FUNCTION IF EXISTS update_search_documents_vector ();

-- Drop tables
DROP TABLE IF EXISTS search_documents;

DROP TABLE IF EXISTS documents;

DROP TABLE IF EXISTS indices;