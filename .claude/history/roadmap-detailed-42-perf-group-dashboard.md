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

---

## 9. Troisième passe — les deux points de §8.4, traités

Arbitrage utilisateur : « corrige les 2 points soulevés, tant pis pour les
données visibles pendant 50 min ». La fenêtre de péremption a finalement pu être
refermée sans rien concéder — voir §9.1.

### 9.1 Le groupe dans le jeton, sans régression de sécurité

`withAuthAndProfile` relisait `profiles` avant chaque handler : 13 lectures
bloquantes par chargement de dashboard, alors que **sur les 34 modules
concernés, un seul** (`app/api/savings/data`) avait besoin d'autre chose que
`group_id`.

Le risque annoncé en §8.4 était la péremption : un jeton qui affirme un groupe
que l'utilisateur a quitté. L'audit des 4 sites qui écrivent
`profiles.group_id` l'a écarté :

| Site                          | Qui agit          | Conséquence                            |
| ----------------------------- | ----------------- | -------------------------------------- |
| `POST /groups`                | le créateur       | sur lui-même                           |
| `POST /groups/[id]/members`   | celui qui rejoint | sur lui-même                           |
| `DELETE /groups/[id]/members` | celui qui part    | sur lui-même (`.eq('id', profile.id)`) |
| `DELETE /groups/[id]`         | le créateur       | le groupe entier disparaît             |

**Il n'existe aucune fonction « exclure un membre »**, et le créateur ne peut
pas quitter un groupe où il reste des membres. Toute mutation est donc une action
de l'utilisateur sur lui-même → une ré-émission du jeton dans ces 4 handlers
(`updateSessionGroup`) referme la fenêtre. Le seul cas résiduel — le créateur
supprime le groupe alors que d'autres membres y sont encore — laisse ces membres
avec un jeton pointant un groupe **supprimé** : dégradation d'affichage jusqu'au
prochain rafraîchissement, aucune donnée d'autrui à lire puisque le groupe
n'existe plus.

Livré :

- `SessionPayload.groupId?: string | null` — **trois** états. `undefined` =
  jeton émis avant ce sprint, information inconnue, repli sur une lecture. Sans
  ce troisième état, tout utilisateur déjà connecté serait vu « sans groupe » au
  déploiement et basculerait du dashboard groupe au dashboard perso.
- `withAuthAndGroup` — `{ userId, groupId }`, **zéro requête** (repli legacy mis
  à part). 19 modules finance migrés ; `withAuthAndProfile` reste pour
  `savings/data` et pour `app/api/groups/**`, dont la lecture arbitre
  l'appartenance et doit rester autoritative.
- Les **14 lectures manuelles** `select('group_id')` des routes finance
  (`withAuth` + lecture maison) supprimées : `expenses-real` et `income-real` en
  faisaient 3 chacune.
- `updateSessionGroup(groupId)` aux 4 sites ; `readGroupId` à la connexion et à
  chaque rafraîchissement (≈ 1 lecture / 50 min, contre 13 par chargement).

Résultat : `GET /finance/expenses/real?group=true` passe de **4 allers-retours en
série à 1**.

### 9.2 La sérialisation en deux vagues

`components/dashboard/DashboardDataPrefetch.tsx` — composant sans rendu, monté
dans le layout (qui n'est pas gaté sur le profil), qui appelle les 6 hooks de
contenu. TanStack Query dédoublonnant par `queryKey`, le sous-arbre rejoint
ensuite les requêtes déjà en vol : aucun appel supplémentaire.

Deux détails qui font la correction :

- **`period` vient de `usePeriodParam`**, pas du défaut `'month'` : amorcer
  `['progress-data', ctx, 'month']` quand l'URL demande la semaine remplirait la
  mauvaise entrée de cache et laisserait la vraie requête partir en 2e vague.
- **Composant dédié** plutôt qu'appels dans le layout : ne rendant rien, ses
  re-rendus (un par requête résolue) n'entraînent pas l'arbre du dashboard.

Le rendu n'est pas touché — pas de risque de régression du garde-fou
anti-flicker (sprint Fix-Auth-Flicker).

### 9.3 Garde-fous

- `lib/api/__tests__/with-auth-and-group.test.ts` (4 cas) — zéro lecture avec
  jeton porteur, `null` ≠ `undefined`, repli legacy, 401 sans lecture.
- `lib/__tests__/session-group.test.ts` (4 cas) — aller-retour JWT, `null`
  préservé, forme legacy → `undefined`, **jeton forgé avec une autre clé
  rejeté** (le groupe devient une donnée d'autorisation).
- `components/dashboard/__tests__/DashboardDataPrefetch.test.tsx` (4 cas) — les
  6 hooks amorcés, contexte propagé, période de l'URL respectée, rendu vide.
- `list-routes-query-plan.test.ts` resserré : les routes de liste doivent faire
  **exactement une** requête.

### 9.4 Reste ouvert

Le coût structurel restant est le **nombre d'appels** (13), pas leur contenu.
Le réduire demande de regrouper des endpoints — refonte d'API, à décider sur
mesure réelle. `GET /api/finance/rav` reste sans consommateur (candidate Path B).

---

## 10. Quatrième passe — l'après-geste (même jour, sprint Perf-Toggle-Targeted-Refresh)

Retour utilisateur après les 3 passes : « toutes mes interactions avec la
partie perso sont rapides, mais absolument pas avec la partie groupe — quand
les budgets se rechargent, quand je valide une dépense (appui long)… quasiment
tout est long ».

### 10.1 Ce qui a été vérifié symétrique (et ne sera donc pas la cause)

Relecture exhaustive du chemin groupe, côté serveur et côté client, en
cherchant une asymétrie perso ↔ groupe :

- **Serveur** : les 13 routes d'un chargement de dashboard ont le même plan
  de requêtes dans les deux contextes (`_loadFinancialData` : 9 lectures + 1
  écriture ; listes : 1 requête ; progress : 2). Seule différence groupe :
  la lecture `group_contributions` jointe aux profils, et
  `GET /api/groups/[id]/members` (1 requête).
- **Base** : index partiels `group_id` présents sur toutes les tables
  financières ; la cascade de triggers (`estimated_budgets` → `groups` →
  `calculate_group_contributions` → miroirs `real_expenses` /
  `real_income_entries`) ne se déclenche que sur écriture des budgets /
  revenus estimés / projets / profils, jamais sur lecture ni sur toggle ; les
  RPCs `toggle_*` font 1 SELECT FOR UPDATE + 2 UPDATE.
- **Proxy** : 2 lectures max, cookie 5 min, `/api` exclu.
- **Client** : mêmes hooks, mêmes keys, pas de polling, pas de realtime, pas
  de refetch-on-focus. Le service worker ignore `/api`.

Conclusion honnête : **le code ne contient pas de coût propre au groupe**
qui explique « perso rapide, groupe lent ». Ce qui reste asymétrique est
soit dans les données (volume, avatars), soit dans l'environnement — et
**aucune mesure en millisecondes n'existait** (cf. §8.1). D'où le script
`scripts/perf-probe.mjs` (§10.4).

### 10.2 Ce qui a été trouvé — et qui frappe les deux contextes

Trois mécanismes rendent _chaque interaction_ lente, dans les deux contextes,
et sont exactement les gestes cités :

1. **Le long-press déclenchait une tempête d'invalidations.** `onSettled`
   des 4 mutations toggle (dépense / revenu × appliquer / valider un report)
   appelait `invalidateFinancialRefreshes` : 11 keys → ~12 appels d'API en
   parallèle (~35 requêtes Supabase, dont le pipeline complet du résumé avec
   son écriture RAV) — pour un geste qui ne change **que**
   `bank_balances.balance`. Aucun calcul ne lit `applied_to_balance_at`
   (`_loadFinancialData`, `budgets-estimated`, `expenses-progress`,
   `planner-emptiness`). Pire : `['real-expenses']` / `['real-incomes']` sont
   dans ces 11 keys depuis le 2026-05-28 (Contribution-au-groupe), donc la
   liste elle-même était refetchée et remplacée par un skeleton jusqu'au
   retour de tout le lot. La règle ❌ du sprint Long-Press (« pas
   d'invalidation de la liste dans `onSettled` ») était contournée depuis
   3 mois. Le geste est instantané (optimistic) ; **c'est l'après-geste qui
   était long.**
2. **Ouvrir le planificateur relançait 5 `refetch()` forcés** (`useEffect(isOpen)`
   du `PlanningDrawer`) : budgets, revenus, projets ET les 2 listes de
   transactions (via `refreshBudgetProgress` / `refreshIncomeProgress`).
   Un `refetch()` impératif ignore le `staleTime` : cache frais ou pas, les
   budgets repassaient en skeleton — et la liste des transactions derrière le
   drawer avec eux. Même pattern sur `SavingsDistributionDrawer`.
3. **Les membres du groupe n'avaient pas de cache** (`useGroupMembers` en
   `useState` + fetch impératif) : chaque bascule perso → groupe relançait
   `GET /api/groups/[id]/members` et repassait l'en-tête en skeleton.
   Propre au groupe, mais léger.

### 10.3 Correctifs

- **Toggle → écriture directe du solde.** La RPC renvoie le nouveau solde ;
  `applyBankBalanceToCache` l'écrit dans `['bank-balance', ctx]` et
  `['financial-summary', ctx].availableBalance` (= `bank_balances.balance`
  pur depuis Long-Press). Miroir contribution : `applyContributionPairToCache`
  patche les DEUX contextes + la ligne miroir de l'autre liste, et
  `last_applied_amount` suit la RPC (= amount à l'apply, NULL sinon — c'est
  lui qui pilote le warning « à re-valider »). Zéro requête après le POST
  sur le chemin nominal ; en 409 / erreur, `invalidateBalanceViews` (2 keys)
  - la liste. Règle mise à jour dans
    [applied-balance-toggle.md](../conventions/applied-balance-toggle.md).
- **Drawers : plus de refetch forcé à l'ouverture.** Le cache est servi ;
  les mutations et le tire-pour-rafraîchir invalident déjà ces keys.
- **`useGroupMembers` → TanStack Query** (`['group-members', groupId]`,
  `enabled` = contexte groupe / modal ouverte), invalidé par les 4 mutations
  d'appartenance de `useGroups`.
- **`GET /api/groups` et `/api/groups/contributions`** : 2 lectures en série
  → `Promise.all` (1 aller-retour), COUNT en `head: true`. Toujours sur
  `withAuthAndProfile` (§9.1 : la lecture arbitre l'appartenance).

### 10.4 Mesurer, enfin : `scripts/perf-probe.mjs`

```
POPOTH_SESSION_COOKIE='<cookie session>' node scripts/perf-probe.mjs --base=https://<déploiement> --runs=5
```

Chronomètre les 12-13 appels d'un chargement de dashboard pour les 2
contextes (médiane / max, tri du plus lent au plus rapide), puis la « vague »
(tout en parallèle, comme le dashboard = temps d'attente réel), et affiche la
**région Vercel** qui a répondu (`x-vercel-id`). Deux lectures possibles :
vague groupe ≫ vague perso → le coupable est en tête du tableau groupe
(données) ; vagues proches mais longues → coût structurel (13 appels, région,
pooler). Ne jamais coller le cookie dans le chat.

⚠️ Au moment de ce sprint, `origin/main` ne contient **aucune** des passes
de la Part 42 (ni `vercel.json` → région `fra1`, ni le groupe dans le jeton,
ni les correctifs ci-dessus) : elles vivent sur la branche
`claude/popoth-groupe-performance-3mrdgd`. Si le test se fait sur la prod
déployée depuis `main`, la sonde affichera `iad1` et les 3 passes n'ont pas
pu être ressenties. À vérifier avant toute autre conclusion.

### 10.5 Garde-fous

- `hooks/__tests__/useReal{Expenses,Incomes}.toggle.test.tsx` (10 cas) —
  « exactement 1 `fetch` sur le chemin nominal », solde écrit en cache, RAV
  intact, miroir contribution sur les 2 contextes, côté inchangé (solde
  `null`) non écrasé, 409 / erreur → convergence ciblée.
- `PlanningDrawer.test.tsx` (+1) — spies hoistés : aucun `refresh*` à
  l'ouverture.
- `hooks/__tests__/useGroupMembers.test.tsx` (4 cas) — cache entre montages,
  gating `enabled` / sans groupe, erreur API.
- `app/api/groups/__tests__/groups-query-plan.test.ts` (2 cas) — « 2 requêtes
  en vol simultanément », mesure déterministe sans chrono.

### 10.6 Reste ouvert

- **L'asymétrie perso ↔ groupe elle-même** n'est pas expliquée par le code :
  à trancher avec la sonde sur le déploiement réel (données, région).
- Les autres mutations (ajout / édition / suppression) gardent
  `invalidateFinancialRefreshes` — légitime, elles changent RAV, budgets et
  progression. Avec les skeletons « remplace » du sprint Skeleton-Refetch-
  Loaders, chaque mutation vide encore les listes le temps de la vague ;
  passer à « données visibles + indicateur » pendant un refetch background
  est une décision produit, pas prise ici.
- Le nombre d'appels par chargement (13) reste le coût structurel (§9.4).
