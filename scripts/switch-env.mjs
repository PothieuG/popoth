#!/usr/bin/env node
// Switch .env.local between prod and dev presets.
//
// Usage:
//   node scripts/switch-env.mjs prod  -> copy .env.local.prod  -> .env.local
//   node scripts/switch-env.mjs dev   -> copy .env.local.dev   -> .env.local
//
// Required preset files (gitignored via `.env*.local` rule in .gitignore):
//   .env.local.prod  -> contains keys for Supabase prod (jzmppreybwabaeycvasz)
//   .env.local.dev   -> contains keys for Supabase dev  (ddehmjucyfgyppfkbddr)
//
// Both presets must be created manually once (copy current .env.local to the
// matching preset, then craft the other from Supabase dashboard). Never commit
// these files — `.env*.local` is gitignored on purpose.

import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const target = process.argv[2]

if (target !== 'prod' && target !== 'dev') {
  console.error('Usage: node scripts/switch-env.mjs <prod|dev>')
  process.exit(1)
}

const cwd = process.cwd()
const source = resolve(cwd, `.env.local.${target}`)
const dest = resolve(cwd, '.env.local')

if (!existsSync(source)) {
  console.error(`Missing preset: ${source}`)
  console.error('')
  console.error(`Create it first. Two ways depending on target:`)
  if (target === 'prod') {
    console.error('  - If your current .env.local already points to prod:')
    console.error('      Copy-Item .env.local .env.local.prod')
  } else {
    console.error('  - Get dev keys from Supabase dashboard for project ddehmjucyfgyppfkbddr:')
    console.error('      https://supabase.com/dashboard/project/ddehmjucyfgyppfkbddr/settings/api')
    console.error('    Then create .env.local.dev with the same variable names as .env.local')
    console.error('    pointing to dev URL + dev keys.')
  }
  process.exit(1)
}

copyFileSync(source, dest)

const firstLine = readFileSync(dest, 'utf8').split('\n')[0] ?? ''
const projectHint = firstLine.includes('jzmppreybwabaeycvasz')
  ? 'jzmppreybwabaeycvasz (prod)'
  : firstLine.includes('ddehmjucyfgyppfkbddr')
    ? 'ddehmjucyfgyppfkbddr (dev)'
    : 'unknown project (check NEXT_PUBLIC_SUPABASE_URL in .env.local)'

console.log(`Switched .env.local -> .env.local.${target}`)
console.log(`Detected project: ${projectHint}`)
console.log('')
console.log('Restart `pnpm dev` for the change to take effect.')
