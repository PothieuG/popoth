# Prompt v3 — Suites du Sprint Refactor-I5-followup (`process-step1`)

> **Statut** : prompt rédigé en clôture du Sprint Refactor-I5-followup (2026-05-11) pour capitaliser sur 2 axes secondaires identifiés pendant l'extraction et la documentation. Le sprint v2-followup a fermé les 3 axes du v2 (drop step 2.3 / test caract 2.4.2 / docs concurrence). Ces follow-ups ne sont **pas bloquants** pour la prod — ce sont des dettes d'intégrité de données identifiées au passage qui méritent un sprint dédié.

---

## Contexte

Le Sprint Refactor-I5 (2026-05-11) a démantelé [app/api/monthly-recap/process-step1/route.ts](../app/api/monthly-recap/process-step1/route.ts) (740 → 45 LOC). Le Sprint Refactor-I5-followup (2026-05-11) a fermé 3 dettes :

- Axe 1 (v2) : drop step 2.3 dead code (consume_surplus, NOT NULL violation silencieuse)
- Axe 2 (v2) : ajout du 6ᵉ cas caractérisation gated pour le path 2.4.2 (RPC L673)
- Axe 3 (v2) : documentation de l'edge case concurrent-invocation (Option D — accept)

Le présent prompt v3 capitalise sur **2 axes restants** :

1. **Axe 1 (v3)** — Gap d'atomicité dans le path step 2.4.2 : la séquence INSERT `budget_transfers` → RPC `updateBudgetCumulatedSavings` n'est pas atomique. Si la RPC échoue après l'INSERT réussi, la DB reste avec une row `budget_transfers` qui claim un mouvement de fonds, mais sans débit correspondant sur `cumulated_savings`. **Bug d'intégrité de données réel**, observable mais non-loggué côté metrics aujourd'hui.
2. **Axe 2 (v3)** — Tests unit pour la couche `step1-persist.ts` avec Supabase mocké : aujourd'hui seuls les tests d'intégration gated couvrent l'orchestration. Un mock permettrait de tester les paths d'erreur (RPC fail mid-flight, INSERT fail, etc.) sans dépendre d'une vraie DB.

Ces dettes ne sont pas critiques pour la prod (les RPCs convergent rapidement aux invariants ≥ 0 et la fréquence du fail mid-flight est faible). Mais elles méritent un traitement dédié pour fermer le rectangle "le pipeline `processStep1` est totalement intègre".

---

## Axe 1 — Atomicité de la séquence transfer + savings debit dans 2.4.2

### Symptôme

[lib/recap/step1-persist.ts:306-348](../lib/recap/step1-persist.ts) exerce, pour chaque op `step:'2.4.2.2'` :

```typescript
// 1. INSERT budget_transfers
const { error: transferError } = await supabaseServer.from('budget_transfers').insert(payload)
if (transferError) {
  logger.warn(...)  // fail-soft, continue
  continue
}

// 2. RPC updateBudgetCumulatedSavings (atomic at the column level)
try {
  await updateBudgetCumulatedSavings(op.fromBudgetId, -op.amount)
} catch (error) {
  logger.error(...)
  continue  // ⚠️ transfer recorded, savings NOT debited
}
```

**Scénario problématique** :

1. INSERT réussit → `budget_transfers` row inscrite avec `from=savingsBudget, to=deficitBudget, amount=X`
2. RPC throws (e.g. `cumulated_savings - X < 0` car race concurrent, ou tx isolation, ou Postgres lock timeout)
3. Le catch attrape, log, continue
4. **État final** : `budget_transfers` claim `X` débité de savingsBudget, mais `cumulated_savings` de savingsBudget inchangé

Conséquences :

- Audit recap mensuel : la somme `budget_transfers.transfer_amount FROM savingsBudget` ne matche pas la décrémentation `cumulated_savings` observée
- UI peut afficher un "transfert vers le budget X" alors que le solde source n'a pas bougé
- Si une autre invocation 2.4.2 ou 2.2 utilise `cumulated_savings` (qui n'a pas bougé), elle pense à tort qu'il reste de l'argent à débiter
- Bug récurrent : à chaque récap mensuel, l'inconsistance s'aggrave par cumul

### Comparaison avec le pattern step 2.3.1

Step 2.3.1 ([step1-persist.ts:248-267](../lib/recap/step1-persist.ts)) fait un INSERT seul (`from_budget_id=null, to_budget_id=deficitBudget`). Pas d'RPC, pas de débit. C'est juste un audit-trail row. **Pas de gap d'atomicité** — l'INSERT atomique suffit.

### Comparaison avec le pattern step 2.2

Step 2.2 fait un RPC seul (pas de transfer row). `updateBudgetCumulatedSavings(savingsBudgetId, -amount)` atomique. **Pas de gap d'atomicité** — la RPC est atomique au niveau de la column.

C'est UNIQUEMENT step 2.4.2 qui combine les deux et expose la race.

### Solutions à arbitrer

**(A) Nouvelle RPC `transfer_with_savings_debit(payload jsonb, debit_amount numeric)`** — la plus solide. La RPC SQL fait `INSERT INTO budget_transfers ... ; UPDATE estimated_budgets SET cumulated_savings = cumulated_savings - ...` en une seule transaction Postgres. Si le UPDATE rejette (`cumulated_savings - X < 0`), le INSERT est rollback. Pattern miroir des 4 RPC C3 existantes (Sprint 0, cf. [supabase/migrations/20260506000000_create_finance_rpcs.sql](../supabase/migrations/20260506000000_create_finance_rpcs.sql)).

Coût : 1 migration `CREATE FUNCTION transfer_with_savings_debit` + 1 helper dans `lib/finance/` (ou inline dans `lib/recap/step1-persist.ts`) qui appelle la RPC, + regen types via `pnpm db:types`, + 1 test gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` qui valide le rollback. Moderate (~2-3h).

**(B) Defensive rollback côté TS** — sur RPC fail, faire `DELETE FROM budget_transfers WHERE id = <insertedId>` pour effacer la row orpheline. Coût : minimal (~10 LOC), mais non-atomique lui-même — si le DELETE fail (réseau, lock, etc.), on revient au même problème.

**(C) Inverser l'ordre RPC → INSERT** — fait la RPC d'abord, puis l'INSERT. Si INSERT fail, le savings est débité mais pas tracé. Échange un bug pour un autre (perte d'audit-trail au lieu de fausse audit-trail). **Pire que la situation actuelle** : on perd la trace d'un mouvement de fonds réel au lieu d'enregistrer un mouvement fictif.

**(D) Accepter et monitorer** — ajouter un `db:check-recap-consistency` script qui détecte le drift (sum of transfers ≠ savings decrement) et report. Pattern miroir des `db:check-*` existants. Coût : minimal, mais ne fixe pas la cause.

**Recommandation par défaut** : (A). C'est cohérent avec le pattern Sprint 0 / C3 et ferme le bug à la racine.

### Étendre la solution aux autres routes monthly-recap

Si on choisit (A), il faut aussi vérifier que les routes `auto-balance`, `balance`, `complete`, `transfer`, `accumulate-piggy-bank` du namespace `monthly-recap/*` n'ont PAS le même pattern non-atomique. Grep et audit needed avant la migration.

Le chantier I6 (extraction god file `complete/route.ts`) est concerné — il manipule potentiellement les mêmes paires INSERT+RPC. Peut être couplé.

### Fichiers concernés

- **Si Option (A)** :
  - `supabase/migrations/<TS>_create_transfer_with_savings_debit_rpc.sql` (NEW)
  - `lib/finance/transfer-with-savings.ts` (NEW) — helper qui call la RPC
  - `lib/recap/step1-persist.ts` — remplacer `INSERT + try-RPC` par `await transferWithSavingsDebit(...)`
  - `lib/database.types.ts` — regen via `pnpm db:types` après migration
  - `lib/finance/__tests__/transfer-with-savings.test.ts` (NEW) — 3-4 cas gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` (happy path, savings insufficient → rollback, concurrent calls)
- **Si Option (D) seul** :
  - `scripts/check-recap-consistency.mjs` (NEW) — query qui compare `SUM(budget_transfers.transfer_amount) GROUP BY from_budget_id` à `cumulated_savings_delta` calculé sur une fenêtre temporelle

### Critères de succès

- `pnpm verify` exit 0 (incluant la nouvelle RPC pinnée par `db:check-rpcs` ou `db:audit-functions`)
- Si Option (A) : `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/transfer-with-savings.test.ts` exit 0 (3-4 cas)
- Le test caract `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/` reste 6/6 (la nouvelle RPC produit le même side effect observable que l'ancien INSERT+RPC, en plus du rollback en cas d'erreur)
- Negative grep : `Grep "from\('budget_transfers'\).insert" lib/recap/` retourne 1 hit (uniquement étape 2.3.1, qui n'a pas de RPC paire)

---

## Axe 2 — Tests unitaires pour l'orchestration `step1-persist`

### Symptôme

[lib/recap/step1-persist.ts](../lib/recap/step1-persist.ts) (396 LOC) est testé uniquement par :

- Les **caractérisation gated** `SUPABASE_RECAP_TESTS=1` (6 cas dans [route.integration.test.ts](../app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts))
- Les **pure-unit non-gated** sur `decideStep1Allocation` ([step1-algorithm.test.ts](../lib/recap/__tests__/step1-algorithm.test.ts), 28 cas)

Les caractérisation couvrent le **happy path** + une partie des fail paths via la sémantique end-to-end. Mais elles ne couvrent **pas explicitement** :

- RPC `updatePiggyBank` throws (step 1.1 / 2.4.1) — quel comportement attendu côté handler ?
- RPC `updateBudgetCumulatedSavings` throws (step 2.2 / 2.4.2) — actuellement `continue`, mais le state-in-memory reflete-t-il le state DB après plusieurs RPC partiels ?
- Plusieurs ops 2.4.2 émises dont la 1ère fail RPC — les suivantes continuent-elles ? Avec quelle source de `totalSavingsLeft` ?
- Edge cases : 0 ops à appliquer (decision.operations vide), 1 op de chaque type, mix complexe

Ces edge cases sont coûteux à reproduire en intégration (besoin de fixtures qui font fail une RPC déterministiquement — souvent impossible sans simulation côté DB).

### Approche suggérée

Mocker `lib/supabase-server.ts` (ou les wrappers `lib/finance/*`) via `vi.mock()` et tester `processStep1(input)` ou `applyDecision(input, snapshot, decision)` directement avec un client Supabase stubbed. Le pattern miroir existe dans [lib/finance/**tests**/snapshots.test.ts](../lib/finance/__tests__/snapshots.test.ts) (Sprint Refactor-I4 commit #7) — 5 cas non-gated qui mockent `supabaseServer.from(...).insert()` pour valider le R1 fail-soft contract.

Pour `step1-persist.ts`, il faudrait également mocker les 4 wrappers `lib/finance/*` (`updatePiggyBank`, `updateBankBalance`, `updateBudgetCumulatedSavings`, `transferFromPiggyToBudget`) + `getProfileFinancialData` / `getGroupFinancialData` (pour le refetch 2.4.1).

Cas à couvrir :

1. **Happy path orchestration** : 1.1 piggy push fires → updatePiggyBank called once with right amount
2. **2.2 savings consume** : 2 ops émises → updateBudgetCumulatedSavings called twice with right amounts
3. **2.3.1 deficit refloat** : 3 ops émises → 3 INSERT budget_transfers, 0 RPC
4. **2.4.2 second-pass** : N ops émises → N INSERT + N RPC en pair (vérif que chaque pair fire ensemble)
5. **2.4.2 RPC fail mid-flight** : 1ère op réussit, 2ème op RPC throws → 3ème op continue à fire (cohérence avec fail-soft) + assertions sur les logger.error calls
6. **2.4.2 INSERT fail** : INSERT throws → la RPC n'est pas appelée (court-circuit) + `continue` (cohérence avec fail-soft)
7. **CAS 1 sans excédent** : difference == 0 → 0 RPC call, 0 INSERT
8. **Decision avec `secondPassRefloatOps` vide** : 2.4.2 ne fire pas même si isFullyBalanced → 0 INSERT/RPC

Estimé ~8-12 cas, ~250-400 LOC en fichier dédié `lib/recap/__tests__/step1-persist.test.ts`.

### Fichier concerné

- `lib/recap/__tests__/step1-persist.test.ts` (NEW, ~300 LOC)

### Critères de succès

- `pnpm test:run lib/recap/__tests__/step1-persist.test.ts` exit 0, ≥ 8 cas
- `pnpm test:run` total monte de 88 → ~96 (sans gated tests)
- Les tests ne dépendent d'AUCUNE env var (mocks complets, pattern non-gated)
- Coverage de `lib/recap/step1-persist.ts` augmente significativement (mesurable via `pnpm test:coverage` — peut intégrer une assertion sur le %)

---

## Workflow recommandé pour la session

1. Lire **CLAUDE.md §5 (Architecture critique)** et **§11 Roadmap** (entrée Sprint Refactor-I5-followup) — confirmer la compréhension de l'état du pipeline `processStep1`.
2. Vérifier l'état du repo : `git log --oneline -10` doit montrer le head sur `3254d17` (closeout Sprint Refactor-I5-followup) ou plus récent.
3. Lancer `pnpm verify` pour confirmer baseline propre.
4. Lancer `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/` — doit pass 6/6.
5. **Phase 1 — Investigation Axe 1** : grep cross-codebase pour d'autres routes `monthly-recap/*` qui exhibent le même pattern INSERT-then-RPC (suspect : `auto-balance`, `balance`, `complete`, `transfer`). Discuter avec l'utilisateur via AskUserQuestion pour arbitrer (A) RPC dédiée vs (D) audit script — recommandation par défaut (A).
6. **Phase 2 — Implémenter Axe 1** : ~3-5 commits selon l'option choisie (migration SQL, helper TS, refactor `step1-persist.ts`, regen types, test gated, closeout).
7. **Phase 3 — Axe 2 (optionnel, couplable)** : créer le fichier de tests `step1-persist.test.ts`. ~1-2 commits.
8. Closeout CLAUDE.md §11 avec une nouvelle entrée Sprint Refactor-I5-followup-v2.

---

## Critères de succès globaux

- `pnpm verify` exit 0 à la fin
- Tests gated 6/6 (caract Recap) + ≥3 cas gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` couvrant la nouvelle RPC (si Option A)
- Tests non-gated ≥ 96 (vs 88 actuel, +8 minimum pour Axe 2)
- Lint baseline 183 warnings stable ou en baisse
- 0 nouveau `as unknown as SupabaseClient` (counter doit rester à 0)
- Negative grep `Grep "from\('budget_transfers'\).insert" lib/recap/` retourne ≤ 1 hit (Axe 1)
- Le test caract gated CAS 2.4.2 produit le même output observable byte-identique (rollback transparent en cas de RPC fail vs prod actuelle qui silently swallow)

---

## Hors scope (à séparer)

- **Chantier I6 `complete/route.ts`** — extraction du god file (~730 LOC + 4 globals carryover). Peut être couplé à Axe 1 si le même pattern INSERT+RPC y existe.
- **`amount_from_budget` default 0 audit** — affecte au-delà de process-step1, sprint dédié `amount-from-budget-audit`.
- **Concurrency Options A/B/C de v2 Axe 3** — la v2 a tranché (D) Document only. Réévaluer si un incident prod surface l'edge case.
- **Renommage des steps post-drop 2.3** — laisser tel quel (`'2.3.1'`, `'2.4.1'`, `'2.4.2.2'`), les UI consumers s'appuient dessus.
- **Chantier Zod rollout** — extension `parseBody` aux ~30 handlers restants. Roadmap.
- **Smoke browser deferred** — exécuter récap mensuel CAS 1 + CAS 2 sur compte test. À faire AVANT d'implémenter Axe 1 pour avoir un baseline observable.
