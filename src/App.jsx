import { Routes, Route, NavLink, Link, Outlet } from 'react-router-dom'
import Home from './pages/Home.jsx'
import HiringManager from './pages/HiringManager.jsx'
import Locations from './pages/Locations.jsx'
import Register from './pages/Register.jsx'
import Calendar from './pages/Calendar.jsx'
import ClassDetail from './pages/ClassDetail.jsx'
import Kiosk from './pages/Kiosk.jsx'
import Attendance from './pages/Attendance.jsx'
import Confirm from './pages/Confirm.jsx'

export default function App() {
  return (
    <Routes>
      {/* Public trainee-facing registration — minimal chrome */}
      <Route path="/register/:token" element={<MinimalLayout><Register /></MinimalLayout>} />

      {/* Public confirmation: trainee taps the link from the 24hr SMS reminder */}
      <Route path="/confirm/:token" element={<MinimalLayout><Confirm /></MinimalLayout>} />

      {/* Kiosk: full-bleed, no admin nav (tablet at training site) */}
      <Route path="/kiosk/:class_id" element={<Kiosk />} />

      {/* Internal admin routes — full chrome */}
      <Route element={<AdminLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/class/:id" element={<ClassDetail />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/manager" element={<HiringManager />} />
        <Route path="/locations" element={<Locations />} />
      </Route>
    </Routes>
  )
}

function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BrandStripe />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <BrandMark />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight text-brand-navy sm:text-lg">
                U.S. Shingle &amp; Metal
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Training Management
              </span>
            </div>
          </Link>
          <nav className="flex gap-5 text-sm sm:gap-6">
            <NavItem to="/" end>Home</NavItem>
            <NavItem to="/calendar">Schedule</NavItem>
            <NavItem to="/attendance">Attendance</NavItem>
            <NavItem to="/manager">Hiring Manager</NavItem>
            <NavItem to="/locations">Locations</NavItem>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}

function MinimalLayout({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BrandStripe />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-6 py-4">
          <BrandMark />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight text-brand-navy sm:text-lg">
              U.S. Shingle &amp; Metal
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Training Registration
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10">{children}</main>
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
          ? 'border-b-2 border-brand-red pb-3 -mb-3 font-semibold text-brand-navy'
          : 'pb-3 -mb-3 text-slate-600 hover:text-brand-navy'
      }
    >
      {children}
    </NavLink>
  )
}

// Thin red stripe across the top of every page — mirrors the red chevron in the logo.
function BrandStripe() {
  return <div className="h-1 w-full bg-brand-red" />
}

// Logo placeholder: stacked chevrons mirroring the rooftop logo (navy + red).
// Once the user drops public/logo.png in place, swap this for <img src="/logo.png" />.
function BrandMark() {
  return (
    <svg viewBox="0 0 64 40" className="h-9 w-14" aria-hidden="true">
      {/* Outer red chevron */}
      <path d="M2 32 L32 6 L62 32" fill="none" stroke="var(--color-brand-red)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      {/* Inner navy chevron */}
      <path d="M14 32 L32 18 L50 32" fill="none" stroke="var(--color-brand-navy)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
