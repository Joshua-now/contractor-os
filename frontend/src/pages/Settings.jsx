import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Save, LogOut } from 'lucide-react'

export default function Settings({ contractorId, apiUrl }) {
  const [contractor, setContractor] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${apiUrl}/api/contractors/${contractorId}`)
      .then(r => r.json())
      .then(data => { setContractor(data); setForm(data) })
      .catch(console.error)
  }, [contractorId, apiUrl])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`${apiUrl}/api/contractors/${contractorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('contractorId')
    window.location.reload()
  }

  if (!contractor) return <div className="text-gray-400">Loading settings...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SettingsIcon className="w-6 h-6" />
            Settings
          </h1>
          <p className="text-gray-400 mt-1">Configure your AI agent</p>
        </div>
        <button onClick={handleLogout} className="btn-secondary flex items-center gap-2 text-red-400 hover:text-red-300">
          <LogOut className="w-4 h-4" />
          Switch Account
        </button>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg border-b border-gray-800 pb-3">Business Info</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Business Name</label>
            <input className="input" value={form.business_name || ''} onChange={e => setForm({...form, business_name: e.target.value})} />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Trade Type</label>
            <select className="input" value={form.trade_type || ''} onChange={e => setForm({...form, trade_type: e.target.value})}>
              <option value="hvac">HVAC</option>
              <option value="roofing">Roofing</option>
              <option value="plumbing">Plumbing</option>
              <option value="general">General Contractor</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Your Phone (for alerts)</label>
            <input className="input" value={form.phone_number || ''} onChange={e => setForm({...form, phone_number: e.target.value})} placeholder="+1..." />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">AI Phone (Twilio)</label>
            <input className="input" value={form.twilio_phone || ''} onChange={e => setForm({...form, twilio_phone: e.target.value})} placeholder="+1..." />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg border-b border-gray-800 pb-3">Integrations</h2>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-400 block mb-1">GoHighLevel API Key</label>
            <input className="input" type="password" value={form.ghl_api_key || ''} onChange={e => setForm({...form, ghl_api_key: e.target.value})} placeholder="GHL API key..." />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">GHL Location ID</label>
            <input className="input" value={form.ghl_location_id || ''} onChange={e => setForm({...form, ghl_location_id: e.target.value})} />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Calendly URL</label>
            <input className="input" value={form.calendly_url || ''} onChange={e => setForm({...form, calendly_url: e.target.value})} placeholder="https://calendly.com/..." />
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
        <Save className="w-4 h-4" />
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
