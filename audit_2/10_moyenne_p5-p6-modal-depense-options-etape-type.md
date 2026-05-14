# 10 — P5+P6 : Modal dépense — option économies + étape 1 type budgétée/exceptionnelle

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P5](../next-steps.md) + [P6](../next-steps.md) (backlog produit, couplés) |
| **Type** | feature (refactor UX modal AddTransactionModal) |
| **Priorité** | Moyenne |
| **Effort estimé** | L (1-2 jours) |
| **Statut** | Non commencé |
| **Dépendances** | (Soft) chantier 09 (P4 cascade) — couplé UX, recommandé bundle |
| **Bloque** | — |

## Contexte

next-steps.md P5+P6 :

> ## P5 — Modal dépense : option économies
>
> **Domaine** : UI / modal dépense
>
> Dans la modal d'ajout d'une dépense, proposer à l'utilisateur de prendre dans les économies s'il le souhaite (pas seulement en cas de dépassement P4).
>
> ## P6 — Modal dépense : étape 1 = type
>
> **Domaine** : UI / modal dépense
>
> Dans la même modal (P5), la **première étape** doit être de spécifier si la dépense est budgétée (rattachée à un budget existant) ou exceptionnelle (hors budget).

**Compréhension métier** :
- **P6** : refonte AddTransactionModal en wizard 2-step (ou plus) — étape 1 obligatoire = choix type (budgétée vs exceptionnelle)
- **P5** : dans le flow budgétée, ajouter une option toggle "Utiliser des économies pour cette dépense" pour permettre à l'utilisateur de choisir activement de puiser dans les savings (même si le budget est suffisant)

**Architecture pertinente** :
- `components/dashboard/AddTransactionModal.tsx` (491 LOC actuellement, déjà refactoré Sprint Zod-Rollout v3 + v8)
- `lib/schemas/transactions.ts` (Sprint Zod-Rollout v3) — discriminated union expense|income avec branches expense/income
- `hooks/useRavValidation.ts` (Sprint Zod-Rollout v3 Pattern E)
- `useWatch` pattern (Sprint Zod-Rollout v3 Pattern G) — pour conditional rendering
- `addExpenseWithBreakdown` (Sprint Atomicity-Expenses) — RPC avec from_piggy + from_savings + from_budget params

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Refondre `components/dashboard/AddTransactionModal.tsx` en wizard 2-step :
- **Step 1 (P6)** : choix type "Budgétée" (rattachée à un estimated_budget) vs "Exceptionnelle" (hors budget)
- **Step 2 (P5)** : selon Step 1
  - Si "Budgétée" : sélection budget + montant + description + date + **toggle "Utiliser des économies"** (P5)
  - Si "Exceptionnelle" : montant + description + date (pas de FK budget)

Sans casser : focus trap Radix Dialog v8, atomicity Sprint Atomicity-Expenses, ravValidation Pattern E, discriminated union Zod transactions.ts, accessibilité v6+v7+v8.

### 2. Contexte technique

**Fichiers concernés** :
- `components/dashboard/AddTransactionModal.tsx` (491 LOC → ~600 LOC après wizard)
- `components/dashboard/__tests__/AddTransactionModal.test.tsx` (5 cas RTL Sprint Zod-Rollout v5, à étendre)
- `lib/schemas/transactions.ts` (vérifier si shape change pour le toggle savings)
- Possiblement nouveau composant `components/dashboard/transaction-wizard/{Step1Type,Step2Budgeted,Step2Exceptional}.tsx` pour découpage propre
- `hooks/useRavValidation.ts` (vérifier compat avec toggle savings)

**État actuel** :
- AddTransactionModal en single-step avec radio "Type expense/income" (Sprint Zod-Rollout v3)
- expense branch : sélection budget OU `is_exceptional` toggle (mutex via discriminated union refine)
- Pattern E useRavValidation blocking si overflow
- Migré Radix Dialog v8 + close X via ModalCloseX v10

**Tests existants pertinents** :
- 5 cas RTL `AddTransactionModal.test.tsx` (Sprint Zod-Rollout v5)
- Cas axe-core dans `a11y-audit.test.tsx` (Sprint Zod-Rollout v6/v7)
- Cas focus-trap dans `a11y-audit.test.tsx` (Sprint Zod-Rollout v8/v9)

**Précédents codebase** :
- Sprint Zod-Rollout v3 commit `d984a41` — AddTransactionModal migration react-hook-form + zodResolver + Pattern E
- Sprint Zod-Rollout v5 commit `8ec5906` — 5 cas RTL avec 6-hook mock surface
- Sprint Zod-Rollout v8 commit `63a9e32` — migration Radix Dialog + drop key= parent reset
- Sprint Zod-Rollout v10 commit `e7c8312` — close X via ModalCloseX

### 3. Spécifications fonctionnelles attendues

**Cas nominal — Step 1 Budgétée → Step 2 sans savings** :
1. User click "Ajouter une dépense" → modal ouvre Step 1
2. Step 1 affiche 2 cards (Budgétée / Exceptionnelle), user click "Budgétée"
3. Modal swap vers Step 2 budgeted : sélection budget, montant, description, date, toggle "Utiliser des économies" (off par défaut)
4. User submit → POST `/api/finance/expenses/add-with-logic` avec `is_exceptional: false`, `estimated_budget_id`, `use_savings: false`
5. Backend allocate via `addExpenseWithBreakdown` avec `from_piggy=0, from_savings=0, from_budget=amount`
6. Modal close + dashboard re-render avec dépense visible

**Cas nominal — Step 1 Budgétée → Step 2 avec savings activé** :
1. Idem 1-2-3
2. User active toggle "Utiliser des économies"
3. UI affiche split : "X€ du budget restant + Y€ des économies cumulées" (preview live via useWatch)
4. User submit → POST avec `use_savings: true` ; backend allocate optimisé piggy/savings/budget
5. Atomicity préservée via composite RPC

**Cas nominal — Step 1 Exceptionnelle** :
1. User click "Exceptionnelle"
2. Step 2 exceptional : montant + description + date (pas de budget FK, pas de toggle savings — l'exceptionnelle ne peut pas puiser dans savings d'un budget par définition)
3. Submit → INSERT real_expense avec `is_exceptional: true`, `estimated_budget_id: null`

**Cas edge** :
- User en Step 2 click "Retour" → revient Step 1 avec form preserved (transactionType garde "expense")
- User Esc en Step 1 → close modal
- User Esc en Step 2 → close modal (pas back to step 1)
- Type income : reste single-step (pas de wizard si on garde la modal unifiée expense+income, OR séparer en 2 modals si refactor agressif — décision Phase 1 UX)

**Cas erreur** :
- ravValidation blocking en Step 2 → afficher erreur sous le bouton submit + disable
- Backend RPC fail → erreur affichée, modal reste ouverte

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 strictes
- **Préserver Pattern A-G** Sprint Zod-Rollout v3-v6 : discriminated union, Pattern E useRavValidation, useWatch pour preview, setFocus on invalid submit, aria-describedby + aria-invalid + role=alert, key={editing.id} pour edit mode (n/a Add mode)
- **Préserver Radix Dialog v8** : focus trap, Esc-close, role=dialog, ModalCloseX
- **Step transition** : `useState('step1' | 'step2')` ou `useReducer` si flow plus complexe (transitions back/forward, validation per-step). Préférer useState simple si 2 states uniquement.
- **Form state preservation** : entre step1 → step2 → step1 → step2, le form RHF doit garder ses valeurs (pas reset). Pattern : un seul `useForm` au top du modal, les steps sont des render conditional.
- **Atomicity invariant Sprint Atomicity-Expenses** : la séquence multi-debit + INSERT DOIT rester en 1 tx Postgres composite via `addExpenseWithBreakdown`. Pas de regression à séquence séparée.
- **A11y** : Step 1 cards doivent être focusables (`tabindex` ou role=button), Step 2 setFocus sur premier champ après transition
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Couplage chantier 09 P4** : le toggle "Utiliser des économies" P5 = manuel équivalent de l'auto-cascade P4. **Recommandé** : faire P4+P5+P6 dans le même sprint, sinon coordination des breakdowns devient complexe.

### 5. Critères d'acceptation vérifiables

- [ ] **Wizard 2-step opérationnel** : User flow Step 1 → Step 2 → submit fonctionne pour les 4 combinaisons (Budgétée+savings on/off, Exceptionnelle, income si géré)
- [ ] **Form state preserved** : transitions back/forward gardent les valeurs entrées
- [ ] **a11y wizard** : Step 1 cards focusables au clavier (Tab + Enter), Step 2 premier champ focused au mount, Esc ferme modal (pas back à step1)
- [ ] **Atomicity** : tests gated `add-expense-with-breakdown.test.ts` 6+ cas passants
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests RTL** : 5 cas existants AddTransactionModal mis à jour pour wizard + 3-5 nouveaux cas dédiés P5+P6 (transition step1→step2, toggle savings, exceptional path)
- [ ] **tests focus-trap** : `a11y-audit.test.tsx` AddTransactionModal cas inchangé (Esc ferme modal indépendamment du step)
- [ ] **tests axe-core** : `a11y-audit.test.tsx` AddTransactionModal cas inchangé (0 violations sur Step 1 + Step 2)
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** : tous les flows manuels validés

### 6. Tests à écrire ou à mettre à jour

#### Mise à jour `components/dashboard/__tests__/AddTransactionModal.test.tsx`

```typescript
// Cas existants : adapter pour passer par Step 1 d'abord
it('happy path expense budgétée: step1 → step2 → submit', async () => {
  const user = userEvent.setup()
  render(<AddTransactionModal isOpen onClose={vi.fn()} />)
  // Step 1
  await user.click(screen.getByText(/budgétée/i))
  // Step 2
  await screen.findByLabelText(/budget/i)
  await user.selectOptions(screen.getByLabelText(/budget/i), 'b1')
  await user.type(screen.getByLabelText(/montant/i), '50')
  await user.type(screen.getByLabelText(/description/i), 'Test')
  await user.click(screen.getByRole('button', { name: /ajouter/i }))
  await waitFor(() => expect(addExpenseMock).toHaveBeenCalled())
})

// Nouveau bloc P5+P6
describe('P5+P6 wizard', () => {
  it('Step 1 → Step 2 budgétée renders budget select', async () => {...})
  it('Step 1 → Step 2 exceptionnelle hides budget select', async () => {...})
  it('Step 2 budgétée → toggle savings shows breakdown preview', async () => {...})
  it('Step 2 → back button returns to Step 1 with values preserved', async () => {...})
  it('Esc closes modal in any step (not back-to-step1)', async () => {...})
})
```

#### Tests focus-trap inchangés `a11y-audit.test.tsx`

Vérifier que le test focus-trap AddTransactionModal continue de passer (Esc → close modal → onClose fired). Adapter si la signature interne change.

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (consolidation UX)
  - **§4** : entrée AddTransactionModal mise à jour (wizard 2-step)
  - **§6 ❌** : ajouter "Ne pas réintroduire un single-step AddTransactionModal — le wizard est requis pour P5+P6"
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint P5-P6-Modal-Depense-Wizard** : ...`
- **next-steps.md** : retirer P5 + P6

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s

# 2. Phase 1 audit
# Read components/dashboard/AddTransactionModal.tsx (491 LOC)
# Read lib/schemas/transactions.ts (discriminated union)
# Read hooks/useRavValidation.ts (Pattern E)
# Décider arch : useState vs useReducer pour step state, single useForm vs multi

# 3. Implementation
# Edit components/dashboard/AddTransactionModal.tsx :
# - Add useState<'step1' | 'step2'>('step1')
# - Step 1 render : 2 cards Budgétée / Exceptionnelle
# - Step 2 render : adapt selon transactionType
# - Toggle savings (P5) dans Step 2 budgétée
# - Back button Step 2 → setStep('step1')
# Pas de schema change majeur — discriminated union expense|income reste

# 4. Tests
# Edit components/dashboard/__tests__/AddTransactionModal.test.tsx (adapter 5 + ajouter 5)
pnpm test:run components/dashboard/__tests__/AddTransactionModal.test.tsx

# 5. Validation totale
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run
SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/add-expense-with-breakdown.test.ts
pnpm build

# 6. Smoke browser EXHAUSTIF
pnpm dev
# Cas Budgétée + savings off + dans budget → submit OK
# Cas Budgétée + savings on + preview correct → submit OK
# Cas Budgétée + dépassement RAV → blocking
# Cas Exceptionnelle → submit OK sans budget
# Cas back-forward Step 2 → Step 1 → Step 2 → values preserved
# Cas Esc en Step 1 et en Step 2 → close modal
# Lecteur d'écran : annonces Step transitions
```

## Pièges connus / points d'attention

- **Couplage chantier 09 P4** : le toggle "Utiliser des économies" P5 implique le même backend que P4 cascade. Si on fait P4 d'abord, le toggle = juste un opt-in vs auto-default. Si on fait P5+P6 d'abord, P4 doit aligner sa logique. **Recommandé** : bundle P4+P5+P6 dans 1 sprint pour cohérence end-to-end.
- **Form state preservation** : si on utilise 2 `useForm` séparés (1 par step), perte d'état au transition. **Recommandé** : 1 seul `useForm` au top, render conditional des steps.
- **Income flow** : le modal actuel gère expense ET income. Décider si income aussi devient wizard (probablement non — income est plus simple). Si non, ajouter un radio préliminaire "Type : Dépense / Revenu" ou séparer en 2 modals.
- **Validation per-step** : Step 1 nécessite uniquement transactionType + (Budgétée | Exceptionnelle) sélectionnée. Step 2 valide tout le reste. RHF mode='onSubmit' fonctionne mais peut nécessiter validation manuelle au "Suivant" pour éviter de passer à Step 2 avec Step 1 invalid (quoique les cards radio sont auto-validées).
- **Animations transitions** : les wizards modernes ont souvent une slide animation entre steps. Tailwind animations possibles mais ajoutent complexité. **Recommandé MVP** : pas d'animation, juste swap render.
- **Edit mode** : `EditTransactionModal` est séparé et reste single-step (pas de wizard pour edit — l'utilisateur sait déjà le type). Vérifier que P5+P6 ne touche QUE Add, pas Edit.
- **Pre-existing dirty working tree** : exclure des commits.

## Découpage en sous-tâches (L → 5-6 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit + design wizard architecture (state mgmt, render conditional).
2. **Sub-2 (Effort : M)** — Implémentation Step 1 (cards Budgétée / Exceptionnelle) + state transition. Commit `feat(transaction): add Step 1 type selection wizard (P6)`.
3. **Sub-3 (Effort : S)** — Implémentation toggle savings P5 dans Step 2 + preview. Commit `feat(transaction): add savings toggle in budgeted step (P5)`.
4. **Sub-4 (Effort : S)** — Tests RTL adaptation + nouveaux cas. Commit `test(transaction): wizard P5+P6 RTL coverage`.
5. **Sub-5 (Effort : XS)** — A11y polish (focus management transitions). Commit `a11y(transaction): focus management on wizard transitions`.
6. **Sub-6 (Effort : XS)** — Closeout doc.

## Recovery path

- `git revert` séquentiel par commit. Pas de migration DB. UI revert restore single-step.

## Précédents codebase (références)

- Sprint Zod-Rollout v3 commit `d984a41` — AddTransactionModal migration RHF
- Sprint Zod-Rollout v5 — pattern RTL 6-hook mock surface
- Sprint Zod-Rollout v8 commit `63a9e32` — Radix Dialog migration
- Sprint Zod-Rollout v10 commit `e7c8312` — ModalCloseX
- Sprint Atomicity-Expenses — composite RPC `addExpenseWithBreakdown`

---

**Estimation totale** : 1-2 jours. Ferme P5 + P6 du backlog produit. UX modal dépense significativement améliorée. Score métier ~99.999 stable. Risque modéré (UI complexe, tests RTL extensifs requis). **Fortement recommandé bundle avec chantier 09 (P4)** pour cohérence cascade économies end-to-end.
