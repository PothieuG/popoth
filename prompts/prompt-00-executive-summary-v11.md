# Sprint Code-CI — PR-time TypeScript + tests gate, alignement `db:types`

## Contexte

Sprint Hygiene-CI (livré 2026-05-07, commits `2174e41 → 7092773` sur `cleanup`) a refermé E1–E3 et fait passer le score audit ~78 → ~79/100. Pendant E3 (`workflow_dispatch` validation du cron weekly) **3 vrais bugs cachés depuis Sprint Hardening / H5** ont été surfacés et fixés : workflow invisible côté UI (main n'avait aucun YAML), `--linked` fail en CI sans `supabase link`, 403 sur issue creation faute de `permissions:`. C'est exactement le pattern Sprint Cleanup-Legacy / C3 : **la première vraie boucle de feedback CI révèle ce que la machine du dev couvrait silencieusement**.

Sprint Hygiene-CI a aussi mis en évidence **2 traces résiduelles** qu'aucun sprint précédent n'a adressées :

1. **Aucun PR-time gate côté code.** Le repo a aujourd'hui 2 workflows (db-drift-pr.yml, db-drift-check.yml) qui couvrent uniquement la DB. Un dev qui pousse une PR avec `pnpm typecheck` rouge, ou des tests cassés, ou même un build cassé, ne se ferait **pas arrêter par CI**. Le filet `pnpm typecheck && pnpm test:run` n'existe que dans la mémoire des devs et dans le commit message de chaque sprint (`Verif end-to-end : ...`). C'est un gros trou par rapport au filet DB qu'on a construit en 6 sprints. Risque concret : une régression TS non-typecheckée pourrait se rendre en main si jamais cleanup est mergé sans review attentive (cf. discussion Sprint Hygiene-CI sur l'éventuel `cleanup → main` swap).

2. **`pnpm db:types` et `pnpm db:check-types-fresh` désalignés.** Sprint Hygiene-CI / E2 hotfix a fait passer le détecteur à `--project-id <ref>` (pour fonctionner dans un fresh CI checkout sans `supabase link` préalable). Mais `pnpm db:types` reste sur `--linked`. **Conséquence** : un dev qui clone le repo pour la première fois et tape `pnpm db:types` se prend `Cannot find project ref. Have you run supabase link?` — comme le runner CI prenait avant le hotfix. Le filet `db:check-types-fresh` couvre la sortie, mais l'ergo `db:types` est cassé pour un nouvel arrivant. Output `--linked` vs `--project-id` est byte-identique (vérifié pendant le hotfix), donc l'alignement est purement gain DX, sans risque.

But du sprint : refermer ces 2 points avec **2 commits code + 1 closeout doc + observation passive du cron**. Pas de migration DB. Score audit estimé post-sprint : ~80/100 (premier vrai franchissement du seuil 80).

---

## Approche recommandée

### Bloc F1 — PR-time `code-checks.yml` (TypeScript + tests)

**Fichier à créer** : [.github/workflows/code-checks.yml](.github/workflows/code-checks.yml)

**Goal** : tout PR qui touche du code TypeScript / config TS / tests / package.json doit passer `pnpm typecheck` + `pnpm test:run` avant merge. Filet code-side, pendant des filets DB-side livrés en B3/E2.

**Pattern miroir** : copier la structure de [.github/workflows/db-drift-pr.yml](.github/workflows/db-drift-pr.yml) — `pull_request:` avec `paths:`, `pnpm/action-setup@v4` (pas de `with: version` pour respecter le `packageManager` package.json — leçon Sprint Cleanup-Legacy / C3), `actions/setup-node@v4` Node 20, `pnpm install --frozen-lockfile`, puis les checks avec `if: always()` pour qu'ils tournent tous même si le premier échoue.

**Contenu cible** (squelette) :

```yaml
name: Code checks (PR)

# Runs typecheck + tests on PRs that touch source code so we don't merge
# a TypeScript regression or a broken test. Companion to
# .github/workflows/db-drift-pr.yml (DB-side checks).
#
# Path filter keeps Actions minutes low — only fires when source code,
# config, or dependencies change.
#
# Sprint Code-CI / F1.

on:
  pull_request:
    paths:
      - '**/*.ts'
      - '**/*.tsx'
      - 'package.json'
      - 'pnpm-lock.yaml'
      - 'tsconfig.json'
      - 'vitest.config.ts'
      - 'next.config.*'
      - 'eslint.config.*'
      - '.eslintrc*'
      - '.github/workflows/code-checks.yml'

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: TypeScript check (strict, blocking)
        run: pnpm typecheck

      - name: Vitest single run
        if: always()
        run: pnpm test:run
```

**Décisions clés** :

- **Lint** : NE PAS l'inclure pour l'instant. Le projet a ~136 errors pre-existants (CLAUDE.md §11) → activer le gate ferait échouer chaque PR. Soit on fait un sprint dédié "lint cleanup" avant, soit on l'ajoute en `continue-on-error: true` (rapport-only). Recommandation : **laisser hors scope**, traiter lint dans un sprint séparé après cleanup.
- **Build (`pnpm build`)** : NE PAS inclure non plus. `pnpm build` (Turbopack prod) prend 30-60s + nécessite des env vars Supabase qu'on n'a pas envie d'exposer en PR-time gate. Le `typecheck` strict couvre 95% de ce que le build attraperait. Si on veut couvrir le 5% restant, faire ça dans un sprint Build-CI dédié.
- **Tests gated** : ne pas activer `SUPABASE_RPC_CONCURRENCY_TESTS=1` etc. en CI — ces tests créent de vraies données dans Supabase prod et sont conçus pour exécution manuelle uniquement (CLAUDE.md §3 list). Les laisser skipped (le `describe.skipIf` les saute proprement sans env var).
- **`if: always()` sur test:run** : pour que test:run tourne même si typecheck échoue. Pattern miroir de db-drift-pr.yml.
- **Pas de `permissions:`** : ce workflow ne crée pas d'issue → le default `contents:read` suffit. (Cf. leçon Sprint Hygiene-CI / E3 hotfix bug c.)
- **Pas de cache supabase CLI** : ce workflow n'utilise pas supabase, juste node_modules.

**Verif end-to-end** :
1. PR test : créer une branche `test-f1`, casser un type sciemment dans `lib/finance/piggy-bank.ts`, push, ouvrir PR vers `cleanup` → `pnpm typecheck` step rouge ✗.
2. Restore le type, push → step vert ✓.
3. PR test bis : casser un test sciemment (e.g. `lib/debug-guard.test.ts`), push → `pnpm test:run` step rouge ✗.
4. Restore, push → vert ✓.
5. Confirmer que le path filter fonctionne : un PR qui touche uniquement `docs/audit/00-executive-summary.md` ne doit PAS déclencher code-checks.yml (mais le moteur GitHub teste les paths sur la diff de la PR — un fichier .ts modifié + un .md modifié = trigger).

**Risques** :
1. **Le filtre `**/*.ts` matche aussi les tests `*.test.ts` modifiés** : c'est voulu, on veut tester le test runner sur ces changements.
2. **`pnpm install --frozen-lockfile`** : si quelqu'un commite un package.json sans regen lockfile, install échoue. C'est le bon comportement (force la cohérence).
3. **`vitest.config.ts` charge `.env.local`** (Sprint DB) : le runner CI n'a pas ce fichier → vitest log warning mais continue. Les gated tests sont skipped (env var manquante). Tests non-gated tournent. Pas de problème attendu.

---

### Bloc F2 — Aligner `pnpm db:types` sur `--project-id`

**Fichier modifié** : [package.json:14](package.json#L14)

**Diff** :
```diff
-    "db:types": "supabase gen types typescript --linked --schema public > lib/database.types.ts",
+    "db:types": "supabase gen types typescript --project-id jzmppreybwabaeycvasz --schema public > lib/database.types.ts",
```

**Pourquoi** : Sprint Hygiene-CI / E2 hotfix (commit `5d8292a`) a fait passer `scripts/check-types-fresh.mjs` à `--project-id` parce que `--linked` requiert un `supabase link` préalable que le CI n'a pas. Mais `pnpm db:types` est resté sur `--linked` — ce qui veut dire qu'**un nouvel arrivant qui clone le repo et tape `pnpm db:types` se prend la même erreur que le runner CI prenait avant le hotfix**. C'est une trace de DX cassée.

**Output identique** : vérifié pendant le hotfix Sprint Hygiene-CI / E2 — `--linked` et `--project-id <ref>` produisent le même fichier byte-pour-byte contre le même projet (au file `lib/database.types.ts` près à la ligne `<claude-code-hint>` qui n'apparaît que via `pnpm exec` — non concerné par l'invocation directe `supabase`).

**Pourquoi pas une variable d'env** : on pourrait faire `--project-id $SUPABASE_PROJECT_REF` mais (a) ça nécessite shell expansion qui pose des problèmes Windows, (b) le projet ref est public (visible dans `lib/supabase-{client,server}.ts` URLs), donc le hardcoder dans `package.json` n'est pas un secret leak. `scripts/check-types-fresh.mjs` lui passe par env var avec fallback hardcodé — ce double pattern est volontaire (env utile pour les forks/staging futurs).

**Doc à mettre à jour** :
- [CLAUDE.md §3](CLAUDE.md) : la description de `pnpm db:types` mentionne "depuis Sprint DB / D6" + "Sprint Polish-CI / D1" (le fix du redirect). Ajouter "Sprint Code-CI / F2 a aligné le flag sur `--project-id` (cohérence avec `db:check-types-fresh`, élimine la dépendance à `supabase link` pour les fresh clones)."
- [CLAUDE.md §8](CLAUDE.md) : la bullet "Régénérer les types après changement de schéma" peut rester telle quelle (elle ne référence pas `--linked` explicitement).

**Verif** :
1. Suppression locale du link : `rm -rf supabase/.temp` (ou équivalent) — simule un fresh clone.
2. `pnpm db:types` → exit 0, `lib/database.types.ts` regénéré.
3. `git diff lib/database.types.ts` → vide (output identique à l'état committé).
4. `pnpm db:check-types-fresh` → exit 0.
5. `pnpm typecheck` → exit 0.

**Risques** :
1. **Si on un jour bouge le projet vers un autre ref Supabase** (rare mais possible — staging séparé, fork), il faudra changer le ref hardcodé dans `package.json`. C'est OK : c'est une string explicite que git diff montre clairement, donc impossible de l'oublier au moment d'un changement d'env. Pas de cache invisible comme avec `supabase link`.
2. **`supabase link` peut quand même rester utilisé pour `pnpm supabase db push` etc.** — F2 ne touche que `db:types`. Les autres commandes `pnpm supabase ...` continuent à utiliser le link cache. Ce n'est pas un alignement complet mais ça résoud le cas le plus fréquent (régénération des types).

---

### Bloc F3 — Observation passive cron + cosmetic fixes

**Action 1 — Confirmation cron stable** : pas de code change. À l'issue du sprint, vérifier que le run cron du lundi suivant (08:00 UTC) est bien vert. Sprint Hygiene-CI / E3 a validé un `workflow_dispatch` mais pas encore un vrai `schedule`. Si le run hebdomadaire bug, c'est probablement un nouveau bug cron-only (e.g. permissions différentes en mode `schedule` — improbable mais possible).

**Action 2 — Mise à jour remote URL local (optionnel)** : `git remote set-url origin git@github.com:PothieuG/popoth.git`. Le rename `Popoth_App_Claude → popoth` (Sprint Cleanup-Legacy / C3) reste reflété dans le local git config par redirection GitHub à chaque push. Cosmétique uniquement, n'affecte rien fonctionnellement. Si jamais GitHub supprime la redirection (rare), le push échouera et on devra le fixer en urgence — autant le faire maintenant.

**Action 3 — Discussion stratégique main vs cleanup** : le default branch est désormais `cleanup`. `main` est gelé à 3 commits derrière les premiers sprints. **Ne pas merger automatiquement** dans ce sprint — c'est une décision stratégique de release. Options à considérer pour un sprint futur :
- (a) Renommer `cleanup → main`, supprimer l'ancien `main` → trunk unique propre.
- (b) Merger `cleanup → main` via une grosse PR de 64 commits → garde l'historique main.
- (c) Status quo → cleanup reste le trunk de fait, main reste gelé pour archives.

**Recommandation hors scope F3** : (c) jusqu'à ce qu'il y ait une vraie demande de "release prod". Le filet CI tourne déjà sur cleanup, donc pas d'urgence.

---

## Ordre d'exécution

1. **F2** d'abord (plus simple, 1 ligne dans package.json + 2 lignes dans CLAUDE.md). 1 commit dédié.
2. **F1** ensuite (création YAML + verif via PR test sur branche jetable). 1 commit code + verif manuelle GitHub UI.
3. **F3 actions 1 et 2** parallèlement à F1/F2 (passives).
4. **Closeout** : CLAUDE.md §3, §7, §11 + README.md si pertinent. 1 commit doc.

**Commits attendus** : 3 total (`refactor` ou `chore` pour F2, `feat(ci)` pour F1, `docs` pour closeout). Conventional commits.

---

## Fichiers critiques

| Fichier | Bloc | Action |
|---|---|---|
| `package.json` | F2 | edit ligne `db:types` (`--linked` → `--project-id <ref>`) |
| `.github/workflows/code-checks.yml` | F1 | create (~30 lignes, mirror `db-drift-pr.yml`) |
| `CLAUDE.md` | closeout | §3 (db:types ligne), §7 (Sprint Code-CI section), §11 (roadmap) |
| `README.md` | closeout | Tests & qualité section + CI line |

**Patterns de référence** :
- [.github/workflows/db-drift-pr.yml](.github/workflows/db-drift-pr.yml) — pattern PR-time gate, path filter, `if: always()`
- [scripts/check-types-fresh.mjs](scripts/check-types-fresh.mjs) — usage de `--project-id` (Sprint Hygiene-CI / E2 hotfix)
- [package.json:14](package.json#L14) — `db:types` actuel à modifier

---

## Verification end-to-end

```powershell
# F2
pnpm db:types                    # exit 0, fichier inchangé byte-pour-byte
git diff lib/database.types.ts   # vide
pnpm db:check-types-fresh        # exit 0
pnpm typecheck                   # exit 0

# F1 (manuel via PR)
# 1. git checkout -b test-f1-typecheck
# 2. casser un type dans lib/finance/piggy-bank.ts
# 3. push, ouvrir PR vers cleanup
# 4. observer code-checks.yml step "TypeScript check" rouge ✗
# 5. restore, push → vert ✓
# 6. répéter avec un test cassé pour valider step "Vitest single run"
# 7. fermer la PR sans merger

# Sanity globale (post sprint)
pnpm typecheck                   # exit 0
pnpm lint:check                  # 136 problèmes pre-existants (hors scope)
pnpm test:run                    # 4 passed, 18 gated skipped
pnpm db:check-drift              # exit 0
pnpm db:check-rpcs               # exit 0
pnpm db:check-functions          # exit 0
pnpm db:check-types-fresh        # exit 0
pnpm db:audit-functions          # exit 0
pnpm db:audit-objects            # exit 0
```

---

## Risques résiduels

1. **F1 — vitest charge `.env.local` qui n'existe pas en CI** : le parser inline (Sprint DB) émet un warning mais ne fail pas. Les tests gated (qui requièrent SUPABASE_*_TESTS env var) sont skipped. Tests non-gated continuent. Pas de problème attendu, à confirmer au premier run.
2. **F1 — le path filter peut être trop large** : `**/*.ts` matche aussi tous les `.ts` dans `lib/`, `app/`, `scripts/`, `hooks/`, etc. C'est le bon défaut pour un repo de cette taille. Si on veut affiner plus tard, on pourra exclure `scripts/` (qui ne change rien au runtime app) — mais aujourd'hui c'est plus sûr d'inclure.
3. **F2 — un dev qui pull avec un local supabase link cache obsolète peut être confus** : leur `supabase link` pointait vers un ancien projet → `pnpm db:types` (avant F2) lisait l'ancien projet. Après F2, ça pointe explicitement vers le bon ref. C'est un fix DX, pas une régression.

---

## Hors scope

- **Lint dans le PR-time gate** : nécessite cleanup des 136 errors d'abord. Sprint séparé.
- **Build (`pnpm build`) dans le PR-time gate** : nécessite env vars Supabase + 30-60s de runtime. Sprint Build-CI séparé si jamais nécessaire.
- **Sprint 1 (Prettier/Husky/ESLint Next 16)** : sprint dédié.
- **Chantiers I4 / I5 / console.log / Zod** : chantiers dédiés.
- **Migration vers Node.js 24** (Sprint Polish-CI / D6 défer).
- **Merge cleanup → main** : décision stratégique, F3 action 3 documente les options sans agir.

---

## Push gate

F1 (création workflow) + F2 (1 ligne package.json) = code-only, pas de prod touchée, pas de migration DB. Pas de confirmation utilisateur requise au-delà de l'approbation de ce plan.

F3 actions 1 et 2 = passives / cosmetiques. Pas de risque.

**Aucun changement DB attendu sur ce sprint.**

**Validation F1** : nécessite ouverture d'une PR test vers `cleanup` puis fermeture. Ne pas merger la PR test (les "casser un type" / "casser un test" sont sciemment introduits, jamais à shipper).

---

## Lessons learned applicables

1. **De Sprint Hygiene-CI / E3 — le bug que la default branch couvrait** : quand on ajoute un nouveau workflow, **vérifier explicitement qu'il fire au moins une fois** (via `workflow_dispatch` ou un PR test) AVANT de le déclarer livré. Sinon on a la trap H5/A4 où un workflow était considéré comme livré pendant 3 sprints sans avoir jamais tourné. Pour F1 : la verif fait partie intégrante du sprint (ouvrir une PR test).

2. **De Sprint Cleanup-Legacy / C3 — le bug `pnpm/action-setup@v4` conflit avec packageManager** : ne PAS mettre `with: version: 9.15.5` dans le YAML. Laisser pnpm/action-setup@v4 lire le `packageManager` package.json. Le `with: version` produit "ERR_PNPM_BAD_PM_VERSION" même quand les deux versions matchent (l'action voit l'integrity hash comme "plus spécifique").

3. **De Sprint Hygiene-CI / E3 — le bug 403 issue creation** : si un workflow a besoin de write API (issues, PRs, etc.), ajouter explicitement le bloc `permissions:` au job level. F1 n'en a pas besoin (lecture seule), mais le pattern est à connaître pour futurs workflows.

4. **De Sprint Hygiene-CI / E2 hotfix — `--linked` vs `--project-id`** : pour tout outil supabase qui doit tourner en CI ou dans un fresh clone, préférer `--project-id <ref>` à `--linked`. F2 généralise cette leçon à `db:types`.

5. **De Sprint Polish-CI / D2 — regex `.+$` vs `\r`** : si F1 ou F2 ajoute du parsing texte, normaliser CRLF→LF AVANT toute regex. Mais aucun parsing texte n'est prévu dans ce sprint.
