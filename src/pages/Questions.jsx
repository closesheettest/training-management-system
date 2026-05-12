import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const blankQuestion = () => ({
  prompt: '',
  question_type: 'multiple_choice',
  choices: ['', ''],
  correct_choice: '',
  use_for_testimonial: false,
  active: true,
})

export default function Questions() {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [editingId, setEditingId] = useState(null) // null | 'new' | uuid
  const [draft, setDraft] = useState(blankQuestion())
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('questions')
      .select('*')
      .order('order_index', { ascending: true })
    if (err) setError(err.message)
    else setQuestions(data || [])
    setLoading(false)
  }

  function startAdd() {
    setDraft({
      ...blankQuestion(),
      order_index: (Math.max(0, ...questions.map((q) => q.order_index)) || 0) + 1,
    })
    setEditingId('new')
    setMessage(null)
  }

  function startEdit(q) {
    setDraft({
      prompt: q.prompt || '',
      question_type: q.question_type || 'multiple_choice',
      choices: Array.isArray(q.choices) ? q.choices : ['', ''],
      correct_choice: q.correct_choice || '',
      use_for_testimonial: !!q.use_for_testimonial,
      active: q.active !== false,
      order_index: q.order_index,
    })
    setEditingId(q.id)
    setMessage(null)
  }

  function cancel() {
    setEditingId(null)
    setDraft(blankQuestion())
  }

  function updateDraft(field, value) {
    setDraft((prev) => {
      const next = { ...prev, [field]: value }
      // When changing type, clear MC-only fields if switching to essay (and vice versa)
      if (field === 'question_type') {
        if (value === 'essay') {
          next.choices = []
          next.correct_choice = ''
        } else if (value === 'multiple_choice') {
          if (!Array.isArray(next.choices) || next.choices.length < 2) next.choices = ['', '']
          next.use_for_testimonial = false
        }
      }
      return next
    })
  }

  function updateChoice(i, value) {
    setDraft((prev) => {
      const choices = [...(prev.choices || [])]
      choices[i] = value
      return { ...prev, choices }
    })
  }

  function addChoice() {
    setDraft((prev) => ({ ...prev, choices: [...(prev.choices || []), ''] }))
  }

  function removeChoice(i) {
    setDraft((prev) => {
      const choices = (prev.choices || []).filter((_, idx) => idx !== i)
      // If we removed the correct one, clear correct_choice
      const removed = prev.choices?.[i]
      const correct_choice = prev.correct_choice === removed ? '' : prev.correct_choice
      return { ...prev, choices, correct_choice }
    })
  }

  async function save() {
    setMessage(null)
    if (!draft.prompt.trim()) {
      setMessage({ type: 'error', text: 'Question text is required.' })
      return
    }
    if (draft.question_type === 'multiple_choice') {
      const cleanChoices = (draft.choices || []).map((c) => c.trim()).filter(Boolean)
      if (cleanChoices.length < 2) {
        setMessage({ type: 'error', text: 'Multiple choice needs at least 2 answer options.' })
        return
      }
      if (draft.correct_choice && !cleanChoices.includes(draft.correct_choice)) {
        setMessage({ type: 'error', text: 'The correct answer must be one of the options.' })
        return
      }
    }

    setSubmitting(true)
    try {
      const payload = {
        prompt: draft.prompt.trim(),
        question_type: draft.question_type,
        choices:
          draft.question_type === 'multiple_choice'
            ? (draft.choices || []).map((c) => c.trim()).filter(Boolean)
            : null,
        correct_choice:
          draft.question_type === 'multiple_choice' ? draft.correct_choice.trim() || null : null,
        use_for_testimonial: draft.question_type === 'essay' ? !!draft.use_for_testimonial : false,
        active: !!draft.active,
        order_index: draft.order_index ?? 0,
        updated_at: new Date().toISOString(),
      }
      if (editingId === 'new') {
        const { error: err } = await supabase.from('questions').insert(payload)
        if (err) throw err
        setMessage({ type: 'success', text: 'Question added.' })
      } else {
        const { error: err } = await supabase.from('questions').update(payload).eq('id', editingId)
        if (err) throw err
        setMessage({ type: 'success', text: 'Question updated.' })
      }
      cancel()
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(q) {
    if (!confirm(`Delete this question?\n\n"${q.prompt.slice(0, 80)}${q.prompt.length > 80 ? '…' : ''}"\n\nThis can't be undone, but historical test responses keep a snapshot.`)) return
    const { error: err } = await supabase.from('questions').delete().eq('id', q.id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setMessage({ type: 'success', text: 'Question deleted.' })
    load()
  }

  async function toggleActive(q) {
    const { error: err } = await supabase
      .from('questions')
      .update({ active: !q.active, updated_at: new Date().toISOString() })
      .eq('id', q.id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    load()
  }

  async function move(q, direction) {
    const sorted = [...questions].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex((x) => x.id === q.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const other = sorted[swapIdx]
    const a = supabase
      .from('questions')
      .update({ order_index: other.order_index, updated_at: new Date().toISOString() })
      .eq('id', q.id)
    const b = supabase
      .from('questions')
      .update({ order_index: q.order_index, updated_at: new Date().toISOString() })
      .eq('id', other.id)
    await Promise.all([a, b])
    load()
  }

  const active = questions.filter((q) => q.active)
  const inactive = questions.filter((q) => !q.active)
  const mcCount = active.filter((q) => q.question_type === 'multiple_choice').length
  const essayCount = active.filter((q) => q.question_type === 'essay').length
  const testimonialCount = active.filter((q) => q.question_type === 'essay' && q.use_for_testimonial).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">End-of-training questions</h1>
          <p className="mt-2 text-slate-600">
            The bank of multiple-choice and essay questions used by every class's final test.
            Essays marked "Use for testimonials" are surfaced on the testimonials page and website
            feed.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startAdd}
            className="shrink-0 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
          >
            + Add question
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active" value={active.length} />
        <Stat label="Multiple choice" value={mcCount} />
        <Stat label="Essay" value={essayCount} />
        <Stat label="Testimonial-eligible" value={testimonialCount} />
      </div>

      {message && (
        <div
          className={
            message.type === 'success'
              ? 'rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
              : 'rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
          }
        >
          {message.text}
        </div>
      )}

      {editingId !== null && (
        <QuestionForm
          value={draft}
          onChange={updateDraft}
          updateChoice={updateChoice}
          addChoice={addChoice}
          removeChoice={removeChoice}
          onSave={save}
          onCancel={cancel}
          submitting={submitting}
          isNew={editingId === 'new'}
        />
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : questions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">No questions yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Run <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">supabase/seed-questions.sql</code>{' '}
            in the Supabase SQL Editor to load the starter set from Neal's Google Form.
          </p>
        </div>
      ) : (
        <>
          <QuestionList
            title="Active"
            items={active}
            onEdit={startEdit}
            onRemove={remove}
            onToggle={toggleActive}
            onMove={move}
          />
          {inactive.length > 0 && (
            <QuestionList
              title={`Inactive (${inactive.length})`}
              items={inactive}
              onEdit={startEdit}
              onRemove={remove}
              onToggle={toggleActive}
              onMove={move}
              dimmed
            />
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-2xl font-bold text-brand-navy">{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

function QuestionList({ title, items, onEdit, onRemove, onToggle, onMove, dimmed }) {
  return (
    <section>
      <h2 className={`mb-2 text-sm font-semibold uppercase tracking-wide ${dimmed ? 'text-slate-400' : 'text-slate-500'}`}>
        {title}
      </h2>
      <ul className={`divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${dimmed ? 'opacity-60' : ''}`}>
        {items.map((q, i) => (
          <li key={q.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">#{q.order_index}</span>
                  <Tag color={q.question_type === 'essay' ? 'red' : 'navy'}>
                    {q.question_type === 'essay' ? 'Essay' : 'Multiple choice'}
                  </Tag>
                  {q.use_for_testimonial && <Tag color="sky">For website testimonials</Tag>}
                  {!q.active && <Tag color="slate">Inactive</Tag>}
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900">{q.prompt}</p>
                {q.question_type === 'multiple_choice' && (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {(q.choices || []).map((c, ci) => (
                      <li key={ci}>
                        <span className={c === q.correct_choice ? 'font-semibold text-green-700' : ''}>
                          {c === q.correct_choice ? '✓ ' : '• '}
                          {c}
                        </span>
                      </li>
                    ))}
                    {!q.correct_choice && (
                      <li className="italic text-slate-400">No correct answer set (purely informational)</li>
                    )}
                  </ul>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex gap-1">
                  <button
                    onClick={() => onMove(q, 'up')}
                    disabled={i === 0}
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => onMove(q, 'down')}
                    disabled={i === items.length - 1}
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                </div>
                <button
                  onClick={() => onEdit(q)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => onToggle(q)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {q.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => onRemove(q)}
                  className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function QuestionForm({ value, onChange, updateChoice, addChoice, removeChoice, onSave, onCancel, submitting, isNew }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <h2 className="text-lg font-semibold">{isNew ? 'Add question' : 'Edit question'}</h2>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-sm font-medium text-slate-700">
          Question type
          <select
            value={value.question_type}
            onChange={(e) => onChange('question_type', e.target.value)}
            className={inputCls}
          >
            <option value="multiple_choice">Multiple choice</option>
            <option value="essay">Essay (long-form response)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 pb-2">
          <input
            type="checkbox"
            checked={!!value.active}
            onChange={(e) => onChange('active', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy"
          />
          Active (appears in tests)
        </label>
      </div>

      <label className="block text-sm font-medium text-slate-700">
        Question text
        <textarea
          rows={3}
          required
          value={value.prompt}
          onChange={(e) => onChange('prompt', e.target.value)}
          className={inputCls}
          placeholder={
            value.question_type === 'essay'
              ? 'e.g. After Neal Scoppettuolo\'s training, what will you do differently?'
              : 'e.g. What is the purpose of the warm-up?'
          }
        />
        {value.question_type === 'essay' && (
          <p className="mt-1 text-xs text-slate-500">
            For testimonial-eligible questions, write this so it reads well as a public header on
            the website (e.g. include "Neal Scoppettuolo" naturally for SEO).
          </p>
        )}
      </label>

      {value.question_type === 'multiple_choice' && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Answer choices</span>
            <button
              type="button"
              onClick={addChoice}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              + Add choice
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Tick the radio next to the correct one. Leave all unticked for "no correct answer"
            (e.g. opinion/rating questions like the 1-5 scale).
          </p>
          <ul className="mt-2 space-y-2">
            {(value.choices || []).map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct_choice"
                  checked={value.correct_choice === c && c !== ''}
                  onChange={() => onChange('correct_choice', c)}
                  disabled={!c.trim()}
                  className="h-4 w-4 text-green-600 focus:ring-green-500"
                  title="Mark as correct answer"
                />
                <input
                  type="text"
                  value={c}
                  onChange={(e) => updateChoice(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className={inputCls + ' flex-1'}
                />
                {(value.choices || []).length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeChoice(i)}
                    className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {value.question_type === 'essay' && (
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={!!value.use_for_testimonial}
            onChange={(e) => onChange('use_for_testimonial', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy"
          />
          ⭐ Use responses as testimonials on /testimonials and website feed
        </label>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={submitting}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {submitting ? 'Saving…' : isNew ? 'Add question' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

function Tag({ children, color = 'slate' }) {
  const palette = {
    navy: 'bg-sky-100 text-sky-800',
    red: 'bg-red-100 text-red-800',
    sky: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-100 text-slate-700',
  }[color] || 'bg-slate-100 text-slate-700'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette}`}>{children}</span>
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
