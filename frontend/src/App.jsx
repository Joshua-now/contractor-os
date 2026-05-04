import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'

const API_URL = import.meta.env.VITE_API_URL || ''

function App() {
    return (
          <BrowserRouter>
                <Routes>
                        <Route path="/" element={<Dashboard apiUrl={API_URL} />} />
                        <Route path="*" element={<Navigate to="/" />} />
                </Routes>Routes>
          </BrowserRouter>BrowserRouter>
        )
}

export default App</BrowserRouter>
