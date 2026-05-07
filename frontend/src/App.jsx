import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login          from './pages/Login'
import Dashboard      from './pages/Dashboard'
import AdminDashboard from './pages/AdminDashboard'
import Conversations  from './pages/Conversations'
import Memory         from './pages/Memory'
import Settings       from './pages/Settings'
import Sidebar        from './components/Sidebar'

const API_URL = import.meta.env.VITE_API_URL || ''

function App() {
  const [auth, setAuth] = useState(() => {
    try {
      const token      = localStorage.getItem('cos_token')
      const contractor = localStorage.getItem('cos_contractor')
      if (token && contractor) return { token, contractor: JSON.parse(contractor) }
    } catch {}
    return null
  })

  // Admin impersonation — temporarily view the app as a contractor
  const [impersonating, setImpersonating] = useState(null)

  const login = (token, contractor) => {
    localStorage.setItem('cos_token', token)
    localStorage.setItem('cos_contractor', JSON.stringify(contractor))
    setAuth({ token, contractor })
    setImpersonating(null)
  }

  const logout = () => {
    // If impersonating, just exit back to admin
    if (impersonating) {
      setImpersonating(null)
      return
    }
    localStorage.removeItem('cos_token')
    localStorage.removeItem('cos_contractor')
    setAuth(null)
  }

  // Called from AdminDashboard "Log In As" — gives admin a contractor-scoped token
  const handleImpersonate = async (contractorToken, contractorId, contractorName) => {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': 'Bearer ' + contractorToken }
      })
      if (res.ok) {
        const { contractor } = await res.json()
        setImpersonating({ adminAuth: auth, label: contractorName })
        setAuth({ token: contractorToken, contractor })
      }
    } catch {}
  }

  if (!auth) {
    return <Login apiUrl={API_URL} onLogin={login} />
  }

  const isAdmin    = auth.contractor?.role === 'admin' && !impersonating
  const effectiveAuth = auth

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden" style={{ background: '#030712', color: '#f1f5f9' }}>

        {/* Impersonation banner */}
        {impersonating && (
          <div className="fixed top-0 left-0 right-0 z-50 text-center text-xs py-1.5 font-medium"
            style={{ background: '#7c3aed', color: 'white' }}>
            Viewing as {impersonating.label} —{' '}
            <button onClick={logout} className="underline">Exit back to Admin</button>
          </div>
        )}

        <Sidebar contractor={auth.contractor} onLogout={logout} impersonating={!!impersonating} />

        <main className={`flex-1 ml-64 overflow-y-auto ${impersonating ? 'pt-8' : ''}`}>
          <Routes>
            {isAdmin ? (
              // ── Admin routes ──────────────────────────────────────────────
              <>
                <Route path="/" element={
                  <AdminDashboard apiUrl={API_URL} auth={effectiveAuth} onImpersonate={handleImpersonate} />
                } />
                <Route path="/contractors" element={
                  <AdminDashboard apiUrl={API_URL} auth={effectiveAuth} onImpersonate={handleImpersonate} />
                } />
                <Route path="/conversations" element={<Conversations apiUrl={API_URL} auth={effectiveAuth} />} />
                <Route path="/settings"      element={<Settings      apiUrl={API_URL} auth={effectiveAuth} onLogout={logout} />} />
              </>
            ) : (
              // ── Contractor routes ─────────────────────────────────────────
              <>
                <Route path="/"              element={<Dashboard     apiUrl={API_URL} auth={effectiveAuth} />} />
                <Route path="/conversations" element={<Conversations apiUrl={API_URL} auth={effectiveAuth} />} />
                <Route path="/memory"        element={<Memory        apiUrl={API_URL} auth={effectiveAuth} />} />
                <Route path="/settings"      element={<Settings      apiUrl={API_URL} auth={effectiveAuth} onLogout={logout} />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
