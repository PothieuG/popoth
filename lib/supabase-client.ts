import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Singleton instance to prevent multiple client creation
let supabaseInstance: SupabaseClient | null = null

/**
 * Gets or creates the Supabase client singleton instance
 * Prevents multiple GoTrueClient instances in the same browser context
 */
function getSupabaseClient() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
  }
  return supabaseInstance
}

/**
 * Single Supabase client instance for the entire application
 * Uses environment variables to connect to the Supabase project
 */
export const supabase = getSupabaseClient()

/**
 * Tests the connection to Supabase by performing a simple auth check
 * Returns connection status and any potential errors
 */
export async function testSupabaseConnection() {
  try {
    // Test basic connection by checking auth session
    const { error } = await supabase.auth.getSession()
    
    if (error && error.message !== 'Auth session missing!') {
      console.log('Supabase connection test result:', error.message)
      return { success: false, error: error.message }
    }
    
    console.log('✅ Supabase connection successful!')
    return { success: true, data: 'Connection successful' }
  } catch (err) {
    console.error('❌ Supabase connection failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}