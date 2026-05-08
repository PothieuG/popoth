# 🧪 02 — Qualité du code

> **⚠️ Note 2026-05-08** : ce doc est un snapshot d'audit (2026-04). Plusieurs sections ont été addressed depuis et sont désormais inexactes :
> - § Magic numbers, AuthContext split, dynamic modals → résolus Sprint Hygiène-Code (cf. CLAUDE.md §11)
> - § `: any` (57 occurrences) → compteur 0 depuis Sprint Lint-Baseline-Cleanup
> - § Silent errors, fragile array[key] → vérifiés safe ou déjà loggés Sprint Hygiène-Code
> - § console.log (1331), god files (financial-calculations / process-step1) → chantiers 07.7 / I4 / I5 séparés, encore ouverts
>
> Voir CLAUDE.md §11 (roadmap) pour l'état actuel.

Constats détaillés sur la qualité fichier par fichier.

## Sommaire
- [2.1 Lisibilité & conventions](#21-lisibilité--conventions)
- [2.2 Complexité & maintenabilité](#22-complexité--maintenabilité)
- [2.3 Robustesse & sécurité](#23-robustesse--sécurité)
- [2.4 Typage](#24-typage)
- [2.5 Performance React](#25-performance-react)
- [2.6 Synthèse — patterns à conserver](#26-synthèse--patterns-à-conserver)

---

## 2.1 Lisibilité & conventions

### ✅ Bonnes pratiques observées

- **Naming cohérent** :
  - camelCase pour variables et fonctions
  - PascalCase pour composants
  - snake_case pour colonnes Supabase
- **Style guide** appliqué : pas de mélange tabs/spaces (sans `.editorconfig`, miracle)
- **Mix français / anglais maîtrisé** : UI et métier en français, techno en anglais — cohérent

### ⚠️ Points à corriger

#### Magic numbers et strings

| Fichier | Constante | Sens caché |
|---|---|---|
| [middleware.ts:45](../../middleware.ts) | `45` | Minutes avant expiration token |
| [contexts/AuthContext.tsx:111](../../contexts/AuthContext.tsx) | `50 * 60 * 1000` | Refresh token interval (50 min) |
| [app/api/monthly-recap/process-step1/route.ts:406](../../app/api/monthly-recap/process-step1/route.ts) | `0.01` | Tolérance d'arrondi (rounding gap) |
| [lib/expense-allocation.ts](../../lib/expense-allocation.ts) | divers seuils | Allocation logic |

→ **Action** : créer `lib/constants/` avec `auth.ts`, `finance.ts`, etc.

#### Logs en production : 1 331 `console.log` + 398 `console.error`

```bash
$ grep -rn "console\.log" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next | wc -l
1331
$ grep -rn "console\.error" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next | wc -l
398
```

Beaucoup sont des logs de debug avec emojis dans la logique financière critique :
```ts
// Exemple typique vu dans lib/financial-calculations.ts
console.log(`🔍 [DEBUG INCOME COMPENSATION] ====================================`)
console.log(`🔍 [DEBUG INCOME COMPENSATION] CALCUL CONTRIBUTION REVENUS PROFILE: ${profileId}`)
```

**Risques** :
- Pollution des logs en prod
- Performance (sérialisation à chaque appel)
- **Leak d'info** potentiel (IDs internes, montants) dans les logs serveur

→ Plan détaillé dans [07.7 — Console.log cleanup](./07-deep-dive-console-log-cleanup.md).

#### Commentaires obsolètes

- [lib/financial-calculations.ts:481](../../lib/financial-calculations.ts) : commentaire « SUPPRIMÉ: Calcul des différences revenus » alors que le code mort est encore présent.
- Plusieurs fichiers contiennent des blocs de commentaires en français qui décrivent des étapes d'algorithme — à conserver pour le métier mais à nettoyer quand obsolètes.

---

## 2.2 Complexité & maintenabilité

### Fonctions trop longues

| Fichier | Fonction | Lignes |
|---|---|---|
| [app/api/monthly-recap/process-step1/route.ts](../../app/api/monthly-recap/process-step1/route.ts) | `POST` (handler unique) | **714** 🔴 |
| [lib/financial-calculations.ts](../../lib/financial-calculations.ts) | `calculateRemainingToLiveProfile` | ~220 |
| [lib/financial-calculations.ts](../../lib/financial-calculations.ts) | `calculateRemainingToLiveGroup` | ~220 (duplicat à 95 %) |
| [components/monthly-recap/MonthlyRecapStep1.tsx](../../components/monthly-recap/MonthlyRecapStep1.tsx) | `fetchStep1Data` | ~80 |
| [components/dashboard/AddTransactionModal.tsx](../../components/dashboard/AddTransactionModal.tsx) | `ravValidation` (en JSX) | ~35 |

### Nesting > 3 niveaux

Exemple critique dans [process-step1/route.ts:351-392](../../app/api/monthly-recap/process-step1/route.ts) :

```ts
for (const budget of budgetsWithSavings) {                      // 1
  if (budget.cumulated_savings > 0 && gapACombler > 0) {        // 2
    for (const savingsBudget of budgetsWithSavings) {           // 3
      if (savingsBudget.cumulated_savings > 0 && remainingDeficit > 0) { // 4
        // …
      }
    }
  }
}
```

→ Refactor en fonctions nommées dans [07.2 — Recap algorithm extraction](./07-deep-dive-recap-algorithm.md).

### Duplications de code

| Couple | Similitude | Action |
|---|---|---|
| `calculateRemainingToLiveProfile` ↔ `calculateRemainingToLiveGroup` | ~95 % | Factoriser via paramètre `context: 'profile' \| 'group'` |
| `getProfileFinancialData` ↔ `getGroupFinancialData` | ~80 % | Factoriser, extraire la logique deficit en helper |
| Income compensation (présente dans 2 fonctions) | 100 % | Extraire en `lib/finance/income-compensation.ts` |

→ Refactor détaillé dans [07.1 — Financial calculations refactor](./07-deep-dive-financial-calculations.md).

### Composants monolithiques (> 300 LOC JSX)

| Composant | LOC | Problèmes |
|---|---|---|
| [MonthlyRecapStep2.tsx](../../components/monthly-recap/MonthlyRecapStep2.tsx) | 776 | UI + logique d'allocation + appels API |
| [PlanningDrawer.tsx](../../components/dashboard/PlanningDrawer.tsx) | 688 | 7 useState, 4 hooks fetch dans un useEffect, dropdown rendering |
| [SavingsDistributionDrawer.tsx](../../components/dashboard/SavingsDistributionDrawer.tsx) | 540 | distribution UI + calculs |
| [MonthlyRecapStep1.tsx](../../components/monthly-recap/MonthlyRecapStep1.tsx) | 633 | Fetch + display + validations |
| [AddTransactionModal.tsx](../../components/dashboard/AddTransactionModal.tsx) | 491 | calculs métier en JSX |

### Dead code potentiel

- Bloc commenté « SUPPRIMÉ » dans [lib/financial-calculations.ts:481](../../lib/financial-calculations.ts).
- Routes `/api/debug/*` à 95 % en dev-only (à confirmer fichier par fichier).
- À vérifier au moment du refactor I4/I5 — un `pnpm typecheck` strict + `eslint-plugin-unused-imports` aidera.

---

## 2.3 Robustesse & sécurité

### ✅ Bonnes pratiques constatées

- **Try/catch systématique** dans les routes API (~99 occurrences)
- **Pas d'injection SQL** : Supabase client utilisé partout avec paramètres
- **Pas de secrets en dur** dans le code
- **Service role key** uniquement côté serveur ([lib/supabase-server.ts](../../lib/supabase-server.ts))
- **Middleware d'auth centralisé** ([middleware.ts](../../middleware.ts))
- **JWT signés** avec `jose` (ne pas confondre avec un simple base64)
- **Cookies de session HttpOnly** (à vérifier explicitement dans `lib/session-server.ts`)

### 🔴 Risques critiques

| # | Risque | Localisation | Détail |
|---|---|---|---|
| 1 | **Race condition `piggy_bank`** | [lib/expense-allocation.ts:71-87, 124-159](../../lib/expense-allocation.ts) | SELECT puis UPDATE en 2 calls. 2 requêtes simultanées → solde corrompu. [07.3](./07-deep-dive-piggy-bank-race.md) |
| 2 | **Race condition recap step1** | [app/api/monthly-recap/process-step1/route.ts:232-242](../../app/api/monthly-recap/process-step1/route.ts) | Même pattern lors du recap. |
| 3 | **`ignoreBuildErrors: true`** | [next.config.js:6](../../next.config.js) | TS cassé peut shipper en prod. |
| 4 | **Routes `/api/debug/*` exposées** | [app/api/debug/](../../app/api/debug/) — 20 routes | `reset-all`, `populate-*` accessibles sans auth en prod. [07.4](./07-deep-dive-debug-routes.md) |
| 5 | **Erreurs silencieuses** | [lib/financial-calculations.ts:110-113](../../lib/financial-calculations.ts) | `catch` qui retourne `0` sans log → masque les bugs. |
| 6 | **RLS Supabase non auditée** | Pas de policies versionnées | Risque user A accède aux données de B. [07.5](./07-deep-dive-rls-supabase.md) |
| 7 | **Pas de rate limiting** | Toutes routes API | Brute force login, abus debug routes. |
| 8 | **Self-call HTTP middleware** | [middleware.ts:70-74](../../middleware.ts) | Latence + boucle si erreur. |
| 9 | **Validation inputs incohérente** | Routes POST sans schéma | Pas de Zod. [07.8](./07-deep-dive-zod-rollout.md) |
| 10 | **Pas d'audit trail** | Toute la BDD | Impossible de retracer qui modifie quoi. |

### Cas null/undefined

Pattern fragile vu plusieurs fois :

```ts
// ✅ Bon pattern
const userBankBalance = bankBalance?.balance || 0

// ⚠️ Pattern fragile
const progress = expenseProgress[formData.budgetId]
if (progress) { /* … */ }
// Et si la clé existe mais vaut 0 ? Aucun fallback défini ailleurs.
```

→ `noUncheckedIndexedAccess` est activé dans `tsconfig.json`, mais beaucoup de code contourne via `: any` (57 occurrences).

### Validation des inputs

- ❌ Pas de Zod / valibot / yup
- ⚠️ Validation manuelle inconsistante :
  - [app/api/budgets/route.ts:115-123](../../app/api/budgets/route.ts) — validation stricte `estimatedAmount > 0` ✅
  - [app/api/finances/expenses/real/route.ts](../../app/api/finances/expenses/real/route.ts) — pas de validation explicite du montant
- ❌ Pas de validation des chaînes (UUIDs, dates, formats)

→ Plan détaillé : [07.8 — Zod rollout](./07-deep-dive-zod-rollout.md).

---

## 2.4 Typage

### ✅ Bonnes pratiques

- **`tsconfig.json` strict** :
  ```json
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "target": "ES2022",
  "module": "esnext"
  ```
- Utilisation correcte des types Supabase dans plusieurs fichiers
- Les hooks ont des signatures retour typées explicitement

### ⚠️ Faiblesses

#### `: any` — 57 occurrences

Quelques exemples connus :
- [app/dashboard/page.tsx:33,78](../../app/dashboard/page.tsx) : `editingTransaction: any` → devrait être `RealExpense | RealIncome`
- Plusieurs `const insertData: any = {…}` dans les routes
- Plusieurs `data: any` dans les retours intermédiaires

→ Action : audit ciblé via `grep -rn ": any" --include="*.ts" --include="*.tsx"` puis corrections au fil de l'eau pendant les refactors.

#### Pas de types Supabase auto-générés

Les interfaces TypeScript des tables sont **redéfinies à la main** (visible dans plusieurs hooks et routes). Conséquences :
- Désynchronisation possible entre schéma DB et code
- Aucune garantie qu'un nom de colonne existe
- Pas d'autocomplétion fiable sur les requêtes

→ Action : `pnpm db:types` (script à ajouter) pour générer `lib/database.types.ts`. Voir [06 — I7](./06-action-plan.md#i7--générer-les-types-supabase).

#### Pas de validation runtime

- Bodies API non validés au runtime → un client malveillant peut envoyer `{ amount: "DROP TABLE" }` (Supabase paramétrise donc pas d'injection SQL, mais le crash est garanti à la première opération arithmétique).
- Réponses externes (Supabase) supposées conformes → si la DB a été modifiée hors-bande, runtime errors silencieux.

---

## 2.5 Performance React

### ✅ Bonnes pratiques

- `useMemo` utilisé dans certains hooks ([hooks/useBudgetProgress.ts:137-142](../../hooks/useBudgetProgress.ts))
- Hooks correctement typés
- Pas d'images non-optimisées (peu d'images dans le projet)
- Tailwind purge actif via `content` config

### ⚠️ À améliorer

#### `useCallback` manquant

Dans [contexts/AuthContext.tsx](../../contexts/AuthContext.tsx) et plusieurs composants, les handlers sont recréés à chaque render. Conjugué à un Context très large, cela cause des re-renders évitables sur tous les consumers.

#### `dynamic()` pour modals lourds

Tous les modals dans `PlanningDrawer.tsx` (`AddBudgetDialog`, `EditBudgetDialog`, etc.) sont **importés statiquement**, ce qui les inclut dans le bundle initial. Recommandation :

```ts
// Avant
import AddBudgetDialog from './AddBudgetDialog'

// Après
const AddBudgetDialog = dynamic(() => import('./AddBudgetDialog'))
```

#### AuthContext trop large

[contexts/AuthContext.tsx:299-310](../../contexts/AuthContext.tsx) fournit `user`, `loading`, `error`, `login`, `logout`, `refreshSession`, etc. dans le **même contexte**. Un changement de `loading` re-rend tous les consumers, même ceux qui n'ont besoin que de `user.id`.

→ Action : split en `AuthUserContext` (state) + `AuthActionsContext` (handlers).

#### Pas de cache HTTP / E-Tag

Aucune route API ne pose `Cache-Control` ou `E-Tag`. Aucune lib client (SWR, TanStack Query) ne déduplique les fetchs. Conséquence : ouvrir et fermer un drawer 3 fois → 3 fetchs identiques.

→ Recommandation : adopter TanStack Query progressivement (cf. [06 — R5](./06-action-plan.md)).

#### Listes & `key` instable

À auditer composant par composant. Dans `PlanningDrawer` plusieurs sections rendent des listes — vérifier que les `key` utilisent l'ID DB et pas l'index.

---

## 2.6 Synthèse — patterns à conserver

> L'audit n'est pas que critique. Voici ce qui est **bien fait** et qu'il faut **garder** lors des refactors.

### Architecture

- Séparation `app/` (routes) / `components/` (UI) / `hooks/` (état + fetch) / `lib/` (services) / `contexts/` (état global)
- Domaines métiers identifiables au premier coup d'œil
- Middleware unique pour toute la logique d'auth
- Routes API en API REST cohérent (`{ data } | { error }`)

### Sécurité

- Cookies de session HttpOnly + signés (jose)
- Refresh token automatique avant expiration
- `service_role` strictement serveur
- Aucun secret dans le repo (`git ls-files | grep env` ne renvoie que `.env.example`)

### Code

- TS strict global
- Pagination côté serveur sur les listes longues
- Snapshots financiers ([lib/database-snapshot.ts](../../lib/database-snapshot.ts)) — bonne idée pour audit
- Logger métier dédié ([lib/financial-logger.ts](../../lib/financial-logger.ts)) — à étendre

### UI

- shadcn/ui (new-york) — choix moderne, RSC-compatible
- Composants UI réutilisables dans `components/ui/`
- PWA installée et fonctionnelle ([public/sw.js](../../public/sw.js), [app/manifest.ts](../../app/manifest.ts))

---

## 🔗 Liens

- [01 — Inventaire](./01-inventory.md)
- [03 — Architecture](./03-architecture.md)
- [06 — Plan d'action](./06-action-plan.md)
- [07.1 — Refactor financial-calculations](./07-deep-dive-financial-calculations.md)
- [07.3 — Race conditions piggy_bank](./07-deep-dive-piggy-bank-race.md)
- [07.7 — Cleanup console.log](./07-deep-dive-console-log-cleanup.md)
- [07.8 — Zod rollout](./07-deep-dive-zod-rollout.md)
