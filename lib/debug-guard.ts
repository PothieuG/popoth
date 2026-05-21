import { NextResponse } from 'next/server'

export function blockInProduction(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not Found', { status: 404 })
  }
  return null
}
