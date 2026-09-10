# Part 42 — Perf dashboard : RAV par membre, région Vercel, cascade d'appels (2026-09-10)

> 1 sprint. Le dashboard groupe s'affichait visiblement plus lentement que le
> dashboard perso. Cause : un N+1 par membre dans `GET /api/finance/summary`,
> payé à chaque chargement pour alimenter un encart qui n'est visible qu'après
> ouverture du drawer Planification.

## 1. Le symptôme

Signalé par l'utilisateur : « grosse différence de rapidité d'affichage entre la
page personnelle et la page de groupe ». Les deux pages sont pourtant des
miroirs quasi ligne à ligne (`app/(dashboards)/dashboard/page.tsx` vs
`group-dashboard/page.tsx`), montent les mêmes composants et déclenchent les
mêmes 7 requêtes HTTP. La divergence est entièrement côté serveur, dans
`_loadFinancialData` ([lib/finance/financial-data.ts](../../lib/finance/financial-data.ts)).

## 2. La mesure

Banc d'essai sur le mock du plan de requêtes (`financial-data-query-plan.test.ts`),
30 ms de latence simulée par aller-retour, comptage des `.from()` et de la
profondeur réseau (temps total / latence unitaire) :

| Contexte          | Requêtes | Profondeur |
| ----------------- | -------- | ---------- |
| perso             | 9        | 2 RTT      |
| groupe, 1 membre  | 18       | 4 RTT      |
| groupe, 2 membres | 27       | 4 RTT      |
| groupe, 5 membres | 54       | 4 RTT      |

Le nombre de requêtes croît linéairement avec le nombre de membres, et la
profondeur double. Sur une fonction Vercel qui ne partage pas la région de la
base (~90 ms l'aller-retour, chiffre retenu au sprint Perf-Parallel-Financial-Data
du 2026-09-01), cela fait ~180 ms de latence pure en perso contre ~360 ms en
groupe — avant même de compter la mise en file des 27 requêtes concurrentes chez
le pooler.

## 3. La cause

§13 de `_loadFinancialData`, en contexte groupe, appelait
`getProfileFinancialData(memberId)` **pour chaque membre** afin d'hydrater
`meta.groupMembersRav`. Chaque appel est un pipeline complet : 8 lectures
parallèles + 1 écriture RAV. D'où la structure en 4 allers-retours :

1. phase 1 du groupe (8 lectures parallèles) ;
2. `saveRavToDatabase` du groupe (§12), qui **bloque** la suite sans que rien en
   aval ne consomme son résultat ;
3. phase 1 de chaque membre (concurrente entre membres) ;
4. `saveRavToDatabase` de chaque membre.

Ce coût était déjà connu et **explicitement épinglé** par un test du sprint
précédent (`expect(PROBE.fromCalls.get('estimated_incomes')).toBe(2)`), laissé
hors périmètre à l'époque.

Or `meta.groupMembersRav` n'a qu'un seul consommateur : l'encart « RAV actuel →
projeté » des modals Add/Edit Budget et Add/Edit Projet, qui vivent dans le
`PlanningDrawer`. Rien de tout cela n'est visible au premier rendu du dashboard.
Le champ dérivé `meta.groupMembersPersonalRavTotal`, lui, n'avait **aucun
consommateur** — ni UI, ni backend, ni récap.

Point aggravant relevé au passage : le snapshot `bank_balances.current_remaining_to_live`
que ces écritures rafraîchissaient n'est lu que par `GET /api/finance/rav`, route
sans aucun consommateur client. Le N+1 travaillait donc pour un effet de bord que
personne ne lit.

## 4. Le correctif

**a. Sortir le RAV par membre du chemin critique.** Le calcul déménage dans
[lib/finance/group-members-rav.ts](../../lib/finance/group-members-rav.ts)
(`loadGroupMembersRav`), servi par `GET /api/finance/group-members-rav`
([lib/api/finance/group-members-rav.ts](../../lib/api/finance/group-members-rav.ts)).
Le `PlanningDrawer` le charge lui-même via
[hooks/useGroupMembersRav.ts](../../hooks/useGroupMembersRav.ts), avec
`enabled: isOpen && context === 'group'`.

**La formule est inchangée** : on appelle toujours `getProfileFinancialData(membre)`.
La formule simplifiée `salaire − budgets_perso − contribution` avait été retirée
au sprint Group-RAV-Recap (2026-05-27) pour cause de dérive de plusieurs € ; on
ne la réintroduit pas. Même calcul, mais payé seulement quand il est regardé.

Le `enabled` est le cœur du gain : le `PlanningDrawer` est rendu (fermé) par
`<FinancialIndicators>` dès le premier rendu du dashboard. Sans lui, le N+1
serait simplement passé d'une route à l'autre.

**b. Dédoublonner la requête summary du dashboard perso.** `dashboard/page.tsx`
appelait `useFinancialData()` sans argument → queryKey `['financial-summary', null]`,
alors que tous les autres consommateurs de la page passent `'profile'` et
partagent `['financial-summary', 'profile']`. Le dashboard perso déclenchait donc
**deux** `GET /api/finance/summary` par chargement, soit deux pipelines complets
pour le même résultat. `summaryQuerySchema` ayant `.default('profile')`, l'URL nue
et `?context=profile` retombent sur la même branche serveur : dédoublonner ne
change aucune valeur affichée.

**c. Nettoyage.** `meta.groupMembersPersonalRavTotal` supprimé (0 consommateur,
Path B closed-by-deletion) ; `meta.groupMembersRav` retiré de `FinancialData`.

**d. Invalidation.** `['group-members-rav']` ajouté à `invalidateFinancialRefreshes`
(10 → 11 keys). Sans ça, une mutation sur un budget groupe — qui recalcule les
contributions, donc le RAV perso de chaque membre — laissait l'encart des modals
sur des chiffres périmés.

## 5. Le résultat

Même banc d'essai, après correctif :

| Contexte                        | Requêtes | Profondeur |
| ------------------------------- | -------- | ---------- |
| perso                           | 9        | 2 RTT      |
| groupe, 1 / 2 / 5 membres       | 9        | 2 RTT      |
| drawer ouvert, groupe 2 membres | 19       | 3 RTT      |
| drawer ouvert, groupe 5 membres | 46       | 3 RTT      |

**Le coût du dashboard groupe ne dépend plus du nombre de membres et devient
identique à celui du dashboard perso.** Le dashboard perso, lui, passe de 2
pipelines à 1. Le coût par membre subsiste, mais uniquement à l'ouverture du
drawer Planification, hors du rendu initial.

`lib/recap/load-summary.ts` et `lib/finance/snapshots.ts`, qui appellent aussi
`getGroupFinancialData` sans jamais lire `meta.groupMembersRav`, en bénéficient
au passage.

## 6. Garde-fous installés

- `financial-data-query-plan.test.ts` — le pin du N+1 est remplacé par
  l'invariant inverse : la même fixture à 1 puis 3 membres doit produire
  exactement 9 requêtes. Toute réintroduction d'un travail par membre dans
  `_loadFinancialData` fait tomber ce test.
- `lib/finance/__tests__/group-members-rav.test.ts` (5 cas) — formule identique
  au dashboard perso du membre, tri stable par prénom, groupe vide, join profils
  vide, et localisation du coût par membre.
- `hooks/__tests__/useGroupMembersRav.test.tsx` (3 cas) — aucun fetch tant que
  `enabled` est faux, fetch une fois ouvert, erreur HTTP non fatale.
- `PlanningDrawer.test.tsx` (+3 cas) — câblage `isOpen && context === 'group'`.
- `financial-data.test.ts` (gated, +1 cas 2.bis) — `loadGroupMembersRav` sert
  exactement le RAV du dashboard perso du membre.

## 7. Hors périmètre, laissé en l'état

- **N+1 par budget dans `GET /api/finance/budgets/estimated`** (une lecture
  `real_expenses` par budget, en parallèle). Identique en perso et en groupe,
  donc étranger au symptôme signalé ; agrégeable en une seule lecture filtrée
  par `estimated_budget_id IN (...)`.
- **`saveRavToDatabase` sur le chemin critique** (§12) : 1 aller-retour en fin
  de pipeline, pour les deux contextes. Le sortir demanderait `after()` de
  `next/server`, qui lève hors contexte de requête — or `_loadFinancialData` est
  aussi appelé par le récap et les scripts.
- **Hooks du `PlanningDrawer` non gatés sur `isOpen`** (`useBudgetProgress`,
  `useIncomeProgress`, `useProjects` fetchent au montage du dashboard). Coût
  identique en perso et en groupe.
- **`GET /api/finance/rav`** : route sans consommateur, candidate Path B.

---

## 8. Deuxième passe — la vraie cause (même jour)

Le correctif §4 n'a **rien changé de perceptible en prod**. Retour utilisateur :
« c'est toujours très lent, j'ai presque l'impression que c'est plus lent ».

### 8.1 L'erreur de méthode

Le §2 mesurait un **nombre de requêtes dans un mock**, pas des millisecondes en
prod. Or le sprint supprimait ~18 requêtes sur plus de 60, et surtout sur **1
appel d'API sur les 13** qu'un chargement de dashboard déclenche. Il réduisait
le _nombre_ de requêtes, jamais leur _latence unitaire_ ni le nombre d'appels —
les deux termes qui dominaient.

Leçon : un plan de requêtes est un proxy de la performance, pas une mesure. Tant
qu'on n'a pas le profil de latence réel, on optimise ce qu'on sait compter.

### 8.2 La cause dominante : la région

Le repo n'avait **pas de `vercel.json`**. Vercel place alors les fonctions sur
`iad1` (Washington DC) par défaut, ce choix visant les bases hébergées sur la
côte est américaine. La base Supabase de prod est en **`eu-central-1`
(Francfort)**.

Chaque requête Supabase était donc un aller-retour transatlantique (~80-120 ms
contre ~10-25 ms en intra-européen), et chaque appel d'API en enchaîne
plusieurs en série. Fix : `vercel.json` → `"regions": ["fra1"]`. Le plan Free
autorise une région unique, ce qui suffit.

### 8.3 La forme du problème, au-delà d'une route

Un chargement de dashboard, c'est :

- **13 appels d'API distincts**, donc 13 fonctions serverless indépendantes ;
- chacune relit `profiles` via `withAuthAndProfile` **avant** d'exécuter son
  handler (aller-retour bloquant) ;
- puis fait ses propres requêtes.

Deux gaspillages purs, corrigés ici :

1. **`GET /finance/expenses/real` et `/finance/income/real`** enchaînaient
   **4 allers-retours en série** en contexte groupe : lecture `profiles`, requête
   principale, **relecture strictement identique de `profiles`**, puis un
   `count: 'exact'` (COUNT complet côté Postgres). Les deux derniers alimentaient
   un champ `total` que le client **n'a jamais lu** — `useRealExpenses` ne retient
   que `data.real_expenses`, et son `totalExpenses` est une somme de montants,
   pas un nombre de lignes. Supprimés : 4 allers-retours → 2.

2. **`GET /finance/budgets/estimated`** faisait une requête `real_expenses` **par
   budget** (`.eq('estimated_budget_id', budget.id)` dans un `Promise.all`).
   Remplacé par un unique `.in(...)` + regroupement en mémoire : le coût ne
   dépend plus du nombre de budgets.

### 8.4 Identifié, délibérément NON corrigé

- **`withAuthAndProfile` relit `profiles` avant chaque handler** (13 lectures
  par chargement). La correction tentante — porter `group_id` dans le JWT —
  est une **régression de sécurité** : le jeton vit 1 h et se rafraîchit toutes
  les 50 min, donc un membre qui quitte un groupe garderait un accès en lecture
  aux données de ce groupe jusqu'à ~50 min. À traiter, si besoin, avec une
  ré-émission de session sur changement d'appartenance.
- **Sérialisation en deux vagues** : les deux pages sortent tôt sur `isLoading`
  de `useProfile`, donc l'arbre enfant n'est monté qu'ensuite et ses 8 requêtes
  de contenu partent **derrière** `GET /api/profile`. C'est exactement le
  symptôme rapporté (« la page s'affiche puis les chiffres arrivent »). Non
  corrigé faute de mesure post-région : à ~15 ms l'aller-retour, cette vague
  peut être devenue négligeable, et le correctif (lever le gate ou préfetcher au
  niveau du layout) touche le flux d'onboarding et le garde-fou anti-flicker du
  sprint Fix-Auth-Flicker. À décider sur données.

### 8.5 Garde-fous

`lib/api/finance/__tests__/list-routes-query-plan.test.ts` (5 cas) : absence de
`count: 'exact'`, absence de double lecture `profiles`, coût de
`budgets/estimated` indépendant du nombre de budgets, ventilation du dépensé par
budget, et report du mois précédent toujours additionné.
