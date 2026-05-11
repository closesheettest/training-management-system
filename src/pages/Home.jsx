import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome</h1>
      <p className="text-slate-600">
        This is the Training Management System. Pick where you want to go:
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Tile to="/calendar" title="Schedule" desc="See every training week. Click a week to see who's coming and manage SMS." />
        <Tile to="/manager" title="Hiring Manager Portal" desc="Create a new training class and add trainees." />
        <Tile to="/locations" title="Locations" desc="Manage your hotels and training sites by region." />
        <Disabled title="Trainee Registration" desc="Public page trainees reach via the SMS link (Phase 1 ✅)." />
      </div>
    </div>
  )
}

function Tile({ to, title, desc }) {
  return (
    <Link
      to={to}
      className="block rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{desc}</p>
    </Link>
  )
}

function Disabled({ title, desc }) {
  return (
    <div className="block rounded-lg border border-dashed border-slate-200 bg-white p-6 opacity-60">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{desc}</p>
    </div>
  )
}
