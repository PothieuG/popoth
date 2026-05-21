'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface DropdownMenuItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
  className?: string
  disabled?: boolean
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  triggerClassName?: string
  buttonClassName?: string
  buttonContent?: React.ReactNode
}

interface MenuPosition {
  top: number
  left: number
  maxHeight: number
}

const MENU_WIDTH = 192 // matches w-48
const MENU_GAP = 4
const VIEWPORT_PADDING = 8
const BOTTOM_MARGIN_RATIO = 0.1

/**
 * Composant menu dropdown (3 points verticaux) avec Modifier/Supprimer etc.
 *
 * Pattern miroir [CustomDropdown](./CustomDropdown.tsx) (Sprint Modal-Dropdown-Portal
 * 2026-05-21) : menu portaled dans `document.body` en `position: fixed` au lieu
 * de `absolute` enfant d'un `<div className="relative">`. Raisons :
 * - Le DropdownMenu vit dans des Cards/rows dont les ancêtres ont
 *   `overflow-hidden` (Card iOS, DialogContent, drawer scrollable) — un menu
 *   absolute y serait clipped (ou agrandit la card si pas de overflow-hidden).
 * - `z-[100]` rend le menu au-dessus de tout layer (Dialog/Drawer z-50,
 *   snackbar z-[60]).
 * - Max-height dynamique = `viewport - rect.bottom - 10vh - 4px` pour ne jamais
 *   dépasser 90% du viewport en bas, scroll interne si nécessaire (plancher 120px).
 * - Reposition sur scroll (capture phase pour capter les scrolls internes des
 *   ancêtres) + resize.
 * - `pointerEvents: 'auto'` requis pour échapper au `body.style.pointerEvents = 'none'`
 *   posé par Radix DismissableLayer quand un Dialog est ouvert (Sprint
 *   Fix-Dropdown-PointerEvents-Auto 2026-05-21).
 * - `stopPropagation` sur `onPointerDown`/`onMouseDown` empêche Radix
 *   DismissableLayer de fermer le Dialog parent au clic sur une option
 *   portaled (le menu est hors du subtree de DialogContent).
 */
export default function DropdownMenu({
  items,
  triggerClassName,
  buttonClassName,
  buttonContent,
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const computeMenuPosition = useCallback((): MenuPosition | null => {
    if (!buttonRef.current) return null
    const rect = buttonRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const bottomMargin = viewportHeight * BOTTOM_MARGIN_RATIO
    const maxHeight = Math.max(viewportHeight - rect.bottom - bottomMargin - MENU_GAP, 120)
    // Right-align menu with button's right edge (mirrors original `right-0`),
    // then clamp into viewport with 8px padding on both sides.
    let left = rect.right - MENU_WIDTH
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING
    const maxLeft = viewportWidth - VIEWPORT_PADDING - MENU_WIDTH
    if (left > maxLeft) left = maxLeft
    return {
      top: rect.bottom + MENU_GAP,
      left,
      maxHeight,
    }
  }, [])

  // Reposition on scroll (capture-phase catches scrolls inside modals/drawers)
  // and viewport resize while open.
  useEffect(() => {
    if (!isOpen) return
    const update = () => {
      const next = computeMenuPosition()
      if (next) setMenuPos(next)
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [isOpen, computeMenuPosition])

  // Click outside on button OR portaled menu closes the dropdown. Both refs
  // are checked because the menu lives in a separate DOM subtree via portal.
  useEffect(() => {
    if (!isOpen) return
    const handler = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const toggleOpen = () => {
    if (!isOpen) {
      const pos = computeMenuPosition()
      if (pos) setMenuPos(pos)
    }
    setIsOpen((prev) => !prev)
  }

  return (
    <>
      {/* Bouton trigger avec 3 points verticaux */}
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={
          buttonClassName ||
          `flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-gray-100 ${triggerClassName || ''}`
        }
        aria-label="Options"
        aria-expanded={isOpen}
      >
        {buttonContent || (
          <svg className="h-4 w-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
          </svg>
        )}
      </button>

      {/* Menu portaled to document.body — escapes ancestor overflow:hidden +
          transform clipping, sits at z-[100] above any Dialog/Drawer/snackbar. */}
      {isOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              width: MENU_WIDTH,
              maxHeight: menuPos.maxHeight,
              pointerEvents: 'auto',
            }}
            className="z-[100] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {items.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick()
                    setIsOpen(false)
                  }
                }}
                disabled={item.disabled}
                className={`flex w-full items-center space-x-1.5 px-3 py-2 text-left transition-colors ${
                  item.disabled
                    ? 'cursor-not-allowed text-gray-400'
                    : item.variant === 'danger'
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
