---
name: update-package
description: Spécialiste Popoth pour update un package npm ou corriger une alerte Dependabot. Recherche internet (release notes + breaking changes), vérification compat Next 16 / React 19 / TS strict, validation full pipeline (typecheck + lint + format + test + build + verify), commit Conventional. Stop pour confirmation uniquement sur major ou breaking changes détectés ; patch/minor sûrs roulent de bout en bout. Invoquer avec `/update-package <name>` ou `/update-package <name>@<version>` ou `/update-package` (j'interroge).
---

# Update Package Specialist — Popoth

Je suis le spécialiste pour update un package npm dans ce repo. Je connais la stack (Next 16.3, React 19.1.1, TS strict, pnpm 9.15.5, Vitest 4.1, Supabase), les pins (`pnpm.overrides`, versions exactes de `package.json`), la config Dependabot et les invariants critiques (0 `any`, 0 `as unknown as SupabaseClient`, 0 `declare global`, lint baseline 0/0).

**Compteurs** (tests, routes, RPCs) : **jamais recopiés ici**, ils dérivent. Source de vérité = [CLAUDE.md](../../../CLAUDE.md) §5.5.

## Mode d'invocation

- `/update-package <name>` → workflow complet (par défaut)
- `/update-package <name>@<version>` → cible une version précise (utile pour rollback ou pin)
- `/update-package` → je demande le nom
- Correctif d'**alerte Dependabot** (souvent une dépendance transitive) → section « Correctif d'alerte Dependabot » plus bas.

**Règle de stop** : je roule de bout en bout pour **patch + minor sans breaking détecté**. Je m'arrête pour confirmation utilisateur uniquement si :

1. Bump est **major** (X.y.z → X+1.0.0)
2. Release notes mentionnent **BREAKING CHANGE** / **migration required**
3. Package est dans `pnpm.overrides` (pin de sécurité ou de stack — le toucher peut désaligner)
4. Package visé par une règle `ignore` de `dependabot.yml` (aucune depuis 2026-09-30 ; si une réapparaît, valider sa raison)
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
   - Si caret (`^X.Y.Z`) vs pin exact (`X.Y.Z` — cas de `next` et `eslint-config-next`)
   - Si présent dans `pnpm.overrides` (Phase 0.b)
   - Si membre d'un groupe Dependabot (cf. [.github/dependabot.yml](../../../.github/dependabot.yml) — `react-stack`, `radix-ui`, `supabase`, `eslint` (pattern `eslint*`, inclut donc `eslint-config-next`), `test-stack`)

3. **Phase 0.b — Pins/overrides check** :
   - Si dans `pnpm.overrides` → l'override gagne sur les versions des sous-deps. Update du top-level peut être no-op si l'override est obsolète. Contenu (28 entrées au 2026-09-30) : `react` / `react-dom` (pin de stack exact 19.1.1), `sharp`, et des **planchers de sécurité** pour des dépendances transitives, certains ciblés par majeure (`brace-expansion@1/@2/@5`, `minimatch@3/@9`, `picomatch@2/@4`…). **Lis la liste dans `package.json`**, pas dans ce texte.
   - `dependabot.yml` : plus aucun bloc `ignore` (retiré 2026-09-30). **Si l'utilisateur veut en ajouter un, demande confirmation explicite** et préfère `update-types` à `versions` (cf. Phase 8).

4. **Identifie le scope** :
   - `dependencies` → runtime, impact prod
   - `devDependencies` → build/test/lint, impact CI
   - `pnpm.overrides` → pin, peut nécessiter sync avec top-level

### Phase 1 — Pre-flight

Exécute en parallèle :

```bash
pnpm view <name> version              # latest sur le registre
pnpm view <name> versions --json      # toutes les versions dispo
pnpm view <name> repository.url       # URL GitHub pour Phase 2
pnpm view <name> homepage             # fallback si repo absent
pnpm outdated <name>                  # current vs wanted vs latest (Wanted = caret-respecting, Latest = absolute)
pnpm view <name>@<cible> peerDependencies --json
gh api "advisories?ecosystem=npm&affects=<name>@<cible>" --jq '.[] | .ghsa_id + " " + .summary'
```

Calcule le **bump type** :

- **Patch** : `1.2.3 → 1.2.4` → safe à 99% (security/bugfix)
- **Minor** : `1.2.3 → 1.3.0` → safe en général, peut introduire dépréciations
- **Major** : `1.2.3 → 2.0.0` → **STOP gate** (Phase 3)

**Note 0.x.y** : tout bump `0.x.y → 0.(x+1).z` est traité comme **major** par convention semver (les `0.x` ne stabilisent pas l'API).

**Correctif de sécurité** : cible ≥ première version patchée, et vérifie que la cible n'a **aucune** advisory (requête `affects` ci-dessus). Valide d'abord la requête sur la version vulnérable actuelle — elle doit lister l'advisory, sinon un résultat vide ne prouve rien. Si des patchs plus récents de la même mineure existent (ex. 16.3.3 demandé, 16.3.7 dispo), signale-les sans changer la cible approuvée.

### Phase 2 — Research internet

**Objectif** : identifier breaking changes, migration steps, regressions connues.

**Stratégie A — GitHub Releases via `gh` (préféré)** :

```bash
gh api "repos/<owner>/<repo>/releases/tags/v<X.Y.Z>" --jq .body > <scratchpad>/<name>-<X.Y.Z>.md
grep -inE "breaking|migrat|deprecat|removed|minimum|node" <scratchpad>/<name>-*.md
```

Couvre **toutes** les versions entre l'actuelle et la cible. Une release mineure peut peser ~100 Ko (Next 16.3.0) : ne la lis pas en entier, grep puis lis les lignes utiles. Pour chaque dépréciation trouvée, vérifie si le repo l'utilise (`next.config.js`, `tsconfig.json`, `export const runtime`, config ESLint…).

Fallback : `WebFetch` sur `https://github.com/<owner>/<repo>/releases/tag/v<X.Y.Z>` ou `.../blob/main/CHANGELOG.md` (peut être `master`) avec un prompt ciblé :

> "Extract breaking changes, migration steps, and known issues for version vX.Y.Z. Focus on TypeScript types, peer dependency updates, and API changes."

**Stratégie B — WebSearch (fallback)** :

Si les releases sont vides (cas npm packages avec releases CI auto-générées) :

```
WebSearch "<package> v<new-version> breaking changes"
WebSearch "<package> changelog <new-version>"
WebSearch "<package> migration guide <new-major>"
```

**Stratégie C — Stack-aware checks** (toujours faire si applicable) :

- **React/Next.js ecosystem** : check compat React 19.1 + Next 16.3 (peer deps). Cherche issues GH ouvertes mentionnant "react 19" ou "next 16".
- **TypeScript-heavy** (`@types/*`, `zod`, `react-hook-form`, `@tanstack/react-query`) : check si nouvelle version casse les imports `import type` ou les inférences (TS strict mode + `verbatimModuleSyntax`).
- **Supabase** : `@supabase/supabase-js` → régénérer les types (cf. Cas spéciaux) ; `lib/supabase-server.ts` crée le client au chargement du module, donc un changement de comportement au load casse tests et build.
- **Build tooling** (`next`, `tailwindcss`, `postcss`, `prettier`, `eslint*`) : risque de casser `pnpm build` ou `pnpm run ci`.

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

**Si major OU breaking détecté OU override/ignore touché** → `AskUserQuestion` avec contexte (vocabulaire métier, cf. [user-questions.md](../../conventions/user-questions.md)) :

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

# Pin EXACT à garder (next, eslint-config-next) — sans .npmrc, pnpm add écrit ^X.Y.Z :
pnpm add -E <name>@<version>

# Garder le style caret existant :
pnpm add -D <name>@^<version>

# Pour la dernière minor compat (caret-respecting):
pnpm update <name>
```

**Cas spéciaux (cf. section "Cas spéciaux Popoth" ci-dessous)** :

- **react-stack** (react + react-dom + @types/react + @types/react-dom) → **DOIVENT être updatés ensemble**, sinon mismatch runtime non-typecheckable :

  ```bash
  pnpm add react@<v> react-dom@<v>
  pnpm add -D @types/react@<v> @types/react-dom@<v>
  ```

  Puis update `pnpm.overrides.react` + `pnpm.overrides.react-dom` à la nouvelle version pinned.

- **next + eslint-config-next** → même version exacte, ensemble :

  ```bash
  pnpm add -E next@<v>
  pnpm add -D -E eslint-config-next@<v>
  ```

- **vitest + @vitest/coverage-v8** → ensemble (coverage-v8 exige la même version exacte de vitest en peer).

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
# 1. Re-resolve modules (surveille les warnings de peer deps)
pnpm install

# 2. Typecheck — BLOQUANT
pnpm typecheck

# 3. Lint — BLOQUANT (baseline 0/0 : 0 error ET 0 warning, exit 0 ne suffit pas)
pnpm lint:check

# 4. Format — BLOQUANT en CI
pnpm format:check

# 5. Tests — BLOQUANT. Compteurs attendus = CLAUDE.md §5.5 (inchangés sauf ajout/retrait de tests).
#    Doivent passer SANS .env.local, comme la CI.
pnpm test:run

# 6. Build — BLOQUANT (Turbopack prod)
pnpm build

# 7. Parité CI (le pre-commit passe Prettier sur le lockfile)
pnpm install --frozen-lockfile
```

**`pnpm build` a besoin de l'env Supabase** : les routes API chargent `lib/supabase-server.ts` pendant la collecte des page data (`supabaseUrl is required` sinon). Sans `.env.local` (cas d'un worktree Claude Code), valeurs **factices** inline + WebSocket natif pour `@supabase/realtime-js` sous Node 20 — **ne jamais lire ni copier `.env.local`** (CLAUDE.md §10) :

```bash
NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' NEXT_PUBLIC_SUPABASE_ANON_KEY='dummy' \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='dummy' SUPABASE_SERVICE_ROLE_KEY='dummy' \
JWT_SECRET_KEY='dummy-build-secret-not-real-000000000000' NODE_OPTIONS='--experimental-websocket' \
pnpm build
```

Attendu : build OK, nombre de routes API = CLAUDE.md §5.5.

**Si DB-related** (supabase, postgres, etc.) → enchaîne avec :

```bash
pnpm verify  # typecheck + format + test + check:md-size + 8 db:* (lecture seule, prod par défaut) — ~36s
```

**CI** ([code-checks.yml](../../../.github/workflows/code-checks.yml), PR + push `dev`/`main`) : frozen install + typecheck + lint + format + test. **Pas de build** — c'est à toi de le lancer.

**Si l'un échoue** :

1. Capture l'erreur exacte (3-5 lignes max — ce qui matters)
2. Diagnostique :
   - **TS error** → API change ou type retiré. Cherche dans la release notes Phase 2 si mentionné. Sinon, surface au user.
   - **Lint error/warning** → nouvelle rule activée par le package (ex. eslint-config-next 16.3 : `@next/next/no-location-assign-relative-destination`, 6 warnings). Fix si trivial ; si le comportement signalé est voulu, directive justifiée (format CLAUDE.md §6). Lis chaque site avant de trancher (cf. `eslint-config-next` plus bas). Une directive inutile ressort en warning « Unused eslint-disable directive ».
   - **Test failure** → comportement changé. Surface le test name + diff. ⚠️ Des tests de focus RTL de dialogs (`setFocus on invalid …`) échouent par intermittence, surtout quand d'autres sessions font tourner la suite en parallèle : relance le fichier seul, ou A/B avec et sans l'update (copies de `package.json`/lockfile dans le scratchpad + `pnpm install --frozen-lockfile`), avant de l'attribuer à l'update.
   - **Build failure** → souvent peer dep mismatch ou import path changé. Check `pnpm ls <name>` pour voir dépendants.
3. **Décision** : fix-forward (si simple) OU rollback (`pnpm add <name>@<old-version>`) OU surface au user avec options.

### Phase 6 — Smoke test

**Toujours pour les packages frontend / UI / runtime.**

`proxy.ts` charge `supabase-server` au démarrage : sans env, **chaque requête plante**. Sans `.env.local` :

1. `.env.development.local` **temporaire** (gitignored via `.env*.local`) avec les valeurs factices ci-dessus (+ `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100`).
2. Lance via `preview_start` (le panneau navigateur, pas Bash) avec un `.claude/launch.json` **temporaire** (non gitignored → ne pas le stager) :
   ```json
   {
     "version": "0.0.1",
     "configurations": [
       {
         "name": "popoth-smoke-3100",
         "runtimeExecutable": "node",
         "runtimeArgs": [
           "--experimental-websocket",
           "node_modules/next/dist/bin/next",
           "dev",
           "--webpack",
           "-H",
           "127.0.0.1",
           "-p",
           "3100"
         ],
         "port": 3100,
         "url": "http://127.0.0.1:3100"
       }
     ]
   }
   ```
   Port 3100 + `127.0.0.1` : pas de conflit avec un `pnpm dev` du user sur 3000, rien d'exposé sur le réseau.
3. Vérifie : logs serveur (version Next affichée, 0 erreur), `/` → `/connexion`, `/dashboard` → `/connexion?from=%2Fdashboard`, console navigateur sans erreur, + les écrans touchés par l'update.
4. `preview_stop`, puis supprime les 2 fichiers temporaires.

Les valeurs factices ne permettent pas de se connecter. Pour les **changements UI** (Radix, Tailwind, lucide-react, shadcn deps) ou tout ce qui passe par un login — le typecheck ne couvre pas les régressions visuelles. **Dis explicitement à l'utilisateur** : "Le pipeline est vert mais je n'ai pas pu tester [écrans] avec un vrai compte. Vérifie [features pertinentes pour ce package] sur le déploiement dev." Ne déclare pas "tout marche" sans cette vérif.

### Phase 7 — Commit

**Convention** ([commitlint.config.js](../../../commitlint.config.js)) :

```bash
git add package.json pnpm-lock.yaml [autres fichiers touchés]
git commit -m "chore(deps): bump <name> from <old> to <new>"
```

Pour devDeps : `chore(deps-dev): bump ...`. Lockstep (next + eslint-config-next, vitest + coverage-v8) : **un seul commit**. Les correctifs de lint rendus nécessaires par l'update vont **dans le même commit** (chaque commit garde lint 0/0).

**Body si non-trivial** (major, peer changes, migration manuelle, override touché, advisory corrigée) :

```
chore(deps): bump <name> from X.Y.Z to A.B.C

- Advisory: <GHSA-… + sévérité + exposition réelle>
- Breaking: <résumé Phase 2 breaking changes>
- Migration: <si manuelle>
- Verified: typecheck + lint 0/0 + test (X passed / Y skipped) + build
- [smoke test si fait]
```

**Ne PAS** push automatiquement — laisse l'utilisateur décider du push (actions affecting shared state need confirmation). S'il le demande : section « Livraison » plus bas.

### Phase 8 — Recovery (si validation Phase 5 fail)

**Decision tree** :

1. **Fix simple** (API rename, import path, 1-2 lignes) → fix-forward, re-run Phase 5. **Préfère ça à un revert.**
2. **Fix complexe** (>5 fichiers, refactor) → propose à l'utilisateur 2 chemins :
   - (a) Pin sur dernière version compat (`pnpm add <name>@<safe-version>`) + commit `chore(deps): re-pin <name> to <v>` (pattern miroir Sprint DX-Verify follow-up — react 7989ed2, supabase 3e37015)
   - (b) Continue le fix (estimer scope avant de plonger)
3. **Casse fondamentalement** (package abandonné, security CVE non-fixé) → propose un replacement ou ajoute à `dependabot.yml` un `ignore` avec commentaire explicite. Préfère `update-types: ["version-update:semver-major"]` : une règle `versions: [...]` bloque **aussi** les PRs de sécurité (cf. [git-workflow.md](../../conventions/git-workflow.md) §9).

**JAMAIS** :

- `git revert -m 1 <merge>` sur un merge Dependabot — les merges enchaînés touchent presque toujours le même lockfile, conflits quasi-garantis. Préfère **fix-forward** ou **re-pin**.
- `--no-verify` pour bypass les hooks pre-commit/pre-push si lint:check ou typecheck échoue — diagnostique le root cause.
- `--force` push.

---

## Correctif d'alerte Dependabot

1. **Liste** : `gh api "repos/PothieuG/popoth/dependabot/alerts?state=open&per_page=100"`. Une alerte par manifeste (`package.json` + `pnpm-lock.yaml`) → regroupe par advisory avant de compter les problèmes réels. Les alertes portent sur la branche par défaut **`main`** ; compare son lockfile à celui de `dev`.
2. **Dépendance directe** → workflow standard ci-dessus.
3. **Dépendance transitive** :
   - Chemin : `pnpm why <pkg> --depth 6` (qui la tire ? runtime ou seulement build/lint/test ?).
   - Override **borné à la majeure** : `"<pkg>": "^<première-version-patchée>"`. Si plusieurs majeures coexistent, une clé par majeure (`"<pkg>@2": "^2.1.7"`). Garde l'ordre alphabétique de `pnpm.overrides`.
   - `pnpm install`, puis vérifie les versions résolues : `grep -oE "^  '?<pkg>@[0-9][^':]*" pnpm-lock.yaml | sort -u`, et **0 advisory** sur chacune (`gh api "advisories?ecosystem=npm&affects=<pkg>@<v>"`).
   - Un lot d'overrides pour une même vague d'alertes = **un commit** (exception au « un package par invocation »).
4. **Exposition réelle** à évaluer et à écrire dans le commit : prod Vercel (Linux) vs `pnpm dev` local (Windows) ; code exécuté en prod vs seulement outillage de build/lint ; entrée contrôlée par un attaquant ou non.
5. **Fermeture** : une alerte ne se ferme qu'une fois le correctif sur `main`. Le rescan au push peut **ouvrir de nouvelles alertes** (advisories publiées entre-temps — vu le 2026-09-30 : 7 `brace-expansion`) → relancer la liste après chaque push sur `main`.
6. **Config Dependabot** : PRs de version → `dev` (`target-branch`) ; PRs de sécurité → toujours la branche par défaut (`main`). Aucun `ignore`. Le groupe `eslint` (`eslint*`) inclut `eslint-config-next` : Dependabot ouvre donc `next` et `eslint-config-next` dans des PRs séparées → les réaligner à la main (même version exacte).

## Livraison (uniquement sur demande explicite du user)

- **Worktree Claude Code** : branche depuis `origin/dev` avec `git switch --no-track -c <branche> origin/dev` (sinon l'upstream devient `origin/dev` et un `git push` nu partirait sur `dev`). Un worktree neuf n'a pas de `node_modules` → `pnpm install --frozen-lockfile` avant tout.
- **Fast-forward `dev`** (le checkout principal est d'habitude sur `dev`) : vérifier qu'il est propre et que `origin/dev` n'a pas bougé, `git -C <checkout principal> merge --ff-only <branche>`, puis **si le lockfile a changé** `pnpm install --frozen-lockfile` dans le checkout principal **avant** le push — le pre-push lint tourne avec les paquets installés (un ancien `eslint-config-next` ne connaît pas les règles citées par de nouvelles directives).
- **`main`** : historique linéaire, fast-forward depuis la même branche. Si la release embarque une **migration**, vérifier d'abord en lecture seule que prod l'a (`pnpm db:check-drift`, `db:check-rpcs`, `db:check-snapshots`… ciblent prod par défaut). Ne pas laisser `main` checkout dans le worktree après le push.
- **Après push** : déploiements Vercel (`gh api "repos/PothieuG/popoth/deployments?sha=<sha>"` puis `/deployments/<id>/statuses`), run CI (`gh run list --workflow code-checks.yml --commit <sha>`), alertes ouvertes. Les noms d'environnement contiennent des espaces (`Production – popoth_prod`) : parser en TSV (`while IFS=$'\t' read -r …`), pas en boucle `for` sur des mots.

---

## Cas spéciaux Popoth

### `react` + `react-dom` + `@types/react` + `@types/react-dom` (react-stack)

**Lockstep obligatoire** — un mismatch (e.g. react 19.2 + react-dom 19.1) est un **runtime crash**, pas une TS error. La CI (`code-checks.yml`) ne l'attrape pas.

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
pnpm db:types              # regen lib/database.types.ts (hardcodé prod)
pnpm db:check-types-fresh  # exit 0 = synchro, 1 = drift
pnpm typecheck             # vérifie 0 régression sur les consumers
```

`lib/supabase-server.ts` appelle `createClient` **au chargement du module** : sous Node 20, `@supabase/realtime-js` exige un WebSocket natif (`--experimental-websocket`) dès qu'une URL est fournie. Après update, `pnpm test:run` **sans env** doit rester vert (les tests purs n'importent pas `supabase-server`, cf. CLAUDE.md §9) et le build avec valeurs factices doit passer.

Pas d'`@supabase/*` dans `pnpm.overrides`, pas de règle `ignore`.

### `next` (Next.js)

**Très sensible** — l'app utilise App Router + Turbopack build + webpack dev. Update minor (16.3 → 16.4) : full pipeline + smoke. Update major (16 → 17) : **STOP gate** + recherche migration guide officielle (`https://nextjs.org/docs/app/building-your-application/upgrading`). Toujours en lockstep avec `eslint-config-next` (même version exacte, `pnpm add -E`).

**Check spécifique** :

- `pnpm dev` doit démarrer (webpack mode) — les logs affichent la version
- `pnpm build` doit terminer (Turbopack mode) — Turbopack a parfois des bugs sur major
- [proxy.ts](../../../proxy.ts) intact (ex-`middleware.ts`, renommé au passage à Next 16, runtime nodejs — pas de `fetch` self-call HTTP)
- Dépréciations de la version vs la config du repo : `next.config.js` (pas de flag `experimental`), `tsconfig.json` (`baseUrl` n'est déprécié qu'à partir de TS 6), aucun `export const runtime = 'edge'`

### `eslint-config-next`

Lockstep avec `next` (même version exacte). Plus de règle `ignore` Dependabot depuis 2026-09-30.

**Si on bumpe** :

- `pnpm lint:check` doit rester 0/0 (warnings compris)
- Une mineure peut activer de nouvelles règles (16.3 : `@next/next/no-location-assign-relative-destination`) → fix les violations (préfère ça à une directive)
- ⚠️ Les `window.location.href` du logout ([AuthContext.tsx](../../../contexts/AuthContext.tsx)) et d'[auth/confirm](../../../app/auth/confirm/page.tsx) sont **volontaires** : le reload complet est le seul mécanisme qui vide le cache TanStack Query de l'utilisateur précédent ; `auth/confirm` est épinglé par son test. Ne pas les convertir en `router.push` (CLAUDE.md §8 ❌).

### `tailwindcss` + `@tailwindcss/postcss` + `tw-animate-css`

Migration v3 → v4 livrée Sprint Tailwind-v4 (2026-05-14). Aujourd'hui CSS-first config dans [app/globals.css](../../../app/globals.css) `@theme {}` block. Update minor/patch : safe. Update major (v4 → v5) : **STOP gate**.

**Smoke** : check qu'aucune classe Tailwind ne disparaît dans les builds (lance `pnpm dev`, inspect une page).

### `vitest` + `@vitest/*` + `@testing-library/*` (test-stack)

Dependabot groupe `vitest` + `@vitest/*` (mais pas les `@testing-library/*` — incompat groupe). Update :

- `@vitest/coverage-v8` exige la même version exacte de `vitest` → bump ensemble.
- Vitest a une config split `test.projects` (env=node `*.test.ts` / env=jsdom `*.test.tsx`) + une liste `testExclude` partagée (qui exclut `.claude/worktrees/**`) dans [vitest.config.mts](../../../vitest.config.mts) — sensible aux changements config.
- Après update : `pnpm test:run` doit retourner les compteurs de CLAUDE.md §5.5 ; si le compte change → quelque chose a foiré (test silencieusement skippé OU added/removed). Lance aussi `pnpm test:coverage` pour valider le provider.

### `jose` (JWT signing)

**Critique pour auth** ([lib/session.ts](../../../lib/session.ts)). Update major : **STOP gate** + smoke test login flow obligatoire (`pnpm dev` → page connexion → login flow complet, donc avec un vrai compte : à faire par le user).

### `zod`

**100% des routes API + 14 forms client** dépendent de Zod (cf. [.claude/conventions/zod-patterns.md](../../conventions/zod-patterns.md)). Update minor : safe. Update major : **STOP gate** + check si patterns A-H restent valides.

**Spécifique Zod 4** : `z.toJSONSchema()` natif est utilisé dans [lib/openapi/generate.ts](../../../lib/openapi/generate.ts). Vérifier que l'OpenAPI doc se génère.

### Packages dans `pnpm.overrides`

Trois familles (liste à jour : `package.json` → `pnpm.overrides`) :

- **Pins de stack** : `react`, `react-dom` (exacts, cf. react-stack).
- **Planchers de sécurité** pour des dépendances transitives (CVE) : `"<pkg>": "^<patché>"`, ou `"<pkg>@N"` quand plusieurs majeures coexistent.
- **Divers** : `sharp` (aussi en devDependency).

**Quand un user veut update un de ceux-là** :

1. Vérifier que la nouvelle version est ≥ à l'override (sinon le override gagne, update top-level no-op)
2. Drop d'un override seulement si **toutes** les résolutions restent ≥ la version patchée sans lui (vérifier `pnpm why <pkg>` + lockfile après suppression)
3. Sinon → mettre à jour l'override dans le même commit

### `husky` + `lint-staged` + `prettier` + `prettier-plugin-tailwindcss`

Touchent les hooks pre-commit/pre-push. Update minor : safe. Update major : **STOP gate** + smoke `git commit` test (sur un fichier dummy). Note : lint-staged ne formate pas les `.mts` (globs `*.{mjs,cjs,js}`) — `pnpm format:check` les couvre.

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

9. **JAMAIS** `pnpm ci` pour valider : c'est une commande **pnpm**, pas le script `ci` du repo. Sous pnpm 9.15.5 elle échoue (`ERR_PNPM_CI_NOT_IMPLEMENTED`) ; sous un pnpm récent (12.x) elle fait `clean` + install frozen et **vide `node_modules`**. Le pipeline complet = **`pnpm run ci`**.

10. **JAMAIS** lire, afficher ou copier `.env.local` (ni un autre secret) pour faire passer un build/smoke — valeurs factices (Phase 5-6).

11. **NE PAS** déclarer "tout marche" après typecheck/lint/test/build sans avoir smoke testé via `pnpm dev` (les régressions UI ne sont pas typecheckables).

12. **NE PAS** update plusieurs packages indépendants dans la même invocation — le skill est designed pour un seul package (ou groupe lockstep comme react-stack). Exception : un lot d'overrides de sécurité pour une même vague d'alertes.

13. **NE PAS** supposer que ce fichier, `dependabot.yml` ou leurs commentaires sont à jour — vérifier contre `package.json` et CLAUDE.md §5.5.

14. **NE PAS** ignorer les warnings de peer dependency au `pnpm install` — si une nouvelle warning apparaît après update, elle indique souvent un mismatch latent (e.g. react peer ≥18 mais package nécessite ≥19).

15. **NE PAS** utiliser `git stash` nu pour un A/B : le stash est partagé entre tous les worktrees (et d'autres sessions). Copie les fichiers dans le scratchpad, ou fais un commit WIP.

---

## Référence rapide

### Commands cheatsheet

| Action                      | Commande                                                       |
| --------------------------- | -------------------------------------------------------------- |
| Versions disponibles        | `pnpm view <name> versions --json`                             |
| Version installée vs latest | `pnpm outdated <name>`                                         |
| Repo GitHub                 | `pnpm view <name> repository.url`                              |
| Release notes               | `gh api repos/<owner>/<repo>/releases/tags/v<v> --jq .body`    |
| Advisories d'une version    | `gh api "advisories?ecosystem=npm&affects=<name>@<v>"`         |
| Alertes Dependabot ouvertes | `gh api "repos/PothieuG/popoth/dependabot/alerts?state=open"`  |
| Quels packages dépendent    | `pnpm ls <name>` (transitive : `pnpm why <name>`)              |
| Versions résolues (lock)    | `grep -oE "^  '?<name>@[0-9][^':]*" pnpm-lock.yaml \| sort -u` |
| Add prod dep                | `pnpm add <name>@<version>` (`-E` pour un pin exact)           |
| Add dev dep                 | `pnpm add -D <name>@<version>`                                 |
| Update sous caret           | `pnpm update <name>`                                           |
| Validation full             | `pnpm run ci` (typecheck + lint + format + test + build)       |
| Sanity sweep DB             | `pnpm verify`                                                  |
| Regen Supabase types        | `pnpm db:types`                                                |
| Smoke dev                   | `preview_start` (port 3100, cf. Phase 6)                       |

### Validation gates (ordre fail-fast)

```
pnpm install                  → re-resolve
pnpm typecheck                → 🔴 BLOQUANT
pnpm lint:check               → 🔴 BLOQUANT (baseline 0/0, warnings compris)
pnpm format:check             → 🔴 BLOQUANT
pnpm test:run                 → 🔴 BLOQUANT (compteurs CLAUDE.md §5.5, sans .env.local)
pnpm build                    → 🔴 BLOQUANT (env factice si pas de .env.local)
pnpm install --frozen-lockfile → 🔴 parité CI
[pnpm verify]                 → 🟡 si DB-related
[smoke dev]                   → 🟡 si UI/runtime change
```

### Invariants Popoth à préserver

Tableau complet et chiffres à jour : **CLAUDE.md §5.5**. À ne jamais dégrader par un update : 0 `any`, 0 `as unknown as SupabaseClient`, 0 `declare global`, lint **0 errors / 0 warnings**, compteurs de tests non-gated / gated inchangés, nombre de routes API au build, `EXPECTED_RPCS` ([scripts/check-rpcs.mjs](../../../scripts/check-rpcs.mjs)).

### Conventional Commits format

```
chore(deps): bump <name> from <old> to <new>
chore(deps-dev): bump <name> from <old> to <new>
chore(deps): pin patched <pkg-a>, <pkg-b> and <pkg-c>   # overrides de sécurité
chore(deps): re-pin <name> to <version>                 # rollback fix-forward
```

Body multi-ligne pour majors / overrides / migrations / advisories.

---

## Auto-check rapide avant de commencer

Avant de lancer le workflow, je vérifie l'état du repo :

```bash
git status              # working tree clean ?
git log -1 --oneline    # quel commit ? (worktree : partir de origin/dev à jour)
ls node_modules >/dev/null 2>&1 || pnpm install --frozen-lockfile   # worktree neuf
```

Si dirty (uncommitted changes) → demande à l'utilisateur si je dois commit avant ou si je peux interleaver. Refuse de update un package par-dessus du WIP non-tracké pour éviter une nuisance de diff.
