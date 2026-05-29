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
│   ├─ roadmap-detailed-18-modal-enter-block.md                       39k   Modal-Forms-Block-Enter-Submit → Calculations-V3 (5) — créée sprint 04 closeout 2026-05-23 ; au plafond, split forcé pour sprint 05.
│   ├─ roadmap-detailed-19-endpoints-start-status.md                  37k   Endpoints-START-STATUS-V3 → Endpoints-Negative-Flow-V3 (3) — créée sprint 05 closeout 2026-05-25 par split préemptif de Part 18 ; étendue post-sprints 06 et 07.
│   ├─ roadmap-detailed-20-salary-finalize.md                         37k   Endpoints-Salary-Update-And-Finalize-V3 → Wizard-Shell-Lock-Screen-V3 (3 sprints 08-10).
│   ├─ roadmap-detailed-21-screens-welcome-summary.md                 14k   Screens-Welcome-Summary-V3 → Fix-Recap-Bilan-Formula (2 sprints 11 + bilan fix) — créée 2026-05-24 par split préemptif de Part 20 (52k aurait franchi cap).
│   ├─ sprint-chronology.md                            39k   Table "1 ligne = 1 pattern installé" — extraite 2026-05-22 d'operational-rules.md §6. Cap atteint 2026-05-22, gelée — voir part-2 pour suite.
│   └─ sprint-chronology-part-2.md                      4k   Suite chronologie. Créée 2026-05-24 sprint 11 V3 closeout (split préemptif).
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
│   ├─ operational-rules-ui-modals.md                 39k   Règles ❌ Modals & UI (extraite Sprint Drawer-Slide-Fix 2026-05-20 + étendue Sprints Modal/Skeleton/Dropdown/Enrich/Expense/Auto-Use/Recap/Income-Polish 2026-05-21 → 2026-05-22) — trimmée 2026-05-22 (intro condensée) pour passer sous le cap 39.5k
│   └─ multi-env.md                                    6k   Workflow staging prod/dev (Supabase + Vercel + `.env.local` commenté) — créé 2026-05-27 avec la branche `dev`
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
| `history/roadmap-detailed-NN-...md` (19 parts)                   | 30-37k        | **39.5k** |
| `history/sprint-chronology.md`                                   | append        | **39.5k** |
| `reference/structure-repo.md`                                    | ~30k          | 39.5k     |
| `conventions/zod-patterns.md`                                    | ~18k          | 39.5k     |
| `conventions/typescript.md`                                      | ~4k           | 39.5k     |
| `conventions/logs-cleanup.md`                                    | ~10k          | 39.5k     |
| `conventions/git-workflow.md`                                    | ~9k           | 39.5k     |
| `conventions/operational-rules.md`                               | ~35k          | 39.5k     |
| `conventions/operational-rules-ui-modals.md`                     | ~27k          | 39.5k     |
| `conventions/multi-env.md`                                       | ~6k           | 39.5k     |
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

## 11. Fichiers concernés par cette règle (inventaire 2026-05-27 post-Sprints Carryover-Fixes)

**51 fichiers `.md`** chargés comme contexte par Claude Code, **tous sous le cap 39.5k** :

- 1× `CLAUDE.md` (~39k post-trim §3 commandes Sprint PWA-Standalone-Polish — sortie zone alerte vers ~38-39k stable)
- 34× `.claude/history/roadmap-detailed-01..34-*.md` (8-39k — Parts 12, 13, 17, 18, 19, 20 en zone alerte 38-39.5k ; Parts 25-34 récentes ~8-23k ; Part 34 (~17k) carryover-fixes étendue post-PWA)
- 2× `.claude/history/sprint-chronology{,-part-2}.md` (~39k + ~34k — Part 1 gelée 2026-05-22, Part 2 créée 2026-05-24)
- 2× `.claude/history/score-evolution-part-1..2-*.md` (33-37k — part-2 en zone alerte)
- 2× `.claude/history/sprint-history-security-part-1..2-*.md` (18-24k)
- 1× `.claude/reference/structure-repo.md` (~39.5k — en zone alerte, trim sprint 02 closeout)
- 8× `.claude/conventions/{applied-balance-toggle,zod-patterns,typescript,logs-cleanup,git-workflow,multi-env,operational-rules,operational-rules-ui-modals,user-questions}.md` (4-39k — operational-rules.md + operational-rules-ui-modals.md en zone alerte 38-39.5k)
- 1× `.claude/guardrails/size-policy.md` (~16k — ce fichier).

**Sprint Multi-Env (2026-05-27)** : création branche `dev` + workflow staging (2 projets Supabase + 2 projets Vercel). `.claude/conventions/multi-env.md` créé (6k) avec setup local (`.env.local` commenté) + setup Vercel-dev + scripts DB cross-env. CLAUDE.md trims §6 Git (branches main/dev) + §8 (middleware/self-update condensés) + §10 (pointeur multi-env + compression security note). `next-env.d.ts` gitignored + untracked (file regénéré localement par Next dev/build).

**Sprint PWA-Standalone-Polish (2026-05-27)** : polish PWA expérience app native immersive (iOS + Android). Part 33 créée (~13k). CLAUDE.md §3 commands trims aggressifs (12 lignes raccourcies) pour absorber l'ajout `pnpm pwa:assets` + l'entrée §11 Part 33 sous le cap 39.5k. §5 trim ligne `Globals: 0 declare global` (redondant avec §5.5 invariants) + compaction `Distinction calculs finance`. Prettier reformatage post-edit a réaligné le tableau sur la nouvelle largeur max (CLAUDE.md 39,492 → 39,070, gain ~420 chars via padding shrink). Aucune autre extension `.claude/` modifiée hormis size-policy (ce fichier) et création Part 33.

**Sprints Carryover-Fixes (2026-05-27)** : 3 commits consécutifs (`90a890f` + `ef44067` + `5b69bb9`) qui corrigent l'omission de `carryover_spent_amount` dans 4 routes API (`expenses-preview-breakdown`, `expenses-add-with-logic`, `expenses-real` PUT, `expenses-progress`) + 1 calcul client (`EditTransactionModal.editBudgetSpentPostReverse`). Part 34 étendue de ~7k à ~17k (3 sections ajoutées : Sprint Fix-Preview-Allocation-Carryover + Follow-up Fix-Progress-Route-Carryover + Follow-up Fix-Edit-Encart-Carryover). CLAUDE.md §5.5 invariant Tests 791→793, §11 État global réécrit pour mentionner "4 sprints de fix livrés", §11 Part 34 label "(3) → (6)". `.claude/conventions/operational-rules.md` §5 RAV formula : nouvelle règle ❌ 1-ligne pointant Part 34 + compaction du bullet `persisted-then-override` (libéré ~120 chars pour rester sous le cap 39.5k).

**Sprint Salary-Auto-At-Recap-Complete + Contribution-Income-Mirror (2026-05-28)** : 2 features parentes (revenu salaire auto-créé à la finalisation du recap solo + revenu miroir côté groupe synchronisé avec dépense contribution sprint 16 V3). 7 migrations DB (3 RPCs nouvelles, 2 triggers, 2 colonnes `real_income_entries.recap_origin_id` + `contribution_id`). Part 36 créée (~10k). CLAUDE.md §5.5 invariants `EXPECTED_RPCS 25→28, Tests 796→797, Routes 44→45, fn 36→38`. §11 État global + Historique bumpés (35→36 parts, 146→148 sprints). §11 listing : 7 Parts trims (16/22/23/24/27/28/32/33/34/35 labels raccourcis) pour absorber l'ajout Part 36 sous le cap 39.5k.

**Sprint Housekeeping-Deps-Format-Triage (2026-05-29)** : hygiène repo post-Part 38/39 (4 vulns Dependabot transitives patchées via `pnpm.overrides` ; glob lint-staged `*.{mjs,cjs,js}` ajouté ; fix assertion gated group-project RAV post-PÉ-12). Côté doc : `sprint-chronology-part-3.md` **créée** (split chronologique préemptif — part-2 à 39 267 saturée, 1 ligne table = +~2000 chars de padding) + pointeur en pied de part-2 (39 389). `CLAUDE.md` §9 réconcilié sur §5.5 (`447/158 → 846/242`, net-neutre) + §6 note lint-staged `.mjs` (trim "mécanique", net +12, 39 492). `git-workflow.md` §3 détaille les globs lint-staged. Total `.md` contexte 50 → 51.

Cf. inventaire détaillé via `pnpm check:md-size` ou `LC_ALL=en_US.UTF-8 wc -m CLAUDE.md .claude/**/*.md`.
