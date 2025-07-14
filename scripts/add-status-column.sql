-- Migration: Add status column to indices table
-- This script adds the missing status column to existing indices tables

-- Check if status column exists, if not add it
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