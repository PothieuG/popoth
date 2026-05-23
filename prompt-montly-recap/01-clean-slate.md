# [01] — Clean slate : suppression V1 + V2 du Monthly Recap

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : implémentation V3 du Monthly Recap (processus mensuel obligatoire qui bilan/refloue/met-à-jour salaires/finalise un mois écoulé). La V1 est inerte et la V2 est un stub ossature.
- Position dans la séquence : étape 01/17
- Dépend de : aucune
- Débloque : 02 (migrations) + 03 (state lib)

## Objectif
Faire table rase de tout le code Monthly Recap V1 et V2 (routes API, libs, components, hooks, schémas, dev tools, tables DB) pour repartir d'une base 100% propre. À la fin de cette tâche : aucune trace de monthly recap dans l'app (sauf la ref FK `budget_transfers.monthly_recap_id` qui doit être DROP). Le proxy.ts ne redirige plus vers `/monthly-recap` temporairement (gating réintroduit en sous-tâche 05).

## Fichiers concernés

### À SUPPRIMER (code applicatif)
- `app/monthly-recap/page.tsx` (V2 stub, 82 LOC)
- `app/api/monthly-recap/complete/route.ts` (V2 stub endpoint)
- `app/api/monthly-recap/complete/__tests__/route.integration.test.ts` (V2 tests)
- `app/api/monthly-recap-legacy/` (dossier entier — 14 routes V1, ~2199 LOC)
- `lib/recap/check-status.ts` (V2 status check)
- `lib/recap/index.ts` (V2 barrel)
- `lib/recap-legacy/` (dossier entier — 20 modules V1)
- `components/monthly-recap-legacy/` (dossier entier — 3 composants V1)
- `hooks/legacy/` (dossier entier — hooks V1)
- `lib/schemas/recap.ts` (V2 schema)
- `lib/schemas/recap-legacy.ts` (V1 schemas)
- `lib/recap-snapshot.types.ts` (V2 types) — vérifier d'abord qu'aucun consumer hors recap n'utilise `SnapshotPayload` / `isSnapshotV2()`
- `lib/dev/recap-v2-scenarios.ts` (sera recréé en sous-tâche 09)
- `app/dev/recap-v2/` (dossier entier — page + DevRecapV2Client.tsx)
- `app/api/debug/recap-v2/` (dossier entier — reset, scenarios, seed)

### À MODIFIER
- `proxy.ts` — retirer l'import `checkRecapStatus` + `RecapStatusError`, retirer les deux blocs de gating (lignes 70-90 et 92-137). Garder uniquement le filet auth (session decrypt + redirect connexion). Note : le routing `/monthly-recap` reste protégé via `specialRoutes` mais sans logique recap derrière.
- `CLAUDE.md` — retirer toute mention V1 inerte / V2 ossature / dev surface `/dev/recap-v2`. Mettre une note "V3 en cours d'implémentation, voir prompt-montly-recap/".
- `.claude/conventions/operational-rules.md` — retirer les sections "God-files monthly-recap" et "Recover route — invariants stricts" et "Tests gated monthly-recap" et "budget_transfers.monthly_recap_id" (toutes obsolètes).
- `.claude/reference/structure-repo.md` — retirer les références aux dossiers supprimés.
- `scripts/check-rpcs.mjs` — pas de changement (les 13 RPCs sont domain-agnostiques).

### À CRÉER (squelette V3 vide)
- `lib/recap/` (dossier vide pour l'instant — sous-tâche 03 le peuplera)
- `lib/schemas/recap.ts` (nouveau fichier minimal avec juste un export placeholder commenté)

### Migrations DB à créer

Un seul fichier `supabase/migrations/<TS>_drop_legacy_recap_tables.sql` avec :
1. `ALTER TABLE budget_transfers DROP COLUMN IF EXISTS monthly_recap_id;` (drop la colonne FK, plus aucun consumer)
2. `DROP TABLE IF EXISTS monthly_recaps_v2 CASCADE;`
3. `DROP TABLE IF EXISTS recap_snapshots_v2 CASCADE;`
4. `DROP TABLE IF EXISTS monthly_recaps CASCADE;` (V1)
5. `DROP TABLE IF EXISTS recap_snapshots CASCADE;` (V1) — vérifier si elle existe d'abord via Management API
6. `DROP TABLE IF EXISTS remaining_to_live_snapshots CASCADE;` (V1 audit, dormante)
7. `NOTIFY pgrst, 'reload schema';`

## Patterns et conventions à respecter
- Utiliser `node scripts/apply-sql.mjs <migration>` pour appliquer la migration (PAS `supabase db push` — pattern documenté dans [.claude/conventions/git-workflow.md](../.claude/conventions/git-workflow.md) §5-6).
- `pnpm supabase migration repair --status applied <TS>` après application.
- Re-export baseline : `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql`.
- `pnpm db:check-drift` doit exit 0 après.
- Régénérer types : `pnpm db:types` puis `pnpm db:check-types-fresh`.
- Commit conventionnel : `chore(recap): drop V1+V2 to start V3 clean slate`.

## Étapes d'implémentation suggérées
1. **Vérifier les consumers** : `Grep "from.*'@/lib/recap-snapshot.types'"` cross-codebase + `Grep "from.*'@/lib/recap-legacy'"` + `Grep "from.*'@/lib/recap'"` + `Grep "monthly-recap-legacy"` + `Grep "recap-v2"`. Liste les call sites à nettoyer.
2. **Supprimer le code applicatif** : `rm -rf` les dossiers ci-dessus + `git rm` les fichiers individuels. Vérifier `pnpm typecheck` après chaque suppression (devrait casser temporairement les imports résiduels).
3. **Modifier proxy.ts** : retirer les imports recap + les 2 blocs de gating (lignes 70-90 et 92-137). Garder le bloc auth + le redirect root.
4. **Créer le squelette V3** : `mkdir lib/recap` + créer `lib/schemas/recap.ts` avec un commentaire placeholder (`// V3 schemas — populated in sub-task 03`).
5. **Créer la migration DB** : fichier `supabase/migrations/<TS>_drop_legacy_recap_tables.sql` avec les 7 commandes. Tester le DRY-RUN d'abord (lire les FK existantes).
6. **Appliquer la migration** : `node scripts/apply-sql.mjs supabase/migrations/<TS>_drop_legacy_recap_tables.sql` + `pnpm supabase migration repair --status applied <TS>` + re-export baseline + `pnpm db:check-drift`.
7. **Régénérer les types** : `pnpm db:types` + `pnpm db:check-types-fresh`.
8. **Mettre à jour les docs CLAUDE.md** : retirer toutes les sections obsolètes, ajouter note "V3 en cours".
9. **Lint + typecheck full** : `pnpm typecheck` puis `pnpm lint:check` — doivent passer (sinon, suppression incomplète).
10. **Commit** : un seul commit `chore(recap): drop V1+V2 to start V3 clean slate`.

## Critères d'acceptation
- [ ] `Grep "monthly-recap-legacy"` retourne 0 résultats
- [ ] `Grep "recap-v2"` retourne 0 résultats (sauf prompts-montly-recap/ pour ref)
- [ ] `Grep "recap-legacy"` retourne 0 résultats (idem)
- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm lint:check` exit 0
- [ ] `pnpm test:run` exit 0 (les tests V1/V2 disparaissent — total non-gated tests baisse de ~520 à ~440)
- [ ] `pnpm db:check-drift` exit 0
- [ ] `pnpm db:check-types-fresh` exit 0
- [ ] La table `monthly_recaps_v2` n'existe plus (`pnpm db:audit-objects` ou query Management API)
- [ ] Le proxy.ts ne référence plus `checkRecapStatus`
- [ ] CLAUDE.md et `.claude/conventions/operational-rules.md` purgés des refs V1/V2

## Tests à écrire
Aucun test à AJOUTER (suppression pure). Les tests V1/V2 disparaissent avec le code.

## Pièges et points d'attention
- **FK `budget_transfers.monthly_recap_id`** : la colonne référence l'ex-table `monthly_recaps` (V1). DROP avant les tables (`ALTER TABLE ... DROP COLUMN`) pour éviter CASCADE messy. Aucun applicative consumer (vérifié dans CLAUDE.md §5 fin).
- **`recap_snapshots` V1** : table possiblement orpheline depuis V1 → V2. Vérifier son existence via Management API (`SELECT 1 FROM information_schema.tables WHERE table_name = 'recap_snapshots'`) avant le DROP — utiliser `DROP TABLE IF EXISTS`.
- **`remaining_to_live_snapshots`** : la fonction `saveRemainingToLiveSnapshot` dans [lib/finance/snapshots.ts](../lib/finance/snapshots.ts) écrit dans cette table. **Vérifier** : est-elle appelée depuis le recap legacy uniquement ou aussi depuis le dashboard ? `Grep "saveRemainingToLiveSnapshot"` cross-codebase avant DROP. Si dashboard l'appelle (audit trail), garder la table. Sinon DROP.
- **`lib/recap-snapshot.types.ts`** : si `SnapshotPayload` est utilisé en dehors du recap (ex. `lib/database-snapshot.ts`), garder le fichier ou refactorer.
- **`scripts/check-rpcs.mjs`** : les 13 RPCs sont domain-agnostiques (`update_piggy_bank_amount`, `transfer_savings_between_budgets`, etc.) — aucune liée spécifiquement au monthly recap. **NE PAS** drop ces RPCs.
- **NE PAS** utiliser `supabase db push` pour cette migration — utiliser exclusivement `node scripts/apply-sql.mjs` puis `migration repair --status applied`.
- **NE PAS** régénérer les types AVANT d'avoir appliqué la migration DB (sinon types pointe vers tables fantômes).
- **Proxy.ts gating temporaire OFF** : pendant les sous-tâches 02-04, l'app n'a plus de gating recap. Acceptable car on est en feature dev — réintroduit en 05.
- **Si `saveRemainingToLiveSnapshot` reste utilisé** : ne pas DROP la table `remaining_to_live_snapshots`. Garder pour les sous-tâches futures.

## Commandes utiles
```bash
# Avant suppression : audit cross-codebase
LC_ALL=en_US.UTF-8 wc -l lib/recap/check-status.ts lib/recap/index.ts lib/schemas/recap.ts
# Suppression
git rm -r app/api/monthly-recap-legacy lib/recap-legacy components/monthly-recap-legacy hooks/legacy
git rm -r app/dev/recap-v2 app/api/debug/recap-v2 lib/dev/recap-v2-scenarios.ts
git rm app/monthly-recap/page.tsx app/api/monthly-recap/complete/route.ts
# Migration DB
node scripts/apply-sql.mjs supabase/migrations/<TS>_drop_legacy_recap_tables.sql
pnpm supabase migration repair --status applied <TS>
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
# Verify
pnpm db:types
pnpm db:check-drift && pnpm db:check-types-fresh
pnpm typecheck && pnpm lint:check && pnpm test:run
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 1 seul commit propre `chore(recap): drop V1+V2 to start V3 clean slate`
- `pnpm verify` exit 0 (sanity sweep complet)
- L'app démarre (`pnpm dev`) et `/monthly-recap` retourne 404 (page supprimée) — comportement attendu car proxy n'y redirige plus
- `git status` est clean après le commit
