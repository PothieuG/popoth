# Politique de taille — CLAUDE.md ≤ 40 KB

> **Installée 2026-05-16** lors de la refactorisation CLAUDE.md 683 KB → ≤ 40 KB.
> Ce fichier documente la politique de maintenance pour éviter une nouvelle dérive.

## 1. Cible et plafond

- **Cible** : 35–40 KB
- **Plafond absolu** : 40 KB
- **Trigger refactor préventif** : 38 KB

## 2. Procédure avant toute modification de CLAUDE.md

```bash
# 1. Mesurer la taille actuelle
wc -c CLAUDE.md

# 2. Estimer la taille de l'ajout
echo -n "<contenu prévu>" | wc -c

# 3. Si total ≥ 38 KB après ajout : NE PAS inliner, créer/étendre un sous-fichier
```

## 3. Décision flow

```
Doit-on ajouter du contenu à CLAUDE.md ?
│
├─ Cible 35-40 KB → ajouter, mesurer après
│
├─ 38-40 KB → ATTENTION zone : peut-on l'ajouter à un sous-fichier .claude/ ?
│   ├─ OUI → étendre sous-fichier + ajouter pointeur 1-ligne dans CLAUDE.md
│   └─ NON → refactor préventif AVANT ajout : trimmer une autre section de CLAUDE.md vers .claude/
│
└─ > 40 KB → STOP. Refactor obligatoire. Avertir l'utilisateur.
```

## 4. Architecture documentaire

`.claude/` est navigable depuis Claude Code (prefix `@.claude/<path>`).

```
.claude/
├─ history/                          (Historique — chargé à la demande seulement)
│   ├─ score-evolution.md           Score paragraph cumulé Sprint 0 → actuel
│   ├─ sprint-history-security.md   15 sprints sécurité Sprint 0 → Refactor-Architecture
│   └─ roadmap-detailed.md          Roadmap détaillée 94 sprints (chronologique)
│
├─ reference/
│   └─ structure-repo.md            Inventaire fichiers annoté (régénérable partiellement via git ls-files)
│
├─ conventions/                      (Patterns détaillés avec exemples code)
│   ├─ zod-patterns.md              Patterns A-H + DecimalFormInput + ModalCloseX + tests
│   ├─ typescript.md                verbatimModuleSyntax, noUncheckedIndexedAccess, Database['Tables']
│   ├─ logs-cleanup.md              Logger central + Lot 1-6 history + règle d'or triage
│   ├─ git-workflow.md              Husky hooks + commitlint + capture-then-drop + DROP workflow + Dependabot
│   └─ operational-rules.md         Path B closed-by-deletion + god-files + cleanup-attempts CRITIQUES + ❌ rules
│
└─ guardrails/
    └─ size-policy.md               (ce fichier)
```

## 5. Règles d'extension

### Quand créer un nouveau sous-fichier

- L'ajout concerne un **domaine** qui n'existe pas encore (e.g. `accessibility.md`, `performance.md`).
- L'ajout fait **≥ 5 KB** et ne s'intègre pas naturellement dans un fichier existant.
- L'ajout est de l'**historique** (sprint closeout, audit narrative).

### Quand étendre un fichier existant

- L'ajout est un **pattern** lié à un domaine existant (Zod, TypeScript, Logs, Git, Operational).
- L'ajout fait **< 5 KB** ou prolonge naturellement le contenu existant.
- L'ajout est un nouveau **précédent** Path B closed-by-deletion → `operational-rules.md` §1.

### Quand mettre à jour CLAUDE.md inline

- **Invariant chiffré** change : mettre à jour le tableau §5.5 Invariants actuels.
- **Règle ✅/❌ critique** opérationnelle : ajouter une ligne dense en §8 avec lien vers `operational-rules.md` pour les précédents.
- **Index roadmap §11** : ajouter 1 ligne pour les 10 derniers sprints, drop le plus ancien si déjà 10.
- **Nouvelle convention** (Zod, TS, Logs, Git) : ajouter 1 bullet dense en §6 + détails dans sous-fichier.

## 6. Procédure de refactor préventif

Si CLAUDE.md s'approche de 40 KB :

```bash
# 1. Identifier la section la plus grosse
awk '
  /^## [0-9]/ {section=$0; size=0}
  {size += length($0) + 1}
  /^## [0-9]/ {if (prev_section) print prev_section, prev_size; prev_section=section; prev_size=size}
  END {if (prev_section) print prev_section, prev_size}
' CLAUDE.md | sort -k2 -n -r

# 2. Si une section dépasse 8 KB : envisager de la déplacer vers .claude/conventions/
# 3. Vérifier l'absence de doublons entre CLAUDE.md et .claude/*/*.md
# 4. Avertir l'utilisateur AVANT de refactor
```

## 7. Sous-fichiers — politique d'évolution

- **history/** : append-only verbatim (sprint closeouts, score evolution). Ne pas réécrire l'historique, juste ajouter.
- **reference/structure-repo.md** : mise à jour à chaque ajout/suppression/déplacement de module. Régénérable partiellement via `git ls-files` mais les annotations (descriptions, patterns miroir) ne sont PAS récupérables → maintenir manuellement.
- **conventions/** : append-only pour les nouvelles patterns + mise à jour pour les évolutions de patterns existants. Si un pattern est déprécié → ajouter `> ⚠️ DEPRECATED (date) — voir <successor>` en tête, NE PAS supprimer.
- **guardrails/size-policy.md** : ce fichier. Mise à jour si la politique évolue (e.g. cible 35 KB → 30 KB après nouvelle refactorisation).

## 8. Convention de référence inter-fichiers

- **Préfixe `@.claude/<path>`** pour les liens depuis CLAUDE.md (navigable Claude Code).
- **Préfixe `[texte](path.md)` relatif** pour les liens inter-sous-fichiers (markdown standard).
- **Préfixe `[texte](../../<file>)` relatif** pour pointer depuis `.claude/<section>/*.md` vers les fichiers du repo (e.g. `lib/api/parse-body.ts`).

## 9. Tailles cibles par sous-fichier (référence)

| Fichier                              | Cible                | Plafond                                             |
| ------------------------------------ | -------------------- | --------------------------------------------------- |
| `history/score-evolution.md`         | append-only verbatim | sans limite                                         |
| `history/sprint-history-security.md` | append-only verbatim | sans limite (close-off pour les anciens sprints)    |
| `history/roadmap-detailed.md`        | append-only verbatim | sans limite (purge ≥ 1 an si surface des problèmes) |
| `reference/structure-repo.md`        | ~30 KB               | 50 KB                                               |
| `conventions/zod-patterns.md`        | ~10-15 KB            | 20 KB                                               |
| `conventions/typescript.md`          | ~3-5 KB              | 10 KB                                               |
| `conventions/logs-cleanup.md`        | ~5-8 KB              | 12 KB                                               |
| `conventions/git-workflow.md`        | ~3-5 KB              | 10 KB                                               |
| `conventions/operational-rules.md`   | ~12-18 KB            | 25 KB                                               |
| `guardrails/size-policy.md`          | ~3 KB                | 5 KB                                                |

**CLAUDE.md** : 35–40 KB **PLAFOND ABSOLU**.

## 10. Auto-audit recommandé

À lancer périodiquement (e.g. tous les 10 sprints ou tous les 2 mois) :

```bash
wc -c CLAUDE.md
ls -la .claude/**/*.md | awk '{print $5, $9}' | sort -n -r
```

Si CLAUDE.md > 38 KB : refactor préventif avant prochain ajout.
Si total `.claude/**/*.md` croît trop vite (> 1 MB) : envisager de purger l'historique ancien.
