# Sprint Hygiene-CI — `.gitattributes` + freshness gate for generated types

## Contexte

Sprint Polish-CI (livré 2026-05-07, commits `436f7d5 → 0b89193` sur `cleanup`) a refermé D1–D6 et fait passer le score audit ~77 → ~78/100. Pendant l'exécution **3 petites traces** de surface ont émergé qui ne valent pas un patch immédiat mais s'accumulent en bruit DX :

1. **Tous les commits récents génèrent un warning git** `LF will be replaced by CRLF the next time Git touches it`. Le repo n'a pas de `.gitattributes` → la normalisation est laissée à `core.autocrlf=true` (défaut Windows). Conséquence : (a) Sprint Polish-CI / D2 a dû fixer un faux positif drift directement causé par cette absence ; (b) chaque dev Windows va re-trigger le warning à chaque write ; (c) un dev Mac/Linux qui clone obtient un working copy LF, alors qu'un dev Windows obtient CRLF — bugs subtilement différents potentiels (regex, parsing).

2. **Pas de filet contre `lib/database.types.ts` stale.** Le fichier est généré par `pnpm db:types` mais rien n'empêche un dev de modifier le schéma prod (via `apply-sql.mjs` ou `pnpm supabase db push`) et oublier de régénérer. Sprint Polish-CI / D3 a démontré que les RPC service-role-only apparaissent désormais dans le fichier généré (via `--linked`) — donc la "ground truth" pour les types est désormais entièrement dérivable de prod, et toute désynchro est détectable. Le `pnpm db:check-drift` détecte les drifts de schéma SQL mais PAS la désynchro types-générés ↔ schéma.

3. **Sprint Polish-CI / D5 reste à observer.** Le cron weekly `db-drift-check.yml` n'a toujours pas été déclenché manuellement via `workflow_dispatch` pour confirmer que le fix C3 marche en mode `schedule`. Pas un blocker mais un trou dans la confiance CI.

But du sprint : refermer ces 3 points avec **2 commits code + 1 closeout doc + observation D5**. Pas de migration DB. Score audit estimé post-sprint : ~79/100.

---

## Approche recommandée

### Bloc E1 — Add `.gitattributes` with `eol=lf`

**Fichier à créer** : `.gitattributes` à la racine.

**Contenu minimal** :
```gitattributes
# Force LF line endings on all text files, regardless of OS.
# Prevents Sprint Polish-CI / D2-style bugs (regex `.+$` not consuming `\r`)
# and eliminates the "LF will be replaced by CRLF" warning on every commit.
* text=auto eol=lf

# Binary file types (avoid corruption + diff noise)
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.webp binary
*.pdf binary
*.zip binary
```

**Re-normalize working copy** (one-time) :
```powershell
git add --renormalize .
git commit -m "chore: normalize line endings to LF (Sprint Hygiene-CI / E1)"
```

Cette commande re-stage tous les fichiers texte avec leur nouvelle représentation LF et committe le résultat. Sur le commit suivant, plus aucun warning `LF will be replaced by CRLF`.

**Effet secondaire bénéfique** : le fix `replace(/\r\n/g, '\n')` dans `scripts/check-drift.mjs` (Sprint Polish-CI / D2) devient un no-op en steady state (le working copy est LF), mais reste comme défense en profondeur si un dev a `core.autocrlf=true` localement.

**Verif** :
1. Après commit, `git status` clean.
2. `pnpm db:check-drift` exit 0 (LF baseline match).
3. Re-checkout : `git checkout main && git checkout cleanup` → pas de warning.
4. Sur Windows, vérifier qu'un nouveau `git status` ne re-marque pas tous les fichiers comme modifiés.

**Risques** : la re-normalisation génère un large diff (chaque fichier texte est touché). C'est une opération qu'on fait UNE FOIS — pas à craindre, mais bien noter dans le commit message que c'est purement EOL.

**Hors scope** : ajuster `.editorconfig` (le projet n'en a pas, le créer serait orthogonal mais pas urgent).

---

### Bloc E2 — `pnpm db:check-types-fresh` detector

**Goal** : détecter qu'on a oublié de régénérer `lib/database.types.ts` après une migration.

**Pattern** : analogue à `pnpm db:check-drift` (qui compare le SQL baseline ↔ prod). Ici on compare `lib/database.types.ts` ↔ ce que `pnpm db:types` produirait à l'instant T contre prod.

**Fichier à créer** : `scripts/check-types-fresh.mjs`

**Pseudo-code** :
```js
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

// Spawn `supabase gen types typescript --linked --schema public`,
// capture stdout, compare byte-by-byte against lib/database.types.ts.
// Normalize CRLF→LF on both sides (defense in depth, post-E1 the LHS is LF).
// Exit 0 if identical, exit 1 with summary diff if not.
```

**Script à ajouter** dans `package.json` :
```json
"db:check-types-fresh": "node scripts/check-types-fresh.mjs"
```

**Critère** :
- Sur un working tree clean post-`pnpm db:types`, exit 0.
- Si on touche le schéma prod via `apply-sql.mjs` (ou simulation : ajouter une colonne via SQL bidon), le script doit exit 1.
- Doc mise à jour dans CLAUDE.md §3 (commands) et §8 (after-migration checklist).

**Wirage CI** : ajouter le step au PR-time gate `db-drift-pr.yml` :
```yaml
- name: Check generated types are fresh
  if: always()
  run: pnpm db:check-types-fresh
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

**Risques** :
1. **Faux positif si le supabase CLI change subtilement son output** (e.g. ordre de propriétés dans un objet) — peu probable car versionné via `packageManager`. Si ça arrive : forcer un regen sur la branche, commit, le gate redevient vert.
2. **Performance** : `supabase gen types` prend ~3-5s en CI (call API Management). Acceptable.

**Hors scope** : étendre à d'autres schemas (`auth`, `storage`). On reste sur `public`.

---

### Bloc E3 — D5 cron observation follow-up

**Action manuelle (déjà décrite en Sprint Polish-CI / D5)** :
1. Aller sur https://github.com/PothieuG/popoth/actions/workflows/db-drift-check.yml
2. **Run workflow** sur `cleanup` (ou `main` si Sprint Polish-CI déjà mergé).
3. Vérifier 4 steps verts (pnpm/action-setup, db:check-drift, db:check-rpcs, db:check-functions).
4. Confirmer que "Open issue on failure" ne se déclenche pas.

**Closeout** : noter le résultat dans CLAUDE.md §11 (ou §7 si on documente le post-mortem). Si succès, le sprint est complet ; si échec, c'est le scope du sprint qui élargit pour debugger le YAML.

**Hors scope** : tester le step "Open issue on failure" en cassant volontairement (nécessiterait introduire un faux drift en prod).

---

## Ordre d'exécution

1. **E1** d'abord — `.gitattributes` + renormalize. C'est le plus invasif (large diff EOL) mais le plus simple. 1 commit dédié.
2. **E2** ensuite — script + package.json + workflow. 1 commit code + ajustement YAML.
3. **E3** parallèlement à E2 (manuel GitHub UI, sans bloquer).
4. **Closeout** : CLAUDE.md §3/§7/§8/§11 + README.md (commands + structure si applicable).

**Commits attendus** : 2 code (E1, E2) + 1 closeout. Conventional commits, scope `chore` pour E1, `feat(scripts)` pour E2.

---

## Fichiers critiques touchés

| Fichier | Bloc | Type de modif |
|---|---|---|
| `.gitattributes` | E1 | create (~12 lignes) |
| Tout le working copy | E1 | renormalize (massive diff EOL — purement cosmétique) |
| `scripts/check-types-fresh.mjs` | E2 | create (~80 lignes) |
| `package.json` | E2 | add script |
| `.github/workflows/db-drift-pr.yml` | E2 | add step |
| `.github/workflows/db-drift-check.yml` | E2 (optionnel) | add step au cron weekly |
| `CLAUDE.md` | closeout | §3, §7, §8, §11 |
| `README.md` | closeout | Commands + Tests sections |

---

## Verification end-to-end

```powershell
# E1
git status                       # clean après renormalize
pnpm db:check-drift              # exit 0 (LF baseline)
# Bonus : éditer un .ts au hasard puis git diff — pas de warning EOL

# E2
pnpm db:check-types-fresh        # exit 0 sur main / cleanup
# Test négatif : éditer manuellement lib/database.types.ts (ajouter un champ bidon)
pnpm db:check-types-fresh        # exit 1 avec diff résumé
git checkout lib/database.types.ts  # restore
pnpm db:check-types-fresh        # exit 0

# Sanity globale
pnpm typecheck                   # exit 0
pnpm lint:check                  # 136 problèmes pre-existants (hors scope)
pnpm test:run                    # 4 passed, 18 gated skipped
pnpm db:check-rpcs               # exit 0
pnpm db:check-functions          # exit 0
pnpm db:audit-functions          # exit 0
pnpm db:audit-objects            # exit 0
```

---

## Risques résiduels

1. **E1 — la renormalize crée un diff énorme** : tous les fichiers texte committés ont leur EOL réécrit. C'est attendu (one-time chore), mais à mentionner dans le commit message pour ne pas surprendre lors d'une review. Le diff est purement cosmétique (`git diff --ignore-all-space` reste vide).

2. **E1 — un dev Windows avec `core.autocrlf=true` après le merge** : son checkout va réécrire en CRLF localement, mais le repo reste LF côté git. Le warning à commit ne reviendra que s'il modifie un fichier ; le `.gitattributes` règle l'arbitrage en faveur de LF côté repo. Si ça gêne : recommander `git config --global core.autocrlf input` aux devs Windows (note dans README.md ?).

3. **E2 — supabase CLI version drift** : si pnpm hisse `supabase` à une nouvelle version qui change le shape de `gen types`, le gate va exit 1 sur des PRs sans changement de schéma. Mitigation : pin `supabase` dans `devDependencies` (déjà à `^2.98.2`) — toute bump majeure est un commit visible.

4. **E3 — observation peut révéler un nouveau bug cron-only** : ex. permissions différentes en mode `schedule` vs `pull_request`. Si ça arrive, le sprint étend.

---

## Hors scope

- Sprint 1 (Prettier/Husky/CI/ESLint Next 16) — sprint dédié, ne pas mélanger.
- Lint cleanup global (~136 errors) — chantier progressif.
- Chantiers I4 / I5 / console.log / Zod — chantiers dédiés.
- Migration vers Node.js 24 (Sprint Polish-CI / D6 défer).
- `.editorconfig` — orthogonal, pas urgent.

---

## Push gate

E1, E2 = code-only, pas de prod touché, pas de migration DB. Pas de confirmation utilisateur requise au-delà de l'approbation de ce plan.

E3 = manuel GitHub UI (workflow_dispatch sur un check read-only). Pas de risque.

**Aucun changement DB attendu sur ce sprint.**

---

## Lessons learned reportées de Sprint Polish-CI à appliquer

1. **Lors de l'exploration initiale** : grep BOTH `from '@/lib/X'` ET `from './X'` patterns. La D3 a manqué 2 fichiers prod (`supabase-{client,server}.ts`) car ils utilisaient l'import relatif. La même chose pourrait se produire dans E2 si on touche aux scripts.
2. **Les regex avec `.+$` sur du texte multi-ligne** : toujours penser au `\r`. JS regex sans `s`/`m` n'absorbe pas `\r` dans `.`. Si E2 fait du parsing de stdout supabase, garder cette leçon en tête.
3. **Les `pnpm` script wrappers** : si un script doit écrire en stdout proprement, embarquer le `>` dans la valeur du script (Sprint Polish-CI / D1) plutôt que compter sur `--silent` au call site.
