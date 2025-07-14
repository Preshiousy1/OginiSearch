-- =====================================================
-- OGINI SEARCH ENGINE - POSTGRESQL MIGRATION SCRIPT
-- =====================================================
-- This script handles both new installations and existing databases
-- It's safe to run multiple times (idempotent)

-- Step 1: Add status column to indices table if it doesn't exist
DO $$
BEGIN
    -- Check if the status column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'indices' 
        AND column_name = 'status'
    ) THEN
        -- Add the status column
        ALTER TABLE indices ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'open';
        RAISE NOTICE 'Added status column to indices table';
    ELSE
        RAISE NOTICE 'Status column already exists in indices table';
    END IF;
END $$;

-- Step 1.5: Add document_count column to indices table if it doesn't exist
DO $$
BEGIN
    -- Check if the document_count column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'indices' 
        AND column_name = 'document_count'
    ) THEN
        -- Add the document_count column
        ALTER TABLE indices ADD COLUMN document_count INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added document_count column to indices table';
    ELSE
        RAISE NOTICE 'Document_count column already exists in indices table';
    END IF;
END $$;

-- Step 2: Add missing indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING GIN (metadata);

-- Step 3: Ensure all required extensions are enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE EXTENSION IF NOT EXISTS "unaccent";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Step 4: Update existing indices to have 'open' status if they don't have it
UPDATE indices SET status = 'open' WHERE status IS NULL;

-- Log migration completion
DO $$ BEGIN RAISE NOTICE 'PostgreSQL migration completed successfully';

RAISE NOTICE 'Status column: Added to indices table';

RAISE NOTICE 'Document_count column: Added to indices table';

RAISE NOTICE 'Indexes: All required indexes created';

RAISE NOTICE 'Extensions: All required extensions enabled';

RAISE NOTICE 'Database is ready for search operations';

END $$;