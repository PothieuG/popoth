import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PullToRefresh } from '../PullToRefresh'
import { findScrollableAncestor } from '@/lib/pull-to-refresh'

// Single-finger touch init (handler reads only `e.touches`).
const touch = (clientY: number, clientX = 50) => ({ touches: [{ clientX, clientY }] })

afterEach(() => {
  vi.useRealTimers()
})

describe('PullToRefresh', () => {
  it('renders its children', () => {
    render(
      <PullToRefresh onRefresh={vi.fn().mockResolvedValue(undefined)}>
        <div data-testid="child">contenu</div>
      </PullToRefresh>,
    )
    expect(screen.getByTestId('child')).toHaveTextContent('contenu')
  })

  it('is a passthrough with no handlers when disabled', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(
      <PullToRefresh enabled={false} onRefresh={onRefresh}>
        <div data-testid="child">contenu</div>
      </PullToRefresh>,
    )
    const child = screen.getByTestId('child')
    fireEvent.touchStart(child, touch(100))
    fireEvent.touchMove(child, touch(120))
    fireEvent.touchMove(child, touch(400))
    fireEvent.touchEnd(child)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('fires onRefresh when pulled past the threshold and released', async () => {
    // Only fake setTimeout (delay of the min-spinner) — leave React's scheduler
    // alone — so the trailing settle update can be flushed inside act().
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">contenu</div>
      </PullToRefresh>,
    )
    const child = screen.getByTestId('child')
    fireEvent.touchStart(child, touch(100))
    // The FIRST qualifying downward move must call preventDefault (core fix:
    // otherwise iOS commits the gesture to scrolling and the pull never fires).
    // fireEvent returns false when a handler called preventDefault.
    const firstMoveNotCancelled = fireEvent.touchMove(child, touch(120))
    expect(firstMoveNotCancelled).toBe(false)
    fireEvent.touchMove(child, touch(320)) // deltaY 200 → distance 100 ≥ 72
    fireEvent.touchEnd(child)

    expect(onRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.runAllTimersAsync()
    })
  })

  it('does NOT fire onRefresh when released below the threshold', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">contenu</div>
      </PullToRefresh>,
    )
    const child = screen.getByTestId('child')
    fireEvent.touchStart(child, touch(100))
    fireEvent.touchMove(child, touch(120)) // arms + rebase (startY = 120)
    fireEvent.touchMove(child, touch(150)) // deltaY 30 → distance 15 < 72
    fireEvent.touchEnd(child)
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('findScrollableAncestor', () => {
  it('returns the nearest overflowing scrollable ancestor', () => {
    const boundary = document.createElement('div')
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'scrollHeight', { value: 200, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true })
    const leaf = document.createElement('span')
    scroller.appendChild(leaf)
    boundary.appendChild(scroller)

    expect(findScrollableAncestor(leaf, boundary)).toBe(scroller)
  })

  it('returns null when there is no overflowing scrollable ancestor', () => {
    const boundary = document.createElement('div')
    const plain = document.createElement('div') // overflow visible by default
    const leaf = document.createElement('span')
    plain.appendChild(leaf)
    boundary.appendChild(plain)

    expect(findScrollableAncestor(leaf, boundary)).toBeNull()
  })

  it('stops at the boundary without returning it', () => {
    const boundary = document.createElement('div')
    boundary.style.overflowY = 'auto'
    Object.defineProperty(boundary, 'scrollHeight', { value: 200, configurable: true })
    Object.defineProperty(boundary, 'clientHeight', { value: 100, configurable: true })
    const leaf = document.createElement('span')
    boundary.appendChild(leaf)

    expect(findScrollableAncestor(leaf, boundary)).toBeNull()
  })
})
