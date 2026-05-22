'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent } from 'react'

/**
 * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). Reusable long-press
 * gesture hook (aucun équivalent dans le repo au moment de la création).
 *
 * Usage :
 *   const longPress = useLongPress(() => doThing(), { delayMs: 800 })
 *   return <div {...longPress}>...</div>
 *
 * Comportement :
 *   - PointerDown → start un setTimeout de `delayMs` ms + appelle `onStart`.
 *   - PointerUp/Leave/Cancel avant `delayMs` → cancel le timer + appelle
 *     `onCancel`. Le scroll mobile fire un `pointercancel` natif → couvert.
 *   - Timer expiré → callback() + flag `triggeredRef` pour bloquer le
 *     `contextmenu` natif iOS / Android (sinon le browser ouvre le menu
 *     copier/coller sur le texte sous le doigt).
 *   - Mouse : ignore les boutons non-gauches (button !== 0).
 *
 * Le style retourné neutralise `user-select`, `touch-callout` (iOS) et
 * `touch-action` pour éviter sélection texte + delay 300ms double-tap.
 *
 * @param callback déclenché si le doigt reste appuyé `delayMs` ms.
 * @param options.delayMs défaut 800 ms (standard Material/iOS long-press).
 * @param options.onStart appelé immédiatement au pointerdown valide. Sert
 *   p.ex. à déclencher `navigator.vibrate?.(50)` ou afficher un progress
 *   ring.
 * @param options.onCancel appelé si le timer est annulé (relâche / scroll /
 *   leave). Pas appelé après le callback.
 */
export interface UseLongPressOptions {
  delayMs?: number
  onStart?: () => void
  onCancel?: () => void
}

export interface UseLongPressHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onContextMenu: (e: MouseEvent<HTMLElement>) => void
  style: CSSProperties
}

const PRESS_STYLE: CSSProperties = {
  touchAction: 'manipulation',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
}

export function useLongPress(
  callback: () => void,
  options: UseLongPressOptions = {},
): UseLongPressHandlers {
  const { delayMs = 800, onStart, onCancel } = options
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggeredRef = useRef(false)
  // Latest callbacks via ref — évite de re-créer les handlers à chaque
  // render des consumers (qui passent souvent des inline arrow functions).
  const callbackRef = useRef(callback)
  const onStartRef = useRef(onStart)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    callbackRef.current = callback
    onStartRef.current = onStart
    onCancelRef.current = onCancel
  })

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      // Ignore non-primary buttons (right-click=2, middle-click=1, back/forward
      // 3/4). Touch events report button=0, so they pass. Le check via `button`
      // est plus portable que `pointerType === 'mouse'` qui n'est pas toujours
      // renseigné par jsdom (cas test).
      if (typeof e.button === 'number' && e.button !== 0) return
      triggeredRef.current = false
      clear()
      onStartRef.current?.()
      timerRef.current = setTimeout(() => {
        triggeredRef.current = true
        timerRef.current = null
        callbackRef.current()
      }, delayMs)
    },
    [clear, delayMs],
  )

  const handleCancel = useCallback(() => {
    if (timerRef.current != null) {
      clear()
      onCancelRef.current?.()
    }
  }, [clear])

  const handleContextMenu = useCallback((e: MouseEvent<HTMLElement>) => {
    // Bloque le menu contextuel natif si le long-press vient de déclencher
    // (sinon iOS/Android affichent copier/coller juste après le callback).
    if (triggeredRef.current) {
      e.preventDefault()
      triggeredRef.current = false
    }
  }, [])

  // Cleanup au unmount
  useEffect(() => clear, [clear])

  return {
    onPointerDown: handlePointerDown,
    onPointerUp: handleCancel,
    onPointerLeave: handleCancel,
    onPointerCancel: handleCancel,
    onContextMenu: handleContextMenu,
    style: PRESS_STYLE,
  }
}
