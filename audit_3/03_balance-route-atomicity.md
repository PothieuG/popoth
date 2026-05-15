> ⚠️ **STALE — closed-by-already-atomic (2026-05-16, Sprint Balance-Atomicity-Eval)** : ce chantier a été triagé comme closeout administratif. Phase 1 audit Read de [`app/api/monthly-recap/balance/route.ts`](../app/api/monthly-recap/balance/route.ts) (352 LOC) + greps sur `updateBudgetCumulatedSavings|updatePiggyBank`, `budget_transfers` et `.insert/.update/.upsert` confirment l'absence totale de pattern reversed RPC→INSERT : **0 hit `budget_transfers`** (table jamais utilisée par cette route), **0 hit mutation Supabase directe** (toutes mutations passent par helpers RPC atomiques `lib/finance/*`). La route effectue 2 RPCs séquentielles atomiques (`updatePiggyBank` L260 + boucle `updateBudgetCumulatedSavings` L273) sans audit-trail row jamais inséré. Sémantique fondamentalement différente d'`auto-balance` : commentaires explicites L238-240 + L280-283 ("NE PAS créer de revenu exceptionnel" + "NE PAS créer de dépense pour consommer l'excédent") — la route consomme purement piggy + cumulated_savings, le surplus n'est pas matérialisé (recompute final via `getProfileFinancialData`). Trouvaille collatérale documentée hors scope : pipeline multi-RPC L256-284 non-transactionnel (piggy + N savings) — **classe de bug différente** (pas un pattern reversed), mitigation naturelle = idempotence relancée (gap recompute from current state). Pattern miroir Sprint Transfer-Atomicity-Eval (2026-05-15). Voir [CLAUDE.md §11](../CLAUDE.md) pour le détail. Ce fichier est conservé comme trace historique de l'audit.

# 🔧 Chantier : Atomicité `balance/route.ts` (mêmes considérations que auto-balance)

**Statut détecté** : en suspens
**Source** : CLAUDE.md §11 Sprint Auto-Balance-Atomic (2026-05-15) — hors scope explicite (c)
**Dernière activité** : 2026-05-15 (Sprint Auto-Balance-Atomic livré sa sœur auto-balance, défère balance)
**Priorité suggérée** : moyenne
**Effort estimé** : M

---

## Prompt pour Claude Code

### Contexte
Popoth est une PWA financière (Next.js 16 + Supabase). Le récap mensuel route `balance/route.ts` effectue un **proportional balancing** des budgets (différent de `auto-balance` qui est distribution automatique). Selon CLAUDE.md §11 Sprint Auto-Balance-Atomic (2026-05-15) hors scope (c), **"balance/route.ts mêmes considérations atomicité"** — c'est-à-dire qu'elle contient probablement des patterns reversed RPC→INSERT similaires à ceux fixés dans `auto-balance` (pattern A savings et pattern B piggy).

Le sprint Auto-Balance-Atomic a fermé pattern A dans auto-balance via `transferWithSavingsDebit` per-pair. Le sprint frère pour pattern B piggy est documenté dans le chantier voisin [`02_pattern-b-piggy-reversed-auto-balance.md`](02_pattern-b-piggy-reversed-auto-balance.md). **Ce sprint** s'attaque à `balance/route.ts` qui mérite le même traitement.

### État actuel
- **Sprint Auto-Balance-Atomic livré 2026-05-15** : pattern A (savings) closed dans auto-balance via `transferWithSavingsDebit` per-pair. `balance` resté volontairement hors scope (même classe de bug, sprint séparé pour réduire le risque blast radius).
- **Sprint Cleanup-I8 / Lot 6 (2026-05-14)** a néanmoins migré `balance/route.ts` côté logs (63 sites → 0 KEEP / 63 DROP — tous flow logs supprimés, outer catch préservés via binding `error.message`). Le route est "log-clean".
- **Code concerné** : [`app/api/monthly-recap/balance/route.ts`](app/api/monthly-recap/balance/route.ts)
  - À identifier en Phase 1 : présence de patterns reversed `updateBudgetCumulatedSavings → INSERT budget_transfers` (pattern A) ou `updatePiggyBank → INSERT batched` (pattern B), ou autre pattern non-atomique
- **Précédents Sprints applicables** :
  - `transferWithSavingsDebit` (Sprint Refactor-I5-followup-v2) pour pattern A savings
  - `transferPiggyToBudgetWithInsert` (à créer dans chantier 02 si non encore livré, sinon disponible)
  - `transfer_savings_between_budgets` / `transfer_budget_to_piggy_bank` (Sprint Atomicity-Savings) pour autres patterns
- **Compteur `EXPECTED_RPCS`** : actuellement 9 (post Sprint P4-P5-P6), possiblement 10 si chantier 02 livré avant. Aucune nouvelle RPC requise par ce sprint si chantier 02 a livré `transfer_piggy_to_budget_with_insert`.

### Objectif
1. **Phase 1 audit** : identifier dans `balance/route.ts` les patterns reversed RPC→INSERT (savings ou piggy)
2. **Refactor** : remplacer chaque pattern reversed par l'appel composite RPC approprié (via helpers existants `transferWithSavingsDebit` / `transferPiggyToBudgetWithInsert` / `transferSavingsBetweenBudgets`)
3. **Fail-soft** : adopter `logger.warn` + continue per-pair (cohérent Sprint Auto-Balance-Atomic) pour éviter hard-500 qui invaliderait l'opération entière
4. **Tests** : ajouter tests caract gated `SUPABASE_RECAP_TESTS=1` si pas déjà présent pour `balance/route.ts` (pattern miroir `auto-balance` ou `complete` integration tests)

### Contraintes et conventions à respecter
- **Aucune nouvelle composite RPC** ne devrait être nécessaire si chantier 02 a livré `transfer_piggy_to_budget_with_insert`. Si Phase 1 surface un pattern complètement nouveau (e.g. `bank_balance` reversed, ce qui serait surprenant), créer RPC + helper + tests cohérent avec pattern composite (CLAUDE.md §8 ✅).
- **Pattern composite RPC** existants à privilégier (CLAUDE.md §5/§8) :
  - `transferWithSavingsDebit(filter, { fromBudgetId, toBudgetId, amount, reason })` — savings between 2 budgets + INSERT transfer
  - `transferPiggyToBudgetWithInsert(filter, { toBudgetId, amount, reason })` — piggy → budget + INSERT transfer
  - `transferSavingsBetweenBudgets(filter, params)` — savings sans INSERT
  - `transferBudgetToPiggyBank(filter, params)` — budget → piggy avec UPSERT
- **Fail-soft per-pair** : `try { await composite(...) } catch (err) { logger.warn('[balance phase X] pair fail (atomic rollback)', { ... }); continue }` cohérent Sprint Auto-Balance-Atomic
- **Pas de `--no-verify`** (commitlint actif), conventional commits, branche feature depuis `cleanup`
- **Pas de `: any`** ni `as unknown as SupabaseClient` (compteur reste à 0)
- **Logger** : `logger.error` / `logger.warn` plutôt que `console.*` (ESLint glob `app/api/monthly-recap/balance/**` enforce `no-console: 'error'` depuis Sprint Cleanup-I8 / Lot 6)
- **`pnpm verify`** : exit 0 (8 stages)

### Plan d'action suggéré
1. **Phase 1 audit Read** : lire intégralement [`app/api/monthly-recap/balance/route.ts`](app/api/monthly-recap/balance/route.ts). Identifier les patterns RPC→INSERT reversed :
   - `Grep "updateBudgetCumulatedSavings|updatePiggyBank" app/api/monthly-recap/balance/route.ts`
   - `Grep "from\(.budget_transfers.\)\\.insert" app/api/monthly-recap/balance/route.ts`
   - Pour chaque hit RPC → vérifier s'il est suivi (dans la même phase logique) d'un INSERT batched. Si oui = pattern reversed.
2. **Documenter les findings** : liste des patterns reversed identifiés (pattern A vs B vs autre). Décider du scope :
   - Si 0 pattern reversed → close-by-already-atomic (header STALE sur ce fichier audit_3, mirror Sprint Transfer-Atomicity-Eval)
   - Si patterns présents → continuer plan
3. **Commit 1 — refactor savings patterns** (si applicable) : remplacer pattern A reversed par `transferWithSavingsDebit` per-pair. Drop computation loop aggregate + INSERT batched. Fail-soft per-pair via `logger.warn`.
4. **Commit 2 — refactor piggy patterns** (si applicable et chantier 02 livré) : remplacer pattern B reversed par `transferPiggyToBudgetWithInsert` per-pair. Si chantier 02 PAS encore livré, créer issue de blocage / coordonner avec ce sprint frère.
5. **Commit 3 — tests** : si pas déjà présent, ajouter caract gated `SUPABASE_RECAP_TESTS=1` pour `balance/route.ts` (3-5 cas couvrant happy + edge cases du proportional balancing). Pattern miroir [`app/api/monthly-recap/complete/__tests__/route.integration.test.ts`](app/api/monthly-recap/complete/__tests__/route.integration.test.ts).
6. **Commit 4 — closeout** : CLAUDE.md §1 score + §5 architecture note + §11 entrée Sprint Balance-Atomic.
7. **Smoke browser deferred to user** : flow `/monthly-recap` exerçant `balance` sur compte test avec budgets en surplus/déficit → vérifier `cumulated_savings` deltas + `budget_transfers` audit rows byte-identique pré-refactor.

### Critères de complétion
- [ ] Phase 1 audit livre une liste claire des patterns reversed (ou confirme l'absence et close-by-already-atomic)
- [ ] Si patterns présents : tous remplacés par composite RPCs existants, sans création de nouvelle RPC sauf si pattern complètement inédit
- [ ] `balance/route.ts` est atomique : negative grep `Grep "updateBudgetCumulatedSavings.*\\n.*INSERT|updatePiggyBank.*\\n.*INSERT" app/api/monthly-recap/balance/route.ts` → 0 hit (modulo multi-line search)
- [ ] Fail-soft per-pair adopté avec `logger.warn` cohérent Sprint Auto-Balance-Atomic
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0 / 0 errors / 0 warnings stable
- [ ] `pnpm test:run` 100% passing (no regression)
- [ ] `pnpm verify` exit 0 (8 stages)
- [ ] Si tests caract ajoutés : `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/balance/__tests__/` 3+/3+ passed
- [ ] CLAUDE.md §11 entrée Sprint Balance-Atomic + §1 score + §8 ❌ "Ne pas réintroduire pattern reversed dans balance"
- [ ] Smoke browser deferred to user

### Pièges connus / points d'attention
- **Dépendance chantier 02** : si pattern B piggy reversed présent dans `balance` ET chantier 02 PAS encore livré, ce sprint est bloqué. Coordonner : soit livrer chantier 02 d'abord, soit scope ce sprint sur pattern A savings only et défer pattern B.
- **Différence sémantique avec auto-balance** : `balance` est "proportional balancing" (algorithm spécifique) vs `auto-balance` est "auto distribution". Le refactor reste mécanique (swap pattern reversed → composite RPC) mais le déroulé du test caract diffère.
- **Hard-500 vs fail-soft** : Sprint Auto-Balance-Atomic a adopté fail-soft (logger.warn + continue) pour ne pas invalider tout l'algorithm si un seul pair fail. Cohérent pour `balance` aussi sauf si le proportional balancing nécessite "all-or-nothing" (improbable mais à vérifier en Phase 1).
- **`monthly_recap_id` plumbing** : audit_2/18 dormant. `balance` peut ne pas avoir le `recapId` dispo facilement — best-effort NULL OK (convention §5).
- **Compteur `EXPECTED_RPCS`** : aucun bump nécessaire si seuls helpers existants utilisés. Vérifier `pnpm db:check-rpcs` exit 0 post-sprint.
- **Tests caract pré-existants** : vérifier `Glob app/api/monthly-recap/balance/__tests__/*.test.ts` — si présents, les rerun pour pin la byte-identique behavior avant le refactor. Si absents, c'est l'occasion d'en ajouter.
- **God-file extraction défères** : `balance/route.ts` est encore inline (~600 LOC estimé). Le chantier voisin [`04_auto-balance-godfile-extraction.md`](04_auto-balance-godfile-extraction.md) traite l'extraction `auto-balance`. Un sprint suivant `balance-godfile-extraction` similaire est implicite — **NE PAS extraire dans ce sprint** (scope creep, mirror Sprint Auto-Balance-Atomic qui a refusé l'extraction).
- **Lint-staged hang** : pre-commit hook peut hanger sur `lib/database.types.ts`. Workaround : stage seulement les fichiers de la route + helper + tests si applicable.
