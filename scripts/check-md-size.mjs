#!/usr/bin/env node
// Enforce CLAUDE.md §1 + .claude/guardrails/size-policy.md cap (39500 chars)
// on all context .md files (CLAUDE.md + .claude/**/*.md).
//
// Modes:
//   node scripts/check-md-size.mjs                      Scan all context .md (pnpm verify)
//   node scripts/check-md-size.mjs <file> [<file>...]   Check given files (lint-staged)
//   node scripts/check-md-size.mjs --hook               Read tool payload on stdin (Claude Code PostToolUse)
//
// Exit codes:
//   0  OK
//   1  CLI violation (commit blocked)
//   2  Hook violation (Claude Code: stderr injected as model feedback)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const HARD_CAP = 39500

const toPosix = (p) => p.replace(/\\/g, '/')
const relFromRoot = (p) => toPosix(path.relative(repoRoot, path.resolve(p)))

function isContextMd(absOrRel) {
  const rel = relFromRoot(absOrRel)
  if (rel === 'CLAUDE.md') return true
  return rel.startsWith('.claude/') && rel.endsWith('.md')
}

function measureChars(absPath) {
  // Codepoint count (matches `LC_ALL=en_US.UTF-8 wc -m`), not bytes.
  return [...readFileSync(absPath, 'utf8')].length
}

function walkMd(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkMd(full, out)
    else if (name.endsWith('.md')) out.push(full)
  }
}

function allContextMd() {
  const out = [path.join(repoRoot, 'CLAUDE.md')]
  const claudeDir = path.join(repoRoot, '.claude')
  try {
    if (statSync(claudeDir).isDirectory()) walkMd(claudeDir, out)
  } catch {
    // .claude/ absent → only CLAUDE.md
  }
  return out
}

if (process.argv.includes('--hook')) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => (raw += chunk))
  process.stdin.on('end', () => {
    let payload
    try {
      payload = JSON.parse(raw || '{}')
    } catch {
      process.exit(0)
    }
    const filePath = payload?.tool_input?.file_path
    if (!filePath) process.exit(0)
    const abs = path.resolve(filePath)
    if (!isContextMd(abs)) process.exit(0)
    let chars
    try {
      chars = measureChars(abs)
    } catch {
      process.exit(0)
    }
    if (chars > HARD_CAP) {
      const rel = relFromRoot(abs)
      process.stderr.write(
        `[size-policy] ${rel} = ${chars} chars > ${HARD_CAP} cap (+${chars - HARD_CAP}). ` +
          `Voir .claude/guardrails/size-policy.md §3 — split required avant commit.\n`,
      )
      process.exit(2)
    }
    process.exit(0)
  })
} else {
  const argFiles = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const files = argFiles.length > 0 ? argFiles.filter(isContextMd) : allContextMd()

  const violations = []
  for (const f of files) {
    let chars
    try {
      chars = measureChars(f)
    } catch {
      continue
    }
    if (chars > HARD_CAP) violations.push({ file: f, chars })
  }

  if (violations.length === 0) {
    if (process.argv.includes('--verbose')) {
      console.log(
        `[size-policy] OK — ${files.length} fichier(s) .md de contexte scannés, tous ≤ ${HARD_CAP} chars.`,
      )
    }
    process.exit(0)
  }

  console.error(
    `[size-policy] FAIL — ${violations.length} fichier(s) .md de contexte au-dessus de ${HARD_CAP} chars :`,
  )
  for (const v of violations) {
    const rel = relFromRoot(v.file)
    console.error(`  ${rel.padEnd(60)} = ${v.chars} chars (+${v.chars - HARD_CAP})`)
  }
  console.error('Voir .claude/guardrails/size-policy.md §3 pour la procédure de split.')
  process.exit(1)
}
