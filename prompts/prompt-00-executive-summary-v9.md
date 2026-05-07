# Sprint Polish-CI — small fixes surfaced by Sprint Cleanup-Legacy

## Contexte

Le **Sprint Cleanup-Legacy** ([prompt-00-executive-summary-v8.md](prompt-00-executive-summary-v8.md), livré 2026-05-07) a refermé C1–C3 en 4 commits sur `cleanup` (`6482c57 → a18e608`) et fait passer le score audit de ~76 à ~77/100. Pendant l'exécution, **plusieurs petites améliorations surfacées** n'étaient pas dans le scope du sprint et restent à traiter :

1. **`pnpm db:types` pollue le fichier généré** quand on redirige sa sortie. Le wrapper pnpm écrit `> popoth-app-claude@0.1.0 db:types ...` en tête du fichier `lib/database.types.ts`, ce qui casse le typecheck immédiatement après. Workaround utilisé pendant C1 : appeler `pnpm supabase gen types typescript --linked --schema public > lib/database.types.ts` directement.

2. **Drift detector faux positif sur Windows** après un `git checkout` entre branches. Sur Windows avec `core.autocrlf=true`, le working copy reçoit des fins de ligne CRLF tandis que `buildBaseline()` (dans `scripts/export-schema.mjs`) génère du LF en mémoire. Le détecteur compare bytes-à-bytes et signale chaque ligne comme différente. Bug Windows-only — la CI Linux n'est pas affectée.

3. **`lib/database.ts` est redevenu redondant.** Avant Sprint Cleanup-Legacy, ce fichier augmentait `Database` avec les 4 RPC C3 absentes des types générés (car `GRANT EXECUTE TO service_role` only). Mais le `pnpm db:types` régénéré pendant C1 inclut maintenant ces 4 RPC. L'augmentation devient une intersection no-op qui narrow `string | null | undefined` → `string | undefined`. Code mort qui complique la lecture.

4. **Le PR-time gate ne surveille pas ses propres YAML.** Sprint Cleanup-Legacy / C3 a découvert que `db-drift-pr.yml` et `db-drift-check.yml` étaient cassés depuis B3 (3 commits avant) — le `pnpm/action-setup@v4` se prenait les pieds dans `packageManager`, et le secret `SUPABASE_ACCESS_TOKEN` avait été perdu lors du rename `Popoth_App_Claude → popoth`. Le path filter du gate liste `supabase/migrations/**` + `scripts/check-*.mjs` + `scripts/export-schema.mjs` + `scripts/dump-functions.sql` mais PAS les YAML eux-mêmes. Si quelqu'un repète l'erreur, le gate ne se redéclenche pas pour la signaler.

5. **Le cron weekly `db-drift-check.yml` n'a jamais réellement tourné depuis B3.** Le fix pnpm/action-setup C3 résout aussi son problème, mais aucune validation `workflow_dispatch` n'a été faite. Tant qu'on ne déclenche pas manuellement le cron, on ne saura pas avant lundi prochain s'il marche.

6. **GitHub Actions Node.js 20 deprecation** (juin 2026). `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4` warnent dans les logs ("Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026"). Pas urgent mais à mettre au planning.

---

### 🟢 Bloc D1 — Fix `pnpm db:types` redirect

**Cause root** : la commande `db:types` dans [package.json](../package.json) ligne 14 :

```json
"db:types": "supabase gen types typescript --linked --schema public",
```

Quand on lance `pnpm db:types > lib/database.types.ts`, pnpm écrit en tête de stdout le wrapper `> popoth-app-claude@0.1.0 db:types <cwd>` + `> supabase gen types typescript ...` AVANT la sortie du binaire. Ces 2-3 lignes finissent dans le fichier généré et le rendent invalide TS.

**Fix** : 2 options, choisir une.

**Option A** (recommandée — simple) — passer par `pnpm --silent` dans le script :
```json
"db:types": "pnpm --silent exec supabase gen types typescript --linked --schema public",
```
ou utiliser un wrapper Node minimal qui appelle Supabase CLI et écrit dans le fichier. Inconvénient : ajoute un niveau d'indirection. Avantage : reste compatible avec la doc actuelle.

**Option B** (plus propre — réécriture) — un script Node `scripts/regen-types.mjs` qui :
1. Spawn `supabase gen types typescript --linked --schema public`.
2. Capture stdout.
3. Écrit `lib/database.types.ts` directement.
4. Documenté comme `pnpm db:types` qui n'a plus besoin de redirection.

**Critère** :
- `pnpm db:types` régénère [lib/database.types.ts](../lib/database.types.ts) sans wrapper pollution. Premier ligne du fichier doit être `export type Json =` (pas `> popoth-app-claude...`).
- `pnpm typecheck` exit 0 immédiatement après `db:types` sans intervention manuelle.
- CLAUDE.md §3 et §8 mis à jour si la doc change (option A : la doc reste pareille ; option B : `pnpm db:types` ne nécessite plus de `>`).

**Hors scope** : régénérer les types de tous les schémas Supabase (`auth`, `storage`...). On reste sur `public`.

---

### 🟢 Bloc D2 — Normalize line endings dans `check-drift.mjs`

**Cause root** : [scripts/check-drift.mjs](../scripts/check-drift.mjs) lignes 83–84 :
```js
const live = stripTimestamp(liveRaw).trimEnd()
const committed = stripTimestamp(committedRaw).trimEnd()
```

`liveRaw` est généré en mémoire via `buildBaseline()` qui fait `parts.join('\n')` (LF only). `committedRaw` est lu via `readFileSync(BASELINE_PATH, 'utf8')` — sur Windows avec `core.autocrlf=true`, le working copy peut être CRLF après un `git checkout`. La comparaison `live === committed` échoue alors sur chaque ligne.

**Fix** :
```js
const normalize = (s) => stripTimestamp(s).replace(/\r\n/g, '\n').trimEnd()
const live = normalize(liveRaw)
const committed = normalize(committedRaw)
```

Ou wrapper `stripTimestamp` lui-même pour faire la normalisation.

**Critère** :
1. Sur Windows, après `git checkout cleanup` puis `pnpm db:check-drift`, exit 0 (aujourd'hui exit 1 sur faux-positif).
2. Test négatif : modifier intentionnellement le baseline (ajouter une ligne SQL bidon), `pnpm db:check-drift` exit 1 avec un diff lisible.
3. CI Linux non affectée (working copy LF, comportement inchangé).

**Hors scope** : éliminer le `core.autocrlf=true` côté git config — c'est la prefs utilisateur, pas une fix repo. On rend juste le détecteur idempotent face aux 2 styles.

---

### 🟢 Bloc D3 — Drop `lib/database.ts` augmentation

**Cause root** : [lib/database.ts](../lib/database.ts) augmente `Database` avec 4 RPC C3 pour pallier leur absence des types générés (car `GRANT EXECUTE TO service_role` only). Pendant Sprint Cleanup-Legacy / C1, le `pnpm db:types` régénéré inclut maintenant ces 4 RPC dans `Functions`. L'augmentation devient :

```ts
// generated (lib/database.types.ts) :
update_bank_balance: {
  Args: { p_delta: number; p_group_id?: string; p_profile_id?: string }
  Returns: number
}

// augmented (lib/database.ts intersection) :
update_bank_balance: {
  Args: {
    p_delta: number
    p_profile_id?: string | null
    p_group_id?: string | null
  }
  Returns: number
}
```

L'intersection `&` produit `string | undefined` (le narrower) — l'augmentation est effectivement no-op. Le fait qu'elle existe complique la lecture et masque que les types sont maintenant auto-generated.

**Fix** : 
1. Supprimer le contenu utile de [lib/database.ts](../lib/database.ts) (juste re-exporter) :
   ```ts
   export type { Database } from './database.types'
   ```
   ou — si rien d'autre n'importe `Database` depuis `lib/database` — supprimer le fichier entièrement et migrer les imports.

2. Lancer `pnpm typecheck` — ça doit passer sans modification d'autre code (les helpers `lib/finance/*` utilisent déjà `string | undefined` après le fix C1).

3. Vérifier que `pnpm test:run` reste green.

**Critère** :
- `lib/database.ts` réduit à un re-export (ou supprimé avec migration des imports).
- 0 régression : `pnpm typecheck && pnpm test:run` exit 0.
- CLAUDE.md §6 (TypeScript) et §7 (Sprint DB / D6) à mettre à jour pour mentionner que les RPC sont maintenant dans les types générés. Le compteur "service_role-only-non-exposées" devient obsolète.

**Hors scope** : régénérer types pour les schemas non-`public` (`auth`, `storage`). On reste limited à `public` comme aujourd'hui.

---

### 🟡 Bloc D4 — Étendre le path filter du PR-time gate aux YAML eux-mêmes

**Cause root** : [.github/workflows/db-drift-pr.yml](../.github/workflows/db-drift-pr.yml) lignes 14–18 :
```yaml
on:
  pull_request:
    paths:
      - 'supabase/migrations/**'
      - 'scripts/check-*.mjs'
      - 'scripts/export-schema.mjs'
      - 'scripts/dump-functions.sql'
```

Si quelqu'un casse le YAML lui-même (cas Sprint Cleanup-Legacy / C3 redux), la PR ne déclenche pas le gate qui aurait pu détecter la régression. C'est self-defeating mais rectifiable en ajoutant les YAML au filter.

**Fix** :
```yaml
paths:
  - 'supabase/migrations/**'
  - 'scripts/check-*.mjs'
  - 'scripts/audit-*.mjs'
  - 'scripts/export-schema.mjs'
  - 'scripts/dump-functions.sql'
  - '.github/workflows/db-drift-pr.yml'
  - '.github/workflows/db-drift-check.yml'
```

Bonus : ajouter `scripts/audit-*.mjs` qui a été créé en C2 ([scripts/audit-db-objects.mjs](../scripts/audit-db-objects.mjs) + [scripts/audit-functions.mjs](../scripts/audit-functions.mjs)) et qui peut casser les detectors aussi.

**Critère** :
1. Le gate se déclenche sur une PR qui modifie un de ces fichiers.
2. Validation : ouvrir une PR test qui change uniquement `db-drift-pr.yml` (typo ou commentaire), vérifier que le gate tourne. Pas de commit final (PR fermée sans merge, comme C3).

**Hors scope** : étendre le path filter au cron weekly (`db-drift-check.yml` n'utilise pas de path filter, il tourne sur cron + workflow_dispatch).

---

### 🟡 Bloc D5 — Validation manuelle du cron weekly

**Cause root** : [.github/workflows/db-drift-check.yml](../.github/workflows/db-drift-check.yml) avait le même bug pnpm/action-setup que le PR-time gate (Sprint Cleanup-Legacy / C3 a fixé les 2 YAML d'un coup). Mais le cron n'a jamais été redéclenché manuellement pour confirmer que le fix marche. Tant qu'on n'a pas observé un run exit 0, on ne sait pas si le secret est bien injecté en mode cron (il est injecté en mode `pull_request`, mais en `schedule` les permissions peuvent différer).

**Fix** : ad-hoc operationnel.
1. Aller sur **https://github.com/PothieuG/popoth/actions/workflows/db-drift-check.yml**
2. Cliquer **Run workflow** (sur la branche `cleanup` ou `main`).
3. Observer les 4 steps :
   - `pnpm/action-setup@v4` ✅
   - `db:check-drift` ✅ (prod alignée avec baseline)
   - `db:check-rpcs` ✅
   - `db:check-functions` ✅
4. Confirmer que `Open issue on failure` ne s'est pas déclenché (le step n'a une condition `if: failure()`).

**Critère** : un run vert observé dans l'onglet Actions. Pas de commit nécessaire, juste une mention dans CLAUDE.md §11 ou un screenshot.

**Hors scope** : tester le step "Open issue on failure" (nécessiterait d'introduire un faux drift en prod, ce qu'on ne fera pas).

---

### 🟠 Bloc D6 — GH Actions Node.js 24 (déférable)

**Cause root** : warning dans tous les runs Actions :
```
##[warning]Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: actions/checkout@v4, actions/setup-node@v4, pnpm/action-setup@v4. Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026. Node.js 20 will be removed from the runner on September 16th, 2026.
```

**2 stratégies** :

**Stratégie A** (immediate, low risk) — ajouter `env: FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` au niveau workflow, pour opt-in maintenant à Node.js 24. Si les actions cassent, on saura tout de suite.

**Stratégie B** (defer) — laisser tel quel jusqu'au 2 juin 2026. À ce moment-là, les actions tournent automatiquement en Node.js 24, on observe et on ajuste si besoin.

**Recommendation** : déférer (stratégie B). Le warning n'est pas bloquant aujourd'hui, et opt-in maintenant nous expose à des bugs Node.js 24 spécifiques sur des actions qu'on ne contrôle pas. À 2 mois de la deadline (avril 2026), ré-évaluer.

**Critère** : pas d'action immediate. Note dans CLAUDE.md §11 roadmap pour suivi.

**Hors scope** : réécriture de Custom Actions, pas applicable (on n'utilise que des actions tierces standard).

---

## Ordre d'exécution

1. **D1 d'abord** — petit fix isolé, débloque le DX immédiat de futur regen de types. 1 commit (~10 LOC).
2. **D2** — fix Windows-only, indépendant de D1. 1 commit (~5 LOC).
3. **D3** — cleanup conséquent du code (~50 LOC removal), nécessite typecheck pass. 1 commit.
4. **D4** — petite extension du gate. 1 commit (~3 LOC).
5. **D5** — validation manuelle, pas de commit (juste observation et note CLAUDE.md).
6. **D6** — note roadmap, pas de fix code.

**4 commits attendus + closeout CLAUDE.md/README.md.**

## Critères globaux

- `pnpm typecheck && pnpm lint:check && pnpm test:run` clean.
- `pnpm db:check-drift` exit 0 même après un `git checkout` (D2 valide).
- `pnpm db:types > lib/database.types.ts` directement utilisable sans nettoyage manuel (D1 valide).
- `pnpm db:audit-functions` et `pnpm db:audit-objects` toujours green (D3 ne casse rien).
- Cron weekly observé exit 0 au moins une fois (D5 valide).
- CLAUDE.md mis à jour (§3 commandes si D1 change la doc, §6 TypeScript si D3 retire l'augmentation, §11 roadmap pour D6).

## Risques

1. **D1 — wrapper changement casse pour d'autres scripts** : peu probable car `db:types` est le seul script qui pose problème (les autres `db:check-*` sont des scripts Node directs sans output volumineux). Mitigation : valider en lançant tous les scripts post-fix.

2. **D3 — un import quelque part dépend du shape exact de l'augmentation** : check via grep pour `import.*from.*'.*database'` (pas `database.types`). Tous les imports doivent fonctionner avec un simple re-export.

3. **D2 — la normalize() change le comportement de `stripTimestamp()`** : si une migration utilise volontairement CRLF (très improbable), le baseline n'aurait plus la bonne représentation. Mitigation : la norm est appliquée APRÈS l'IO, donc le fichier sur disque n'est pas modifié.

4. **D4 — path filter trop large** : peu probable d'introduire des faux positifs car `db-drift-*.yml` ne sont quasiment jamais touchés. Si on commence à les modifier souvent, ré-évaluer.

## Hors-scope

- Sprint 1 (Prettier/Husky/CI/ESLint Next 16) — sprint dédié.
- Lint cleanup global (~144 errors) — progressif, hors-sprint.
- I4 god file (`lib/financial-calculations.ts`) — chantier dédié.
- I5 process-step1 extraction — chantier dédié.
- Console.log cleanup — chantier dédié.
- Zod rollout — chantier dédié.

## Push gate

D1, D2, D3, D4 sont du code-only — pas de prod touché. Pas de confirmation utilisateur requise.

D5 est manuel côté GitHub UI (workflow_dispatch). Pas de risque.

D6 est défer / no-op.

**Aucun changement DB attendu.** Si une migration émerge en cours de sprint, suivre la push gate de CLAUDE.md §8 normalement.
