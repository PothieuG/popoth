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
3. **Tests gated — RÉSOLU le 2026-09-01** (voir §6). Les 17 rouges décrits ici
   ont été réparés dans la foulée du sprint : la suite récap est passée à
   266/266. Les 5 autres suites gated ont été vérifiées dans la même passe.

4. **Flakiness sous charge — RÉSOLUE le 2026-09-01** (voir §7). La cause
   n'était pas un résidu de mock irréparable mais l'absence de `testTimeout`
   dans `vitest.config.ts` (défaut 5 s).

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

## 6. Suite — réparation des tests gated (2026-09-01)

Demandée par l'utilisateur juste après la livraison du sprint. La suite récap
gated passe de **17 rouges / 7 fichiers** à **266 verts / 24 fichiers**. Quatre
causes distinctes, et non la seule « formule du bilan » annoncée :

1. **Formule du bilan périmée** (la cause majoritaire). Ces tests du sprint 07
   figeaient l'ancienne formule — `bilan = ravEffectif + ravEstime` (donc
   `-2 × Σ estimated` pour un profil vierge) dans `refloat-from-piggy` /
   `-savings` / `save-budget-snapshot`, et `ravEffectif - ravEstime` dans
   `refloat-from-projects`. Depuis Bilan-Equals-RavEffectif, `bilan =
ravEffectif` tout court. Seeds et pré-crédits `refloated_from_piggy`
   recalibrés pour viser le **même déficit** qu'à l'origine : les intentions de
   test sont préservées, seules les valeurs d'entrée changent.
2. **Fixture menteuse** dans `refloat-from-projects` : `new Date(y, m, 1)
.toISOString()` recule d'un jour en UTC+N (le 1er août à Paris devient
   `2026-07-31Z`). La dépense sortait de la fenêtre du mois recapé et ne créait
   **aucun** déficit — le test vérifiait donc autre chose que ce qu'il
   annonçait. Date désormais construite en chaîne directe, au 15 du mois.
   ⚠️ Le même motif subsiste dans `actions-finalize-projects.test.ts` (deadlines
   à +1 an, sans conséquence aujourd'hui) — à ne pas propager.
3. **Comportements changés volontairement, que les tests contredisaient** :
   - le snapshot budget ne laisse plus de `shortfall` (`capPerPool: false`,
     Sprint Carryover-Self-Healing) mais **surcharge** les budgets au-delà de
     leur enveloppe. Le cas a été réécrit pour pinner cette bascule ; obtenir un
     déficit supérieur au pool passe par `carryover_spent_amount`, seul levier
     qui creuse le déficit sans gonfler le pool (`estimated_amount`).
   - le recalcul des contributions n'est plus gaté sur `context === 'group'`
     mais sur l'appartenance à un groupe (sprint 14 follow-up). Cas corrigé, et
     **ajout du cas « appelant sans groupe »** — la branche `false` n'était
     couverte nulle part.
4. **Fuite d'isolation** dans `transform-remaining-surpluses-to-savings` : le
   `afterEach` remettait `profiles.salary` à `null` sans effet ni vérification
   d'erreur, si bien qu'un salaire de 1000 fuyait sur le test suivant — lequel
   balayait 700 € vers la tirelire en croyant son reste à vivre négatif. Il
   passait **en isolation** et échouait en fichier complet. Reset à `0` (le
   DEFAULT de la colonne) et erreur propagée.

Plus une comparaison d'horodatage `'…Z'` vs `'…+00:00'` (format PostgREST, même
instant) alignée sur le pattern déjà en place dans `start/route.integration`.

### Les 5 autres suites gated

`SUPABASE_RLS_TESTS`, `_API_TESTS`, `_TRIGGER_TESTS`, `_FINANCE_TESTS` : vertes.
`SUPABASE_RPC_CONCURRENCY_TESTS` a révélé deux choses :

- **Fixture périmé** dans `toggle-applied-to-balance` : il insérait une dépense
  appliquée **sans** `last_applied_amount` (colonne arrivée avec
  Contribution-Drift 2026-05-28). La RPC voyait une dérive de montant et partait
  en branche « re-apply au nouveau montant » au lieu de lever `P0002`. Aucun
  chemin applicatif ne produit cet état, et la prod n'a aucune ligne concernée.
- **RPC morte ET cassée** : `transfer_piggy_to_budget_with_insert` (2026-05-19)
  INSERT dans `budget_transfers.monthly_recap_id`, colonne supprimée 4 jours plus
  tard par `20260523000001_drop_legacy_recap_tables.sql`. Elle levait donc une
  exception à **chaque** appel depuis le 2026-05-23 — invisible car 0
  consommateur applicatif (le flux Phase-B a disparu au même sprint) et son seul
  test vit dans une suite que `pnpm verify` ne joue pas. **Décision utilisateur :
  supprimer** (Path B closed-by-deletion). Migration `20260901000002`, helper et
  test retirés, `EXPECTED_RPCS` 29 → 28.

### Leçon

Une suite de tests qu'aucune commande de routine ne joue dérive en silence, et
la dérive n'est pas homogène : sur 20 échecs, 1 seul (la RPC cassée) était un
vrai défaut produit, mais 2 fixtures **mentaient** — ils passaient ou échouaient
pour la mauvaise raison. Envisager de faire tourner les suites gated
périodiquement (cron hebdomadaire), sans forcément les rendre bloquantes.

## 7. Fin de la « flakiness sous charge » (2026-09-01)

Six fichiers échouaient par intermittence en suite complète et passaient
systématiquement en isolation. Le diagnostic hérité — « résidu de mock, pas un
vrai bug, non corrigeable sans réécrire les mocks en dispatch par table » —
était **incomplet, et sa conclusion fausse**.

En capturant la sortie complète d'un run sous charge (plutôt que la seule liste
des noms), le mécanisme saute aux yeux : le **premier** test de chaque fichier
touché échoue en `Test timed out in 5000ms`, et ce sont les tests **suivants**
qui portent les assertions bizarres (`from_budget` 20→50, `toHaveBeenCalledTimes(1)`
→ 2).

Chaîne causale :

1. `vitest.config.ts` ne définissait **aucun `testTimeout`** → défaut 5 s.
2. Ces tests importent le module sous test DANS le premier `it`
   (`await import(...)` APRÈS les `vi.mock`, obligatoire pour que les mocks
   prennent). Cette première transformation Vite à froid dépasse 5 s dès que les
   workers se disputent le CPU — typiquement quand les suites gated tapent
   Supabase en parallèle.
3. Vitest abandonne le test, mais **la route continue de tourner** en arrière-plan
   et consomme les `mockResolvedValueOnce` de la file.
4. `afterEach` faisait `vi.restoreAllMocks() + vi.clearAllMocks()` — or
   `clearAllMocks` ne **vide pas** la file `once`. Le test suivant héritait donc
   de valeurs décalées.

Correctif, minimal :

- `testTimeout` et `hookTimeout` à **30 s** dans `vitest.config.ts`.
- `afterEach` → **`vi.resetAllMocks()`** dans les 7 fichiers concernés. Vérifié
  empiriquement en Vitest 4 : il vide la file `once` **et** préserve
  l'implémentation passée à `vi.fn(impl)` — les deux propriétés nécessaires.

⚠️ **Piège** : dans ces fichiers, `chain.then` doit rester une **fonction simple**,
jamais un `vi.fn()`. Un reset sur un `then` mocké casse l'`await` sur la chaîne
thenable et fait _pendre_ la suite — c'est ce qui avait fait abandonner une
tentative de durcissement en `beforeEach` en juin 2026. Un `afterEach` +
`resetAllMocks` n'a pas ce problème puisque `then` n'est pas un mock.

Résultat : suite complète + gated concurrence jouée 3 fois de suite → **967
verts, 0 échec**. Les 6 suites gated sont vertes (récap 1041, RLS 919, API 925,
triggers 924, finance 955, concurrence 967).

### Deux défauts annexes corrigés dans la foulée

- `scripts/start-recap.mjs` importait `CURRENT_MONTH` / `CURRENT_YEAR` de
  `scripts/seed-recap/_lib.mjs`, qui n'exporte que `RECAP_MONTH` / `RECAP_YEAR` :
  l'import nommé ESM échouait au link, le script était cassé de bout en bout.
- `actions-finalize-projects.test.ts` portait encore le motif
  `new Date(y, m, d).toISOString()` (décalage d'un jour en UTC+N). Sans
  conséquence — le 15 reste dans le mois — mais aligné sur la construction en
  chaîne directe pour ne pas le propager.

### Leçon

Quand un test « flake sous charge », lire la sortie **complète** avant de
conclure : ici le premier échec était un timeout, et tous les autres n'en
étaient que la conséquence. Le diagnostic partiel avait coûté trois mois de
contournement (« relance en isolation ») pour un correctif de deux lignes de
configuration.

## 8. Tri des vulnérabilités (2026-09-01)

GitHub annonçait 42 alertes Dependabot sur la branche par défaut ; `pnpm audit`
en comptait **39** (1 critique, 26 hautes, 11 modérées, 1 basse). Le tri utile
n'est pas la sévérité brute mais **ce qui atteint l'exécution** :

- **Une seule touchait la production** : `next@16.2.6`, avec 9 avis (4 hautes +
  5 modérées) tous corrigés en **≥ 16.2.11**. Dont « Middleware / Proxy bypass
  in App Router », directement pertinent ici puisque `proxy.ts` porte le gating
  du récap, plus deux SSRF via Server Actions / rewrites. Monté en **16.2.12**
  (patch, même mineure), `eslint-config-next` aligné (livré en lockstep).
- **Les 30 autres sont de l'outillage build/test** (tar, brace-expansion, vite,
  nanoid, form-data, @babel/core, js-yaml, postcss, fast-uri) : rien n'atteint
  le navigateur ni le serveur. Le `tar` « critique » est un DoS de décompression
  dans un outil qui ne tourne qu'à l'install.
- **`sharp` était le cas limite** : la devDep sert au script `pwa:assets`, mais
  `next` en embarquait aussi une copie 0.34.5 pour l'optimisation d'images —
  donc côté serveur de production. Traité par override `^0.35.4`. Contrôle :
  `pnpm pwa:assets` régénère les 14 assets **au bit près** (0 fichier modifié).

Constat de fond : **les overrides posés en mai avaient dérivé**. Ils pinnaient la
version corrective de l'époque, et de nouveaux avis ont depuis relevé la barre
(`brace-expansion@1` ^1.1.13 → ≥1.1.18, `js-yaml` ^4.1.1 → ≥4.3.1, `postcss`
^8.5.10 → ≥8.5.23, `fast-uri` ^3.1.2 → ≥3.1.5). Un override n'est pas un
correctif définitif : il fige un plancher qui vieillit.

**Piège pnpm rencontré** : l'override sur `vite` **ne prenait pas**, deux
installs de suite. Raison — `vite` n'est qu'un _peer_ de vitest, auto-installé,
et les overrides ne contraignent pas ce cas. Seule la déclaration explicite en
`devDependencies` (`vite: ^8.0.16`) force la résolution. À retenir pour toute
future alerte sur un peer auto-installé.

Effet de bord assumé et corrigé : vite 8.2.2 avertit à chaque run que
`vitest.config.ts`, chargé en CommonJS faute de `"type": "module"`, utilise de
la syntaxe ESM. Fichier renommé **`vitest.config.mts`** et `__dirname` dérivé de
`import.meta.url` via `fileURLToPath` (et non `import.meta.dirname`, qui exige
Node 20.11 alors que `engines.node` autorise 20.10). Références mises à jour
dans `code-checks.yml` (2 filtres de chemin) et CLAUDE.md.

**Résultat : 39 → 0 avis.** Validé par `pnpm verify` (exit 0), `pnpm build`
(45 routes, invariant tenu), et un smoke runtime du serveur dev
(`/connexion` 200, `/dashboard` 307).
