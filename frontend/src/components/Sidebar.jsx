import { NavLink } from 'react-router-dom'
import { LayoutDashboard, MessageSquare, Brain, Settings, Zap, LogOut, ShieldCheck } from 'lucide-react'

const contractorNav = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard'     },
  { to: '/conversations', icon: MessageSquare,   label: 'Conversations' },
  { to: '/memory',        icon: Brain,           label: 'AI Memory'     },
  { to: '/settings',      icon: Settings,        label: 'Settings'      },
]

const adminNav = [
  { to: '/',              icon: LayoutDashboard, label: 'Overview'      },
  { to: '/contractors',   icon: ShieldCheck,     label: 'Contractors'   },
  { to: '/conversations', icon: MessageSquare,   label: 'All Convos'    },
  { to: '/settings',      icon: Settings,        label: 'Settings'      },
]

const planColors = {
  owner:    { bg: 'rgba(124,58,237,0.2)', text: '#a78bfa' },
  pro:      { bg: 'rgba(59,130,246,0.2)', text: '#60a5fa' },
  starter:  { bg: 'rgba(16,185,129,0.2)', text: '#34d399' },
  trial:    { bg: 'rgba(156,163,175,0.2)', text: '#9ca3af' },
}

export default function Sidebar({ contractor, onLogout }) {
  const isAdmin = contractor?.role === 'admin'
  const nav     = isAdmin ? adminNav : contractorNav
  const plan    = contractor?.plan || 'trial'
  const colors  = planColors[plan] || planColors.trial
  const initials = (contractor?.name || 'U').split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 flex flex-col"
      style={{ background: '#0a0f1a', borderRight: '1px solid #1e293b' }}>

      {/* Logo */}
      <div className="p-5" style={{ borderBottom: '1px solid #1e293b' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-tight">Contractor OS</div>
            {isAdmin && <div className="text-xs" style={{ color: '#a78bfa' }}>Super Admin</div>}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
               ${isActive
                 ? 'text-white'
                 : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`
            }
            style={({ isActive }) => isActive
              ? { background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }
              : {}}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Account footer */}
      <div className="p-3" style={{ borderTop: '1px solid #1e293b' }}>
        <div className="flex items-center gap-3 px-2 py-2 mb-1">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">
              {contractor?.name || 'Contractor'}
            </div>
            <div className="text-xs truncate" style={{ color: '#64748b' }}>
              {contractor?.company_name || contractor?.email || ''}
            </div>
          </div>
          <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
            style={{ background: colors.bg, color: colors.text }}>
            {plan}
          </span>
        </div>

        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
          style={{ color: '#64748b' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.background = 'transparent' }}
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
