import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Save, LogOut } from 'lucide-react'

export default function Settings({ auth, apiUrl, onLogout }) {
  const contractorId = auth.contractor.id
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token }
  const [contractor, setContractor] = useState(auth.contractor)
  const [form, setForm] = useState(auth.contractor)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${apiUrl}/api/auth/profile`, { headers })
      .then(r => r.json())
      .then(data => { setContractor(data); setForm(data) })
      .catch(console.error)
  }, [apiUrl])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`${apiUrl}/api/auth/profile`, {
        method: 'PUT',
        headers,
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

  const handleLogout = onLogout || (() => { localStorage.clear(); window.location.reload() })

  if (!contractor) return <div className="text-gray-400">Loading settings...</div>

  return (
    <div className="p-6 space-y-6 max-w-2xl">
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

      {/* Bob Toggle — top of page for easy access */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg">Bob AI Assistant</h2>
            <p className="text-sm text-gray-400 mt-1">
              {form.bob_enabled !== false
                ? 'Bob is active — responding to leads and handling your desk.'
                : 'Bob is paused — no AI responses or API calls will be made.'}
            </p>
          </div>
          <button
            onClick={() => setForm({ ...form, bob_enabled: form.bob_enabled === false ? true : false })}
            className="relative inline-flex items-center w-14 h-7 rounded-full transition-colors focus:outline-none flex-shrink-0"
            style={{
              background: form.bob_enabled !== false ? '#7c3aed' : '#1e293b',
              border: '1px solid',
              borderColor: form.bob_enabled !== false ? '#7c3aed' : '#334155',
            }}
          >
            <span
              className="inline-block w-5 h-5 bg-white rounded-full shadow transition-transform"
              style={{ transform: form.bob_enabled !== false ? 'translateX(30px)' : 'translateX(2px)' }}
            />
          </button>
        </div>
        {form.bob_enabled === false && (
          <div className="mt-3 text-xs px-3 py-2 rounded-lg"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
            Bob is OFF — save settings below to apply.
          </div>
        )}
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

      {/* CRM Integration */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-lg border-b border-gray-800 pb-3">CRM Integration</h2>
        <p className="text-sm text-gray-400">All leads always sync to your Fluid Productions account. If you use your own CRM, connect it below and leads will mirror there too.</p>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Your CRM</label>
          <select className="input" value={form.crm_type || 'ghl'} onChange={e => setForm({...form, crm_type: e.target.value})}>
            <option value="ghl">GHL Only (default)</option>
            <option value="servicetitan">ServiceTitan</option>
            <option value="jobber">Jobber</option>
            <option value="housecall">Housecall Pro</option>
            <option value="none">None</option>
          </select>
        </div>

        {form.crm_type && form.crm_type !== 'ghl' && form.crm_type !== 'none' && (
          <>
            <div>
              <label className="text-sm text-gray-400 block mb-1">
                {form.crm_type === 'servicetitan' ? 'API Key (client_id:client_secret)' :
                 form.crm_type === 'jobber'        ? 'OAuth Access Token' :
                                                     'API Key'}
              </label>
              <input className="input" type="password"
                value={form.crm_api_key || ''}
                onChange={e => setForm({...form, crm_api_key: e.target.value})}
                placeholder={form.crm_type === 'servicetitan' ? 'clientId:clientSecret' : 'Paste API key...'} />
            </div>
            {form.crm_type === 'servicetitan' && (
              <div>
                <label className="text-sm text-gray-400 block mb-1">Tenant ID</label>
                <input className="input"
                  value={form.crm_account_id || ''}
                  onChange={e => setForm({...form, crm_account_id: e.target.value})}
                  placeholder="Your ServiceTitan tenant ID" />
              </div>
            )}
          </>
        )}
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
        <Save className="w-4 h-4" />
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
