# Sprint DX-Verify — meta-script `pnpm verify` + Dependabot, ré-éval Node 24 défer

## Contexte

Sprint Code-CI (livré 2026-05-07, 3 commits sur `cleanup` `0c47f31 → cfdbc80`) a fermé F1–F3 et fait passer le score audit ~79 → ~80/100 (premier vrai franchissement du seuil 80). F1 a apporté le premier filet code-side (PR-time gate `pnpm typecheck` + `pnpm test:run`) et F2 a aligné `pnpm db:types` sur `--project-id` pour les fresh clones. F3#3 (observation cron lundi 08:00 UTC) reste à observer passivement post-sprint.

Sprint Code-CI a aussi mis en évidence **2 traces résiduelles** qu'aucun sprint précédent n'a adressées explicitement, plus **1 défer dont la date de ré-éval est passée** :

1. **La "sanity sweep" post-sprint n'est pas codifiée.** Chaque closeout des 7 derniers sprints a fini par lancer manuellement la même séquence de 8 commandes (`pnpm typecheck`, `pnpm test:run`, `pnpm db:check-drift`, `pnpm db:check-rpcs`, `pnpm db:check-functions`, `pnpm db:check-types-fresh`, `pnpm db:audit-functions`, `pnpm db:audit-objects`). La séquence vit dans la mémoire des devs et dans les sections Verification des prompts v3..v11. Risques concrets : (a) on en oublie une au prochain sprint et un drift passe inaperçu ; (b) chaîner les 4 supabase API calls dans une seule invocation PowerShell crashe parfois avec `STATUS_STACK_BUFFER_OVERRUN` (observé pendant la verif Sprint Code-CI) — un script qui les sépare proprement éviterait ça ; (c) un nouvel arrivant ne sait pas par où commencer pour valider son env. Un meta-script `pnpm verify` consoliderait le pattern.

2. **Aucun mécanisme automatique pour les mises à jour de dépendances.** Les runs CI Sprint Code-CI ont fait remonter "pnpm 9.15.5 (11.0.8 is available)" et "baseline-browser-mapping over two months old". Sans Dependabot (ou équivalent), les deps drifent silencieusement entre les sprints — risque CVE non patché + drift de fond. Maintenant qu'on a un PR-time gate code-side (Sprint Code-CI / F1) ET DB-side (Sprint Audit-Functions-v2 / B3), on peut accepter sereinement des PRs auto-générées sans craindre une régression non détectée. C'est exactement le type d'amplificateur que le filet CI rend possible.

3. **Défer Sprint Polish-CI / D6 (GH Actions Node.js 24) — date de ré-éval dépassée.** Le défer disait "Ré-évaluer en avril 2026". On est 2026-05-07. La forced switch est le **2 juin 2026** — ~3-4 semaines. Les warnings Node.js 20 ont été observés en CI sur les 2 runs Sprint Code-CI / F1. La stratégie "wait and see" était valide quand on était plusieurs mois avant la deadline, mais maintenant la fenêtre se rétrécit. Décision à prendre : (a) migrer maintenant proactivement (bump `actions/checkout@v4 → @v5`, `actions/setup-node@v4 → @v5`, `pnpm/action-setup@v4 → @v5` si v5 supporte Node 24) ; (b) confirmer le wait-and-see jusqu'au 2 juin.

But du sprint : refermer 1+2 avec **2-3 commits**, et statuer sur 3. Pas de migration DB. Score audit estimé post-sprint : ~81/100 (gain modeste — surtout DX/maintenance, pas sécurité).

---

## Approche recommandée

### Bloc G1 — `pnpm verify` meta-script (commit 1)

**Fichier** : [package.json](../package.json) — nouveau script

**Diff** :
```diff
   "db:audit-functions": "node scripts/audit-functions.mjs",
-  "db:audit-objects": "node scripts/audit-db-objects.mjs"
+  "db:audit-objects": "node scripts/audit-db-objects.mjs",
+  "verify": "pnpm typecheck && pnpm test:run && pnpm db:check-drift && pnpm db:check-rpcs && pnpm db:check-functions && pnpm db:check-types-fresh && pnpm db:audit-functions && pnpm db:audit-objects"
```

Pourquoi `&&` et pas `;` : on veut **fail-fast** — si typecheck échoue, pas la peine de spawner les 7 autres. Ça aussi mitigerait potentiellement le `STATUS_STACK_BUFFER_OVERRUN` Windows observé pendant Sprint Code-CI sanity sweep (chaîner 4 supabase API calls back-to-back en une seule invocation PowerShell). Note : `&&` cross-platform est OK avec npm/pnpm scripts (pas un bug PowerShell-only puisque les scripts pnpm spawn un sous-shell).

**Décisions clés** :
- **Inclure tous les 8 checks** : ne PAS filtrer "rapides" vs "lents" — la valeur du meta est la complétude. Un dev qui veut juste typecheck tape `pnpm typecheck` directement.
- **Pas de cron / CI wirage** : `pnpm verify` est un outil de **dev local**, pas un workflow CI. Le PR-time gate Sprint Code-CI / F1 et le cron weekly Sprint Hardening / H5 couvrent déjà le CI side. Doubler avec `pnpm verify` en CI serait redondant + 4× le coût supabase API.
- **Doc à jour** : ajouter `pnpm verify` à CLAUDE.md §3 + README.md Tests & qualité section.
- **Pas de variante `verify:db-only` ou `verify:code-only`** : YAGNI. Si quelqu'un veut juste DB, il enchaîne les 6 db:* scripts à la main.

**Verif end-to-end** :
1. `pnpm verify` sur `cleanup` clean → exit 0, 8 checks séquentiels verts.
2. Mesurer durée totale (estimé ~30-40s cumulés : typecheck ~8s, test:run ~1s, 4 db checks ~5s chacun, 2 audits ~3s chacun).
3. Casser un type sciemment → confirmer fail-fast à l'étape 1, étapes 2-8 non lancées.
4. Restore.

**Risques** :
1. Si `pnpm db:check-drift` ou un autre check exit 1 légitimement (drift réel détecté), `pnpm verify` exit 1. C'est le bon comportement — c'est un détecteur, pas un fix.
2. Le STATUS_STACK_BUFFER_OVERRUN Windows pourrait se reproduire. Mitigation : `&&` au lieu de `;` espace mieux les spawns. Si ça se reproduit, fallback est de splitter en 2 scripts `verify:fast` + `verify:db`.

Commit conventionnel : `feat(scripts): add pnpm verify meta-script (Sprint DX-Verify / G1)`.

---

### Bloc G2 — `.github/dependabot.yml` (commit 2)

**Fichier à créer** : [.github/dependabot.yml](../.github/dependabot.yml)

**Goal** : Dependabot ouvre des PRs auto chaque lundi (jour cohérent avec le cron drift-check H5/A4) pour (a) npm/pnpm deps, (b) GitHub Actions versions. Le PR-time gate Sprint Code-CI / F1 + Sprint Audit-Functions-v2 / B3 gate ces PRs avant merge.

**Contenu cible** :
```yaml
# Dependabot — auto-PR weekly for outdated deps and GitHub Actions versions.
# PRs are gated by code-checks.yml (Sprint Code-CI / F1) and db-drift-pr.yml
# (Sprint Audit-Functions-v2 / B3) so we can merge with confidence.
#
# Sprint DX-Verify / G2.

version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "08:00"
      timezone: "Europe/Paris"
    open-pull-requests-limit: 5
    target-branch: cleanup
    commit-message:
      prefix: chore
      include: scope
    labels:
      - dependencies
      - npm
    groups:
      # Group radix-ui together — they're released in lockstep.
      radix-ui:
        patterns:
          - "@radix-ui/*"
      # Group supabase together for the same reason.
      supabase:
        patterns:
          - "@supabase/*"
          - "supabase"
      # Group eslint-related so PR doesn't fragment.
      eslint:
        patterns:
          - "eslint*"
          - "@eslint/*"
      # Group test stack.
      test-stack:
        patterns:
          - "vitest"
          - "@vitest/*"

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "08:00"
      timezone: "Europe/Paris"
    open-pull-requests-limit: 5
    target-branch: cleanup
    commit-message:
      prefix: chore
      include: scope
    labels:
      - dependencies
      - github-actions
```

**Décisions clés** :

- **`target-branch: cleanup`** : la default branch GitHub est `cleanup` depuis Sprint Hygiene-CI / E3. Sans ce paramètre, Dependabot pousserait vers la default (qui EST cleanup), donc explicite mais redondant. Garde-le pour clarté.
- **`open-pull-requests-limit: 5`** : par ecosystem. Dépendance modérée, pas la peine d'inonder.
- **Groups** : radix-ui releases en lockstep, supabase aussi (CLI + JS SDK), eslint plugin écosystème idem, test stack vitest + coverage. Sans groups, on aurait 3-5 PRs séparées par semaine pour les radix-ui seuls. Réduit le bruit.
- **`labels`** : pour filtrage facile dans la PR list.
- **GH Actions section** : Dependabot va proposer `actions/checkout@v4 → @v5` etc. quand v5 sortira — directement utile pour le défer Node 24 (cf. Bloc G3).
- **Pas de `reviewers`** : pas d'équipe formelle, le repo est solo. Dependabot ne peut pas s'auto-assigner.
- **Pas de `versioning-strategy: increase` explicite** : le default `auto` respecte le pinning du `package.json` (`^...` etc.) ce qui est ce qu'on veut.
- **Pas d'allow/ignore listes** : laisser tout updater. Si une dep devient problématique, on adresse au cas par cas (e.g. `eslint-config-next` 15→16 est volontairement pinned pour Sprint 1 — Dependabot va proposer le bump, on close la PR avec un commentaire).

**Verif** :
1. Commit + push sur cleanup. Dependabot config est lue au prochain scan (heure/jour de la prochaine fenêtre, ou immédiat si on trigger via Settings → Code security and analysis).
2. Trigger manuel via Insights → Dependency graph → Dependabot tab → "Last checked" + "Check for updates".
3. Observer la 1re vague de PRs ouvertes — confirmer qu'elles target `cleanup` et que `code-checks.yml` + `db-drift-pr.yml` se déclenchent.
4. Première semaine de PRs : peuvent être nombreuses (catch-up des updates manqués depuis la création du repo). Les triager — merger les non-breaking, fermer celles qu'on veut tenir.

**Risques** :
1. **Première vague volumineuse** — peut surfacer des breaking changes (e.g. major bumps). Le PR-time gate les attrape, mais demande du triage. À prévoir comme follow-up post-sprint.
2. **eslint-config-next 15→16** — Dependabot va proposer ce bump. **Ne PAS merger** (CLAUDE.md §11 — incompatible Next 16, Sprint 1 séparé). Solution : commenter la PR avec lien vers Sprint 1, fermer.
3. **Dependabot peut-il accéder à pnpm-lock.yaml ?** Yes, depuis 2024 Dependabot supporte natively pnpm v9+. `package_json_file: package.json` qu'on n'a pas mis n'est requis que si non-standard. Default OK.

Commit conventionnel : `feat(ci): add dependabot config for weekly npm + actions updates (Sprint DX-Verify / G2)`.

---

### Bloc G3 — Décision Node 24 défer (folded dans closeout, ou commit 3 si action)

**Goal** : statuer sur le défer Sprint Polish-CI / D6 maintenant que la date de ré-éval (avril 2026) est passée et qu'on est ~3-4 semaines de la forced switch (2 juin 2026).

**3 chemins** :

**(a) Migrer proactivement** :
1. Vérifier les release notes : `actions/checkout@v5`, `actions/setup-node@v5`, `pnpm/action-setup@v5` existent-elles + supportent Node 24 ?
2. Bump dans les 3 YAML : `db-drift-pr.yml`, `db-drift-check.yml`, `code-checks.yml`.
3. Re-trigger une PR test pour confirmer que les workflows tournent vert sur Node 24.
4. Update CLAUDE.md §11 défer : "✅ migré proactivement" au lieu de "⏭️ wait-and-see".

**(b) Confirmer wait-and-see jusqu'au 2 juin** :
- Pas de code change.
- Closeout doc : "défer maintenu jusqu'au 2 juin 2026, observation requise sur le 1er run après la forced switch".

**(c) Setter `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` sur le runner** (env var) :
- Pas un bump des actions, juste forcer le runtime à Node 24 pour les actions actuelles.
- Avantage : test "vraie" exécution Node 24 sur les v4 actions sans changer le pinning.
- Risque : si l'action v4 a du code Node 20-only, ça crashe. Plus tôt qu'attendu.

**Recommandation** : **(a) migrer proactivement** si Dependabot G2 a déjà ouvert les PRs `actions/*@v5` (ce qu'il fera dans les jours suivants la livraison G2) — alors c'est juste 3 PR merges. Sinon (b) jusqu'au 2 juin. **Ne PAS faire (c)** — risque asymétrique.

Si le sprint exécute (a) : 1 commit dédié `chore(ci): bump actions to v5 for Node 24 support (Sprint DX-Verify / G3)`. Si (b) : pas de commit, juste closeout doc.

---

## Ordre d'exécution

1. **G1** (1-line addition package.json + verif local). 1 commit `feat(scripts):`.
2. **G2** (création YAML). 1 commit `feat(ci):`. Verif via Settings → Dependabot trigger.
3. **G3** (décision et éventuelle action). 0 ou 1 commit.
4. **Closeout** (CLAUDE.md §3 verify/§9 verify/§11 + README.md Commandes/Tests sections). 1 commit `docs:`.

**Total : 3-4 commits sur `cleanup`**. Aucune migration DB. Aucun changement prod.

---

## Fichiers critiques

| Fichier | Bloc | Action |
|---|---|---|
| `package.json` | G1 | append `verify` script (~1 ligne) |
| `.github/dependabot.yml` | G2 | create (~50 lignes) |
| `.github/workflows/db-drift-pr.yml` | G3 (a) | bump action versions si on migre |
| `.github/workflows/db-drift-check.yml` | G3 (a) | idem |
| `.github/workflows/code-checks.yml` | G3 (a) | idem |
| `CLAUDE.md` | closeout | §3 verify command, §9 verify mention, §11 roadmap |
| `README.md` | closeout | Commandes table verify, Tests & qualité section |

**Patterns de référence (read-only)** :
- [.github/workflows/db-drift-pr.yml](../.github/workflows/db-drift-pr.yml) — pattern path filter + `pnpm/action-setup@v4` sans `with: version`
- [.github/workflows/code-checks.yml](../.github/workflows/code-checks.yml) — pattern PR-time gate code-side (Sprint Code-CI / F1)
- [package.json:14-21](../package.json#L14) — pattern scripts pnpm db:* qu'on regroupe avec le nouveau verify

---

## Verification

```powershell
# G1 — local
pnpm verify                      # exit 0, 8 checks séquentiels
# Mesurer durée totale (~30-40s estimé)

# G1 fail-fast test
# Casser un type dans lib/finance/piggy-bank.ts
pnpm verify                      # exit code 2 dès l'étape typecheck
# Restore + re-verify → exit 0

# G2 — local sanity
# Lire .github/dependabot.yml syntactique (pas de validateur local sans gh CLI)
# Trigger via GitHub Settings → Code security → Dependabot → "Check for updates"

# G3 (a) si migration — full PR test ceremony comme Sprint Code-CI / F1 verif
# Branch test, bump actions/checkout@v4 → @v5 dans un YAML, ouvrir PR, observer green

# Sanity globale post-sprint
pnpm verify                      # exit 0 (le meta couvre les 8)
```

---

## Hors scope

- **Sprint 1 (Prettier/Husky/eslint Next 16)** — sprint séparé, prerequisite pas encore prêt (lint cleanup à faire avant).
- **Lint cleanup des 136 errors pre-existants** — sprint séparé, prerequisite Sprint 1.
- **Build (`pnpm build`) dans le PR-time gate** — sprint Build-CI séparé (besoin env vars Supabase + 30-60s).
- **Coverage report** (vitest --coverage) — séparé, valeur intéressante mais hors focus DX-meta.
- **CodeQL ou autre security scanning** — overkill pour repo solo, à considérer si on ouvre le repo.
- **Chantiers I4 / I5 / console.log / Zod rollout** — chantiers dédiés.
- **Merge `cleanup → main`** — décision stratégique, status quo.

---

## Risques résiduels

1. **G2 — première vague Dependabot volumineuse**. Catch-up des updates depuis création du repo. Le PR-time gate les attrape, mais demande triage. À prévoir comme follow-up post-sprint (1-2h de triage).
2. **G2 — eslint-config-next 15→16** : Dependabot proposera, **NE PAS merger** (Sprint 1 dédié). Commenter + close.
3. **G3 — si on migre proactivement et qu'une action v5 a un breaking change** : on doit re-fixer pendant le sprint. Mitigation : suivre le pattern Sprint Cleanup-Legacy / C3 — le PR-time gate va échouer, on fix le YAML, on re-pushe.
4. **G1 — durée cumulée `pnpm verify` peut grossir** au fil des sprints (chaque nouveau check ajouté). Pas un problème aujourd'hui (8 checks ~40s) mais à surveiller.

---

## Push gate

G1+G2 = code-only, pas de prod touchée, pas de migration DB. Pas de confirmation utilisateur requise au-delà de l'approbation de ce plan.

G3 (a) si exécuté = bump versions actions, low-risk mais demande verif PR test ceremony comme F1.

**Aucun changement DB attendu sur ce sprint.**

---

## Lessons learned applicables

1. **De Sprint Code-CI / F1 — full PR test ceremony** : si G3 (a) est exécuté, refaire la ceremony. Ne pas trust juste le YAML par mirror.
2. **De Sprint Cleanup-Legacy / C3** : pas de `with: version` sur `pnpm/action-setup@v4` → si on bump à `@v5`, vérifier que la même règle s'applique (probable mais à vérifier dans les release notes v5).
3. **De Sprint Hygiene-CI / E3** : workflows qui créent des issues/PRs ont besoin de `permissions:` explicite. Dependabot a son propre mécanisme de permissions (gérées par GitHub directement) — pas applicable au G2 YAML.
4. **De Sprint Code-CI sanity sweep** : chaîner 4 supabase API calls dans un seul `pnpm` invocation peut crasher (`STATUS_STACK_BUFFER_OVERRUN` 0xC0000409 sur Windows). Si `pnpm verify` G1 reproduit ça, splitter en 2 scripts.
5. **De Sprint Polish-CI / D6 défer** : la stratégie "wait-and-see" était bonne quand on était plusieurs mois avant l'échéance. Maintenant qu'on est <1 mois, ré-évaluer. G3 = ré-éval explicite.
