-- Add search columns to documents table
DO $$
BEGIN
    -- Add search_vector column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE documents ADD COLUMN search_vector TSVECTOR DEFAULT to_tsvector('english', '');
        RAISE NOTICE 'Added search_vector column to documents table';
    ELSE
        RAISE NOTICE 'search_vector column already exists in documents table';
    END IF;

    -- Add field_weights column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'field_weights'
    ) THEN
        ALTER TABLE documents ADD COLUMN field_weights JSONB DEFAULT '{}';
        RAISE NOTICE 'Added field_weights column to documents table';
    ELSE
        RAISE NOTICE 'field_weights column already exists in documents table';
    END IF;

    -- Add materialized_vector column for optimization
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' AND column_name = 'materialized_vector'
    ) THEN
        ALTER TABLE documents ADD COLUMN materialized_vector TSVECTOR;
        RAISE NOTICE 'Added materialized_vector column to documents table';
    ELSE
        RAISE NOTICE 'materialized_vector column already exists in documents table';
    END IF;
END $$;