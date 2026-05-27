# Monthly Recap V3 — dev seed scripts

Scripts CLI pour seeder la **DB dev (`ddehmjucyfgyppfkbddr`)** avec un scénario précis du Monthly Recap V3, puis tester l'UX réelle de bout en bout (login → dashboard → wizard → retour dashboard) en navigateur.

> **1 script = 1 scénario.** Re-run = idempotent (cleanup + re-seed). Aucun écrit en prod possible (garde-fou hardcodé dans `_lib.mjs`).

## Pré-requis (1 fois)

### Comptes dev

| Rôle                                           | UUID `profiles.id`                     | Email                      |
| ---------------------------------------------- | -------------------------------------- | -------------------------- |
| **A** — compte QA principal (login navigateur) | `0679b0f9-830a-44e5-aecf-f8452c8dd101` | `gilles.pothieu@gmail.com` |
| **B** — co-équipier groupe                     | `bb53b671-812d-422c-a786-09ee515b680b` | `b.pothieu@gmail.com`      |
| **Groupe G** (contient A et B)                 | `92dbf6f2-7aa1-4f63-b31c-b85c57e3657e` | —                          |

Ces 3 IDs sont **hardcodés** dans `_lib.mjs`. Si tu changes de compte dev, édite `_lib.mjs`.

**Sanity check** : les scripts groupe lancent automatiquement `ensureGroupMembership()` qui vérifie que A et B ont bien `group_id = G`. Si ce n'est pas le cas, le script throw avec le SQL correctif à appliquer.

### Variable d'environnement

Ajoute cette ligne à `.env.local` à la racine du repo :

```
SUPABASE_DEV_SERVICE_ROLE_KEY=<service_role key du projet dev ddehmjucyfgyppfkbddr>
```

⚠️ Cette clé est **distincte** de `SUPABASE_SERVICE_ROLE_KEY` qui peut pointer sur la prod selon ta config. Récupère la dev key ici :

```
https://supabase.com/dashboard/project/ddehmjucyfgyppfkbddr/settings/api
```

Le `_lib.mjs` charge automatiquement `.env.local` (pas besoin de dotenv installé).

### Sécurité

Le `_lib.mjs` **refuse** de tourner si :

- `SUPABASE_DEV_SERVICE_ROLE_KEY` est manquant → exit 1 avec instructions
- La clé service_role contient le ref du projet prod (`jzmppreybwabaeycvasz`) dans son payload JWT → exit 1

Aucun risque d'écrire en prod par erreur. L'URL Supabase est hardcodée (`https://ddehmjucyfgyppfkbddr.supabase.co`) et ignore `NEXT_PUBLIC_SUPABASE_URL`.

## Workflow type

```powershell
# 1. Choisir un scénario et le seeder
node scripts/seed-recap/happy-surplus-light.mjs

# Output:
# 🧹 Cleanup: 05/2026 for A=gilles.pothieu@gmail.com
# ✅ Cleanup done
# ✨ Scénario "happy-surplus-light" seedé
# 👤 User QA : gilles.pothieu@gmail.com (mot de passe dev habituel)
# 🌐 URL à ouvrir : http://localhost:3000/dashboard
# ...

# 2. Lancer le dev server (si pas déjà lancé)
pnpm dev

# 3. Ouvrir le navigateur (privé recommandé pour éviter le cache cookies recap)
# → http://localhost:3000/dashboard
# → login gilles.pothieu@gmail.com
# → tu es redirigé vers /monthly-recap?context=profile
# → wizard s'affiche au step et état attendu (cf. output du script)

# 4. Dérouler le wizard manuellement, valider chaque étape
# 5. Au "Terminer" → retour dashboard
# 6. Quand tu veux tester un autre scénario, re-run un autre script
#    (chaque script fait son cleanup → pas de cumul)
```

### Reset pur

Pour wipe sans seeder (état "no_recap" propre) :

```powershell
node scripts/seed-recap/_reset.mjs
```

Le `_reset` :

- DELETE la row `monthly_recaps` du mois courant (profile A + group G)
- DELETE toutes les `real_expenses` + `real_income_entries` du mois courant
- DELETE tous les `estimated_budgets` + `estimated_incomes` (profile A + group G)
- Reset `piggy_bank` A + G à 0
- Reset `bank_balances` A à 0
- Reset les `is_carried_over` flags sur les transactions des prior months (au cas où)

Les data des autres mois (sauf les flags carry-over) sont préservées.

### Init recap (sans toucher aux données)

Pour relancer le wizard sur tes **données réelles** (intactes) :

```powershell
node scripts/seed-recap/_init-recap.mjs              # profile A (défaut)
node scripts/seed-recap/_init-recap.mjs --group      # group G uniquement
node scripts/seed-recap/_init-recap.mjs --both       # profile A + group G
```

Le `_init-recap` :

- DELETE **uniquement** la row `monthly_recaps` du mois courant
- **Ne touche pas** : budgets, expenses, incomes, piggy_bank, bank_balances, savings_projects

Le proxy gating détectera "no_recap" → redirect /dashboard vers /monthly-recap → tu cliques "Démarrer" → POST /start recrée la row → wizard se déroule sur tes données réelles.

## Catalogue des scénarios

| Catégorie                   | Key                                          | Contexte | UX attendue                                                                                  |
| --------------------------- | -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| **Positive**                | `fresh-no-budgets`                           | profile  | Wizard "rien à faire" : 0 budget, 0 salaire — skip direct au Final                           |
|                             | `happy-surplus-light`                        | profile  | Bilan +200€ (3 budgets 750€/spent 550€). Propose distribution piggy / savings                |
|                             | `happy-surplus-large`                        | profile  | Bilan +800€ (5 budgets 1200€/spent 400€). Surplus large à distribuer                         |
|                             | `surplus-with-existing-savings`              | profile  | Bilan +190€ avec économies préexistantes (50+100€) — additive                                |
| **Déficit piggy-only**      | `deficit-tiny-piggy-covers`                  | profile  | Déficit -20€, piggy 100€ → tirelire seule suffit, reste 80€                                  |
|                             | `deficit-large-piggy-exact`                  | profile  | Déficit -200€, piggy 200€ → couverture exacte, piggy → 0                                     |
| **Déficit cascade savings** | `deficit-medium-cascade-savings`             | profile  | Déficit -150€, piggy 50€ → reste 100€ via savings (pool 200€)                                |
|                             | `deficit-piggy-empty-savings-suffice`        | profile  | Déficit -100€, piggy 0, savings 300€ → savings seule absorbe                                 |
|                             | `deficit-savings-pool-equal-deficit`         | profile  | Déficit -250€, pool savings exactement 250€ → pool vidé à 0                                  |
| **Déficit cascade full**    | `deficit-cascade-full`                       | profile  | Déficit -500€ : piggy 100€ + savings 100€ + snapshot 300€                                    |
|                             | `deficit-cascade-savings-empty-budgets-only` | profile  | Déficit -400€, tout sur snapshot (rien d'autre)                                              |
|                             | `deficit-cascade-extreme`                    | profile  | Déficit -3500€ sur 5 budgets — overshoot snapshot ~233%/budget (⚠ badges)                    |
| **Projets d'épargne**       | `project-deficit-refloat`                    | profile  | Déficit -700€, 4 projets actifs (dont 1 quasi-fini 95%) — cascade 4 étages exact cover       |
|                             | `project-deficit-stops-before`               | profile  | Déficit -150€, 2 projets actifs intacts — cascade s'arrête après savings (`unneeded`)        |
|                             | `project-deficit-catastrophe`                | profile  | Déficit -4000€, 2 projets drainés à 100% + snapshot overshoot ~470%/budget                   |
| **Groupe**                  | `group-positive-2-members`                   | group    | Bilan groupe +450€ (A+B salaires 2500/2500)                                                  |
|                             | `group-deficit-2-members`                    | group    | Déficit -300€, cascade complète, salary update 2 inputs                                      |
|                             | `group-mixed-salaries`                       | group    | A=3500€/B=1500€, déficit 200€, recalc proportionnel contributions                            |
| **Resume mid-flow**         | `resume-at-summary`                          | profile  | Wizard rouvre directement à l'écran 2 Summary                                                |
|                             | `resume-at-manage-bilan-positive`            | profile  | Wizard rouvre à l'écran 3A (bilan positif)                                                   |
|                             | `resume-at-manage-bilan-negative-half`       | profile  | Wizard rouvre à 3B avec piggy déjà débitée 50€ (reste -150€)                                 |
|                             | `resume-at-salary-update`                    | group    | Wizard groupe rouvre à l'écran 4 (snapshot déjà sauvegardé)                                  |
|                             | `resume-at-final-recap`                      | profile  | Wizard rouvre à l'écran 5 Final (tout est résolu, prêt à finaliser)                          |
| **Transactions mix**        | `transactions-mixed-validated`               | profile  | 10 dépenses (6 applied / 4 non) + 3 incomes (2/1) — applied DELETE, non-validated carry-over |
|                             | `transactions-all-validated`                 | profile  | 6 dépenses + 1 income tous validés → tous DELETE au complete                                 |
|                             | `transactions-all-non-validated`             | profile  | 5 dépenses + 1 income non validés → tous carry-over (badge "Reporté")                        |
| **Edge cases**              | `edge-empty-piggy-surplus-zero`              | profile  | Salaire 2500€ mais 0 budget — wizard "rien à arbitrer"                                       |
|                             | `edge-balance-exact-zero`                    | profile  | Spent = estimated exactement → bilanSign='zero'                                              |
|                             | `edge-already-completed`                     | profile  | Recap déjà completed → /dashboard render direct, pas de wizard                               |
|                             | `edge-locked-by-other`                       | group    | Recap claimé par B → A voit l'écran "Verrouillé par B"                                       |

## Troubleshooting

### "Je clique sur /dashboard mais ne suis pas redirigé vers /monthly-recap"

C'est le cache cookie `recap-ok-{ctx}-{Y}-{M}` (httpOnly, 5 min). 3 solutions :

1. **Recommandé** : ouvre une fenêtre de navigation **privée** (cookies isolés)
2. Clear les cookies du domaine `localhost:3000` via DevTools → Application → Cookies
3. Attends 5 minutes (le cache expire naturellement)

Le cookie est posé par le proxy quand `status === 'completed'`. Après un reset, le cookie n'est pas effacé automatiquement (les scripts CLI ne peuvent pas toucher les cookies du navigateur).

### "Le wizard ne s'affiche pas au step attendu"

Vérifie le retour de `seedRecapRow` dans les logs du script. Si la ligne `monthly_recaps` a bien été créée mais le wizard est à un autre step, c'est probablement que l'UI a fait avancer le step après /start. Re-lance le script (re-cleanup → re-seed propre).

### "Group scenario : ensureGroupMembership a thrown"

A ou B n'est plus dans le groupe G. Le script affiche le SQL correctif :

```sql
UPDATE profiles SET group_id = '92dbf6f2-7aa1-4f63-b31c-b85c57e3657e'
WHERE id IN ('0679b0f9-830a-44e5-aecf-f8452c8dd101','bb53b671-812d-422c-a786-09ee515b680b');
```

Applique via le Supabase Dashboard → Table Editor → profiles, puis re-lance le script.

### "RPC `calculate_group_contributions` failed"

L'appel au RPC après `setProfileSalary` est en `console.warn` (non bloquant). Le trigger DB recalcule probablement déjà via `groups_budget_contribution_recalc`. Si les `group_contributions` ne sont pas à jour après le seed, regarde le warning et confirme manuellement (Table Editor).

### "Pour les scénarios resume-at-X, le snapshot semble vide ou faux"

Le format `budget_snapshot_data` est `{ [budgetId]: amountToDraw }` (cf. `lib/recap/actions-finalize.ts`). Les scripts `resume-at-salary-update` et `resume-at-final-recap` construisent ce blob depuis le Map des budgets seedés. Si le UI ne reflète pas, vérifier que la spec sprint 07 (save-budget-snapshot) n'a pas évolué.

## Architecture

```
scripts/seed-recap/
├── README.md                    ← ce fichier
├── _lib.mjs                     ← supabase client dev-only + 15 helpers
├── _reset.mjs                   ← wipe pur sans seed
└── <scenario-key>.mjs           ← 27 scripts (1 par scénario)
```

### `_lib.mjs` exposes

- `supabase` (service-role client dev-only)
- `USER_A_ID` / `USER_A_EMAIL` / `USER_B_ID` / `USER_B_EMAIL` / `GROUP_ID`
- `CURRENT_MONTH` / `CURRENT_YEAR` / `CURRENT_MONTH_START` / `CURRENT_MONTH_END`
- `cleanupCurrentMonth({ profile, group })`
- `ensureGroupMembership()`
- `insertProfileBudgets(profileId, [{ name, estimated_amount, cumulated_savings? }, ...])` → `Map<name, id>`
- `insertGroupBudgets(groupId, ...)` → `Map<name, id>`
- `insertProfileExpenses(profileId, budgetIdsByName, [{ budget_name, amount, applied?, is_carried_over?, ... }, ...])`
- `insertGroupExpenses(groupId, budgetIdsByName, [...], { createdByUserId })`
- `insertProfileIncomes(profileId, [{ name, estimated_amount }, ...])`
- `insertGroupIncomes(groupId, [...])`
- `insertProfileRealIncomes(profileId, [{ amount, description, applied?, is_exceptional?, is_carried_over? }, ...])`
- `insertGroupRealIncomes(groupId, [...], { createdByUserId })`
- `setPiggy({ profile_id|group_id }, amount)`
- `setBank({ profile_id }, balance)`
- `setProfileSalary(userId, salary)` (recompute group_contributions si profile.group_id)
- `seedRecapRow({ context, contextId, currentStep, refloatedFromPiggy, refloatedFromSavings, budgetSnapshotData, completedAt, ... })`
- `printPostSeedInstructions({ scenarioKey, context, expectedUrl, expectedBehavior, expectedFigures, cookieHint })`
- `runScenario(name, asyncFn)` (wrapper try/catch + exit 1)

## Pour ajouter un nouveau scénario

1. Crée `scripts/seed-recap/<my-new-key>.mjs` en copiant un existant comme template
2. Adapte le cleanup + setters + inserts
3. Si tu seedes une row `monthly_recaps` directement, utilise `seedRecapRow`
4. Update `printPostSeedInstructions` avec l'UX attendue
5. Ajoute la ligne dans le tableau ci-dessus + dans `CLAUDE.md` §5 si pertinent

## Hors-scope intentionnel

- **Pas de tests automatisés** sur ces scripts (`.mjs` non typecheck, pas de gated tests). C'est de l'outillage QA manuel, le ROI test est faible. Le seul test = `node scripts/seed-recap/X.mjs` exit 0 et l'UX en navigateur.
- **Pas de page `/dev/recap`** ni de routes `/api/debug/recap/*` (le prompt original les prévoyait, le pivot CLI les a rendues inutiles).
- **Pas de support multi-membres > 2** (le user a explicitement scopé à 2 membres max par groupe).
