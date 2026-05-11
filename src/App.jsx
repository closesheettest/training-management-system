import { Routes, Route, NavLink, Link } from 'react-router-dom'
import Home from './pages/Home.jsx'
import HiringManager from './pages/HiringManager.jsx'
import Locations from './pages/Locations.jsx'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Training Management
          </Link>
          <nav className="flex gap-6 text-sm">
            <NavItem to="/" end>Home</NavItem>
            <NavItem to="/manager">Hiring Manager</NavItem>
            <NavItem to="/locations">Locations</NavItem>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/manager" element={<HiringManager />} />
          <Route path="/locations" element={<Locations />} />
        </Routes>
      </main>
    </div>
  )
}

function NavItem({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        isActive
          ? 'font-medium text-slate-900'
          : 'text-slate-600 hover:text-slate-900'
      }
    >
      {children}
    </NavLink>
  )
}
