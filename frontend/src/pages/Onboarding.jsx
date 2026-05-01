import { useState } from 'react'
import { Zap, ChevronRight, ChevronLeft, Check } from 'lucide-react'

const STEPS = [
  { title: 'Business Info', desc: "Tell us about your business" },
  { title: 'Service Area', desc: 'Where do you work?' },
  { title: 'Working Hours', desc: 'When are you available?' },
  { title: 'Integrations', desc: 'Connect your tools' },
  { title: "You're Live!", desc: 'Your AI agent is ready' },
]

export default function Onboarding({ apiUrl, onComplete }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    business_name: '',
    trade_type: 'hvac',
    phone_number: '',
    service_zips: '',
    working_hours: { start: '08:00', end: '18:00', days: ['Mon','Tue','Wed','Thu','Fri'] },
    ghl_api_key: '',
    ghl_location_id: '',
    twilio_phone: '',
    calendly_url: '',
  })

  const update = (field, value) => setForm(f => ({...f, [field]: value}))

  const handleSubmit = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/contractors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          service_zips: form.service_zips.split(',').map(z => z.trim()).filter(Boolean)
        })
      })
      const contractor = await res.json()
      setStep(4)
      setTimeout(() => onComplete(contractor.id), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Zap className="w-8 h-8 text-purple-500" />
            <span className="text-2xl font-bold">Contractor OS</span>
          </div>
          <p className="text-gray-400">Setup your AI agent in 5 minutes</p>
        </div>

        <div className="flex items-center justify-between mb-6">
          {STEPS.slice(0, 4).map((s, i) => (
            <div key={i} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors
                ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              {i < 3 && <div className={`h-0.5 w-16 mx-1 ${i < step ? 'bg-green-500' : 'bg-gray-800'}`} />}
            </div>
          ))}
        </div>

        <div className="card">
          <h2 className="text-xl font-bold">{STEPS[step].title}</h2>
          <p className="text-gray-400 text-sm mb-6">{STEPS[step].desc}</p>

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Business Name *</label>
                <input className="input" value={form.business_name} onChange={e => update('business_name', e.target.value)} placeholder="Smith's HVAC LLC" />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Trade Type *</label>
                <select className="input" value={form.trade_type} onChange={e => update('trade_type', e.target.value)}>
                  <option value="hvac">HVAC</option>
                  <option value="roofing">Roofing</option>
                  <option value="plumbing">Plumbing</option>
                  <option value="general">General Contractor</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Your Cell Phone (for AI alerts)</label>
                <input className="input" value={form.phone_number} onChange={e => update('phone_number', e.target.value)} placeholder="+1 555-555-5555" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <label className="text-sm text-gray-400 block mb-1">Service ZIP Codes (comma separated)</label>
              <input className="input" value={form.service_zips} onChange={e => update('service_zips', e.target.value)} placeholder="78201, 78202, 78205" />
              <p className="text-xs text-gray-500 mt-2">Enter the ZIP codes where you provide service</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Start Time</label>
                  <input className="input" type="time" value={form.working_hours.start} onChange={e => update('working_hours', {...form.working_hours, start: e.target.value})} />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">End Time</label>
                  <input className="input" type="time" value={form.working_hours.end} onChange={e => update('working_hours', {...form.working_hours, end: e.target.value})} />
                </div>
              </div>
              <p className="text-xs text-gray-500">The AI agent responds 24/7 but will note your business hours</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Twilio Phone Number (AI will use this)</label>
                <input className="input" value={form.twilio_phone} onChange={e => update('twilio_phone', e.target.value)} placeholder="+1 555-000-0000" />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Calendly URL (optional)</label>
                <input className="input" value={form.calendly_url} onChange={e => update('calendly_url', e.target.value)} placeholder="https://calendly.com/yourname" />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">GoHighLevel API Key (optional)</label>
                <input className="input" value={form.ghl_api_key} onChange={e => update('ghl_api_key', e.target.value)} placeholder="GHL API key..." />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-green-400">Your AI Agent is Live!</h3>
              <p className="text-gray-400 mt-2">Redirecting to your dashboard...</p>
            </div>
          )}
        </div>

        {step < 4 && (
          <div className="flex justify-between mt-4">
            <button onClick={() => setStep(s => s - 1)} disabled={step === 0} className="btn-secondary flex items-center gap-2 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            {step < 3 ? (
              <button onClick={() => setStep(s => s + 1)} disabled={step === 0 && !form.business_name} className="btn-primary flex items-center gap-2 disabled:opacity-40">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={loading} className="btn-primary flex items-center gap-2">
                {loading ? 'Setting up...' : 'Launch My AI Agent'} <Zap className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
