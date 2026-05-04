import { useState, useEffect, useRef } from 'react'

const API = ''  // same origin — frontend proxied through backend or direct

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtUptime(s) {
    if (!s) return '—'
    if (s < 60) return s + 's'
    if (s < 3600) return Math.floor(s / 60) + 'm'
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
}
function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
}
function now() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Status Card ───────────────────────────────────────────────────────────────
function StatusCard({ name, status, detail, lastChecked }) {
    const color = status === 'ok' ? '#3fb950' : status === 'err' ? '#f85149' : '#d29922'
    const label = status === 'ok' ? 'Online' : status === 'err' ? 'Down' : '...'
    return (
          <div style={{
                  background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
                  padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
                  transition: 'border-color .2s', cursor: 'default'
          }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#58a6ff'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#30363d'}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>span>
                            <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                            background: color + '22', color, textTransform: 'uppercase', letterSpacing: .5
                }}>{label}</span>span>
                  </div>div>
                  <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}
                            dangerouslySetInnerHTML={{ __html: detail || 'Loading...' }} />
            {lastChecked && (
                          <div style={{ fontSize: 10, color: '#484f58' }}>Updated {lastChecked}</div>div>
                        )}
          </div>div>
        )
}

// ── Doc Panel ─────────────────────────────────────────────────────────────────
function DocPanel({ apiUrl, onDocMention }) {
    const [docs, setDocs] = useState([])
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const fileRef = useRef()

  async function uploadFile(file) {
        if (!file) return
        setUploading(true)
        try {
                const fd = new FormData()
                fd.append('file', file)
                const res = await fetch((apiUrl || '') + '/api/desk/docs', { method: 'POST', body: fd })
                const data = await res.json()
                if (data.ok) setDocs(prev => [data.doc, ...prev])
                else alert('Upload failed: ' + (data.error || 'Unknown error'))
        } catch (e) {
                // fallback: store locally with name only
          setDocs(prev => [{ id: Date.now(), name: file.name, size: file.size, ts: new Date().toISOString() }, ...prev])
        }
        setUploading(false)
  }

  function handleDrop(e) {
        e.preventDefault(); setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) uploadFile(f)
  }

  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8, color: '#8b949e' }}>
                          📄 Documents
                </div>div>

          {/* Drop zone */}
                <div
                          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={handleDrop}
                          onClick={() => fileRef.current?.click()}
                          style={{
                                      border: `2px dashed ${dragOver ? '#58a6ff' : '#30363d'}`,
                                      borderRadius: 10, padding: '20px 12px', textAlign: 'center',
                                      cursor: 'pointer', transition: 'all .2s', background: dragOver ? '#58a6ff11' : 'transparent',
                                      color: '#8b949e', fontSize: 13
                          }}>
                  {uploading ? '⏳ Uploading...' : '⬆ Drop file or click to upload'}
                          <input ref={fileRef} type="file" style={{ display: 'none' }}
                                      onChange={e => uploadFile(e.target.files[0])} />
                </div>div>

          {/* Doc list */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {docs.length === 0 && (
                    <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
                                  No documents yet.<br />Upload PDFs, invoices, contracts, notes.
                    </div>div>
                  )}
                  {docs.map(doc => (
                    <div key={doc.id} style={{
                                  background: '#21262d', border: '1px solid #30363d', borderRadius: 8,
                                  padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10
                    }}>
                                  <span style={{ fontSize: 18 }}>
                                    {doc.name?.endsWith('.pdf') ? '📕' : doc.name?.endsWith('.xlsx') || doc.name?.endsWith('.csv') ? '📊' : '📄'}
                                  </span>span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                                  <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {doc.name}
                                                  </div>div>
                                                  <div style={{ fontSize: 10, color: '#8b949e' }}>
                                                    {doc.size ? (doc.size / 1024).toFixed(1) + ' KB' : ''}{doc.ts ? ' · ' + new Date(doc.ts).toLocaleDateString() : ''}
                                                  </div>div>
                                  </div>div>
                                  <button
                                                  onClick={() => onDocMention && onDocMention(doc.name)}
                                                  style={{
                                                                    background: 'transparent', border: '1px solid #30363d', color: '#8b949e',
                                                                    borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer'
                                                  }}
                                                  title="Ask AI about this doc">💬</button>button>
                    </div>div>
                  ))}
                </div>div>
        </div>div>
      )
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function ChatPanel({ apiUrl }) {
    const [messages, setMessages] = useState([])
        const [input, setInput] = useState('')
            const [thinking, setThinking] = useState(false)
                const [sessionId] = useState('dash-' + Math.random().toString(36).slice(2, 9))
                    const bottomRef = useRef()
                        const inputRef = useRef()
                          
                            useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, thinking])
                              
                                async function send(text) {
                                      const msg = (text || input).trim()
                                            if (!msg || thinking) return
                                                  setInput('')
                                                        setMessages(prev => [...prev, { role: 'user', text: msg, time: now() }])
                                                              setThinking(true)
                                                                    try {
                                                                            const res = await fetch((apiUrl || '') + '/api/desk/chat', {
                                                                                      method: 'POST',
                                                                                      headers: { 'Content-Type': 'application/json' },
                                                                                      body: JSON.stringify({ message: msg, sessionId })
                                                                            })
                                                                                    const data = await res.json()
                                                                                            setMessages(prev => [...prev, { role: 'ai', text: data.reply || data.error || '?', time: now() }])
                                                                    } catch {
                                                                            setMessages(prev => [...prev, { role: 'ai', text: 'Could not reach backend.', time: now() }])
                                                                    }
                                      setThinking(false)
                                            inputRef.current?.focus()
                                }
  
    function handleKey(e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    }
  
    const chips = [
          'What sold this week?', 'Pipeline overview', 'Campaign stats', 'Any alerts?', 'Workflow health'
        ]
      
        return (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* messages */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {messages.length === 0 && (
                          <div style={{ textAlign: 'center', padding: '32px 16px', color: '#8b949e' }}>
                                      <div style={{ fontSize: 22, marginBottom: 8 }}>👋 Hey, what do you need?</div>div>
                                      <div style={{ fontSize: 13, marginBottom: 20 }}>Ask about leads, campaigns, workflows, appointments — anything.</div>div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                                        {chips.map(c => (
                                            <button key={c} onClick={() => send(c)}
                                                                style={{
                                                                                      background: '#21262d', border: '1px solid #30363d', color: '#8b949e',
                                                                                      padding: '7px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer'
                                                                  }}>{c}</button>button>
                                          ))}
                                      </div>div>
                          </div>div>
                            )}
                      {messages.map((m, i) => (
                          <div key={i} style={{
                                        display: 'flex', gap: 10, maxWidth: '88%',
                                        marginLeft: m.role === 'user' ? 'auto' : 0,
                                        flexDirection: m.role === 'user' ? 'row-reverse' : 'row'
                          }}>
                                      <div style={{
                                          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                                          background: m.role === 'ai' ? 'linear-gradient(135deg,#f78166,#58a6ff)' : '#21262d',
                                          border: m.role === 'user' ? '1px solid #30363d' : 'none',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13
                          }}>
                                        {m.role === 'ai' ? '🤖' : '👤'}
                                      </div>div>
                                      <div>
                                                    <div style={{
                                            background: m.role === 'user' ? 'rgba(88,166,255,.12)' : '#21262d',
                                            border: `1px solid ${m.role === 'user' ? 'rgba(88,166,255,.3)' : '#30363d'}`,
                                            borderRadius: 12, padding: '10px 14px', fontSize: 13, lineHeight: 1.6,
                                            color: '#e6edf3'
                          }} dangerouslySetInnerHTML={{ __html: escHtml(m.text) }} />
                                                    <div style={{ fontSize: 10, color: '#484f58', marginTop: 3, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                                                      {m.time}
                                                    </div>div>
                                      </div>div>
                          </div>div>
                        ))}
                      {thinking && (
                          <div style={{ display: 'flex', gap: 10, maxWidth: '88%' }}>
                                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#f78166,#58a6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>🤖</div>div>
                                      <div style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 4 }}>
                                        {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b949e', animation: `bounce 1.2s infinite ${i * 0.2}s` }} />)}
                                      </div>div>
                          </div>div>
                            )}
                            <div ref={bottomRef} />
                    </div>div>
                {/* input */}
                    <div style={{ borderTop: '1px solid #30363d', paddingTop: 12 }}>
                            <div style={{
                          display: 'flex', gap: 8, background: '#21262d', border: '1px solid #30363d',
                          borderRadius: 12, padding: '8px 12px'
              }}>
                                      <textarea
                                                    ref={inputRef}
                                                    value={input}
                                                    onChange={e => setInput(e.target.value)}
                                                    onKeyDown={handleKey}
                                                    placeholder="Ask your AI office manager..."
                                                    rows={1}
                                                    style={{
                                                                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                                                                    color: '#e6edf3', fontSize: 13, resize: 'none', fontFamily: 'inherit',
                                                                    lineHeight: 1.5, maxHeight: 100
                                                    }}
                                                  />
                                      <button onClick={() => send()}
                                                    disabled={thinking || !input.trim()}
                                                    style={{
                                                                    background: '#58a6ff', border: 'none', color: '#fff', width: 32, height: 32,
                                                                    borderRadius: 8, cursor: thinking || !input.trim() ? 'default' : 'pointer',
                                                                    opacity: thinking || !input.trim() ? .4 : 1, fontSize: 15, flexShrink: 0, alignSelf: 'flex-end'
                                                    }}>➤</button>button>
                            </div>div>
                            <div style={{ fontSize: 10, color: '#484f58', marginTop: 5 }}>Enter to send · Shift+Enter for new line</div>div>
                    </div>div>
              </div>div>
            )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ apiUrl }) {
    const [status, setStatus] = useState({})
        const [lastChecked, setLastChecked] = useState(null)
            const [activeTab, setActiveTab] = useState('chat') // mobile: chat | monitor | docs
    const [docMention, setDocMention] = useState(null)
      
        async function loadStatus() {
              try {
                      const res = await fetch((apiUrl || '') + '/api/desk/status')
                              const d = await res.json()
                                      setStatus(d)
                                              setLastChecked(now())
              } catch { setStatus({ _error: true }) }
        }
  
    useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 60000); return () => clearInterval(t) }, [])
      
        // system monitor cards config
    const cards = [
      {
              name: 'Backend',
              status: status.backend?.ok ? 'ok' : status._error ? 'err' : 'loading',
              detail: status.backend?.ok ? `Uptime: <strong>${fmtUptime(status.backend.uptime)}</strong>` : status.backend?.error || (status._error ? 'Unreachable' : 'Checking...')
      },
      {
              name: 'Switchboard AI',
              status: status.switchboard?.ok ? 'ok' : status.switchboard?.error ? 'err' : 'loading',
              detail: status.switchboard?.ok ? (status.switchboard.data?.status || 'healthy') : (status.switchboard?.error || 'Checking...')
      },
      {
              name: 'n8n Workflows',
              status: status.n8n?.ok ? 'ok' : status.n8n?.error ? 'err' : 'loading',
              detail: status.n8n?.ok ? `<strong>${status.n8n.active}</strong> active / ${status.n8n.total} total` : (status.n8n?.error || 'Checking...')
      },
      {
              name: 'Instantly',
              status: status.instantly?.ok ? 'ok' : status.instantly?.error ? 'err' : 'loading',
              detail: status.instantly?.ok ? `<strong>${status.instantly.active}</strong> active / ${status.instantly.total} campaigns` : (status.instantly?.error || 'Checking...')
      },
      {
              name: 'Slack Alerts',
              status: status.slack?.ok ? 'ok' : status.slack?.error ? 'err' : 'loading',
              detail: status.slack?.ok ? `<strong>${status.slack.recent_count}</strong> recent messages` : (status.slack?.error || 'Checking...')
      }
        ]
      
        const allOk = status.backend?.ok && status.switchboard?.ok && status.n8n?.ok
            const statusColor = allOk ? '#3fb950' : (status._error ? '#f85149' : '#d29922')
                const statusText = allOk ? 'All systems running' : (status._error ? 'Backend unreachable' : 'Some systems need attention')
                  
                    // mobile tab labels
    const tabs = [
      { id: 'chat', label: '💬 Chat' },
      { id: 'monitor', label: '📊 Monitor' },
      { id: 'docs', label: '📄 Docs' }
        ]
      
        return (
              <div style={{ background: '#0d1117', color: '#e6edf3', minHeight: '100vh', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', display: 'flex', flexDirection: 'column' }}>
                    <style>{`
                            @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
                                    @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
                                            * { box-sizing: border-box; margin: 0; padding: 0; }
                                                    ::-webkit-scrollbar { width: 5px; }
                                                            ::-webkit-scrollbar-track { background: transparent; }
                                                                    ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
                                                                            @media (max-width: 768px) { .desktop-only { display: none !important; } .mobile-tabs { display: flex !important; } }
                                                                                    @media (min-width: 769px) { .mobile-tabs { display: none !important; } .desktop-layout { display: grid !important; } }
                                                                                          `}</style>style>
              
                {/* ── Header ── */}
                    <header style={{ background: '#161b22', borderBottom: '1px solid #30363d', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                            <div style={{ fontSize: 17, fontWeight: 700, color: '#f78166' }}>⚡ Contractor OS</div>div>
                            <div style={{ fontSize: 12, color: '#8b949e' }}>Field Office</div>div>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, animation: 'pulse 2s infinite' }} />
                                      <span style={{ fontSize: 12, color: '#8b949e' }}>{statusText}</span>span>
                                      <button onClick={loadStatus} style={{ background: '#21262d', border: '1px solid #30363d', color: '#8b949e', padding: '5px 11px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                                                  ↻ Refresh
                                      </button>button>
                            </div>div>
                    </header>header>
              
                {/* ── Mobile Tabs ── */}
                    <div className="mobile-tabs" style={{ display: 'none', background: '#161b22', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                      {tabs.map(t => (
                          <button key={t.id} onClick={() => setActiveTab(t.id)}
                                        style={{
                                                        flex: 1, padding: '10px 0', fontSize: 13, background: 'transparent',
                                                        border: 'none', borderBottom: `2px solid ${activeTab === t.id ? '#58a6ff' : 'transparent'}`,
                                                        color: activeTab === t.id ? '#58a6ff' : '#8b949e', cursor: 'pointer'
                                        }}>{t.label}</button>button>
                        ))}
                    </div>div>
              
                {/* ── Desktop: 3-column grid ── */}
                    <div className="desktop-layout" style={{ display: 'none', gridTemplateColumns: '260px 1fr 280px', flex: 1, overflow: 'hidden' }}>
                    
                      {/* Left: System Monitor */}
                            <aside style={{ background: '#161b22', borderRight: '1px solid #30363d', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8, color: '#8b949e' }}>📡 System Monitor</div>div>
                              {cards.map(c => <StatusCard key={c.name} {...c} lastChecked={lastChecked} />)}
                            
                              {/* Quick actions */}
                                      <div style={{ marginTop: 8 }}>
                                                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8, color: '#8b949e', marginBottom: 10 }}>⚡ Quick Ask</div>div>
                                        {[
                              ['📊', 'Full system status'],
                              ['📋', 'Pipeline overview'],
                              ['📅', 'Upcoming appointments'],
                              ['📧', 'Email campaign stats'],
                              ['🔔', 'Recent alerts'],
                              ['⚙️', 'Workflow health'],
                            ].map(([icon, label]) => (
                                            <button key={label}
                                                              onClick={() => document.querySelector('textarea')?.dispatchEvent(Object.assign(new Event('_quick'), { text: label }))}
                                                              style={{
                                                                                  width: '100%', background: '#21262d', border: '1px solid #30363d', color: '#e6edf3',
                                                                                  padding: '9px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                                                                                  textAlign: 'left', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center'
                                                              }}>
                                                            <span>{icon}</span>span>{label}
                                            </button>button>
                                          ))}
                                      </div>div>
                            </aside>aside>
                    
                      {/* Center: Chat */}
                            <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 20px', borderRight: '1px solid #30363d' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #30363d' }}>
                                                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#f78166,#58a6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🤖</div>div>
                                                  <div>
                                                                <div style={{ fontWeight: 600, fontSize: 14 }}>AI Office Manager</div>div>
                                                                <div style={{ fontSize: 11, color: '#8b949e' }}>Connected to all your systems</div>div>
                                                  </div>div>
                                                  <button onClick={() => window.location.reload()} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #30363d', color: '#8b949e', padding: '5px 11px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                                                                + New Chat
                                                  </button>button>
                                      </div>div>
                                      <div style={{ flex: 1, overflow: 'hidden' }}>
                                                  <ChatPanel apiUrl={apiUrl} docMention={docMention} />
                                      </div>div>
                            </main>main>
                    
                      {/* Right: Docs */}
                            <aside style={{ background: '#161b22', overflowY: 'auto', padding: 16 }}>
                                      <DocPanel apiUrl={apiUrl} onDocMention={name => {
                            const ta = document.querySelector('textarea')
                                          if (ta) { ta.value = `Tell me about the document: ${name}`; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus() }
              }} />
                            </aside>aside>
                    </div>div>
              
                {/* ── Mobile: single panel based on tab ── */}
                    <div style={{ flex: 1, overflow: 'hidden', padding: 14 }} className="desktop-only">
                      {activeTab === 'chat' && <div style={{ height: '100%' }}><ChatPanel apiUrl={apiUrl} /></div>div>}
                      {activeTab === 'monitor' && (
                          <div style={{ overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8, color: '#8b949e' }}>System Monitor</div>div>
                            {cards.map(c => <StatusCard key={c.name} {...c} lastChecked={lastChecked} />)}
                          </div>div>
                            )}
                      {activeTab === 'docs' && <div style={{ height: '100%' }}><DocPanel apiUrl={apiUrl} onDocMention={name => { setActiveTab('chat') }} /></div>div>}
                    </div>div>
              </div>div>
            )
}</button>
