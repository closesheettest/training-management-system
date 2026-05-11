import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatAddress } from '../lib/locations.js'
import { formatDateLong, parseLocalDate } from '../lib/dates.js'

function todayIso() {
  const d = new Date()
  // Local YYYY-MM-DD (not UTC) so the kiosk uses the user's local day
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function Kiosk() {
  const { class_id } = useParams()
  const [cls, setCls] = useState(null)
  const [trainees, setTrainees] = useState([])
  const [attendanceMap, setAttendanceMap] = useState({}) // trainee_id -> attendance row
  const [today, setToday] = useState(todayIso())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [signingIn, setSigningIn] = useState(null)
  const [welcome, setWelcome] = useState(null) // { first_name } shown briefly after sign-in

  const load = useCallback(async () => {
    setError(null)
    const { data: clsData, error: clsErr } = await supabase
      .from('classes')
      .select('id, region, week_start_date, week_end_date, locations(*)')
      .eq('id', class_id)
      .maybeSingle()
    if (clsErr || !clsData) {
      setError(clsErr?.message || 'Class not found.')
      setLoading(false)
      return
    }
    setCls(clsData)

    const { data: traineeData } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, registered')
      .eq('class_id', class_id)
      .order('first_name', { ascending: true })
    setTrainees(traineeData || [])

    const { data: attData } = await supabase
      .from('attendance')
      .select('*')
      .eq('class_id', class_id)
      .eq('attendance_date', today)
    const map = {}
    for (const a of attData || []) map[a.trainee_id] = a
    setAttendanceMap(map)
    setLoading(false)
  }, [class_id, today])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Auto-refresh every 30s so multiple kiosks / pages stay in sync, and
  // so the date rolls over if the kiosk is left open overnight.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = todayIso()
      if (now !== today) setToday(now)
      else load()
    }, 30000)
    return () => clearInterval(tick)
  }, [today, load])

  async function signIn(t) {
    if (attendanceMap[t.id]?.confirmed) return
    setSigningIn(t.id)
    const { error: err } = await supabase
      .from('attendance')
      .upsert(
        {
          trainee_id: t.id,
          class_id,
          attendance_date: today,
          confirmed: true,
          confirmed_at: new Date().toISOString(),
        },
        { onConflict: 'trainee_id,attendance_date' },
      )
    setSigningIn(null)
    if (err) {
      setError(err.message)
      return
    }
    setWelcome({ first_name: t.first_name })
    setTimeout(() => setWelcome(null), 3500)
    load()
  }

  if (loading) {
    return <KioskShell><p className="text-center text-2xl text-slate-500">Loading…</p></KioskShell>
  }
  if (error) {
    return (
      <KioskShell>
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center text-xl text-red-800">
          {error}
        </div>
      </KioskShell>
    )
  }
  if (!cls) return null

  // Is today within the class week?
  const start = parseLocalDate(cls.week_start_date)
  const end = parseLocalDate(cls.week_end_date)
  const now = parseLocalDate(today)
  const inSession = start && end && now && now >= start && now <= end

  const present = trainees.filter((t) => attendanceMap[t.id]?.confirmed)
  const absent = trainees.filter((t) => !attendanceMap[t.id]?.confirmed)

  return (
    <KioskShell>
      {/* Welcome overlay shown briefly after a successful check-in */}
      {welcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/95 p-8 text-center text-white">
          <div>
            <div className="mb-6 text-7xl">✅</div>
            <div className="text-5xl font-bold tracking-tight">
              Welcome, {welcome.first_name}!
            </div>
            <p className="mt-6 text-2xl text-sky-100">You're signed in. Have a great day.</p>
          </div>
        </div>
      )}

      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-brand-navy sm:text-4xl">
          {cls.locations?.name || `${cls.region} — Training`}
        </h1>
        {cls.locations && (
          <p className="text-base text-slate-600 sm:text-lg">{formatAddress(cls.locations)}</p>
        )}
        <p className="text-base font-medium text-slate-700 sm:text-lg">
          {formatDateLong(today)}
        </p>
        {!inSession && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-amber-900">
            Today is outside this class's scheduled week. Check-ins are still recorded.
          </p>
        )}
      </header>

      <section className="mt-8">
        <h2 className="mb-4 text-xl font-semibold text-slate-800 sm:text-2xl">
          Tap your name to sign in
          <span className="ml-2 text-base font-normal text-slate-500">
            ({present.length} of {trainees.length} signed in)
          </span>
        </h2>
        {trainees.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
            No trainees have been added to this class yet. Please see your training manager.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...absent, ...present].map((t) => {
              const checked = !!attendanceMap[t.id]?.confirmed
              const time = attendanceMap[t.id]?.confirmed_at
              return (
                <button
                  key={t.id}
                  onClick={() => signIn(t)}
                  disabled={checked || signingIn === t.id}
                  className={
                    checked
                      ? 'rounded-xl border-2 border-green-500 bg-green-50 p-6 text-left transition'
                      : 'rounded-xl border-2 border-slate-200 bg-white p-6 text-left transition hover:border-brand-navy hover:shadow-lg active:scale-[0.98]'
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-2xl font-semibold text-slate-900 sm:text-3xl">
                        {t.first_name} {t.last_name}
                      </div>
                      {checked && time && (
                        <div className="mt-1 text-sm text-green-700">
                          Signed in at {new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </div>
                      )}
                      {!checked && !t.registered && (
                        <div className="mt-1 text-sm text-amber-700">Not registered yet</div>
                      )}
                    </div>
                    <div className="shrink-0 text-3xl">
                      {checked ? '✅' : signingIn === t.id ? '…' : '➜'}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">
        Don't see your name?{' '}
        <span className="font-medium text-slate-700">See your training manager.</span>
        <div className="mt-2">
          <Link to={`/class/${class_id}`} className="text-xs text-slate-400 hover:text-slate-600 underline">
            Manager view
          </Link>
        </div>
      </footer>
    </KioskShell>
  )
}

function KioskShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-1 w-full bg-brand-red" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">{children}</div>
    </div>
  )
}
