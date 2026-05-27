import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'

import { __resetDialogStackForTests, useDialogBackButton } from '../useDialogBackButton'

// Sprint Mobile-Back-Closes-Drawers (2026-05-27). Couvre :
//   - pushState d'un sentinel à l'ouverture
//   - history.back appelé au close programmatique (X / Escape / backdrop)
//   - popstate déclenche onClose sans re-pousser history.back (évite la
//     boucle infinie back→close→back→popstate→close)
//   - empilement : seul le dialog du dessus se ferme sur popstate
//   - état clobbéré (navigation page pendant que drawer ouvert) → skip back

interface HarnessProps {
  onClose: () => void
}

function Harness({ onClose }: HarnessProps) {
  const [open, setOpen] = useState(false)
  useDialogBackButton(open, () => {
    onClose()
    setOpen(false)
  })
  return (
    <div>
      <button type="button" data-testid="open" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" data-testid="close" onClick={() => setOpen(false)}>
        close
      </button>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
    </div>
  )
}

describe('useDialogBackButton', () => {
  beforeEach(() => {
    __resetDialogStackForTests()
    window.history.replaceState(null, '', window.location.href)
  })

  afterEach(() => {
    __resetDialogStackForTests()
  })

  it('pushes a sentinel history entry when the dialog opens', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness onClose={onClose} />)

    expect((window.history.state as { __dialog?: string } | null)?.__dialog).toBeUndefined()
    act(() => {
      fireEvent.click(getByTestId('open'))
    })
    expect((window.history.state as { __dialog?: string } | null)?.__dialog).toMatch(/^dlg-/)
  })

  it('preserves existing history state when pushing the sentinel', () => {
    window.history.replaceState({ existing: 'state' }, '', window.location.href)
    const { getByTestId } = render(<Harness onClose={vi.fn()} />)

    act(() => {
      fireEvent.click(getByTestId('open'))
    })

    const state = window.history.state as { existing?: string; __dialog?: string }
    expect(state.existing).toBe('state')
    expect(state.__dialog).toMatch(/^dlg-/)
  })

  it('calls history.back when closed programmatically (X / Escape / backdrop)', () => {
    const backSpy = vi.spyOn(window.history, 'back')
    const { getByTestId } = render(<Harness onClose={vi.fn()} />)

    act(() => {
      fireEvent.click(getByTestId('open'))
    })
    backSpy.mockClear()
    act(() => {
      fireEvent.click(getByTestId('close'))
    })

    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog on popstate without calling history.back', () => {
    const backSpy = vi.spyOn(window.history, 'back')
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness onClose={onClose} />)

    act(() => {
      fireEvent.click(getByTestId('open'))
    })
    backSpy.mockClear()

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getByTestId('state').textContent).toBe('closed')
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('only closes the topmost dialog when multiple are stacked', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()

    function Stacked() {
      const [aOpen, setAOpen] = useState(false)
      const [bOpen, setBOpen] = useState(false)
      useDialogBackButton(aOpen, () => {
        onCloseA()
        setAOpen(false)
      })
      useDialogBackButton(bOpen, () => {
        onCloseB()
        setBOpen(false)
      })
      return (
        <div>
          <button type="button" data-testid="openA" onClick={() => setAOpen(true)}>
            openA
          </button>
          <button type="button" data-testid="openB" onClick={() => setBOpen(true)}>
            openB
          </button>
        </div>
      )
    }

    const { getByTestId } = render(<Stacked />)
    act(() => {
      fireEvent.click(getByTestId('openA'))
    })
    act(() => {
      fireEvent.click(getByTestId('openB'))
    })

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(onCloseB).toHaveBeenCalledTimes(1)
    expect(onCloseA).not.toHaveBeenCalled()

    // Second back fires onCloseA
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(onCloseA).toHaveBeenCalledTimes(1)
  })

  it('skips history.back when the sentinel was clobbered by navigation', () => {
    const backSpy = vi.spyOn(window.history, 'back')
    const { getByTestId } = render(<Harness onClose={vi.fn()} />)

    act(() => {
      fireEvent.click(getByTestId('open'))
    })

    // Simule : l'utilisateur navigue vers une autre page pendant que le drawer
    // est ouvert → Next.js pousse son propre state par-dessus notre sentinel.
    window.history.pushState({ someNextState: true }, '', window.location.href)
    backSpy.mockClear()

    act(() => {
      fireEvent.click(getByTestId('close'))
    })

    expect(backSpy).not.toHaveBeenCalled()
  })

  it('does not cascade-close the parent when a stacked child closes programmatically', () => {
    // Regression : avant le pendingProgrammaticBacks counter, le history.back
    // de cleanup de l'enfant déclenchait un popstate qui re-fermait le parent.
    const onCloseParent = vi.fn()
    const onCloseChild = vi.fn()

    function ParentWithChild() {
      const [parentOpen, setParentOpen] = useState(false)
      const [childOpen, setChildOpen] = useState(false)
      useDialogBackButton(parentOpen, () => {
        onCloseParent()
        setParentOpen(false)
      })
      useDialogBackButton(childOpen, () => {
        onCloseChild()
        setChildOpen(false)
      })
      return (
        <div>
          <button type="button" data-testid="openParent" onClick={() => setParentOpen(true)}>
            openParent
          </button>
          <button type="button" data-testid="openChild" onClick={() => setChildOpen(true)}>
            openChild
          </button>
          <button type="button" data-testid="closeChild" onClick={() => setChildOpen(false)}>
            closeChild
          </button>
        </div>
      )
    }

    const { getByTestId } = render(<ParentWithChild />)
    act(() => {
      fireEvent.click(getByTestId('openParent'))
    })
    act(() => {
      fireEvent.click(getByTestId('openChild'))
    })
    act(() => {
      fireEvent.click(getByTestId('closeChild'))
    })

    // Le closeChild bypass la callback du hook (setChildOpen direct), donc
    // onCloseChild n'est pas appelé. Mais le cleanup du hook DOIT toujours
    // tourner (open est passé true→false) et appeler history.back, qui
    // déclenche un popstate. Ce qu'on vérifie : ce popstate NE doit PAS
    // cascader sur le parent.
    expect(onCloseChild).not.toHaveBeenCalled()
    expect(onCloseParent).not.toHaveBeenCalled()
  })

  it('uses the latest onClose closure even when the consumer re-renders', () => {
    const firstClose = vi.fn()
    const secondClose = vi.fn()

    function Trickle() {
      const [open, setOpen] = useState(false)
      const [phase, setPhase] = useState<'a' | 'b'>('a')
      useDialogBackButton(open, phase === 'a' ? firstClose : secondClose)
      return (
        <div>
          <button type="button" data-testid="open" onClick={() => setOpen(true)}>
            open
          </button>
          <button type="button" data-testid="phase" onClick={() => setPhase('b')}>
            phase
          </button>
        </div>
      )
    }

    const { getByTestId } = render(<Trickle />)
    act(() => {
      fireEvent.click(getByTestId('open'))
    })
    act(() => {
      fireEvent.click(getByTestId('phase'))
    })
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(firstClose).not.toHaveBeenCalled()
    expect(secondClose).toHaveBeenCalledTimes(1)
  })
})
