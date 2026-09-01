# Part 41 — Abandoned-Recap-Recovery (2026-09-01)

> 1 sprint. Récupération de l'argent des bilans mensuels restés en plan à cheval
> sur deux mois. Contient aussi (§4) les points ouverts rapatriés du prompt de
> session `PROMPT-RECAP-ORPHELIN.md`, supprimé à la livraison.

## 1. Le défaut

Un utilisateur qui démarre son récap mensuel, **puise réellement dans sa tirelire
ou ses économies** pour éponger un déficit, puis n'achève jamais le wizard, perd
cet argent.

Mécanique : chaque ligne `monthly_recaps` est estampillée `(recap_month,
recap_year)`. Les **quatre** lectures serveur filtrent sur l'égalité stricte avec
`getRecapPeriod()` (= mois calendaire précédent) — `check-status.ts:108` (profil)
et `:168` (groupe), `active-recap.ts:51`, `complete/route.ts:66` — ainsi que la
RPC `start_monthly_recap` elle-même. Au franchissement du 1er du mois, la ligne
de juin devient donc **structurellement invisible** : `status` répond `no_recap`,
`/start` crée une ligne neuve, la ligne de juin reste `completed_at IS NULL` à
vie. Les index uniques étant partiels par `(owner, mois, année)`, rien n'interdit
N lignes ouvertes simultanées pour un même propriétaire.

Deux mouvements sont **immédiats et réels** (`lib/recap/actions-negative.ts`) :
`executeRefloatFromPiggy` (l.133, débite `piggy_bank.amount`) et
`executeRefloatFromSavings` (l.232-245, débite `estimated_budgets.cumulated_savings`
budget par budget). Leurs montants sont tracés dans `refloated_from_piggy` /
`refloated_from_savings` — c'est ce qui rend la réparation possible. Les deux
autres étapes de la cascade (`executeRefloatFromProjects`,
`executeSaveBudgetSnapshot`) n'écrivent qu'un JSONB différé : rien à rembourser.

Défaut **antérieur** au fix de période de juillet 2026 (`19291a6`), pas une
régression. Preuve empirique : la prod contenait **2 lignes dans cet état** juste
avant le nettoyage du 2026-09-01 (supprimées sans sauvegarde, non inspectables).

Deux chemins rendent le scénario réaliste : (a) démarrer le récap le 29 et ne
revenir que le 2 ; (b) — le plus probable — vivre sur `/group-dashboard`, que le
portier ne gate que sur le récap _groupe_, laissant le récap perso en plan des
semaines sans relance (cf. §4.2).

## 2. Décisions produit (arbitrées avec l'utilisateur, 2026-09-01)

| Question                          | Décision                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Bilan de mois passé resté en plan | **Rembourser puis repartir à neuf**. Le report de dépassement de l'ancien mois est perdu — accepté. |
| Destination du remboursement      | **Tout dans la tirelire**, au centime près. Pas de redistribution par budget.                       |
| Prévenir à l'écran                | **Oui**, bandeau visible quand de l'argent a été rendu.                                             |
| Bilan abandonné à 0 €             | **Archivage silencieux**, sans bandeau.                                                             |

Conséquence : **aucune colonne de détail par budget n'est nécessaire**. C'est ce
qui rend le sprint petit — l'option « redistribuer » aurait exigé une nouvelle
colonne JSONB _et_ une répartition approximative, le détail d'époque du refloat
savings n'étant persisté nulle part (seul le total scalaire existe ; les pools
`cumulated_savings` ayant justement été débités, la reconstruction est circulaire,
et `distributeProportional` fait porter le résidu d'arrondi au dernier budget par
ordre d'UUID — non reproductible).

**Hors périmètre, décidé explicitement** :

- **Le flux positif n'est PAS défait.** `executeTransferSurplusesToPiggy`,
  `executeTransformRemainingToSavings` et le balayage du reste-à-vivre vers la
  tirelire (`actions-positive.ts:265-285`) créditent réellement, mais l'argent
  reste chez l'utilisateur et il n'y a pas de double-comptage (le mois suivant
  recalcule son propre surplus). Ne pas « corriger » ça plus tard — d'autant que
  le balayage RAV n'a aucun tracker dédié (« Option A, pas de colonne dédiée »)
  et serait donc irréversible.
- Les transactions du mois abandonné ne sont pas perdues :
  `process_recap_transactions` n'a aucun filtre de date, le prochain bilan
  clôturé les traitera (cf. §4.1).

## 3. Livraison

**Vocabulaire** — « orphelin » était déjà pris (ligne de la _bonne_ période dont
`started_by_profile_id IS NULL`, cf. `check-status.ts:136`, `start_rpc.sql:9`, et
un cas de test nommé `orphan`). Le nouveau cas se dit **« abandonné »** partout.

- `supabase/migrations/20260901000000_add_abandoned_recap_recovery.sql` —
  `monthly_recaps.abandoned_at timestamptz` (état terminal, alternatif à
  `completed_at`) + `recovery_data jsonb DEFAULT '{}'` porté par la **nouvelle**
  ligne : `{ total, periods: [{ month, year, amount }] }`. Pas de nouvel index
  (au plus une ligne par owner et par mois ; `monthly_recaps_completed_lookup`
  couvre déjà le lookup).
- `supabase/migrations/20260901000001_start_monthly_recap_recovers_abandoned.sql`
  — `CREATE OR REPLACE start_monthly_recap`, **signature inchangée** (pas de
  `DROP FUNCTION`, `EXPECTED_RPCS` reste à 29). Bloc de balayage en tête :
  `PERFORM … FOR UPDATE` (le verrou est séparé de l'agrégat, `FOR UPDATE` étant
  interdit dans une requête qui agrège) → `SUM` + `jsonb_agg … FILTER (WHERE
total > 0)` + `array_agg(id)` → INSERT idempotent `piggy_bank` (miroir SQL de
  `ensurePiggyBankRow`, prérequis car la RPC RAISE sur 0 ligne) → `PERFORM
update_piggy_bank_amount(...)` → `UPDATE … SET abandoned_at = now()`. La clé
  `recovered` est **ajoutée** au JSON de retour ; le contrat des 4 résultats est
  préservé. Balayage fusionné dans la RPC (et non RPC séparée) pour que
  « crédit + marquage + `recovery_data` » tiennent dans **une** transaction.
- `lib/recap/recovery.ts` + barrel — `parseRecoveryData(raw)` pur, calqué sur
  `coerceSnapshot`. Renvoie `null` dans tous les cas « rien à annoncer » (blob
  vide, `total <= 0`, forme invalide) ; les entrées `periods` malformées sont
  écartées une à une, le total primant sur le détail des mois.
- `start/route.ts` relaie `recovered` + `logger.info` ; `status/route.ts` expose
  `recoveryData` dans l'objet `recap` ; `useMonthlyRecap.RecapProgress` étendu.
- `components/monthly-recap/RecoveredFundsBanner.tsx` — bandeau **en flux**
  (le snackbar `fixed bottom-4 z-[60]` reste réservé au transitoire),
  `role="status"`, **famille violette** (charte : violet = tirelire/économies ;
  ambre/jaune proscrit). Accord singulier/pluriel, année mentionnée une seule
  fois quand les mois la partagent. Câblé dans `RecapWizard` au-dessus de
  l'étape courante, sur toutes les étapes `in_progress` — pas sur `no_recap`,
  le balayage n'ayant lieu qu'au clic « Commencer ».

**⚠️ Ne PAS ajouter de filtre `abandoned_at IS NULL`** dans `check-status.ts` /
`active-recap.ts`. Le prédicat de balayage étant **strictement** antérieur, une
ligne abandonnée est toujours d'une période passée, donc déjà hors du filtre de
période de ces lectures. Ajouter le filtre les ferait répondre `no_recap` sur une
ligne présente, puis buter sur l'index unique partiel au prochain `start`.

**Tests** — `lib/recap/__tests__/recovery.test.ts` (9 cas purs) +
`components/monthly-recap/__tests__/RecoveredFundsBanner.test.tsx` (5 cas) +
6 cas gated ajoutés à `start/__tests__/route.integration.test.ts` (remboursement

- archivage, cas 0 € silencieux, deux mois cumulés dont un à 0 €, chemin nominal
  inchangé, pas de double remboursement au re-start, contexte groupe). Le
  `afterAll` et `resetRecaps()` nettoient désormais aussi `piggy_bank` — le
  balayage **crée** une ligne tirelire quand il rembourse.

**Mise en prod** — `db push` a refusé de se connecter (`SUPABASE_DB_PASSWORD` du
shell = celui de dev, ambiguïté documentée dans `multi-env.md` §6). Voie de repli
retenue avec accord utilisateur : `apply-sql.mjs` puis `INSERT INTO
supabase_migrations.schema_migrations` pour les 2 versions. Tracker prod vérifié
à jour avant et après.

**Fix collatéral** — `lib/schemas/__tests__/projects.test.ts` était rouge depuis
le passage au 1er septembre : il dérive une échéance d'un 31 août figé alors que
`makeProjectClientSchema` lit l'horloge réelle (`new Date()`), si bien qu'au
1er septembre l'échéance ne comptait plus que 5 mois pleins → « projet
inatteignable ». Horloge gelée via `vi.setSystemTime`. Pré-existant, sans rapport
avec ce sprint, mais bloquant pour `pnpm verify`.

## 4. Points ouverts rapatriés du prompt de session

> Ces 5 points n'avaient **aucune autre trace écrite** que le prompt supprimé à
> la livraison. Aucun n'est traité.

1. **`process_recap_transactions` n'a aucun filtre de date.** La RPC filtre sur
   le propriétaire, `applied_to_balance_at`, `is_carried_over` et
   `contribution_id`, jamais sur `expense_date` / `entry_date` : elle traite
   **toutes** les lignes du propriétaire. Sa seule protection est le portier, qui
   empêche de créer des transactions du nouveau mois avant clôture — une
   garantie de **timing**, pas de structure. Vérifié empiriquement le 2026-07-05 :
   aucune ligne du mois suivant touchée. Ajouter un filtre changerait le
   comportement de report des transactions anciennes → **arbitrage produit
   requis**. À documenter comme invariant explicite a minima. Version courante :
   `20260705000000_exempt_contribution_mirrors_from_recap_transactions.sql`.
2. **Pas de relance du récap groupe vers le récap perso.** Après un récap perso
   terminé, l'utilisateur est invité à enchaîner sur celui du groupe ; la
   réciproque n'existe pas. Quelqu'un qui ne fréquente que `/group-dashboard` ne
   sera jamais relancé pour son récap perso — c'est le chemin le plus probable
   vers un bilan abandonné (§1). Commentaire d'origine dans `RecapWizard.tsx`
   (~l. 53-61), marqué « followup candidate ». Option « empêcher que ça arrive »
   explicitement écartée au profit du remboursement lors de l'arbitrage du
   2026-09-01 — reste ouverte.
3. **Tests gated en échec** (`SUPABASE_RECAP_TESTS=1`) : **17 au 2026-09-01**
   (19 annoncés au 2026-07), sur 7 fichiers. Cause dominante : ces tests
   (sprint 07) supposent `bilan = −2 × Σ estimated_amount` pour un profil vierge,
   alors que la formule actuelle donne **−1 ×** — symptôme typique : un
   `400 overflow` là où un `200` est attendu, le déficit valant la moitié de ce
   qui est semé. Répartition : `refloat-from-savings` 5, `save-budget-snapshot` 4,
   `refloat-from-piggy` 3, `refloat-from-projects` 2, `update-salaries` 1,
   `transform-remaining-surpluses-to-savings` 1. Un cas à part :
   `check-status.test.ts` compare un horodatage `'…Z'` à `'…+00:00'` (format
   PostgREST), sans rapport. Ces tests **ne tournent pas** dans `pnpm verify`
   (variable d'env requise) : ils sont silencieusement rouges depuis longtemps.
   Chantier à part entière.
4. **Flakiness sous charge parallèle.** Le jeu d'échecs varie d'une exécution à
   l'autre sur des fichiers non modifiés (résidu de mock, cf. mémoire projet
   `project_flaky_expenses_add_logic_test`). **Toujours revérifier un échec en
   isolation avant de le croire réel.**
5. **Verrue d'historique assumée.** Le commit `3600c20` importe
   `@/lib/recap/period` alors que le fichier n'arrive qu'en `19291a6` : pris
   isolément, `3600c20` ne compile pas, et un `git bisect` qui s'y arrête
   échouera. La branche est cohérente **à son sommet**. Réparer imposerait de
   réécrire de l'historique publié → **ne pas y toucher**, juste le savoir.

**Bug annexe repéré** : `scripts/start-recap.mjs:13-14` importe `CURRENT_MONTH` /
`CURRENT_YEAR` depuis `scripts/seed-recap/_lib.mjs`, qui n'exporte que
`RECAP_MONTH` / `RECAP_YEAR` → l'import nommé ESM échoue au link, le script est
cassé. Non corrigé (hors périmètre).

## 5. Recettes opérationnelles (rapatriées du prompt supprimé)

**Diagnostic — lister les bilans encore ouverts** (lecture seule, sans risque) :

```sql
SELECT id, profile_id, group_id, recap_month, recap_year, current_step,
       refloated_from_piggy, refloated_from_savings, abandoned_at, started_at
FROM monthly_recaps
WHERE completed_at IS NULL AND abandoned_at IS NULL
ORDER BY recap_year DESC, recap_month DESC;
```

```powershell
# dev
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
node scripts/apply-sql.mjs <fichier.sql>
$env:SUPABASE_PROJECT_REF = $null
# prod (défaut)
node scripts/apply-sql.mjs <fichier.sql>
```

⚠️ `apply-sql.mjs` exécute **n'importe quel** SQL via l'API Management. S'y
limiter à des `SELECT` tant qu'une écriture n'a pas été validée par
l'utilisateur. Astuce de test sans résidu : encapsuler le scénario dans un
`DO $$ … $$` terminé par un `RAISE EXCEPTION` portant les assertions — tout est
rollbacké et le message revient dans la réponse HTTP 400.

**Reproduire un bilan abandonné** :

```powershell
node scripts/seed-recap/_reset.mjs
node scripts/seed-recap/deficit-medium-cascade-savings.mjs   # bilan négatif, tirelire garnie
# dérouler le wizard jusqu'au renflouement tirelire, PUIS s'arrêter
# simuler le passage au mois suivant :
#   UPDATE monthly_recaps SET recap_month = recap_month - 1 WHERE id = '<id>';
# recharger /dashboard → nouveau bilan proposé, l'ancien remboursé + archivé
```

⚠️ Les seeds répliquent `getRecapPeriod()` **à la main** dans
`scripts/seed-recap/_lib.mjs` (ce sont des `.mjs`, ils ne peuvent pas importer le
module TS). Toute évolution de `getRecapPeriod` doit y être répercutée, sinon les
37 scénarios redeviennent invisibles pour l'app. `seedRecapRow` code en dur
`RECAP_MONTH` / `RECAP_YEAR` : pour seeder une période antérieure, faire un
`UPDATE` post-insert (aucun paramètre de période n'est exposé aujourd'hui).

**Tests gated** (créent et détruisent de vrais comptes Supabase — **dev
uniquement**, vérifier que `.env.local` pointe bien sur `ddehmjucyfgyppfkbddr`) :

```powershell
$env:SUPABASE_RECAP_TESTS = '1'
pnpm vitest run lib/recap app/api/monthly-recap
```
