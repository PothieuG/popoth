import { createClient } from '@supabase/supabase-js'

/**
 * Creates and configures the Supabase client for browser use
 * Uses environment variables to connect to the Supabase project
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

/**
 * Tests the connection to Supabase by performing a simple query
 * Returns connection status and any potential errors
 */
export async function testSupabaseConnection() {
  try {
    // Test basic connection by checking auth
    const { error } = await supabase.auth.getSession()
    
    if (error) {
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