-- Generate search vectors from document content
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    -- Generate search vectors from content for documents that don't have them
    UPDATE documents 
    SET search_vector = to_tsvector('english', content::text)
    WHERE search_vector IS NULL OR search_vector = to_tsvector('english', '');
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Generated search vectors for % documents', updated_count;
    
    -- Set materialized vectors to search vectors
    UPDATE documents 
    SET materialized_vector = search_vector
    WHERE materialized_vector IS NULL;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Set materialized vectors for % documents', updated_count;
END $$;