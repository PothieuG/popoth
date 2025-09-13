import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

/**
 * API route for handling email confirmation tokens from Supabase
 * Processes password reset and email verification links
 * Redirects users to appropriate pages based on verification success/failure
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') || '/'

  // Log the incoming parameters for debugging
  console.log('Auth confirmation request:', { token_hash: !!token_hash, type, next })

  // Validate required parameters
  if (!token_hash || !type) {
    console.error('Missing required parameters:', { token_hash: !!token_hash, type })
    return NextResponse.redirect(new URL('/auth/auth-code-error', request.url))
  }

  try {
    // Verify the OTP token with Supabase
    const { data, error } = await supabase.auth.verifyOtp({
      type: type as any,
      token_hash,
    })

    if (error) {
      console.error('OTP verification error:', error)
      
      // Handle specific verification errors
      if (error.message.includes('expired')) {
        return NextResponse.redirect(new URL('/auth/auth-code-error?error=expired', request.url))
      } else if (error.message.includes('invalid')) {
        return NextResponse.redirect(new URL('/auth/auth-code-error?error=invalid', request.url))
      } else {
        return NextResponse.redirect(new URL('/auth/auth-code-error?error=unknown', request.url))
      }
    }

    if (!data.user) {
      console.error('No user found after successful OTP verification')
      return NextResponse.redirect(new URL('/auth/auth-code-error?error=no_user', request.url))
    }

    console.log('OTP verification successful for user:', data.user.email)

    // Handle different types of confirmations
    if (type === 'recovery') {
      // Password reset flow - redirect to password update page
      return NextResponse.redirect(new URL('/reset-password', request.url))
    } else if (type === 'signup') {
      // Email signup confirmation - redirect to home or dashboard
      return NextResponse.redirect(new URL('/', request.url))
    } else {
      // Default redirect for other types
      const redirectUrl = next.startsWith('/') ? next : `/${next}`
      return NextResponse.redirect(new URL(redirectUrl, request.url))
    }

  } catch (error) {
    console.error('Unexpected error during OTP verification:', error)
    return NextResponse.redirect(new URL('/auth/auth-code-error?error=server', request.url))
  }
}