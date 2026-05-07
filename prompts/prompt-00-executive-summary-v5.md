# Sprint Polish — bugs surfacés post-Hardening, debug audit, regression tests

## Contexte

Le **Sprint Hardening** ([prompt-00-executive-summary-v4](prompt-00-executive-summary-v4.md), livré 2026-05-07) a refermé H1–H6 en 9 commits sur `cleanup` (`858b243 → 5d65922`). En particulier H1 (unwind 17 scope-casts) a forcé le typage à compiler proprement et **3 bugs réels ont été surfacés** parce que le `as unknown as SupabaseClient` les masquait. Score audit estimé : **~70/100**.

Pendant ces fixes, certains items ont été identifiés mais **mis hors-scope** pour garder le sprint ciblé. Ce **Sprint Polish** referme ces follow-ups + ajoute la couverture régression qui aurait dû exister depuis le début.

---

### 🔴 Bloc T1 — Dashboard `total_real_income` / `total_real_expenses` (CORRECTNESS)

**État actuel** : [app/api/finances/dashboard/route.ts:344-368](../app/api/finances/dashboard/route.ts) hardcode :

```ts
// total_real_income / total_real_expenses previously fell back to a
// financial_snapshots ghost table that never existed in prod, so they
// always landed on 0. Aggregate computation is a separate chantier.
total_real_income: 0,
...
total_real_expenses: 0,
```

**Comment c'est arrivé** : avant le Sprint Hardening, le dashboard interrogeait `financial_snapshots` (table fantôme) et mettait `snapshot?.total_real_income || 0` comme fallback. La table n'a jamais existé en prod → erreur silencieusement avalée → `snapshot` toujours `undefined` → fallback toujours sur `0`. H2 a retiré le code mort mais **n'a pas implémenté la vraie computation** parce que c'était hors-scope.

**Impact** : le dashboard affiche en permanence `0€` pour les revenus réels et dépenses réelles — l'utilisateur voit une donnée fausse depuis le tout début. Aucun ticket utilisateur connu, ce qui suggère que ces deux fields ne sont pas affichés dans l'UI ou que personne ne les a remarqués. À investiguer côté frontend avant de fixer.

**Fix attendu** :
1. Grep `total_real_income` et `total_real_expenses` dans `components/`, `hooks/`, `app/` pour identifier les consommateurs côté UI. Si rien ne consomme → décider si on supprime les fields ou si on implémente.
2. Si on implémente, calculer via SUM aggregates pour le mois courant :
   ```ts
   const { data: monthlyIncomeAgg } = await supabaseServer
     .from('real_income_entries')
     .select('amount.sum()')
     .match(ownerCondition)
     .gte('entry_date', firstDayOfMonth.toISOString().split('T')[0])
     .lte('entry_date', lastDayOfMonth.toISOString().split('T')[0])
     .single()
   ```
   Note : Supabase 2.x supporte `.select('column.sum()')` mais retourne le résultat en `string` (numeric → string mapping). À tester live, fallback possible : récupérer toutes les lignes et `reduce`. La route fait déjà cela pour `monthlyIncome` (ligne 316), donc on peut probablement réutiliser le même pattern et juste assigner `total_real_income = monthlyIncome` (les deux représentent le même concept).
3. Test régression : `lib/__tests__/dashboard-aggregates.test.ts` — créer une fixture user, insérer 3 revenus + 2 dépenses sur le mois courant, GET `/api/finances/dashboard`, asserter les totaux.

**Critère de validation** : avec un compte qui a des `real_income_entries` et `real_expenses` ce mois-ci, le dashboard renvoie des totaux > 0 cohérents avec les données.

---

### 🟠 Bloc T2 — Debug routes audit (3 holdouts)

3 routes restent scope-cast après H1, marquées hors-scope car *debug only* :
- [app/api/debug/quick-test/route.ts](../app/api/debug/quick-test/route.ts)
- [app/api/debug/recap-data/route.ts](../app/api/debug/recap-data/route.ts)
- [app/api/debug/test-balance/route.ts](../app/api/debug/test-balance/route.ts)

**Question à trancher pour chacune** :
1. Est-ce que cette route est encore appelée ? Grep le repo pour `fetch.*api/debug/{quick-test,recap-data,test-balance}` ou des liens dans le frontend.
2. Quel est son objectif documenté ? Lis le commentaire en tête.
3. Si plus utilisée → suivre le pattern R1 (Sprint Refactor) et **supprimer**.
4. Si encore utilisée → unwind le scope-cast (mêmes patterns que H1).

**Garde-fou** : toutes ces routes sont déjà bloquées en prod via `blockInProduction()`, donc supprimer en prod n'a aucun impact utilisateur. Le risque est de casser un workflow dev, à valider avec les commandes que toi-même utilises pour tester localement.

**Critère de validation** : grep `as unknown as SupabaseClient` retourne ≤ 2 occurrences (les 2 god files I4/I5).

---

### 🟡 Bloc T3 — Regression tests pour les 3 bugs surfacés en H1/H2

Trois bugs ont été masqués par `as any` ou `as unknown as SupabaseClient` pendant des mois :

| Bug | Fixé par | Risque de régression |
|---|---|---|
| `current_savings` (colonne inexistante) → `cumulated_savings` dans expenses/progress | R2 | Faible (compile-time désormais) |
| RPC fantôme `calculate_available_cash` dans dashboard | H1 commit 2 | Faible (compile-time désormais) |
| Lecture `total_real_income`/`total_real_expenses` depuis ghost table | H2 | Moyen (T1 corrige le code mais peut casser sans test) |

**Tests à ajouter** :
- `lib/__tests__/expenses-progress.test.ts` — fixture avec économie cumulée connue, GET `/api/finances/expenses/progress`, asserter le retour.
- `lib/__tests__/dashboard-cash.test.ts` — fixture avec balance + revenus, GET `/api/finances/dashboard`, asserter `available_cash` et `remaining_to_live`.
- Pour T1, le test régression du dashboard couvre déjà `total_real_income`/`total_real_expenses`.

**Pattern** : utiliser le même style gated que `rpc-concurrency.test.ts` (`SUPABASE_RPC_CONCURRENCY_TESTS=1`) ou créer un nouveau gate `SUPABASE_API_TESTS=1` si on veut tester les routes API end-to-end avec un user fixture. Le pattern `chunked()` et `beforeAll`/`afterAll` est déjà documenté.

**Critère de validation** : `SUPABASE_API_TESTS=1 pnpm test:run` passe avec 3+ nouveaux tests verts.

---

### 🟡 Bloc T4 — `SnapshotPayload` type pour `recap_snapshots.snapshot_data`

[app/api/monthly-recap/recover/route.ts:118](../app/api/monthly-recap/recover/route.ts) lit `snapshot.snapshot_data as any`. Le contenu est un blob jsonb dont le shape est connu (versionné par `snapshot_version: 1 | 2`).

**Définir** un type discriminé dans `lib/recap-snapshot.types.ts` (nouveau fichier) :

```ts
export type SnapshotPayloadV1 = {
  snapshot_version: 1
  context: 'profile' | 'group'
  // ... v1 fields
}

export type SnapshotPayloadV2 = {
  snapshot_version: 2
  context: 'profile' | 'group'
  estimated_incomes: TablesInsert<'estimated_incomes'>[]
  estimated_budgets: TablesInsert<'estimated_budgets'>[]
  // ... v2 fields
}

export type SnapshotPayload = SnapshotPayloadV1 | SnapshotPayloadV2
```

Puis dans recover : `const snapshotData = snapshot.snapshot_data as SnapshotPayload`. Le narrowing `if (snapshotData.snapshot_version === 2)` discriminate les branches v1/v2.

Côté écriture (`lib/database-snapshot.ts`), aligner `snapshotData` sur `SnapshotPayloadV2` aussi — ça garantit que les snapshots créés sont conformes.

**Bonus** : retire 2 `as any` documentés (recover ligne 112, database-snapshot ligne 134).

---

### 🟢 Bloc T5 — Trigger inventory (one-shot)

H6 a documenté **un seul** trigger cross-schema (`group_contributions` auto-create). Mais il y en a probablement d'autres (e.g. `update_updated_at_column` est-il bien partout ? auth.users → profiles trigger ?). 

**Action** : lancer la query du H6 contre prod (token requis) et documenter tout ce qui sort dans [docs/db/SCHEMA.md](../docs/db/SCHEMA.md) section "Triggers — what's tracked vs what isn't".

```sql
SELECT n.nspname, t.tgname, c.relname, p.proname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
ORDER BY n.nspname, c.relname, t.tgname;
```

Pas de code à écrire, juste de la documentation. ~10 minutes.

---

## Ordre d'exécution recommandé

1. **T1** d'abord — c'est le seul bug *correctness* visible utilisateur potentiellement. Investigation UI → fix → test → commit.
2. **T2** — audit + (delete OU unwind). Petit, mécanique.
3. **T3** — tests régression. Plus long mais clé pour la longévité.
4. **T4** — type tightening, optionnel mais propre.
5. **T5** — doc, 10 min.

Push gate : aucun bloc ne touche à la DB (sauf T5 lecture). Aucune migration.

## Critères de validation par commit

- `pnpm typecheck && pnpm lint:check && pnpm test:run`
- T1 : test régression vert + smoke test manuel `/api/finances/dashboard` avec données réelles.
- T2 : compteur scope-cast ≤ 2.
- T3 : 3 nouveaux tests verts gated.
- T4 : zéro `as any` ajouté, idéalement -2.

## Risques

1. **T1 — l'UI consomme peut-être ces fields cassés** : si on les passe de `0` à des vraies valeurs, des composants qui supposent `0` peuvent afficher différemment. Smoke-test obligatoire avant de pusher.
2. **T2 — supprimer une debug route encore utilisée** : grep avant de supprimer. Si tu utilises encore `recap-data` localement, garder + unwind.
3. **T3 — les tests gated nécessitent des user fixtures qu'il faut nettoyer** : suivre le pattern de `rpc-concurrency.test.ts` (`afterAll` avec `auth.admin.deleteUser`). Sans nettoyage, la prod accumulera des comptes test orphelins.

## Hors-scope

- I4 (god file `lib/financial-calculations.ts`) — chantier dédié.
- I5 (`process-step1` extraction) — chantier dédié.
- Console.log cleanup (1331 occurrences) — chantier dédié.
- Zod rollout — chantier dédié.
- Sprint 1 (Prettier + Husky + CI + ESLint Next 16) — sprint dédié.
- Modifications aux RPCs C3 — corrections via nouvelles migrations seulement.
- Lint cleanup global (144 errors) — chantier `progressivement` continu, pas un sprint à part.
