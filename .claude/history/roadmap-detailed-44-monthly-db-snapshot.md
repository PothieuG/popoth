# Part 44 — Snapshot automatique de fin de mois + restauration globale (2026-09-28)

> 1 sprint. Filet de sécurité du Monthly Recap : le dernier jour de chaque mois
> à 23h45 (heure de Paris), la base prend une copie de toutes les données
> financières. Si un récap casse les données, une commande remet toute l'appli
> dans cet état et le récap se rejoue proprement.

## 1. La demande et les décisions

Demande user : « automatiquement le dernier jour de chaque mois, 15 min avant
minuit, un snapshot de la DB », pour prévenir un bug de données du Monthly Recap
(« un sacré bazar ») et pouvoir revenir à l'état du début du mois pour refaire
un récap propre.

| Question (posée en langage métier) | Réponse user                                                |
| ---------------------------------- | ----------------------------------------------------------- |
| Portée de la restauration          | **Toute l'appli d'un coup** (pas « un espace à la fois »)   |
| Déclencheur                        | **Commande lancée par le user** (pas de bouton dans l'app)  |
| Saisies faites depuis le snapshot  | **Tout effacer, avec la liste** affichée avant de confirmer |
| Rétention                          | **12 derniers mois**                                        |

### Pourquoi pas les sauvegardes Supabase

- Plan gratuit : aucune sauvegarde restaurable. Pro : sauvegardes quotidiennes,
  heure non choisie ; PITR ≈ 100 $/mois en add-on.
- Surtout : restauration **de tout le projet**, avec coupure. Impossible de
  « remettre les données financières au 30/09 23h45 » sans toucher aux comptes.
- Le besoin est un bug **logique** (récap), pas la perte de la base : une copie
  dans la même base suffit, coûte 0 € et se restaure en une transaction.

## 2. Base — migration `20260928000000_create_monthly_db_snapshots.sql`

- **Schéma dédié `snapshots`**, hors PostgREST. `REVOKE ALL` pour `PUBLIC`,
  `anon`, `authenticated`, `service_role` (schéma, tables, fonctions) : seul le
  propriétaire y accède — pg_cron et la Management API du script CLI. Rien à
  élever, donc fonctions **SECURITY INVOKER**. Ce ne sont pas des RPC de l'app :
  `EXPECTED_RPCS` reste à 28, `database.types.ts` et la baseline `public` ne
  bougent pas (sauf la ligne d'extension `pg_cron`, cf. §6).
- Tables : `db_snapshots` (métadonnées : `kind` month_end | manual |
  pre_restore, `period_year/month` = mois à Paris au moment de la prise,
  `table_counts`, `restored_at`) et `db_snapshot_tables` (1 ligne par table,
  `rows jsonb` = tableau des lignes). Index unique partiel : un seul month_end
  par période. RLS activée sans policy (défense en profondeur).
- **Stockage JSONB générique** : ajouter une colonne plus tard ne casse rien
  (colonne absente du snapshot → `DEFAULT` à la restauration, ignorée par
  l'aperçu) ; une colonne supprimée est ignorée.

| Fonction                                                  | Rôle                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `restorable_tables()`                                     | 12 tables rembobinées, **dans l'ordre des FK**                              |
| `uncovered_tables()`                                      | tables publiques ni rembobinées, ni partielles, ni exclues — doit être vide |
| `take_db_snapshot(kind, note)`                            | prise en **une seule instruction** (`INSERT … SELECT … UNION ALL`)          |
| `take_month_end_snapshot(now)`                            | point d'entrée pg_cron : filtre 23h Paris + dernier jour + déjà pris        |
| `purge_old_snapshots(now)`                                | garde 12 month_end ; manual / pre_restore supprimés après 12 mois           |
| `restore_blockers(id)`                                    | ce qui rendrait la ré-insertion impossible (FK vers un compte supprimé…)    |
| `preview_restore(id)`                                     | aperçu jsonb, ne modifie rien                                               |
| `restore_db_snapshot(id)`                                 | restauration globale, tout ou rien                                          |
| `snapshot_rows(id, table)`, `owner_label(profile, group)` | helpers                                                                     |

- **Cohérence de la prise sans verrou** : une instruction SQL voit une seule
  image MVCC, même en READ COMMITTED. Toutes les tables sont lues dans le même
  `INSERT … SELECT`, donc l'état est cohérent entre tables même si l'app écrit
  pendant la prise.
- **Fuseau figé** : `SET timezone TO 'UTC'` sur les fonctions qui sérialisent
  en JSON (`to_jsonb(timestamptz)` dépend du fuseau de la session : sans ça,
  l'aperçu verrait des « modifications » fantômes selon qui l'appelle).

### Planification (pg_cron ne connaît que l'UTC)

Job `popoth-month-end-snapshot`, `45 21,22 28-31 * *`, commande
`SELECT snapshots.take_month_end_snapshot()`. La fonction ne fait la copie que
si, à Paris, il est 23h et demain est le 1er :

| Exécution (UTC) | Heure à Paris été (UTC+2) | Heure à Paris hiver (UTC+1) |
| --------------- | ------------------------- | --------------------------- |
| 21h45           | **23h45** ✅              | 22h45 → ignorée             |
| 22h45           | 00h45 le 1er → ignorée    | **23h45** ✅                |

Changement d'heure un dernier jour du mois (31/10/2027, 31/03/2030) : à 23h45
l'heure a déjà changé, la bonne exécution passe. On n'utilise pas `$` (dernier
jour du mois) de pg_cron : ajouté en 1.6.0, et le filtre en SQL reste nécessaire
pour le fuseau.

⚠️ Le récap côté serveur bascule au mois suivant à **minuit UTC** (`getRecapPeriod`
lit l'heure du serveur Vercel), soit 1h ou 2h du matin à Paris : le snapshot de
23h45 est toujours avant.

## 3. Restauration — `restore_db_snapshot(id)`

Ordre, dans une seule transaction :

1. `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` sur les 12 tables + `profiles` +
   `groups` (l'app attend quelques instants ; `lock_timeout` 15 s).
2. `restore_blockers()` non vide → exception, rien n'a bougé.
3. Snapshot **`pre_restore`** de l'état courant, pour pouvoir annuler.
4. Désactivation des triggers **utilisateur actifs** (état exact retenu :
   `O`/`A`/`R`), sinon `sync_group_monthly_budget_estimate`, recalcul des
   contributions, lignes miroir de contribution, `updated_at`… réécriraient les
   données restaurées. Les triggers système (FK) restent : l'intégrité est
   vérifiée.
5. `TRUNCATE` des 12 tables (sans `CASCADE` : échoue si une table hors
   périmètre les référence ; aucun trigger de ligne déclenché).
6. Ré-insertion dans l'ordre des FK via `jsonb_populate_recordset`, colonnes
   communes snapshot ∩ table.
7. `profiles` : `salary`, `group_id` ; `groups` : `monthly_budget_estimate`,
   `monthly_income_estimate`. Jamais supprimés ni recréés (comptes auth, notes,
   sessions).
8. Triggers rétablis à l'identique, `restored_at` estampillé.

**Périmètre** : rembobinées = `estimated_budgets`, `estimated_incomes`,
`savings_projects`, `piggy_bank`, `bank_balances`, `group_contributions`,
`monthly_recaps`, `budget_transfers`, `real_expenses`, `real_income_entries`,
`expense_savings_sources`, `remaining_to_live_snapshots`. Partielles =
`profiles`, `groups`. **Exclue** = `notes` (le récap n'y touche pas ;
rembobiner effacerait les pense-bêtes écrits depuis). `auth.*` jamais touché.

**Bloquants** : une valeur du snapshot qui pointe (FK mono-colonne découverte
dans `pg_constraint`) vers un compte, un groupe ou un utilisateur auth supprimé
depuis, ou un `group_id` de profil vers un groupe supprimé ; une table
rembobinable absente du snapshot. Refus plutôt que ré-insertion partielle.

**Comptes / groupes créés depuis** : le compte reste, ses données financières
sont effacées (l'aperçu le dit). Un membre dont le groupe change doit se
reconnecter (le groupe vit dans le jeton de session, Part 42).

## 4. Outils

- [scripts/db-snapshot.mjs](../../scripts/db-snapshot.mjs) (`pnpm db:snapshot`) :
  `list`, `status` (job, 8 dernières exécutions `cron.job_run_details`, dernier
  month_end, tables non couvertes), `take [--note=…]`, `preview <AAAA-MM|id>`,
  `restore <AAAA-MM|id>`. `restore` affiche l'aperçu, refuse sans terminal
  interactif, exige de taper `RESTAURER`, puis affiche l'id `pre_restore` et la
  commande d'annulation. Projet = `$SUPABASE_PROJECT_REF`, prod par défaut
  (convention des scripts DB), affiché en tête.
- [scripts/db-snapshot-lib.mjs](../../scripts/db-snapshot-lib.mjs) : helpers
  purs (arguments, sélecteur validé par regex avant toute interpolation SQL,
  mise en forme fr-FR). 19 tests : [scripts/\_\_tests\_\_/db-snapshot-lib.test.ts](../../scripts/__tests__/db-snapshot-lib.test.ts).
- [scripts/check-snapshots.mjs](../../scripts/check-snapshots.mjs)
  (`pnpm db:check-snapshots`, dans `verify` + workflow hebdo `db-drift-check.yml`) :
  10 fonctions présentes, job actif avec le bon planning, `uncovered_tables()`
  vide, et — dès qu'un premier month_end existe — celui du mois écoulé existe.
  C'est le seul filet sur ce schéma : `check-drift`, `check-rpcs`,
  `audit-functions` ne regardent que `public`.

## 5. Vérification

Pas d'accès aux bases Supabase depuis la session (ni jeton, ni réseau
`supabase.com`). Vérifié sur un **PostgreSQL 16 local** : baseline du repo,
rôles `anon`/`authenticated`/`service_role` + privilèges par défaut façon
Supabase, faux `cron`, triggers « espions » aux noms de prod qui journalisent
chaque déclenchement, migration appliquée **deux fois** (idempotence), tout
exécuté par un rôle **non superutilisateur** propriétaire (comme `postgres`
sur Supabase). 45 assertions vertes :

- prise : compteurs exacts, avatars absents, rien modifié ;
- récap raté simulé (récap créé, tirelire vidée, solde, économies, projet,
  dépense ajoutée/supprimée/modifiée, flags de report, salaire, estimation de
  groupe, nouveau compte, note) → aperçu exact (compteurs, 4 transactions et
  colonnes modifiées, 4 soldes, récap, comptes) ;
- restauration : tables financières identiques octet pour octet (empreinte
  md5), **0 trigger déclenché**, triggers rétablis à l'identique, notes et
  avatars intacts, nouveau compte conservé mais vidé ;
- aperçu vide après restauration, **quel que soit le fuseau de la session** ;
- annulation via `pre_restore` puis re-restauration : empreintes exactes ;
- compte supprimé depuis → bloquant signalé, restauration refusée, **rien
  modifié**, triggers actifs, pas de `pre_restore` résiduel ;
- planning : 30/09 été, 31/10 hiver, 29/02/2028 bissextile, idempotence ;
- rétention 12 ; évolution de schéma (colonne ajoutée → DEFAULT, retirée →
  ignorée) ; table publique oubliée détectée ;
- `anon`, `authenticated`, `service_role` : ni exécution ni lecture.

CLI testée de bout en bout sur cette base (Management API redirigée vers psql) :
`list`, `status`, `take` avec apostrophe dans la note, `preview`, `restore`
refusé sans terminal, annulé sur mauvais mot, confirmé → aperçu vide ensuite.

## 6. Déploiement (à faire par le user)

1. **Dev** (pas de tracker de migrations, cf. multi-env §6) :
   `$env:SUPABASE_PROJECT_REF='ddehmjucyfgyppfkbddr'; node scripts/apply-sql.mjs supabase/migrations/20260928000000_create_monthly_db_snapshots.sql`
   puis `pnpm db:check-snapshots`, `pnpm db:snapshot take`, `preview`, et un
   `restore` pour de vrai sur dev.
2. **Prod** : push gate habituel (`db push --dry-run` → STOP → `db push`), puis
   `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql`
   — la baseline gagne `CREATE EXTENSION IF NOT EXISTS "pg_cron";`, sinon
   `db:check-drift` reste rouge — et `pnpm db:check-snapshots`.
3. Si `CREATE EXTENSION pg_cron` est refusé : activer Cron dans le dashboard
   (Integrations → Cron) puis ré-appliquer la migration (idempotente,
   `cron.schedule` avec un nom existant met le job à jour).

### 6.1 Effectué le 2026-09-29 (session locale)

- **Dev = prod avant migration** : `db:check-drift` sur dev, seul écart la ligne
  `-- Project:` de l'en-tête.
- **Dev** : migration via `apply-sql.mjs` (HTTP 201). `CREATE EXTENSION pg_cron`
  accepté tel quel (1.6.4), aucune activation dashboard. Job
  `45 21,22 28-31 * *` actif, exécuté par `postgres` ; schéma, tables et fonctions
  `snapshots` et tables publiques à `postgres` ; aucun droit (schéma, tables,
  `restore_db_snapshot`) pour `anon` / `authenticated` / `service_role` ;
  `uncovered_tables()` vide ; `cron.timezone` = `GMT`.
- **Déclencheur (dev)** : `take_month_end_snapshot('2026-08-31 22:45+00')` → NULL,
  `21:45+00` → month_end 08/2026, rejeu → NULL. `db:check-snapshots` OK sans INFO.
- **Restauration réelle (dev)** : snapshot manuel S, puis modifications en SQL
  direct — salaire d'un membre, budget de groupe ajouté (triggers : estimation
  4104 → 4354, contributions et lignes miroir recalculées), 2 dépenses + 1 revenu
  ajoutés, 1 revenu miroir supprimé, 1 dépense validée, 2 soldes, 2 tirelires,
  économies d'un budget, récap d'août rouvert. Aperçu exact (7 transactions,
  5 soldes, 1 récap, 1 salaire). `restore S` (lancé par le user, `RESTAURER`
  tapé) → aperçu vide, 16 triggers à `O`, aucun à `D`, estimation 4104 et
  contributions revenues ; budget de groupe inséré ensuite → estimation,
  contributions et miroirs recalculés (triggers opérationnels). `restore P`
  (pre_restore) → état modifié revenu à l'identique ; `restore S` final → dev
  propre. 5 snapshots ≈ 9 Ko stockés chacun.
- **Écart constaté** : l'aperçu ne liste pas `groups.monthly_budget_estimate` /
  `monthly_income_estimate` (seulement les groupes créés depuis) ; la restauration
  les remet bien (4354 → 4104 vérifié).
- **Jeton** : un terminal ouvert avant `SetEnvironmentVariable(..., 'User')` ne
  voit pas le jeton (Windows Terminal, même en nouvel onglet). Le charger dans la
  commande : `$env:SUPABASE_ACCESS_TOKEN = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','User')`.
- **Prod** (plan gratuit) : base 20 Mo avant migration. Tracker 71/72, seule
  `20260928000000` manquante ; `db push --dry-run` idem. `supabase link` +
  `db push` : pg_cron créé par la migration (1.6), aucune activation dashboard.
  Mêmes vérifications qu'en dev, toutes conformes (`cron.timezone` = `GMT`).
  `db:check-snapshots` (OK + INFO), `check-rpcs` (28), `check-rls`,
  `check-functions`, `audit-functions`, `check-types-fresh` OK — types non
  régénérés. Baseline : seul ajout `CREATE EXTENSION IF NOT EXISTS "pg_cron";`
  (+ date) ; `db:check-drift` OK. `pnpm verify` exit 0.
- **Premier snapshot prod** : manuel `4059dd6b-71fe-4ed2-ac3f-b4eb4179decf`
  (29/09/2026 16:47 Paris) — 95 dépenses, 14 revenus, 33 budgets, 3 récaps,
  44 lignes `remaining_to_live_snapshots` ; 28 Ko stockés, aperçu vide.
- **Écarts vs §6** : le point 3 (activer Cron au dashboard) n'a servi ni en dev ni
  en prod. Restauration testée en SQL direct plutôt que dans l'appli : pas de
  `.env.local` sur le poste, et aucun récap jouable ce jour-là (août terminé,
  septembre ouvert le 1er octobre).

## 7. ❌ À ne pas faire

- ❌ Ajouter une table publique sans la déclarer dans `restorable_tables()` (à
  sa place dans l'ordre des FK) ou dans les exclusions de `uncovered_tables()` —
  `db:check-snapshots` rouge, et la table échapperait au snapshot.
- ❌ `TRUNCATE … CASCADE` ou `session_replication_role = replica` dans la
  restauration : le premier viderait des tables hors périmètre, le second
  couperait aussi les FK.
- ❌ Exposer ces fonctions à l'app (`public`, `GRANT … service_role`, route
  API, bouton) : une restauration globale ne doit être possible qu'avec le
  jeton Management API du user et une confirmation tapée.
- ❌ Utiliser ces snapshots comme sauvegarde contre la perte de la base : ils
  vivent dans la même base.
