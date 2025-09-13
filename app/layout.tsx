export const metadata = {
  title: 'Popoth App',
  description: 'Application mobile moderne avec Next.js et Supabase',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
