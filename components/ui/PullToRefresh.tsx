'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshIcon } from '@/components/ui/icons'
import { dampPull, findScrollableAncestor, shouldTriggerRefresh } from '@/lib/pull-to-refresh'

/**
 * Pull-to-refresh « tire pour rafraîchir » — geste mobile natif.
 *
 * Enveloppe le contenu d'une page : quand le conteneur scrollable interne est
 * tout en haut et que l'utilisateur tire vers le bas, tout le contenu suit le
 * doigt et révèle une roue ; au-delà du seuil, le relâchement déclenche
 * `onRefresh` (et la roue tourne jusqu'à sa résolution). Geste fait-main (zéro
 * dépendance), dans l'esprit de `hooks/useLongPress.ts`.
 *
 * Détails critiques :
 * - `touchmove` est attaché en NON-passif (`{ passive: false }`) et on appelle
 *   `preventDefault()` dès le PREMIER mouvement descendant qualifiant. Sans ça,
 *   iOS/PWA verrouille le geste en scroll (overscroll/rubber-band) et ignore les
 *   `preventDefault()` suivants → le tir ne se déclenche jamais.
 * - On décide « est-on en haut ? » au `touchstart` (snapshot du scrollTop). Si la
 *   liste était scrollée, le geste reste un scroll normal jusqu'au prochain appui.
 * - Wrapper transparent (pas de bg, pas d'`overflow`) → rendu identique au repos.
 */
interface PullToRefreshProps {
  /** Déclenché au relâchement au-delà du seuil. La roue tourne jusqu'à résolution. */
  onRefresh: () => Promise<void>
  /** false → passthrough sans aucun handler (autres pages du route group). */
  enabled?: boolean
  children: ReactNode
}

const TRIGGER_PX = 72 // distance de tir avant d'armer le refresh
const MAX_PULL_PX = 120 // plafond de la distance visible
const REFRESH_REST_PX = 88 // hauteur du rectangle de refresh (roue centrée dedans, sous le notch)
const RESISTANCE = 0.5 // fraction du déplacement du doigt rendue (effet élastique)
const MIN_SPINNER_MS = 600 // durée mini de la roue (anti-flicker)
const SETTLE_MS = 220 // durée de l'animation de retour

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Phase = 'idle' | 'pulling' | 'armed' | 'refreshing'

export function PullToRefresh({ onRefresh, enabled = true, children }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLDivElement>(null)

  const [phase, setPhase] = useState<Phase>('idle')

  // Dernier onRefresh via ref → les listeners natifs n'ont pas à se re-binder.
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  })

  // État mutable du geste — pas de re-render par frame (transform impératif).
  const gesture = useRef({
    startX: 0,
    startY: 0,
    canPull: false, // snapshot « en haut » au touchstart
    pulling: false,
    distance: 0,
    refreshing: false,
    vibrated: false,
  })

  const paint = useCallback((px: number, animate: boolean) => {
    const content = contentRef.current
    if (content) {
      content.style.transition = animate ? `transform ${SETTLE_MS}ms ease-out` : 'none'
      content.style.transform = px > 0 ? `translateY(${px}px)` : ''
    }
    const icon = iconRef.current
    if (icon) {
      const progress = Math.min(px / TRIGGER_PX, 1)
      icon.style.transform = `rotate(${progress * 270}deg)`
      icon.style.opacity = String(Math.min(px / (TRIGGER_PX * 0.6), 1))
    }
  }, [])

  const settleBack = useCallback(() => {
    const g = gesture.current
    g.pulling = false
    g.distance = 0
    g.vibrated = false
    paint(0, true)
  }, [paint])

  const runRefresh = useCallback(async () => {
    const g = gesture.current
    if (g.refreshing) return
    g.refreshing = true
    g.pulling = false
    g.vibrated = false
    setPhase('refreshing')
    paint(REFRESH_REST_PX, true)
    try {
      await Promise.allSettled([onRefreshRef.current(), delay(MIN_SPINNER_MS)])
    } finally {
      g.refreshing = false
      g.distance = 0
      setPhase('idle')
      paint(0, true)
    }
  }, [paint])

  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return

    const onTouchStart = (e: TouchEvent) => {
      const g = gesture.current
      if (g.refreshing || e.touches.length !== 1) return
      const t = e.touches[0]
      if (!t) return
      g.startX = t.clientX
      g.startY = t.clientY
      g.pulling = false
      g.distance = 0
      g.vibrated = false
      // Snapshot « en haut ? » au départ du geste — si la liste est scrollée,
      // on laisse le scroll natif tout le geste.
      const scrollEl = findScrollableAncestor(e.target as Element | null, container)
      g.canPull = scrollEl ? scrollEl.scrollTop <= 0 : true
    }

    const onTouchMove = (e: TouchEvent) => {
      const g = gesture.current
      if (g.refreshing || !g.canPull || e.touches.length !== 1) return
      const t = e.touches[0]
      if (!t) return
      const deltaY = t.clientY - g.startY
      const deltaX = t.clientX - g.startX

      // Doigt remonte (ou immobile) → rendre la main au scroll natif.
      if (deltaY <= 0) {
        if (g.pulling) {
          settleBack()
          setPhase('idle')
        }
        return
      }
      // Geste plutôt horizontal → ignorer (pas un tir vertical).
      if (Math.abs(deltaX) > deltaY) return

      // Descendant + en haut → c'est un TIR. preventDefault dès ce 1er mouvement
      // (sinon iOS verrouille en scroll et ignore les prevent suivants).
      e.preventDefault()
      if (!g.pulling) {
        g.pulling = true
        g.startY = t.clientY // rebase → la distance repart de 0
        setPhase('pulling')
      }

      const d = dampPull(t.clientY - g.startY, { resistance: RESISTANCE, max: MAX_PULL_PX })
      g.distance = d
      paint(d, false)

      const armed = shouldTriggerRefresh(d, TRIGGER_PX)
      if (armed && !g.vibrated) {
        g.vibrated = true
        navigator.vibrate?.(8)
      } else if (!armed) {
        g.vibrated = false
      }
      setPhase(armed ? 'armed' : 'pulling')
    }

    const onTouchEnd = () => {
      const g = gesture.current
      if (!g.pulling) return
      g.pulling = false
      if (shouldTriggerRefresh(g.distance, TRIGGER_PX)) {
        void runRefresh()
      } else {
        settleBack()
        setPhase('idle')
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    container.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [enabled, runRefresh, settleBack, paint])

  if (!enabled) return <>{children}</>

  const refreshing = phase === 'refreshing'

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col">
      {/* Roue derrière le contenu, révélée dans le gap au tir. La box prend la
          hauteur du rectangle de refresh ; items-center + justify-center centrent
          la roue, et le padding-top safe-area la garde sous le notch / Dynamic Island. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-0 flex items-center justify-center"
        style={{ height: REFRESH_REST_PX, paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
        aria-hidden={!refreshing}
      >
        <div
          ref={iconRef}
          className="text-blue-500"
          style={{ opacity: 0 }}
          role="status"
          aria-label={refreshing ? 'Rafraîchissement en cours' : undefined}
        >
          <RefreshIcon className={refreshing ? 'animate-spin' : ''} size="2xl" />
        </div>
      </div>

      <div ref={contentRef} className="relative z-10 flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
