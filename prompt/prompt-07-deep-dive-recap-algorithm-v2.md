# Prompt v2 — Suites du Sprint Refactor-I5 (`process-step1`)

> **Statut** : prompt rédigé en clôture du Sprint Refactor-I5 (2026-05-11) pour capitaliser sur 3 axes identifiés pendant l'extraction du god file. Le sprint principal a livré le split `lib/recap/{step1-algorithm,step1-persist,types,index}.ts`, fix le race L673 via `updateBudgetCumulatedSavings` RPC, et apporté la baseline lint à 183 warnings. Ces follow-ups ne sont **pas bloquants** pour la prod — ce sont des dettes identifiées au passage qui méritent un sprint dédié.

## Contexte

Le Sprint Refactor-I5 a démantelé [app/api/monthly-recap/process-step1/route.ts](../app/api/monthly-recap/process-step1/route.ts) (740 → 45 LOC) en :

- [lib/recap/step1-algorithm.ts](../lib/recap/step1-algorithm.ts) — décision pure, 292 LOC
- [lib/recap/step1-persist.ts](../lib/recap/step1-persist.ts) — orchestrateur I/O, 396 LOC
- [lib/recap/types.ts](../lib/recap/types.ts) + [lib/recap/index.ts](../lib/recap/index.ts)
- [lib/api/parse-body.ts](../lib/api/parse-body.ts) + [lib/schemas/recap.ts](../lib/schemas/recap.ts) — Zod minimal infra

Le scope-cast `as unknown as SupabaseClient` est tombé à 0 dans tout le code TypeScript. La race L673 est fixée. La baseline lint a chuté à 183 warnings (−116).

Trois dettes ont émergé pendant le sprint et ont été préservées verbatim par discipline de scope. Le présent prompt les adresse.

---

## Axe 1 — Pre-existing bug : step 2.3 `to_budget_id: null` toujours failed silencieusement

### Symptôme

`app/api/monthly-recap/process-step1/route.ts:432-449` (route originale) ET maintenant `lib/recap/step1-persist.ts:220-247` (chemin step 2.3 `consume_surplus`) INSERT dans `budget_transfers` avec `to_budget_id: null`. La colonne est déclarée **NOT NULL** dans le baseline ([supabase/migrations/20260101000000_remote_schema.sql:118](../supabase/migrations/20260101000000_remote_schema.sql) — `"to_budget_id" uuid NOT NULL`).

Conséquence : l'INSERT lève toujours `null value in column "to_budget_id" of relation "budget_transfers" violates not-null constraint` en prod. Le fail-soft `if (transferError) { logger.warn(...); continue }` swallow l'erreur, la ligne `budget_transfers` n'est jamais persistée, et `operationsPerformed.push(op)` est skippé. **Le step 2.3 ne s'exécute jamais en prod depuis toujours** — c'est du dead code observable seulement dans les logs Vercel sous `[warn] [process-step1 2.3] budget_transfers INSERT failed`.

### Pourquoi le Sprint Refactor-I5 a préservé verbatim

Per CLAUDE.md §8 "ne pas modifier la sémantique de l'algo" et le commit message du commit 6 : "Fixing this is out of scope per CLAUDE.md §8 \"do not modify the algorithm semantics\"". Le bug a été préservé pour garantir la byte-identité de la response face aux tests de caractérisation.

### Décision attendue

Trois options à arbitrer avec l'utilisateur via AskUserQuestion :

**(A) Drop step 2.3 entirely** — le path est dead code en prod ; le supprimer simplifie l'algorithme et la persist layer. Conséquences :
- L'algorithme retire `step: '2.3'` du discriminated union `AllocationOperation`
- Le persist layer retire le `else if (op.step === '2.3' && ...)` block et la fonction `decideCase2` ne fait plus appel à la branche surplus
- Les tests pure-unit perdent 4 cas (CAS 2 ÉTAPE 2.3 — surplus consumed proportionally)
- Le gap résiduel restera plus souvent > 0 après 2.2 — donc `is_fully_balanced=false` plus souvent → moins de step 2.4.1 / 2.4.2
- L'opportunité de récupérer du surplus pour couvrir un gap est perdue

**(B) Migrate column `to_budget_id` to nullable + add a meaningful CHECK** — la step 2.3 redevient fonctionnelle (track les consommations de surplus). Conséquences :
- Migration `<TS>_alter_budget_transfers_nullable_to_budget.sql` : `ALTER TABLE budget_transfers ALTER COLUMN to_budget_id DROP NOT NULL;` + new CHECK `(from_budget_id IS NOT NULL OR to_budget_id IS NOT NULL)` pour éviter `(NULL, NULL)`
- Régen `lib/database.types.ts` (le champ devient `string | null`)
- Drop le cast `null as unknown as string` dans `step1-persist.ts`
- L'algorithme 2.3 commence à émettre de vrais transferts. **Impact prod** : tous les utilisateurs qui ont déclenché un récap CAS 2 avec surplus disponible vont voir de nouvelles lignes apparaître dans `budget_transfers` → impact UI à valider (vues "transferts du mois" ne doivent pas crasher sur `to_budget_id IS NULL`)
- Tests caractérisation existants doivent être étendus pour valider la nouvelle INSERT

**(C) Remplacer step 2.3 par une `real_expenses` "exceptionnelle"** — sémantique alternative qui consomme le surplus comme une dépense réelle. Conséquences :
- Plus complexe ; nécessite un nouveau `expense_date` + `description` + une classification
- Modifie la signification du RAV pour les périodes suivantes
- À évaluer avec l'utilisateur si le step 2.3 a vraiment une valeur métier

**Recommandation par défaut** : commencer par (A) — investiguer si quelqu'un (autre que la route) consomme `budget_transfers WHERE to_budget_id IS NULL`. Si grep retourne 0 hit applicatif et 0 visualisation dans la UI, drop entirely.

### Fichiers concernés

- `app/api/monthly-recap/process-step1/route.ts:432-449` (ancien — supprimé en commit 7, juste pour contexte)
- `lib/recap/step1-algorithm.ts` — supprimer le bloc `// ÉTAPE 2.3 — consommer le surplus proportionnellement` si option (A)
- `lib/recap/step1-persist.ts:220-247` — supprimer le `else if (op.step === '2.3')` si option (A) ; supprimer le cast `null as unknown as string` si option (B)
- `lib/recap/types.ts` — retirer le `'2.3'` du union `AllocationOperation['step']` si option (A)
- `lib/recap/__tests__/step1-algorithm.test.ts` — retirer les 4 cas du `describe('CAS 2 ÉTAPE 2.3 — surplus consumed proportionally')` si option (A)
- `app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts` — pas d'impact (les 5 cas existants ne testent pas spécifiquement step 2.3)
- `supabase/migrations/<TS>_alter_budget_transfers_nullable_to_budget.sql` si option (B)

### Critères de succès

- `pnpm typecheck && pnpm lint:check && pnpm test:run && pnpm build` exit 0
- `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/` exit 0
- Grep dans les logs Vercel prod : aucune occurrence de `'[process-step1 2.3] budget_transfers INSERT failed'` après le déploiement
- Si option (A) : `pnpm verify` exit 0 + smoke browser confirme que les récaps CAS 2 fonctionnent toujours
- Si option (B) : la migration est appliquée via `apply-sql.mjs` → `migration repair --status applied` → re-export baseline → `pnpm db:check-drift` exit 0

---

## Axe 2 — Ajouter un test de caractérisation gated pour le path L673 (ÉTAPE 2.4.2)

### Contexte

Le commit 2 du Sprint I5 a livré 5 cas de caractérisation gated `SUPABASE_RECAP_TESTS=1`. Aucun n'exerce explicitement le path ÉTAPE 2.4.2 (`refloat_from_savings`) qui était la cible du fix L673 (raw SELECT-then-UPDATE → RPC atomique). La couverture vient des 4 cas pure-unit dans `step1-algorithm.test.ts > CAS 2 ÉTAPE 2.4.2 — 2nd-pass refloat from remaining savings`, mais aucun ne valide que :
1. Le RPC `updateBudgetCumulatedSavings` est réellement appelé (vs raw UPDATE)
2. La row `budget_transfers` (from=savings, to=deficit) est persistée
3. La `cumulated_savings` côté DB est décrementée du bon montant

Construire un fixture qui déclenche 2.4.2 demande un alignement précis :
- gap < total_savings (pour que 2.2 ne consomme pas tous les savings)
- totalDeficit > gap (pour que 2.3.1 refloue partiellement → deficit-en-mémoire reste > 0)
- savings restants > 0 à la fin de 2.2
- gap résiduel ≤ ROUNDING_TOLERANCE après 2.3 (pour que `isFullyBalanced=true` → entrée dans le `if` block 2.4.x)

Le sprint principal a abandonné cette construction faute de marge de temps — c'est non-trivial à faire byte-identique avec la math du `_loadFinancialData` orchestrator.

### Objectif

Ajouter un 6ᵉ cas dans [app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts](../app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts) qui :
- Construit un fixture déclenchant la 2.4.2 (cf. la math nécessaire ci-dessous)
- Asserte la présence d'une row `budget_transfers` avec `from_budget_id = savingsBudgetId` ET `to_budget_id = deficitBudgetId`
- Asserte la décrémentation de `cumulated_savings` côté DB (lecture post-POST)
- Asserte la présence de l'op `step: '2.4.2.2'` dans `operations_performed`

### Approche suggérée

Fixture math (à valider en blanc avant POST) :
- estimated_income = 300 (incomeContribution = 300 si pas de real_income lié, pas de salaire)
- 4 budgets :
  - `B1` deficit : estimated=100, real_expense=300 (avec `amount_from_budget: 300` — sinon la table default 0 fait que la calc deficit lit 0 cf. `lib/finance/financial-data.ts:138-143`) → deficit=200
  - `B2` savings : estimated=100, cumulated_savings=400, real_expense=100 (linked avec `amount_from_budget: 100` → spent=100, surplus=0, deficit=0)
  - `B3` savings : estimated=100, cumulated_savings=300, real_expense=100 → spent=100, surplus=0, deficit=0
  - `B4` neutral : estimated=100, real_expense=100 → spent=100, surplus=0, deficit=0
- totalEstimatedBudgets = 400 → ravBudgetaire = 300 - 400 = -100
- remainingToLive = 300 - 400 - 200 = -300 → difference = -200 → CAS 2, gap=200
- 2.2 : totalSavings=700 ≥ gap=200 → consomme 200 (B2 prend 200×400/700≈114.3, B3 prend 200×300/700≈85.7). Savings restants = (400-114.3) + (300-85.7) = 500. **gap=0 après 2.2**
- 2.3 : skipped (gap=0)
- 2.3.1 : ressourcesUtilisees=200, totalDeficit=200, montantARenflouer=200, B1 transferAmount=200, deficit→0
- À ce point : 2.4.1 evalue le RAV après refetch. Si le refetch sees savings 500 mais B1 deficit est encore =200 (pas changé en DB, seul `budget_transfers` a une row null→B1), alors remainingToLive après = 300 - 400 - 200 + (le budget_transfer null→B1 ne change pas la formule, vérifier) → -300. newDifference = -300 - (-100) = -200 < 0 → pas de 2.4.1 piggy push.
- 2.4.2 : `budgetsWithDeficit.length > 0` (oui, B1 entry) AND `budgetsWithSavings.some(s > 0)` (oui, B2/B3 restants en mémoire). FIRES. B1.deficit en mémoire = 0 (décrementée à 2.3.1 ligne `deficitBudget.deficit -= transferAmount`). **`remainingDeficit = 0` → inner loops do nothing → 0 ops 2.4.2 émises.** 

→ Bingo, le fixture proposé ne déclenche pas 2.4.2 non plus. **C'est le crux du problème** : pour que `remainingDeficit > 0` à l'entrée de 2.4.2, il faut que 2.3.1 ait refloué partiellement.

Math corrigée :
- B1 deficit = 400 (plus gros)
- gap initial = 200 (inchangé : remainingToLive = 300 - 400 - 400 = -500, diff = -400 = gap=400 ; pour que ça compile, augmenter le real_expense de B1)

Refait :
- B1 : estimated=100, real_expense=600 (amount_from_budget=600) → deficit=500
- B2 savings=300, B3 savings=400 (les autres neutres)
- estimated_income=400 → ravBudgetaire = 400 - 400 = 0
- remainingToLive = 400 - 400 - 500 = -500 → difference=-500, gap=500
- 2.2 : totalSavings=700, amountToUse=500. B2 prend 500×300/700≈214.3, B3 prend 500×400/700≈285.7. gap→0. Savings restants : B2=85.7, B3=114.3, total=200
- 2.3 : skipped
- 2.3.1 : ressourcesUtilisees=500, totalDeficit=500, B1 transferAmount=500, deficit en mémoire → 0
- 2.4.2 : same problem — B1.deficit en mémoire = 0 → inner loops skip.

**Conclusion math** : `deficitBudget.deficit -= transferAmount` à L545 (route originale) décremente le deficit du MONTANT renfloué. Si 2.3.1 renfloue TOUT le deficit (montantARenflouer == totalDeficit == ressourcesUtilisees), alors B1.deficit en mémoire = 0 et 2.4.2 n'a rien à faire.

Pour déclencher 2.4.2 :
- Il faut que `totalDeficit > ressourcesUtilisees` (qui = gapInitial - gapResiduel)
- Equivalent : gap couvert par 2.2+2.3 < total_deficit → 2.3.1 partial refloat → deficit-en-mémoire > 0 → 2.4.2 fires si savings restantes > 0

Et pour que 2.4.2 ait des savings à utiliser : il faut que 2.2 n'ait PAS épuisé tous les savings → `gap < totalSavings`.

Math :
- gap = 200, totalSavings = 700 (gap < totalSavings ✓)
- totalDeficit = 1000 (avec say 2 deficit budgets de 500 chacun)
- ressourcesUtilisees = 200 (gap fully covered by 2.2), montantARenflouer = min(200, 1000) = 200
- Per deficit budget : transferAmount = 500/1000 × 200 = 100 → deficit→400 (remainingDeficit en mémoire après 2.3.1)
- 2.4.2 : fires. totalSavingsLeft = 700 - 200 = 500.
- Pour B1.deficit=400 : prop par savings budget, amountFromSavings calc. **At least 1 op 2.4.2.2 émise.**

Maintenant comment construire ce fixture en termes Supabase :
- 2 deficit budgets : B1 (deficit=500, estimated=100, spent=600), B2 (deficit=500, estimated=100, spent=600) — avec real_expense.amount_from_budget=600 chacun
- 2 savings budgets : B3 (savings=300, estimated=100, real_expense=100), B4 (savings=400, estimated=100, real_expense=100)
- 1 neutral : B5 (estimated=100, real_expense=100)
- estimated_income=500 → ravBudgetaire = 500 - 500 = 0
- remainingToLive = 500 - 500 - 1000 = -1000 → diff=-1000, gap=1000
- 2.2 : totalSavings=700, amountToUse=700 (tout consommé !) → savings exhaustées, gap→300

Mismatched. Pour que 2.2 ne consomme PAS tout : gap < totalSavings. Donc gap=200 → diff=-200 → remainingToLive=-200, but ravBudgetaire=0 → remainingToLive = estimated_income - totalEstimatedBudgets - totalBudgetDeficits = 500 - 500 - totalBudgetDeficits = -totalBudgetDeficits. Pour remainingToLive=-200 il faut totalBudgetDeficits=200. Mais on voulait totalDeficit=1000.

Ces contraintes sont incompatibles : `gap = |totalIncomeContribution - totalEstimatedIncome - sum_deficits + autres ajustements| ≈ sum_deficits` (sans exceptionals). Pour avoir gap < total_deficit, il faut introduire des incomeCompensation > totalEstimatedIncome (real_income > estimated_income sur certaines lignes) ou des exceptionalIncomes.

Math avec real_income :
- estimated_income=500, real_income=1300 (linked à l'estimé 500) → incomeCompensation=1300 (real > estimated, takes the real)
- estimated_budgets total = 1500, real_expenses incompatibles → on va calculer
- Nous voulons gap≈200, totalDeficit=1000, totalSavings=500 (en surplus dans 2 budgets, le reste neutre)

Setup :
- B1 deficit : estimated=100, real_expense=600 (amount_from_budget=600) → deficit=500
- B2 deficit : estimated=100, real_expense=600 (amount_from_budget=600) → deficit=500
- B3 savings : estimated=100, cumulated_savings=200, real_expense=100 (amount_from_budget=100) → spent=100, surplus=0, deficit=0
- B4 savings : estimated=100, cumulated_savings=300, real_expense=100 (amount_from_budget=100) → spent=100, surplus=0, deficit=0
- B5 neutral : estimated=100, real_expense=100
- totalEstimatedBudgets = 500
- totalRealExpenses = 1500
- estimated_income=300, real_income=500 linked → incomeCompensation=500, incomeContribution=500
- exceptionalIncomes=0, exceptionalExpenses=0
- remainingToLive = 500 - 500 - 1000 = -1000 → diff=-1000-(300-500) = -1000 - (-200) = -800

Pas tout à fait. ravBudgetaire = totalEstimatedIncome (300) - totalEstimatedBudgets (500) = -200. remainingToLive=-1000. diff = -1000 - (-200) = -800. gap=800. totalDeficit=1000.

gap=800 < totalSavings=500 ? NON, 800 > 500. → 2.2 va exhauster les savings. Pas bon.

Pour gap < totalSavings : augmenter savings ou diminuer gap.
- Si total_savings=900 (B3=400, B4=500), gap=800 → amountToUseFromSavings=800. B3 prend 800×400/900≈355.6, B4 prend 800×500/900≈444.4. Savings restantes : B3≈44.4, B4≈55.6, total≈100 > 0.
- ressourcesUtilisees=800, totalDeficit=1000, montantARenflouer=min(800,1000)=800. Per deficit B1=500/1000×800=400, B2 idem. Deficit en mémoire B1: 100, B2: 100. Total deficit-en-mémoire après 2.3.1 = 200 > 0.
- 2.4.2 fires : totalSavingsLeft=100, pour B1 (deficit=100), amountFromSavings = min(prop×100, savings). prop_B3 = 44.4/100=0.444, amount = min(0.444×100, 44.4) = 44.4. Émet 1 op.
- B2 (deficit=100), totalSavingsLeft réévalué = 55.6 (B3 vide après B1's op), prop_B4 = 55.6/55.6=1, amount = min(1×100, 55.6) = 55.6. Émet 1 op.

Total ops 2.4.2.2 = 2. ✓

Fixture cible :
- B1 : estimated=100, real_expense {amount=600, amount_from_budget=600}, cumulated_savings=0
- B2 : estimated=100, real_expense {amount=600, amount_from_budget=600}, cumulated_savings=0
- B3 : estimated=100, cumulated_savings=400, real_expense {amount=100, amount_from_budget=100}
- B4 : estimated=100, cumulated_savings=500, real_expense {amount=100, amount_from_budget=100}
- B5 : estimated=100, real_expense {amount=100, amount_from_budget=100}, cumulated_savings=0
- estimated_income=300, real_income=500 linked
- bank_balance=2000, piggy_bank=50

(à valider en blanc avant POST : math sur `_loadFinancialData` qui peut donner un remainingToLive différent — l'`incomeCompensation` logic est non-trivial)

### Fichiers concernés

- `app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts` — ajouter 1 nouveau cas `it('CAS 2 ÉTAPE 2.4.2: 2nd-pass refloat depuis savings vers deficit (exerce le fix L673)', ...)`

### Critères de succès

- `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/` exit 0 — 6/6 cas passent
- Le nouveau cas observe `operations_performed.some(o => o.step === '2.4.2.2')` = true
- DB side effects : `cumulated_savings` de B3 ET B4 a été décrémentée via RPC ; `budget_transfers` contient ≥1 row avec `from_budget_id = B3 || B4` AND `to_budget_id = B1 || B2`

---

## Axe 3 — Concurrency safety : protéger l'application de la décision contre une race entre snapshot et applyDecision

### Symptôme

Le pipeline `processStep1(input)` = `loadSnapshot(input)` → `decideStep1Allocation(snapshot)` → `applyDecision(input, snapshot, decision)`. Entre `loadSnapshot` et `applyDecision`, plusieurs centaines de millisecondes s'écoulent (3 Supabase queries + 1 pure computation + N RPC calls). Pendant cette fenêtre, une autre instance de `processStep1` lancée par le même utilisateur (e.g., double-clic, retry après timeout) lit le même snapshot, calcule la même décision, et tente d'appliquer les mêmes RPC.

Comportement attendu en concurrence :
- Les 4 RPC `update_*` sont **atomiques** (Sprint 0 / C3). Un double-call ne crash pas — chacune applique son delta. Mais : double-application = double-débit.
- Exemple : process-step1 first call décide "déduire 100€ des savings de B3" → RPC fire → B3=0. Second call (concurrent) a lu le snapshot AVANT le RPC du first call → décide aussi "déduire 100€ des savings de B3" → RPC fire → `cumulated_savings < 0` → le RPC `RAISE EXCEPTION` (cf. `supabase/migrations/20260506000000_create_finance_rpcs.sql:128`).
- `applyDecision` catch l'exception au step 2.2 et **re-throw** (line `throw new Error('Erreur mise à jour économies ...')`) → 500. Aucun rollback des RPC déjà appliquées par le first call.

État DB après le crash du second call :
- B3.cumulated_savings = 0 (déduit par first call)
- Les RPC suivantes que le second call aurait dû faire (2.3.1 INSERTs, 2.4.1, 2.4.2) ne sont pas appliquées
- `operations_performed` côté client : crash 500 sans détails

### Pourquoi le Sprint Refactor-I5 a préservé verbatim

Le sprint a préservé l'invariant "math identique, atomicité ajoutée au L673" sans étendre la portée à la concurrence cross-invocation. C'est cohérent avec le scope plan.

### Objectif

Décider si on ajoute une protection contre double-invocation, et choisir l'approche :

**(A) Idempotency key côté handler** — la route accepte un header `Idempotency-Key: <uuid>`. Le persist layer stocke `(idempotency_key, user_id, response)` dans une nouvelle table `process_step1_executions` (TTL 24h) ; si on reçoit la même clé, retourne la réponse cachée. Pattern Stripe-like. **Complexité moyenne**.

**(B) Distributed lock côté DB** — `SELECT pg_try_advisory_xact_lock(hashtext(user_id))` au début de `processStep1`. Si la lock est déjà tenue par une autre transaction, retourne 409 Conflict. La lock est libérée automatiquement à la fin de la transaction. **Simple**, mais nécessite que `processStep1` tourne dans une transaction PostgreSQL — ce qui n'est pas le cas aujourd'hui (les RPC sont autonomes).

**(C) Optimistic concurrency check** — le snapshot inclut un version stamp (e.g., `monthly_recaps.updated_at` ou un `version` column ajouté). Le persist layer vérifie avant CHAQUE RPC que le stamp n'a pas changé. Si oui, abandonne et retourne 409. **Complexe**, surtout pour la suite RPC.

**(D) Don't protect, document the edge case** — le double-clic est rare en pratique (le frontend disable le bouton après le premier clic). Accepter le crash 500 et le state half-applied comme cas marginal. **Le plus simple**. À documenter dans CLAUDE.md §8 comme connu.

**Recommandation par défaut** : (D) pour aujourd'hui, avec une note dans CLAUDE.md §8 ❌ "Connue : double-clic process-step1 peut laisser un état partiellement appliqué — le frontend doit disable le bouton après le premier clic". Ré-évaluer si un utilisateur rapporte le bug.

### Vérification frontend

Avant de prendre la décision, vérifier que `components/monthly-recap/MonthlyRecapFlow.tsx` (le seul consumer du endpoint) bien :
- Disable le bouton "Étape 1" pendant que le fetch est en cours
- Ne retry pas automatiquement sur erreur 500
- Affiche un message clair sur erreur

Si oui → option (D) est suffisante.

### Fichiers concernés

- `components/monthly-recap/MonthlyRecapFlow.tsx` — audit du bouton "Étape 1" (button disabled state, loading state, error UX)
- Si option (A) : créer `supabase/migrations/<TS>_create_process_step1_executions.sql` + modifier `lib/recap/step1-persist.ts` + `lib/schemas/recap.ts` (header schema)
- Si option (B) : modifier `lib/recap/step1-persist.ts` pour wrapper dans un SQL `BEGIN; SELECT pg_try_advisory_xact_lock(...)...; COMMIT;` block
- Si option (D) : update CLAUDE.md §8 + commenter le risque dans `lib/recap/step1-persist.ts` au-dessus de `processStep1`

### Critères de succès

- Option (D) : doc claire dans CLAUDE.md §8 + commentaire `processStep1` mentionnant l'edge case
- Option (A)/(B)/(C) : test gated `SUPABASE_RECAP_TESTS=1` qui lance 2× `POST /process-step1` en parallèle pour le même user et asserte que la 2ᵉ retourne 409 (ou la réponse cachée pour (A))

---

## Hors scope (à séparer)

- **`amount_from_budget` default 0 dans real_expenses** — découvert pendant le commit 2 (fixture seeding). La column `real_expenses.amount_from_budget` a un default DB de 0, ce qui casse la calc deficit dans `lib/finance/financial-data.ts:138-143` si un real_expense est inséré sans setter explicit (e.g., insertion manuelle ou path non-smart-allocation). **Affecte au-delà de process-step1** — touche toute lecture du RAV. À investiguer dans un sprint dédié `chantier amount-from-budget-audit` (grep tous les sites qui INSERT real_expenses, valider qu'ils setent amount_from_budget proprement).
- **Chantier 07.8 Zod rollout** — le Sprint I5 a installé `parseBody` + 1 schema. Le rollout complet aux autres handlers (~30 modules) reste à faire. Voir `prompt/prompt-07-deep-dive-zod-rollout.md` si présent dans `prompt/`.
- **`buildTransferPayload` helper** — extracted dans step1-persist.ts L62-71. Si un 2ᵉ consumer apparaît, lift dans `lib/finance/transfers.ts` ou `lib/api/supabase-helpers.ts`.
- **Smoke browser deferred from Sprint I5** — exécuter un récap mensuel cas 1 ET cas 2 sur compte test ; comparer piggy_bank, cumulated_savings, budget_transfers avant/après — doivent matcher le comportement pre-Sprint-I5. Si divergence trouvée → bug régression, fix urgent.

---

## Workflow recommandé pour la session

1. Lire **CLAUDE.md §5/§8/§11** et le **plan I5 dans** `C:\Users\gille\.claude\plans\refactor-i5-gentle-shore.md`.
2. Vérifier l'état du repo : `git log --oneline -15` doit montrer la suite des 9 commits Sprint Refactor-I5.
3. Lancer `pnpm verify` pour confirmer baseline propre (typecheck + tests + 6 db:* exit 0).
4. Lancer `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/` — doit pass 5/5.
5. **Phase 1 — Investigation Axe 1** : grep cross-codebase pour les consumers de `budget_transfers WHERE to_budget_id IS NULL`. Grep prod logs pour `'[process-step1 2.3] budget_transfers INSERT failed'`. Discuter avec l'utilisateur via AskUserQuestion pour arbitrer (A) vs (B) vs (C).
6. **Phase 2 — Implémenter Axe 1** : 1-3 commits selon l'option choisie.
7. **Phase 3 — Axe 2** : ajouter le 6ᵉ cas caractérisation, 1 commit.
8. **Phase 4 — Axe 3** : audit du frontend, AskUserQuestion sur l'option (D vs autres), implémenter le choix, 1-2 commits.
9. Closeout CLAUDE.md §11 avec une nouvelle entrée Sprint Refactor-I5-followup.

## Critères de succès globaux

- `pnpm verify` exit 0 à la fin
- Tests gated exit 0 (`SUPABASE_RECAP_TESTS=1` + autres)
- Lint baseline 183 warnings stable ou en baisse
- CLAUDE.md §11 mis à jour
- Aucun nouveau cast `as unknown as SupabaseClient` introduit (counter doit rester à 0)
