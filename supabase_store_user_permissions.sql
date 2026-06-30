-- Add permissions column to store_users
ALTER TABLE store_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"tables": true, "counter": true, "kitchen": true, "menu": true, "admin": false}'::jsonb;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
