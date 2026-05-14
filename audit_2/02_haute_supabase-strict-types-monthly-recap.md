# 02 — Sprint Supabase-Strict-Types : refactor 5 sites monthly-recap pour `RejectExcessProperties`

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée `⏭️ Sprint Supabase-Strict-Types` (émergé du Sprint DX-Verify follow-up) |
| **Type** | dette technique |
| **Priorité** | Haute |
| **Effort estimé** | M (demi-journée) |
| **Statut** | **Bloqué** par Dependabot ignore rule `@supabase/supabase-js: versions: ">=2.105.0"` |
| **Dépendances** | (Soft) chantier 01 (I6) — bundling opportun car même domaine |
| **Bloque** | Upgrade Supabase 2.105+ (security CVE PRs) |

## Contexte

CLAUDE.md §11 :

> ⏭️ **Sprint Supabase-Strict-Types** (émergé du Sprint DX-Verify follow-up) : refactorer 5 sites `app/api/monthly-recap/*` pour satisfaire `RejectExcessProperties` introduit en `@supabase/supabase-js` 2.105+. Concerne `accumulate-piggy-bank/route.ts:133`, `auto-balance/route.ts:556+588`, `transfer/route.ts:182`, `update-step/route.ts:154`. Implique de typer explicitement les inserts au lieu de spreader des objets `[x: string]: any`. **Couplé avec chantier I5** (extraction logique métier process-step1) qui touche le même domaine — opportunité de bundling.

État des lieux (Sprint DX-Verify follow-up, 2026-05-07) :
- Bump `@supabase/supabase-js ^2.57.4 → ^2.105.3` introduit `RejectExcessProperties` strict typing → **5 typechecks cassent** dans le code legacy avec `[x: string]: any` index signatures
- Fix-forward immédiat à l'époque : pin `@supabase/supabase-js@^2.57.4` via `pnpm.overrides`
- Sprint Stabilize-Deps S1 a ajouté ignore rule `versions: ">=2.105.0"` dans `.github/dependabot.yml` pour éviter le re-PR
- **Conséquence** : aucune CVE @supabase/supabase-js ≥2.105 ne peut être auto-mergée par Dependabot. Si un CVE critique tombe sur cette plage, l'alerte arrivera mais nécessitera intervention manuelle.

5 sites à refactorer (positions au moment du fix-forward DX-Verify) :
- `app/api/monthly-recap/accumulate-piggy-bank/route.ts:133`
- `app/api/monthly-recap/auto-balance/route.ts:556`
- `app/api/monthly-recap/auto-balance/route.ts:588`
- `app/api/monthly-recap/transfer/route.ts:182`
- `app/api/monthly-recap/update-step/route.ts:154`

**À vérifier en Phase 1** : ces 5 sites peuvent avoir été déplacés (refactors Sprint Refactor-Architecture-v4 post-DX-Verify ont touché ces routes). Faire un `Grep "spread.*as.*Insert"` ou `Grep "\.\.\.\.body" app/api/monthly-recap/` pour relocaliser les patterns suspects.

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Refactorer les 5 sites `app/api/monthly-recap/*` qui spreadent des objets `[x: string]: any` vers `supabase.from('X').insert(...)` pour qu'ils satisfassent le strict typing `RejectExcessProperties` de `@supabase/supabase-js@^2.105+`. Puis upgrader la dep + lever l'ignore rule Dependabot, et confirmer typecheck + tests verts post-upgrade.

### 2. Contexte technique

**Fichiers concernés** :
- `app/api/monthly-recap/accumulate-piggy-bank/route.ts` (~133)
- `app/api/monthly-recap/auto-balance/route.ts` (~556 + ~588)
- `app/api/monthly-recap/transfer/route.ts` (~182)
- `app/api/monthly-recap/update-step/route.ts` (~154)
- `package.json` (override + dep version)
- `.github/dependabot.yml` (ignore rule `versions: ">=2.105.0"`)

**État actuel** :
- `@supabase/supabase-js` pinned à `^2.57.4` via `package.json` direct dep
- `pnpm.overrides` peut aussi forcer la version transitive (vérifier `package.json` `pnpm.overrides`)
- 5 sites font des inserts/updates avec body spread non strictement typé
- Le pattern installé Sprint Lint-Baseline-Cleanup (Phase 4.2) sur les **autres** routes utilise `Database['public']['Tables']['<table>']['Insert' | 'Update']` — étendre à ces 5 sites

**Tests existants pertinents** :
- `lib/__tests__/api-regressions.test.ts` (gated `SUPABASE_API_TESTS=1`) couvre `accumulate-piggy-bank`, `transfer`, `auto-balance` partiellement
- `app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts` (gated `SUPABASE_RECAP_TESTS=1`) — pas direct mais voisin

**Précédents codebase** :
- **Sprint Lint-Baseline-Cleanup Phase 4.2** (CLAUDE.md §11) — pattern `Database['public']['Tables'][...]['Insert' | 'Update']` installé partout. Voir [app/api/finances/budgets/estimated/route.ts](../app/api/finances/budgets/estimated/route.ts) et [app/api/finances/expenses/real/route.ts](../app/api/finances/expenses/real/route.ts).
- **Sprint DX-Verify follow-up** (CLAUDE.md §11) — révèle le bug class via tests post-merge Dependabot.
- **Sprint Stabilize-Deps S1** (CLAUDE.md §11) — ignore rule documentée.

### 3. Spécifications fonctionnelles attendues

**Cas nominal** : aucun changement de comportement observable. Les 5 routes continuent d'insérer/updater leurs rows avec les mêmes valeurs. Le seul changement = le type des objets passés à `supabase.from('X').insert(...)` est désormais strict (no excess properties).

**Cas erreur** : si un site avait des excess properties silencieusement ignorées par Supabase v<2.105, le strict typing va les surfacer en typecheck — **c'est un bug latent** qu'il faut investiguer (potentiel comportement différent prod vs intent du dev).

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 (no `: any`, imports `import type`, Prettier `pnpm format:check` exit 0)
- **Pattern obligatoire** : pour chaque site, déclarer un type intermédiaire :
  ```typescript
  import type { Database } from '@/lib/database.types'
  type MonthlyRecapInsert = Database['public']['Tables']['monthly_recaps']['Insert']

  const insertPayload: MonthlyRecapInsert = {
    profile_id: profile.id,
    session_id,
    final_remaining_to_live: final_amount,
    // ... uniquement les champs DECLARÉS dans la table ; pas de [x: string]: any
  }
  await supabaseServer.from('monthly_recaps').insert(insertPayload)
  ```
- **Pas de `as any` cast** comme escape hatch (CLAUDE.md §6) — si un champ manque dans le type généré, regénérer via `pnpm db:types` ; si la sémantique nécessite vraiment un excess (e.g. JSON metadata blob), utiliser `Database['public']['Tables']['X']['Insert'] & { metadata: SpecificType }` ou caster `metadata: jsonValue as Json` au boundary
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Counter `: any`** : ne pas ajouter de nouveau site

### 5. Critères d'acceptation vérifiables

- [ ] **5 sites typés strict** : `Grep "as Database" app/api/monthly-recap/{accumulate-piggy-bank,auto-balance,transfer,update-step}/` retourne ≥ 5 hits (1 par site, plus si pattern dupliqué)
- [ ] **Aucun `[x: string]: any` résiduel** : `Grep "\[x: string\]: any" app/api/monthly-recap/` retourne 0 hit
- [ ] **typecheck strict v2.105** : avec `@supabase/supabase-js@^2.105.3` installé, `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable (pas de delta)
- [ ] **tests gated `SUPABASE_API_TESTS=1`** : 12+ cas passants byte-identique pré/post upgrade
- [ ] **build** : `pnpm build` exit 0, 55/55 routes
- [ ] **`.github/dependabot.yml`** : ignore rule `@supabase/supabase-js: versions: ">=2.105.0"` retirée
- [ ] **`package.json`** : `@supabase/supabase-js: ^2.105.3` (ou plus récent stable) ; `pnpm.overrides` purgé pour cette dep
- [ ] **`pnpm install`** : exit 0, pas de mismatch react/react-dom (CLAUDE.md §11 leçon DX-Verify follow-up)
- [ ] **`pnpm verify`** : exit 0 (8 stages incluant 6 db:* checks)
- [ ] **smoke browser** : flow `/monthly-recap` complet sur compte test (initialize → step1 → step2 → balance/auto-balance/transfer → complete) — toutes les routes touchées doivent retourner 200 + DB rows correctes

### 6. Tests à écrire ou à mettre à jour

- **Pas de nouveau test gated** requis (les 12 cas existants `SUPABASE_API_TESTS=1` couvrent déjà la régression observable)
- **Tests à exécuter** :
  ```powershell
  SUPABASE_API_TESTS=1 pnpm test:run lib/__tests__/api-regressions.test.ts
  SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/
  ```
- **Tests à mettre à jour** : si un test `mocked` reproduit le pattern `[x: string]: any` (improbable, à vérifier via grep), aligner sur le nouveau pattern strict typing.

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : passer ~99.999 → ~99.999 stable + entrée Sprint Supabase-Strict-Types dans le paragraphe (consolidation tooling, pas de saut métier)
  - **§6 TypeScript** : ajouter ou renforcer le bullet existant sur `Database['public']['Tables'][...]['Insert' | 'Update']` (CLAUDE.md déjà mentionne le pattern Sprint Lint-Baseline-Cleanup) — confirmer que 5 nouveaux sites sont migrés
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint Supabase-Strict-Types** ([prompt source si capturé], plan dans ...) : ferme le bloqueur Sprint DX-Verify follow-up. ...`

- **`.github/dependabot.yml`** : commenter ou retirer l'ignore rule `@supabase/supabase-js`.

- **next-steps.md** : pas concerné.

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify  # baseline ok
git status -s  # noter pre-existing dirty

# 2. Phase 1 — relocalisation des 5 sites (positions peuvent avoir bougé)
# Grep "from\('monthly_recaps'\)\.insert" app/api/monthly-recap/  # localiser les inserts
# Grep "from\('budget_transfers'\)\.insert" app/api/monthly-recap/
# Grep "\[x: string\]: any" app/api/  # identifier excess property patterns

# 3. Refactor — pour chaque site, déclarer le type strict + remove excess props
pnpm typecheck  # devrait exit 0 SUR LA VERSION ACTUELLE 2.57 (le code passe déjà avant l'upgrade)

# 4. Upgrade Supabase
pnpm update @supabase/supabase-js@^2.105.3
# Si pnpm.overrides force encore la 2.57, le retirer manuellement

# 5. Re-typecheck
pnpm typecheck  # doit toujours exit 0 (preuve que les types stricts passent v2.105+)

# 6. Tests + build
pnpm lint:check
pnpm format:check
pnpm test:run
SUPABASE_API_TESTS=1 pnpm test:run lib/__tests__/api-regressions.test.ts
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/
pnpm build
pnpm verify

# 7. Lever l'ignore Dependabot
# Edit .github/dependabot.yml — retirer le bloc ignore @supabase/supabase-js

# 8. Smoke browser (CRUCIAL)
pnpm dev
# Flow récap complet sur compte test, vérifier toutes les routes monthly-recap retournent 200
```

## Pièges connus / points d'attention

- **Re-localisation des 5 sites** : les positions L:133/L:556/L:588/L:182/L:154 datent de 2026-05-07. Sprint Refactor-Architecture-v4 (2026-05-08) a wrappé ces 5 routes en `withAuthAndProfile`, ce qui a probablement décalé les line numbers. Faire le grep à neuf avant d'éditer.
- **Excess properties bug latent** : si un site spread `body` directement (e.g. `insert({ ...body, profile_id: profile.id })`) et que le `body` contient des champs qui ne sont PAS dans la table (e.g. `contextHint` côté client), Supabase v<2.105 les ignorait silencieusement. Avec le strict typing, le typecheck va surfacer le mismatch — **c'est un bug latent qui mérite enquête** (peut-être qu'un dev pensait sauvegarder ce champ et il était silencieusement perdu en prod).
- **Couplage chantier 01 (I6)** : 4 des 5 sites sont dans `monthly-recap/` qui est le scope du chantier I6. Si I6 démarre en parallèle, il refactorise complete/route.ts en thin handler — les sites peuvent disparaître ou bouger. Coordonner. **Recommandé** : faire chantier 02 AVANT chantier 01 (rapide, indépendant) ; ou faire en premier sub-task de chantier 01 (les types stricts sont un pré-requis pour la version refactorisée du processComplete persist layer).
- **`auto-balance/route.ts:556 + 588`** : 2 sites dans le même fichier, probablement le même pattern d'INSERT répété (snapshot save × 2 ?). Vérifier si le refactor pourrait factoriser en fonction helper.
- **`pnpm.overrides`** : si l'override force `@supabase/supabase-js@2.57.4`, le retirer aussi sinon `pnpm install` continue de pinned à 2.57. Cf. [package.json](../package.json) `pnpm.overrides`.
- **CVE security PRs Dependabot** : actuellement bloquées (cf. CLAUDE.md §11 Sprint Stabilize-Deps S1 leçon ⚠️ "Interaction `ignore` ↔ Dependabot security updates"). Post-fix, les PRs auto pourront passer.
- **React 19.X mismatch** : la leçon DX-Verify follow-up sur react/react-dom mismatch s'applique : faire `pnpm install` après upgrade et vérifier `node_modules/react/package.json` + `node_modules/react-dom/package.json` ont la même version. Si mismatch : `pnpm.overrides` pour les pinner ensemble.
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, `git status` montrera 25 M/D + 28 untracked. Ne pas inclure dans les commits du chantier 02 — utiliser `git add` ciblé.

## Découpage en sous-tâches (M → 4 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit : grep + Read direct sur les 5 sites, confirmer/relocaliser les positions actuelles. Documenter dans le commit message si excess properties bug latent surfacé.
2. **Sub-2 (Effort : S)** — Refactor des 5 sites pour types stricts (sur la version Supabase actuelle 2.57). Commit `refactor(monthly-recap): type strict 5 inserts via Database['public']['Tables'][...]['Insert']`. Verif `pnpm typecheck` exit 0 (preuve que le code marche déjà strict, juste pas testé contre v2.105).
3. **Sub-3 (Effort : XS)** — Upgrade Supabase + lever l'ignore Dependabot : `pnpm update @supabase/supabase-js@^2.105.3`, retirer ignore rule, retirer override si applicable. Commit `chore(deps): upgrade @supabase/supabase-js to 2.105.3 + lift Dependabot ignore`.
4. **Sub-4 (Effort : XS)** — Re-verif post-upgrade + closeout doc : `pnpm verify` + `pnpm test:run` + smoke browser. Commit `docs: closeout CLAUDE.md §1/§6/§11 for Sprint Supabase-Strict-Types`.

## Recovery path

- **Annuler upgrade** : `pnpm update @supabase/supabase-js@^2.57.4` + remettre l'ignore rule
- **Annuler refactor** : `git revert <sha-sub-2>` ; les types stricts ne sont pas un breaking change runtime, le revert est safe
- **Aucune migration DB**

## Précédents codebase (références)

- **Sprint Lint-Baseline-Cleanup** (CLAUDE.md §11) — Phase 4.2 a installé le pattern strict typing `Database['public']['Tables'][...]['Insert' | 'Update']` partout. Voir commits sur `cleanup` Phase 1-7.
- **Sprint DX-Verify follow-up** (CLAUDE.md §11) — révèle le bug + fix-forward repin + leçon CI gate post-merge.
- **Sprint Stabilize-Deps S1** (CLAUDE.md §11) — ajout ignore rule + leçon Dependabot security updates interaction.

---

**Estimation totale** : demi-journée (4-5h). Effort modeste, valeur élevée (lève un bloqueur security). Score métier inchangé (consolidation tooling). Recommandé en parallèle de chantier 01 (I6) si bandwidth, sinon avant pour réduire l'inertie.
