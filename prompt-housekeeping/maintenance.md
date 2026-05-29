# Prompt housekeeping — vulnérabilités Dependabot + format + triage

> Créé 2026-05-29 après le sprint Planner-RAV-Color (Part 38). Snapshot des problèmes
> repérés à ce moment-là. **Étendu 2026-05-29** (Tâche 4) en clôturant le sprint
> Exceptional-Expense-Piggy-Funding (RPC `add_exceptional_expense_with_piggy`). **Usage** :
> coller le contenu sous la ligne `---` dans une nouvelle session Claude Code ouverte sur la
> branche `dev`. Réviser le compte de vulnérabilités au moment de l'exécution (il peut avoir
> changé). Les items des Tâches 3 et 4 sont en partie optionnels — Claude doit confirmer le
> périmètre avant de les attaquer.

---

Tâche : housekeeping / hygiène repo Popoth (branche `dev`). Plusieurs problèmes repérés après
le sprint Planner-RAV-Color. Traite-les comme des items séparés (1 commit Conventional par
item), en respectant strictement les conventions du CLAUDE.md (que tu viens de charger). Avant
de commencer, fais un court plan et confirme le périmètre avec moi (certains items sont
optionnels). Ne lis JAMAIS la valeur d'un secret (`.env.local`, tokens).

## Tâche 1 — Vulnérabilités Dependabot (PRIORITÉ HAUTE)

GitHub signalait 4 vulnérabilités au 2026-05-29 (3 high, 1 moderate) :
https://github.com/PothieuG/popoth/security/dependabot

1. Énumère-les localement : `pnpm audit --audit-level=moderate` (donne package, sévérité,
   chemin, version patchée). Croise avec l'onglet Security si besoin. Si `gh` est disponible :
   `gh api repos/PothieuG/popoth/dependabot/alerts --paginate --jq '.[] | select(.state=="open")'`.
   `gh` n'était PAS installé dans la session qui a généré ce prompt — s'il est absent,
   demande-moi de coller le détail des alertes.
2. Pour chaque vulnérabilité, triage :
   - Dépendance **transitive** (absente de `dependencies`/`devDependencies`) → ajoute/ajuste
     une entrée dans `pnpm.overrides` (package.json) pour épingler la version patchée. Le repo
     utilise déjà ce mécanisme (ajv, brace-expansion, flatted, glob, js-yaml, lodash,
     minimatch…). Reste cohérent avec ce style.
   - Dépendance **directe** → bump via la skill `/update-package <name>` (elle vérifie la
     compat Next 16 / React 19 / TS strict + valide tout le pipeline). NE bump PAS à la main.
3. Contraintes :
   - Respecte la règle `ignore` de `.github/dependabot.yml` : `eslint-config-next >=16.0.0`
     reste bloqué (migration ESLint 9 / flat config = chantier séparé). Si une des vulns
     concerne `eslint-config-next`, ne force PAS le major — signale-le-moi.
   - ❌ JAMAIS `pnpm self-update` sans version explicite (bumpe silencieusement le pin
     `packageManager`, incident 2026-05-20). Pin actuel `pnpm@9.15.5`.
   - Fix-forward, pas de `git revert`.
   - Note : `dependabot.yml` a `target-branch: cleanup` (legacy) — les PRs Dependabot ne
     ciblent pas `dev`. On applique donc les correctifs directement sur `dev`.
4. Validation : `pnpm install` puis `pnpm verify` (ou au minimum `pnpm ci`), et démarre
   `pnpm dev` + un hit `http://localhost:3000/` (cf. git-workflow.md §9 — les bumps cassent
   parfois au runtime / compile-CSS, invisible au typecheck). Re-lance `pnpm audit` pour
   confirmer 0 vuln restante (hors celles couvertes par un `ignore` justifié).
5. Commit : `fix(deps): patch <N> vulnérabilités Dependabot (<packages>)` (ou `chore(deps)` si
   bumps mineurs sans CVE). Si tu touches `pnpm.overrides`, explique chaque override en
   commentaire inline.

## Tâche 2 — 3 scripts seed-recap en échec `format:check` (RAPIDE)

`pnpm format:check` échoue sur 3 fichiers PRÉ-EXISTANTS (non liés au dernier sprint) :

- `scripts/seed-recap/project-deficit-catastrophe.mjs`
- `scripts/seed-recap/project-deficit-refloat.mjs`
- `scripts/seed-recap/project-deficit-stops-before.mjs`

1. Formate-les :
   `pnpm exec prettier --write scripts/seed-recap/project-deficit-catastrophe.mjs scripts/seed-recap/project-deficit-refloat.mjs scripts/seed-recap/project-deficit-stops-before.mjs`
   (NE lance PAS `pnpm format` global — diff mécanique massif interdit en PR feature). Vérifie
   ensuite `pnpm format:check` (les 3 doivent disparaître ; s'il reste d'AUTRES `.mjs` non
   formatés, formate-les aussi, scope `scripts/**`).
2. CAUSE RACINE à corriger : la config `lint-staged` (package.json) couvre `*.{ts,tsx}` et
   `*.{json,md,yml,yaml,css}` mais PAS `.mjs`/`.cjs`/`.js` → les scripts Node dérivent et seul
   `format:check` (global) les attrape, jamais le pre-commit. Ajoute un glob lint-staged
   `"*.{mjs,cjs,js}": ["prettier --write"]` pour fermer le trou durablement. Vérifie qu'aucun
   autre `.mjs`/`.js` du repo n'est alors reformaté de façon inattendue.
3. Commit : `style(scripts): format seed-recap + couvre .mjs dans lint-staged`.

## Tâche 3 — Autres problèmes repérés (TRIAGE — confirme avec moi avant)

Par ordre de priorité décroissante :

**A. [TEST gated cassé]** `lib/finance/__tests__/financial-data-with-projects.test.ts` case 2
(`group + 1 project 50€/mois`) : l'assertion `withProject.remainingToLive === baselineRav - 50`
est fausse depuis Sprint PÉ-12 (migration `20260604000000_sync_group_budget_on_project_change`
propage les projets dans `monthly_budget_estimate` → la contribution compense la baisse de
RAV). Ne casse que sous `SUPABASE_FINANCE_TESTS=1`. Corriger/réécrire l'assertion pour refléter
la sémantique actuelle (documenté Part 37 §Tests "pre-existing failure non-related").
→ `test(finance): fix assertion group-project RAV post-PÉ-12`.

**B. [Doc incohérente]** CLAUDE.md §9 dit "447 non-gated + 158 gated skipped" / "Total : 447"
alors que §5.5 dit "823 non-gated / 234 gated" (canonique). Reconcilie §9 sur §5.5 (+ le
wording "Total"). ⚠️ Cap 39.5k : CLAUDE.md est à ~39 391 — édition net-neutre ou trim
équivalent (cf. `.claude/guardrails/size-policy.md`). Mesure avec `pnpm check:md-size`.

**C. [Dead code serveur]** `meta.groupSalaryTotal` + `meta.groupMembersPersonalRavTotal` sont
calculés dans `lib/finance/financial-data.ts` mais n'ont PLUS de consommateur UI depuis le
sprint Planner-RAV-Color (Part 38). Décide avec moi : (a) les supprimer (financial-data.ts +
`types.ts` `FinancialData.meta` + assertions `financial-data.test.ts`), ou (b) les garder
(contrat meta, calcul trivial). C'est du calcul applicatif, pas DB (db:audit-\* non impacté).
→ `refactor(finance): drop meta group totals UI-unused`.

**D. [Pré-release]** Avant tout merge `dev → main` (prod) : vérifier `pnpm db:check-types-fresh`.
`lib/database.types.ts` a possiblement été régénéré depuis DEV dans une session précédente
(cf. `multi-env.md` §5) — il DOIT être régénéré depuis PROD (`pnpm db:types`) avant release
sinon l'invariant casse. À faire au moment de la release, pas en avance.

**E. [Dette doc / cap 39.5k]** `.claude/history/sprint-chronology-part-2.md` (≈ 39 267) est
saturée : tableau markdown dont la colonne "Pattern" est paddée à ~1900 chars, donc ajouter
une ligne = +~2000 chars (dépassement). Avant de pouvoir y logger de nouveaux sprints, créer
`sprint-chronology-part-3.md` (split chronologique préemptif, size-policy §7) + pointeur. De
même `CLAUDE.md` (≈ 39 391), `operational-rules.md` (≈ 39 249), `operational-rules-ui-modals.md`
(≈ 39 268) sont en zone d'alerte = candidats refactor. Optionnel / cosmétique.

## Tâche 4 — Suivi du sprint Exceptional-Expense-Piggy-Funding (2026-05-29)

> Items générés en finalisant la feature « financer une dépense exceptionnelle avec la tirelire »
> (migration `20260608000000`, RPC `add_exceptional_expense_with_piggy`). La feature elle-même est
> livrée et verte (typecheck + lint 0/0 + tests 842/242 + tous les `db:*` checks). Ce sont des
> items de **suivi**, pas des régressions. Le point « format » remonté à ce moment-là est déjà la
> **Tâche 2** ci-dessus (toujours ouverte) — ne pas le dupliquer.

**A. [Environnement DB cassé — PRIORITÉ HAUTE, action UTILISATEUR]** `supabase db push` échoue :
`SUPABASE_DB_PASSWORD` ne s'authentifie plus contre prod (`failed SASL auth ... password
authentication failed for user "postgres" (SQLSTATE 28P01)` sur `db.jzmppreybwabaeycvasz.supabase.co`).
Claude ne peut PAS corriger ça (et ne doit jamais lire/coller le secret). À faire par l'utilisateur :
reset le mot de passe DB (Supabase Dashboard → Project Settings → Database → Reset database password)
puis mettre à jour la variable persistée `SUPABASE_DB_PASSWORD` (User env), et redémarrer la session.
Tant que ce n'est pas réglé, toute migration future passe par `node scripts/apply-sql.mjs <fichier>`
(Management API via `SUPABASE_ACCESS_TOKEN`, qui lui fonctionne) — mais ce workaround NE met PAS à
jour le tracker `schema_migrations` (cf. B).

**B. [Migration RPC non trackée — dépend de A]** La migration
`20260608000000_create_add_exceptional_expense_with_piggy_rpc.sql` a été appliquée en **prod ET dev**
via `apply-sql.mjs` (la fonction EST présente : `pnpm db:check-rpcs` retourne 29/29 OK ;
`pnpm db:check-drift` / `db:audit-functions` OK), mais elle n'est PAS enregistrée dans
`schema_migrations` (apply-sql ne track pas). Une fois A réglé, la register sur les **deux** projets :
`supabase migration repair --status applied 20260608000000` (prod par défaut, puis
`$env:SUPABASE_PROJECT_REF='ddehmjucyfgyppfkbddr'` + repair pour dev), OU un `supabase db push` qui
ré-applique le `CREATE OR REPLACE FUNCTION` (idempotent) et l'enregistre. Vérifier avec
`supabase migration list` (les deux DBs doivent montrer `20260608000000` appliquée). Sans ça, un
futur `db push` voudra la ré-appliquer — inoffensif (idempotent) mais le tracker reste désynchronisé.

**C. [Test gated à exécuter une fois]** `lib/finance/__tests__/add-exceptional-expense-with-piggy.test.ts`
(8 cas : débit partiel `P<A` / couverture totale `P=A` / overdraft → rollback atomique / XOR contexte /
compte neuf sans ligne piggy / round-trip create→`delete_expense_with_sources_refund` rendant la
tirelire / 30 créations concurrentes) est écrit + typé mais JAMAIS exécuté (gated
`SUPABASE_RPC_CONCURRENCY_TESTS=1` ; il crée de vrais users + rows). Le lancer **contre DEV** : bloc
dev actif dans `.env.local`, puis
`$env:SUPABASE_RPC_CONCURRENCY_TESTS='1'; pnpm exec vitest run lib/finance/__tests__/add-exceptional-expense-with-piggy.test.ts`.
Confirmer les 8 verts (cleanup `afterAll` supprime les fixtures). ⚠️ NE PAS lancer contre prod.

**D. [Doc roadmap manquante — bloquée par cap 39.5k]** Le sprint Exceptional-Expense-Piggy-Funding
n'a pas encore d'entrée d'historique : créer `.claude/history/roadmap-detailed-39-exceptional-expense-piggy.md`
(closeout verbatim — modal toggle tirelire, RPC atomique, RAV = part propre argent uniquement,
delete→refund via `delete_expense_with_sources_refund`, lock édition 409 + UI) + ajouter la ligne
« Part 39 » dans CLAUDE.md §11 (index + « Dernier »). ⚠️ CLAUDE.md est à ~39 388 / 39 500 → pas de
place pour la ligne §11 sans trim équivalent au préalable (voir 3.E + `size-policy.md`). Les
**invariants chiffrés sont DÉJÀ à jour** (§5.5 : 29 RPCs, 44/44 fn, 842 non-gated / 242 gated ;
`scripts/check-rpcs.mjs` inclut `add_exceptional_expense_with_piggy`). Item cosmétique/dette doc —
confirmer avec moi (peut attendre un refactor CLAUDE.md).

## Règles transverses

- 1 item = 1 commit Conventional Commits (types : feat/fix/chore/docs/perf/test/refactor/style/
  revert/build/ci ; header ≤ 100). JAMAIS `--no-verify` / `--no-gpg-sign` / `--force`.
- Ne formate QUE les fichiers que tu touches (jamais `pnpm format` global). `lint-staged`
  formate les staged au commit.
- Cap dur 39.5k sur tous les `.md` de contexte (hook PostToolUse + pre-commit). Mesure avant
  d'éditer un `.md` proche du cap.
- Gates bloquantes : `pnpm typecheck`, `pnpm lint:check` (0/0), `pnpm format:check`. Le pre-push
  relance lint:check + typecheck.
- Après chaque item validé : push sur `origin dev`.
- Si un secret est requis (`SUPABASE_ACCESS_TOKEN`…) et manquant, demande-moi de le set
  moi-même (ne jamais le coller dans le chat).
