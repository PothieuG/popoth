import { NextRequest, NextResponse } from 'next/server'
import { createSession, updateSession, deleteSession, getSession } from '@/lib/session-server'
import { supabase } from '@/lib/supabase-client'
import { parseBody, BadRequestError } from '@/lib/api/parse-body'
import { sessionActionBodySchema } from '@/lib/schemas/auth'
import { logger } from '@/lib/logger'

/**
 * API route for session management
 * Handles login, logout, refresh, and session status
 */

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, sessionActionBodySchema)

    switch (body.action) {
      case 'login': {
        // Use Supabase for real authentication
        const { data, error } = await supabase.auth.signInWithPassword({
          email: body.email,
          password: body.password,
        })

        if (error) {
          let errorMessage = 'Erreur de connexion. Veuillez réessayer.'

          if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Email ou mot de passe incorrect'
          } else if (error.message.includes('Email not confirmed')) {
            errorMessage = 'Veuillez confirmer votre email avant de vous connecter'
          } else if (error.message.includes('Too many requests')) {
            errorMessage = 'Trop de tentatives. Veuillez réessayer dans quelques minutes.'
          }

          return NextResponse.json({ success: false, error: errorMessage }, { status: 401 })
        }

        if (data.user) {
          try {
            // Create server-side session
            await createSession(data.user.id, data.user.email!)

            return NextResponse.json({
              success: true,
              user: {
                id: data.user.id,
                email: data.user.email,
              },
            })
          } catch (sessionError) {
            // CLEANUP-ATTEMPT CRITIQUE: Supabase auth réussi mais JWT session fail → état inconsistant
            logger.error('Session creation error:', sessionError)
            return NextResponse.json(
              { success: false, error: 'Erreur de création de session' },
              { status: 500 },
            )
          }
        }

        return NextResponse.json(
          { success: false, error: 'Erreur de connexion inattendue' },
          { status: 500 },
        )
      }

      case 'refresh': {
        const currentSession = await getSession()
        if (!currentSession) {
          return NextResponse.json(
            { success: false, error: 'Aucune session active' },
            { status: 401 },
          )
        }

        // Update session with new expiration
        await updateSession(currentSession.userId, currentSession.email)

        return NextResponse.json({
          success: true,
          user: {
            id: currentSession.userId,
            email: currentSession.email,
          },
        })
      }

      case 'logout': {
        await deleteSession()
        return NextResponse.json({ success: true })
      }
    }
  } catch (error) {
    // Risk #1 — auth/session uses { success, error } shape, not the v1
    // { error, issues } convention. handleBadRequest is intercepted inline
    // and re-emitted in the route's native shape to preserve client compat.
    if (error instanceof BadRequestError) {
      return NextResponse.json(
        { success: false, error: error.message, issues: error.issues },
        { status: 400 },
      )
    }
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ success: false, authenticated: false }, { status: 401 })
    }

    // Check if session is expired
    const currentTime = Math.floor(Date.now() / 1000)
    if (session.expiresAt <= currentTime) {
      await deleteSession()
      return NextResponse.json(
        { success: false, authenticated: false, error: 'Session expirée' },
        { status: 401 },
      )
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
      },
    })
  } catch {
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
