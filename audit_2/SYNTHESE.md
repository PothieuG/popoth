# Synthèse Audit Popoth — 2026-05-14

> Audit orthogonal de la dette technique et du backlog, par chantier. Complémentaire à [CLAUDE.md §11](../CLAUDE.md) (chronologique sprint-by-sprint).

## Métadonnées

| Champ | Valeur |
|-------|--------|
| **Date** | 2026-05-14 |
| **Périmètre** | CLAUDE.md (§11 roadmap + §8 ❌ + §11 hors-scope « si X surface ») + [next-steps.md](../next-steps.md) (P1-P10) + grep TODO/FIXME/HACK + git state |
| **Branche source** | `cleanup` (default GitHub) |
| **Score métier estimé pré-audit** | ~99.999/100 |
| **Total chantiers identifiés** | **24** |
| **Auteur** | Claude Code (session interactive) |

## Méthodologie

**Phase 1 — exploration (3 Explore agents en parallèle)** :
- Inventaire fichiers de suivi : 1 CLAUDE.md (racine), 1 next-steps.md, 23 docs sous `doc2/audit/`, 90 fichiers `prompt/prompt-*.md`, 30 plans dans `~/.claude/plans/`.
- Markers code (TODO/FIXME/HACK/XXX/WIP/@deprecated) sur l'applicatif (exclu `node_modules/`, `.next/`, `coverage/`, `prompt/`, `prompts/`, `doc2/`, `docs/`).
- État git (working tree, branches non-mergées, commits récents, stash, untracked).

**Phase 2 — design** : extraction des chantiers à partir des entrées `⏭️` et "À déclencher" de §11 + 10 items P1-P10 + 2 TODO concrets (UserGroupsList) + état git physique.

**Phase 3 — arbitrage user** : profondeur prompts détaillée, P1-P10 inclus comme chantiers à part entière, items doc-only marqués `⏰ DORMANT` avec fichier dédié, hygiène git en 1 chantier.

**Phase 4 — rédaction** : 1 SYNTHESE.md + 24 fichiers de chantier (NN_priorite_nom-court.md).

## Tableau de synthèse

| NN | Nom | Type | Priorité | Effort | Statut | Bloque | Fichier |
|----|-----|------|----------|--------|--------|--------|---------|
| 01 | Chantier I6 — Refactor monthly-recap/complete | refactor | Haute | XL | Non commencé | 06, 13, 19 | [01_haute_chantier-i6-extract-monthly-recap-complete.md](01_haute_chantier-i6-extract-monthly-recap-complete.md) |
| 02 | Sprint Supabase-Strict-Types (5 sites) | dette technique | Haute | M | Bloqué (Dependabot ignore) | — | [02_haute_supabase-strict-types-monthly-recap.md](02_haute_supabase-strict-types-monthly-recap.md) |
| 03 | UserGroupsList view-members + leave-group | feature incomplète | Haute | S | Non commencé | — | [03_haute_user-groups-list-view-members-leave.md](03_haute_user-groups-list-view-members-leave.md) |
| 04 | Sprint Tailwind-v4 — migration majeure | refactor | Haute | L | Bloqué (Dependabot ignore) | — | [04_haute_sprint-tailwind-v4-migration.md](04_haute_sprint-tailwind-v4-migration.md) |
| 05 | P10 — Fix flicker page d'accueil | bug | Haute | S | Non commencé | — | [05_haute_p10-fix-flicker-home-page.md](05_haute_p10-fix-flicker-home-page.md) |
| 06 | Sprint Cleanup-I8 / Lot 6 — sweep final console | dette technique | Moyenne | M | Bloqué par 01 | — | [06_moyenne_console-log-lot-6-sweep-final.md](06_moyenne_console-log-lot-6-sweep-final.md) |
| 07 | P2 — RAV calculé sans économies de budget | bug | Moyenne | M | Non commencé | — | [07_moyenne_p2-rav-sans-economies-budget.md](07_moyenne_p2-rav-sans-economies-budget.md) |
| 08 | P3 — Recalcul RAV sur validation revenu (3 règles) | feature | Moyenne | L | Non commencé | 07 (recommandé) | [08_moyenne_p3-recap-rav-validation-revenu.md](08_moyenne_p3-recap-rav-validation-revenu.md) |
| 09 | P4 — Cascade économies sur dépassement budget | feature | Moyenne | L | Non commencé | 10 (couplé) | [09_moyenne_p4-cascade-economies-depassement.md](09_moyenne_p4-cascade-economies-depassement.md) |
| 10 | P5+P6 — Modal dépense : option économies + étape 1 type | feature | Moyenne | L | Non commencé | 09 (couplé) | [10_moyenne_p5-p6-modal-depense-options-etape-type.md](10_moyenne_p5-p6-modal-depense-options-etape-type.md) |
| 11 | P1 — Switch hebdo / quotidien dashboard | feature | Moyenne | M | Non commencé | — | [11_moyenne_p1-switch-hebdo-quotidien-dashboard.md](11_moyenne_p1-switch-hebdo-quotidien-dashboard.md) |
| 12 | OpenAPI / schema-to-docs (R10 audit) | documentation | Moyenne | M | Non commencé | — | [12_moyenne_openapi-schema-to-docs.md](12_moyenne_openapi-schema-to-docs.md) |
| 13 | auto-balance reversed RPC→INSERT pattern | bug latent | Moyenne | M | Bloqué par 01 | — | [13_moyenne_auto-balance-reversed-rpc-insert.md](13_moyenne_auto-balance-reversed-rpc-insert.md) |
| 14 | P7 — Permissions créateur sur solde groupe | feature | Basse | S | Non commencé | — | [14_basse_p7-permissions-createur-solde-groupe.md](14_basse_p7-permissions-createur-solde-groupe.md) |
| 15 | P8+P9 — Menu groupe : nettoyage UI | feature | Basse | S | Non commencé | — | [15_basse_p8-p9-menu-groupe-nettoyage-ui.md](15_basse_p8-p9-menu-groupe-nettoyage-ui.md) |
| 16 | Hygiène git — working tree + stash + WIP | dette technique | Basse | XS-S | Non commencé | bloque tout commit propre | [16_basse_hygiene-git-working-tree.md](16_basse_hygiene-git-working-tree.md) |
| 17 | ⏰ DORMANT — Idempotency key process-step1 | décision | Basse | M | DORMANT (sur incident) | — | [17_basse_dormant-idempotency-key-process-step1.md](17_basse_dormant-idempotency-key-process-step1.md) |
| 18 | ⏰ DORMANT — Plumbing budget_transfers.monthly_recap_id | décision | Basse | L | DORMANT (sur consumer) | — | [18_basse_dormant-plumbing-budget-transfers-recap-id.md](18_basse_dormant-plumbing-budget-transfers-recap-id.md) |
| 19 | ⏰ DORMANT — withCompensatingRollback abstraction | refactor | Basse | S | DORMANT (post-I6, ≥5 sites) | — | [19_basse_dormant-with-compensating-rollback-abstraction.md](19_basse_dormant-with-compensating-rollback-abstraction.md) |
| 20 | ⏰ DORMANT — handlePiggyBankAction recreation | feature | Basse | M | DORMANT (sur UX surface) | — | [20_basse_dormant-handle-piggy-bank-action-recreation.md](20_basse_dormant-handle-piggy-bank-action-recreation.md) |
| 21 | ⏰ DORMANT — Audit `amount_from_budget` default 0 | bug latent | Basse | S | DORMANT (sur bug) | — | [21_basse_dormant-amount-from-budget-default-zero-audit.md](21_basse_dormant-amount-from-budget-default-zero-audit.md) |
| 22 | Routes debug Zod résiduelles (reset-all + reset-budgets) | dette technique | Basse | XS | Non commencé | — | [22_basse_routes-debug-zod-residuelles.md](22_basse_routes-debug-zod-residuelles.md) |
| 23 | monthly-recap/transfer manual UI atomicity eval | décision | Basse | S | Non commencé | — | [23_basse_monthly-recap-transfer-atomicity-eval.md](23_basse_monthly-recap-transfer-atomicity-eval.md) |
| 24 | commitlint reconsider | décision | Basse | S | Non commencé | — | [24_basse_commitlint-reconsider.md](24_basse_commitlint-reconsider.md) |

**Synthèse par priorité** :
- 🔴 Critiques : **0** (codebase exceptionnellement propre, score ~99.999/100)
- 🟠 Hautes : **5**
- 🟡 Moyennes : **8**
- 🟢 Basses : **11** (dont 5 ⏰ DORMANTS conditionnels)

**Synthèse par effort** :
- XS (<30min) : 2 (16, 22)
- S (1-2h) : 9 (03, 05, 14, 15, 19, 21, 23, 24, + partie 16)
- M (demi-journée) : 7 (02, 06, 07, 11, 12, 13, 17, 20)
- L (1-2 jours) : 5 (04, 08, 09, 10, 18)
- XL (>2 jours) : 1 (01)

**Synthèse par type** :
- Feature : 8 (03, 08, 09, 10, 11, 14, 15, 20)
- Bug / bug latent : 4 (05, 07, 13, 21)
- Refactor : 4 (01, 04, 19, et partie 06)
- Dette technique : 4 (02, 06, 16, 22)
- Décision en attente : 4 (17, 18, 23, 24)
- Documentation : 1 (12)

## Top 3 chantiers à attaquer en premier

### 🥇 Chantier 03 — UserGroupsList view-members + leave-group (Haute, S)

**Justification** : effort minimal (1-2h), valeur UX immédiate, infrastructure entièrement en place :
- `useGroups()` expose déjà `leaveGroup` mutation (Sprint 1.5 + 2-followup-v2 invalidation cascade)
- `GroupMembersWithContributionsModal` migré Sprint Zod-Rollout v8 (Radix Dialog + focus trap)
- `ConfirmationDialog` disponible pour le confirm leave (déjà a11y-clean post v8)
- 0 RPC, 0 migration DB, 0 nouveau test gated requis

Quick win qui clôt 2 TODO concrets non documentés CLAUDE.md trouvés via grep (les seuls de tout le repo). Aucune dépendance bloquante.

### 🥈 Chantier 16 — Hygiène git (Basse, XS-S)

**Justification** : malgré la priorité Basse, ce chantier est un **pré-requis tacite** à toute autre intervention de moyen/grand effort. Le working tree contient :
- 25 fichiers `D` (suppression `docs/` + `prompts/`)
- 28 untracked (création `doc2/` + `prompt/`)
- 1 stash `lint-staged automatic backup`
- 1 WIP commit `a80c045` dans l'historique

Tant que ce réorg `docs/`→`doc2/` + `prompts/`→`prompt/` n'est pas commit, **les liens markdown CLAUDE.md sont brisés** (CLAUDE.md référence `prompts/...` à 30+ endroits) et tout nouveau commit propre nécessite un cleanup préalable. Effort XS-S avec recovery path trivial (`git restore`).

### 🥉 Chantier 05 — P10 Fix flicker page d'accueil (Haute, S)

**Justification** : UX bug visible à chaque visiteur du site (page d'accueil), effort S (1-2h), chemin de cause connu (AuthContext `INIT_START` → `INIT_SUCCESS` flash). Premier item produit du backlog `next-steps.md` avec ROI maximal :
- Ne touche pas la DB ni la couche atomique (zero-risk)
- Pattern fix bien établi (skeleton SSR + suspense ou state machine init avec loading state)
- Améliore la perception perf de l'app sans changer le runtime

Bonus : couplé chantier 03 (les 2 sont S, peuvent être fait dans la même session de 3-4h).

## Alertes

### 🟠 A1 — Drift documentation `prompts/` vs `prompt/` (mineure mais visible)

CLAUDE.md référence `prompts/prompt-XX*.md` à 30+ endroits, mais les fichiers vivent désormais dans `prompt/` (réorg en cours, working tree dirty cf. chantier 16). Tant que le réorg n'est pas commit, **les liens markdown internes de CLAUDE.md sont brisés en plusieurs sections**. Chantier 16 résout en commitant le rename + un sed sur CLAUDE.md.

### 🟠 A2 — Bloqueurs Dependabot (informationnelle)

Sprints 02 (Supabase-Strict-Types) et 04 (Tailwind-v4) sont bloqués par les ignore rules `.github/dependabot.yml` ajoutés Sprint Stabilize-Deps S1 :
- `@supabase/supabase-js: versions: ">=2.105.0"` bloque 02 (sinon fix typecheck = pas d'upgrade DB possible)
- `tailwindcss: update-types: ["version-update:semver-major"]` bloque 04 (sinon Dependabot re-PR le major bump)

Lever ces ignore rules est une étape **OBLIGATOIRE** des prompts 02 et 04 — pas un détail secondaire.

### 🟠 A3 — Couplage I6 (informationnelle)

Chantiers **01 (I6)**, **06 (Lot 6 console-cleanup)**, **13 (auto-balance reversed RPC)**, et **19 (withCompensatingRollback abstraction)** sont couplés. L'ordre logique est :

```
01 (I6 extract complete/route.ts)
  ↓
13 (auto-balance reversed RPC fix — même domaine, refacto similaire)
  ↓
06 (Lot 6 sweep final console — débloqué par I6+auto-balance)
  ↓
19 (withCompensatingRollback abstraction — devient pertinent post-I6 si ≥5 sites)
```

Faire 06 ou 13 avant 01 = **effort doublé** (refactor à refaire post-extraction). 02 (Supabase-Strict-Types) peut être fait en parallèle (5 sites distincts du domaine recap stateful).

### 🟠 A4 — Items DORMANTS (5 chantiers, conditionnels)

Chantiers **17-21** sont marqués `⏰ DORMANT` — prêts à exécuter mais **pas justifiés sans trigger concret** :
- 17 (Idempotency key process-step1) → trigger : incident concurrence prod
- 18 (Plumbing recap_id) → trigger : consumer applicatif qui SELECT/JOIN sur la colonne
- 19 (withCompensatingRollback) → trigger : ≥5 sites compensating-rollback cross-repo (post-I6)
- 20 (handlePiggyBankAction) → trigger : surface UX besoin set/add/remove tirelire directe
- 21 (`amount_from_budget` default 0) → trigger : bug surface en prod

**Ne pas les attaquer prématurément** (cargo cult risk). Mirror Sprints Templates-Triage et Audit-Closeout C2/C3/C4/I3 qui ont collectivement refusé 30+ items "design for hypothetical".

### 🟢 A5 — Pas de chantier critique

La codebase est exceptionnellement propre :
- 0 FIXME/HACK/XXX/WIP markers dans le code applicatif
- 0 fuite sécurité connue
- 0 bug critique en attente
- 0 `as unknown as SupabaseClient` (counter clean depuis Sprint Refactor-I5)
- 10 sites `: any` tous justifiés (4 wrapper overloads + 6 mocks de tests)
- 7 eslint-disable tous légitimes et documentés

Le score `~99.999/100` reflète l'état réel. Cet audit n'a **PAS surfacé de "trou" caché** dans la dette — il liste des chantiers déjà connus (CLAUDE.md §11) + 2 TODO mineurs (UserGroupsList) + 10 items produit (next-steps.md).

## Annexe — Corrections triviales (<5 min, sans risque)

Items qui ne méritent pas un chantier dédié — peuvent être appliqués au fil des PRs :

### T1 — Liens `prompts/` → `prompt/` dans CLAUDE.md
Une trentaine d'occurrences `prompts/prompt-XX*.md` à remplacer par `prompt/prompt-XX*.md`. Sed 1-line :
```powershell
# Aperçu (Grep, ne touche rien) :
# Grep "prompts/prompt-" CLAUDE.md
```
Bloqué temporairement par chantier 16 (working tree dirty). À faire dans le commit qui finalise le réorg.

### T2 — Format:check 4 fichiers stale pré-existants
Fichiers signalés Sprint Zod-Rollout v5 closeout comme "hors scope volontaire" :
- `doc2/audit/AUDIT-RESOLUTIONS.md`
- `next.config.js`
- `.claude/settings.json`
- `prompt/prompt-07-deep-dive-recap-algorithm-v7.md`

Pour clean : `pnpm format` puis review du diff (Prettier devrait juste reformater les longs lignes / spaces).

### T3 — Score CLAUDE.md §1 verbose
Le paragraphe §1 score (« ~98.2 stable après Sprint Cleanup-I8 / Lot 1 ... ») accumule maintenant 30+ entrées en prose. Pas une incohérence (les chiffres sont corrects), juste du verbose à condenser un jour. Aucune action urgente.

### T4 — Top 5 fichiers `console.log` dans CLAUDE.md §11 stale
Plusieurs entrées Lot 4-5 mentionnent encore `financial-calculations` 112 dans le top 5 alors que ce fichier a été supprimé Sprint Refactor-I4 (split en 8 modules sous `lib/finance/`). Drift doc à corriger lors du prochain Lot 6 closeout (chantier 06).

### T5 — `engines.npm` non spécifié dans package.json
`engines.node` et `engines.pnpm` sont specifiés (Sprint Align-PackageJson P2). `engines.npm` est absent — par design (le repo enforce pnpm) mais peut générer un warning sur certains environnements CI/CD externes. Si un dev essaie `npm install` au lieu de `pnpm install`, échouera silencieusement sur le `packageManager` field. Ajouter `"npm": "please-use-pnpm"` ou similaire si bug surface.

## Ce qui n'est PAS dans cet audit

Pour transparence, voici ce qui a été **explicitement exclu** :

- **CLAUDE.md §11 entrées ✅ (livrées)** : chronologie historique des 50+ sprints livrés. Source d'information mais pas de chantier (tout est fait).
- **doc2/audit/** entries déjà closées par triage (C2, C3, C4, I3) : sprint Audit-Closeout-* a déjà refusé/livré 30+ items, refus documentés dans CLAUDE.md §7 et §11.
- **Hors scope explicites**: Sentry, Error boundaries, i18n, Storybook, vaul drag-to-dismiss, Playwright/E2E, MSW, jest-axe v5+ matcher fix — tous documentés CLAUDE.md §11 entrées Sprint Zod-v5/v6/v7/v8/v9/v10 comme refusés.
- **`@anthropic-ai/sdk`** retiré Sprint Align-PackageJson P1 (0 callsite). Pas de chantier, pas de retour planifié.

---

## Démarrage rapide

1. **Lire ce fichier** (vous y êtes).
2. **Choisir un chantier** dans le tableau ci-dessus selon priorité + effort + dépendances.
3. **Ouvrir le fichier de chantier** (les liens du tableau pointent vers les bons paths).
4. **Copier le bloc « Prompt prêt à l'emploi pour Claude Code »** dans une nouvelle session Claude Code.
5. **Suivre le découpage en sous-tâches** si le chantier est XL/L.
6. **Valider via les critères d'acceptation** + commandes PowerShell de validation listées dans chaque fichier.
7. **Commit + closeout CLAUDE.md** suivant le pattern installé Sprint X-Y-Z (chaque fichier de chantier indique le pattern à reprendre).

Pour l'effort total restant (en supposant qu'on traite tous les non-DORMANTS) :
- Hautes : 1 XL + 1 L + 1 M + 2 S = **~3-5 jours**
- Moyennes : 3 L + 4 M + 1 M = **~6-8 jours**
- Basses non-DORMANTS : 1 S + 1 S + 1 XS-S + 1 XS + 1 S + 1 S + 1 S = **~1-1.5 jours**

**Total estimé** : **~10-15 jours de dev** pour fermer 19 chantiers (24 - 5 DORMANTS). Les 5 DORMANTS s'ajoutent à la demande sur trigger.
