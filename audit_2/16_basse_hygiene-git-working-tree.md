# 16 — Hygiène git : working tree + stash + WIP commit

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | git state (Phase 1 audit : 25 M + 25 D + 28 untracked + 1 stash + 1 WIP commit `a80c045`) |
| **Type** | dette technique (hygiène repo) |
| **Priorité** | Basse (mais **bloque tout commit propre** — pré-requis tacite à TOUTE autre intervention) |
| **Effort estimé** | XS-S (30min - 2h selon décision) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune |
| **Bloque** | Tous les autres chantiers (un working tree dirty pollue les commits) |

## Contexte

Phase 1 audit Explore git state a surfacé :

```
git status -s :
- 25 M (fichiers modifiés)
- 25 D (fichiers supprimés — réorg `docs/` → `doc2/` + `prompts/` → `prompt/`)
- 28 untracked (création `doc2/` et `prompt/` + .claude/settings.json)

git stash list :
- stash@{0}: lint-staged automatic backup

git log --grep WIP :
- a80c045: "WIP on cleanup: d527e82 feat(recap): define types for step1 algorithm I/O"
```

**Conséquences** :
1. Tout nouveau commit peut accidentellement embarquer le réorg incomplet
2. Les liens `prompts/...` dans CLAUDE.md sont brisés tant que le réorg n'est pas commit (cf. SYNTHESE.md A1 alerte)
3. `git status` toujours bruyant → erreurs visuelles + CI hooks pre-commit peuvent fail
4. WIP commit `a80c045` dans l'historique cleanup pollue `git log --oneline`

**Architecture** :
- Le réorg `docs/` → `doc2/` + `prompts/` → `prompt/` semble complet côté filesystem (les D et untracked sont symétriques)
- Le stash `lint-staged automatic backup` est créé automatiquement par Husky pre-commit hook quand un commit est rolled back
- Le WIP commit dans l'historique est le résultat d'un `git stash` ou `git commit` partiel jamais cleané

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Nettoyer le working tree git en :
1. Décidant le sort du réorg `docs/` → `doc2/` + `prompts/` → `prompt/` (commit propre OU rollback complet)
2. Reviewant le stash `lint-staged automatic backup` (apply ou drop)
3. Reviewant le WIP commit `a80c045` (squash, drop, ou laisser)
4. Mettant à jour CLAUDE.md pour les liens `prompts/...` → `prompt/...` si réorg commit

### 2. Contexte technique

**Fichiers concernés** :
- 25 fichiers M (à inspecter individuellement)
- 25 fichiers D (réorg suppressions)
- 28 fichiers untracked (réorg créations)
- `.claude/settings.json` (cf. CLAUDE.md §8 — gitignored, ne PAS commit !)

**État actuel à confirmer Phase 1 (Read intentionnel chaque fichier)** :
- `git status -s` complet (relancer)
- `git stash show -p stash@{0}` — voir le contenu du stash
- `git log --oneline a80c045~3..a80c045` — voir les commits autour du WIP
- `git diff` — voir les 25 M (peuvent être des modifs intentionnelles ou accidentelles)
- `Glob "doc2/**/*.md"` + `Glob "prompt/**/*.md"` — confirmer que les fichiers sont cohérents avec les D
- Spécialement vérifier que `.claude/settings.json` n'est **pas** dans la liste des untracked à commit (gitignored)

**Tests existants pertinents** : aucun (gestion git, pas code)

**Précédents codebase** :
- CLAUDE.md §6 git conventions
- Sprint DX-Verify follow-up — leçon `.claude/settings.json` gitignored (commit 21859e4)

### 3. Spécifications fonctionnelles attendues

**Décision A — commit propre du réorg (recommandée)** :
1. `git add doc2/` + `git add prompt/` (les nouveaux dossiers)
2. `git rm -r docs/` + `git rm -r prompts/` (les anciens, déjà D)
3. `git add CLAUDE.md` après modif des liens `prompts/...` → `prompt/...`
4. Commit : `chore(docs): reorg docs/ → doc2/ + prompts/ → prompt/`

**Décision B — rollback complet du réorg** :
1. `git restore docs/` (recréer les fichiers D)
2. `rm -rf doc2/ prompt/` (drop les untracked)
3. State final : working tree clean, doc/ et prompts/ original

**Décision C — partiellement** : si certaines modifs (M) sont intentionnelles autres que le réorg, les isoler avant. Probablement pas le cas — le réorg semble être la seule source de dirty.

**Stash** : drop si pas utile, apply si contient du travail récupérable (Read avec `git stash show -p`).

**WIP commit a80c045** : laisser dans l'historique (pas de force-push sans demande explicite user — cf. CLAUDE.md §6 git conventions). Optionnel : note explicative dans le prochain commit.

### 4. Contraintes techniques

- **NEVER force-push** sans demande explicite user (CLAUDE.md §6)
- **NEVER `git push --no-verify`** sans demande explicite (CLAUDE.md)
- **NEVER commit `.claude/settings.json`** — gitignored, contient secrets locaux
- **Faire le commit propre AVANT** de démarrer tout autre chantier (chantier 16 = priorité d'exécution avant chantiers 01-15 même si Basse priorité par effort)

### 5. Critères d'acceptation vérifiables

- [ ] **`git status -s`** : 0 fichier dirty (ou seulement `.claude/settings.json` qui est gitignored donc invisible)
- [ ] **`git stash list`** : 0 entrée OU 1 entrée intentionnelle préservée
- [ ] **CLAUDE.md liens** : si Décision A, `Grep "prompts/" CLAUDE.md` retourne 0 hit (tous remplacés par `prompt/`)
- [ ] **`Glob "docs/**/*.md"`** : 0 fichier (si Décision A) OU restoré complet (si Décision B)
- [ ] **`Glob "doc2/**/*.md"`** : 23 fichiers attendus (si A) OU 0 (si B)
- [ ] **`Glob "prompt/**/*.md"`** : 90 fichiers attendus (si A) OU 0 (si B)

### 6. Tests à écrire ou à mettre à jour

- Aucun test code requis (gestion git pure)
- Optionnel : ajouter une vérif dans `pnpm verify` que `git status -s` est clean (mais subjectif, peut-être pas idéal)

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint Hygiène-Git** : commit propre du réorg docs/ → doc2/ + prompts/ → prompt/`
  - **§4** + autres sections : si Décision A, remplacer toutes occurrences `prompts/prompt-*.md` → `prompt/prompt-*.md` (sed cross-doc)
  - **§4** : `docs/` → `doc2/` similaire

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight (CRUCIAL)
git status -s
git stash list
git log --oneline -5

# 2. Phase 1 audit
git diff CLAUDE.md  # voir les modifs intentionnelles dans CLAUDE.md (M)
git diff app/api/debug/reset-budgets/route.ts  # voir une modif M random
git diff <quelques autres M>
git stash show -p stash@{0}  # voir le contenu du stash

# 3. Décision (A, B, ou C) — confirmer avec user

# Décision A — commit propre
git add doc2/ prompt/
git add -u  # stage les D
# Edit CLAUDE.md : sed s/prompts\//prompt\//g
git add CLAUDE.md
git status -s  # devrait montrer juste les fichiers à commit (.claude/settings.json reste gitignored)
git commit -m "chore(docs): reorg docs/ → doc2/ + prompts/ → prompt/

- Move docs/ → doc2/ (23 audit files)
- Move prompts/ → prompt/ (90 prompt files)
- Update CLAUDE.md links

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

# Stash review
git stash drop stash@{0}  # si pas utile
# OU git stash apply stash@{0} et review

# 4. Verify
pnpm verify  # devrait toujours exit 0 (pas de breaking change)
git status -s  # devrait être clean
```

## Pièges connus / points d'attention

- **`.claude/settings.json`** : gitignored, contient secrets — NE PAS commit. Vérifier `cat .gitignore` ou le file is in untracked-but-ignored.
- **WIP commit `a80c045`** : laissé dans l'historique. Pour cleaner via squash/rebase = nécessite force-push qui est interdit sans accord user explicite. **Recommandé** : laisser, pas grave.
- **Stash `lint-staged automatic backup`** : créé automatiquement par Husky pre-commit hook si un commit est rolled back ou hook fail. Probablement obsolète, drop safe.
- **Modifs M qui ne sont PAS le réorg** : si certains fichiers (e.g. `app/api/debug/reset-budgets/route.ts` parmi les 25 M) ont des modifs intentionnelles non-réorg, les commit séparément AVANT le commit réorg. Phase 1 audit doit identifier.
- **CLAUDE.md liens** : sed mécanique `prompts/` → `prompt/` peut casser un lien si une URL externe contient `prompts/` litteral. Confirmer absence avec `Grep "prompts/" CLAUDE.md` puis `sed -i "s|prompts/|prompt/|g" CLAUDE.md` (PowerShell : `(Get-Content CLAUDE.md) -replace 'prompts/', 'prompt/' | Set-Content CLAUDE.md`).
- **Tests cassés post-commit** : si une modif M dans un fichier test a été staged accidentellement, peut casser `pnpm test:run`. Faire `pnpm verify` après commit pour valider.

## Découpage en sous-tâches (XS-S → 1-2 commits)

1. **Sub-1 (Effort : XS)** — Audit Phase 1 + décision avec user.
2. **Sub-2 (Effort : XS-S)** — Implementation décidée. Commit `chore(docs): reorg docs/ → doc2/ + prompts/ → prompt/`.

## Recovery path

- `git reset HEAD~1` pour annuler le commit (si reorg pas envoyé en remote)
- `git restore <files>` pour restaurer fichiers
- `git stash pop` pour récupérer le stash si drop par erreur

## Précédents codebase

- Sprint DX-Verify follow-up (CLAUDE.md §11) — `.claude/settings.json` untrack pattern (commit 21859e4)

---

**Estimation totale** : 30min (Décision A simple) à 2h (si modifs M ambiguës nécessitent investigation). **Pré-requis tacite à tous les autres chantiers** — faire ce chantier en PREMIER même si priorité Basse par effort.
