-- Migrate search data from search_documents to documents table
DO $$
DECLARE
    migrated_count INTEGER;
BEGIN
    -- Migrate search vectors and field weights
    UPDATE documents d 
    SET 
        search_vector = sd.search_vector,
        field_weights = sd.field_weights
    FROM search_documents sd 
    WHERE d.document_id = sd.document_id 
        AND d.index_name = sd.index_name
        AND sd.search_vector IS NOT NULL;

    GET DIAGNOSTICS migrated_count = ROW_COUNT;
    
    RAISE NOTICE 'Migrated % documents with search vectors', migrated_count;
    
    -- Generate materialized vectors for documents that don't have them
    UPDATE documents 
    SET materialized_vector = COALESCE(search_vector, to_tsvector('english', content::text))
    WHERE materialized_vector IS NULL;
    
    GET DIAGNOSTICS migrated_count = ROW_COUNT;
    RAISE NOTICE 'Generated materialized vectors for % documents', migrated_count;
END $$;