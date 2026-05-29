# Précédents Sprint — chronologie résumée (Part 3)

> Suite de [sprint-chronology-part-2.md](sprint-chronology-part-2.md) (Part 2 proche du cap 39.5k au 2026-05-29 — la colonne "Pattern" paddée à ~1900 chars faisait qu'une ligne supplémentaire = +~2000 chars). Split chronologique préemptif (size-policy §7). **Fichier actif** pour logguer les sprints postérieurs au 2026-05-29.
>
> Append-only : 1 nouvelle ligne par sprint installant un pattern réutilisable. Granularité différente des `roadmap-detailed-NN-*.md` (verbatim closeouts). Ici : 1 row = 1 invariant/pattern actionable.

## Sprints installant un pattern réutilisable

| Sprint | Date | Pattern installé | Référence §11 |
| ------ | ---- | ---------------- | ------------- |
| Housekeeping-Deps-Format-Triage | 2026-05-29 | **Hygiène repo post-Part 38/39** (5 commits). (1) Glob lint-staged `*.{mjs,cjs,js}` ajouté → ferme le trou où les scripts Node dérivaient (seul `format:check` global les attrapait, jamais le pre-commit). (2) 4 vulns Dependabot **transitives** épinglées via `pnpm.overrides` : `fast-uri ^3.1.2` (2 CVE high), `@babel/plugin-transform-modules-systemjs ^7.29.4` (high), `ws@8 ^8.20.1` (moderate) — `pnpm audit` 0. (3) Fix assertion gated `financial-data-with-projects` case 2 : RAV groupe **inchangé** post-projet (PÉ-12 propage `monthly_allocation` dans `monthly_budget_estimate` → la contribution +50 annule le budget +50) au lieu de `−50`. (4) CLAUDE.md §9 réconcilié sur §5.5 (846/242). (5) `sprint-chronology-part-3.md` créé (split préemptif, part-2 saturée). Validé contre dev : gated `financial-data-with-projects` 4/4 + `add-exceptional-expense-with-piggy` 8/8. | CLAUDE.md §6 |

Pour la chronologie complète des sprints, voir CLAUDE.md §11 (index des parts `.claude/history/roadmap-detailed-NN-*.md`) + [Part 1](sprint-chronology.md) et [Part 2](sprint-chronology-part-2.md).
