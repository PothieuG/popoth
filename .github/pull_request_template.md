## Résumé

<!-- 1-3 phrases : pourquoi ce PR et ce qu'il fait -->

## Type

- [ ] feat — nouvelle fonctionnalité
- [ ] fix — bug fix
- [ ] refactor — refactor sans changement fonctionnel
- [ ] chore — outillage/build/deps
- [ ] docs — documentation seule
- [ ] test — ajout ou refactor de tests

## Checklist

- [ ] `pnpm typecheck` passe
- [ ] `pnpm lint:check` passe
- [ ] `pnpm format:check` passe
- [ ] `pnpm test:run` passe (et un nouveau test couvre le changement, si applicable)
- [ ] Pas de nouveau `console.log` (préférer `console.warn` / `console.error` ou un logger dédié)
- [ ] Pas de nouveau `: any` non justifié
- [ ] Pas de nouveau secret commité (`git diff --staged | grep -E 'KEY|SECRET|TOKEN'`)
- [ ] CLAUDE.md mis à jour si l'API ou le modèle de données change
- [ ] Migration Supabase ajoutée si le schéma change

## Tests manuels

<!-- Scénario testé en local : login → ajout dépense → … -->

## Captures (si UI)

<!-- screenshots avant/après -->
