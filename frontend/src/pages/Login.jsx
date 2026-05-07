import { useState } from 'react'
import { Zap, AlertCircle } from 'lucide-react'

export default function Login({ apiUrl, onLogin }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Email and password required.'); return }
    setError('')
    setLoading(true)
    try {
      const res  = await fetch(`${apiUrl}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed.'); return }
      onLogin(data.token, data.contractor)
    } catch {
      setError('Could not reach server. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0f1a 0%, #0f172a 50%, #0a0f1a 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: '460px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '64px', height: '64px', borderRadius: '16px', marginBottom: '16px',
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
          }}>
            <Zap style={{ width: '32px', height: '32px', color: 'white' }} />
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: 'white', letterSpacing: '-0.5px' }}>
            Contractor OS
          </div>
          <div style={{ fontSize: '15px', color: '#64748b', marginTop: '6px' }}>
            Sign in to your AI workspace
          </div>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit} style={{
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: '20px',
          padding: '40px',
          boxShadow: '0 32px 64px rgba(0,0,0,0.5)',
        }}>

          {/* Email */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#1e293b', border: '1px solid #334155',
                borderRadius: '10px', color: 'white',
                padding: '14px 16px', fontSize: '15px',
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#334155'}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#1e293b', border: '1px solid #334155',
                borderRadius: '10px', color: 'white',
                padding: '14px 16px', fontSize: '15px',
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#334155'}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              color: '#f87171', fontSize: '14px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '10px', padding: '12px 16px', marginBottom: '20px',
            }}>
              <AlertCircle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
              {error}
            </div>
          )}

          {/* Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '15px',
              background: loading ? '#4c1d95' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              border: 'none', borderRadius: '10px',
              color: 'white', fontSize: '16px', fontWeight: '700',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.8 : 1,
              transition: 'opacity 0.2s',
              letterSpacing: '0.2px',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>

        <div style={{ textAlign: 'center', color: '#334155', fontSize: '13px', marginTop: '24px' }}>
          Need access? Contact your Fluid Productions rep.
        </div>
      </div>
    </div>
  )
}
