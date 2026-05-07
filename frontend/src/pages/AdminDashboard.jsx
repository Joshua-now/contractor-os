import { useState, useEffect } from 'react'
import { Users, DollarSign, MessageSquare, Briefcase, RefreshCw, ChevronRight, Circle, CheckCircle, XCircle } from 'lucide-react'

function authH(token) {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
}

const planColors = {
  owner:   '#a78bfa',
  pro:     '#60a5fa',
  starter: '#34d399',
  trial:   '#6b7280',
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-xl p-5 flex items-center gap-4"
      style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center"
        style={{ background: color + '22' }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
      </div>
    </div>
  )
}

export default function AdminDashboard({ apiUrl, auth, onImpersonate }) {
  const [stats,       setStats]       = useState(null)
  const [contractors, setContractors] = useState([])
  const [selected,    setSelected]    = useState(null)
  const [detail,      setDetail]      = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [impersonating, setImpersonating] = useState(null)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [statsRes, contractorsRes] = await Promise.all([
        fetch(`${apiUrl}/api/admin/stats`,       { headers: authH(auth.token) }),
        fetch(`${apiUrl}/api/admin/contractors`, { headers: authH(auth.token) }),
      ])
      if (statsRes.ok)       setStats(await statsRes.json())
      if (contractorsRes.ok) setContractors(await contractorsRes.json())
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const fetchDetail = async (id) => {
    setSelected(id)
    setDetail(null)
    try {
      const res = await fetch(`${apiUrl}/api/admin/contractors/${id}`, { headers: authH(auth.token) })
      if (res.ok) setDetail(await res.json())
    } catch {}
  }

  const impersonate = async (id, name) => {
    setImpersonating(id)
    try {
      const res = await fetch(`${apiUrl}/api/admin/contractors/${id}/impersonate`, {
        method: 'POST', headers: authH(auth.token)
      })
      if (res.ok) {
        const data = await res.json()
        onImpersonate(data.token, id, name)
      }
    } catch {}
    setImpersonating(null)
  }

  useEffect(() => { fetchAll() }, [])

  return (
    <div className="p-6 space-y-6 max-w-7xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Super Admin</h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>Platform-wide view — all contractor accounts</p>
        </div>
        <button onClick={fetchAll}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          style={{ background: '#0f172a', border: '1px solid #1e293b', color: '#64748b' }}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Platform stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Users}         label="Active Contractors" value={stats.active_contractors} color="#7c3aed" />
          <StatCard icon={MessageSquare} label="Convos (7 days)"    value={stats.conversations_7d}   color="#3b82f6" />
          <StatCard icon={Briefcase}     label="Total Jobs"         value={stats.total_jobs}          color="#10b981" />
          <StatCard icon={DollarSign}    label="Revenue Processed"  value={'$' + Number(stats.total_revenue_paid).toLocaleString()} color="#f59e0b" />
        </div>
      )}

      {/* Contractor list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* List */}
        <div className="rounded-xl overflow-hidden" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
          <div className="px-5 py-4 text-sm font-semibold text-white" style={{ borderBottom: '1px solid #1e293b' }}>
            Contractor Accounts ({contractors.length})
          </div>
          <div className="divide-y" style={{ borderColor: '#1e293b' }}>
            {loading ? (
              <div className="p-6 text-sm" style={{ color: '#334155' }}>Loading...</div>
            ) : contractors.length === 0 ? (
              <div className="p-6 text-sm text-center" style={{ color: '#475569' }}>No contractors yet</div>
            ) : contractors.map(c => (
              <div key={c.id}
                onClick={() => fetchDetail(c.id)}
                className="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
                style={{ background: selected === c.id ? '#1e293b' : 'transparent' }}
                onMouseEnter={e => { if (selected !== c.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={e => { if (selected !== c.id) e.currentTarget.style.background = 'transparent' }}>

                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>
                  {(c.company_name || c.name || '?')[0].toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{c.company_name || c.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ background: planColors[c.plan] + '22', color: planColors[c.plan] || '#6b7280' }}>
                      {c.plan}
                    </span>
                  </div>
                  <div className="text-xs truncate" style={{ color: '#475569' }}>{c.email}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#334155' }}>
                    {c.lead_count} leads · {c.job_count} jobs · {c.conversation_count} convos
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.active
                    ? <CheckCircle className="w-4 h-4" style={{ color: '#22c55e' }} />
                    : <XCircle    className="w-4 h-4" style={{ color: '#ef4444' }} />}
                  <ChevronRight className="w-4 h-4" style={{ color: '#334155' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="rounded-xl" style={{ background: '#0f172a', border: '1px solid #1e293b', minHeight: 300 }}>
          {!selected ? (
            <div className="flex items-center justify-center h-full p-12 text-center">
              <div>
                <Users className="w-10 h-10 mx-auto mb-3" style={{ color: '#1e293b' }} />
                <div className="text-sm" style={{ color: '#334155' }}>Select a contractor to view details</div>
              </div>
            </div>
          ) : !detail ? (
            <div className="p-6 text-sm" style={{ color: '#334155' }}>Loading...</div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Contractor header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold text-white">{detail.contractor.company_name || detail.contractor.name}</div>
                  <div className="text-sm" style={{ color: '#64748b' }}>{detail.contractor.email}</div>
                  <div className="text-xs mt-1" style={{ color: '#475569' }}>
                    {detail.contractor.phone || 'No phone'} · {detail.contractor.service_area || 'No service area set'}
                  </div>
                </div>
                <button
                  onClick={() => impersonate(detail.contractor.id, detail.contractor.company_name || detail.contractor.name)}
                  disabled={impersonating === detail.contractor.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}>
                  {impersonating === detail.contractor.id ? 'Loading...' : '→ Log In As'}
                </button>
              </div>

              {/* Mini stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Leads',    value: detail.leads.length         },
                  { label: 'Jobs',     value: detail.jobs.length          },
                  { label: 'Memory',   value: detail.memory.length + ' keys' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg p-3 text-center"
                    style={{ background: '#1e293b' }}>
                    <div className="text-lg font-bold text-white">{s.value}</div>
                    <div className="text-xs" style={{ color: '#475569' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Recent conversations */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#475569' }}>
                  Recent Conversations
                </div>
                {detail.conversations.length === 0 ? (
                  <div className="text-sm" style={{ color: '#334155' }}>None yet</div>
                ) : (
                  <div className="space-y-1.5">
                    {detail.conversations.slice(0, 4).map((c, i) => (
                      <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg text-sm"
                        style={{ background: '#1e293b' }}>
                        <Circle className="w-2 h-2 flex-shrink-0" style={{ color: c.status === 'open' ? '#22c55e' : '#475569', fill: c.status === 'open' ? '#22c55e' : '#475569' }} />
                        <span className="text-white flex-1 truncate">{c.lead_name || c.lead_phone}</span>
                        <span style={{ color: '#475569' }}>{c.channel}</span>
                        <span style={{ color: '#334155' }}>{new Date(c.updated_at || c.created_at).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Memory keys */}
              {detail.memory.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#475569' }}>
                    AI Memory
                  </div>
                  <div className="space-y-1">
                    {detail.memory.slice(0, 5).map((m, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs p-2 rounded"
                        style={{ background: '#1e293b' }}>
                        <span style={{ color: '#7c3aed', fontWeight: 600, flexShrink: 0 }}>{m.key}</span>
                        <span className="truncate" style={{ color: '#64748b' }}>{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
