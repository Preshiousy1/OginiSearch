-- Drop existing tables and related objects
DROP TRIGGER IF EXISTS update_search_documents_tsvector ON search_documents;

DROP TRIGGER IF EXISTS update_search_documents_updated_at ON search_documents;

DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;

DROP TRIGGER IF EXISTS update_indices_updated_at ON indices;

DROP TRIGGER IF EXISTS update_search_indexes_updated_at ON search_indexes;

DROP FUNCTION IF EXISTS update_tsvector_column ();

DROP FUNCTION IF EXISTS update_updated_at_column ();

DROP TABLE IF EXISTS search_documents;

DROP TABLE IF EXISTS documents;

DROP TABLE IF EXISTS search_indexes;

DROP TABLE IF EXISTS indices;

-- Now run the new initialization script
\i init-postgres.sql