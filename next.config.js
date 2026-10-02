/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,
  turbopack: {},
  // `next dev` ajoute sinon à chaque démarrage un bloc « nextjs-agent-rules »
  // en fin de CLAUDE.md (+675 caractères), qui le fait dépasser le plafond de
  // 39 500 caractères des docs de contexte (check-md-size bloque le commit).
  agentRules: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  // Date simulée sur la base de test (lib/clock.ts). Vercel refuse d'enregistrer
  // en type « secret » une variable au préfixe public : `DEV_TODAY` (sans
  // préfixe) est donc acceptée aussi, et recopiée ici sous le nom que lit
  // l'appli, côté serveur comme côté navigateur. Une date n'a rien de secret,
  // et le garde-fou de lib/clock l'ignore hors base de test.
  env: {
    NEXT_PUBLIC_DEV_TODAY: process.env.NEXT_PUBLIC_DEV_TODAY ?? process.env.DEV_TODAY ?? '',
  },
}

module.exports = nextConfig
