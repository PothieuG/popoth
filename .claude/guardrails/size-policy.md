# Politique de taille — tous les `.md` de contexte ≤ 39 500 chars

> **Installée 2026-05-16** (CLAUDE.md 683 KB → ≤ 40 KB). **Étendue 2026-05-18** à tous les `.md` de contexte (CLAUDE.md + références récursives sous `.claude/`). **Cap bumped 2026-05-22** de 38 000 à **39 500 caractères** (`wc -m` UTF-8) après installation de l'enforcement automatique — marge ramenée de 2k à 0.5k sous la limite 40k Claude Code pour donner plus d'espace aux fichiers denses (CLAUDE.md, operational-rules-ui-modals).

## 1. Cible et plafond — règle générale

S'applique à **tous les `.md` de contexte** : CLAUDE.md + tout fichier qu'il référence directement ou indirectement.

- **Cible** : **35 000 – 38 000 caractères** (zone de confort, mesurée via `LC_ALL=en_US.UTF-8 wc -m`).
- **Zone d'alerte** : **38 000 – 39 500 caractères** — planifier un split au prochain sprint touchant le fichier.
- **Plafond dur** : **39 500 caractères** (jamais dépassé — la gate bloque). Marge 0.5k sous la limite Claude Code 40k qui dégrade les performances.
- **Plancher** : **35 000 caractères**, sauf si le fichier est naturellement plus court (split forcé par contraintes, fichier de référence court par nature). Ne pas gonfler artificiellement un fichier court.

L'unité est le **caractère Unicode** (codepoint), pas le byte. Sur Git Bash / Windows : `LC_ALL=en_US.UTF-8 wc -m` (sinon wc -m == wc -c = bytes).

**Enforcement automatique** (Sprint Md-Size-Gate 2026-05-22) : `scripts/check-md-size.mjs` est branché à trois endroits :

1. **Husky pre-commit via lint-staged** sur `CLAUDE.md` + `.claude/**/*.md` staged → bloque le commit (exit 1) si > 39.5k.
2. **`pnpm verify`** (sanity sweep sprint closeout) → fail si un context .md dépasse, force la décision split.
3. **Claude Code PostToolUse hook** (`.claude/settings.json`) sur Edit|Write|MultiEdit → injecte un stderr exit-2 dès qu'un Edit/Write fait franchir le cap, feedback inline pour la session.

CLI direct : `pnpm check:md-size` (no args = scan tout) ou `node scripts/check-md-size.mjs <file>...`.

## 2. Procédure avant toute modification d'un `.md` de contexte

```bash
# 1. Mesurer la taille actuelle (UTF-8 chars, pas bytes)
LC_ALL=en_US.UTF-8 wc -m chemin/vers/fichier.md

# 2. Estimer la taille de l'ajout
echo -n "<contenu prévu>" | LC_ALL=en_US.UTF-8 wc -m

# 3. Si total ≥ 39 500 après ajout : NE PAS inliner, créer/étendre un sous-fichier
# 4. Alternative : appeler `pnpm check:md-size <file>` pour vérifier l'état courant
```

## 3. Décision flow

```
Doit-on ajouter du contenu à un .md de contexte ?
│
├─ Cible 35-38k → ajouter sereinement, mesurer après
│
├─ 38-39.5k (zone d'alerte) → STOP, planifier split au prochain sprint
│   (la gate ne bloque pas encore, mais ne laisse pas le fichier dériver)
│
├─ 39.5k atteint → STOP, split OBLIGATOIRE AVANT tout nouvel ajout. Au choix :
│   ├─ Étendre un sous-fichier .claude/ + ajouter pointeur 1-ligne dans CLAUDE.md
│   ├─ Découper le fichier en parts logiques (chronologique / thématique / module)
│   └─ Trimmer une autre section du même fichier vers .claude/
│
└─ Fichier déjà > 39.5k → refactor obligatoire AVANT tout autre ajout (gate fail)
```

## 4. Architecture documentaire actuelle (mesuré 2026-05-22 post-Md-Size-Gate)

`.claude/` est navigable depuis Claude Code (prefix `@.claude/<path>`).

```
CLAUDE.md                                     39k    Index opérationnel + règles critiques actives (cible 35-38k dépassée mais sous plafond 39.5k — refactor candidate)

.claude/
├─ history/                                          (Historique — chargé à la demande)
│   ├─ score-evolution-part-1-47-to-99.md      33k   Score 47 → ~99.998
│   ├─ score-evolution-part-2-99-to-100.md     34k   Score ~99.999 → 100
│   ├─ sprint-history-security-part-1-foundation-ci.md       24k   Sprint 0 → Code-CI (DB/CI)
│   ├─ sprint-history-security-part-2-quality-architecture.md 18k   Lint-Followups → Refactor-Arch + Drift C3
│   ├─ roadmap-detailed-01-sprint-0-to-architecture-v5.md      32k   Sprint 0 → Refactor-Arch-v5 (24 sprints)
│   ├─ roadmap-detailed-02-sprint-1-to-cleanup-lot-1.md        32k   Sprint 1 → Lot 1 (11)
│   ├─ roadmap-detailed-03-lot-3-to-refactor-i5-followup-v2.md 32k   Lot 3 → Refactor-I5-followup-v2 (8)
│   ├─ roadmap-detailed-04-followup-v3-to-atomicity-savings-v2.md  30k   Refactor-I5-followup-v3 → Atomicity-Savings v2 (5)
│   ├─ roadmap-detailed-05-dead-code-to-lot-4b.md              30k   Dead-Code-Purge → Lot 4b (6)
│   ├─ roadmap-detailed-06-lot-4c-to-lot-5d.md                 34k   Lot 4c → Lot 5d (7)
│   ├─ roadmap-detailed-07-audit-c2-to-zod-v3.md               33k   Audit-Closeout C2 → Zod v3 (6)
│   ├─ roadmap-detailed-08-zod-v4-to-zod-v8.md                 37k   Zod v4 → v8 (5)
│   ├─ roadmap-detailed-09-zod-v9-to-tailwind-v4.md            36k   Zod v9 → Tailwind-v4 (5)
│   ├─ roadmap-detailed-10-p10-to-auto-balance-atomic.md       32k   P10 → Auto-Balance-Atomic (7)
│   ├─ roadmap-detailed-11-phase-b-to-commitlint.md            30k   Phase-B → Commitlint (6)
│   ├─ roadmap-detailed-12-cas3-to-refactor-recover.md         39k   Complete-CAS3-TestFix → Fix-Password-Reset-OTP (7) — en zone alerte 38-39.5k, split au prochain sprint touchant Refactor-Recover
│   ├─ roadmap-detailed-13-fix-empty-recap-tirelire.md         37k   Fix-Empty-Recap-Tirelire → Drawer-Slide-Fix-And-Header-Harmonize (6)
│   ├─ roadmap-detailed-14-modal-uniformize-polish-dropdown.md 36k   Modal-Uniformize → Fix-Dashboards-Navbar-Switch (6)
│   ├─ roadmap-detailed-15-skeleton-refetch-loaders.md         32k   Skeleton-Refetch-Loaders + Fix-Dropdown-PointerEvents-Auto + Feature-Revenu-Exceptionnel + Enrich-Delete-Confirmation/Fix-Summary-RAV-Stale-Cache (3) — trimmée 2026-05-21 post-split vers Part 16
│   ├─ roadmap-detailed-16-expense-preview-pose-and-preserve-caps.md  34k   Expense-Preview-Posé-Layout → Recap-Compact-And-Uniform (4)
│   ├─ roadmap-detailed-17-delete-header-income-polish.md             19k   Delete-Header-And-Income-Polish → Group-Transaction-Creator-Avatar (2) — créée 2026-05-22 par split préemptif de Part 16
│   └─ sprint-chronology.md                            38k   Table "1 ligne = 1 pattern installé" — extraite 2026-05-22 d'operational-rules.md §6. Append-only.
│
├─ reference/
│   └─ structure-repo.md                              38k   Inventaire fichiers annoté (régénérable partiel via git ls-files) — en zone alerte
│
├─ conventions/                                      (Patterns détaillés avec exemples code)
│   ├─ zod-patterns.md                                18k   Patterns A-H + DecimalFormInput + ModalCloseX + tests
│   ├─ typescript.md                                   4k   verbatimModuleSyntax, noUncheckedIndexedAccess, Database['Tables']
│   ├─ logs-cleanup.md                                10k   Logger central + Lot 1-6 history + règle d'or triage
│   ├─ git-workflow.md                                 9k   Husky hooks + commitlint + capture-then-drop + DROP + Dependabot
│   ├─ operational-rules.md                           36k   Path B closed-by-deletion + god-files + cleanup-attempts CRITIQUES + ❌ rules (Modals & UI + chronologie extraites) — sous le cap 39.5k post-extraction §6 2026-05-22
│   └─ operational-rules-ui-modals.md                 39k   Règles ❌ Modals & UI (extraite Sprint Drawer-Slide-Fix 2026-05-20 + étendue Sprints Modal/Skeleton/Dropdown/Enrich/Expense/Auto-Use/Recap/Income-Polish 2026-05-21 → 2026-05-22) — trimmée 2026-05-22 (intro condensée) pour passer sous le cap 39.5k
│
└─ guardrails/
    └─ size-policy.md                                 17k   (ce fichier)
```

**Total contexte** : ~840k chars répartis sur 28 fichiers (post-Md-Size-Gate 2026-05-22). Tous les fichiers passent sous le cap 39.5k. CLAUDE.md (~39.4k), operational-rules-ui-modals.md (~39.2k), sprint-chronology.md (~37.7k), structure-repo.md (~38.0k), roadmap-12 (~38.0k) en zone d'alerte 38-39.5k — refactor candidates au prochain sprint touchant ces invariants. operational-rules.md ramené à **~36k** (Sprint extraction §6 chronologie 2026-05-22, était 72k pre-extraction, warning harness > 40k résolu).

## 5. Règles d'extension

### Quand créer un nouveau sous-fichier

- L'ajout concerne un **domaine** qui n'existe pas encore (e.g. `accessibility.md`, `performance.md`).
- L'ajout fait **≥ 5 KB** et ne s'intègre pas naturellement dans un fichier existant.
- L'ajout est de l'**historique** (sprint closeout, audit narrative).

### Quand étendre un fichier existant

- L'ajout est un **pattern** lié à un domaine existant (Zod, TypeScript, Logs, Git, Operational).
- L'ajout fait **< 5 KB** ou prolonge naturellement le contenu existant.
- L'ajout est un nouveau **précédent** Path B closed-by-deletion → `operational-rules.md` §1.

### Quand découper un fichier en parts

- Le fichier dépasse 39.5k après ajout → split au boundary logique le plus proche (chronologique, thématique, par module/sprint).
- Si un fichier d'historique (`history/`) grossit naturellement (append-only) → split chronologique préemptif quand on franchit 35k.

### Quand mettre à jour CLAUDE.md inline

- **Invariant chiffré** change : mettre à jour le tableau §5.5 Invariants actuels.
- **Règle ✅/❌ critique** opérationnelle : ajouter une ligne dense en §8 avec lien vers `operational-rules.md` pour les précédents.
- **Index roadmap §11** : ajouter 1 ligne pour le nouveau sprint, et créer un nouveau `roadmap-detailed-NN-...md` si le dernier dépasse 35k.
- **Nouvelle convention** (Zod, TS, Logs, Git) : ajouter 1 bullet dense en §6 + détails dans sous-fichier.

## 6. Procédure de refactor préventif

Si un `.md` de contexte s'approche de 39.5k :

```bash
# 1. Mesurer toutes les sections (lignes de bytes en Git Bash, mais l'ordre est correct)
awk '
  /^## / { if (prev) printf "  %6d : %s\n", total - prev_offset, prev ; prev = $0 ; prev_offset = total }
  { total += length($0) + 1 }
  END { if (prev) printf "  %6d : %s\n", total - prev_offset, prev }
' fichier.md | sort -k1 -n -r

# 2. Si une section dépasse 8k : envisager de la déplacer vers .claude/conventions/ ou la découper
# 3. Vérifier l'absence de doublons entre CLAUDE.md et .claude/*/*.md
# 4. Avertir l'utilisateur AVANT de refactor
```

Pour les fichiers de référence à splitter (mode hors-CLAUDE.md) : compter les sprints/sections, calculer la partition équilibrée (DP "maximize min" si besoin) ou greedy first-fit avec target ~36-38k par part.

## 7. Sous-fichiers — politique d'évolution

- **history/** : append-only verbatim (sprint closeouts, score evolution). Ne pas réécrire l'historique, juste ajouter. Quand un fichier `history/...-part-NN.md` atteint 35k → créer une nouvelle part (Part NN+1) plutôt que d'étendre.
- **reference/structure-repo.md** : mise à jour à chaque ajout/suppression/déplacement de module. Régénérable partiellement via `git ls-files` mais les annotations (descriptions, patterns miroir) ne sont PAS récupérables → maintenir manuellement.
- **conventions/** : append-only pour les nouvelles patterns + mise à jour pour les évolutions de patterns existants. Si un pattern est déprécié → ajouter `> ⚠️ DEPRECATED (date) — voir <successor>` en tête, NE PAS supprimer.
- **guardrails/size-policy.md** : ce fichier. Mise à jour si la politique évolue (e.g. plafond 39.5k → 38k si Claude Code resserre la limite harness).

## 8. Convention de référence inter-fichiers

- **Préfixe `@.claude/<path>`** pour les liens depuis CLAUDE.md (navigable Claude Code).
- **Préfixe `[texte](path.md)` relatif** pour les liens inter-sous-fichiers (markdown standard).
- **Préfixe `[texte](../../<file>)` relatif** pour pointer depuis `.claude/<section>/*.md` vers les fichiers du repo (e.g. `lib/api/parse-body.ts`).

## 9. Tailles cibles par fichier (référence)

| Fichier                                                          | Cible (chars) | Plafond   |
| ---------------------------------------------------------------- | ------------- | --------- |
| `CLAUDE.md`                                                      | 35-38k        | **39.5k** |
| `history/score-evolution-part-1-47-to-99.md`                     | naturel       | 39.5k     |
| `history/score-evolution-part-2-99-to-100.md`                    | naturel       | 39.5k     |
| `history/sprint-history-security-part-1-foundation-ci.md`        | naturel       | 39.5k     |
| `history/sprint-history-security-part-2-quality-architecture.md` | naturel       | 39.5k     |
| `history/roadmap-detailed-NN-...md` (17 parts)                   | 30-37k        | **39.5k** |
| `history/sprint-chronology.md`                                   | append        | **39.5k** |
| `reference/structure-repo.md`                                    | ~30k          | 39.5k     |
| `conventions/zod-patterns.md`                                    | ~18k          | 39.5k     |
| `conventions/typescript.md`                                      | ~4k           | 39.5k     |
| `conventions/logs-cleanup.md`                                    | ~10k          | 39.5k     |
| `conventions/git-workflow.md`                                    | ~9k           | 39.5k     |
| `conventions/operational-rules.md`                               | ~35k          | 39.5k     |
| `conventions/operational-rules-ui-modals.md`                     | ~27k          | 39.5k     |
| `guardrails/size-policy.md`                                      | ~17k          | 39.5k     |

**Plafond dur 39.5k** s'applique uniformément. Cible 35-38k pour les fichiers "denses" (CLAUDE.md, roadmap parts). "Naturel" pour les autres (peuvent rester en-dessous sans gonflage).

## 10. Auto-audit recommandé

À lancer périodiquement (e.g. tous les 10 sprints ou tous les 2 mois) :

```bash
# Mesurer tous les .md de contexte en chars UTF-8
LC_ALL=en_US.UTF-8 wc -m CLAUDE.md .claude/**/*.md | sort -k1 -n

# Vérifier qu'aucun fichier ne dépasse 39 500 — équivalent à `pnpm check:md-size`
LC_ALL=en_US.UTF-8 wc -m CLAUDE.md .claude/**/*.md | awk '$1 > 39500 && $2 != "total" {print "❌ " $0}'
```

Si un fichier > 39.5k → refactor immédiat (split ou trim) — la gate est censée l'avoir bloqué avant ce stade.
Si total `.claude/**/*.md` croît trop vite (> 1 MB chars) → envisager de purger l'historique ancien ou splitter davantage les parts de roadmap.

## 11. Fichiers concernés par cette règle (inventaire 2026-05-22 post-Md-Size-Gate)

**28 fichiers `.md`** chargés comme contexte par Claude Code, **tous sous le cap 39.5k** :

- 1× `CLAUDE.md` (~39.4k, en zone alerte 38-39.5k — split candidate)
- 17× `.claude/history/roadmap-detailed-01..17-*.md` (19-38k — Part 12 (~38k) en zone alerte, split au prochain sprint touchant Refactor-Recover ; Parts 13-17 sous 37k post-trims 2026-05-21/22)
- 1× `.claude/history/sprint-chronology.md` (~38k — extraite 2026-05-22 d'operational-rules.md §6, append-only)
- 2× `.claude/history/score-evolution-part-1..2-*.md` (33-34k)
- 2× `.claude/history/sprint-history-security-part-1..2-*.md` (18-24k)
- 1× `.claude/reference/structure-repo.md` (~38k — en zone alerte)
- 6× `.claude/conventions/{zod-patterns,typescript,logs-cleanup,git-workflow,operational-rules,operational-rules-ui-modals}.md` (4-39k — operational-rules ramené à ~36k post-extraction §6 chronologie ; operational-rules-ui-modals trimmée à ~39.2k post-condensation intro 2026-05-22)
- 1× `.claude/guardrails/size-policy.md` (~17k — ce fichier).

Cf. inventaire détaillé via `pnpm check:md-size` ou `LC_ALL=en_US.UTF-8 wc -m CLAUDE.md .claude/**/*.md`.
