-- Migration: Add avatar_url column to profiles table
-- Execute this SQL in your Supabase database to add avatar support

-- Add avatar_url column to profiles table
ALTER TABLE public.profiles
ADD COLUMN avatar_url TEXT DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.profiles.avatar_url IS 'URL or data URL for user avatar image';

-- Update existing records to have null avatar_url (already default, but explicit)
-- No additional updates needed as DEFAULT NULL handles this

-- Verify the column was added successfully
-- You can run: SELECT avatar_url FROM public.profiles LIMIT 1;