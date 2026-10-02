# Part 48 — Couvrir le dépassement d'une dépense : reste à vivre ou réserves (2026-10-02)

> 1 sprint. Demande de l'utilisateur, inspirée des curseurs du renflouement
> manuel du récap ([Part 46](roadmap-detailed-46-recap-manual-refloat.md)) :
> quand une dépense dépasse ce qui reste dans son budget, ne plus puiser
> automatiquement dans les réserves, mais laisser le choix — tout imputer au
> reste à vivre, ou répartir le manque avec des curseurs (tirelire, économies
> des autres budgets). Aucune migration : la RPC
> `add_expense_with_cross_budget_cascade` et la trace `expense_savings_sources`
> ([Part 28](roadmap-detailed-28-auto-cascade-piggy.md)) couvraient déjà tous
> les débits nécessaires.

## 1. Avant

- Ajout d'une dépense budgétée : économies du budget, puis budget, puis — sur
  dépassement — **cascade automatique** (tirelire d'abord, puis économies des
  autres budgets au prorata). Seule trace visible : un encart violet
  informatif. Le choix manuel d'avant le 2026-05-26 (pastilles par budget,
  tout ou rien) avait été remplacé par cette cascade.
- Modification : la cascade était **recalculée** à chaque changement de
  montant. Corriger 5 € pouvait ponctionner la tirelire.
- L'encart « Dépassement » calculait le dépassement côté navigateur avec
  `useProgressData` (mois courant), faux dans le wizard « Compléter le mois ».

## 2. Décisions produit (validées par l'utilisateur)

1. **Projets exclus** : leur argent reste sanctuarisé. En cours de mois,
   emprunter sur une mensualité demanderait une mémoire « déjà emprunté »
   consommée à la clôture, plus un remboursement à la suppression : chantier
   séparé, non demandé.
2. **« Imputer au reste à vivre » présélectionné** : aucune réserve n'est
   prise sans action. Une couverture partielle est permise : la part non
   couverte va sur le reste à vivre (dans le récap, il faut arriver à 0 €).
3. **Modification (laissée au jugement de Claude)** : les sources choisies à
   l'ajout sont **conservées**. À la hausse, rien de plus n'est pris (le
   supplément va en déficit). À la baisse, elles sont rendues au prorata. Pas
   de nouvelle étape dans la modale de modification.
4. **Économies du budget lui-même** : toujours automatiques (avant le budget,
   comportement Auto-Use-Savings inchangé).

**Forme** : une 4ᵉ étape du wizard existant (Type → Nature → Champs →
« Couvrir le dépassement »), pas un drawer par-dessus la modale (2 couches,
2 pièges à focus) ni des curseurs dans le formulaire (déjà long, bouton
d'envoi repoussé loin). L'étape n'apparaît que s'il y a dépassement **et** au
moins une réserve ; sinon l'encart dit « imputé au reste à vivre » et le
bouton reste « Ajouter la dépense ».

## 3. Implémentation

**Logique pure** — [lib/expense-breakdown.ts](../../lib/expense-breakdown.ts) :
`OverflowCoverage { piggy, budgets[] }`, `EMPTY_COVERAGE`, `coverageTotal`,
`autoCoverOverflow` (ancienne cascade, devenue le bouton « Répartir
automatiquement »), `shrinkCoverage` (prorata au centime, tirelire comprise),
`calculateBreakdownWithCoverage` (local puis couverture ramenée au
dépassement, résidu en `fromBudget`), `findCoverageIssue` (doublon, budget
inconnu ou destination, plus que disponible, plus que le dépassement ;
tolérance `ROUNDING_TOLERANCE`, première utilisation de la constante).
`calculateBreakdownWithAutoCascade` **supprimée** (Path B, plus aucun
consommateur).

**Serveur** :

- Schéma : `overflow_coverage` remplace `cross_budget_cascade` (accepté mais
  ignoré depuis Part 28, 0 envoi).
- `POST add-with-logic` : dépassement recalculé sur l'état DB, couverture
  validée → **409 `overflow-coverage-outdated`** si elle n'est plus possible
  (autre dépense entre-temps, autre membre du groupe). Refus plutôt que
  correction silencieuse : l'utilisateur ne perd jamais plus que ce qu'il a
  vu. Dispatch RPC inchangé.
- `GET preview-breakdown` : en ajout, répartition **sans** couverture + champs
  `overflow` et `other_budgets_savings`. En modification, sources d'origine
  (trace, ou part tirelire seule pour une dépense sans trace) via
  `calculateBreakdownWithCoverage`.
- `PUT expenses/real` (chemin tracé) : même règle ; la lecture `piggy_bank` et
  celle des autres budgets disparaissent (une source gardée ne dépasse jamais
  son montant d'origine, toujours disponible après reverse).

**UI** :

- [hooks/useExpenseBreakdownPreview.ts](../../hooks/useExpenseBreakdownPreview.ts) :
  requête partagée (même clé que l'ancien `ExpenseBreakdownPreview`,
  `staleTime: 0`), `fetchFresh` (relit la route à l'envoi : c'est elle qui
  décide d'afficher l'étape), `applyCoverageToPreview` (aperçu en direct
  sans aller-retour), `ravDeltaOf`, `needsCoverageStep`. Pas d'import de
  `queryOptions` / `keepPreviousData` : `a11y-audit.test.tsx` mocke
  `@tanstack/react-query` avec 3 exports seulement.
- [components/dashboard/OverflowCoverageStep.tsx](../../components/dashboard/OverflowCoverageStep.tsx) :
  bandeau collant (Dépassement / Couvert / Reste à vivre + barre + « Reste à
  vivre : A → B »), 2 cartes radio, curseurs `Line` + `Arrow` exportés de
  `RefloatPanels`, « Répartir automatiquement », « Tout remettre à 0 ».
  Collage : `-top-[calc(1rem+1px)]` + fond blanc plein, sinon la marge `py-4`
  du corps laissait voir la liste qui défile au-dessus du bandeau (constaté
  en Chromium).
- `AddTransactionModal` : étape `cover-overflow`, couverture liée au couple
  budget + montant (`coverageKey`), envoyée seulement depuis l'étape en mode
  réserves. Sur 409 : relecture de l'aperçu, couverture remise à 0, message.
  `addExpense` renvoie désormais `AddExpenseOutcome` (avant : `false` sans
  aucun message à l'écran). Encart et bouton lisent le dépassement serveur
  (fenêtre du récap comprise), `useProgressData` n'est plus importé.
- `ExpenseBreakdownPreview` : prop `coverage` (lignes Tirelire / Économies
  « X » en direct). `EditTransactionModal` : texte de l'encart.

## 4. Vérification

- `typecheck` / `lint:check` / `format:check` verts, `test:run` **1222**
  passés / 227 ignorés (1189 avant), `build` OK (env factices, 47 routes).
- Nouveaux tests : `expense-breakdown.test.ts` (couverture, prorata,
  validation ; anciens cas de la cascade gardés via `autoCoverOverflow`),
  `expenses-add-with-logic.test.ts` (sans couverture = tirelire intacte,
  4 cas 409), `expenses-overflow-coverage.test.ts` (aperçu + PUT hausse /
  baisse / sous plafond), `AddTransactionModal.test.tsx` (7 cas de l'étape).
- Rendu Chromium 390 × 844 via une page temporaire à routes API simulées
  (non commitée) : champs + encart, étape présélectionnée, répartition auto,
  liste défilée sous le bandeau. Pas de défilement horizontal.
- **Non vérifié** : la RPC sur base réelle (inchangée, couverte par les tests
  gated existants, non lancés faute de base) ; le contexte groupe en vrai
  (même code, `contextFilter` groupe).

## 5. Trouvaille : `next dev` réécrit CLAUDE.md

`next dev` (16.3.3) ajoute en fin de `CLAUDE.md` un bloc
`<!-- BEGIN:nextjs-agent-rules -->` (675 caractères), qui fait passer le
fichier au-dessus du plafond 39 500. Il est recréé à chaque démarrage tant
que l'option n'est pas coupée (`agentRules: false` dans `next.config.js`,
cf. message au démarrage). Bloc annulé, non commité ; désactivation laissée
à l'utilisateur (changement de configuration hors sujet).
