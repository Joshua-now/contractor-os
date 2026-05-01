import { useState, useEffect } from 'react'
import { Users, Phone, Calendar, TrendingUp, Activity } from 'lucide-react'

export default function Dashboard({ contractorId, apiUrl }) {
  const [leads, setLeads] = useState([])
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [leadsRes, convosRes] = await Promise.all([
          fetch(`${apiUrl}/api/conversations/${contractorId}/leads`),
          fetch(`${apiUrl}/api/conversations/${contractorId}`)
        ])
        setLeads(await leadsRes.json())
        setConversations(await convosRes.json())
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [contractorId, apiUrl])

  const newLeads = leads.filter(l => l.status === 'new').length
  const bookedAppts = leads.filter(l => l.status === 'appointment_set').length
  const qualifiedLeads = leads.filter(l => l.status === 'qualified').length
  const todayConvos = conversations.filter(c => {
    const today = new Date().toDateString()
    return new Date(c.created_at).toDateString() === today
  }).length

  const stats = [
    { label: 'New Leads', value: newLeads, icon: Users, color: 'text-blue-400' },
    { label: 'Appointments Set', value: bookedAppts, icon: Calendar, color: 'text-purple-400' },
    { label: 'Qualified Leads', value: qualifiedLeads, icon: TrendingUp, color: 'text-green-400' },
    { label: "Today's Conversations", value: todayConvos, icon: Activity, color: 'text-orange-400' },
  ]

  const statusBadge = (status) => {
    const classes = {
      new: 'badge-new',
      qualified: 'badge-qualified',
      appointment_set: 'badge-appointment',
      job_complete: 'badge-complete',
    }
    return <span className={classes[status] || 'badge-new'}>{status?.replace('_', ' ')}</span>
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-gray-400">Loading dashboard...</div>
    </div>
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-400 mt-1">Your AI agent activity at a glance</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">{label}</p>
                <p className="text-3xl font-bold mt-1">{value}</p>
              </div>
              <Icon className={`w-8 h-8 ${color}`} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-semibold mb-4">Recent Leads</h2>
          {leads.length === 0 ? (
            <p className="text-gray-500 text-sm">No leads yet. Your AI agent will capture them automatically.</p>
          ) : (
            <div className="space-y-3">
              {leads.slice(0, 6).map(lead => (
                <div key={lead.id} className="flex items-center justify-between py-2 border-b border-gray-800">
                  <div>
                    <p className="font-medium text-sm">{lead.name || lead.phone || 'Unknown'}</p>
                    <p className="text-gray-500 text-xs">{lead.job_type || 'General inquiry'}</p>
                  </div>
                  {statusBadge(lead.status)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold mb-4">Recent Activity</h2>
          {conversations.length === 0 ? (
            <p className="text-gray-500 text-sm">No activity yet. Your AI agent will show conversations here.</p>
          ) : (
            <div className="space-y-3">
              {conversations.slice(0, 6).map(c => (
                <div key={c.id} className="py-2 border-b border-gray-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${c.direction === 'inbound' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                      {c.direction}
                    </span>
                    <span className="text-xs text-gray-500">{c.channel}</span>
                    <span className="text-xs text-gray-600">{new Date(c.created_at).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-sm text-gray-300 truncate">{c.message || c.ai_response}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
