/**
 * Resolves the canonical site origin (scheme + host + optional port) used to
 * build absolute URLs handed off to Supabase Auth (`redirectTo`) and other
 * external systems.
 *
 * Resolution order:
 * 1. Browser runtime  → `window.location.origin` (matches dev/preview/prod
 *    automatically without env plumbing).
 * 2. SSR / build time → `NEXT_PUBLIC_SITE_URL` env (e.g.
 *    `https://popoth.app`). Trailing slash stripped for consistency.
 * 3. Fallback         → `http://localhost:3000`.
 *
 * Declared in `.env.local` (dev, optional) and `.env.production` /
 * hosting platform env (prod, required) — its value MUST also be listed
 * in Supabase Dashboard → Authentication → URL Configuration → Site URL
 * + Redirect URLs so `redirectTo` passes the allowlist check.
 */
export function getSiteUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (envUrl) return envUrl.replace(/\/+$/, '')
  return 'http://localhost:3000'
}
