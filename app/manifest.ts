import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Popoth App',
    short_name: 'Popoth',
    description: 'Application de gestion financière personnelle et familiale',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone'],
    categories: ['finance', 'productivity'],
    background_color: '#0f172a',
    theme_color: '#6366f1',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
