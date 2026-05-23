---
name: update-package
description: Spécialiste Popoth pour update un package npm. Recherche internet (release notes + breaking changes), vérification compat Next 16 / React 19 / TS strict, validation full pipeline (typecheck + lint + format + test + build + verify), commit Conventional. Stop pour confirmation uniquement sur major ou breaking changes détectés ; patch/minor sûrs roulent de bout en bout. Invoquer avec `/update-package <name>` ou `/update-package <name>@<version>` ou `/update-package` (j'interroge).
---

# Update Package Specialist — Popoth

Je suis le spécialiste pour update un package npm dans ce repo. Je connais la stack (Next 16.2.6, React 19.1.1, TS strict, pnpm 9.15.5, Vitest 4, Supabase), les pins (`pnpm.overrides` + `dependabot.yml` ignore), et les invariants critiques (0 `any`, 0 `as unknown as SupabaseClient`, 0 `declare global`, lint baseline 0/0).

## Mode d'invocation

- `/update-package <name>` → workflow complet (par défaut)
- `/update-package <name>@<version>` → cible une version précise (utile pour rollback ou pin)
- `/update-package` → je demande le nom

**Règle de stop** : je roule de bout en bout pour **patch + minor sans breaking détecté**. Je m'arrête pour confirmation utilisateur uniquement si :

1. Bump est **major** (X.y.z → X+1.0.0)
2. Release notes mentionnent **BREAKING CHANGE** / **migration required**
3. Package est dans `pnpm.overrides` (security pin — touche le faisait peut désaligner)
4. Package est dans `dependabot.yml` ignore (raison historique, à valider)
5. Validation échoue (typecheck/lint/test/build red) → présente le diff + options

---

## Workflow standard (8 phases)

### Phase 0 — Discovery

1. **Parse l'invocation** :
   - Si `<name>@<version>` → cible version exacte
   - Si `<name>` seul → je résoudrai à latest (Phase 1)
   - Si rien → `AskUserQuestion` "Quel package veux-tu update ?"

2. **Lis [package.json](../../../package.json)** pour identifier :
   - Version actuelle (cherche dans `dependencies` puis `devDependencies`)
   - Si caret (`^X.Y.Z`) vs pin (`X.Y.Z` exact)
   - Si présent dans `pnpm.overrides` (Phase 0.b)
   - Si membre d'un groupe Dependabot (cf. [.github/dependabot.yml](../../../.github/dependabot.yml) — `react-stack`, `radix-ui`, `supabase`, `eslint`, `test-stack`)

3. **Phase 0.b — Pins/overrides check** :
   - Si dans `pnpm.overrides` → l'override gagne sur les versions des sous-deps. Update du top-level peut être no-op si l'override est obsolète. **Note** : 13 overrides actifs sont des **security pins** (ajv, brace-expansion, glob, js-yaml, lodash, minimatch, picomatch, playwright, postcss, serialize-javascript, yaml) + 2 stack pins (react, react-dom 19.1.1).
   - Si dans `dependabot.yml` `ignore` → vérifie la raison (commentaire au-dessus). Aujourd'hui : `eslint-config-next >=16.0.0`. **Si l'utilisateur veut bypass cet ignore, demande confirmation explicite.**

4. **Identifie le scope** :
   - `dependencies` → runtime, impact prod
   - `devDependencies` → build/test/lint, impact CI
   - `pnpm.overrides` → security pin, peut nécessiter sync avec top-level

### Phase 1 — Pre-flight

Exécute en parallèle :

```bash
pnpm view <name> version              # latest sur le registre
pnpm view <name> versions --json      # toutes les versions dispo
pnpm view <name> repository.url       # URL GitHub pour Phase 2
pnpm view <name> homepage             # fallback si repo absent
pnpm outdated <name>                  # current vs wanted vs latest (Wanted = caret-respecting, Latest = absolute)
```

Calcule le **bump type** :

- **Patch** : `1.2.3 → 1.2.4` → safe à 99% (security/bugfix)
- **Minor** : `1.2.3 → 1.3.0` → safe en général, peut introduire dépréciations
- **Major** : `1.2.3 → 2.0.0` → **STOP gate** (Phase 3)

**Note 0.x.y** : tout bump `0.x.y → 0.(x+1).z` est traité comme **major** par convention semver (les `0.x` ne stabilisent pas l'API).

### Phase 2 — Research internet

**Objectif** : identifier breaking changes, migration steps, regressions connues.

**Stratégie A — GitHub Releases (préféré)** :

1. Depuis `repository.url` (Phase 1), construis :
   - `https://github.com/<owner>/<repo>/releases` (page de release récente)
   - `https://github.com/<owner>/<repo>/releases/tag/v<new-version>` (release notes spécifique)
   - `https://github.com/<owner>/<repo>/blob/main/CHANGELOG.md` (changelog complet — peut être `master` au lieu de `main`)

2. `WebFetch` la release page avec prompt ciblé :
   > "Extract breaking changes, migration steps, and known issues for version vX.Y.Z. Focus on TypeScript types, peer dependency updates, and API changes."

**Stratégie B — WebSearch (fallback)** :

Si WebFetch ne trouve rien ou que les releases sont vides (cas npm packages avec releases CI auto-générées) :

```
WebSearch "<package> v<new-version> breaking changes"
WebSearch "<package> changelog <new-version>"
WebSearch "<package> migration guide <new-major>"
```

**Stratégie C — Stack-aware checks** (toujours faire si applicable) :

- **React/Next.js ecosystem** : check compat React 19.1 + Next 16.2 (peer deps). Cherche issues GH ouvertes mentionnant "react 19" ou "next 16".
- **TypeScript-heavy** (`@types/*`, `zod`, `react-hook-form`, `@tanstack/react-query`) : check si nouvelle version casse les imports `import type` ou les inférences (TS strict mode + `verbatimModuleSyntax`).
- **Supabase** : `@supabase/supabase-js` >=2.105 a une raison historique d'ignore (cf. dependabot.yml). Si update touche ça, surface le risque.
- **Build tooling** (`next`, `tailwindcss`, `postcss`, `prettier`, `eslint*`) : risk de casser `pnpm build` ou `pnpm ci`.

**Output Phase 2** : résumé en 3-5 bullets :

```
Phase 2 — Research <package> X.Y.Z → A.B.C
• Bump type: <patch|minor|major>
• Breaking changes détectés: <oui/non + résumé>
• Compat Next 16 / React 19 / TS strict: <ok / risque <quoi>>
• Peer deps changements: <liste>
• Migration steps: <ou "aucune">
Source(s): <GH release URL | CHANGELOG.md | issue #N>
```

### Phase 3 — Decision gate

**Si patch OU minor sans breaking** → procède direct à Phase 4 (skip cette phase).

**Si major OU breaking détecté OU override/ignore touché** → `AskUserQuestion` avec contexte :

```
Question: "<package> X.Y.Z → A.B.C est un major bump avec breaking changes:
[résumé Phase 2]. Procéder ?"
Options:
  - Oui, update vers A.B.C (Recommended si compat ok)
  - Pin sur dernière minor sûre <X.(latest).z>
  - Skip pour maintenant + ajoute à dependabot.yml ignore
```

### Phase 4 — Update execution

**Cas standard (single package)** :

```bash
# Si dans dependencies:
pnpm add <name>@<version>

# Si dans devDependencies:
pnpm add -D <name>@<version>

# Pour la dernière minor compat (caret-respecting):
pnpm update <name>

# Pour latest exact:
pnpm add <name>@latest
```

**Cas spéciaux (cf. section "Cas spéciaux Popoth" ci-dessous)** :

- **react-stack** (react + react-dom + @types/react + @types/react-dom) → **DOIVENT être updatés ensemble**, sinon mismatch runtime non-typecheckable :

  ```bash
  pnpm add react@<v> react-dom@<v>
  pnpm add -D @types/react@<v> @types/react-dom@<v>
  ```

  Puis update `pnpm.overrides.react` + `pnpm.overrides.react-dom` à la nouvelle version pinned.

- **@radix-ui/\*** (group) → si user demande explicitement, update tout le groupe :

  ```bash
  pnpm update '@radix-ui/*' --latest
  ```

  Sinon, single package suffit.

- **@supabase/\*** → si on update `@supabase/supabase-js`, **régénère les types** :
  ```bash
  pnpm db:types
  pnpm db:check-types-fresh  # vérifie no drift
  ```

### Phase 5 — Validation pipeline

**Toujours dans cet ordre** (fail-fast) :

```bash
# 1. Re-resolve modules (parfois nécessaire après add/update)
pnpm install

# 2. Typecheck — BLOQUANT
pnpm typecheck

# 3. Lint — BLOQUANT (baseline 0/0 obligatoire)
pnpm lint:check

# 4. Format — BLOQUANT en CI
pnpm format:check

# 5. Tests — BLOQUANT (485 non-gated passants attendus)
pnpm test:run

# 6. Build — BLOQUANT (Turbopack prod)
pnpm build
```

**Si DB-related** (supabase, postgres, etc.) → enchaîne avec :

```bash
pnpm verify  # typecheck + test:run + 6 db:* checks fail-fast (~36s)
```

**Si l'un échoue** :

1. Capture l'erreur exacte (3-5 lignes max — ce qui matters)
2. Diagnostique :
   - **TS error** → API change ou type retiré. Cherche dans la release notes Phase 2 si mentionné. Sinon, surface au user.
   - **Lint error** → nouvelle rule activée par le package (ex: eslint-config-next minor bump). Fix si trivial, surface sinon.
   - **Test failure** → comportement changé. Surface le test name + diff.
   - **Build failure** → souvent peer dep mismatch ou import path changé. Check `pnpm ls <name>` pour voir dépendants.
3. **Décision** : fix-forward (si simple) OU rollback (`pnpm add <name>@<old-version>`) OU surface au user avec options.

### Phase 6 — Smoke test

**Toujours pour les packages frontend / UI / runtime** :

```bash
# Background pnpm dev
pnpm dev
```

Attends que le serveur réponde (~3-5s), puis :

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# Attendu: 200 ou 307 (redirect auth)
```

**Note** : sur Windows, `curl` peut être `curl.exe` ou indisponible — fallback `Invoke-WebRequest http://localhost:3000` via PowerShell.

Pour les **changements UI** (Radix, Tailwind, lucide-react, shadcn deps) — le typecheck ne couvre pas les régressions visuelles. **Dis explicitement à l'utilisateur** : "Le pipeline est vert mais je n'ai pas pu tester l'UI dans un navigateur. Lance `pnpm dev` et vérifie [features pertinentes pour ce package]". Ne déclare pas "tout marche" sans cette vérif manuelle.

### Phase 7 — Commit

**Convention** ([commitlint.config.js](../../../commitlint.config.js)) :

```bash
git add package.json pnpm-lock.yaml [autres fichiers touchés]
git commit -m "chore(deps): bump <name> from <old> to <new>"
```

Pour devDeps : `chore(deps-dev): bump ...`.

**Body si non-trivial** (major, peer changes, migration manuelle, override touché) :

```
chore(deps): bump <name> from X.Y.Z to A.B.C

- Breaking: <résumé Phase 2 breaking changes>
- Migration: <si manuelle>
- Verified: typecheck + lint + test + build (X/Y tests pass)
- [smoke test si fait]
```

**Ne PAS** push automatiquement — laisse l'utilisateur décider du push (CLAUDE.md system prompt : actions affecting shared state need confirmation).

### Phase 8 — Recovery (si validation Phase 5 fail)

**Decision tree** :

1. **Fix simple** (API rename, import path, 1-2 lignes) → fix-forward, re-run Phase 5. **Préfère ça à un revert.**
2. **Fix complexe** (>5 fichiers, refactor) → propose à l'utilisateur 2 chemins :
   - (a) Pin sur dernière version compat (`pnpm add <name>@<safe-version>`) + commit `chore(deps): re-pin <name> to <v>` (pattern miroir Sprint DX-Verify follow-up — react 7989ed2, supabase 3e37015)
   - (b) Continue le fix (estimer scope avant de plonger)
3. **Casse fondamentalement** (package abandonné, security CVE non-fixé) → propose un replacement ou ajoute à `dependabot.yml` ignore avec commentaire explicite (cf. règle `update-types` vs `versions` dans [.claude/conventions/git-workflow.md](../../conventions/git-workflow.md) §9).

**JAMAIS** :

- `git revert -m 1 <merge>` sur un merge Dependabot — les merges enchaînés touchent presque toujours le même lockfile, conflits quasi-garantis. Préfère **fix-forward** ou **re-pin**.
- `--no-verify` pour bypass les hooks pre-commit/pre-push si lint:check ou typecheck échoue — diagnostique le root cause.
- `--force` push.

---

## Cas spéciaux Popoth

### `react` + `react-dom` + `@types/react` + `@types/react-dom` (react-stack)

**Lockstep obligatoire** — un mismatch (e.g. react 19.2 + react-dom 19.1) est un **runtime crash**, pas une TS error. Le PR-time gate (`code-checks.yml`) ne l'attrape pas.

Workflow :

```bash
pnpm add react@<v> react-dom@<v>
pnpm add -D @types/react@<v> @types/react-dom@<v>
```

Puis met à jour `pnpm.overrides` dans package.json :

```json
"pnpm": {
  "overrides": {
    "react": "<v>",
    "react-dom": "<v>"
  }
}
```

Le override empêche `pnpm install` de re-résoudre react à une version supérieure si une sous-dep le tire (cas vu Sprint Zod-Rollout v5 où `pnpm add` a re-résolu react à 19.2.6 — fix : re-pin via override).

**Toujours** smoke test après (`pnpm dev` + page render).

### `@radix-ui/*` (group)

Dependabot groupe tous les `@radix-ui/*` dans un seul PR (`radix-ui` group dans dependabot.yml). Pour update manuel :

```bash
pnpm update '@radix-ui/*' --latest
```

**Sensible** : `<Dialog>` est utilisé dans 12 surfaces (Sprint Zod-Rollout v8 — focus trap natif + Esc + return-focus + role=dialog). Update major → smoke test obligatoire sur :

- AddTransactionModal (focus trap)
- PlanningDrawer + SavingsDistributionDrawer (drawer fullscreen via `DRAWER_CONTENT_CLASSES`)
- Nested modal (SavingsDistribution → transfer modal)

### `@supabase/supabase-js` + `supabase` CLI

**Toujours régénérer les types après update** :

```bash
pnpm db:types              # regen lib/database.types.ts
pnpm db:check-types-fresh  # exit 0 = synchro, 1 = drift
pnpm typecheck             # vérifie 0 régression sur les consumers
```

**Ignore rule historique** : avant Sprint Stabilize-Deps, `@supabase/supabase-js >=2.105` était bloqué (raison oubliée — vérifier git log si elle est encore active). Aujourd'hui (mai 2026), il est à 2.105.4 dans package.json, donc l'ignore est levée. Si elle réapparaît, traite avec prudence.

**Note overrides** : aucun `@supabase/*` dans `pnpm.overrides` actuellement. Pas de pin.

### `next` (Next.js)

**Très sensible** — l'app utilise App Router + Turbopack build + webpack dev. Update minor (16.2.6 → 16.3.x) : full pipeline + smoke. Update major (16 → 17) : **STOP gate** + recherche migration guide officielle (`https://nextjs.org/docs/app/building-your-application/upgrading`).

**Check spécifique** :

- `pnpm dev` doit démarrer (webpack mode)
- `pnpm build` doit terminer (Turbopack mode) — Turbopack a parfois des bugs sur major
- Middleware Edge runtime intact (cf. [middleware.ts](../../../middleware.ts) — pas de `fetch` self-call HTTP)

### `eslint-config-next`

**Ignore rule active** : `>=16.0.0` dans dependabot.yml. **Mais package.json est à 16.2.6** — la règle est probablement obsolète depuis Sprint 1 (Lint-Baseline-Cleanup). Surface ça à l'utilisateur si on touche eslint-config-next : "Le commentaire dependabot dit pinned à 15.0.0 mais on est à 16.2.6 — l'ignore rule devrait être assouplie ou supprimée."

**Si on bumpe** :

- `pnpm lint:check` doit rester 0/0 (lint baseline)
- Si nouvelle rule activée → fix les violations (préfère ça à `eslint-disable`)

### `tailwindcss` + `@tailwindcss/postcss` + `tw-animate-css`

Migration v3 → v4 livrée Sprint Tailwind-v4 (2026-05-14). Aujourd'hui CSS-first config dans [app/globals.css](../../../app/globals.css) `@theme {}` block. Update minor/patch : safe. Update major (v4 → v5) : **STOP gate**.

**Smoke** : check qu'aucune classe Tailwind ne disparaît dans les builds (lance `pnpm dev`, inspect une page).

### `vitest` + `@vitest/*` + `@testing-library/*` (test-stack)

Dependabot groupe `vitest` + `@vitest/*` (mais pas les `@testing-library/*` — incompat groupe). Update :

- Vitest a une config split `test.projects` (env=node `*.test.ts` / env=jsdom `*.test.tsx`) — sensible aux changements config.
- Après update : `pnpm test:run` doit retourner **485 non-gated passants + 89 gated skipped** (cf. CLAUDE.md §5.5).
- Si test count change → quelque chose a foiré (test silencieusement skippé OU added/removed).

### `jose` (JWT signing)

**Critique pour auth** ([lib/session.ts](../../../lib/session.ts)). Update major : **STOP gate** + smoke test login flow obligatoire (`pnpm dev` → page connexion → login flow complet).

### `zod`

**100% des routes API + 14 forms client** dépendent de Zod (cf. [.claude/conventions/zod-patterns.md](../../conventions/zod-patterns.md)). Update minor : safe. Update major : **STOP gate** + check si patterns A-H restent valides.

**Spécifique Zod 4** : `z.toJSONSchema()` natif est utilisé dans [lib/openapi/generate.ts](../../../lib/openapi/generate.ts). Vérifier que l'OpenAPI doc se génère.

### Packages dans `pnpm.overrides` (security pins)

Liste actuelle : `ajv@6`, `brace-expansion@1`, `brace-expansion@2`, `flatted`, `glob@10`, `js-yaml`, `lodash`, `minimatch@3`, `minimatch@9`, `picomatch@2`, `picomatch@4`, `playwright`, `postcss`, `serialize-javascript`, `yaml@2`.

Ces overrides forcent une version minimale pour fixer des CVE. **Quand un user veut update un de ceux-là** :

1. Vérifier que la nouvelle version est ≥ à l'override (sinon le override gagne, update top-level no-op)
2. Si la nouvelle version est strictement supérieure ET l'override n'est plus nécessaire (CVE patché en amont) → propose de drop l'override
3. Sinon → mettre à jour l'override + ajouter dans la même commit

**Source de la liste de pin** : probablement Sprint Stabilize-Deps (cf. CLAUDE.md §11 part 09 ou roadmap-detailed-09).

### `husky` + `lint-staged` + `prettier` + `prettier-plugin-tailwindcss`

Touchent les hooks pre-commit/pre-push. Update minor : safe. Update major : **STOP gate** + smoke `git commit` test (sur un fichier dummy).

### `@commitlint/cli` + `@commitlint/config-conventional`

Touchent le hook commit-msg. Update : tester avec un commit message volontairement non-conventional pour vérifier que le hook continue de bloquer.

---

## ❌ Pièges à éviter

1. **JAMAIS** `npm install` ou `yarn add` — toujours `pnpm` (le `packageManager` field locke à pnpm 9.15.5, et les hooks reposent sur lui).

2. **JAMAIS** `pnpm install --no-frozen-lockfile` sans raison explicite — le lockfile est canonique.

3. **JAMAIS** modifier `pnpm-lock.yaml` à la main.

4. **JAMAIS** `--no-verify` sur le commit pour bypass un lint/typecheck red — fix le root cause.

5. **JAMAIS** revert un merge Dependabot via `git revert -m 1 <sha>` — préfère fix-forward ou re-pin (cf. Phase 8 + [.claude/conventions/git-workflow.md](../../conventions/git-workflow.md) §9.4).

6. **JAMAIS** introduire un `any` ou un `as unknown as SupabaseClient` pour faire passer le typecheck après un update (CLAUDE.md §5.5 invariants).

7. **JAMAIS** ajouter un `eslint-disable` pour faire passer lint sans raison — préfère fix la violation. Si nécessaire, format obligatoire : `// eslint-disable-next-line <rule> -- <raison>` (cf. CLAUDE.md §6).

8. **JAMAIS** commiter `package.json` sans aussi commiter `pnpm-lock.yaml`.

9. **NE PAS** déclarer "tout marche" après typecheck/lint/test/build sans avoir smoke testé via `pnpm dev` (les régressions UI ne sont pas typecheckables — cf. CLAUDE.md system prompt "For UI or frontend changes, start the dev server").

10. **NE PAS** update plusieurs packages indépendants dans la même invocation — le skill est designed pour un seul package (ou groupe lockstep comme react-stack). Pour update bulk, fais N invocations.

11. **NE PAS** supposer que la doc `dependabot.yml` est à jour — vérifier le commentaire ET la version actuelle de package.json (drift connu sur eslint-config-next).

12. **NE PAS** ignorer les warnings de peer dependency au `pnpm install` — si une nouvelle warning apparaît après update, elle indique souvent un mismatch latent (e.g. react peer ≥18 mais package nécessite ≥19).

---

## Référence rapide

### Commands cheatsheet

| Action                      | Commande                                             |
| --------------------------- | ---------------------------------------------------- |
| Versions disponibles        | `pnpm view <name> versions --json`                   |
| Version installée vs latest | `pnpm outdated <name>`                               |
| Repo GitHub                 | `pnpm view <name> repository.url`                    |
| Quels packages dépendent    | `pnpm ls <name>` (transitive : `pnpm why <name>`)    |
| Add prod dep                | `pnpm add <name>@<version>`                          |
| Add dev dep                 | `pnpm add -D <name>@<version>`                       |
| Update sous caret           | `pnpm update <name>`                                 |
| Force latest                | `pnpm add <name>@latest`                             |
| Validation full             | `pnpm ci` (typecheck + lint + format + test + build) |
| Sanity sweep DB             | `pnpm verify`                                        |
| Regen Supabase types        | `pnpm db:types`                                      |
| Smoke dev                   | `pnpm dev` (background)                              |

### Validation gates (ordre fail-fast)

```
pnpm install      → re-resolve
pnpm typecheck    → 🔴 BLOQUANT
pnpm lint:check   → 🔴 BLOQUANT (baseline 0/0)
pnpm format:check → 🔴 BLOQUANT
pnpm test:run     → 🔴 BLOQUANT (485 + 89 skipped)
pnpm build        → 🔴 BLOQUANT
[pnpm verify]     → 🟡 si DB-related
[pnpm dev smoke]  → 🟡 si UI/runtime change
```

### Invariants Popoth à préserver

- 0 `any` (CLAUDE.md §5.5)
- 0 `as unknown as SupabaseClient`
- 0 `declare global`
- Lint baseline **0 errors / 0 warnings**
- Tests non-gated **447 passants**
- Tests gated **158 skipped** (sans env vars)
- 37 routes API
- 16 RPCs pinnées (`EXPECTED_RPCS` dans [scripts/check-rpcs.mjs](../../../scripts/check-rpcs.mjs))

### Conventional Commits format

```
chore(deps): bump <name> from <old> to <new>
chore(deps-dev): bump <name> from <old> to <new>
chore(deps): re-pin <name> to <version>     # rollback fix-forward
```

Body multi-ligne pour majors / overrides / migrations.

---

## Auto-check rapide avant de commencer

Avant de lancer le workflow, je vérifie l'état du repo :

```bash
git status              # working tree clean ?
git log -1 --oneline    # quel commit ?
```

Si dirty (uncommitted changes) → demande à l'utilisateur si je dois commit/stash avant ou si je peux interleaver. Refuse de update un package par-dessus du WIP non-tracké pour éviter une nuisance de diff.
