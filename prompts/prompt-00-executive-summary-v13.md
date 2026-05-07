# Sprint Stabilize-Deps — `ignore` rules Dependabot + filet post-merge + housekeeping

## Contexte

Sprint DX-Verify (livré 2026-05-07) a apporté `pnpm verify` (G1) et `dependabot.yml` (G2) — premier mécanisme automatique de mises à jour de dépendances. Le défer Node 24 (G3) a été levé par la wave Dependabot qui a mergé `actions/checkout@v6` + `setup-node@v6` + `pnpm/action-setup@v6` sans incident.

**Mais la même wave a aussi exposé 3 cassures réelles**, mergées par le user de bonne foi parce que le PR-time gate (`code-checks.yml`) était vert sur chaque PR Dependabot prise individuellement :

1. **`@supabase/supabase-js` ^2.57.4 → ^2.105.3** (merge `e6f973d`) : 5 erreurs typecheck dans `app/api/monthly-recap/*` causées par `RejectExcessProperties` (typing strict introduit en supabase-js v2.x). Le code legacy avec `[x: string]: any` index signatures ne passe plus.
2. **`react` ^19.1.1 → ^19.2.6 alone** (merge `81902b8`, "multi") : Dependabot a bumpé `react` sans bumper `react-dom` (resté à ^19.1.1), provoquant un runtime error "Incompatible React versions" sur tout render. Le typecheck CI ne le voyait pas (l'invariant React est runtime-only).
3. **`tailwindcss` ^3.4.1 → ^4.2.4** (merge `6b23ea3` + dup `3caefee`) : Tailwind v4 a déplacé le PostCSS plugin dans un package séparé `@tailwindcss/postcss` + nouvelle syntax CSS-first `@import "tailwindcss"`. Compile-time error sur `app/globals.css`.

**Toutes les 3 ont été reverted dans la même session** (6 commits `f3cd8ae → 8d2a509`) :
- f3cd8ae : `git revert -m 1 6b23ea3` (tailwindcss, propre)
- 7989ed2 : fix-forward repin react ^19.1.1 + @types/react ^19.1.13 (revert `-m 1` impossible — conflits lockfile avec les autres merges Dependabot intermédiaires)
- 3e37015 : `pnpm update @supabase/supabase-js@2.57.4` (fix-forward, même raison)
- d5efa82 : ajout group `react-stack` dans dependabot.yml pour empêcher la récidive react/react-dom mismatch
- 21859e4 : `git rm --cached .claude/settings.local.json` + `.gitignore` (collateral sécurité — le fichier embarquait des secrets dans des allow rules Bash)
- 8d2a509 : re-sync `next-env.d.ts` au path Next 16.2.6 (qu'on garde)

**Conservé du wave Dependabot** : Next 16.2.6 (patch), @radix-ui groupé, 4 gh actions v6 (Node 24).

Trois traces résiduelles à traiter dans **ce sprint** :

1. **Sans `ignore` rules, Dependabot va re-proposer les 3 mêmes versions au prochain scan** (lundi 08:00 Europe/Paris). On va re-faire le triage exact, casser CI à nouveau, re-reverter. Boucle infinie tant qu'on ne dit pas explicitement "non" à supabase major + tailwind major.
2. **Le PR-time gate `code-checks.yml` n'a PAS bloqué les casses** parce qu'il ne tourne **que sur `pull_request`**, pas sur `push` vers la default branch. Quand l'utilisateur merge une PR Dependabot via "Merge" UI, GitHub fast-forward la default sans re-trigger les workflows. Conséquence : `cleanup` peut rester rouge pendant des heures avant que quelqu'un (ou le cron weekly) le voie. Le user a découvert la casse en tapant `pnpm dev` localement.
3. **Housekeeping** : 1 stash résiduel (`stash@{0} pre-revert-stash`), 3 closed Dependabot PRs sur GitHub à éventuellement annoter, doc CLAUDE.md à enrichir avec le pattern "Dependabot wave triage workflow".

But du sprint : refermer 1+2 avec **3-4 commits**. Aucune migration DB. Score audit estimé post-sprint : ~82/100.

---

## Approche recommandée

### Bloc S1 — `ignore` rules dans `dependabot.yml` (commit 1)

**Fichier** : [.github/dependabot.yml](../.github/dependabot.yml) — étendre la section `npm`

**Diff cible** (à ajouter dans la section `npm` après les `groups:`) :

```yaml
    ignore:
      # tailwindcss v4 — major rewrite (CSS-first config, @import syntax,
      # @tailwindcss/postcss plugin separation). Reverted at first attempt
      # (Sprint Stabilize-Deps / S0 context). Defer to dedicated Sprint
      # Tailwind-v4 with `npx @tailwindcss/upgrade` auto-migration tool +
      # full visual UI audit (shadcn/ui new-york theme tokens may shift).
      - dependency-name: "tailwindcss"
        update-types:
          - "version-update:semver-major"
      # @supabase/supabase-js v2.105+ — introduced RejectExcessProperties
      # strict typing on .insert()/.update() that breaks 5 typechecks in
      # app/api/monthly-recap/* (legacy code with [x: string]: any index
      # signatures). Reverted Sprint Stabilize-Deps / S0 context. Defer
      # to dedicated Sprint Supabase-Strict-Types — needs concurrent
      # work on monthly-recap insert payloads (non-trivial).
      - dependency-name: "@supabase/supabase-js"
        versions:
          - ">=2.105.0"
      # eslint-config-next 16+ — pinned to 15.0.0 deliberately (Next 16
      # uses a config the v15 plugin still supports; v16 plugin requires
      # ESLint 9 + flat config migration which is Sprint 1 territory).
      - dependency-name: "eslint-config-next"
        versions:
          - ">=16.0.0"
```

**Décisions clés** :
- **`update-types: version-update:semver-major`** pour tailwindcss : bloque tout 4.x.x mais laisse passer 3.4.x.x patches. Cohérent avec "tailwind v4 = sprint dédié, pas un fix in-place".
- **`versions: ">=2.105.0"`** pour supabase-js : plus précis qu'`update-types` parce que c'est une mineure (2.105 ≥ 2.57) qui a introduit le breakage. Sans cette précision, Dependabot bloquerait tout 3.x mais re-proposerait 2.105+. Avec `>=2.105.0`, on autorise 2.57.x → 2.104.x si jamais une fix paraît, mais rien ≥ 2.105 jusqu'au sprint dédié.
- **eslint-config-next** : déjà mentionné dans CLAUDE.md §11 comme réservé Sprint 1. Formaliser dans dependabot.yml évite que la PR re-apparaisse à chaque release.
- **Pas d'ignore pour `react` alone** : déjà mitigé par le group `react-stack` (Sprint DX-Verify follow-up / d5efa82). Si Dependabot re-tente le bump, il fera maintenant les 4 packages ensemble — react/react-dom resteront alignés.
- **Pas de bloc `ignore` dans la section `github-actions`** : la première wave a réussi (4 gh actions v6 mergées sans incident). Pas de pattern problématique observé.

**Verif** :
- Commit + push sur `cleanup`.
- Aller sur GitHub → Insights → Dependency graph → Dependabot tab → "Check for updates" pour forcer un re-scan immédiat.
- Confirmer qu'aucune nouvelle PR n'apparaît pour tailwindcss 4.x.x, supabase-js ≥ 2.105, ou eslint-config-next ≥ 16. (Les 3 PRs closed précédentes resteront fermées.)
- Si une PR existante pour ces 3 deps est encore "Open", Dependabot devrait la fermer automatiquement avec un commentaire "ignored by config".

**Commit message** : `chore(ci): add dependabot ignore rules for tailwindcss v4, supabase-js >=2.105, eslint-config-next >=16 (Sprint Stabilize-Deps / S1)`

---

### Bloc S2 — Filet post-merge sur `cleanup` (commit 2)

**Problème surfacé** : `code-checks.yml` (Sprint Code-CI / F1) ne fire QUE sur `pull_request:`. Quand une PR Dependabot est mergée via UI ("Merge pull request"), GitHub:
1. Crée le merge commit côté serveur.
2. Fast-forward la default branch.
3. Ne re-trigger pas `pull_request` workflows (la PR est closed) ni `push` workflows (parce que le workflow n'a pas `push:` dans `on:`).

Résultat : aucune CI ne valide l'état post-merge de `cleanup`. La cassure peut rester invisible des heures jusqu'à ce qu'un dev pull et fasse `pnpm dev`.

**3 options pour fermer le trou** :

**(A) Étendre `code-checks.yml` à `push: branches: [cleanup]`** :
```yaml
on:
  pull_request:
    paths: [...]
  push:
    branches: [cleanup]
    paths: [...]
```
→ chaque push direct à cleanup re-fire typecheck + tests. Couvre le cas "merge UI" + le cas "git push direct" (qu'on fait régulièrement). Coût : double les runs CI (PR + post-merge), mais fast (~1min). **Recommandé**.

**(B) GitHub branch protection avec required status checks** :
→ Settings → Branches → cleanup → "Require status checks before merging" + "Require branches to be up to date". Empêche le merge si CI rouge. Plus strict mais bloque aussi les pushes directs (qu'on utilise pour les sprints).

**(C) Cron weekly `code-checks-cron.yml`** sur `cleanup` :
→ Catche les régressions tardivement (jusqu'à 7 jours après merge). Pattern miroir de `db-drift-check.yml` (Sprint Hardening / H5). Trop lent pour ce cas d'usage.

**Recommandation : (A)**. Plus simple, plus rapide, pas de friction sur les pushes directs des sprints. (B) est plus strict mais pas adapté au workflow solo actuel.

**Diff cible** dans [.github/workflows/code-checks.yml](../.github/workflows/code-checks.yml) (lignes 1-15 environ) :

```yaml
on:
  pull_request:
    paths:
      - "**/*.ts"
      - "**/*.tsx"
      - "package.json"
      - "pnpm-lock.yaml"
      - "tsconfig.json"
      - "vitest.config.ts"
      - ".github/workflows/code-checks.yml"
  push:
    branches:
      - cleanup
    paths:
      - "**/*.ts"
      - "**/*.tsx"
      - "package.json"
      - "pnpm-lock.yaml"
      - "tsconfig.json"
      - "vitest.config.ts"
      - ".github/workflows/code-checks.yml"
```

**Verif** :
- Commit + push sur `cleanup`.
- Le push lui-même devrait trigger le workflow (puisque le workflow YAML est dans le `paths:` filter et c'est le commit qu'on pousse).
- Observer le run sur Actions tab. Vert = filet activé.
- (Optionnel) Pour valider plus profondément : créer une branche test, casser un type, merger via PR, vérifier que le run "post-merge" ré-exécute typecheck.

**Commit message** : `feat(ci): re-run code-checks on push to cleanup (Sprint Stabilize-Deps / S2)`

---

### Bloc S3 — Documentation Dependabot triage workflow + housekeeping (commit 3-4)

**3a — CLAUDE.md** : ajouter une sous-section dans §8 "À faire / À ne pas faire" :

```markdown
- **Quand une PR Dependabot est mergée** : 
  1. Pull la default branch (`git pull origin cleanup`).
  2. `pnpm install` pour aligner les modules locaux sur le nouveau lockfile.
  3. `pnpm verify` (Sprint DX-Verify / G1) — exit 0 attendu.
  4. **Si typecheck/tests passent**, démarrer `pnpm dev` et hit `curl http://localhost:3000/` au moins une fois — le PR-time gate ne couvre pas les régressions runtime (e.g. react/react-dom version mismatch, tailwindcss v4 PostCSS plugin missing, qui ne se voient qu'au compile CSS / au premier render).
  5. **Si une PR Dependabot a cassé quelque chose** : suivre le workflow capture-then-revert documenté dans [docs/audit/POST-MORTEM-DEPENDABOT-WAVE.md](docs/audit/POST-MORTEM-DEPENDABOT-WAVE.md) (TODO Sprint Stabilize-Deps / S3) — fix-forward via `pnpm update <pkg>@<version>` + commit "revert: re-pin <pkg> to <version>" est plus simple que `git revert -m 1 <merge>` quand des merges intermédiaires touchent le même lockfile.
  6. **Au moindre doute sur un major bump**, fermer la PR sans merger et ajouter un `ignore` dans `dependabot.yml` (cf. Sprint Stabilize-Deps / S1 pour le pattern).
```

**3b — Optionnel : POST-MORTEM-DEPENDABOT-WAVE.md** dans `docs/audit/` :
- Pattern miroir de [POST-MORTEM-C3-DRIFT.md](docs/audit/POST-MORTEM-C3-DRIFT.md).
- Documente : 3 régressions de la wave 2026-05-07, root cause par dep, workflow capture-then-revert vs revert -m 1 (lockfile conflicts), leçons (ajout du group `react-stack`, ajout des `ignore` rules S1, ajout du filet post-merge S2).
- ~80 lignes, valeur historique pour ne pas refaire les mêmes 3 erreurs.

**3c — Housekeeping** :
- `git stash drop stash@{0}` (le `pre-revert-stash` n'est plus pertinent — `next-env.d.ts` ancien path et `.claude/settings.local.json` avec secrets).
- (Manuel) GitHub : aller sur les 3 closed Dependabot PRs (tailwindcss-4.2.4, multi-react, supabase) et ajouter un commentaire pointant vers Sprint Stabilize-Deps / S1 pour expliquer pourquoi elles ne ré-apparaîtront pas.
- (Manuel) Si tu as un onglet ouvert sur la PR Dependabot eslint-config-next 16+ encore "Open" : la fermer aussi maintenant que S1 ajoute l'ignore.

**3d — README.md** : mention rapide du filet post-merge S2 dans la section Tests & qualité (1 phrase).

**Commit messages** :
- `docs: document Dependabot wave triage workflow + post-mortem (Sprint Stabilize-Deps / S3)`
- (Si housekeeping git séparé) `chore: drop pre-revert-stash from Sprint DX-Verify follow-up`

---

## Ordre d'exécution

1. **S1** (1 commit) — ajout des `ignore` rules. **À faire en premier** pour stopper l'hémorragie au prochain scan Dependabot.
2. **S2** (1 commit) — extension `code-checks.yml` à `push: branches: [cleanup]`. Test simple : le push lui-même va trigger le workflow → on observe vert.
3. **S3a/3d** (1 commit) — CLAUDE.md + README.md updates.
4. **S3b** (1 commit optionnel) — POST-MORTEM-DEPENDABOT-WAVE.md dans `docs/audit/`. Pas indispensable mais valeur historique.
5. **3c** (housekeeping local + manuel sur GitHub).
6. **Closeout** — 1 commit final si nécessaire pour finaliser CLAUDE.md/README.md.

**Total : 3-4 commits sur `cleanup`**. Aucune migration DB. Aucun changement prod.

---

## Fichiers critiques

| Fichier | Bloc | Action |
|---|---|---|
| [.github/dependabot.yml](../.github/dependabot.yml) | S1 | Ajouter section `ignore` dans `npm` ecosystem |
| [.github/workflows/code-checks.yml](../.github/workflows/code-checks.yml) | S2 | Ajouter `push: branches: [cleanup]` à `on:` |
| [CLAUDE.md](../CLAUDE.md) | S3a | §8 sous-section "Quand une PR Dependabot est mergée" |
| [README.md](../README.md) | S3d | Section Tests & qualité — mention filet post-merge |
| [docs/audit/POST-MORTEM-DEPENDABOT-WAVE.md](../docs/audit/POST-MORTEM-DEPENDABOT-WAVE.md) | S3b | Création (optionnel) |

**Patterns de référence (read-only, déjà validés)** :
- [.github/workflows/code-checks.yml](../.github/workflows/code-checks.yml) — pattern existant `pull_request:` + `paths:`
- [.github/workflows/db-drift-check.yml](../.github/workflows/db-drift-check.yml) — pattern `schedule:` + `workflow_dispatch:` (référence pour S2 si on choisit option C)
- [docs/audit/POST-MORTEM-C3-DRIFT.md](../docs/audit/POST-MORTEM-C3-DRIFT.md) — pattern post-mortem (référence S3b)

---

## Verification end-to-end

```powershell
# S1 — local sanity (pas de validateur YAML local sans gh CLI)
# Lecture visuelle de .github/dependabot.yml
# Push sur cleanup
# Trigger : Settings → Dependabot tab → "Check for updates"
# Confirmer aucune nouvelle PR pour les 3 patterns ignored

# S2 — local sanity
# Lecture visuelle de .github/workflows/code-checks.yml
# Le push lui-même trigger le workflow (paths: includes le YAML)
# Observer Actions tab → run vert sur le push

# S3 — closeout
pnpm verify                      # exit 0 (les 8 checks)
```

**Push gate** : tout = code-only, pas de prod, pas de migration DB. Pas de confirmation utilisateur supplémentaire au-delà de l'approbation de ce plan. Push sur `cleanup` direct.

---

## Hors scope

- **Sprint Tailwind-v4** dédié — utiliser `npx @tailwindcss/upgrade`, audit visuel UI complet, vérif shadcn/ui new-york theme tokens, regen des CSS variables, possible bump @ducanh2912/next-pwa si compat issue.
- **Sprint Supabase-Strict-Types** dédié — refactor des 5 sites `app/api/monthly-recap/*` pour satisfaire `RejectExcessProperties`. Implique probablement de typer explicitement les inserts au lieu de spreader des objets `[x: string]: any`. Couplé avec chantier I5 (extraction logique métier process-step1) qui est déjà roadmappé.
- **Sprint 1 Prettier/Husky/eslint-config-next 16** — déjà roadmappé séparément.
- **Branch protection (option B)** — workflow solo actuel n'en a pas besoin. À ré-évaluer si le repo s'ouvre.
- **Coverage report Vitest** — séparé.
- **Chantiers I4 / I5 / console.log / Zod rollout** — chantiers dédiés.

---

## Risques résiduels

1. **S1 — un `ignore` mal calibré** peut bloquer une release de sécurité critique (CVE patch dans tailwindcss 4.x.x par exemple). Mitigation : les `ignore` ciblent volontairement des plages restrictives (e.g. `tailwindcss` major uniquement, pas patches), et on peut toujours les retirer manuellement.
2. **S2 — le filet `push:` double le coût CI** : ~1min/run × 2 (PR + post-merge) sur les pushes touchant le code TS. Acceptable (filet contre une vraie classe de bug).
3. **S3 — POST-MORTEM peut devenir bullet-point cargo cult** s'il n'est pas relu lors de la prochaine wave. Mitigation : référence depuis CLAUDE.md §8.
4. **Dependabot peut quand même proposer un bump qui casse autrement** (e.g. radix-ui qui change une prop) — les `ignore` ne couvrent que les 3 cas connus. Le filet S2 + `pnpm verify` + smoke `pnpm dev` restent la défense en profondeur.

---

## Lessons learned applicables

1. **De Sprint DX-Verify follow-up (cette session)** : la valeur de `pnpm verify` apparaît exactement quand le filet PR-time fait défaut. Le user l'a tapé localement après le merge de la wave Dependabot et c'est ce qui a surfacé les 3 erreurs typecheck supabase. Sans `pnpm verify`, on aurait découvert la cassure beaucoup plus tard (au prochain dev session).
2. **De Sprint DX-Verify follow-up** : `git revert -m 1` sur des merges Dependabot enchaînés produit des conflits lockfile presque toujours (autres merges touchent les mêmes lignes). Le pattern fix-forward (`pnpm update <pkg>@<version>` + commit "revert: re-pin") est plus pragmatique.
3. **De Sprint Hygiene-CI / E3** : le pattern "première vraie boucle de feedback CI révèle les bugs cachés" se confirme. Sprint Stabilize-Deps / S2 est exactement ce filet manquant côté code-side (le côté DB l'avait depuis Sprint Hardening / H5).
4. **De Sprint Audit-Functions-v2 / B3** : path filter étendu aux YAMLs eux-mêmes. Pour S2, vérifier que `code-checks.yml` est dans le `paths:` du nouveau `push:` block (sinon casser le filet ne le redéclenche pas pour le détecter).
