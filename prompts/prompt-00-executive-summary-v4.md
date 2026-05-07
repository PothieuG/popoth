# Sprint Hardening — type-safety unwind, ghost tables, deferred decisions

## Contexte

Le **Sprint Refactor** ([prompt-00-executive-summary-v3.md](prompt-00-executive-summary-v3.md), exécuté le 2026-05-07) a livré 6 commits sur `cleanup` (`5efacfe → ab58db2`) :

- R1 — suppression de 11 routes `populate-*` cassées
- R2 — `createClient<Database>(...)` activé sur `lib/supabase-server.ts` + `lib/supabase-client.ts` + les fixtures Vitest
- R3 — migration de dédup (6 indexes, 1 FK, 3 CHECKs dupliqués + 1 CHECK buggy NULL-hole sur `budget_transfers`)
- R4 — `pnpm db:check-drift` (détecteur de drift prod ↔ baseline)
- R0 — post-mortem du drift C3 ([docs/audit/POST-MORTEM-C3-DRIFT.md](../docs/audit/POST-MORTEM-C3-DRIFT.md))
- R6 — tests RLS D2/D3 + drop d'une SELECT policy récursive sur `profiles` qui causait `42P17 infinite recursion`

Score audit estimé : **~62-65/100**.

Ce sprint a aussi laissé **4 dettes documentées** et a découvert **2 angles morts** non couverts par les sprints planifiés (Sprint 1, I4, I5, console.log, Zod). Le **Sprint Hardening** referme ces points avant qu'ils ne se transforment en bugs ou en code mort.

---

### 🟠 Bloc H1 — R2 scope-cast unwind (DETTE PRINCIPALE)

R2 a forcé un cast `as unknown as SupabaseClient` (sans le générique `<Database>`) dans **17 fichiers** parce que le wirage initial faisait remonter ~90 erreurs TS dont la majorité étaient :
1. des `string | null` (group_id nullable) injectés dans `.eq('group_id', ...)` qui exige `string`
2. des `number` (recap_year, recap_month) injectés dans des params qui exigent `string`
3. des shapes locales (`GroupMember`, `SearchableGroup`, `GroupContributionData`, `ProfileData`, `RemainingToLiveSnapshot`) qui divergent des row types générés (`created_at: string | null` vs `string`)

Les casts portent un commentaire `// Tracked as a follow-up`. Conséquence :
- **Le bénéfice de `<Database>` n'est PAS effectif** dans la majorité des routes API. Les colonnes/tables incorrectes ne sont plus détectées dans ces fichiers.
- **Bug réel découvert pendant R2** : `app/api/finances/expenses/progress/route.ts` lisait une colonne `current_savings` inexistante (la vraie colonne est `cumulated_savings`). Le dashboard affichait toujours 0 d'économies. Corrigé en R2. **Il en reste probablement d'autres** dans les fichiers scope-cast.

**Fichiers à délivrer du cast** (par taille croissante d'erreurs) :

| Fichier | Erreurs (hors `<Database>`) | Nature |
|---|---|---|
| `app/api/bank-balance/route.ts` | 1 | nullable group_id |
| `app/api/budgets/route.ts` | 1 | shape Insert |
| `app/api/incomes/route.ts` | 1 | shape Insert |
| `app/api/groups/search/route.ts` | 1 | SearchableGroup |
| `app/api/groups/contributions/route.ts` | 1 | GroupContributionData |
| `app/api/groups/[id]/members/route.ts` | 1 | GroupMember |
| `app/api/groups/route.ts` | 4 | GroupData |
| `app/api/profile/route.ts` | 6 | ProfileData |
| `app/api/finances/dashboard/route.ts` | 7 | aggrégats nullables |
| `app/api/monthly-recap/initialize/route.ts` | 3 | nullable owner |
| `app/api/monthly-recap/resume/route.ts` | 4 | num→str |
| `app/api/monthly-recap/auto-balance/route.ts` | 5 | nullable + payload |
| `app/api/monthly-recap/transfer/route.ts` | 5 | nullable + num→str |
| `app/api/monthly-recap/refresh/route.ts` | 7 | nullable + num→str |
| `app/api/monthly-recap/complete/route.ts` | 15 | les deux + globals |
| `app/api/monthly-recap/recover/route.ts` | dynamic table | helper `restoreTable(tableName, ...)` |

**Stratégie recommandée** :
- Commencer par les 6 singletons (chacun 1 erreur), un commit par fichier ou un commit groupé.
- Les routes `groups/*` partagent le pattern "shape locale diverge du row type" — la fix consiste à aligner les shapes locales sur les row types générés (`Tables<'profiles'>`, etc.) ou à narrow `?? undefined` à la frontière.
- Pour `recap/*` : narrow `if (!groupId) return ...` avant le `.eq(...)`. Pour les `number→string`, vérifier si la colonne est vraiment `string` (UUID) ou `number` (recap_year, recap_month) côté DB — il y a probablement un appel `.eq('recap_year', someNumber)` où la signature attend string parce qu'on filtre sur la mauvaise colonne.
- Pour `recover/route.ts` : remplacer `restoreTable(tableName: string, ...)` par un `switch` sur les 8 tables littérales (`'estimated_incomes' | 'estimated_budgets' | ...`). Refactor mécanique, ~50 LOC ajoutées.

**Hors-scope du H1** :
- `lib/financial-calculations.ts` (god file, chantier I4) — laisser scope-cast.
- `app/api/monthly-recap/process-step1/route.ts` (god route, chantier I5) — laisser scope-cast.
- `app/api/debug/{quick-test, recap-data, test-balance}/route.ts` — debug only, laisser scope-cast (ou supprimer si inutilisés, suivant la politique R1).

**Critère de complétion H1** : `grep -r "as unknown as SupabaseClient" app/api/ lib/database-snapshot.ts | wc -l` ≤ 5 (les 4 god/debug + 1 dynamic helper).

### 🟠 Bloc H2 — Table fantôme `financial_snapshots` (correctness)

[lib/database-snapshot.ts](../lib/database-snapshot.ts:72) interroge une table `financial_snapshots` qui **n'existe pas** dans le schéma prod (absente de `lib/database.types.ts`, absente du baseline `20260101000000_remote_schema.sql`). L'erreur est silencieusement avalée par `checkError()`. Cette fonction est appelée par `app/api/monthly-recap/initialize/route.ts` à chaque démarrage de récap mensuel.

**Trois questions à trancher** :
1. La table a-t-elle existé puis été droppée hors migration ? Vérifier l'historique git de `database-snapshot.ts` (commit qui a introduit la query) et chercher une migration qui la définissait.
2. La table était-elle planifiée mais jamais créée ? Si oui, soit la créer (avec une migration + RLS service-role-only puisque c'est un cache), soit retirer la query.
3. Y a-t-il une logique applicative qui dépend du contenu de `financialSnapshots.data` ? Grep `financialSnapshots\.` dans le repo. Si le tableau est consulté ailleurs, on doit décider quoi faire ; sinon, le retrait est trivial.

**Action recommandée si la table n'a jamais existé** : retirer le bloc `financial_snapshots` (lignes 71-74, 114, 131) de `lib/database-snapshot.ts`, retirer le scope-cast (le fichier devrait alors compiler avec `<Database>`), commit.

### 🟡 Bloc H3 — R5 carryover : `bank_balances.balance >= 0` (intent)

Reporté du Sprint Refactor par décision utilisateur. Le baseline contient `bank_balances_balance_check CHECK (balance >= 0)`. À trancher :
- Si l'overdraft est interdit côté métier → garder la CHECK + ajouter un test Vitest qui débite > balance et vérifie que la route retourne une erreur propre (pas un 500 silencieux).
- Si l'overdraft est autorisé → migration `<ts>_drop_balance_check.sql`, mettre à jour CLAUDE.md + tests.

Test à exécuter avant décision : créer un profile avec `bank_balances.balance = 100`, débiter `200` via le flux dépense réelle (`/api/finances/expenses` ou équivalent), observer le comportement. Le ressenti devrait clarifier l'intention.

### 🟡 Bloc H4 — `pnpm db:check-rpcs` (close R4 blind spot)

Le post-mortem ([docs/audit/POST-MORTEM-C3-DRIFT.md](../docs/audit/POST-MORTEM-C3-DRIFT.md)) note que `db:check-drift` ne couvre **pas** le drift au niveau RPC parce que `scripts/export-schema.mjs` exclut volontairement les fonctions. Le filet actuel pour le drift RPC est la suite gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` — utile mais nécessite de tourner manuellement.

Ajouter `scripts/check-rpcs.mjs` :
- Liste les RPCs attendues : `update_piggy_bank_amount`, `update_bank_balance`, `update_budget_cumulated_savings`, `transfer_from_piggy_to_budget` (les 4 de C3, augmentées dans `lib/database.ts`).
- Pour chacune, query `pg_proc` via Management API : `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '<rpc_name>'`.
- Exit 1 si une RPC manque, en imprimant le nom + le chemin de la migration qui la définit.
- Wirer comme `pnpm db:check-rpcs` dans `package.json`.

C'est un script de ~80 LOC qui aurait détecté le drift C3 en 2 secondes.

### 🟢 Bloc H5 — GitHub Actions cron pour `db:check-drift` (durable)

Mentionné en hors-scope dans le commit R4. Workflow simple :

```yaml
# .github/workflows/db-drift-check.yml
on:
  schedule: [{ cron: '0 8 * * 1' }]  # lundi matin
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:check-drift
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: 'DB drift detected',
              body: `\`pnpm db:check-drift\` returned exit 1 on ${new Date().toISOString()}. See run ${context.runId}.`
            })
```

Demande au user de configurer le secret `SUPABASE_ACCESS_TOKEN` dans Settings → Actions → Secrets. Si pas de Github Actions actif sur ce repo, ce bloc devient un follow-up.

### 🟢 Bloc H6 — Trigger investigation (forensique légère)

Pendant R6, on a découvert qu'un trigger crée automatiquement un row `group_contributions` quand un profile est lié à un group (le test a dû passer en `upsert` à cause d'un conflit `(profile_id, group_id)`). Le trigger n'est **pas dans le baseline** parce que `scripts/export-schema.mjs` ne capture que les triggers du schéma `public`.

Investigation à mener :
1. Query `pg_trigger` dans tous les schemas pour repérer le trigger : `SELECT n.nspname, t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND (c.relname LIKE '%profile%' OR c.relname LIKE '%group%')`.
2. Décider : (a) capturer les triggers cross-schema dans `export-schema.mjs` (le détecteur de drift ne les voit pas non plus aujourd'hui), ou (b) documenter le trigger dans `docs/db/SCHEMA.md` à la main.

Faible priorité mais ferme une boîte noire dans la doc.

---

## Fichiers à analyser en priorité

- **17 fichiers scope-cast** listés en H1 (table). Le grep `as unknown as SupabaseClient` les trouve tous.
- [lib/database-snapshot.ts](../lib/database-snapshot.ts) — H2 (ghost table)
- [supabase/migrations/20260506000000_create_finance_rpcs.sql](../supabase/migrations/20260506000000_create_finance_rpcs.sql) — référence des 4 RPC C3 pour H4
- [lib/database.ts](../lib/database.ts) — augmentation des types pour H4

## Ordre d'exécution recommandé

1. **H4** (db:check-rpcs) — petit script, ferme un trou de sécurité, peut être exécuté avant tout le reste pour valider que les 4 RPC C3 sont toujours là.
2. **H2** (ghost table) — décision rapide à trancher, libère un fichier du scope-cast.
3. **H1** (scope-cast unwind) — le gros morceau. Faire les 6 singletons d'abord (un seul commit), puis les routes `groups/*` (deuxième commit), puis les `recap/*` (3e commit). 3 commits totaux pour H1.
4. **H3** (overdraft) — décision utilisateur d'abord (par AskUserQuestion). Migration éventuelle ensuite.
5. **H5** (GH Actions) — si le repo est branché à Github Actions, sinon report.
6. **H6** (trigger investigation) — bonus.

## Contraintes techniques

- Stack identique : Next.js 16.1.6, React 19.1.1, TS 5 strict, Supabase 2.98.2, pnpm 9.15.5, Vitest 4.1.5.
- **Push gate** identique pour les migrations (H3, éventuellement H4 si on rajoute une RPC) : `pnpm supabase db push --dry-run` → STOP utilisateur → `db push` → re-export baseline → commit.
- `pnpm db:check-drift` doit rester exit 0 après chaque commit qui touche au schéma.
- **`<Database>` doit rester wired** sur les deux clients exportés. H1 désinstrumente uniquement le cast par fichier ; ne pas retirer le générique.
- **Aucun nouveau `as any`**. Préférer `as unknown as Tables<'X'>` quand un cast est inévitable, ou narrow correctement.

## Critères de validation

- `pnpm typecheck && pnpm lint:check && pnpm build && pnpm test:run` à chaque commit.
- `pnpm db:check-drift` exit 0 contre la prod après chaque commit DB-touchant.
- Compteur de `as unknown as SupabaseClient` ≤ 5 après H1 (les 4 god/debug + le helper dynamique de `recover` si on garde le pattern).
- Si H4 est livré : `pnpm db:check-rpcs` exit 0.
- Si H3 est livré côté "drop CHECK" : un test qui débite sous zéro passe (la balance peut aller négative). Si H3 est livré côté "garder CHECK" : un test qui débite trop reçoit une erreur métier propre, pas un 500 brut.

## Risques

1. **H1 surface des bugs cachés**. Le scope-cast a masqué `current_savings`. Il y en a peut-être 1-2 autres planqués dans les routes `recap/*` ou `dashboard`. Plan : si un bug surfacing, l'arrêter au moment où il est révélé, le fix dans le commit du fichier, pas créer une dette de plus.
2. **H3 changement métier** : si l'overdraft est autorisé et qu'on drop la CHECK, des hypothèses ailleurs (UI affichage, logique de transfert) peuvent se casser. Avant la migration, grep `balance < 0`, `Math.abs(balance)`, etc., et ajouter un test de régression.
3. **H6 (triggers cross-schema)** : modifier `export-schema.mjs` pour capturer plus large peut produire un baseline plus volumineux ou inclure des triggers Supabase-managed (auth, storage). Filtrer judicieusement.

## Hors-scope

- Refactor [lib/financial-calculations.ts](../lib/financial-calculations.ts) (chantier I4 séparé).
- Refactor `app/api/monthly-recap/process-step1/route.ts` (chantier I5 séparé).
- Cleanup `console.log` (chantier dédié).
- Rollout Zod (chantier dédié).
- Upgrade `eslint-config-next` 15→16 (Sprint 1 séparé).
- Modifications à [supabase/migrations/20260506000000_create_finance_rpcs.sql](../supabase/migrations/20260506000000_create_finance_rpcs.sql) — corrections via nouvelles migrations seulement.
- Toute écriture via SELECT-then-UPDATE sur les colonnes monétaires — passer obligatoirement par `lib/finance/*`.
- SECURITY DEFINER `current_user_group_id()` pour réintroduire la visibilité cross-membre sur `profiles` — pas demandé tant qu'aucun code browser ne lit `profiles` directement.
