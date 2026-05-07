import { useState, useEffect } from 'react'
import { Brain, Plus, Trash2, Edit3, Check, X } from 'lucide-react'

export default function Memory({ auth, apiUrl }) {
  const contractorId = auth.contractor.id
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token }
  const [memory, setMemory] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [newEntry, setNewEntry] = useState({ key: '', value: '', category: 'general' })
  const [showNew, setShowNew] = useState(false)

  const fetchMemory = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/memory`, { headers })
      setMemory(await res.json())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMemory() }, [contractorId, apiUrl])

  const saveEntry = async (entry) => {
    try {
      await fetch(`${apiUrl}/api/memory`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(entry)
      })
      await fetchMemory()
      setEditing(null)
      setShowNew(false)
      setNewEntry({ key: '', value: '', category: 'general' })
    } catch (err) {
      console.error(err)
    }
  }

  const deleteEntry = async (key) => {
    try {
      await fetch(`${apiUrl}/api/memory/${key}`, { method: 'DELETE', headers })
      setMemory(memory.filter(m => m.key !== key))
    } catch (err) {
      console.error(err)
    }
  }

  const categories = [...new Set(memory.map(m => m.category))]

  if (loading) return <div className="text-gray-400">Loading memory...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-400" />
            AI Memory
          </h1>
          <p className="text-gray-400 mt-1">What your AI knows about your business</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Memory
        </button>
      </div>

      {showNew && (
        <div className="card border-purple-500">
          <h3 className="font-medium mb-3">New Memory Entry</h3>
          <div className="grid grid-cols-3 gap-3">
            <input className="input" placeholder="Key (e.g. google_review_link)" value={newEntry.key} onChange={e => setNewEntry({...newEntry, key: e.target.value})} />
            <input className="input" placeholder="Value" value={newEntry.value} onChange={e => setNewEntry({...newEntry, value: e.target.value})} />
            <select className="input" value={newEntry.category} onChange={e => setNewEntry({...newEntry, category: e.target.value})}>
              <option value="general">General</option>
              <option value="business">Business</option>
              <option value="pricing">Pricing</option>
              <option value="service">Service</option>
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => saveEntry(newEntry)} className="btn-primary flex items-center gap-1"><Check className="w-4 h-4" /> Save</button>
            <button onClick={() => setShowNew(false)} className="btn-secondary flex items-center gap-1"><X className="w-4 h-4" /> Cancel</button>
          </div>
        </div>
      )}

      {categories.map(category => (
        <div key={category} className="card">
          <h3 className="font-medium capitalize text-gray-300 mb-3">{category}</h3>
          <div className="space-y-2">
            {memory.filter(m => m.category === category).map(item => (
              <div key={item.id} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                {editing?.id === item.id ? (
                  <>
                    <input className="input flex-1" value={editing.value} onChange={e => setEditing({...editing, value: e.target.value})} />
                    <button onClick={() => saveEntry(editing)} className="text-green-400 hover:text-green-300"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-300"><X className="w-4 h-4" /></button>
                  </>
                ) : (
                  <>
                    <div className="flex-1">
                      <span className="text-xs text-gray-500">{item.key}: </span>
                      <span className="text-sm">{item.value}</span>
                    </div>
                    <button onClick={() => setEditing(item)} className="text-gray-500 hover:text-gray-300"><Edit3 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteEntry(item.key)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {memory.length === 0 && !showNew && (
        <div className="card text-center py-12">
          <Brain className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No memory entries yet.</p>
          <p className="text-gray-600 text-sm">Add facts about your business to help the AI represent you better.</p>
        </div>
      )}
    </div>
  )
}
