'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase-client'
import { logger } from '@/lib/logger'

/**
 * Click-to-confirm gate for Supabase Auth email links (recovery, signup,
 * magiclink, invite, email_change).
 *
 * Why a client page instead of a server route handler:
 * - Email scanners (Outlook Safe Links, Gmail previewers, antivirus,
 *   link-preview bots) issue HEAD/GET requests on links before the user
 *   ever sees them. A server route that calls `verifyOtp()` on every GET
 *   would consume the single-use OTP for these scanners, leaving the user
 *   with an `otp_expired` error.
 * - This page renders inert HTML on first paint and only triggers
 *   `verifyOtp()` after an explicit user click. Scanners don't execute
 *   the JS, so the OTP survives until the human acts on it.
 *
 * The Supabase email template MUST be configured to point here directly
 * (NOT to `{{ .ConfirmationURL }}`, which embeds the legacy `/auth/v1/verify`
 * endpoint that consumes the token on first GET). Template body:
 *
 *   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">
 *     Réinitialiser mon mot de passe
 *   </a>
 */
export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="pt-safe pb-safe flex min-h-screen items-center justify-center bg-gray-50">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      }
    >
      <AuthConfirmContent />
    </Suspense>
  )
}

const ALLOWED_TYPES = ['recovery', 'signup', 'invite', 'magiclink', 'email_change'] as const
type AllowedType = (typeof ALLOWED_TYPES)[number]

function isAllowedType(value: string): value is AllowedType {
  return (ALLOWED_TYPES as readonly string[]).includes(value)
}

function AuthConfirmContent() {
  const searchParams = useSearchParams()
  const [isVerifying, setIsVerifying] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const tokenHash = searchParams.get('token_hash') ?? ''
  const typeRaw = searchParams.get('type') ?? ''
  const type: AllowedType | '' = isAllowedType(typeRaw) ? typeRaw : ''
  const next = sanitizeNext(searchParams.get('next'), type)

  const handleConfirm = async () => {
    if (!tokenHash || !type) {
      setErrorMessage('Lien de confirmation invalide ou incomplet.')
      return
    }
    setIsVerifying(true)
    setErrorMessage('')
    try {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as EmailOtpType,
      })
      if (error) {
        logger.error('verifyOtp failed:', error)
        const code = error.message.toLowerCase().includes('expired') ? 'expired' : 'invalid'
        window.location.href = `/auth/auth-code-error?error=${code}`
        return
      }
      window.location.href = next
    } catch (error) {
      logger.error('verifyOtp threw:', error)
      window.location.href = '/auth/auth-code-error?error=server'
    }
  }

  const hasValidQuery = Boolean(tokenHash && type)

  return (
    <div className="pt-safe pb-safe flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-4xl font-bold text-transparent">
            Confirmer
          </h1>
          <p className="text-lg text-gray-600">
            {type === 'recovery'
              ? 'Confirmez votre demande de réinitialisation de mot de passe'
              : 'Confirmez votre action'}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-600">
              Pour des raisons de sécurité, ce clic est nécessaire pour empêcher les analyseurs de
              liens automatiques (antivirus, prévisualisation de mails) d&apos;invalider votre lien
              avant que vous ne puissiez l&apos;utiliser.
            </p>

            <Button
              onClick={handleConfirm}
              disabled={!hasValidQuery || isVerifying}
              aria-describedby={errorMessage ? 'confirm-error' : undefined}
              className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isVerifying ? 'Confirmation en cours...' : 'Confirmer'}
            </Button>

            {!hasValidQuery && !errorMessage && (
              <div
                role="alert"
                className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4 text-left"
              >
                <p className="font-medium text-red-800">
                  Lien de confirmation invalide ou incomplet. Veuillez demander un nouveau lien.
                </p>
              </div>
            )}

            {errorMessage && (
              <div
                id="confirm-error"
                role="alert"
                className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4 text-left"
              >
                <p className="font-medium text-red-800">{errorMessage}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Returns a safe in-app path to redirect to after verifyOtp succeeds.
 * Accepts only same-origin URLs or relative paths starting with `/`
 * (and not `//`, which would be protocol-relative and could escape
 * the origin). Falls back to a type-aware default when the input
 * is missing or unsafe.
 */
function sanitizeNext(raw: string | null, type: AllowedType | ''): string {
  const fallback = type === 'recovery' ? '/reset-password' : '/dashboard'
  if (!raw) return fallback

  if (typeof window === 'undefined') {
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw
    return fallback
  }

  try {
    const candidate = new URL(raw, window.location.origin)
    if (candidate.origin === window.location.origin) {
      return candidate.pathname + candidate.search + candidate.hash
    }
  } catch {
    // fall through to fallback
  }
  return fallback
}
