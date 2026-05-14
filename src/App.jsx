import { useEffect, useRef, useState } from 'react'
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
import Provision from './pages/Provision.jsx'
import ProvisioningHub from './pages/ProvisioningHub.jsx'
import Credentials from './pages/Credentials.jsx'
import AppDownloads from './pages/AppDownloads.jsx'
import Setup from './pages/Setup.jsx'
import Questions from './pages/Questions.jsx'
import TakeTest from './pages/TakeTest.jsx'
import TestDone from './pages/TestDone.jsx'
import Testimonials from './pages/Testimonials.jsx'
import Notifications from './pages/Notifications.jsx'
import Messages from './pages/Messages.jsx'
import HandoffContacts from './pages/HandoffContacts.jsx'

export default function App() {
  return (
    <Routes>
      {/* Public trainee-facing registration — minimal chrome */}
      <Route path="/register/:token" element={<MinimalLayout><Register /></MinimalLayout>} />

      {/* Public confirmation: trainee taps the link from the 24hr SMS reminder */}
      <Route path="/confirm/:token" element={<MinimalLayout><Confirm /></MinimalLayout>} />

      {/* Public credentials: trainee taps the link from the day-2 SMS */}
      <Route path="/credentials/:token" element={<MinimalLayout><Credentials /></MinimalLayout>} />

      {/* Public app downloads — linked from the credentials page */}
      <Route path="/apps" element={<MinimalLayout><AppDownloads /></MinimalLayout>} />

      {/* Public test taking + thank-you (last-day final assessment) */}
      <Route path="/test/:token" element={<MinimalLayout><TakeTest /></MinimalLayout>} />
      <Route path="/test/:token/done" element={<MinimalLayout><TestDone /></MinimalLayout>} />

      {/* Kiosk: full-bleed, no admin nav (tablet at training site) */}
      <Route path="/kiosk/:class_id" element={<Kiosk />} />

      {/* Internal admin routes — full chrome */}
      <Route element={<AdminLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/class/:id" element={<ClassDetail />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/provisioning" element={<ProvisioningHub />} />
        <Route path="/provision/:class_id" element={<Provision />} />
        <Route path="/setup/:class_id" element={<Setup />} />
        <Route path="/questions" element={<Questions />} />
        <Route path="/testimonials" element={<Testimonials />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/manager" element={<HiringManager />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/handoff-contacts" element={<HandoffContacts />} />
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
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm sm:gap-x-6">
            <NavItem to="/" end>Home</NavItem>
            <NavItem to="/calendar">Schedule</NavItem>
            <NavItem to="/attendance">Attendance</NavItem>
            <NavItem to="/provisioning">Provisioning</NavItem>
            <NavDropdown
              label="Setup"
              items={[
                { to: '/manager', label: 'Hiring Manager' },
                { to: '/locations', label: 'Locations' },
                { to: '/questions', label: 'Questions' },
                { to: '/testimonials', label: 'Testimonials' },
              ]}
            />
            <NavDropdown
              label="Settings"
              items={[
                { to: '/messages', label: 'Messages' },
                { to: '/notifications', label: 'Notifications' },
                { to: '/handoff-contacts', label: 'Handoff contacts' },
                { href: '/system-overview.html', external: true, label: 'System Overview' },
              ]}
            />
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

// Click-to-open menu for the right-side nav groups. Items are either React
// Router targets (to: path) or external links (href + external: true). Closes
// on outside click or when an item is selected.
function NavDropdown({ label, items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 pb-3 -mb-3 text-slate-600 hover:text-brand-navy"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <svg
          className={(open ? 'rotate-180 ' : '') + 'h-3 w-3 transition-transform'}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 5 6 8 9 5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {items.map((item) => {
            if (item.external) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand-navy"
                  role="menuitem"
                >
                  {item.label}{' '}
                  <span className="text-slate-400" aria-hidden="true">↗</span>
                </a>
              )
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  'block px-4 py-2 text-sm ' +
                  (isActive
                    ? 'bg-slate-100 font-semibold text-brand-navy'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-brand-navy')
                }
                role="menuitem"
              >
                {item.label}
              </NavLink>
            )
          })}
        </div>
      )}
    </div>
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
