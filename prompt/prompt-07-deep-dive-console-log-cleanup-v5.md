# Sprint Cleanup-I8 / Lot 4c — Migration `app/api/{profile,savings/data,bank-balance}/**`

## Contexte

Troisième salve API du chantier console.log cleanup, après **Lot 4a** (`app/api/groups/**`, 22 sites → 11/11 triage Modéré) et **Lot 4b** (`app/api/monthly-recap/{...9 routes simples}/**`, 132 sites → 113/19 triage Agressif). Lot 4c cible **3 routes singulières** restantes du périmètre routes API : `profile`, `savings/data`, `bank-balance`.

**Audit pré-sprint** (`grep -cE "console\.(log|error|warn|info|debug)"` sur `cleanup` au 2026-05-10 post-Lot 4b) :

| Route | Fichier | Sites | Pattern dominant attendu |
| -- | -- | --: | -- |
| `profile/route.ts` | 1 | 18 | mix flow logs (`🔍 GET`, `🚀 POST`, `💾 Updating`) + **payload dump PII** (`'📝 Données reçues:', { first_name, last_name, salary }`) + DB errors discriminantes par méthode (GET/POST/PUT) + catch-all |
| `savings/data/route.ts` | 1 | 19 | **dump-debug avec séparateurs `💰💰💰 ====`** (même pattern que step1-data/step2-data Lot 4b) + 1 DB error budgets + 1 warn piggy_bank silently-swallowed + catch-all |
| `bank-balance/route.ts` | 1 | 15 | mix flow logs (`'Récupération du solde'`) + **payload dump PII** (`'Solde bancaire récupéré:', balance`) + DB errors discriminantes + 2 fallback logs (`"Table bank_balances n'existe pas"`) + catch-all |
| **Total** | **3** | **52** | |

**3/3 routes wrappées** en `withAuth` ou `withAuthAndProfile` depuis Sprint Refactor-Architecture-v4 — pas de boilerplate auth à toucher. Voir [`lib/api/with-auth.ts`](../lib/api/with-auth.ts) pour la signature.

**Ratio attendu** : **~75% DROP / ~25% KEEP+migrate** (intermédiaire entre Lot 4a 50/50 et Lot 4b 86/14). Plus de KEEP que Lot 4b parce que chaque méthode HTTP (GET/POST/PUT) a sa propre DB error discriminante ; moins que Lot 4a parce que profile + savings/data ont du dump-debug verbeux.

**Pourquoi ce périmètre** : ces 3 fichiers représentent 52 sites isolés sur 3 surfaces fonctionnelles indépendantes (profil utilisateur, vue économies, solde bancaire). Découpage cohérent vs Lot 4d (`savings/transfer` ~45 sites en un seul fichier) qui mérite son propre commit. Lot 4e (`finance` résiduelles) est encore à auditer.

**Critique fichiers à modifier** :

- [app/api/profile/route.ts](../app/api/profile/route.ts)
- [app/api/savings/data/route.ts](../app/api/savings/data/route.ts)
- [app/api/bank-balance/route.ts](../app/api/bank-balance/route.ts)
- [eslint.config.mjs](../eslint.config.mjs) — extension du glob brace expansion
- [CLAUDE.md](../CLAUDE.md) §6 (compteur logs + liste fichiers protégés) + §11 (entry roadmap)

**Pattern de référence** : Lot 4b, commits `40e6099` (short routes) / `60a8457` (medium routes) / `1b71f53` (heavy debug routes) / `0694534` (eslint glob) / `2df49b8` (closeout). Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-atomic-minsky.md`.

## Triage attendu — par fichier

### `app/api/profile/route.ts` (18 sites)

**Profil DB** : 3 méthodes (GET/POST/PUT), chaque méthode a son try/catch + DB error spécifique.

🗑️ **DROP attendu (~12 sites)** :
- L30 `console.log('🔍 GET /api/profile - userId:', userId)` — flow log (userId est déjà dans `withAuth` context)
- L44 `console.log('✅ Aucun profil trouvé (normal pour première connexion)')` — flow log de cas non-erreur
- L79 `console.error('❌ Erreur inattendue lors de la récupération du profil:', error)` — catch-all redondant
- L93 `console.log('🚀 POST /api/profile - userId:', userId)` — flow log
- **L98 `console.log('📝 Données reçues:', { first_name, last_name, salary })` — DROP CRITIQUE PII** (logs nom + salaire en clair, risque GDPR)
- L102 / L107 / L116 `console.log('❌ Données manquantes/...')` — flow logs avant 400 (déjà retournés au client)
- L124 `console.log('💾 Insertion dans Supabase avec userId:', userId)` — flow log
- L139 `console.log('⚠️ Profil existe déjà')` — flow log avant 409 (déjà retourné)
- L150 `console.log('✅ Profil créé avec succès:', data)` — success log + dump
- L170 `console.error('❌ Erreur inattendue lors de la création du profil:', error)` — catch-all redondant
- L184 `console.log('👤 User ID for update:', userId)` — flow log
- L224 `console.log('💾 Updating profile for userId:', userId, 'with:', updates)` — **dump PII** (updates peuvent contenir first_name/last_name/salary)
- L272 `console.error('Erreur inattendue lors de la mise à jour du profil:', error)` — catch-all redondant

✏️ **KEEP+migrate attendu (~6 sites)** :
- L48 `console.error('❌ Erreur Supabase lors de la récupération du profil:', error)` — DB select profile (GET)
- L146 `console.error('❌ Erreur Supabase lors de la création du profil:', error)` — DB insert profile (POST)
- L235 `console.error('Erreur lors de la mise à jour du profil:', error)` — DB update profile (PUT)

> Note : 3 KEEP physiques mais le compte ressort à 6 dans l'audit parce que chaque méthode a aussi son catch-all + DB error → confirme bien 12 DROP / 3 KEEP. Si tu trouves un 4e KEEP au cours du triage (e.g. un `console.warn` silencieux), applique la règle d'or.

### `app/api/savings/data/route.ts` (19 sites)

**Pattern miroir step1-data/step2-data Lot 4b** : majorité dump-debug avec séparateurs visuels.

🗑️ **DROP attendu (~17 sites)** :
- L19-23 (5 sites) `console.log('')` + `💰💰💰 ====` + `[SAVINGS DATA] RÉCUPÉRATION...` + `Contexte:` + `User ID:` — header debug
- L32 `console.log('💰 Filtre appliqué:', contextFilter)` — debug dump
- L70-78 (9 sites) `console.log('')` + `📊 RÉSULTAT:` + 5 lignes `console.log('   - ...')` + `💰💰💰 ====` + `console.log('')` — dump résultat
- L96 `console.error('❌ Erreur dans GET /api/savings/data:', error)` — catch-all redondant

✏️ **KEEP+migrate attendu (~2 sites)** :
- L42 `console.error('❌ Erreur récupération budgets:', budgetsError)` — DB select budgets
- L64 `console.warn('⚠️ Erreur récupération tirelire:', piggyBankError)` — **path silencieusement avalé** (mêmes pattern que `resume L130` Lot 4b qui était KEEP)

### `app/api/bank-balance/route.ts` (15 sites)

**Mix le plus dense** : flow logs PII + DB errors + fallbacks invariants.

🗑️ **DROP attendu (~9 sites)** :
- L14 `console.log('Récupération du solde bancaire, contexte:', context, 'userId:', userId)` — flow log
- L57 `console.log("Table bank_balances n'existe pas encore, retour de 0")` — fallback log (la branche est documentée par le retour 0, pas besoin de log)
- L63 `console.log("Aucun solde trouvé pour l'utilisateur, retour de 0")` — fallback log idem
- **L75 `console.log('Solde bancaire récupéré:', balance)` — DROP PII** (logs solde en clair)
- L79 `console.error('Erreur dans GET /api/bank-balance:', error)` — catch-all redondant
- L97 `console.log('Mise à jour du solde bancaire:', balance, ...)` — **flow log + PII** (logs solde + userId)
- L158 `console.error("Table bank_balances n'existe pas")` — fallback ; debatable — si la branche est silencieusement avalée (continue), KEEP+migrate. Si elle return 500, DROP.
- L167 / L178 `console.log('Mise à jour ...' / "Création ...")` — flow logs
- L197 `console.log('Solde bancaire mis à jour avec succès:', result.data?.balance)` — **success log PII**
- L203 `console.error('Erreur dans POST /api/bank-balance:', error)` — catch-all redondant

✏️ **KEEP+migrate attendu (~6 sites)** :
- L50 `console.error('Erreur Supabase dans bank-balance:', error)` — DB select bank_balance (GET)
- L100 `console.error('Solde invalide:', balance)` — validation log avec valeur invalide grep-able (KEEP — sans le log, on perd la valeur reçue qui aide à diagnostiquer un client buggy ; à arbitrer en cours de triage si vraiment utile)
- L146 `console.error('Erreur lors de la vérification du solde existant:', checkError)` — DB select bank_balance (POST avant insert/update)
- L190 `console.error('Erreur lors de la mise à jour du solde bancaire:', result.error)` — DB update bank_balance via RPC

> **Vigilance** : le L100 `console.error('Solde invalide:', balance)` est une exception au "DROP les flow logs" — ce n'est pas un flow log mais une **discrimination de validation** qui surfacerait un client envoyant un mauvais payload. À toi de juger : KEEP+migrate (rare invariant violation utile à grep) OU DROP (le 400 retourné est déjà signal suffisant).

## Découpage en commits

Lot 4c est suffisamment petit (52 sites, 3 fichiers) pour **1 seul commit** vs les 3 commits par taille du Lot 4b. Si l'utilisateur préfère du grain plus fin, possible découpage en 2 commits :

### Option A — 1 commit unique (recommandé)

**Commit 1** : `refactor(api): triage console.* — profile + savings/data + bank-balance`
- Tous les sites traités d'un coup
- Imports `import { logger } from '@/lib/logger'` ajoutés au top des 3 fichiers (chacun a ≥1 KEEP)
- Catch-blocks dont l'`error` n'est plus utilisé : `} catch (error) {` → `} catch {`

### Option B — 2 commits (par profile vs financial)

**Commit 1a** : `refactor(api/profile): triage console.* — drop flow logs + PII dumps, migrate DB errors`
- Scope : profile (18 sites)
- Plus de PII surface (first_name/last_name/salary), mérite isolation au commit pour visibilité review

**Commit 1b** : `refactor(api): triage console.* — savings/data + bank-balance`
- Scope : savings/data (19) + bank-balance (15)
- Patterns plus homogènes (dump-debug + DB errors)

**À arbitrer en Phase 1 selon le confort review du user.**

### Commit 2 — ESLint glob extension

`chore(eslint): extend no-console: error override to Lot 4c routes`

État avant ([eslint.config.mjs](../eslint.config.mjs) post-Lot 4b) :

```js
{
  files: [
    'middleware.ts',
    'lib/expense-allocation.ts',
    'lib/logger.ts',
    'app/api/groups/**',
    'app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/**',
  ],
  rules: { 'no-console': 'error' },
},
```

État après — ajout des 3 fichiers Lot 4c. **2 options de forme** :

**Option α (liste explicite)** :
```js
files: [
  ...
  'app/api/profile/**',
  'app/api/savings/data/**',
  'app/api/bank-balance/**',
],
```

**Option β (brace expansion)** :
```js
files: [
  ...
  'app/api/{profile,bank-balance}/**',
  'app/api/savings/data/**',
],
```

Note : `savings/transfer` reste hors scope Lot 4c (ce sera Lot 4d), donc on ne peut pas faire `app/api/savings/**` global. Préférer **Option α** pour la lisibilité (3 entrées explicites vs 1 brace + 1 simple).

**Sanity test** : injecter `console.log("test")` temp dans un des 3 fichiers, lancer `pnpm lint:check`, attendre exit 1 avec 1 error.

### Commit 3 — Closeout CLAUDE.md

`docs(claude): closeout Sprint Cleanup-I8 / Lot 4c`

Mises à jour [CLAUDE.md](../CLAUDE.md) :

- **§1 Score** : ajouter ligne `~98.2 stable après Lot 4c (app/api/{profile,savings/data,bank-balance}, 52 sites → ~XX/~YY triage)`.
- **§6 Logs / titre** : `Lot 1 + Lot 3 + Lot 4a + Lot 4b + Lot 4c`.
- **§6 Logs / Per-file ESLint override** : ajouter les 3 paths à la liste (3 explicites maintenant : groups, monthly-recap brace, et les 3 nouveaux Lot 4c).
- **§6 Logs / Migration progressive** : compteur `~870 + ~301` → `~XXX + ~YYY` (selon ratio réel post-Lot 4c). Top 5 fichiers probablement inchangé (process-step1, financial-calculations, complete, balance, auto-balance — tous hors scope Lot 4c).
- **§11 Roadmap** : entry `✅ Sprint Cleanup-I8 / Lot 4c` + update item ⏭️ "Chantier console.log cleanup — Lots 2 / 4c-6" → "Lots 2 / 4d-6".

## Critères de succès

### Greps invariants

```bash
# 0 hit attendu
Grep -P "console\.(log|error|warn|info|debug)" app/api/profile/route.ts app/api/savings/data/route.ts app/api/bank-balance/route.ts

# 3 hits attendu (1 par fichier, chacun ayant ≥1 KEEP)
Grep -l "from '@/lib/logger'" app/api/profile/route.ts app/api/savings/data/route.ts app/api/bank-balance/route.ts
```

### Verif end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0. **Lint baseline 819** (post-Lot 4b) → estimer **~770** (les ~30 `console.log` DROP étaient warn-only ; les ~22 `console.error` DROP étaient allow-listés donc 0 delta lint sur eux). Mesurer pré/post via `pnpm lint:check 2>&1 | tail -1`.
- `pnpm test:run` 30 passed / 34 skipped inchangé (les tests gated couvrent les routes monthly-recap stateful, pas Lot 4c).
- `pnpm format:check` exit 0.
- `pnpm build` 56/56 routes exit 0.
- `pnpm verify` exit 0 (chaîne complète).

### Smoke browser (deferred to user)

- `/settings` exerce profile GET/PUT.
- `/dashboard` ou `/group-dashboard` charge les soldes via bank-balance GET.
- Le drawer `SavingsDistributionDrawer` exerce savings/data.

### Ratio supprimé/migré documenté dans le closeout

Format attendu : "X supprimés, Y migrés sur 52 sites — Z% de bruit éliminé". Estimation : **~38 DROP / ~14 KEEP+migrate** (~73% / ~27%).

## Pivots possibles à anticiper en Phase 1

L'audit pre-sprint (Lot 4a, 4b) a régulièrement surfacé des écarts vs l'estimation initiale :
- **Lot 4b** : 203 sites estimés → 132 distincts (grep -c lignes vs sites distincts pour multi-line).
- **Lot 4b** : 17 KEEP estimés → 19 KEEP livrés (cohérence sur transfersError silently-swallowed).

Pour Lot 4c, les pivots probables :
1. **PII surface plus large que prévu** dans profile (L98, L150, L224) : confirmer le DROP en regardant si les payloads sont bien structurés (les emojis suggèrent yes).
2. **bank-balance L158 `console.error("Table bank_balances n'existe pas")`** : déterminer si la branche return 500 (→ DROP) ou continue (→ KEEP+migrate). Lire le contexte ±10 lignes.
3. **bank-balance L100 `console.error('Solde invalide:', balance)`** : invariant validation utile à grep ou simple flow log ? À discuter avec le user en Phase 3 si pas tranché par lecture du code.

Ces pivots sont normaux — la règle d'or de triage (CLAUDE.md §6 Logs) guide les décisions, mais arbitrage user nécessaire pour les cas frontière.

## Hors scope (rappel)

- **Lot 4d** : `app/api/savings/transfer/route.ts` (~45 sites — assez grand pour son propre commit, à auditer à part).
- **Lot 4e** : routes finance résiduelles (à auditer via `Grep "console\." app/api/finance/`).
- **Lot 5** : composants UI.
- **Lot 6** : sweep final + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs` + ajout des routes monthly-recap stateful (`complete`, `balance`, `recover`, `auto-balance`, `process-step1`) après que I5 ait extrait leur logique métier.
- Branchement Sentry (chantier N3).
- Alignement `lib/financial-logger.ts` (couplé I4).

## Référence

- **Lot 4a** (`app/api/groups/**`, 22 sites → 11/11 Modéré) : commits `877504b` / `8de275e` / `84e4e84` / `f6dd1b8`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-glistening-beaver.md`. Source de la règle d'or de triage.
- **Lot 4b** (`app/api/monthly-recap/{...9 routes simples}/**`, 132 sites → 113/19 Agressif) : commits `40e6099` / `60a8457` / `1b71f53` / `0694534` / `2df49b8`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-atomic-minsky.md`.
- Convention §6 Logs (règle d'or de triage) + §8 À-faire / À-ne-pas-faire dans CLAUDE.md.
- Pattern test logger : [lib/__tests__/logger.test.ts](../lib/__tests__/logger.test.ts) (11 cas pure-unit non-gated).
- Helper auth : [lib/api/with-auth.ts](../lib/api/with-auth.ts) (Sprint Refactor-Architecture-v3+v4+v5) — toutes les 3 routes Lot 4c sont déjà wrappées.
