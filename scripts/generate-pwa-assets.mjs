#!/usr/bin/env node
/*
 * Génère les assets PWA depuis design/logo-source.png :
 *  - app/apple-icon.png (180×180) — icône d'écran d'accueil iPhone
 *  - public/splash/splash-WxH.png (10 tailles iPhone) — écran de chargement iOS
 *
 * Toutes les images sont composées avec le logo centré sur fond #0f172a
 * (= manifest.background_color, "bleu nuit"). Idempotent — relance écrase
 * les outputs.
 *
 * Usage : pnpm pwa:assets
 */

import sharp from 'sharp'
import { mkdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'

const ROOT = process.cwd()
const SOURCE = join(ROOT, 'design', 'logo-source.png')
const SPLASH_DIR = join(ROOT, 'public', 'splash')
const ICONS_DIR = join(ROOT, 'public', 'icons')
const APPLE_ICON = join(ROOT, 'app', 'apple-icon.png')

const BG_HEX = '#0f172a'

const SPLASH_SIZES = [
  { w: 750, h: 1334, device: 'iPhone SE 2/3' },
  { w: 1242, h: 2208, device: 'iPhone 8 Plus' },
  { w: 1125, h: 2436, device: 'iPhone X/XS/11 Pro' },
  { w: 828, h: 1792, device: 'iPhone XR/11' },
  { w: 1242, h: 2688, device: 'iPhone XS Max/11 Pro Max' },
  { w: 1080, h: 2340, device: 'iPhone 12/13 mini' },
  { w: 1170, h: 2532, device: 'iPhone 12/13/14/15' },
  { w: 1284, h: 2778, device: 'iPhone 12/13 Pro Max / 14 Plus' },
  { w: 1179, h: 2556, device: 'iPhone 14/15 Pro' },
  { w: 1290, h: 2796, device: 'iPhone 14/15 Pro Max' },
]

async function fileExists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{2}/g)
  if (!m || m.length < 3) throw new Error(`Bad hex ${hex}`)
  return {
    r: parseInt(m[0], 16),
    g: parseInt(m[1], 16),
    b: parseInt(m[2], 16),
  }
}

async function compose({ source, output, width, height, bg, logoRatio }) {
  const logoSize = Math.round(Math.min(width, height) * logoRatio)
  const logo = await sharp(source)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 },
    },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(output)
}

async function main() {
  if (!(await fileExists(SOURCE))) {
    console.error(`✗ Logo source manquant : ${SOURCE}`)
    console.error(`  Place un PNG haute-résolution (≥1024×1024) à ce chemin, puis relance.`)
    process.exit(1)
  }

  await mkdir(SPLASH_DIR, { recursive: true })
  await mkdir(ICONS_DIR, { recursive: true })
  await mkdir(dirname(APPLE_ICON), { recursive: true })

  const bg = hexToRgb(BG_HEX)

  console.log(`Composition sur fond ${BG_HEX} depuis ${SOURCE}`)

  console.log(`→ app/apple-icon.png (180×180)`)
  await compose({
    source: SOURCE,
    output: APPLE_ICON,
    width: 180,
    height: 180,
    bg,
    logoRatio: 0.7,
  })

  const ICON_192 = join(ICONS_DIR, 'icon-192x192.png')
  const ICON_512 = join(ICONS_DIR, 'icon-512x512.png')
  const ICON_512_MASKABLE = join(ICONS_DIR, 'icon-maskable-512x512.png')

  console.log(`→ public/icons/icon-192x192.png`)
  await compose({ source: SOURCE, output: ICON_192, width: 192, height: 192, bg, logoRatio: 0.7 })
  console.log(`→ public/icons/icon-512x512.png`)
  await compose({ source: SOURCE, output: ICON_512, width: 512, height: 512, bg, logoRatio: 0.7 })
  console.log(`→ public/icons/icon-maskable-512x512.png (safe zone 60%)`)
  await compose({
    source: SOURCE,
    output: ICON_512_MASKABLE,
    width: 512,
    height: 512,
    bg,
    logoRatio: 0.6,
  })

  for (const { w, h, device } of SPLASH_SIZES) {
    const out = join(SPLASH_DIR, `splash-${w}x${h}.png`)
    console.log(`→ ${out.replace(ROOT, '.')} (${device})`)
    await compose({
      source: SOURCE,
      output: out,
      width: w,
      height: h,
      bg,
      logoRatio: 0.3,
    })
  }

  console.log(`✓ apple-icon + 3 manifest icons + ${SPLASH_SIZES.length} splash screens générés.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
