# Part 47 — Réception du salaire + contribution visible au récap + date simulée (2026-10-02)

> 1 sprint. Parti d'une question de l'utilisateur sur son récap de septembre
> 2026 : « j'ai 2 703 € qui vont partir dans la tirelire alors que la grande
> partie de cet argent sert à la contribution au groupe ».
> Migration `20261002000000_salary_reception_in_advance.sql` (1 colonne, 1 index,
> 1 RPC nouvelle, 2 RPC remplacées). **Appliquée sur dev, PAS encore en prod.**

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
   — **du mois que la paie finance** (recommandation acceptée).
3. Le salaire reçu apparaît dans l'onglet Revenus.
4. Le récap affiche la contribution au groupe et le salaire reçu en avance.
5. Pouvoir « revenir virtuellement au 30 septembre » sur l'espace de test.

## 3. Modèle

Une ligne « Salaire » par mois à financer. Avant : créée non validée à la fin
du récap. Maintenant, elle peut aussi être créée **plus tôt, déjà validée**.

| Moment                | Ce qui se passe                                                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Réception (ex. 28/09) | `receive_salary_in_advance` : ligne `real_income_entries` (`salary_reception = true`, ni exceptionnelle ni rattachée) + solde crédité du montant reçu, 1 transaction. **Hors RAV** du mois en cours.                                                           |
| Fin du récap          | `process_recap_transactions` l'épargne ; `create_salary_income_for_recap` l'**adopte** : `recap_origin_id` posé, `salary_reception` → NULL, montant ramené au salaire déclaré, écart → « Équilibrage salaire » exceptionnel déjà appliqué. Solde non retouché. |
| Mois suivant          | Ligne salaire classique, déjà validée (verrouillée). Seul l'écart pèse sur le RAV.                                                                                                                                                                             |

État final identique à « ligne automatique validée au montant réel »
(`validate_salary_with_delta`) : seul le moment du crédit change.

**Quel mois la paie finance-t-elle ?** Décidé côté serveur
([income-receive-salary.ts](../../lib/api/finance/income-receive-salary.ts)),
annoncé côté client par la même règle pure
([salary-reception.ts](../../lib/finance/salary-reception.ts)) :

- une ligne salaire automatique attend sa validation → la paie est celle du
  **mois en cours** : `validate_salary_with_delta` (écart immédiat) ;
- sinon → **mois suivant** : `receive_salary_in_advance` ;
- réception déjà en attente → refus (`salary-already-received`, index unique
  partiel `WHERE salary_reception IS TRUE`) ;
- pas de salaire déclaré → option masquée (`no-salary-declared` côté API).

Cas limites traités dans la RPC d'adoption : réception retirée du solde avant
le récap → redevient une ligne à valider ; salaire mis à 0 pendant le récap →
la réception devient un revenu exceptionnel du nouveau mois ; finalize rejoué →
`already_exists` (vérifié AVANT l'adoption).

## 4. Implémentation

**DB** — colonne `salary_reception boolean` nullable SANS défaut (même choix que
Part 46 : pas de faux diff à la restauration d'un snapshot mensuel).
`receive_salary_in_advance` : verrou `FOR UPDATE` sur le profil (double clic),
REVOKE `PUBLIC, anon, authenticated`. Les 2 RPC remplacées gardent nom et
signature ; REVOKE `anon, authenticated` ajouté au passage. `EXPECTED_RPCS`
30 → 31.

**Serveur** — route `POST /api/finance/income/real/receive-salary`
(`withAuthAndGroup`, `receiveSalaryBodySchema`). `PUT` d'un revenu : 409
`cannot-edit-salary-reception`. `loadRecapSummary` (espace perso) expose
`groupContribution` et `salaryReception` — **explicatifs, hors calcul**.

**UI** — `AddTransactionModal` : 3e carte « Réception du salaire » à l'étape
« Type de revenu » (perso + salaire déclaré ; grisée avec la raison si déjà
reçue), montant pré-rempli, `SalaryReceptionPanel` à la place de
`RemainingToLivePreview`. `TransactionListItem` : catégorie « Salaire reçu en
avance » + rappel bleu, pas de « Modifier » ; les lignes salaire du récap
affichent « Salaire » (elles retombaient sur « Revenu supprimé »).
`SummaryStep` : cartes « Salaire reçu en avance » et « Contribution au groupe …
(déjà déduite) », note « Avant contribution au groupe » sur le RAV estimé.
`FinalRecapStep` : « Salaire d'octobre déjà reçu » + écart.

**Date simulée** — [lib/clock.ts](../../lib/clock.ts) : `now()` remplace
`new Date()` pour les dates MÉTIER (mois recapé, fenêtres du RAV, date par
défaut d'une saisie — 15 sites). `NEXT_PUBLIC_DEV_TODAY=AAAA-MM-JJ` n'est
honorée que si `NEXT_PUBLIC_SUPABASE_URL` désigne la **base de test** : le
garde-fou porte sur la base, pas sur `NODE_ENV` (le site de test tourne en
`production`, et un `pnpm dev` local peut viser la prod). Pastille « Date
simulée » dans le layout. Procédure → [multi-env.md §8](../conventions/multi-env.md).

## 5. Vérification

- `typecheck` / `lint:check` verts ; `test:run` **1154** passed / 227 skipped
  (+63) ; `build` OK (env factices), route enregistrée (47).
- Nouveaux tests : `clock`, `salary-reception`, `income-receive-salary`
  (aiguillage des 2 RPC, 409, 400), `AddTransactionModal.salary` (10),
  `TransactionListItem.salary`, `SalaryContext` (SummaryStep + FinalRecapStep),
  `load-summary-salary-context`.
- **Dev** : migration appliquée (`apply-sql.mjs`, ref explicite), inscrite au
  tracker (74). Smoke test SQL dans une transaction annulée : réception +8,10
  et −52,08, seconde réception refusée, réception épargnée par
  `process_recap_transactions`, adoption (solde inchangé, écart créé), rejeu
  `already_exists`, réception retirée du solde → ligne à valider, chemin
  historique intact. 0 résidu. Droits : `postgres` + `service_role` seuls.
  `check-rpcs` 31/31, `audit-functions`, `check-rls`, `check-snapshots` OK.
- Rendu vérifié en 375 × 812 (page d'aperçu temporaire à données figées, non
  commitée) : dialogue, formulaire, liste, « Récap général », écran final.
- **Non fait** : aucun test gated (pas de `.env.local` sur le poste) ; pas de
  parcours réel dans l'appli contre la base de dev.

## 6. Reste à faire

1. **Prod** : push gate habituel, puis `db:types`, baseline, `db:check-drift`.
   D'ici là `db:check-rpcs` / `db:check-types-fresh` sont rouges sur la prod
   (`lib/database.types.ts` a été complété à la main : colonne + RPC).
2. Récap de septembre en prod : à l'étape « Compléter le mois », dévalider puis
   supprimer le « Salaire » du 28/09 saisi à la main, puis le ressaisir via
   « Réception du salaire ».

## 7. ❌ À ne pas faire

- ❌ Compter une ligne `salary_reception` (ou toute ligne salaire) dans le RAV :
  le salaire y entre déjà virtuellement. Seul l'« Équilibrage salaire » compte.
- ❌ Laisser `process_recap_transactions` supprimer ou reporter une réception en
  attente (`salary_reception IS NOT TRUE` sur les 2 instructions revenus).
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
- **Garder un seul état final pour deux chemins** (validation au 1er vs
  réception en avance) évite de dupliquer les règles en aval.
- `.next/dev/types` garde la trace des pages supprimées : `rm -rf .next/dev`
  avant `pnpm build` après un aperçu temporaire.
