/// <reference lib="dom" />
import { describe, it, expect, vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import { preventEnterSubmit } from '../prevent-enter-submit'

type Modifiers = {
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

function makeEvent(opts: {
  key: string
  target: HTMLElement
  modifiers?: Modifiers
}): KeyboardEvent<HTMLFormElement> {
  const preventDefault = vi.fn()
  return {
    key: opts.key,
    target: opts.target,
    shiftKey: opts.modifiers?.shiftKey ?? false,
    ctrlKey: opts.modifiers?.ctrlKey ?? false,
    metaKey: opts.modifiers?.metaKey ?? false,
    altKey: opts.modifiers?.altKey ?? false,
    preventDefault,
  } as unknown as KeyboardEvent<HTMLFormElement>
}

describe('preventEnterSubmit', () => {
  it('blocks Enter pressed on an <input> and blurs it', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    input.focus()
    const blurSpy = vi.spyOn(input, 'blur')

    const e = makeEvent({ key: 'Enter', target: input })
    preventEnterSubmit(e)

    expect(e.preventDefault).toHaveBeenCalledOnce()
    expect(blurSpy).toHaveBeenCalledOnce()
    input.remove()
  })

  it('allows Enter inside a <textarea> (multi-line input)', () => {
    const textarea = document.createElement('textarea')
    const blurSpy = vi.spyOn(textarea, 'blur')

    const e = makeEvent({ key: 'Enter', target: textarea })
    preventEnterSubmit(e)

    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(blurSpy).not.toHaveBeenCalled()
  })

  it('allows Enter on a <button> (intentional click)', () => {
    const button = document.createElement('button')
    button.type = 'submit'
    const blurSpy = vi.spyOn(button, 'blur')

    const e = makeEvent({ key: 'Enter', target: button })
    preventEnterSubmit(e)

    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(blurSpy).not.toHaveBeenCalled()
  })

  it('allows Enter on an <a> link', () => {
    const a = document.createElement('a')
    a.href = '#'

    const e = makeEvent({ key: 'Enter', target: a })
    preventEnterSubmit(e)

    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('does not interfere with other keys (Tab, Escape, letters)', () => {
    const input = document.createElement('input')
    const blurSpy = vi.spyOn(input, 'blur')

    for (const key of ['Tab', 'Escape', 'a', 'ArrowDown']) {
      const e = makeEvent({ key, target: input })
      preventEnterSubmit(e)
      expect(e.preventDefault).not.toHaveBeenCalled()
    }
    expect(blurSpy).not.toHaveBeenCalled()
  })

  it('lets Enter pass when a modifier key is held (Shift/Ctrl/Meta/Alt)', () => {
    const input = document.createElement('input')

    for (const mod of [
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ] satisfies Modifiers[]) {
      const e = makeEvent({ key: 'Enter', target: input, modifiers: mod })
      preventEnterSubmit(e)
      expect(e.preventDefault).not.toHaveBeenCalled()
    }
  })

  it('is safe when target is not an HTMLElement (synthetic events)', () => {
    const e = makeEvent({ key: 'Enter', target: null as unknown as HTMLElement })
    expect(() => preventEnterSubmit(e)).not.toThrow()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
