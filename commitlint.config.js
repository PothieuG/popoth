/**
 * commitlint config — Popoth
 *
 * Étend @commitlint/config-conventional + customisations alignées sur la convention
 * documentée dans CLAUDE.md §6 git ("Conventional Commits : fix:, feat:, chore:, ...").
 *
 * Le hook .husky/commit-msg invoque `pnpm exec commitlint --edit "$1"` à chaque commit.
 * Bypass d'urgence via `git commit --no-verify` (à éviter, cf. CLAUDE.md §6).
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Type allowlist — couvre les 50+ sprints livrés (cf. git log)
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'style', 'revert', 'build', 'ci'],
    ],
    // Subject: non-empty + max 100 chars (header total).
    // - subject-case OFF : proper nouns + abbreviations légitimes (CLAUDE.md, Sprint Pn, P3, R10, etc.)
    //   apparaissent dans 28/30 derniers commits — l'audit historique aurait fail sinon.
    // - header-max-length 100 (vs default 72) : les sprints multi-mots avec scope explicite
    //   (chantier, sub-feature) dépassent régulièrement 72 chars de manière légitime.
    'subject-case': [0],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
    // body-max-line-length OFF : commit messages multi-paragraphes avec prose longue
    // sont courants (closeouts, post-mortems). 100-char hard wrap inadapté.
    'body-max-line-length': [0],
    // Footer: Co-Authored-By: passe par défaut.
  },
}
