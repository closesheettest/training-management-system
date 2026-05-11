import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatAddress } from '../lib/locations.js'
import { formatDateLong } from '../lib/dates.js'

export default function Confirm() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | not_found | choose | saving | done
  const [trainee, setTrainee] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [location, setLocation] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
  }, [token])

  async function load() {
    setStatus('loading')
    const { data, error } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, confirmation_status, confirmation_at, classes(week_start_date, week_end_date, schedule_details, locations(name, street_address, city, state, zip, phone, schedule_template))',
      )
      .eq('registration_token', token)
      .maybeSingle()
    if (error || !data) {
      setStatus('not_found')
      return
    }
    setTrainee(data)
    setClassInfo(data.classes || null)
    setLocation(data.classes?.locations || null)
    setStatus('choose')
  }

  async function respond(choice) {
    setErrorMsg(null)
    setStatus('saving')
    const { error } = await supabase
      .from('trainees')
      .update({
        confirmation_status: choice,
        confirmation_at: new Date().toISOString(),
      })
      .eq('registration_token', token)
    if (error) {
      setErrorMsg(error.message)
      setStatus('choose')
      return
    }
    setTrainee((prev) => ({ ...prev, confirmation_status: choice, confirmation_at: new Date().toISOString() }))
    setStatus('done')
  }

  if (status === 'loading') {
    return <p className="text-slate-500">Loading…</p>
  }

  if (status === 'not_found') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-red-900">Link not found</h1>
        <p className="mt-2 text-red-800">
          This link may have expired or been mistyped. Please check the text message you received,
          or contact your training manager.
        </p>
      </div>
    )
  }

  const alreadyAnswered = !!trainee?.confirmation_status
  const currentChoice = trainee?.confirmation_status // 'confirmed' | 'declined' | null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          {currentChoice === 'confirmed'
            ? `You're confirmed${trainee?.first_name ? `, ${trainee.first_name}` : ''}`
            : currentChoice === 'declined'
              ? `Got it${trainee?.first_name ? `, ${trainee.first_name}` : ''}`
              : `Hi${trainee?.first_name ? `, ${trainee.first_name}` : ''}!`}
        </h1>
        <p className="mt-2 text-slate-600">
          {currentChoice === 'confirmed'
            ? "We've got you down for tomorrow's training. See you there!"
            : currentChoice === 'declined'
              ? "Thanks for letting us know. We'll inform your training manager."
              : 'Please confirm whether you can attend tomorrow.'}
        </p>
      </div>

      {/* Class details */}
      {classInfo && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-lg font-semibold">Training details</h2>
          <dl className="space-y-2 text-sm">
            {location && (
              <Row label="Location">
                <div className="font-medium text-slate-900">{location.name}</div>
                <div className="text-slate-600">{formatAddress(location)}</div>
                {location.phone && <div className="text-slate-600">{location.phone}</div>}
              </Row>
            )}
            <Row label="Starts">{formatDateLong(classInfo.week_start_date)}</Row>
            {(classInfo.schedule_details || location?.schedule_template) && (
              <Row label="Schedule">
                <span className="whitespace-pre-line">
                  {classInfo.schedule_details || location.schedule_template}
                </span>
              </Row>
            )}
          </dl>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {/* Choice buttons (or current state + change link) */}
      <div className="space-y-3">
        <button
          onClick={() => respond('confirmed')}
          disabled={status === 'saving' || currentChoice === 'confirmed'}
          className={
            currentChoice === 'confirmed'
              ? 'w-full rounded-lg border-2 border-green-500 bg-green-50 px-6 py-5 text-center text-lg font-semibold text-green-900'
              : 'w-full rounded-lg bg-green-600 px-6 py-5 text-center text-lg font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-[0.98] disabled:opacity-50'
          }
        >
          {currentChoice === 'confirmed' ? '✓ Confirmed — I\'ll be there' : "✅ Yes, I'll be there"}
        </button>
        <button
          onClick={() => respond('declined')}
          disabled={status === 'saving' || currentChoice === 'declined'}
          className={
            currentChoice === 'declined'
              ? 'w-full rounded-lg border-2 border-red-400 bg-red-50 px-6 py-5 text-center text-lg font-semibold text-red-900'
              : 'w-full rounded-lg border-2 border-slate-300 bg-white px-6 py-5 text-center text-lg font-semibold text-slate-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 active:scale-[0.98] disabled:opacity-50'
          }
        >
          {currentChoice === 'declined' ? '✗ Declined — Can\'t make it' : "❌ Can't make it"}
        </button>

        {alreadyAnswered && (
          <p className="pt-2 text-center text-xs text-slate-500">
            Need to change your mind? Tap the other option above.
            {trainee?.confirmation_at && (
              <>
                {' · '}Last response: {new Date(trainee.confirmation_at).toLocaleString()}
              </>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 text-slate-700">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
