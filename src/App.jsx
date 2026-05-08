import { Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home.jsx'
import HiringManager from './pages/HiringManager.jsx'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Training Management
          </Link>
          <nav className="flex gap-6 text-sm">
            <Link to="/" className="text-slate-600 hover:text-slate-900">Home</Link>
            <Link to="/manager" className="text-slate-600 hover:text-slate-900">Hiring Manager</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/manager" element={<HiringManager />} />
        </Routes>
      </main>
    </div>
  )
}
