import { createClient } from '@supabase/supabase-js'

// NOTE Sprint DB: not yet using `<Database>` from lib/database. Wiring the
// generic surfaced ~105 pre-existing typing errors across debug seed routes
// (wrong table/column names) and recap routes that exceed this sprint's
// scope. The generated lib/database.types.ts and the augmented lib/database.ts
// are kept ready; flip the generic in a follow-up chantier alongside fixing
// those call sites.

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