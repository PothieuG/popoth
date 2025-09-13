import './globals.css'
import { Roboto } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
})

export const metadata = {
  title: 'Popoth App',
  description: 'Application mobile moderne avec Next.js et Supabase',
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
    <html lang="en">
      <body className={`${roboto.variable} font-roboto`} suppressHydrationWarning={true}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
