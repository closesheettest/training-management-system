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
import MessageTemplates from './pages/MessageTemplates.jsx'
import Hotels from './pages/Hotels.jsx'
import Personas from './pages/Personas.jsx'
import Welcome from './pages/Welcome.jsx'
import WelcomeLinks from './pages/WelcomeLinks.jsx'
import Results from './pages/Results.jsx'
import UpdateInfo from './pages/UpdateInfo.jsx'
import GroupMessages from './pages/GroupMessages.jsx'
import ActiveReps from './pages/ActiveReps.jsx'
import RepMap from './pages/RepMap.jsx'
import Regions from './pages/Regions.jsx'
import Directory from './pages/Directory.jsx'
import DirectoryAdmin from './pages/DirectoryAdmin.jsx'
import HostedPages from './pages/HostedPages.jsx'
import RegionalManager from './pages/RegionalManager.jsx'
import TrainingWeek from './pages/TrainingWeek.jsx'
import Quiz from './pages/Quiz.jsx'
import Progress from './pages/Progress.jsx'
import { PersonaProvider, usePersona } from './lib/PersonaContext.jsx'
import { RegionsProvider } from './lib/RegionsContext.jsx'
import PersonaSplash from './components/PersonaSplash.jsx'
import { roleLabel } from './lib/personas.js'

export default function App() {
  return (
    <PersonaProvider>
      <RegionsProvider>
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

        {/* Public welcome page — newly-graduated reps get texted this
            URL daily for 7 days. Shows the few company links they
            constantly forget where to find. No auth. */}
        <Route path="/welcome" element={<MinimalLayout><Welcome /></MinimalLayout>} />

        {/* Public final-test results page — token-gated. Trainees get
            texted /results/<their token> from the Class detail page
            so they can see exactly which questions they got right or
            wrong on the multiple choice, plus their essay answers. */}
        <Route path="/results/:token" element={<MinimalLayout><Results /></MinimalLayout>} />

        {/* Public self-service info update — reps tap a link from the
            Group Messages broadcast and fill in personal email + home
            address. Token-gated. */}
        <Route path="/update-info/:token" element={<MinimalLayout><UpdateInfo /></MinimalLayout>} />

        {/* Public morning mini-quiz — trainees tap a link from the
            kiosk-sign-in-triggered SMS. Token-gated; questions test the
            previous day's training content. See send-training-quiz.js
            for the fan-out logic. */}
        <Route path="/quiz/:token" element={<MinimalLayout><Quiz /></MinimalLayout>} />

        {/* Public regional sales manager dashboard. The token IS the
            credential — no app chrome, no nav. The manager can see the
            reps in their region, deactivate someone, and SMS/email their
            team. All actions go through regional-manager-api.js which
            gates by region server-side. */}
        <Route path="/regional-manager/:token" element={<RegionalManager />} />

        {/* Public company directory — shareable phone-book of every
            active team member. Its own self-contained layout (no admin
            nav) so anyone given the URL stays scoped to this page only. */}
        <Route path="/directory" element={<Directory />} />

        {/* Internal admin routes — full chrome (gated by persona splash).
            Each top-nav route is wrapped in <RouteGate> which checks the
            current persona's visiblePages set against the route's page
            key — if the role doesn't have access, the user sees a
            "Not in your view" screen with a Switch button instead of
            the page. Deep-link routes (class/:id, provision/:id,
            setup/:id) are left ungated since they're reached from
            contextual links and texts. */}
        <Route element={<AdminLayout />}>
          <Route path="/" element={<RouteGate pageKey="home"><Home /></RouteGate>} />
          <Route path="/calendar" element={<RouteGate pageKey="schedule"><Calendar /></RouteGate>} />
          <Route path="/class/:id" element={<ClassDetail />} />
          <Route path="/attendance" element={<RouteGate pageKey="attendance"><Attendance /></RouteGate>} />
          <Route path="/progress" element={<RouteGate pageKey="progress"><Progress /></RouteGate>} />
          <Route path="/provisioning" element={<RouteGate pageKey="provisioning"><ProvisioningHub /></RouteGate>} />
          <Route path="/provision/:class_id" element={<Provision />} />
          <Route path="/setup/:class_id" element={<Setup />} />
          <Route path="/questions" element={<RouteGate pageKey="setup.questions"><Questions /></RouteGate>} />
          <Route path="/testimonials" element={<RouteGate pageKey="setup.testimonials"><Testimonials /></RouteGate>} />
          <Route path="/notifications" element={<RouteGate pageKey="settings.notifications"><Notifications /></RouteGate>} />
          <Route path="/messages" element={<RouteGate pageKey="settings.messages"><Messages /></RouteGate>} />
          <Route path="/manager" element={<RouteGate pageKey="setup.manager"><HiringManager /></RouteGate>} />
          <Route path="/locations" element={<RouteGate pageKey="setup.locations"><Locations /></RouteGate>} />
          <Route path="/handoff-contacts" element={<RouteGate pageKey="settings.handoff"><HandoffContacts /></RouteGate>} />
          <Route path="/message-templates" element={<RouteGate pageKey="settings.templates"><MessageTemplates /></RouteGate>} />
          <Route path="/hotels" element={<RouteGate pageKey="setup.hotels"><Hotels /></RouteGate>} />
          <Route path="/welcome-links" element={<RouteGate pageKey="setup.welcome_links"><WelcomeLinks /></RouteGate>} />
          <Route path="/personas" element={<RouteGate pageKey="settings.personas"><Personas /></RouteGate>} />
          <Route path="/group-messages" element={<RouteGate pageKey="settings.group_messages"><GroupMessages /></RouteGate>} />
          <Route path="/active-reps" element={<RouteGate pageKey="settings.active_reps"><ActiveReps /></RouteGate>} />
          <Route path="/manage-directory" element={<RouteGate pageKey="settings.active_reps"><DirectoryAdmin /></RouteGate>} />
          <Route path="/rep-map" element={<RouteGate pageKey="team.map"><RepMap /></RouteGate>} />
          <Route path="/regions" element={<RouteGate pageKey="team.regions"><Regions /></RouteGate>} />
          <Route path="/hosted-pages" element={<RouteGate pageKey="settings.hosted_pages"><HostedPages /></RouteGate>} />
          <Route path="/training-week" element={<RouteGate pageKey="setup.training_week"><TrainingWeek /></RouteGate>} />
        </Route>
      </Routes>
      </RegionsProvider>
    </PersonaProvider>
  )
}

function AdminLayout() {
  const { status, persona, visiblePages, switchPersona } = usePersona()

  // While we're loading the persona from localStorage + DB, show a thin
  // placeholder so the nav doesn't flicker.
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <BrandStripe />
        <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-400">Loading…</div>
      </div>
    )
  }

  // No persona picked yet (or the stored id was invalid) → splash.
  if (status === 'splash') {
    return <PersonaSplash />
  }

  // Filter helpers — each nav item checks visiblePages before rendering.
  const show = (key) => visiblePages.has(key)
  const setupItems = [
    { key: 'setup.manager', to: '/manager', label: 'Hiring Manager' },
    { key: 'setup.locations', to: '/locations', label: 'Locations' },
    { key: 'setup.hotels', to: '/hotels', label: 'Hotels' },
    { key: 'setup.welcome_links', to: '/welcome-links', label: 'Welcome page links' },
    { key: 'setup.questions', to: '/questions', label: 'Questions' },
    { key: 'setup.testimonials', to: '/testimonials', label: 'Testimonials' },
    { key: 'setup.training_week', to: '/training-week', label: 'Training Week' },
  ].filter((it) => show(it.key))
  const teamItems = [
    { key: 'settings.active_reps', to: '/active-reps', label: 'Active sales reps' },
    { key: 'team.map', to: '/rep-map', label: 'Sales team map' },
    { key: 'team.regions', to: '/regions', label: 'Regions' },
    { key: 'settings.group_messages', to: '/group-messages', label: 'Group messages' },
    // Internal admin panel for the shared directory.
    { key: 'settings.active_reps', to: '/manage-directory', label: 'Manage directory' },
    // External so the dropdown shows the ↗ arrow and opens in a new
    // tab — matches the System Overview link pattern. The directory
    // page intentionally has no admin nav of its own, so this is the
    // only shortcut into it from the admin UI.
    { key: 'settings.active_reps', href: '/directory', external: true, label: 'Team directory (public)' },
  ].filter((it) => show(it.key))
  const settingsItems = [
    { key: 'settings.messages', to: '/messages', label: 'Messages' },
    { key: 'settings.notifications', to: '/notifications', label: 'Notifications' },
    { key: 'settings.templates', to: '/message-templates', label: 'Message templates' },
    { key: 'settings.handoff', to: '/handoff-contacts', label: 'Handoff contacts' },
    { key: 'settings.personas', to: '/personas', label: 'Personas' },
    { key: 'settings.hosted_pages', to: '/hosted-pages', label: 'Hosted pages' },
    { key: 'settings.overview', href: '/system-overview.html', external: true, label: 'System Overview' },
  ].filter((it) => show(it.key))

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BrandStripe />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
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
            {show('home') && <NavItem to="/" end>Home</NavItem>}
            {show('schedule') && <NavItem to="/calendar">Schedule</NavItem>}
            {show('progress') && <NavItem to="/progress">Progress</NavItem>}
            {show('attendance') && <NavItem to="/attendance">Attendance</NavItem>}
            {show('provisioning') && <NavItem to="/provisioning">Provisioning</NavItem>}
            {setupItems.length > 0 && <NavDropdown label="Setup" items={setupItems} />}
            {teamItems.length > 0 && <NavDropdown label="Sales Team" items={teamItems} />}
            {settingsItems.length > 0 && <NavDropdown label="Settings" items={settingsItems} />}
            <PersonaBadge persona={persona} onSwitch={switchPersona} />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}

// Wraps a route element. If the current persona has the page key in
// their visible set, render the page. Otherwise show a "Not in your
// view" screen with options to go home or switch persona. This is
// real navigation gating — not just nav hiding — but it's still not
// auth: anyone can click Switch and pick a different persona to gain
// different access.
function RouteGate({ pageKey, children }) {
  const { visiblePages, persona } = usePersona()
  if (visiblePages.has(pageKey)) return children
  return <NotInYourView pageKey={pageKey} persona={persona} />
}

function NotInYourView({ pageKey, persona }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <div className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
        Not in your view
      </div>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">You don't have access to this page</h1>
      <p className="mt-3 text-slate-600">
        {persona ? (
          <>
            <strong>{persona.name}</strong> ({roleLabel(persona.role)}) doesn't have access to{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">{pageKey}</code>.
          </>
        ) : (
          <>You don't have an active persona set.</>
        )}
      </p>
      <p className="mt-2 text-sm text-slate-500">
        If you think you should have access to this page, talk to your admin.
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          to="/"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← Back to Home
        </Link>
      </div>
    </div>
  )
}

function PersonaBadge({ persona, onSwitch }) {
  if (!persona) return null
  return (
    <div className="ml-0 flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs sm:ml-2">
      <span className="font-medium text-slate-700">👤 {persona.name}</span>
      <span className="text-slate-400">·</span>
      <span className="text-slate-500">{roleLabel(persona.role)}</span>
      <button
        type="button"
        onClick={onSwitch}
        className="ml-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-200"
        title="Switch to a different person"
      >
        Switch
      </button>
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
