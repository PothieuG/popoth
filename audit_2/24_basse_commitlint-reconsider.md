# 24 — commitlint reconsider

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint 1 (skip explicit) |
| **Type** | décision en attente (tooling) |
| **Priorité** | Basse |
| **Effort estimé** | S (1-2h si on installe) |
| **Statut** | Non commencé (refus historique Sprint 1) |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

CLAUDE.md §11 entrée Sprint 1 :

> **Out of scope** : commitlint (skip per arbitration — convention CLAUDE.md §6 documentée par confiance)

CLAUDE.md §6 git :

> **Conventional Commits** : `fix:`, `feat:`, `chore:`, `docs:`, `perf:`, `test:`. Préfixer le scope quand pertinent : `fix(api/debug)`, `chore(supabase)`.

**État actuel** :
- Convention Conventional Commits documentée + suivie consistently sur 50+ sprints (cf. CLAUDE.md §11 commits chaque sprint avec format `feat(...)/fix(...)/refactor(...)/chore(...)/docs(...)`)
- 0 enforcement automatique (pas de commitlint installé, pas de hook commit-msg)
- Husky pre-commit (lint-staged) + pre-push (lint:check + typecheck) en place

**Question** : faut-il installer commitlint pour enforcer automatiquement la convention ? Sprint 1 a tranché "non" par confiance + CLAUDE.md §6 doc.

## Question de scope

À reconsidérer SI :
- Une PR (interne ou externe) devient mergée avec un commit message hors-convention (exemple : "fix bug" sans préfixe `fix(...)`)
- L'équipe scale (passe de 1 dev à 2+) où la confiance documentée ne suffit plus
- Un audit historique git surface 5+ commits hors convention sur les 100 derniers

**Sinon** : laisser tel quel, la convention auto-disciplinaire fonctionne.

## Prompt prêt à l'emploi pour Claude Code (à utiliser le jour J)

> Copier-coller dans une nouvelle session Claude Code SI la décision est prise d'installer commitlint.

### 1. Objectif

Installer `@commitlint/cli` + `@commitlint/config-conventional` + hook Husky `commit-msg` qui valide chaque commit message contre la spec Conventional Commits, sans casser le workflow de développement local.

### 2. Contexte technique

**Fichiers à créer** :
- `commitlint.config.js` (config étendue de `@commitlint/config-conventional` + customisations Popoth)
- `.husky/commit-msg` (hook qui invoke `pnpm exec commitlint --edit "$1"`)

**Fichiers à modifier** :
- `package.json` (deps + scripts)

**Pattern à reprendre** :
- Husky pre-commit pattern Sprint 1 (CLAUDE.md §3 "Hooks Git (Husky)")

### 3. Décision Phase 1 — config customisations

Customisations possibles vs config par défaut :
- Type allowlist : `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `style`, `revert` (couvre les 50+ sprints livrés)
- Subject case : `lowercase` (pattern observé dans CLAUDE.md §11)
- Subject empty : never
- Subject max length : 72 chars (cohérent format `<type>(<scope>): <subject>`)
- Body : optional, no rule
- Footer : optional, allow `Co-Authored-By:` (pattern Claude Code)

### 4. Critères d'acceptation

- [ ] commitlint installé + config étendue
- [ ] hook `.husky/commit-msg` actif
- [ ] Test : commit avec message hors convention → block (e.g. `git commit -m "wip"` → fail)
- [ ] Test : commit valide → pass (e.g. `git commit -m "feat(api): add new endpoint"` → ok)
- [ ] Audit historique : `pnpm exec commitlint --from <SHA-pre-sprint> --to HEAD --verbose` doit passer (les commits récents respectent la convention)
- [ ] CLAUDE.md §6 git mis à jour pour mentionner commitlint actif

### 5. Étapes (compactes)

```powershell
# 1. Install
pnpm add -D @commitlint/cli @commitlint/config-conventional

# 2. Config
# Write commitlint.config.js
# Write .husky/commit-msg avec pnpm exec commitlint --edit "$1"
# (chmod +x sur le hook si nécessaire)

# 3. Test local
git commit --allow-empty -m "wip"  # doit fail
git commit --allow-empty -m "feat(test): valid format"  # doit pass

# 4. Audit historique
pnpm exec commitlint --from origin/cleanup~30 --to HEAD --verbose

# 5. CLAUDE.md §6 update
```

## Pièges connus (le jour J)

- **Friction locale** : si la config est trop stricte, ralentit le workflow (ex: refus d'un quick `chore: bump deps`). Calibrer les rules.
- **`Co-Authored-By:` footer** : assurer que la rule footer accepte ce trailer (pattern Claude Code). Probablement default config OK.
- **`--no-verify`** : bypass possible mais documenté dans CLAUDE.md §6 comme exception (`NEVER unless explicit ask`).
- **Audit historique fail** : si certains commits anciens ne respectent pas la convention, soit accepter qu'ils restent "orphelins" (commitlint ne touche pas le passé), soit ajouter une exception via `from` à partir d'un SHA donné.
- **Pre-existing dirty working tree** : exclure des commits.

## Découpage (S → 2 commits)

1. **Sub-1** — Install + config + hook. Commit `chore(tooling): install commitlint + commit-msg hook`.
2. **Sub-2** — CLAUDE.md doc update. Commit `docs: add commitlint to §6 git conventions`.

## Recovery path

- Désinstaller : `pnpm remove @commitlint/*` + drop `commitlint.config.js` + drop `.husky/commit-msg`
- Aucun impact sur les commits existants

## Précédents codebase

- Sprint 1 (CLAUDE.md §11) — refus initial documenté
- Sprint Templates-Triage (CLAUDE.md §11) — `commitlint skip` confirmé au pré-sprint

---

**Estimation totale** : 1-2h. Score ~99.999 stable (consolidation tooling). **Décision conservatrice** : laisser tel quel, la convention auto-disciplinaire fonctionne sur 50+ sprints. Activer ce chantier uniquement si la situation change (multi-dev, dérive observée, audit fail).
