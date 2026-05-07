import { useState, useEffect, useRef } from 'react'
import { MessageSquare, Briefcase, DollarSign, Users, Send, RefreshCw, Phone, FileText, Star } from 'lucide-react'

function authH(token) {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
}

function StatCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="rounded-xl p-5 flex items-start gap-4"
      style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: color + '22' }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
        {sub && <div className="text-xs mt-0.5" style={{ color: '#475569' }}>{sub}</div>}
      </div>
    </div>
  )
}

function BobChat({ apiUrl, auth }) {
  const [messages, setMessages] = useState([
    { role: 'ai', text: `Hey ${auth.contractor.name?.split(' ')[0] || 'there'}! What do you need today? I can look up leads, send invoices, request reviews, or check your pipeline.` }
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId]           = useState('dash-' + Math.random().toString(36).slice(2, 8))
  const bottomRef             = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async (text) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: msg }])
    setLoading(true)
    try {
      const res  = await fetch(`${apiUrl}/api/desk/chat`, {
        method:  'POST',
        headers: authH(auth.token),
        body:    JSON.stringify({ message: msg, sessionId, mode: 'sales' }),
      })
      const data = await res.json()
      setMessages(m => [...m, { role: 'ai', text: data.reply || data.error || 'No response.' }])
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Could not reach server.' }])
    } finally {
      setLoading(false)
    }
  }

  const chips = [
    "What's in my pipeline?",
    "How much did I make this week?",
    "Any new leads today?",
    "Send a review request",
  ]

  return (
    <div className="rounded-xl flex flex-col" style={{ background: '#0f172a', border: '1px solid #1e293b', height: 460 }}>
      <div className="px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: '1px solid #1e293b' }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>🤖</div>
        <div>
          <div className="text-sm font-semibold text-white">Bob — AI Field Assistant</div>
          <div className="text-xs text-gray-600">Ask anything about your business</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
              style={{ background: m.role === 'ai' ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : '#1e293b', border: '1px solid #334155' }}>
              {m.role === 'ai' ? '🤖' : '👤'}
            </div>
            <div className="max-w-xs lg:max-w-sm rounded-xl px-3.5 py-2.5 text-sm leading-relaxed"
              style={{
                background: m.role === 'ai' ? '#1e293b' : 'rgba(124,58,237,0.15)',
                color: '#e2e8f0',
                border: '1px solid ' + (m.role === 'ai' ? '#334155' : 'rgba(124,58,237,0.3)')
              }}
              dangerouslySetInnerHTML={{ __html: escHtml(m.text) }}
            />
          </div>
        ))}
        {loading && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>🤖</div>
            <div className="rounded-xl px-4 py-3 flex gap-1 items-center"
              style={{ background: '#1e293b', border: '1px solid #334155' }}>
              {[0,1,2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full"
                  style={{ background: '#475569', animation: `bounce 1.2s ${i*0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto">
        {chips.map(c => (
          <button key={c} onClick={() => send(c)}
            className="text-xs px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 transition-colors"
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#64748b' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#334155' }}>
            {c}
          </button>
        ))}
      </div>

      <div className="p-3" style={{ borderTop: '1px solid #1e293b' }}>
        <div className="flex gap-2 items-center rounded-lg px-3 py-2.5"
          style={{ background: '#1e293b', border: '1px solid #334155' }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Ask Bob anything..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none" />
          <button onClick={() => send()} disabled={!input.trim() || loading}
            className="w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-40 flex-shrink-0"
            style={{ background: '#7c3aed' }}>
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard({ apiUrl, auth }) {
  const [convos, setConvos]   = useState([])
  const [loading, setLoading] = useState(true)
  const token = auth.token
  const cid   = auth.contractor.id

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/conversations/${cid}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      })
      if (res.ok) {
        const data = await res.json()
        setConvos(Array.isArray(data) ? data.slice(0, 5) : [])
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [cid])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  return (
    <div className="p-6 space-y-6 max-w-6xl">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Good {greeting}, {auth.contractor.name?.split(' ')[0] || 'there'} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            {auth.contractor.company_name || 'Your AI agent is live and working.'}
          </p>
        </div>
        <button onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
          style={{ background: '#0f172a', border: '1px solid #1e293b', color: '#64748b' }}
          onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users}         label="Total Leads"       value={convos.length || '0'} color="#7c3aed" sub="captured by Bob" />
        <StatCard icon={MessageSquare} label="Conversations"     value={convos.length || '0'} color="#3b82f6" sub="AI-handled"      />
        <StatCard icon={Briefcase}     label="Active Jobs"       value="—"                    color="#10b981" sub="in progress"     />
        <StatCard icon={DollarSign}    label="Revenue (month)"   value="$—"                   color="#f59e0b" sub="from paid jobs"  />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BobChat apiUrl={apiUrl} auth={auth} />

        <div className="space-y-4">
          {/* Quick actions */}
          <div className="rounded-xl p-5" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
            <div className="text-sm font-semibold text-white mb-3">Quick Actions</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Phone,    label: 'Call a Lead',    color: '#7c3aed' },
                { icon: FileText, label: 'Send Invoice',   color: '#3b82f6' },
                { icon: Star,     label: 'Request Review', color: '#f59e0b' },
                { icon: Send,     label: 'Follow Up',      color: '#10b981' },
              ].map(a => (
                <button key={a.label}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium text-left transition-colors"
                  style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.color = '#e2e8f0' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.color = '#94a3b8' }}>
                  <a.icon className="w-4 h-4" style={{ color: a.color }} />
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recent conversations */}
          <div className="rounded-xl p-5" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-white">Recent Leads</div>
              <a href="/conversations" className="text-xs hover:underline" style={{ color: '#7c3aed' }}>View all →</a>
            </div>
            {loading ? (
              <div className="text-sm" style={{ color: '#334155' }}>Loading...</div>
            ) : convos.length === 0 ? (
              <div className="text-center py-6">
                <MessageSquare className="w-8 h-8 mx-auto mb-2" style={{ color: '#1e293b' }} />
                <div className="text-sm" style={{ color: '#475569' }}>No conversations yet</div>
                <div className="text-xs mt-1" style={{ color: '#334155' }}>Bob handles them when they come in</div>
              </div>
            ) : (
              <div className="space-y-2">
                {convos.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg"
                    style={{ background: '#1e293b' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                      style={{ background: '#334155', color: '#94a3b8' }}>
                      {(c.lead_name || c.lead_phone || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {c.lead_name || c.lead_phone || 'Unknown'}
                      </div>
                      <div className="text-xs truncate" style={{ color: '#475569' }}>
                        {c.channel || 'sms'} · {c.status || 'open'}
                      </div>
                    </div>
                    <div className="text-xs flex-shrink-0" style={{ color: '#334155' }}>
                      {new Date(c.updated_at || c.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
