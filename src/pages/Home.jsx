import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome</h1>
      <p className="text-slate-600">
        This is the Training Management System. Pick where you want to go:
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/locations"
          className="block rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <h2 className="text-lg font-semibold">Locations</h2>
          <p className="mt-1 text-sm text-slate-600">
            Save your hotels and training sites — set up once, reuse forever.
          </p>
        </Link>
        <Link
          to="/manager"
          className="block rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <h2 className="text-lg font-semibold">Hiring Manager Portal</h2>
          <p className="mt-1 text-sm text-slate-600">
            Create a new training class and add trainees.
          </p>
        </Link>
        <div className="block rounded-lg border border-dashed border-slate-200 bg-white p-6 opacity-60 sm:col-span-2">
          <h2 className="text-lg font-semibold">Trainee Registration</h2>
          <p className="mt-1 text-sm text-slate-600">
            Coming in Stage 2 — trainees will receive a personal link via text from GoHighLevel.
          </p>
        </div>
      </div>
    </div>
  )
}
