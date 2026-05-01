import { NavLink } from 'react-router-dom'
import { LayoutDashboard, MessageSquare, Brain, Settings, Zap } from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/conversations', icon: MessageSquare, label: 'Conversations' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-purple-500" />
          <span className="text-lg font-bold">Contractor OS</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">AI Operating System</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-gray-400">Agent Active</span>
        </div>
      </div>
    </aside>
  )
}
