# Sprint 07 — Recap : drawer "Projets en cours" sur l'écran initial du wizard

> ✅ **LIVRÉ 2026-05-26** sur `feature/projets-epargne` (commit `cf77222`). Voir closeout détaillé → [`../history/roadmap-detailed-30-projets-epargne-modals.md`](../history/roadmap-detailed-30-projets-epargne-modals.md) sprint 07.
>
> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet — spécifiquement la section 5.1 "Écran de récap initial".

## Objectif

Sur l'écran initial du wizard recap (step `summary`), afficher une ligne "N projet(s) en cours" cliquable qui ouvre un drawer lecture-seule listant les projets avec leur état d'avancement.

## Pré-lecture obligatoire

- [components/monthly-recap/steps/SummaryStep.tsx](../../components/monthly-recap/steps/SummaryStep.tsx) — écran initial du wizard
- [components/monthly-recap/SavingsDetailDrawer.tsx](../../components/monthly-recap/SavingsDetailDrawer.tsx) — pattern drawer recap, header coloré, footer CloseX
- [components/ui/drawer-content-classes.ts](../../components/ui/drawer-content-classes.ts) — `DRAWER_CONTENT_CLASSES`
- [hooks/useMonthlyRecap.ts](../../hooks/useMonthlyRecap.ts) — `useQuery` existant, vérifier si projets accessibles via `meta` ou nouvelle query
- [lib/finance/financial-data.ts](../../lib/finance/financial-data.ts) — `meta.savingsProjects` depuis sprint 03
- [.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md) — `DRAWER_CONTENT_CLASSES`, `ModalCloseX`

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Composant — `components/monthly-recap/SavingsProjectsDetailDrawer.tsx` (mirror `SavingsDetailDrawer`)

- Props : `{ isOpen, onClose, projects: SavingsProjectMeta[] }`
- Header coloré violet (cohérent économies)
- Liste : chaque projet en cellule avec cercle progression + nom + `amount_saved/target` + deadline
- Footer : bouton "Fermer" (`ModalCloseX` en variant ghost ou texte explicite "Fermer")
- Empty state : "Tu n'as aucun projet en cours pour l'instant."
- Read-only — aucune action edit/delete dans ce drawer (l'utilisateur peut le faire depuis le planner)

### 2. SummaryStep extension

- Lire `financialData.meta.savingsProjects` (déjà exposé depuis sprint 03)
- Si `savingsProjects.length > 0` :
  - Afficher une ligne "📋 {n} projet(s) en cours" (icône + texte cliquable)
  - `onClick` → ouvre `<SavingsProjectsDetailDrawer projects={savingsProjects} />`
- Si vide : ne rien afficher (ligne masquée).
- Position : juste après la ligne tirelire / économies existantes (mimer le pattern).

### 3. State management

- `useState` `isProjectsDrawerOpen` dans `SummaryStep`
- Dynamic import du drawer pour lazy-load
- Lazy mount : `{isProjectsDrawerOpen && <SavingsProjectsDetailDrawer ... />}`

### 4. Tests RTL

**`components/monthly-recap/__tests__/SavingsProjectsDetailDrawer.test.tsx`** :

- Cas 1 : rendu avec 3 projets (nom, %, deadline visibles)
- Cas 2 : empty state (0 projet)
- Cas 3 : ESC close (`expectEscClose` helper)
- Cas 4 : a11y violations 0

**Étendre `components/monthly-recap/__tests__/SummaryStep.test.tsx`** :

- Cas 1 : ligne "N projets" affichée si `meta.savingsProjects` non vide
- Cas 2 : ligne masquée si vide
- Cas 3 : click ouvre le drawer

### 5. Vérifications

- `pnpm dev` + démarrer un recap manuel (ou via seed-recap) avec 2 projets actifs → ligne visible, drawer ouvre, contenu cohérent
- `pnpm verify` exit 0

### 6. Commit

```
feat(recap): drawer "Projets en cours" on SummaryStep
```

## Acceptance criteria

- Écran summary recap affiche "📋 N projets en cours" si projets présents.
- Drawer ouvre/ferme correctement, ESC ferme, focus trap respecté.
- 0 régression sur les autres lignes summary (tirelire, économies, etc.).

## Hors scope

- Refloat from projects (sprint 08-10).
- Liste interactive (edit/delete depuis recap — pas demandé par le user).
