import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Singleton instance to prevent multiple client creation
let supabaseInstance: SupabaseClient<Database> | null = null

/**
 * Gets or creates the Supabase client singleton instance
 * Prevents multiple GoTrueClient instances in the same browser context
 */
function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseInstance) {
    supabaseInstance = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    )
  }
  return supabaseInstance
}

/**
 * Single Supabase client instance for the entire application
 * Uses environment variables to connect to the Supabase project
 */
export const supabase = getSupabaseClient()
