# Next steps — backlog produit

> Items produit en attente, non liés à la dette technique (qui est trackée dans [CLAUDE.md §11](CLAUDE.md)). Ce fichier remplace l'ancien `next steps.txt` (10 lignes plates) — chaque item a maintenant un titre, un domaine et un descriptif.

## P1 — Switch hebdo / quotidien

**Domaine** : dashboard / planning

Ajouter une option de switch par semaine ou par jour sur l'affichage budgets / dépenses.

## P4 — Cascade économies sur dépassement budget

**Domaine** : finances / dépenses

Si un budget dépasse son enveloppe mais qu'il a des économies cumulées, taper dedans **par défaut**. Si le dépassement continue après avoir épuisé les économies du budget, **proposer** à l'utilisateur de prendre dans des économies d'autres budgets.

## P5 — Modal dépense : option économies

**Domaine** : UI / modal dépense

Dans la modal d'ajout d'une dépense, proposer à l'utilisateur de prendre dans les économies s'il le souhaite (pas seulement en cas de dépassement P4).

## P6 — Modal dépense : étape 1 = type

**Domaine** : UI / modal dépense

Dans la même modal (P5), la **première étape** doit être de spécifier si la dépense est budgétée (rattachée à un budget existant) ou exceptionnelle (hors budget).

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

- **P10 — Fix flicker page d'accueil** ✅ livré 2026-05-14 (Sprint P10-Fix-Home-Flicker, cf. [CLAUDE.md §11](CLAUDE.md))
- **P2 — RAV calculé sans économies de budget** ✅ closed-by-pre-existing-fix 2026-05-15 (Sprint P2-Closeout-Administrative — bug n'existait pas dans le code actuel, formule RAV dans `lib/finance/calc-rtl.ts` n'inclut pas `cumulated_savings` depuis fix antérieur silencieux ; `totalSavings` exposé séparément + UI conforme. Cf. [CLAUDE.md §11](CLAUDE.md))
- **P3 — Recalcul RAV sur validation revenu** ✅ closed-by-pre-existing-fix 2026-05-15 (Sprint P3-Closeout-Administrative — les 3 règles sont déjà implémentées dans la formule RAV actuelle : Règle 1 budget déficit calculé on-the-fly via `calculateBudgetDeficit(estimated, spent)` dans `lib/finance/calc-rtl.ts`, Règles 2+3 exceptional incomes/expenses déjà additifs/soustractifs dans `_loadFinancialData` ; trigger recalcul via TanStack Query invalidation cascade depuis Sprint 1.5+2-followup. Cf. [CLAUDE.md §11](CLAUDE.md))
