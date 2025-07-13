-- Add status column to indices table
ALTER TABLE indices
ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'open';

-- Update existing indices to have 'open' status
UPDATE indices SET status = 'open' WHERE status IS NULL;

-- Create an index on the status column for faster filtering
CREATE INDEX IF NOT EXISTS idx_indices_status ON indices (status);

-- Log completion
DO $$ BEGIN RAISE NOTICE 'Added status column to indices table';

RAISE NOTICE 'Created index on status column';

RAISE NOTICE 'Updated existing indices to have open status';

END $$;