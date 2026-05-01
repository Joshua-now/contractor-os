import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Conversations from './pages/Conversations'
import Memory from './pages/Memory'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

function App() {
  const [contractorId, setContractorId] = useState(
    localStorage.getItem('contractorId')
  )

  const handleOnboardingComplete = (id) => {
    localStorage.setItem('contractorId', id)
    setContractorId(id)
  }

  if (!contractorId) {
    return <Onboarding apiUrl={API_URL} onComplete={handleOnboardingComplete} />
  }

  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 ml-64 p-8">
          <Routes>
            <Route path="/" element={<Dashboard contractorId={contractorId} apiUrl={API_URL} />} />
            <Route path="/conversations" element={<Conversations contractorId={contractorId} apiUrl={API_URL} />} />
            <Route path="/memory" element={<Memory contractorId={contractorId} apiUrl={API_URL} />} />
            <Route path="/settings" element={<Settings contractorId={contractorId} apiUrl={API_URL} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
