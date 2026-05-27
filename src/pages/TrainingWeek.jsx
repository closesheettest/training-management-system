import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// /training-week — admin authoring page for the daily-homework + morning-
// quiz feature. Phase 1 ONLY: content management. No SMS fires from here.
//
// Each day card lets admin edit:
//   • Label (display name in the card header)
//   • Enabled flag (controls whether the Phase-2 cron will pick this day
//     up. Default false so half-authored days don't text trainees.)
//   • Homework SMS body (supports {firstName} substitution)
//   • Homework link URL (where the SMS link points)
//   • Admin-only notes
//   • Quiz questions (multiple-choice, 0+ per day)
//
// The Phase-2 cron + kiosk hook (not yet built) will read these rows
// and only act on days where enabled=true AND body is non-empty AND at
// least one question exists. Until those triggers ship, this page is
// the entire feature — it's safe to deploy and start populating.

export default function TrainingWeek() {
  const [days, setDays] = useState(null)
  // Per-day draft state — keyed by day_number. Allows in-place editing
  // without saving on every keystroke. Each draft holds the editable
  // fields; questions are tracked separately because they're a 1-to-many.
  const [drafts, setDrafts] = useState({})
  const [savingDay, setSavingDay] = useState(null)
  const [flash, setFlash] = useState(null)
  // Per-day question list. Shape: { [dayNumber]: [{...question}, ...] }
  const [questionsByDay, setQuestionsByDay] = useState({})

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [{ data: dayRows, error: dayErr }, { data: qRows, error: qErr }] =
      await Promise.all([
        supabase
          .from('training_day_lessons')
          .select('*')
          .order('day_number', { ascending: true }),
        supabase
          .from('training_day_quiz_questions')
          .select('*')
          .order('day_number', { ascending: true })
          .order('position', { ascending: true }),
      ])
    if (dayErr || qErr) {
      setFlash({ kind: 'error', text: (dayErr || qErr).message })
      setDays([])
      return
    }
    setDays(dayRows || [])
    const initialDrafts = {}
    for (const d of dayRows || []) {
      initialDrafts[d.day_number] = {
        label: d.label || '',
        homework_sms_body: d.homework_sms_body || '',
        homework_link_url: d.homework_link_url || '',
        admin_notes: d.admin_notes || '',
        enabled: !!d.enabled,
      }
    }
    setDrafts(initialDrafts)
    // Group questions by day
    const byDay = {}
    for (const q of qRows || []) {
      if (!byDay[q.day_number]) byDay[q.day_number] = []
      byDay[q.day_number].push(q)
    }
    setQuestionsByDay(byDay)
  }

  // Update the draft state for one day without saving.
  function patchDraft(dayNumber, patch) {
    setDrafts((prev) => ({
      ...prev,
      [dayNumber]: { ...(prev[dayNumber] || {}), ...patch },
    }))
  }

  async function saveDay(dayNumber) {
    const draft = drafts[dayNumber]
    if (!draft) return
    setSavingDay(dayNumber)
    const { error } = await supabase
      .from('training_day_lessons')
      .update({
        label: draft.label.trim() || null,
        homework_sms_body: draft.homework_sms_body || null,
        homework_link_url: draft.homework_link_url.trim() || null,
        admin_notes: draft.admin_notes || null,
        enabled: !!draft.enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('day_number', dayNumber)
    setSavingDay(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Day ${dayNumber} saved.` })
    await load()
  }

  // Add a blank question to a day. Defaults: 4 empty options, correct=0.
  async function addQuestion(dayNumber) {
    const existing = questionsByDay[dayNumber] || []
    const nextPosition = existing.length === 0
      ? 0
      : Math.max(...existing.map((q) => q.position || 0)) + 1
    const { error } = await supabase.from('training_day_quiz_questions').insert({
      day_number: dayNumber,
      position: nextPosition,
      question_text: '',
      options: ['', '', '', ''],
      correct_index: 0,
    })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    await load()
  }

  async function deleteQuestion(questionId) {
    if (!confirm('Delete this question? Cannot be undone.')) return
    const { error } = await supabase
      .from('training_day_quiz_questions')
      .delete()
      .eq('id', questionId)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    await load()
  }

  async function saveQuestion(question) {
    const { error } = await supabase
      .from('training_day_quiz_questions')
      .update({
        question_text: question.question_text || '',
        options: question.options || [],
        correct_index: Number(question.correct_index) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', question.id)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return false
    }
    setFlash({ kind: 'success', text: 'Question saved.' })
    await load()
    return true
  }

  if (days === null) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Training Week</h1>
        <p className="mt-2 text-slate-600">
          Author the daily homework SMS + morning mini-quiz that runs across every training class.
          One shared template — Day 1's content applies to every class's first day, Day 2's content
          to every second day, and so on.
        </p>
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>⚠ Phase 1 — content authoring only.</strong> Nothing here texts anyone yet. The
          nightly homework cron and the kiosk-sign-in morning-quiz trigger ship in Phase 2. Until
          then, you can safely populate this page in any order — flip the <strong>Enabled</strong>{' '}
          toggle on each day once you're happy with its content, but it has no effect yet.
        </div>
      </header>

      {flash && (
        <div
          className={
            'rounded-md border p-3 text-sm ' +
            (flash.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {flash.text}
        </div>
      )}

      {days.length === 0 ? (
        <div className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          No day rows found. The migration may not have run yet — see{' '}
          <code>supabase/migrations/2026-05-27-training-week.sql</code>.
        </div>
      ) : (
        days.map((d) => (
          <DayCard
            key={d.day_number}
            day={d}
            draft={drafts[d.day_number] || {}}
            patchDraft={(patch) => patchDraft(d.day_number, patch)}
            saving={savingDay === d.day_number}
            onSave={() => saveDay(d.day_number)}
            questions={questionsByDay[d.day_number] || []}
            onAddQuestion={() => addQuestion(d.day_number)}
            onSaveQuestion={saveQuestion}
            onDeleteQuestion={deleteQuestion}
          />
        ))
      )}

      <p className="text-xs text-slate-400">
        Need a homework destination page? See{' '}
        <Link to="/hosted-pages" className="underline">Hosted pages</Link>{' '}
        for existing options like <code>/sales-pitch/</code>, <code>/apps</code>,{' '}
        <code>/welcome</code> — paste any of those paths into the "Homework link URL" field.
      </p>
    </div>
  )
}

// One day's editor card. Two sections: homework (top) + quiz (bottom).
function DayCard({ day, draft, patchDraft, saving, onSave, questions, onAddQuestion, onSaveQuestion, onDeleteQuestion }) {
  // Substitute {firstName} → "Sample" for the live preview so admin sees
  // a realistic example without thinking about the variable.
  const previewBody = (draft.homework_sms_body || '').replace(/\{firstName\}/g, 'Sample')
  const previewLink = (draft.homework_link_url || '').trim()
  return (
    <section
      className={
        'rounded-lg border bg-white p-5 shadow-sm space-y-4 ' +
        (draft.enabled ? 'border-emerald-300' : 'border-slate-200')
      }
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
            Day {day.day_number}
          </span>
          <input
            type="text"
            value={draft.label || ''}
            onChange={(e) => patchDraft({ label: e.target.value })}
            placeholder={`e.g. Day ${day.day_number} — Door pitch homework`}
            className="w-full max-w-md rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={!!draft.enabled}
            onChange={(e) => patchDraft({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
          <span className={draft.enabled ? 'font-semibold text-emerald-800' : 'text-slate-500'}>
            {draft.enabled ? '✓ Enabled (cron will fire)' : 'Disabled (cron skips)'}
          </span>
        </label>
      </header>

      {/* Homework editor */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          📝 Homework SMS (sent at end of Day {day.day_number})
        </h3>
        <Field label="SMS body">
          <textarea
            rows={5}
            value={draft.homework_sms_body || ''}
            onChange={(e) => patchDraft({ homework_sms_body: e.target.value })}
            placeholder={`Hi {firstName}, great day! Tonight: ...`}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-1 text-xs text-slate-500">
            Use <code>{'{firstName}'}</code> for the trainee's first name. The link below gets
            appended at send time.
          </div>
        </Field>
        <Field label="Homework link URL">
          <input
            type="text"
            value={draft.homework_link_url || ''}
            onChange={(e) => patchDraft({ homework_link_url: e.target.value })}
            placeholder="/sales-pitch/  or  https://..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Admin notes (not sent)">
          <textarea
            rows={2}
            value={draft.admin_notes || ''}
            onChange={(e) => patchDraft({ admin_notes: e.target.value })}
            placeholder="Reminders to yourself — not sent in the SMS."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        {/* Live preview */}
        {(draft.homework_sms_body || draft.homework_link_url) && (
          <div className="rounded-md border border-slate-300 bg-white p-3 text-xs">
            <div className="font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Preview (for "Sample")
            </div>
            <div className="whitespace-pre-wrap text-slate-800">
              {previewBody}
              {previewLink && (
                <>
                  {previewBody && !previewBody.endsWith('\n') ? '\n\n' : ''}
                  <span className="text-sky-700 underline">{previewLink}</span>
                </>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Day ' + day.day_number}
          </button>
        </div>
      </div>

      {/* Quiz editor */}
      <div className="rounded-md border border-slate-200 bg-sky-50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-sky-900">
            🧠 Morning quiz (fires the day after, on kiosk sign-in)
          </h3>
          <button
            type="button"
            onClick={onAddQuestion}
            className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800"
          >
            + Add question
          </button>
        </div>
        {questions.length === 0 ? (
          <p className="rounded-md border border-dashed border-sky-300 bg-white p-4 text-center text-xs text-sky-800">
            No quiz questions yet. Click "+ Add question" to write the first one. 3-5 quick
            multiple-choice questions is the sweet spot.
          </p>
        ) : (
          <ol className="space-y-3">
            {questions.map((q, idx) => (
              <QuestionEditor
                key={q.id}
                index={idx + 1}
                initial={q}
                onSave={onSaveQuestion}
                onDelete={() => onDeleteQuestion(q.id)}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

// One question's inline editor. Independent local state per row so
// users can type freely without thrashing the parent's draft state;
// "Save question" pushes to Supabase + reloads the parent's list.
function QuestionEditor({ index, initial, onSave, onDelete }) {
  const [questionText, setQuestionText] = useState(initial.question_text || '')
  const [options, setOptions] = useState(
    Array.isArray(initial.options) && initial.options.length > 0
      ? initial.options
      : ['', '', '', ''],
  )
  const [correctIndex, setCorrectIndex] = useState(Number(initial.correct_index) || 0)
  const [saving, setSaving] = useState(false)

  function patchOption(i, value) {
    const next = options.slice()
    next[i] = value
    setOptions(next)
  }
  function addOption() {
    setOptions([...options, ''])
  }
  function removeOption(i) {
    if (options.length <= 2) return // require at least 2 options
    const next = options.filter((_, idx) => idx !== i)
    setOptions(next)
    // Re-anchor correct_index if we just deleted the correct option.
    if (correctIndex === i) setCorrectIndex(0)
    else if (correctIndex > i) setCorrectIndex(correctIndex - 1)
  }
  async function save() {
    setSaving(true)
    await onSave({
      id: initial.id,
      question_text: questionText,
      options,
      correct_index: correctIndex,
    })
    setSaving(false)
  }
  return (
    <li className="rounded-md border border-sky-200 bg-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">
          Q{index}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs font-semibold text-red-700 hover:underline"
        >
          Delete
        </button>
      </div>
      <Field label="Question">
        <textarea
          rows={2}
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          placeholder="e.g. According to the door pitch, what's the main concern we're addressing for the homeowner?"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Options (tap the dot to mark the correct one)
        </span>
        <ul className="mt-1 space-y-1.5">
          {options.map((opt, i) => (
            <li key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCorrectIndex(i)}
                title={correctIndex === i ? 'Correct answer' : 'Mark as correct'}
                className={
                  'h-5 w-5 rounded-full border-2 transition ' +
                  (correctIndex === i
                    ? 'border-emerald-600 bg-emerald-500'
                    : 'border-slate-300 bg-white hover:border-emerald-400')
                }
              >
                {correctIndex === i && (
                  <span className="block leading-none text-[10px] text-white">✓</span>
                )}
              </button>
              <input
                type="text"
                value={opt}
                onChange={(e) => patchOption(i, e.target.value)}
                placeholder={`Option ${String.fromCharCode(65 + i)}`}
                className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="text-xs text-slate-400 hover:text-red-700"
                  title="Remove this option"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addOption}
          className="mt-2 text-xs font-semibold text-sky-700 hover:underline"
        >
          + Add option
        </button>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || !questionText.trim()}
          className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save question'}
        </button>
      </div>
    </li>
  )
}
