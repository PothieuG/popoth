# Sprint 09 — Recap UI : RefloatProjectsLine entre savings et budgets

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet — spécifiquement la nouvelle étape "Renflouement par les projets" entre savings et budgets (section 5.2).

## Objectif

Ajouter une nouvelle ligne de cascade `RefloatProjectsLine` dans `BilanNegativeStep`, insérée **ENTRE `RefloatSavingsLine` et `RefloatBudgetSnapshotLine`**. Mêmes états (`'active' | 'locked' | 'done' | 'empty' | 'unneeded'`), même UX que les lignes adjacentes.

## Pré-lecture obligatoire

- [components/monthly-recap/steps/BilanNegativeStep.tsx](../../components/monthly-recap/steps/BilanNegativeStep.tsx) — cascade 35-235, gating 115-144
- [components/monthly-recap/lines/RefloatSavingsLine.tsx](../../components/monthly-recap/lines/RefloatSavingsLine.tsx) — pattern à cloner
- [components/monthly-recap/lines/RefloatBudgetSnapshotLine.tsx](../../components/monthly-recap/lines/RefloatBudgetSnapshotLine.tsx) — pattern alternatif
- [lib/recap/deficit-math.ts](../../lib/recap/deficit-math.ts) — `computeDeficitRemaining` (sprint 08 inclut maintenant projet)
- Sprint 08 (`executeRefloatFromProjects`, `project_snapshot_data`)

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Composant — `components/monthly-recap/lines/RefloatProjectsLine.tsx` (clone `RefloatSavingsLine` adapté)

- Props : `{ context, state, projects: SavingsProjectMeta[], deficitRemaining, onError, onSuccess }`
- Header : "📋 Renflouer par les projets" + icône (réutiliser celle du planner projects)
- Body :
  - Si `state='active'` : bouton "Utiliser X€ depuis les projets" (X = `min(totalMonthlyAllocation, deficitRemaining)`)
  - Si `state='done'` : "✓ Utilisé : X€ depuis Y projets" + détail per-project
  - Si `state='locked'` : grisé avec message "Disponible une fois les économies épargnées"
  - Si `state='empty'` : "Aucun projet à utiliser" (couleur grise)
  - Si `state='unneeded'` : "Déficit déjà comblé"
- `onClick` action → POST `/api/monthly-recap/refloat-from-projects` (sprint 08)
- Show breakdown per-project depuis la response (e.g. "Japon : -40€, Voiture : -20€")
- Couleur : violet (cohérent économies — différencier du orange budgets snapshot)

### 2. Modifier `BilanNegativeStep.tsx`

- Importer `RefloatProjectsLine` + dynamic
- Gating cascade (lignes 115-144) — étendre l'état machine :

  ```
  piggy.state    : 'active' si déficit > 0 et piggy > 0 ; sinon 'empty' ou 'done'
  savings.state  : 'active' si piggy in ['done','empty'] ET déficit > 0 ET totalSavings > 0
  projects.state : 'active' si savings in ['done','empty'] ET déficit > 0 ET projets.length > 0
  budgets.state  : 'active' si projects in ['done','empty'] ET déficit > 0
  ```

- Insérer `<RefloatProjectsLine>` ENTRE `<RefloatSavingsLine>` et `<RefloatBudgetSnapshotLine>` (lignes 183-194)
- Lire `meta.savingsProjects` depuis `useFinancialData` ou via `useMonthlyRecap`

### 3. Update `useMonthlyRecap`

Ajouter la mutation `refloatFromProjects` (mirror `refloatFromSavings`).

### 4. Tests RTL

**`components/monthly-recap/lines/__tests__/RefloatProjectsLine.test.tsx`** (mirror `RefloatSavingsLine.test.tsx`) :

- Cas 1 : `state='active'` + button visible, click → mutation called
- Cas 2 : `state='locked'` grisé
- Cas 3 : `state='empty'` (0 projet)
- Cas 4 : `state='done'` affiche breakdown per-project
- Cas 5 : `state='unneeded'`

**Étendre `BilanNegativeStep.test.tsx`** :

- Cas : cascade piggy(done) → savings(done) → projects(active) → budgets(locked)
- Cas : cascade piggy(done) → savings(empty) → projects(active)
- Cas : 0 projet → projects(empty) saute direct vers budgets(active)

### 5. Vérifications

- `pnpm dev` + démarrer un recap avec bilan négatif (via seed-recap) + 2 projets actifs → la nouvelle ligne s'affiche en cascade
- Cliquer "Utiliser X€" → response 200 + breakdown affiché + budgets.state passe à active
- `pnpm verify` exit 0

### 6. Commit

```
feat(recap): RefloatProjectsLine in cascade between savings and budgets
```

## Acceptance criteria

- La cascade `BilanNegativeStep` affiche 4 lignes dans l'ordre piggy → savings → projects → budgets.
- Click sur "Utiliser X€" projets → POST `refloat-from-projects` + UI update breakdown.
- Gating respecte le forward-only (impossible de cliquer projets si savings.state = 'active').
- 0 régression sur le flow recap sans projets.

## Hors scope

- Application réelle à la finalize (sprint 10).
- Affichage final-recap résumé projets (sprint 10).
