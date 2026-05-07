import { useState } from 'react'
import { Zap, Mail, Lock, AlertCircle } from 'lucide-react'

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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#030712' }}>
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Contractor OS</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to your AI workspace</p>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit}
          className="rounded-2xl p-6 space-y-4"
          style={{ background: '#0f172a', border: '1px solid #1e293b' }}>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-purple-500"
                style={{ background: '#1e293b', border: '1px solid #334155' }}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                onKeyDown={e => e.key === 'Enter' && handleSubmit(e)}
                className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm text-white placeholder-gray-600 outline-none focus:ring-1 focus:ring-purple-500"
                style={{ background: '#1e293b', border: '1px solid #334155' }}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm p-3 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.1)' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm transition-opacity disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-gray-600 text-xs mt-6">
          Need access? Contact your Fluid Productions rep.
        </p>
      </div>
    </div>
  )
}
