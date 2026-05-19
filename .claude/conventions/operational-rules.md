# Règles opérationnelles — précédents, exemples, cleanup-attempts CRITIQUES

> Extraction détaillée de CLAUDE.md §8 (justifications longues, exemples, précédents).

## 1. Pattern Path B closed-by-deletion (8+ cas)

Pour tout candidat de cleanup ou de refactor non-trivial, vérifier d'abord les consumers cross-codebase. Si **0 consumer applicatif** : préférer **Path B DELETE** (CLAUDE.md system prompt "Don't design for hypothetical future requirements") plutôt que Path A refactor.

**Précédents** :

1. **Sprint Lot 5b** (2026-05-10) — `app/api/monthly-recap/status-test/route.ts` deleted (0 consumer, mock data hardcodé).
2. **Sprint Lot 5c** (2026-05-10) — `testSupabaseConnection()` deleted dans `lib/supabase-client.ts` (0 callsite cross-codebase, 17 LOC).
3. **Sprint Atomicity-Savings v2** (2026-05-12) — `handlePiggyBankAction` deleted dans `app/api/savings/transfer/route.ts` (89 LOC, 3 action types `set_piggy_bank`/`add_to_piggy_bank`/`remove_from_piggy_bank` confirmed dead code).
4. **Sprint Dead-Code-Purge** (2026-05-13) — 3 deletions bundled :
   - `lib/auth.ts::resetPassword + updatePassword` (−42 LOC, les pages forgot/reset utilisent `supabase.auth.*` direct).
   - `app/api/debug/{remaining-to-live,financial,group-financial}/route.ts` (−504 LOC, 0 consumer cross-codebase, toutes gated `blockInProduction()` 404 prod).
   - `lib/contribution-calculator.ts::calculateMinimumSalary + calculateMaximumGroupBudget` (−17 LOC, 0 consumer).
5. **Sprint UserGroupsList-Cleanup** (2026-05-14) — `components/groups/UserGroupsList.tsx` deleted (157 LOC, 0 consumer applicatif, app/settings/page.tsx rend déjà inline la même UI sur `currentGroup` singular).
6. **Sprint Audit-Closeout I3** (2026-05-13) — `lib/monthly-recap-calculations.ts` deleted (399 LOC, 8 exports tous orphelins).
7. **Sprint Zod-Rollout v8** (2026-05-14) — `components/groups/GroupMembersModal.tsx` deleted (175 LOC, 0 consumer).
8. **Sprint Refactor-Settings-Drawer** (2026-05-18) — `app/settings/page.tsx` deleted (~457 LOC, 0 consumer applicatif hors `dashboard` + `group-dashboard` qui basculent vers `<SettingsDrawer>` swap-horizontal in-place). Le bug intermittent "1 fois sur 2 retour au dashboard" est éliminé mécaniquement (plus de `window.location.href` ni `window.history.back()` fragile sur PWA + middleware `checkRecapStatus`). `/settings` retiré de `protectedRoutes` middleware.ts. Le contenu de la page est extrait dans `components/settings/GroupManagementPanel.tsx` (verbatim sauf : loading overlay full-screen remplacé par snackbar non-bloquante z-[60] + skeleton léger). Aucun deep-link applicatif (PWA install / push notif) à `/settings`.

**Pattern** : (a) `Grep "<exportName>" --glob '**/*.{ts,tsx}'` cross-codebase ; (b) `Grep` dans `app/`, `components/`, `hooks/`, `contexts/`, `lib/`, `middleware.ts`, `__tests__/` (scope MUST inclure tous pour éviter de manquer un consumer — leçon Sprint Lot 5c qui scope-bound à `app/` only et a manqué `contexts/AuthContext.tsx:14` register callback consommant `signUp`).

## 2. God-files monthly-recap stateful — 4/4 extraits

Pattern d'extraction `route.ts → lib/recap/{types,algorithm,persist}.ts + thin handler + N caract gated + M algorithm tests + K mocked tests` standardisé sur 4 routes :

| Route                    | Sprint                             | Pre LOC         | Post LOC                        | Tests ajoutés                        |
| ------------------------ | ---------------------------------- | --------------- | ------------------------------- | ------------------------------------ |
| `process-step1/route.ts` | Refactor-I5 (2026-05-11)           | 740             | 45                              | 33 algo + 8 mocked + 6 caract gated  |
| `complete/route.ts`      | Refactor-I6 (2026-05-14)           | 703 + 4 globals | 59                              | 32 algo + 18 mocked + 5 caract gated |
| `auto-balance/route.ts`  | Refactor-Auto-Balance (2026-05-16) | 533             | 56                              | 37 algo + 17 mocked + 5 caract gated |
| `recover/route.ts`       | Refactor-Recover (2026-05-16)      | 385             | 168 (POST 80 + GET 76 verbatim) | 21 algo + 16 mocked + 5 caract gated |

Le pattern standardisé en 8 étapes (suivi sur les 4 sprints) :

1. **Caract tests gated** d'abord (byte-identique pré-refactor)
2. **Types pure module** (`*-types.ts` 0 runtime)
3. **Algorithm pur** 0 I/O / 0 console / 0 Date.now / immutable + sort déterministe
4. **Unit tests algorithm** (pure-unit non-gated)
5. **Persist I/O** avec fail-soft semantics + custom errors
6. **Mocked tests persist** (vi.mock hoisted + dynamic import in test)
7. **Rewire route thin handler** + barrel + ESLint glob no-console:'error'
8. **Closeout doc**

**`balance/route.ts`** reste hors scope d'extraction post-Sprint Balance-Atomicity-Eval (2026-05-16) qui a confirmé la route déjà atomique by design (0 reversed pattern). L'extraction serait pure consolidation refactor mirror I5/I6 sans gain.

## 3. Cleanup-attempts CRITIQUES préservés

Patterns à NE PAS supprimer même si fail-soft cosmétique :

- **`savings/transfer/route.ts` pré-Sprint Atomicity-Savings** (L122/L321/L337) — rollback FROM impossible / rollback piggy UPDATE impossible / rollback piggy INSERT impossible. Regression-guardés Sprint Refactor-Test-Coverage 2026-05-12 puis **fermés à la racine** Sprint Atomicity-Savings 2026-05-12 via composite RPCs `transfer_savings_between_budgets` + `transfer_budget_to_piggy_bank` (les 3 cleanup-attempts n'existent plus dans le code post-fix ; les tests PIN ATOMIC CONTRACT pinnent le single-call-site invariant).

- **`recover-persist.ts:applyRecoveryDecision`** (route L286-288 pre-refactor Sprint Refactor-Recover 2026-05-16) — unexpected exceptions → `logger.error('[recover] rollback partiel impossible (snapshot may stay active)')` + throw `RecoveryAppliedPartiallyError` carrying partialResults. Le HTTP handler catch ce type d'erreur dédié et retourne 500 + recovery_results in body (shape byte-identique pre-refactor). Regression-guardé par le test "unexpected exception in apply loop" dans recover-persist.test.ts.

- **`auth/session/route.ts:56`** (Sprint Lot 5b) — Supabase auth réussi mais JWT session fail → état inconsistant grep-able. `logger.error` préservé.

- **`app/auth/confirm/route.ts:46`** (Sprint Lot 5c) — OTP verification réussie mais `data.user` manquant (edge case non-évident). ⚠️ **OBSOLETE (Sprint Fix-Password-Reset-OTP 2026-05-19)** — fichier supprimé, remplacé par client page `app/auth/confirm/page.tsx` (Path B closed-by-deletion + nouveau pattern click-to-confirm scanner-resistant cf. §7). Le cleanup-attempt n'a plus de site applicable : `verifyOtp` côté client ne peut pas retourner success+no-user (la session est créée localStorage par le SDK).

- **`database-snapshot.ts:169-173`** (Sprint Lot 5c) — 5 statements `logger.info` (snapshot ID + mois + total records + per-table counts — foundational pour audit recovery si rollback nécessaire post-process-step1).

- **`useMonthlyRecap.ts:84/115/157`** (Sprint Lot 5) — /monthly-recap/transfer + /auto-balance + /complete fail → état inconsistant si client cascade fail après server commit.

- **`useGroups.ts:145+168`** (Sprint Lot 5) — join/leave cross-mutation cascade fail (financial state stale risk).

- **`SavingsDistributionDrawer.tsx:171`** (Sprint Lot 5) — POST /savings/transfer fail peut laisser DB partiellement débitée, no toast UX.

- **`ServiceWorkerRegistration.tsx:18`** (Sprint Lot 5) — silent par design, log nécessaire pour tickets support 'offline ne marche pas'.

## 4. Composite RPCs atomiques (battle-tested)

Pour toute paire ou triplet d'opérations DB sur les colonnes sensibles (`piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings`), utiliser un helper `lib/finance/*` qui invoque une composite RPC :

| Helper                             | RPC                                     | Sprint                      | Use case                                                                               |
| ---------------------------------- | --------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `updatePiggyBank`                  | `update_piggy_bank_amount`              | Sprint 0 / C3               | Single piggy debit/credit                                                              |
| `updateBankBalance`                | `update_bank_balance`                   | Sprint 0 / C3               | Single bank update                                                                     |
| `updateBudgetCumulatedSavings`     | `update_budget_cumulated_savings`       | Sprint 0 / C3               | Single savings update                                                                  |
| `transferFromPiggyToBudget`        | `transfer_from_piggy_to_budget`         | Sprint 0 / C3               | Piggy debit + budget savings credit                                                    |
| `transferWithSavingsDebit`         | `transfer_with_savings_debit`           | Refactor-I5-followup-v2     | INSERT budget_transfers + debit cumulated_savings                                      |
| `addExpenseWithBreakdown`          | `add_expense_with_breakdown`            | Atomicity-Expenses          | Smart-allocation expense (piggy + savings + INSERT real_expenses)                      |
| `transferSavingsBetweenBudgets`    | `transfer_savings_between_budgets`      | Atomicity-Savings           | Debit FROM + credit TO en 1 tx                                                         |
| `transferBudgetToPiggyBank`        | `transfer_budget_to_piggy_bank`         | Atomicity-Savings           | Debit budget + UPSERT piggy_bank                                                       |
| `transferPiggyToBudgetWithInsert`  | `transfer_piggy_to_budget_with_insert`  | Auto-Balance-Atomic-Phase-B | Debit piggy + INSERT budget_transfers (from_budget_id=NULL)                            |
| `addExpenseWithCrossBudgetCascade` | `add_expense_with_cross_budget_cascade` | P4-P5-P6                    | Cross-budget cascade expense (piggy + local_savings + budget + N cross-budget sources) |

`EXPECTED_RPCS = 10` pinnés dans [scripts/check-rpcs.mjs](../../scripts/check-rpcs.mjs).

## 5. Patterns ❌ "Ne pas réintroduire X"

### Séquences non-atomiques (smart-allocation / savings transfer / auto-balance)

- ❌ **NE PAS** appeler `updatePiggyBank` puis `updateBudgetCumulatedSavings` puis `supabaseServer.from('real_expenses').insert(...)` séparément pour smart-allocation → utiliser `addExpenseWithBreakdown` (Sprint Atomicity-Expenses).
- ❌ **NE PAS** appeler `updateBudgetCumulatedSavings` deux fois séparées avec un manual rollback compensatoire → utiliser `transferSavingsBetweenBudgets` (Sprint Atomicity-Savings).
- ❌ **NE PAS** réintroduire le pattern reversed `for(savingsUpdates) updateBudgetCumulatedSavings → INSERT batched` dans `auto-balance/route.ts` → utiliser `transferWithSavingsDebit` per-pair (Sprint Auto-Balance-Atomic).
- ❌ **NE PAS** réintroduire le pattern reversed `updatePiggyBank(aggregate) + INSERT batched budget_transfers (from_budget_id=NULL)` → utiliser `transferPiggyToBudgetWithInsert` per-pair (Sprint Auto-Balance-Atomic-Phase-B).

### God-files monthly-recap

- ❌ **NE PAS** réintroduire de logique métier dans `process-step1/route.ts`, `complete/route.ts`, `auto-balance/route.ts`, `recover/route.ts` (4/4 extraits). Tout ajout passe par `lib/recap/<route>-{algorithm,persist,types}.ts`.
- ❌ **NE PAS** réintroduire `declare global` dans aucune route (0 occurrence post-Refactor-I6).
- ❌ **NE PAS** réintroduire le pattern SELECT-then-UPDATE sur `cumulated_savings` dans `complete/route.ts` (L484 pre-Refactor-I6 fix).

### Idempotency / retries

- ❌ **NE PAS retry automatiquement** un POST `/api/monthly-recap/process-step1` qui retourne une 5xx — la route n'est pas idempotente. Le frontend doit disable le bouton pendant la submission (pattern `isSubmitting` dans [MonthlyRecapStep1.tsx](../../components/monthly-recap/MonthlyRecapStep1.tsx)). Si un futur incident montre des states cassés, prioritiser idempotency key serveur-side (header `Idempotency-Key` + cache table) ou `pg_try_advisory_xact_lock(hashtext(user_id))` plutôt que retry client.

### RAV formula

- ❌ **NE PAS** réintroduire `cumulated_savings` comme terme additif dans la formule RAV (`calculateRemainingToLiveProfile`/`Group`). La formule canonique est `totalIncomeContribution + exceptionalIncomes - estimatedBudgets - exceptionalExpenses - budgetDeficits`. Le `totalSavings` est exposé séparément sur `FinancialData.totalSavings`.
- ❌ **NE PAS** dépendre de la colonne `estimated_budgets.monthly_surplus_deficit` comme source du terme `budgetDeficits` — le déficit est calculé **on-the-fly** via `calculateBudgetDeficit(estimatedAmount, spentThisMonth)`.

### budget_transfers.monthly_recap_id

- ❌ **NE PAS** ajouter un consumer qui FILTER/JOIN sur `budget_transfers.monthly_recap_id` sans d'abord plumber `recapId` à travers les 5 paths automatiques (step1-persist 2.3.1+2.4.2 via RPC `transfer_with_savings_debit` qui devrait accepter `p_recap_id`, auto-balance, balance, complete). Aujourd'hui la colonne est best-effort/NULL pour les paths automatiques. Un JOIN naïf raterait la quasi-totalité des transferts récap.

### recover route — strict boolean invariant

- ❌ **NE PAS** réintroduire `bank_balance: boolean | number` mismatch dans `RecoveryResults` (Sprint Lint-Followups Item 1 2026-05-08). Les paths V1 (update_bank_balance_v1) ET V2 (restoreTable resultKey 'bank_balance'/'piggy_bank') doivent assigner `true` strict (NEVER numeric `data.length`, NEVER `Boolean(x)`). Regression-guardé par 3 cas A/B/C dans `lib/__tests__/api-regressions.test.ts` gated `SUPABASE_API_TESTS=1`.

### recover — 5 tables v2 NON-restaurées

- ❌ **NE PAS** ajouter `profiles`, `groups`, `group_contributions`, `monthly_recaps`, `remaining_to_live_snapshots` dans `RestorableTable` literal union de `lib/recap/recover-types.ts`. Ces 5 tables contiennent de l'identity/membership/output/audit-trail data qui serait écrasée par snapshot restore. Sprint dédié `Recover-V2-Complete-Restoration` avec FK cascade tests requis avant.

### Tests gated monthly-recap

- ❌ **NE PAS supposer** dans un test gated que `bank_balances.current_remaining_to_live` reste à la valeur seedée pendant `loadCompleteSnapshot`. Step 2 appelle `getProfileFinancialData` qui recompute le RAV from scratch et **écrase la colonne via `saveRavToDatabase`** avant que step 6 ne re-lise. Cas vu Sprint Complete-CAS3-TestFix (2026-05-15). Tracer la séquence end-to-end avant d'asserter sur `bank_balances` ou `real_expenses` post-cleanup.

### Modals & UI

- ❌ **NE PAS** créer de nouveau modal en raw `<div className="fixed inset-0 ...">` — utiliser `<Dialog>` + `<DialogContent>` (Sprint Zod-Rollout v8). 12 surfaces v8 migrées, 12 tests focus-trap regression-guards.
- ❌ **NE PAS** réintroduire un raw `<button onClick> ... <svg path d="M6 18L18 6M6 6l12 12">...</svg></button>` pour le close X d'un modal → utiliser `<ModalCloseX>` (Sprint v10).
- ❌ **NE PAS** réintroduire un wizard single-step `AddTransactionModal` — le wizard 2-step (Step 1 type / Step 2 budgétée-exceptionnelle / Step 3 fields, income skips Step 2) est requis pour P6.
- ❌ **NE PAS** réintroduire le pattern cascade-aggressive piggy→savings→budget dans `calculateBreakdown` — P4 strict default → budget priorité 1, savings cascade UNIQUEMENT si overflow, piggy JAMAIS auto-débitée.
- ❌ **NE PAS** utiliser `window.location.href = '/<route>'` pour naviguer vers une sous-vue qui peut cohabiter dans un drawer/menu déjà ouvert (cas vu Sprint Refactor-Settings-Drawer 2026-05-18 : ancien drawer paramètres → bouton "Gestion du groupe" → `window.location.href = '/settings'` provoquait un full reload + bug intermittent 1/2 sur `history.back()`). Pattern correct : swap horizontal in-place via `[view, setView] = useState<'main'|'sub'>('main')` + 2 panels `absolute inset-0` + `translate-x-{-full,0,full}` + container `overflow-hidden`. Référence : [components/settings/SettingsDrawer.tsx](../../components/settings/SettingsDrawer.tsx).
- ❌ **NE PAS** mettre un loading overlay fullscreen `fixed inset-0 bg-black/50` dans un drawer/sub-panel — préférer **spinner inline** sur les boutons submit + **snackbar non-bloquante z-[60]** sur success (pattern `ProfileSettingsCard.tsx:266-275`). Pour le loading initial d'un fetch dans un panel : skeleton `animate-pulse` léger localisé sur la Card concernée (pattern `ProfileSettingsCard.tsx:33-44`).
- ❌ **NE PAS** imbriquer des `<Card>` (Card racine → Card interne avec actions inline → 2-3 Cards frères) dans un panel de drawer qui doit rester épuré type iOS Settings. Pattern correct (Sprint Rework-Group-Management 2026-05-19, sur [components/settings/GroupManagementPanel.tsx](../../components/settings/GroupManagementPanel.tsx)) : **sections plates** `<section className="space-y-N">` empilées dans un container `space-y-6 overflow-y-auto`, **`<dl>` flat label/valeur** avec séparateurs subtils `border-b border-gray-100 py-2`, **CTA prominent en haut** (style menu-item iOS gradient bleu-indigo, miroir `SettingsDrawer.tsx:92-127`). La Card chrome avec ombre + bordure n'apporte rien dans un panel déjà délimité par le drawer.
- ❌ **NE PAS** placer un bouton d'action destructive ("Quitter", "Supprimer le compte", "Se déconnecter") inline dans le content d'un panel — utiliser un **footer pinned bottom** (`<div className="border-t border-gray-200 p-4">` après le `flex-1 overflow-y-auto`) avec `<Button>` full-width orange ou red. Pattern miroir `SettingsDrawer.tsx:146-154` "Se déconnecter" rouge ; `GroupManagementPanel.tsx` footer "Quitter le groupe" orange (warning, réversible). Le footer slot rend l'action prévisible peu importe la longueur du scroll content.
- ❌ **NE PAS** afficher un bouton actif pour une action que le backend va refuser (false-affordance UX). Pattern correct (Sprint Rework-Group-Management 2026-05-19) : **encart d'info ambré** (`border-amber-200 bg-amber-50 text-amber-800`) au-dessus du bouton expliquant la règle + **bouton désactivé** (`disabled` + `aria-disabled` + `disabled:cursor-not-allowed`) + **handler court-circuité** (defense-in-depth contre click programmatique) + **règle backend matchée** (vérifier `/api/...` retourne 403 dans le même scénario). Exemple : creator avec membres ne peut pas quitter le groupe — encart explique, bouton greyé, handler return early, backend DELETE renvoie 403.

### Forbidden absolus

- ❌ **NE PAS** modifier [supabase/migrations/20260506000000_create_finance_rpcs.sql](../../supabase/migrations/20260506000000_create_finance_rpcs.sql). Pour corriger une RPC : `CREATE OR REPLACE` dans une nouvelle migration.
- ❌ **NE PAS** réactiver `typescript.ignoreBuildErrors`.
- ❌ **NE PAS** upgrader `eslint-config-next` 15→16 maintenant (Sprint 1 séparé).
- ❌ **NE PAS** mocker la DB dans les tests d'intégration — utiliser Supabase local ou staging.
- ❌ **NE PAS** écrire de docs `.md` sans demande explicite (sauf CLAUDE.md, RLS-FINDINGS, prompts/, et les fichiers `.claude/` mis en place pour la refactorisation du CLAUDE.md).
- ❌ **NE PAS** réintroduire les exports supprimés au Sprint Dead-Code-Purge (cf. §1 ci-dessus).
- ❌ **NE PAS** réintroduire un fichier `lib/financial-calculations.ts` — le god file (1069 LOC) a été splitté en 8 modules sous [lib/finance/](../../lib/finance/) au Sprint Refactor-I4.

## 6. Précédents Sprint chronologie résumée

| Sprint                               | Date       | Pattern installé                                                                                                                         | Référence §11 |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Sprint 0 / C3                        | 2026-05-06 | 4 RPC atomiques piggy/bank/savings/transfer-from-piggy                                                                                   | CLAUDE.md §11 |
| Sprint DB / D9                       | 2026-05-07 | Tests concurrence RPC gated SUPABASE_RPC_CONCURRENCY_TESTS=1                                                                             | CLAUDE.md §11 |
| Sprint Refactor / R2                 | 2026-05-07 | `createClient<Database>(...)`                                                                                                            | CLAUDE.md §7  |
| Sprint Refactor-Architecture v3-v5   | 2026-05-08 | `withAuth` / `withAuthAndProfile` wrappers                                                                                               | CLAUDE.md §11 |
| Sprint 1.5                           | 2026-05-09 | TanStack Query + key={editing.id} modal pattern                                                                                          | CLAUDE.md §11 |
| Sprint Refactor-I4                   | 2026-05-11 | Split god-file `lib/financial-calculations.ts` → `lib/finance/`                                                                          | CLAUDE.md §11 |
| Sprint Refactor-I5                   | 2026-05-11 | First god-file recap extraction (process-step1)                                                                                          | CLAUDE.md §11 |
| Sprint Atomicity-Expenses            | 2026-05-12 | Composite RPC `add_expense_with_breakdown`                                                                                               | CLAUDE.md §11 |
| Sprint Atomicity-Savings             | 2026-05-12 | 2 composite RPCs savings transfer                                                                                                        | CLAUDE.md §11 |
| Sprint Refactor-I6                   | 2026-05-14 | Second god-file recap extraction (complete) + 4 globals éliminés                                                                         | CLAUDE.md §11 |
| Sprint Auto-Balance-Atomic + Phase-B | 2026-05-15 | Pattern reversed RPC→INSERT fix (auto-balance PHASE 0 + 1)                                                                               | CLAUDE.md §11 |
| Sprint Refactor-Auto-Balance         | 2026-05-16 | Third god-file recap extraction (auto-balance)                                                                                           | CLAUDE.md §11 |
| Sprint Refactor-Recover              | 2026-05-16 | Fourth god-file recap extraction (recover)                                                                                               | CLAUDE.md §11 |
| Sprint Refactor-Settings-Drawer      | 2026-05-18 | Swap horizontal in-place dans drawer (`<SettingsDrawer>` partagé) + Path B closed-by-deletion `app/settings/page.tsx`                    | CLAUDE.md §11 |
| Sprint Rework-Group-Management       | 2026-05-19 | Sections plates dans panel drawer + footer pinned destructive + readonly button avec backend-match + modal 80vh                          | CLAUDE.md §11 |
| Sprint Fix-Password-Reset-OTP        | 2026-05-19 | Click-to-confirm gate `/auth/confirm` (client page) + `getSiteUrl()` helper + email template `{{ .RedirectTo }}?token_hash=...` (cf. §7) | CLAUDE.md §11 |

Pour la chronologie complète des 96 sprints, voir CLAUDE.md §11 (index des 12 parts `.claude/history/roadmap-detailed-NN-...md`).

## 7. Supabase Auth click-to-confirm gate — scanner-résistance

Sprint Fix-Password-Reset-OTP (2026-05-19) — corrige une régression prod du flow "mot de passe oublié" où le lien de récupération reçu par mail répondait immédiatement `otp_expired` parce que les scanners d'email (Outlook Safe Links, Gmail previewers, antivirus locaux, link-preview bots) GET-prefetchaient `https://...supabase.co/auth/v1/verify?token=...` et consommaient l'OTP single-use **avant** que l'utilisateur ne clique.

### Architecture installée

1. **Browser → `forgot-password`** : appelle `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${getSiteUrl()}/auth/confirm\` })`. Le `redirectTo` est validé par Supabase contre l'allowlist Redirect URLs.
2. **Supabase → email** : template "Reset Password" (Dashboard → Authentication → Email Templates) doit utiliser `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">…</a>`. Ce format évite `{{ .ConfirmationURL }}` qui embed l'endpoint legacy `/auth/v1/verify` consommé au premier GET du scanner.
3. **Utilisateur → `/auth/confirm` (client page)** : `app/auth/confirm/page.tsx` rend du HTML inerte (Suspense + bouton "Confirmer"). `verifyOtp({ token_hash, type })` n'est appelé qu'**au clic explicite**. Les scanners ne ré-exécutent pas le JS → l'OTP survit jusqu'au clic humain.
4. **`verifyOtp` succès → `next` sanitisé** : `sanitizeNext(raw, type)` n'accepte que les URLs same-origin ou les paths relatifs (rejette `//evil.example`, `https://evil.example`). Fallback type-aware (`recovery` → `/reset-password`, autres → `/dashboard`).
5. **`verifyOtp` erreur → `/auth/auth-code-error?error={expired|invalid|server}`** : surface UX existante avec "Demander un nouveau lien" + "Retour à la connexion".

### Helpers + fichiers livrés

- [lib/site-url.ts](../../lib/site-url.ts) — `getSiteUrl()` : browser → `window.location.origin`, SSR → `NEXT_PUBLIC_SITE_URL`, fallback `localhost:3000`. À utiliser pour TOUTE URL absolue côté app (Supabase `redirectTo`, OAuth, futurs deep-links).
- [app/auth/confirm/page.tsx](../../app/auth/confirm/page.tsx) — gate client (148 LOC). 11 cas test dans [app/auth/confirm/\_\_tests\_\_/page.test.tsx](../../app/auth/confirm/__tests__/page.test.tsx) couvrant happy + missing/invalid params + open-redirect rejection + 3 erreurs verifyOtp.
- Supprimés : `app/auth/confirm/route.ts` (server route, scanner-vulnerable), back-link cassé `/mot-de-passe-oublie` → `/forgot-password` dans `reset-password/page.tsx:145`.

### Configuration manuelle Supabase Dashboard (requise post-déploiement)

Projet `jzmppreybwabaeycvasz` :

- **Authentication → URL Configuration → Site URL** : l'URL prod (ex. `https://popoth.app`).
- **Authentication → URL Configuration → Redirect URLs** : `https://popoth.app/**` + `http://localhost:3000/**` (les deux, sinon `resetPasswordForEmail` rejette le `redirectTo`).
- **Authentication → Email Templates → Reset Password** (et idéalement les 4 autres types `signup` / `magiclink` / `invite` / `email_change` qui sont aussi gérés par `/auth/confirm`) : remplacer le `<a>` par `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Réinitialiser mon mot de passe</a>` (adapter `type` et `next` par template). Variables `{{ .Token }}` (6 chiffres) et `{{ .ConfirmationURL }}` interdites.
- **Authentication → Providers → Email → OTP Expiration** : 3600s (1h) par défaut OK. Ne pas baisser sans raison forte (race scanner-prefetch ↔ user-click plus probable).

### ❌ À ne pas réintroduire

- **Server route `app/auth/confirm/route.ts`** — un `route.ts` GET handler consomme l'OTP serveur-side au premier prefetch. Reste un client page (Suspense + bouton).
- **`useEffect` auto-call `verifyOtp()` on-mount** dans `app/auth/confirm/page.tsx` — supprime la protection scanner (certains preloads / link-preview bots exécutent JS minimal). Le clic explicite est obligatoire.
- **`{{ .ConfirmationURL }}`** dans n'importe quel template email Supabase — embed `/auth/v1/verify?token=...` qui est l'endpoint legacy auto-consommateur. Toujours `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=<type>` + path `next` hardcodé.
- **`redirectTo` hardcodé `${window.location.origin}/...`** dans le code — utiliser `getSiteUrl()` pour SSR-safety + un futur usage server-side.
- **`next` query non-sanitisé** dans `/auth/confirm` — l'open-redirect (`?next=https://evil.example`) est un vecteur de phishing. Rester sur `sanitizeNext()` (same-origin + path-relatif uniquement). Regression-guardée par 2 cas test ("rejects external `next` URLs" + "rejects protocol-relative `next` (//evil.example.com)").
- **Migrer vers PKCE flow** sans plan dédié — PKCE stocke le `code_verifier` en localStorage du device qui a fait `resetPasswordForEmail` ; casse le cas cross-device (request laptop, ouvre email phone). Le pattern token_hash + click-to-confirm est scanner-resistant ET cross-device safe.

### Flow cross-référence

Le pattern miroir s'applique aux 4 autres types `EmailOtpType` (signup, magiclink, invite, email_change) — `/auth/confirm` gère déjà les 5 valeurs via `ALLOWED_TYPES` (literal union strict). Si un nouveau type est ajouté côté Supabase, étendre la const + ajouter un cas test "renders gate for type=<new>" dans [page.test.tsx](../../app/auth/confirm/__tests__/page.test.tsx).
