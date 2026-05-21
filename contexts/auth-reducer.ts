import type { AuthUser } from '@/lib/auth'

export type AuthState = {
  user: AuthUser | null
  loading: boolean
  error: string | null
}

export const initialAuthState: AuthState = {
  user: null,
  loading: true,
  error: null,
}

export type AuthAction =
  | { type: 'INIT_START' } // setLoading(true)
  | { type: 'INIT_SUCCESS'; user: AuthUser | null } // setUser + setLoading(false)
  | { type: 'INIT_ERROR'; error: string | null } // setError + setUser(null) + setLoading(false)
  | { type: 'AUTH_REQUEST' } // setLoading(true) + setError(null)
  | { type: 'AUTH_SUCCESS'; user: AuthUser } // setUser + setLoading(false)
  | { type: 'AUTH_FAILURE'; error: string } // setError + setLoading(false)
  | { type: 'LOGOUT_START' } // setLoading(true)
  | { type: 'LOGOUT' } // setUser(null) + setError(null)
  | { type: 'REGISTER_SUCCESS' } // setLoading(false) + setError(null), user unchanged (signUp does not auto-login)
  | { type: 'CLEAR_ERROR' } // setError(null)
  | { type: 'SET_USER'; user: AuthUser } // single-setUser (refreshUserSession)

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'INIT_START':
      return { ...state, loading: true }
    case 'INIT_SUCCESS':
      return { user: action.user, loading: false, error: null }
    case 'INIT_ERROR':
      return { user: null, loading: false, error: action.error }
    case 'AUTH_REQUEST':
      return { ...state, loading: true, error: null }
    case 'AUTH_SUCCESS':
      return { user: action.user, loading: false, error: null }
    case 'AUTH_FAILURE':
      return { ...state, loading: false, error: action.error }
    case 'LOGOUT_START':
      return { ...state, loading: true }
    case 'LOGOUT':
      return { ...state, user: null, error: null }
    case 'REGISTER_SUCCESS':
      return { ...state, loading: false, error: null }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
    case 'SET_USER':
      return { ...state, user: action.user }
    default: {
      // Compile-time exhaustiveness check.
      const _exhaustive: never = action
      void _exhaustive
      return state
    }
  }
}
