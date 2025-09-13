'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

/**
 * Dashboard page - main application page for authenticated users
 * Clean interface with sticky navbar, slide-out menu panel, and sticky footer
 */
export default function DashboardPage() {
  const { logoutAndRedirect } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Sticky Navbar */}
      <nav className="sticky top-0 z-40 bg-white shadow-sm border-b border-gray-200">
        <div className="flex justify-between items-center p-4">
          <div className="text-lg font-semibold text-gray-900">
            Popoth App
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMenuOpen(true)}
            className="p-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1">
        {/* Empty content area for now */}
      </main>

      {/* Sticky Footer */}
      <footer className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
        {/* Empty footer for now */}
      </footer>

      {/* Slide-out Menu Panel */}
      <>
        {/* Overlay */}
        <div
          className={`fixed inset-0 z-50 bg-black transition-all duration-300 ease-in-out ${
            isMenuOpen ? 'bg-opacity-50 visible' : 'bg-opacity-0 invisible'
          }`}
          onClick={() => setIsMenuOpen(false)}
        />
        
        {/* Menu Panel */}
        <div className={`fixed inset-y-0 right-0 z-50 w-full bg-white shadow-xl transform transition-all duration-300 ease-in-out ${
          isMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}>
          <div className="flex flex-col h-full">
            {/* Menu Header */}
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMenuOpen(false)}
                className="p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>
            
            {/* Menu Content */}
            <div className="flex-1 p-4">
              {/* Menu items can be added here later */}
            </div>
            
            {/* Menu Footer with Logout */}
            <div className="p-4 border-t border-gray-200">
              <Button
                onClick={logoutAndRedirect}
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
              >
                Se déconnecter
              </Button>
            </div>
          </div>
        </div>
      </>
    </div>
  )
}