# Sprint 11 — Polishing, seeds, verify final, push prod

> ✅ **LIVRÉ 2026-05-26** sur branche `feature/projets-epargne`, commit `15eab56`. Détails closeout → [Part 31](../history/roadmap-detailed-31-projets-epargne-finalize.md) sprint 11. Seed CLI `scripts/seed-recap/project-deficit-refloat.mjs` ajouté (cascade 4 étages, bilan -700€ exact cover). Push prod : 21 migrations appliquées (MRv3 stack + savings_projects + project_snapshot) après 3 drift repairs + 1 rename (`20260523000000_drop_legacy` → `20260523000001` pour résoudre collision timestamp). Baseline re-exportée + `lib/database.types.ts` regen contre prod. `pnpm verify` ✓ contre prod (758 tests / 223 skipped, 25 RPCs, 34 fn, drift OK). Toute la feature Projets-Épargne (sprints 01-11) est désormais en prod.

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet.

## Objectif

Boucler la feature : 1 nouveau scenario CLI dans `scripts/seed-recap/` pour tester le flow projet end-to-end, mise à jour de `CLAUDE.md` §11 roadmap + `.claude/history/`, push de toutes les migrations en prod, verify pass.

## Pré-lecture obligatoire

- [scripts/seed-recap/README.md](../../scripts/seed-recap/README.md) — workflow + helpers
- [scripts/seed-recap/random-profile.mjs](../../scripts/seed-recap/random-profile.mjs) — pattern scenario CLI
- [CLAUDE.md §11](../../CLAUDE.md) — roadmap pointeurs + invariants §5.5
- [.claude/history/roadmap-detailed-30-projets-epargne-modals.md](../history/roadmap-detailed-30-projets-epargne-modals.md) — dernière entrée (sprints 05-06 livrés Part 30 ; étendre ou créer Part 31 si saturation au sprint 11)
- [.claude/conventions/git-workflow.md §7-8](../conventions/git-workflow.md) — push gate workflow

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'   # dev pour validations
```

## Tâches

### 1. Seed scenario — `scripts/seed-recap/project-deficit-refloat.mjs`

User : perso avec 2 projets actifs :

- Projet "Voyage Japon" : target 7000€, monthly 200€/mois, amount_saved 1200€, deadline 2027-12
- Projet "Voiture" : target 5000€, monthly 150€/mois, amount_saved 600€, deadline 2027-06

1 budget 200€/mois "Courses" + 1 income 1500€ → marge 950€ − 350€ (projets) = 600€ RAV théorique.
Dépenses réelles 1800€ (overflow → déficit estimé).
Tirelire 100€, économies budget 50€.
Recap démarré avec bilan négatif → user doit puiser dans piggy (100) + savings (50) + projets (...€) + budgets.

Helper utility : utiliser `seedRecapRow` + bypass INSERT direct dans `monthly_recaps`.

### 2. Update `CLAUDE.md`

- ~~§5.5 Invariants : `EXPECTED_RPCS = 21 → 25`~~ ✅ déjà bumped au sprint 01
- §5.5 Invariants : si tests gated nouveaux, ajouter scope `SUPABASE_PROJECTS_TESTS=1`
- §5.5 Tests gated/non-gated : update les counts finaux
- §11 Roadmap : update Part 29 si split nécessaire, update sprint count
- §3 Commandes : si nouvelles, sinon rien

### 3. Étendre l'historique projets

- ~~Créer Part 29~~ ✅ créé au sprint 01 closeout (sprints 01-04 livrés)
- ~~Splitter Part 30~~ ✅ créé au sprint 05 closeout (sprints 05-06 livrés)
- **Append** sprints 07-11 dans Part 30 (1 bullet `## ✅ Sprint NN — ...` par sprint, format mirror part-28). Si > 39.5k au cours de l'append : créer Part 31 au boundary logique le plus proche.

### 4. Update `.claude/reference/structure-repo.md`

Nouveaux fichiers à inventorier :

- `components/dashboard/AddProjectDialog.tsx`
- `components/dashboard/EditProjectDialog.tsx`
- `components/dashboard/ProjectListItem.tsx`
- `components/monthly-recap/SavingsProjectsDetailDrawer.tsx`
- `components/monthly-recap/lines/RefloatProjectsLine.tsx`
- `hooks/useProjects.ts`
- `lib/api/finance/projects.ts`
- `lib/finance/projects.ts`
- `lib/finance/projects-meta.ts`
- `lib/schemas/projects.ts`
- `app/api/finance/projects/route.ts`
- `app/api/finance/projects/[id]/route.ts`
- `app/api/monthly-recap/refloat-from-projects/route.ts`
- `scripts/seed-recap/project-deficit-refloat.mjs`

### 5. Push prod gate (confirmation utilisateur explicite avant chaque step)

```powershell
$env:SUPABASE_PROJECT_REF = $null    # ou explicitement = 'jzmppreybwabaeycvasz'
pnpm supabase db push --dry-run      # STOP — montrer la sortie au user pour validation
# User confirme →
pnpm supabase db push
pnpm db:check-drift                  # exit 0
pnpm db:check-rpcs                   # exit 0 avec 25
pnpm db:audit-functions              # clean
```

### 6. Verify final

```powershell
pnpm verify                          # exit 0 sur dev
$env:SUPABASE_RECAP_TESTS = '1'; $env:SUPABASE_FINANCE_TESTS = '1'; pnpm test:run
```

- `pnpm dev` : créer un projet, le modifier, le supprimer, vérifier que la tirelire crédite OK
- `pnpm dev` : démarrer un recap perso bilan négatif (via le seed) → cascade visible avec ligne projets → finalize → vérifier en DB que `amount_saved` et `deadline_date` ont été mis à jour
- `pnpm dev` : reproduire en contexte groupe

### 7. PR

- Push branch `feature/projets-epargne` → demander URL au user (memory `reference_no_gh_cli` : pas de gh CLI local)
- Body PR avec :
  - Summary : 3-4 bullets
  - Test plan : checklist des cas
  - Mention "🤖 Generated with Claude Code"

### 8. Commit final

```
chore(projects): seeds + roadmap update + invariants bump
```

## Acceptance criteria

- `pnpm verify` exit 0.
- `pnpm db:check-rpcs` montre 25 RPCs.
- Le seed scenario `project-deficit-refloat` génère un état recap testable.
- `CLAUDE.md` §5.5 + §11 + `.claude/history/Part 29` à jour.
- Migrations pushed en prod sans drift.
- Branch poussée + PR URL fournie au user.

## Hors scope

- Aucun (sprint final).

---

## Vérification end-to-end (à exécuter après le sprint 11)

Pour valider que la feature est livrée correctement :

### 1. Création

- `pnpm dev` → ouvre planificateur → onglet "Projets" → "+ Nouveau projet"
- Crée "Voyage Japon", target 7000€, monthly 200€ → durée auto-calc 35 mois, deadline auto-calc
- Vérifie que le projet apparaît dans la liste avec progression 0%
- Vérifie que le RAV diminue de 200€

### 2. Modification

- Clic sur "Modifier" → modal pré-remplie
- Change monthly à 300€ → durée auto-recalc 24 mois
- Submit → vérifie que la liste se rafraîchit + RAV recalculé

### 3. Suppression

- Crée un projet target 1000€ monthly 100€
- Force `amount_saved = 500€` via SQL direct ou via 5 finalize de recap mock
- Clic "Supprimer" → modal confirmation montre "500€ versés dans la tirelire"
- Confirme → tirelire +500€, snackbar visible, projet disparaît

### 4. Recap flow positif

- Démarre un recap avec bilan positif et 1 projet actif
- Vérifie que SummaryStep affiche "📋 1 projet en cours"
- Drawer ouvre + montre le détail
- Finalize → vérifier que `amount_saved += monthly_allocation` (pas de refloat)

### 5. Recap flow négatif avec refloat projets

- Lance seed `node scripts/seed-recap/project-deficit-refloat.mjs`
- Démarre le recap → écran négatif → cascade : piggy → savings → projets → budgets
- Clique "Utiliser X€ depuis les projets" → vérifier que le déficit diminue, que la ligne projets passe à "done", que la ligne budgets devient "active" si déficit > 0
- Finalize → vérifier en SQL :
  - `savings_projects.amount_saved` incrémenté de `(monthly - refund)` pour chaque projet
  - `savings_projects.deadline_date` shifted si refloat total
  - `savings_projects.pending_delay_fraction` cumulé correct si refloat partiel
  - `monthly_recaps.project_snapshot_data` contient les bonnes valeurs
- FinalRecapStep affiche le résumé projets correct

### 6. Régressions

- Faire un recap entier sans projet → flow identique à avant (cascade piggy → savings → budgets)
- Faire un edit/delete/create budget classique → comportement inchangé
- `pnpm verify` exit 0 final
