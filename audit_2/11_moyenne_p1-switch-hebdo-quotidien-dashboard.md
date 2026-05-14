# 11 — P1 : Switch hebdo / quotidien dashboard

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P1](../next-steps.md) (backlog produit) |
| **Type** | feature (option d'affichage dashboard) |
| **Priorité** | Moyenne |
| **Effort estimé** | M (demi-journée) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

next-steps.md P1 :

> ## P1 — Switch hebdo / quotidien
>
> **Domaine** : dashboard / planning
>
> Ajouter une option de switch par semaine ou par jour sur l'affichage budgets / dépenses.

**Compréhension métier** : sur le dashboard (et possiblement Planning), permettre à l'utilisateur de switcher entre une vue **mensuelle** (actuelle, par défaut), **hebdomadaire**, ou **quotidienne**. Les chiffres affichés (budgets, dépenses, RAV) sont soit divisés/multipliés mécaniquement (si on assume distribution uniforme) soit calculés réellement à partir des date ranges.

**Architecture pertinente** :
- `app/dashboard/page.tsx` ou `app/group-dashboard/page.tsx` — entry point
- `components/dashboard/FinancialIndicators.tsx` — affiche les indicateurs RAV/budgets/dépenses
- `components/dashboard/BudgetProgressIndicator.tsx` — progress bar par budget
- `components/dashboard/PlanningDrawer.tsx` (688 LOC) — vue détaillée
- `lib/finance/calc-rtl.ts` — formules (probablement à étendre avec un paramètre `period`)
- Composants à créer/modifier : un toggle/dropdown "Vue : Mois | Semaine | Jour" en haut du dashboard

**Question UX importante** : "par semaine" et "par jour" affichent-ils :
- **Option A** : une moyenne mensuelle / N (semaines = ÷4.33, jour = ÷30) — calcul simple, pas de contexte temporel
- **Option B** : les chiffres réels de la semaine/jour courant.e (real_expenses entre `monday this week` et `sunday this week`) — calcul plus complexe, plus utile

À arbitrer Phase 1 avec user. **Recommandé Option B** (utilité métier > simplicité).

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Ajouter un toggle "Vue : Mois | Semaine | Jour" sur le dashboard (et group-dashboard si symétrie), qui re-calcule les indicateurs financiers pour la période sélectionnée. Implémentation Option B (chiffres réels par période, pas moyenne) recommandée par défaut, à confirmer Phase 1 avec user.

### 2. Contexte technique

**Fichiers concernés** :
- `app/dashboard/page.tsx` (ajout toggle + state period)
- `app/group-dashboard/page.tsx` (idem si symétrie)
- `components/dashboard/FinancialIndicators.tsx` (consume period)
- `components/dashboard/BudgetProgressIndicator.tsx` (consume period)
- Possiblement nouveau composant `components/dashboard/PeriodSelector.tsx`
- `hooks/useFinancialData.ts` (Sprint 1.5 — useQuery) — accept period param
- `hooks/useProgressData.ts` (Sprint 1.5) — accept period param
- `lib/finance/calc-rtl.ts` (extension avec param period)
- `lib/finance/financial-data.ts` (`_loadFinancialData` extend)
- API `/api/finance/summary` (extend query param `?period=month|week|day`)

**État actuel** :
- Dashboard affiche par défaut le mois courant
- `useFinancialData(context)` fetch les agrégats du mois
- Pas de notion de période plus fine

**Tests existants pertinents** :
- 6 cas gated `lib/finance/__tests__/financial-data.test.ts` — tester avec period si extension
- Tests RTL dashboard (s'ils existent)

**Précédents codebase** :
- Sprint 1.5 — TanStack Query migration, `useFinancialData` queryKey `['financial-summary', context]`
- Sprint Zod-Rollout v2 commit `b52c8b0` — `parseQuery` helper installé pour query params

### 3. Spécifications fonctionnelles attendues

**Cas nominal Option B (recommandé)** :
- User sur `/dashboard`, vue "Mois" par défaut
- Indicators affichent : revenus mois, dépenses mois, RAV mois
- User click "Semaine" → toggle visuel actif "Semaine"
- Indicators re-render : revenus de la semaine courante (lundi-dimanche), dépenses de la semaine, RAV "what if uniquement cette semaine compte"
- User click "Jour" → indicators jour courant
- L'état de la sélection est persisté dans `localStorage` ou `URL ?period=` (pour stabilité au refresh)

**Cas nominal Option A (simple)** :
- Mois → 100% des chiffres mensuels
- Semaine → chiffres ÷ 4.33 (moyenne)
- Jour → chiffres ÷ 30
- Pas de re-fetch DB, juste display calc CSR

**Cas edge** :
- Changement de mois en cours d'utilisation (e.g. user laisse l'onglet ouvert pendant overnight) → la vue "Jour" / "Semaine" ne re-fetch pas automatiquement, mais le mois affiché doit être stable (pas de refetch mid-day non sollicité)
- Période sans données → afficher "0€" ou "Aucune donnée pour cette période"

**Cas erreur** :
- API timeout / fetch error → fallback vers cache TanStack Query si dispo, sinon error display

### 4. Contraintes techniques

- **Style** : conventions CLAUDE.md §6 strictes
- **Persistance choix** : `localStorage` simple OU URL search param (`?period=week`) pour shareable links. Recommandé URL pour simplicité TanStack Query queryKey (`['financial-summary', context, period]`).
- **API extension** : `/api/finance/summary` GET accept `?period=month|week|day` via `parseQuery(req, schema)` (Sprint Zod-Rollout v2)
- **Backend Option B** : `_loadFinancialData(filter, { period: 'month' | 'week' | 'day' })` — calcule les date ranges côté JS et passe au Supabase query `WHERE date BETWEEN ...`
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **A11y** : toggle est un radiogroup ou tabs, `role="radiogroup"` ou `role="tablist"`, label "Période d'affichage"

### 5. Critères d'acceptation vérifiables

- [ ] **Toggle UI visible** : `/dashboard` + `/group-dashboard` ont un selecteur Mois|Semaine|Jour
- [ ] **Choix persisté** : refresh F5 conserve la sélection (via localStorage ou URL param)
- [ ] **Re-fetch correct (Option B)** : changer de période trigger un re-fetch via TanStack Query (queryKey change)
- [ ] **Indicators alignés** : RAV + budgets + dépenses tous reflètent la période sélectionnée cohéremment
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests** : +3-5 cas (PeriodSelector unit + 1-2 cas pure-unit calc avec period + 1 cas RTL dashboard)
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** : 4 combinaisons (vue Mois/Semaine/Jour × profile/group) fonctionnent

### 6. Tests à écrire ou à mettre à jour

#### Pure-unit `lib/finance/__tests__/calc-rtl.test.ts` (si extension Option B)

```typescript
describe('P1 - Period filtering', () => {
  it('period=month: full month data', () => {...})
  it('period=week: only this week real_expenses/incomes', () => {...})
  it('period=day: only today', () => {...})
})
```

#### RTL nouveau `components/dashboard/__tests__/PeriodSelector.test.tsx`

```typescript
it('renders 3 options', () => {...})
it('changes selection on click', () => {...})
it('persists to URL or localStorage', () => {...})
```

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (consolidation feature)
  - **§4** : entrée nouveau composant `PeriodSelector` si créé
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint P1-Switch-Hebdo-Quotidien** : ...`
- **next-steps.md** : retirer P1

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s

# 2. Phase 1 audit + arbitrage Option A vs B
# Read app/dashboard/page.tsx + components/dashboard/FinancialIndicators.tsx
# Décider Option A (simple) vs Option B (utile) avec user
# Décider persistance : localStorage vs URL

# 3. Implementation
# Option B : extend hooks + API + lib/finance helpers
# Option A : juste UI display calc

# 4. Tests
pnpm test:run

# 5. Validation totale
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run
pnpm build

# 6. Smoke browser
pnpm dev
# Test 4 combinaisons
```

## Pièges connus / points d'attention

- **Option A vs B** : décider en Phase 1. Option B est plus utile mais plus complexe (DB queries date ranges). Option A est trompeuse (suggère des chiffres réels alors que c'est juste division mécanique).
- **Date ranges fr-FR** : `lundi-dimanche` vs `dimanche-samedi` — confirmer locale française (probablement lundi-dimanche).
- **Cohérence avec monthly-recap** : le mois courant définit le scope du recap. Si on switch sur "semaine", le recap-related UI doit rester sur mois (pas de "recap hebdo").
- **Performance** : si Option B avec re-fetch agressif, attention aux N+1 queries DB. Optimiser avec un seul fetch par period change, cache TanStack Query par queryKey.
- **Pre-existing dirty working tree** : exclure des commits.

## Découpage en sous-tâches (M → 4 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit + arbitrage Option A/B + persistance.
2. **Sub-2 (Effort : S)** — Implémentation `PeriodSelector` composant + state mgmt. Commit `feat(dashboard): add PeriodSelector toggle (P1)`.
3. **Sub-3 (Effort : S/M)** — Selon Option : extend backend (B) ou juste display calc (A). Commit `feat(finance): support period filter` ou `feat(dashboard): apply period to indicators display`.
4. **Sub-4 (Effort : S)** — Tests + closeout. Commit `test(dashboard): PeriodSelector + period calc coverage` + `docs: closeout P1`.

## Recovery path

- `git revert` chacun des commits. Pas de migration DB.

## Précédents codebase (références)

- Sprint 1.5 — TanStack Query useFinancialData
- Sprint Zod-Rollout v2 — parseQuery helper

---

**Estimation totale** : demi-journée (Option A) à 1 jour (Option B). Ferme P1 du backlog produit. UX dashboard enrichie. Score métier ~99.999 stable.
