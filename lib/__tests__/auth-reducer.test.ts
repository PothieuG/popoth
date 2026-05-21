import { describe, it, expect } from 'vitest'
import {
  authReducer,
  initialAuthState,
  type AuthState,
  type AuthAction,
} from '@/contexts/auth-reducer'
import type { AuthUser } from '@/lib/auth'

const fakeUser: AuthUser = { id: 'user-1', email: 'a@b.test' }
const fakeUser2: AuthUser = { id: 'user-2', email: 'c@d.test' }
const baseState: AuthState = { user: null, loading: false, error: null }
const loggedInState: AuthState = { user: fakeUser, loading: false, error: null }

describe('authReducer', () => {
  it('initialAuthState starts loading with no user / no error', () => {
    expect(initialAuthState).toStrictEqual({ user: null, loading: true, error: null })
  })

  it('INIT_START flips loading on, preserves user/error', () => {
    const input: AuthState = { ...baseState, error: 'previous' }
    const result = authReducer(input, { type: 'INIT_START' })
    expect(result).toStrictEqual({ user: null, loading: true, error: 'previous' })
    // Identity guard — useReducer requires a new reference to re-render.
    expect(result).not.toBe(input)
  })

  it('INIT_SUCCESS with user clears loading + error and sets user', () => {
    const input: AuthState = { ...baseState, loading: true }
    const result = authReducer(input, { type: 'INIT_SUCCESS', user: fakeUser })
    expect(result).toStrictEqual({ user: fakeUser, loading: false, error: null })
  })

  it('INIT_SUCCESS with null logs out (unauthenticated init)', () => {
    const result = authReducer(loggedInState, { type: 'INIT_SUCCESS', user: null })
    expect(result).toStrictEqual({ user: null, loading: false, error: null })
  })

  it('INIT_ERROR clears user + loading and sets error', () => {
    const result = authReducer(loggedInState, {
      type: 'INIT_ERROR',
      error: "Erreur d'initialisation",
    })
    expect(result).toStrictEqual({
      user: null,
      loading: false,
      error: "Erreur d'initialisation",
    })
  })

  it('AUTH_REQUEST flips loading on, clears error, preserves user', () => {
    const input: AuthState = { ...loggedInState, error: 'previous' }
    const result = authReducer(input, { type: 'AUTH_REQUEST' })
    expect(result).toStrictEqual({ user: fakeUser, loading: true, error: null })
  })

  it('AUTH_SUCCESS sets user, clears loading + error', () => {
    const input: AuthState = { ...baseState, loading: true }
    const result = authReducer(input, { type: 'AUTH_SUCCESS', user: fakeUser })
    expect(result).toStrictEqual({ user: fakeUser, loading: false, error: null })
  })

  it('AUTH_FAILURE preserves user (login fail does not logout)', () => {
    const input: AuthState = { ...loggedInState, loading: true }
    const result = authReducer(input, { type: 'AUTH_FAILURE', error: 'Mauvais mot de passe' })
    expect(result).toStrictEqual({
      user: fakeUser,
      loading: false,
      error: 'Mauvais mot de passe',
    })
  })

  it('LOGOUT_START flips loading on, preserves user + error', () => {
    const input: AuthState = { ...loggedInState, error: 'X' }
    const result = authReducer(input, { type: 'LOGOUT_START' })
    expect(result).toStrictEqual({ user: fakeUser, loading: true, error: 'X' })
  })

  it('LOGOUT clears user + error, preserves loading flag from LOGOUT_START', () => {
    const input: AuthState = { user: fakeUser, loading: true, error: 'X' }
    const result = authReducer(input, { type: 'LOGOUT' })
    expect(result).toStrictEqual({ user: null, loading: true, error: null })
  })

  it('REGISTER_SUCCESS clears loading + error, preserves user (signUp does not auto-login)', () => {
    const input: AuthState = { ...baseState, loading: true, error: 'X' }
    const result = authReducer(input, { type: 'REGISTER_SUCCESS' })
    expect(result).toStrictEqual({ user: null, loading: false, error: null })
  })

  it('CLEAR_ERROR resets only error', () => {
    const input: AuthState = { ...loggedInState, error: 'X' }
    const result = authReducer(input, { type: 'CLEAR_ERROR' })
    expect(result).toStrictEqual({ user: fakeUser, loading: false, error: null })
  })

  it('SET_USER replaces user, preserves loading + error', () => {
    const input: AuthState = { ...loggedInState, error: 'X' }
    const result = authReducer(input, { type: 'SET_USER', user: fakeUser2 })
    expect(result).toStrictEqual({ user: fakeUser2, loading: false, error: 'X' })
  })

  it('unknown action falls through default branch and returns state as-is', () => {
    // Cast forces an unknown discriminant past the compile-time exhaustiveness
    // check, exercising the runtime default. The `never` assignment in the
    // reducer is a compile-time guard and must not crash at runtime.
    const bogus = { type: 'NOT_A_REAL_ACTION' } as unknown as AuthAction
    const result = authReducer(baseState, bogus)
    expect(result).toBe(baseState)
  })
})
