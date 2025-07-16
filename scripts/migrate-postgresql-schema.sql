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

-- Step 2.5: Ensure composite primary key constraint exists on documents table
DO $$
DECLARE
    pk_name text;
    single_pk_name text;
BEGIN
    -- Find if a single-column primary key exists on document_id
    SELECT tc.constraint_name INTO single_pk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'documents'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND (
        SELECT COUNT(*) FROM information_schema.key_column_usage kcu2
        WHERE kcu2.constraint_name = tc.constraint_name
      ) = 1
      AND kcu.column_name = 'document_id';

    -- Drop single-column PK if it exists
    IF single_pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', single_pk_name);
        RAISE NOTICE 'Dropped single-column primary key constraint on document_id';
    END IF;

    -- Check if composite PK exists
    SELECT tc.constraint_name INTO pk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'documents'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND (
        SELECT COUNT(*) FROM information_schema.key_column_usage kcu2
        WHERE kcu2.constraint_name = tc.constraint_name
      ) = 2
      AND EXISTS (
        SELECT 1 FROM information_schema.key_column_usage kcu3
        WHERE kcu3.constraint_name = tc.constraint_name AND kcu3.column_name = 'document_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.key_column_usage kcu4
        WHERE kcu4.constraint_name = tc.constraint_name AND kcu4.column_name = 'index_name'
      );

    -- Add composite PK if not present
    IF pk_name IS NULL THEN
        ALTER TABLE documents ADD CONSTRAINT documents_pkey PRIMARY KEY (document_id, index_name);

RAISE NOTICE 'Added composite primary key (document_id, index_name) to documents table';

ELSE RAISE NOTICE 'Composite primary key already exists on documents table';

END IF;

END $$;

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