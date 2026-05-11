import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-brand-navy">Welcome</h1>
        <p className="mt-2 text-slate-600">
          U.S. Shingle &amp; Metal Training Management. Pick where you want to go:
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Tile to="/calendar" title="Schedule" desc="See every training week. Click a week to see who's coming and manage SMS." />
        <Tile to="/attendance" title="Daily Attendance" desc="HR view: who signed in today, every class, every region." />
        <Tile to="/manager" title="Hiring Manager Portal" desc="Create a new training class and add trainees." />
        <Tile to="/locations" title="Locations" desc="Manage your training locations — hotels, offices, training sites — by region." />
      </div>
    </div>
  )
}

function Tile({ to, title, desc }) {
  return (
    <Link
      to={to}
      className="group block rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-brand-navy hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-red transition group-hover:bg-brand-navy" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{desc}</p>
        </div>
      </div>
    </Link>
  )
}

function Disabled({ title, desc }) {
  return (
    <div className="block rounded-lg border border-dashed border-slate-200 bg-white p-6 opacity-60">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{desc}</p>
        </div>
      </div>
    </div>
  )
}
