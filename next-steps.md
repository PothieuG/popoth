# Next steps — backlog produit

> Items produit en attente, non liés à la dette technique (qui est trackée dans [CLAUDE.md §11](CLAUDE.md)). Ce fichier remplace l'ancien `next steps.txt` (10 lignes plates) — chaque item a maintenant un titre, un domaine et un descriptif.

## P7 — Permissions créateur sur solde groupe

**Domaine** : groups / permissions

Seul le créateur d'un groupe peut changer le solde disponible du groupe dans les options. Les autres membres ne doivent pas voir cette action.

## P8 — Menu groupe : nettoyage UI

**Domaine** : groups / settings

Dans le menu du groupe (settings) :

- Enlever la pastille "créateur".
- Enlever l'option de suppression.
- Enlever la box du bas.

## P9 — Menu "Mon groupe" : retirer "Se déconnecter"

**Domaine** : groups / settings

Enlever l'entrée "Se déconnecter" dans les options "Mon groupe" — la déconnexion n'a rien à faire ici, elle est dans le menu utilisateur global.

---

## Livrés

- **P4 — Cascade économies sur dépassement budget** ✅ livré 2026-05-15 (Sprint P4-P5-P6-Cascade-Modal-Wizard — bundle complet : `calculateBreakdown` refactoré P4 strict + cascade savings overflow + cross-budget Phase 2 cascade via nouvelle composite RPC `add_expense_with_cross_budget_cascade`. Cf. [CLAUDE.md §11](CLAUDE.md))
- **P5 — Modal dépense : option économies** ✅ livré 2026-05-15 (Sprint P4-P5-P6 bundle — toggle "Utiliser les économies de ce budget" dans Step 3 du wizard, visible quand budget sélectionné a `cumulated_savings > 0`. Cf. [CLAUDE.md §11](CLAUDE.md))
- **P6 — Modal dépense : étape 1 = type** ✅ livré 2026-05-15 (Sprint P4-P5-P6 bundle — wizard 2-step refactor d'`AddTransactionModal` : Step 1 type Dépense/Revenu, Step 2 Budgétée/Exceptionnelle pour les expenses, Step 3 form fields. Cf. [CLAUDE.md §11](CLAUDE.md))
- **P10 — Fix flicker page d'accueil** ✅ livré 2026-05-14 (Sprint P10-Fix-Home-Flicker, cf. [CLAUDE.md §11](CLAUDE.md))
- **P2 — RAV calculé sans économies de budget** ✅ closed-by-pre-existing-fix 2026-05-15 (Sprint P2-Closeout-Administrative — bug n'existait pas dans le code actuel, formule RAV dans `lib/finance/calc-rtl.ts` n'inclut pas `cumulated_savings` depuis fix antérieur silencieux ; `totalSavings` exposé séparément + UI conforme. Cf. [CLAUDE.md §11](CLAUDE.md))
- **P3 — Recalcul RAV sur validation revenu** ✅ closed-by-pre-existing-fix 2026-05-15 (Sprint P3-Closeout-Administrative — les 3 règles sont déjà implémentées dans la formule RAV actuelle : Règle 1 budget déficit calculé on-the-fly via `calculateBudgetDeficit(estimated, spent)` dans `lib/finance/calc-rtl.ts`, Règles 2+3 exceptional incomes/expenses déjà additifs/soustractifs dans `_loadFinancialData` ; trigger recalcul via TanStack Query invalidation cascade depuis Sprint 1.5+2-followup. Cf. [CLAUDE.md §11](CLAUDE.md))
- **P1 — Switch hebdo / quotidien** ✅ livré 2026-05-15 (Sprint P1-Switch-Hebdo-Quotidien — scope restreint per arbitrage user : toggle Mois/Semaine/Jour persisté en URL `?period=`, filtre listing transactions (expenses + incomes via CSR useMemo) + progress bars budget (backend `?period=` sur `/api/finance/expenses/progress` + CSR dans `useBudgetProgress`). Les 3 cartes Solde/RAV/Économies gardent leur sémantique mensuelle. Semaine = lundi-dimanche ISO 8601 Europe/Paris. Cf. [CLAUDE.md §11](CLAUDE.md))
