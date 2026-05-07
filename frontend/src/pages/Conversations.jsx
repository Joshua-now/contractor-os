import { useState, useEffect } from 'react'
import { MessageSquare, Phone, Mail, RefreshCw } from 'lucide-react'

export default function Conversations({ auth, apiUrl }) {
  const contractorId = auth.contractor.id
  const [conversations, setConversations] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/conversations`, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      })
      setConversations(await res.json())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConversations()
    const interval = setInterval(fetchConversations, 30000)
    return () => clearInterval(interval)
  }, [contractorId, apiUrl])

  const channelIcon = (channel) => {
    if (channel === 'voice') return <Phone className="w-4 h-4" />
    if (channel === 'email') return <Mail className="w-4 h-4" />
    return <MessageSquare className="w-4 h-4" />
  }

  if (loading) return <div className="text-gray-400">Loading conversations...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="text-gray-400 mt-1">All AI-handled interactions</p>
        </div>
        <button onClick={fetchConversations} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-2">
          {conversations.length === 0 ? (
            <div className="card text-gray-500 text-sm">No conversations yet.</div>
          ) : conversations.map(c => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`card w-full text-left hover:border-purple-500 transition-colors ${selected?.id === c.id ? 'border-purple-500' : ''}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-purple-400">{channelIcon(c.channel)}</span>
                <span className="text-xs text-gray-500">
                  {c.direction === 'inbound' ? c.from_number : c.to_number}
                </span>
                <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${c.direction === 'inbound' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                  {c.direction}
                </span>
              </div>
              <p className="text-sm text-gray-300 truncate">{c.message || c.ai_response || 'No content'}</p>
              <p className="text-xs text-gray-600 mt-1">{new Date(c.created_at).toLocaleString()}</p>
            </button>
          ))}
        </div>

        <div className="col-span-2">
          {selected ? (
            <div className="card space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-gray-800">
                <span className="text-purple-400">{channelIcon(selected.channel)}</span>
                <span className="font-medium">{selected.from_number || selected.to_number}</span>
                <span className="text-gray-500 text-sm ml-auto">{new Date(selected.created_at).toLocaleString()}</span>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Customer Message</p>
                <div className="bg-gray-800 rounded-lg p-3 text-sm">{selected.message || 'No message'}</div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">AI Response</p>
                <div className="bg-purple-900/30 border border-purple-800 rounded-lg p-3 text-sm">{selected.ai_response || 'No response'}</div>
              </div>
            </div>
          ) : (
            <div className="card flex items-center justify-center h-64 text-gray-500">
              Select a conversation to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
