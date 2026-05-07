# Sprint Lint-Baseline-Cleanup — Prompt v2

> **Origine** : émergé du Sprint Align-PackageJson (livré 2026-05-07, prompt v1 = `prompt-01-inventory.md`). Le Sprint v1 a aligné `package.json` (drop `@anthropic-ai/sdk`, move `autoprefixer` → devDeps, +4 scripts, +`engines`, +`.nvmrc`) mais a surfacé une dette pré-existante non prévue : `pnpm lint:check` retourne **125 errors + 11 warnings** sur 62 fichiers, et **aucun workflow CI ne lance ce check**.
>
> **Pourquoi un prompt v2 plutôt que d'attendre le Sprint 1 ?** Le Sprint 1 prévu (CLAUDE.md §11) couvre Prettier + Husky + upgrade ESLint 8→9 + eslint-config-next 15→16. L'upgrade va probablement re-classer certaines erreurs (`no-empty-object-type` est une rule Next 15+) mais pas les éliminer (`no-explicit-any` et `no-unused-vars` ne dépendent pas de l'upgrade). Faire le cleanup AVANT le Sprint 1 simplifie ce dernier (pas de mélange "cleanup + upgrade"), ET permet d'activer `lint:check` comme bloqueur CI pour stopper la régression future.

---

## Contexte

L'audit `01-inventory.md` listait "ESLint v8 / 15.0.0 mismatch" et a inspiré le Sprint Align-PackageJson, qui a triagé 11 items dont 6 ont été légitimement skip. **Surface secondaire identifiée pendant le Sprint** : `pnpm lint:check` est en état baseline cassé depuis longtemps, et le filet CI ne le couvre pas.

**Pourquoi le filet CI ne le couvre pas** : `code-checks.yml` (Sprint Code-CI / F1) lance uniquement `pnpm typecheck` + `pnpm test:run`. Décision prise consciemment à l'époque ("Lint et build hors scope (lint = 136 errors pre-existants, build = besoin env vars Supabase)" — cf. Sprint Code-CI commit closeout). Le résultat : la dette est figée mais invisible. Toute nouvelle PR qui ajoute un `: any` n'est jamais détectée.

**Conséquence pratique** : la règle CLAUDE.md §6 "Aucun nouveau `any`" repose entièrement sur la discipline humaine et sur le code review. Pas de filet automatique.

## Inventaire de la dette (mesuré 2026-05-07)

```
136 problems (125 errors, 11 warnings) répartis sur 62 fichiers
```

| Rule | Count | Type | Fixable auto ? |
|---|---|---|---|
| `@typescript-eslint/no-explicit-any` | 59 | error | ❌ — décision manuelle (type guard, generic, narrowing) |
| `@typescript-eslint/no-unused-vars` | 43 | error | ❌ — décision manuelle (delete vs prefix `_`) |
| `react/no-unescaped-entities` | 15 | error | ❌ — décision manuelle par texte FR (`'` → `’` ou `&apos;`) |
| `react-hooks/exhaustive-deps` | 10 | warning | ⚠️ — risqué (peut introduire des boucles infinies si fait sans réflexion) |
| `prefer-const` | 7 | error | ✅ — auto-fixable (`pnpm lint --fix` les traite) |
| `@typescript-eslint/no-empty-object-type` | 1 | error | ❌ — décision (étendre l'interface ou alias `Record<string, never>`) |
| `@next/next/no-img-element` | 1 | error | ❌ — décision (migrer `<img>` → `next/image` ou disable rule par fichier) |

### Top 10 fichiers concentrant la dette (à valider)

À mesurer en début de chantier via :
```powershell
$out = pnpm lint:check 2>&1
$out -split "`n" | Select-String -Pattern '^C:\\.+\\([^\\]+\.tsx?)$' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Group-Object | Sort-Object Count -Descending | Select-Object -First 10
```

**Hotspots probables d'après l'inventaire** :
- `lib/financial-logger.ts` (10 `any` dans la signature du logger custom — touche le chantier console.log cleanup)
- `lib/financial-calculations.ts` (god file, 2 `no-unused-vars`) — **NE PAS REFACTOR** (chantier I4 séparé), juste les `_var` rename
- `app/api/monthly-recap/*` (~15 routes, dette `any` concentrée — touche le chantier I5 et le Sprint Supabase-Strict-Types)
- `app/api/finances/expenses/*`, `app/api/finances/income/*` (5+ routes avec pattern `insertData = ...` à passer en `const` + types explicites)
- `components/ui/*` (shadcn/ui generics — `select.tsx`, `dialog.tsx`, `textarea.tsx`)
- `contexts/AuthContext.tsx`, `hooks/use*.ts` (les 6 React hooks deps warnings)
- `middleware.ts` (2 `no-unused-vars` — restes du refactor proxy/middleware Next 16)

## Objectifs

### Objectif minimum (M)

1. **`pnpm lint:check` → exit 0** sur la baseline.
2. **Activer `lint:check` dans `code-checks.yml`** pour bloquer la régression future.
3. **Mettre à jour CLAUDE.md** : retirer la mention "État baseline cassé" du tableau §3 et de §11.

### Objectif étendu (E, optionnel selon temps)

4. **Activer `pnpm ci` sans bloquage artificiel** : depuis le Sprint Align-PackageJson, le script existe mais bloque sur `lint:check`. Une fois M=1 atteint, `ci` devient utilisable (typecheck + lint:check + test:run + build).
5. **Documenter dans CLAUDE.md §6** la stratégie adoptée par règle (ex : "préférer `_var` à `delete` pour `no-unused-vars` quand le var est dans une signature publique car la breaking change downstream est non-triviale").

### Hors scope explicite

- ❌ **Ne pas refactor** `lib/financial-calculations.ts` (chantier I4)
- ❌ **Ne pas refactor** `app/api/monthly-recap/process-step1/route.ts` (chantier I5)
- ❌ **Ne pas upgrader ESLint** (Sprint 1 séparé) — le chantier doit fonctionner sur la stack actuelle
- ❌ **Ne pas migrer** `<img>` → `next/image` (touche l'UI, audit visuel requis — chantier séparé)
- ❌ **Ne pas modifier** `lib/financial-logger.ts` au-delà du strict minimum — c'est une dépendance du chantier console.log cleanup, mieux le faire tout d'un bloc

## Stratégie d'attaque proposée

### Phase 1 — Auto-fix (quick wins, ~5 min)

```powershell
pnpm lint  # auto-fix --fix : traite les 7 prefer-const
git diff   # review les changements
git commit -m "chore(lint): apply ESLint --fix for prefer-const"
```

### Phase 2 — `no-unused-vars` (~30 min)

43 occurrences. **Stratégie par cas** :
- **Variable assignée jamais lue** : delete (90% des cas)
- **Param de fonction non utilisé mais dans une signature publique/callback** : préfixer `_` (rule ESLint accepte `_var`)
- **Import non utilisé** : delete
- **Destructure clause** : utiliser `// eslint-disable-next-line` si vraiment besoin de l'extraire

Commit groupé par fichier ou groupe logique.

### Phase 3 — `react/no-unescaped-entities` (~20 min)

15 occurrences, toutes des apostrophes françaises dans du JSX (`l'utilisateur`, `c'est`, etc.). Fix : `&apos;` ou `&rsquo;` ou simplement déplacer le texte en variable string où l'apostrophe est OK.

```jsx
// Avant
<p>L'utilisateur n'a pas accès</p>
// Après
<p>L&apos;utilisateur n&apos;a pas accès</p>
```

Commit unique : `chore(lint): escape French apostrophes in JSX`.

### Phase 4 — `no-explicit-any` (~2-3h, le gros morceau)

59 occurrences. **Décision par site** selon le contexte :
- **Inputs Supabase insert/update** : typer explicitement (`Database['public']['Tables']['xxx']['Insert']`).
- **Logger generic** : remplacer `any` par `unknown` (force narrowing dans le consumer) — appliquer à `lib/financial-logger.ts` (10 sites) en bloc.
- **Body de catch** : `error: unknown` puis narrow via `error instanceof Error ? error.message : String(error)`.
- **Cast inevitable** : remplacer `as any` par `as unknown as T` (CLAUDE.md §6).
- **Generic Supabase response** : utiliser le type retourné par le builder Supabase (souvent `PostgrestResponse<T>`).

Commit groupé par fichier ou par catégorie (`chore(lint): replace any with unknown in financial-logger`).

### Phase 5 — `react-hooks/exhaustive-deps` (~30 min, **prudence**)

10 warnings. **Pour chaque cas** :
1. **Comprendre POURQUOI** la dep manque (souvent intentionnel pour éviter une boucle).
2. Options dans l'ordre :
   - (a) Ajouter la dep manquante si le re-render qu'elle déclenche est attendu.
   - (b) `useCallback`/`useMemo` la dep parente pour stabiliser sa référence.
   - (c) Disable rule par ligne avec **commentaire expliquant pourquoi** : `// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see commit XXX`.
3. **Smoke test critique** : `pnpm dev` + naviguer dans les pages touchées (login, dashboard, recap) pour s'assurer qu'aucun loop infinite n'a été introduit.

### Phase 6 — Cas isolés (~10 min)

- 1 `no-empty-object-type` dans `components/ui/textarea.tsx` (alias type vide) → `interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}` peut devenir `type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>` si rien ne l'étend.
- 1 `no-img-element` dans un fichier UI → soit migrer `<Image>`, soit `// eslint-disable-next-line @next/next/no-img-element -- raison`.

### Phase 7 — Activation CI gate (~10 min)

Modifier `.github/workflows/code-checks.yml` pour ajouter un step `pnpm lint:check` (avec `if: always()` pour qu'il fire même si typecheck/test échoue, pattern miroir Sprint Code-CI / F1) :

```yaml
- name: ESLint check
  if: always()
  run: pnpm lint:check
```

Vérification end-to-end (pattern Sprint Code-CI / F1) : créer une branche test avec un nouveau `: any` introduit, vérifier que la PR sort rouge sur ce step, puis revert.

### Phase 8 — Closeout

- Re-run `pnpm verify` (sanity sweep complet) — exit 0 attendu.
- Re-run `pnpm ci` — exit 0 attendu (premier vrai run propre du script ajouté en Sprint Align-PackageJson).
- Update CLAUDE.md §3 : retirer la mention "⚠️ État baseline cassé" du tableau, retirer la note "Bloque actuellement sur `lint:check`" du script `ci`.
- Update CLAUDE.md §11 : ajouter le sprint comme `✅ **Sprint Lint-Baseline-Cleanup**` avec score estimé +1-2 points.
- Update CLAUDE.md §8 : ajouter dans les "À faire" : "Lancer `pnpm lint:check` avant push (ou laisser le push gate `code-checks.yml` le faire)".
- Update README.md : retirer la note "**baseline cassé**" du tableau commandes pour `lint:check`, retirer "Bloque actuellement sur `lint:check`" pour `ci`.

## Critères de validation

| Check | Attendu |
|---|---|
| `pnpm lint:check` | exit 0, 0 errors 0 warnings |
| `pnpm lint` | exit 0, 0 modifications (rien à fixer) |
| `pnpm typecheck` | exit 0 (régression-free) |
| `pnpm test:run` | exit 0 (régression-free) |
| `pnpm verify` | exit 0 (sanity sweep, ~36s) |
| `pnpm ci` | exit 0 (typecheck + lint:check + test:run + build) |
| `pnpm dev` smoke test | démarre sur `:3000`, HTTP 200 sur `/`, naviguer dashboard + login + recap pour vérifier aucun React infinite loop introduit par les fix `exhaustive-deps` |
| CI PR test | branche test avec `: any` introduit → `code-checks.yml` step `ESLint check` rouge |

## Plan de commits suggéré

Pattern miroir Sprint Cleanup-Legacy / Stabilize-Deps : un commit par phase logique.

1. `chore(lint): apply ESLint --fix (prefer-const, 7 sites)`
2. `chore(lint): remove unused vars (X sites across N files)` — peut être splitté en 2-3 si trop gros
3. `chore(lint): escape French apostrophes in JSX (15 sites)`
4. `chore(lint): replace any with unknown in financial-logger (10 sites)`
5. `chore(lint): type Supabase inserts in finances/* routes (X sites)`
6. `chore(lint): type Supabase inserts in monthly-recap/* routes (X sites)`
7. `chore(lint): narrow error: unknown in catch blocks (X sites)`
8. `chore(lint): fix react-hooks/exhaustive-deps in N hooks` — **smoke test obligatoire**
9. `chore(lint): isolated cases (no-empty-object-type, no-img-element)`
10. `feat(ci): add ESLint check to code-checks.yml workflow`
11. `docs: closeout Sprint Lint-Baseline-Cleanup (CLAUDE.md, README.md)`

## Estimation effort

- **Optimiste** : 4h (phases 1-7, sans surprise)
- **Réaliste** : 6-8h (avec quelques décisions épineuses sur `any` et `exhaustive-deps`)
- **Si on découvre que certains `any` sont structurellement difficiles à retirer sans refactor I4/I5** : produire un commit `chore(lint): document deferred any sites (N files annotated with eslint-disable + reason)` pour les isoler explicitement plutôt que les laisser silencieux. Cela permet de garder `lint:check` exit 0 tout en marquant la dette restante visible.

## Pièges connus à anticiper

1. **React hooks loops** : un fix `exhaustive-deps` aveugle peut introduire un re-render infini. **Toujours** smoke test après chaque fix de cette catégorie.
2. **Type narrowing sur Supabase** : remplacer `any` par le type généré dans `lib/database.types.ts` peut surfacer des champs `null` non gérés (TypeScript strict + `noUncheckedIndexedAccess`). Anticiper du temps pour ces narrowing.
3. **Dépendance avec Sprint 1 (ESLint upgrade)** : si l'utilisateur veut faire Sprint 1 d'abord, ce chantier devient probablement plus court (certaines règles disparaissent ou se reclassent en warning), mais d'autres apparaissent (ESLint 9 + eslint-config-next 16 ont des règles supplémentaires). **Recommandation** : faire ce chantier d'abord pour repartir sur une base propre.
4. **Pattern `as any` dans les god files I4/I5** : 2 occurrences `as unknown as SupabaseClient` documentées dans CLAUDE.md §6 ("Compteur à 2"). Ne pas y toucher — chantier séparé.
5. **`pnpm dev` smoke test final** : le filet CI ne lance pas `pnpm build`. Dernière action AVANT le closeout commit : `pnpm dev` + `curl /` pour confirmer aucune régression CSS/runtime introduite par les fix UI.

## Fichiers attendus à modifier (estimation)

- `app/api/finances/budgets/estimated/route.ts`
- `app/api/finances/expenses/{add-with-logic,preview-breakdown,progress,real}/route.ts`
- `app/api/finances/income/{estimated,progress,real}/route.ts`
- `app/api/finances/dashboard/route.ts`
- `app/api/groups/[id]/members/route.ts`
- `app/api/monthly-recap/{accumulate-piggy-bank,auto-balance,balance,complete,initialize,process-step1,recover,refresh,resume,step1-data,step2-data,transfer,update-step}/route.ts` (sauf `process-step1` core algo : juste les `: any` boundaries, **PAS le coeur**)
- `app/api/debug/{financial,group-financial,remaining-to-live,reset-all}/route.ts`
- `components/ui/{dialog,select,textarea}.tsx`
- `contexts/AuthContext.tsx`
- `hooks/{useAuth,useBankBalance,useFinancialData}.ts`
- `lib/{contribution-calculator,database-snapshot,financial-calculations,financial-logger,monthly-recap-calculations,session-client}.ts`
- `middleware.ts`
- `.github/workflows/code-checks.yml` (ajout step `pnpm lint:check`)

## Hors-périmètre identifié à ne PAS reporter dans CLAUDE.md

Si pendant le chantier on découvre :
- Un bug réel (pas juste lint) → fixer dans son propre commit `fix:` séparé, mentionner dans le closeout.
- Une opportunité de refactor large → **NE PAS** refactorer, créer une note dans CLAUDE.md §11 pour un sprint dédié.
- Un import circulaire ou un anti-pattern d'architecture → idem.

## Références

- [CLAUDE.md §3 Commandes](../CLAUDE.md#3-commandes) — état actuel `lint:check` baseline cassé
- [CLAUDE.md §6 TypeScript conventions](../CLAUDE.md#6-conventions) — règle "aucun nouveau `any`"
- [CLAUDE.md §11 Roadmap](../CLAUDE.md#11-roadmap-à-jour-2026-05-07) — Sprint Align-PackageJson + entry chantier `lint-baseline-cleanup`
- [.github/workflows/code-checks.yml](../.github/workflows/code-checks.yml) — workflow à étendre
- [Sprint Code-CI commit closeout](https://github.com/PothieuG/popoth/commits/cleanup) — décision originale d'exclure lint du gate CI ("136 errors pre-existants")
