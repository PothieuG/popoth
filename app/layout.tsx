import './globals.css'
import { Roboto } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration'
import type { Metadata, Viewport } from 'next'

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
})

export const metadata: Metadata = {
  title: 'Popoth App',
  description: 'Application de gestion financière personnelle et familiale',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Popoth App',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#6366f1',
  interactiveWidget: 'resizes-content',
}

/**
 * Root layout component that wraps the entire application
 * Provides global authentication context and font configuration
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className="h-full overflow-hidden">
      <body className={`${roboto.variable} font-roboto h-full overflow-hidden`} suppressHydrationWarning={true}>
        <ServiceWorkerRegistration />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
