# Part 47 — Réception du salaire + contribution visible au récap + date simulée (2026-10-02)

> 1 sprint, 2 passes. Parti d'une question de l'utilisateur sur son récap de
> septembre 2026 : « j'ai 2 703 € qui vont partir dans la tirelire alors que la
> grande partie de cet argent sert à la contribution au groupe ».
> Migrations `20261002000000_salary_reception_in_advance.sql` puis
> `20261002010000_salary_month.sql` (la seconde remplace le booléen de la
> première par le mois financé). **Appliquées sur dev, PAS encore en prod.**

## 1. Le constat (lecture seule sur la prod)

Compte perso d'un membre de groupe, septembre 2026 :

| Terme du reste à vivre                       | Montant        |
| -------------------------------------------- | -------------- |
| Salaire du mois (virtuel, `profiles.salary`) | + 2 752,08     |
| Revenu « Salaire » saisi à la main le 28/09  | + 2 760,18     |
| Autres revenus exceptionnels                 | + 1 131,33     |
| Budgets perso                                | − 427,00       |
| Contribution au groupe (ligne miroir)        | − 2 501,72     |
| Autres dépenses hors budget                  | − 885,91       |
| Dépassements de budgets                      | − 125,15       |
| **Reste à vivre = bilan du récap**           | **+ 2 703,81** |

- La contribution **était déjà déduite** : ce n'était pas le problème.
- Le problème : l'utilisateur est payé le 28 pour le mois SUIVANT. Pour que son
  solde soit juste, il saisissait sa paie comme un revenu — donc exceptionnel,
  donc compté dans le RAV de septembre, **en plus** du salaire virtuel. Sans
  elle, le vrai bilan est **−56,37 €**.
- Conséquences : 2 703,81 € balayés en tirelire (hors calculs), octobre qui
  démarre dans le rouge, et la ligne « Salaire » automatique du 1er octobre —
  non supprimable — qui aurait crédité le solde une seconde fois si validée.
- Constat annexe : salaire 2 752,08 € < contribution + budgets perso
  (2 928,72 €) → −176,64 € structurels chaque mois.

## 2. Décisions produit (validées par l'utilisateur)

1. Option **« Réception du salaire »** dans le dialogue d'ajout (revenu, espace
   perso) : on saisit le montant réellement reçu.
2. L'écart avec le salaire des paramètres est ajouté / retiré du reste à vivre
   — **du mois que la paie finance**.
3. Le salaire reçu apparaît dans l'onglet Revenus.
4. Le récap affiche la contribution au groupe et le salaire reçu en avance.
5. Pouvoir « revenir virtuellement au 30 septembre » sur l'espace de test.
6. **(2e passe) Le mois financé se choisit** : une personne payée le 3 finance
   le mois en cours, une personne payée le 28 le mois suivant. L'appli
   propose, l'utilisateur tranche.

## 3. Modèle — une ligne salaire par mois FINANCÉ

`real_income_entries.salary_month` (date, 1er du mois, nullable) : le mois que
la ligne finance, pas sa date de réception. Index unique
`(profile_id, salary_month)`. Une ligne salaire ne pèse jamais sur le RAV (le
salaire y entre déjà via `profiles.salary`) ; seul l'« Équilibrage salaire »
(écart reçu − déclaré, exceptionnel) compte.

Le mois se choisit parmi deux : le **mois ouvert** (celui que l'utilisateur vit ;
tant que le récap du mois écoulé n'est pas terminé, c'est ce mois écoulé) et le
**suivant**. Même règle côté serveur (`resolveOpenMonth`) et côté dialogue
(mois recapé passé par le wizard, sinon mois du jour).

| Cas                                   | Ce qui se passe                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mois ouvert, ligne du récap à valider | `validate_salary_with_delta` (inchangé) : solde crédité, écart tout de suite.                                                                                                                                |
| Mois ouvert, aucune ligne             | `receive_salary(..., p_apply_delta_now = true)` : ligne au salaire déclaré + écart tout de suite. Même état final que le cas précédent.                                                                      |
| Mois suivant                          | `receive_salary(..., false)` : ligne au montant reçu, solde crédité, **hors RAV**. À la fin du récap, `create_salary_income_for_recap` l'adopte : montant ramené au déclaré, écart créé, solde non retouché. |
| Salaire déjà enregistré pour ce mois  | 409 `salary-already-received` (index unique en dernier rempart).                                                                                                                                             |

`process_recap_transactions` épargne toute ligne salaire d'un mois postérieur
au mois recapé ; le salaire du mois recapé suit la règle générale (validé →
supprimé).

**Proposition par défaut** (`defaultSalaryMonthOption`) : ligne en attente → ce
mois ; sinon jour de réception ≤ 15 → mois ouvert, après → mois suivant ; si
le mois proposé est déjà réglé → l'autre.

Cas limites de la RPC d'adoption : réception retirée du solde avant le récap →
redevient une ligne à valider ; salaire mis à 0 pendant le récap → la réception
devient un revenu exceptionnel du nouveau mois ; finalize rejoué →
`already_exists` (vérifié AVANT l'adoption). Garde-fou : une ligne « mois
ouvert » adoptée par erreur donnerait un écart de 0 (montant = déclaré), donc
pas de double comptage.

## 4. Implémentation

**DB** — passe 1 : `salary_reception boolean` + `receive_salary_in_advance`.
Passe 2 : `salary_month` (reprise des lignes existantes via le récap d'origine),
`receive_salary`, colonne et fonction de la passe 1 supprimées (jamais en
prod). `receive_salary` : verrou `FOR UPDATE` sur le profil, REVOKE `PUBLIC,
anon, authenticated`. Les 2 RPC remplacées gardent nom et signature.
`EXPECTED_RPCS` 30 → 31.

**Serveur** — route `POST /api/finance/income/real/receive-salary`
(`withAuthAndGroup`, `receiveSalaryBodySchema` : `amount`, `salary_month`
`AAAA-MM`, `entry_date?`) ; 400 `invalid-salary-month` hors des deux mois
possibles. `PUT` d'un revenu : 409 `cannot-edit-salary-reception`.
`loadRecapSummary` (espace perso) expose `groupContribution` et
`salaryReception` — **explicatifs, hors calcul**.

**UI** — `AddTransactionModal` : 3e carte « Réception du salaire » (perso +
salaire déclaré ; grisée si les deux mois sont réglés), sélecteur « Ce salaire
finance » (2 boutons radio, mois réglé grisé « Déjà reçu »), montant pré-rempli
qui suit le mois tant qu'il n'a pas été retouché, `SalaryReceptionPanel` à la
place de `RemainingToLivePreview`. `TransactionListItem` : catégorie « Salaire
d'<mois> », rappel bleu si le mois financé est postérieur au mois ouvert
(prop `openMonth`, transmise par `TransactionTabsComponent`), pas de
« Modifier » ; les anciennes lignes salaire affichent « Salaire » (elles
retombaient sur « Revenu supprimé »). `SummaryStep` : cartes « Salaire reçu en
avance » et « Contribution au groupe … (déjà déduite) », note « Avant
contribution au groupe » sur le RAV estimé. `FinalRecapStep` : « Salaire
d'octobre déjà reçu » + écart.

**Date simulée** — [lib/clock.ts](../../lib/clock.ts) : `now()` remplace
`new Date()` pour les dates MÉTIER (mois recapé, fenêtres du RAV, date par
défaut d'une saisie — 15 sites). `NEXT_PUBLIC_DEV_TODAY=AAAA-MM-JJ` n'est
honorée que si `NEXT_PUBLIC_SUPABASE_URL` désigne la **base de test** : le
garde-fou porte sur la base, pas sur `NODE_ENV` (le site de test tourne en
`production`, et un `pnpm dev` local peut viser la prod). Pastille « Date
simulée » dans le layout. Sur Vercel, la variable s'appelle `DEV_TODAY`
(préfixe public refusé en type secret) ; `next.config.js` la recopie.
Procédure → [multi-env.md §8](../conventions/multi-env.md).

## 5. Vérification

- `typecheck` / `lint:check` verts ; `test:run` **1189** passed / 227 skipped
  (+98) ; `build` OK (env factices), route enregistrée (47).
- Tests : `clock`, `salary-reception` (options, proposition par défaut),
  `income-receive-salary` (aiguillage, mois ouvert pendant un récap, 400/409),
  `AddTransactionModal.salary` (payé le 3 / le 28, choix contredit, mois
  réglé), `TransactionListItem.salary`, `SalaryContext`,
  `load-summary-salary-context`. Ils ont attrapé une regex de validation
  cassée (`\d` perdu par un script de remplacement) avant la mise en ligne.
- **Dev** : 2 migrations appliquées (`apply-sql.mjs`, ref explicite), tracker 75. Smoke tests SQL en transaction annulée : réception mois suivant +8,10 et
  −52,08, doublon refusé (23505), ligne épargnée puis adoptée (solde inchangé),
  salaire du mois recapé supprimé, réception mois ouvert (+10 tout de suite,
  réadoption sans double écart), réception retirée du solde → ligne à valider,
  chemin historique. 0 résidu. Droits : `postgres` + `service_role` seuls.
  `check-rpcs` 31/31, `audit-functions`, `check-snapshots` OK.
- Parcours réel par l'utilisateur sur le site de test (passe 1) : ancien
  « Salaire » supprimé, réception de 2 760,18 € enregistrée, solde 3 042,70 €.
- Rendu vérifié en 390 × 844 (page d'aperçu temporaire à données figées, non
  commitée).
- **Non fait** : aucun test gated (pas de `.env.local` sur le poste).

## 6. Reste à faire

1. **Prod** : push gate habituel (2 migrations), puis `db:types`, baseline,
   `db:check-drift`. D'ici là `db:check-rpcs` / `db:check-types-fresh` sont
   rouges sur la prod (`lib/database.types.ts` complété à la main).
2. Récap de septembre en prod : à l'étape « Compléter le mois », dévalider puis
   supprimer le « Salaire » du 28/09 saisi à la main, puis le ressaisir via
   « Réception du salaire » (mois : octobre).
3. Vercel `popoth_dev` : la branche de production était `main` (les pushes sur
   `dev` partaient en « Preview ») — réglage corrigé par l'utilisateur pendant
   le sprint ; multi-env.md §3 décrivait déjà `dev`.

## 7. ❌ À ne pas faire

- ❌ Compter une ligne salaire (`salary_month` non nul) dans le RAV : le
  salaire y entre déjà virtuellement. Seul l'« Équilibrage salaire » compte.
- ❌ Deviner le mois financé côté serveur : il est choisi par l'utilisateur et
  borné à [mois ouvert, mois suivant].
- ❌ Appliquer l'écart tout de suite pour le mois suivant, ou le différer pour
  le mois ouvert.
- ❌ Laisser `process_recap_transactions` supprimer ou reporter le salaire d'un
  mois postérieur au mois recapé.
- ❌ Créditer le solde à l'adoption : il l'a été à la réception.
- ❌ `new Date()` pour une date métier → `now()` de `lib/clock`. Les horodatages
  techniques (`updated_at`, `applied_to_balance_at`, session) restent réels.
- ❌ Assouplir le garde-fou de `lib/clock` (ex. le conditionner à `NODE_ENV`) :
  une date simulée contre la prod déclencherait un vrai récap.

## 8. Leçons

- **Un chiffre « faux » au récap vient souvent d'une saisie hors modèle**, pas
  du calcul : décomposer le RAV terme à terme sur les données réelles avant de
  toucher à une formule.
- **Quand l'utilisateur contourne l'appli pour garder un solde juste, il manque
  une saisie** : ici, « j'ai reçu ma paie » n'existait qu'après le récap.
- **Une règle qui devine à la place de l'utilisateur doit être visible et
  corrigeable** : la passe 1 supposait « paie = mois suivant », faux pour qui
  est payé le 3. Stocker le choix (`salary_month`) plutôt qu'un drapeau
  d'état a supprimé la devinette ET simplifié les gardes (un index unique).
- **Garder un seul état final pour plusieurs chemins** (validation au 1er,
  réception mois ouvert, réception mois suivant) évite de dupliquer les
  règles en aval.
- **Vérifier où pointe réellement l'adresse du site de test** (déploiements
  GitHub : « Production » vs « Preview ») avant de faire tester.
- `.next/dev/types` garde la trace des pages supprimées : `rm -rf .next/dev`
  avant `pnpm build` après un aperçu temporaire.
