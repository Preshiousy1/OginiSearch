-- =====================================================
-- REMOVE PROBLEMATIC INDEX MIGRATION
-- =====================================================
-- This script removes the problematic idx_documents_search_lightweight index
-- that causes btree size limit errors for large documents

-- Drop the problematic index
DROP INDEX IF EXISTS idx_documents_search_lightweight;

-- Create a safer alternative without large vector fields
CREATE INDEX IF NOT EXISTS idx_documents_search_lightweight_safe ON documents (index_name, document_id);

-- Verify the change
SELECT 'Problematic index removed successfully' as status;

-- Show remaining indexes for verification
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE
    tablename = 'documents'
    AND indexname LIKE '%lightweight%'
ORDER BY indexname;