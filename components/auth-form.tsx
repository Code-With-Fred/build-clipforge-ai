'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const isSignUp = mode === 'sign-up'

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    const result = isSignUp
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password })
    setPending(false)
    if (result.error) {
      setError('We could not complete that request. Check your details and try again.')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">CLIPFORGE <span>AI</span></div>
        <h1 id="auth-title">{isSignUp ? 'Create your workspace' : 'Welcome back'}</h1>
        <p>{isSignUp ? 'Start turning long videos into short-form content.' : 'Sign in to continue to your projects.'}</p>
        <form onSubmit={submit} className="auth-form">
          {isSignUp && <input aria-label="Name" placeholder="Full name" value={name} onChange={(event) => setName(event.target.value)} required />}
          <input aria-label="Email" type="email" placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <input aria-label="Password" type="password" placeholder="Password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" disabled={pending}>{pending ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}</button>
        </form>
        <a href={isSignUp ? '/sign-in' : '/sign-up'}>{isSignUp ? 'Already have an account? Sign in' : 'New to ClipForge? Create an account'}</a>
      </section>
    </main>
  )
}
