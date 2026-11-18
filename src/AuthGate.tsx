import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseConfigured } from './supabase'

interface AdminAuthContextValue {
  user: User
  signOut: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    const client = getSupabaseClient()
    let active = true
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setLoading(false)
      setAuthError('')
    })

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthError(error.message)
      else setSession(data.session)
      setLoading(false)
    }).catch((cause: unknown) => {
      if (!active) return
      setAuthError(errorMessage(cause))
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (!isSupabaseConfigured) {
    return (
      <AuthPage>
        <h1>Authentication needs configuration</h1>
        <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then rebuild the app.</p>
      </AuthPage>
    )
  }

  if (loading) {
    return <AuthPage><p role="status">Restoring your session…</p></AuthPage>
  }

  if (!session) {
    return <SignIn error={authError} onError={setAuthError} />
  }

  const value: AdminAuthContextValue = {
    user: session.user,
    signOut: async () => {
      const { error } = await getSupabaseClient().auth.signOut()
      if (error) throw error
    },
  }

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext)
  if (!context) throw new Error('useAdminAuth must be used within AuthGate.')
  return context
}

function SignIn({ error, onError }: { error: string; onError: (message: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    onError('')
    try {
      const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) throw signInError
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPage>
      <div className="auth-brand"><span className="brand-mark">R</span><span>rankup</span></div>
      <p className="eyebrow"><span className="eyebrow-line" /> ADMIN ACCESS</p>
      <h1>Sign in</h1>
      <p className="auth-description">Use the administrator account created for you.</p>
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthPage>
  )
}

function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        {children}
      </section>
    </main>
  )
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
