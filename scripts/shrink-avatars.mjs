#!/usr/bin/env node
// Redimensionne les photos de profil déjà stockées en base64 dans
// `profiles.avatar_url` — Sprint Fix-Avatar-Payload (2026-09-11).
//
// Contexte : `AvatarUpload` stockait la photo brute du téléphone (3,7 Mo pour
// un membre en prod). Le client redimensionne désormais à 256 px avant envoi
// et l'API refuse au-delà de AVATAR_URL_MAX_CHARS, mais les avatars existants
// restent lourds tant que leur propriétaire ne re-téléverse pas. Ce script
// les ramène à 256 px JPEG q82 (10-30 Ko), sans rien changer d'autre.
//
// Usage :
//   node scripts/shrink-avatars.mjs                 # dry-run : liste ce qui serait fait
//   node scripts/shrink-avatars.mjs --apply         # écrit en base
//
// Env (lues depuis le shell ou .env.local, comme scripts/seed-recap) :
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — le projet ciblé est
//   celui de l'URL : vérifier le bloc actif de .env.local (prod ↔ dev) avant
//   `--apply`. Le script affiche la ref du projet et n'écrit jamais le contenu
//   des images sur la sortie.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const MAX_SIDE_PX = 256
const JPEG_QUALITY = 82
// Miroir de AVATAR_URL_MAX_CHARS (lib/constants/avatar.ts) — un .mjs ne peut
// pas importer le .ts sans build, on garde la même valeur ici.
const URL_MAX_CHARS = 120_000

function loadEnvLocal() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch {
    // pas de .env.local : les variables viennent du shell
  }
}
loadEnvLocal()

const APPLY = process.argv.includes('--apply')
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.')
  process.exit(1)
}
const projectRef = new globalThis.URL(URL).host.split('.')[0]
console.log(
  `Projet : ${projectRef} — mode ${APPLY ? 'APPLY (écriture)' : 'dry-run (aucune écriture)'}`,
)

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: rows, error } = await supabase
  .from('profiles')
  .select('id, first_name, avatar_url')
  .like('avatar_url', 'data:image/%')
if (error) {
  console.error('ERROR: lecture profiles —', error.message)
  process.exit(1)
}

const heavy = (rows ?? []).filter((r) => (r.avatar_url?.length ?? 0) > URL_MAX_CHARS)
console.log(
  `${rows?.length ?? 0} avatar(s) inline, ${heavy.length} au-dessus de ${URL_MAX_CHARS} chars.`,
)

let ok = 0
for (const row of heavy) {
  const before = row.avatar_url.length
  const comma = row.avatar_url.indexOf(',')
  const input = Buffer.from(row.avatar_url.slice(comma + 1), 'base64')
  let out
  try {
    out = await sharp(input)
      .rotate() // applique l'orientation EXIF (photos en portrait)
      .resize(MAX_SIDE_PX, MAX_SIDE_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  } catch (err) {
    console.error(`  ✗ ${row.id} (${row.first_name ?? '?'}) : image illisible — ${err.message}`)
    continue
  }
  const next = `data:image/jpeg;base64,${out.toString('base64')}`
  console.log(
    `  ${APPLY ? '→' : '·'} ${row.id} (${row.first_name ?? '?'}) : ${(before / 1024).toFixed(0)} Ko → ${(next.length / 1024).toFixed(0)} Ko`,
  )
  if (!APPLY) continue
  const { error: upErr } = await supabase
    .from('profiles')
    .update({ avatar_url: next })
    .eq('id', row.id)
  if (upErr) {
    console.error(`  ✗ ${row.id} : écriture refusée — ${upErr.message}`)
    continue
  }
  ok += 1
}

if (APPLY) console.log(`${ok}/${heavy.length} avatar(s) réécrit(s).`)
else if (heavy.length) console.log('Relancer avec --apply pour écrire.')
