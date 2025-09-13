import { createClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase client with service role key
 * This client bypasses Row Level Security (RLS) and should only be used in API routes
 * where we have already validated the user's authentication through our JWT tokens
 */
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)