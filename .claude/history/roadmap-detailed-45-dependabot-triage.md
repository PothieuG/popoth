# Part 45 — Triage Dependabot, tests sans env, worktrees (2026-09-30)

> 1 sprint (une session + 2 sessions parallèles lancées depuis elle). 17 alertes
> Dependabot fermées (10 initiales + 7 apparues au rescan de `main`), tests purs
> chargeables sans `.env.local` (cas de la CI), outillage qui ignore les
> worktrees Claude Code, CI de nouveau déclenchée sur push. Livré sur `dev` et
> `main` (fast-forward), 0 alerte ouverte en fin de journée.

## 1. Tests purs chargeables sans env — `24b516a`

**Symptôme** : sans `.env.local` (CI GitHub, Node 20, aucune variable Supabase),
4 fichiers échouaient à l'import : `lib/recap/__tests__/{actions-negative,
calculations,recovery,state}.test.ts`.

**Cause** : ils importaient le barrel `@/lib/recap`, qui ré-exporte
`check-status` / `load-summary`, qui chargent `lib/supabase-server.ts`. Son
`createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, …)` throw au load
(`supabaseUrl is required`) ; avec une URL factice il throw ensuite
`Node.js 20 detected without native WebSocket support` (`@supabase/realtime-js`).

**Correctif** (tests seulement, `supabase-server.ts` inchangé) :

- `calculations` / `recovery` / `state` : import direct du module pur
  (`@/lib/recap/calculations`, `…/recovery`, `…/state`, type depuis `…/types`).
- `actions-negative` : garde l'import via `actions-negative.ts` (il pinne la
  ré-export back-compat, cf. docstring de `deficit-math.test.ts`) +
  `vi.mock('@/lib/supabase-server', () => ({ supabaseServer: {} }))`.

`pnpm test:run` sans aucune variable : 1049 passed / 254 skipped (sur `dev`).

**Règle** : un test pur importe le module, jamais le barrel `@/lib/recap` ; un
test d'un module serveur stubbe `@/lib/supabase-server` (mock-per-site).

## 2. Worktrees Claude Code exclus d'ESLint et de Vitest — `e6072ec`, `a547343`

L'app desktop crée ses worktrees **dans** le repo (`.claude/worktrees/<nom>/`,
gitignored). Depuis le checkout principal :

- **ESLint** (`eslint .`, la flat config ne lit pas `.gitignore`) lintait le
  worktree ; les overrides par chemin (`scripts/**/*.mjs` → console autorisé) n'y
  matchent pas → ~170 faux `no-console`, **pre-push bloqué** sur `git push`.
  Fix : `.claude/worktrees/**` dans les `ignores` globaux d'`eslint.config.mjs`.
- **Vitest** collectait 868 des 1019 fichiers depuis le worktree (151 doublons
  du repo + 717 `*.test.ts` de paquets de son propre `node_modules` — les globs
  `exclude` sont relatifs à la racine). Fix : `.claude/worktrees/**` ajouté ; la
  liste, dupliquée dans les 3 `exclude` (racine + projets `unit`/`client`), est
  factorisée dans une constante `testExclude`.
- `pnpm typecheck` n'était pas affecté ; Prettier 3 lit `.gitignore`.

## 3. Triage Dependabot — 10 alertes → 0

10 alertes = 6 problèmes (Next.js compté deux fois : `package.json` + lockfile).
Branche par défaut GitHub = `main` ; `dev` avait le même lockfile.

| Paquet                      | Alertes    | Correctif                                          | Commit    |
| --------------------------- | ---------- | -------------------------------------------------- | --------- |
| `next`                      | 4 critical | 16.2.12 → 16.3.3 (+ `eslint-config-next` lockstep) | `1d8588d` |
| `vitest` + `@vitest/mocker` | 2 medium   | 4.1.6 → 4.1.11 (+ `@vitest/coverage-v8`)           | `b3b9bf2` |
| `fast-uri`                  | 1 high     | override `^3.1.5` → `^3.1.7` (résout 3.1.8)        | `412c7a6` |
| `browserslist`              | 2 high     | override `^4.28.7`, nouveau (résout 4.29.3)        | `412c7a6` |
| `baseline-browser-mapping`  | 1 medium   | override `^2.11.0`, nouveau (résout 2.11.26)       | `412c7a6` |

**Next.js** — GHSA-p293-qw3h-jr36 (RCE sur serveur Windows : le prod Vercel est
sous Linux, mais `pnpm dev`/`start` local sous Windows est la configuration
visée) et GHSA-2xp9-vwfh-vxw4 (RCE via optimisation d'images AVIF : ni
`next/image`, ni config `images`, ni fichier AVIF). Recherche via le skill
`/update-package` : mineure sans breaking ; dépréciations 16.3.0 (edge runtime,
`experimental.useCache`, middleware, options TS dépréciées) sans impact ;
16.3.1-16.3.2 backports ; 16.3.3 = les 2 fixes. 16.3.7 existait, resté en 16.3.3
(approuvé, aucune advisory). `pnpm add -E` pour garder les pins exacts (pas de
`.npmrc` → sinon `^`).

**Nouvelle règle lint** `@next/next/no-location-assign-relative-destination`
(eslint-config-next 16.3) — 6 warnings, baseline 0/0 :

- `app/connexion/page.tsx` : « Mot de passe oublié ? » / « Créer un compte »
  passent à `router.push` (pages publiques, aucune raison de recharger). Le test
  mocke déjà `useRouter().push`.
- `contexts/AuthContext.tsx` `handleLogout` (×2) : **reload complet gardé**,
  directive justifiée. Aucun `queryClient.clear()` dans le code : le reload est
  le seul mécanisme qui vide le cache TanStack Query de l'utilisateur précédent.
- `app/auth/confirm/page.tsx` redirections d'erreur (×2) : gardées, comportement
  épinglé par `page.test.tsx` (stub de `window.location.href`). `= next` n'est
  pas signalé (variable, pas un littéral relatif).

**Dependabot lui-même** — `8d4c63f` : `target-branch` pointait sur `cleanup`,
branche supprimée → plus aucune PR de version hebdo. Cible passée à `dev` (npm +
github-actions). Bloc `ignore` retiré : sa seule règle bloquait
`eslint-config-next >= 16.0.0` (« pinned to 15.0.0 », faux depuis longtemps) et
aurait empêché de le monter avec `next`. Les PRs de sécurité visent toujours la
branche par défaut (`main`) — doc GitHub `target-branch`.

**PR #45** (sharp 0.34.5 → 0.35.0, juillet) fermée avec commentaire : sharp déjà
en `^0.35.4` (devDependency + override).

**Rescan de `main` après la mise en prod** : 7 nouvelles alertes
`brace-expansion` (3 advisories publiées le 2026-09-29 — GHSA-6j4f-fj2g-mc7p,
GHSA-qhr7-859c-m2p7 high ; GHSA-q2hr-2g5m-vwhr medium ; DoS sur motifs
d'accolades). Tiré uniquement via `minimatch` (outillage eslint + build
next-pwa). `9e173a7` : overrides `brace-expansion@1/2/5` → `^1.1.21` /
`^2.1.7` / `^5.0.12`. Rescan final : **0 alerte ouverte**.

## 4. CI rebranchée sur push — session parallèle (`b39bbec`, `07b701f`)

`code-checks.yml` ne se déclenchait en push que sur `cleanup` (supprimée) :
aucun push n'avait été vérifié par la CI depuis le 2026-05-18 (seulement les
PRs). Trigger passé à `dev` + `main`, docs (CLAUDE.md §6, git-workflow §1/§9)
alignées. Premiers runs sur push (`9e173a7`, `dev` et `main`) : verts.

## 5. Mise en production

- `dev` puis `main` en fast-forward (historique de `main` linéaire), deux fois :
  `61bf84a..8d4c63f` (inclut Part 44) puis `8d4c63f..9e173a7`.
- **Avant le premier push sur `main`** : Part 44 embarque la migration
  `20260928000000_create_monthly_db_snapshots.sql`. Vérifié en lecture seule
  contre prod : `db:check-snapshots` OK, `db:check-rpcs` 28/28, `db:check-drift`
  OK → prod avait déjà la migration.
- Déploiements Vercel (`popoth_prod` + `popoth_dev`, Preview et Production) :
  tous `success`.

## 6. Pièges rencontrés

- **`pnpm build` exige l'env Supabase** (routes API chargées à la collecte des
  page data → `createClient` au load). Build/smoke local sans `.env.local` :
  valeurs factices (aucun secret) + `NODE_OPTIONS=--experimental-websocket`
  sous Node 20. Smoke `pnpm dev` via `.env.development.local` temporaire, port
  3100 lié à `127.0.0.1`, fichiers supprimés ensuite.
- **Push depuis le checkout principal après un fast-forward qui change le
  lockfile** : lancer `pnpm install --frozen-lockfile` d'abord — le pre-push lint
  tourne avec les paquets installés (ici l'ancien `eslint-config-next`, qui ne
  connaît pas la règle citée par les nouvelles directives).
- **Tests de focus instables** : `AddBudgetDialog` / `EditIncomeDialog`
  (« setFocus on invalid … ») échouent par intermittence, y compris avant toute
  modification et en isolation ; plus fréquent quand d'autres sessions font
  tourner la suite en parallèle. Correctif confié à une session dédiée.
- **Skill `/update-package`** : son texte date d'avant (ignore
  `eslint-config-next`, Next 16.2.6, 485 tests…) — à rafraîchir.
