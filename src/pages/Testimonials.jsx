import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { FL_REGIONS } from '../lib/locations.js'

export default function Testimonials() {
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [regionFilter, setRegionFilter] = useState('all')
  const [questionFilter, setQuestionFilter] = useState('all')
  const [showEmbed, setShowEmbed] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    // Join test_responses -> test_attempts -> (trainees, classes -> locations)
    const { data, error: err } = await supabase
      .from('test_responses')
      .select(`
        id,
        question_id,
        question_prompt,
        essay_response,
        created_at,
        test_attempts(
          submitted_at,
          trainees(first_name, last_name, years_in_sales),
          classes(region, week_start_date, locations(name))
        )
      `)
      .eq('question_type', 'essay')
      .eq('use_for_testimonial', true)
      .not('essay_response', 'is', null)
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setResponses(data || [])
    setLoading(false)
  }

  // Filter + format for display
  const filtered = useMemo(() => {
    return (responses || []).filter((r) => {
      const region = r.test_attempts?.classes?.region
      if (regionFilter !== 'all' && region !== regionFilter) return false
      if (questionFilter !== 'all' && r.question_id !== questionFilter) return false
      if (!r.essay_response?.trim()) return false
      return true
    })
  }, [responses, regionFilter, questionFilter])

  // Group by question for easier reading
  const byQuestion = useMemo(() => {
    const groups = new Map()
    for (const r of filtered) {
      const key = r.question_prompt
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
    return [...groups.entries()]
  }, [filtered])

  const uniqueQuestions = useMemo(() => {
    const map = new Map()
    for (const r of responses) {
      if (!map.has(r.question_id)) map.set(r.question_id, r.question_prompt)
    }
    return [...map.entries()]
  }, [responses])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Testimonials</h1>
          <p className="mt-2 text-slate-600">
            Every essay response marked "use for testimonials" — grouped by the question asked, so
            you can pull headers and quotes for your website. {filtered.length} response{filtered.length === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          onClick={() => setShowEmbed(true)}
          className="shrink-0 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
        >
          Get embed code for nealscoppettuolo.com →
        </button>
      </div>

      {showEmbed && <EmbedSnippetDialog onClose={() => setShowEmbed(false)} />}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          Region
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className={inputCls + ' min-w-[12rem]'}
          >
            <option value="all">All regions</option>
            {FL_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Question
          <select
            value={questionFilter}
            onChange={(e) => setQuestionFilter(e.target.value)}
            className={inputCls + ' min-w-[20rem]'}
          >
            <option value="all">All questions</option>
            {uniqueQuestions.map(([qid, prompt]) => (
              <option key={qid} value={qid}>{prompt.slice(0, 80)}{prompt.length > 80 ? '…' : ''}</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">No testimonial responses yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Once trainees complete the final test, their essay answers will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {byQuestion.map(([prompt, items]) => (
            <QuestionGroup key={prompt} prompt={prompt} items={items} />
          ))}
        </div>
      )}
    </div>
  )
}

function QuestionGroup({ prompt, items }) {
  return (
    <section>
      <h2 className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-brand-navy">
        ❝ {prompt} ({items.length})
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((r) => (
          <TestimonialCard key={r.id} item={r} />
        ))}
      </div>
    </section>
  )
}

function TestimonialCard({ item }) {
  const [copied, setCopied] = useState(false)
  const attempt = item.test_attempts
  const trainee = attempt?.trainees
  const className = attempt?.classes?.locations?.name || attempt?.classes?.region || ''
  const weekStart = attempt?.classes?.week_start_date
  const displayName = trainee
    ? `${capitalize(trainee.first_name)} ${(trainee.last_name || '').charAt(0).toUpperCase()}.`
    : 'Anonymous'

  async function copy() {
    try {
      await navigator.clipboard.writeText(item.essay_response || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <blockquote className="whitespace-pre-line text-sm italic text-slate-700">
        "{item.essay_response}"
      </blockquote>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="text-xs">
          <div className="font-semibold text-slate-900">{displayName}</div>
          <div className="text-slate-500">
            {trainee?.years_in_sales && <span>{trainee.years_in_sales} · </span>}
            {className}
            {weekStart && ` · ${weekStart}`}
          </div>
        </div>
        <button
          onClick={copy}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? 'Copied!' : 'Copy answer'}
        </button>
      </div>
    </article>
  )
}

function capitalize(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function EmbedSnippetDialog({ onClose }) {
  const feedUrl = `${window.location.origin}/.netlify/functions/testimonials`
  const snippet = `<!-- U.S. Shingle & Metal Training Testimonials Feed -->
<div id="ussm-testimonials" style="display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));"></div>
<script>
(function(){
  fetch('${feedUrl}')
    .then(r => r.json())
    .then(data => {
      var container = document.getElementById('ussm-testimonials');
      if (!container) return;
      var items = data.testimonials || [];
      // Shuffle for content variety on each page load
      for (var i = items.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
      }
      container.innerHTML = items.map(function(t){
        return '<div style="background:#15171a;border-radius:12px;padding:24px;color:#e8e6ed;border:1px solid #2a2e36;">'
          + '<div style="color:#5dd6c7;font-size:12px;letter-spacing:0.05em;font-weight:600;margin-bottom:12px;">★★★★★</div>'
          + '<div style="color:#9aa5b8;font-size:13px;font-style:italic;line-height:1.6;margin-bottom:14px;">' + escapeHtml(t.question) + '</div>'
          + '<blockquote style="margin:0;border-left:3px solid #5dd6c7;padding-left:14px;font-style:italic;line-height:1.6;">"' + escapeHtml(t.answer) + '"</blockquote>'
          + '<div style="margin-top:18px;color:#5dd6c7;font-weight:700;letter-spacing:0.05em;font-size:13px;">'
          + escapeHtml(t.name) + (t.years_in_sales ? '  <span style="display:inline-block;margin-left:8px;background:rgba(93,214,199,0.12);border:1px solid rgba(93,214,199,0.3);border-radius:999px;padding:2px 10px;font-size:11px;font-weight:500;color:#5dd6c7;">' + escapeHtml(t.years_in_sales) + '</span>' : '')
          + '</div>'
          + '</div>';
      }).join('');
      function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
    })
    .catch(function(){
      var c = document.getElementById('ussm-testimonials');
      if (c) c.style.display = 'none';
    });
})();
</script>`

  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-brand-navy">Embed code for nealscoppettuolo.com</h2>
            <p className="mt-1 text-sm text-slate-600">
              Paste this into a <strong>Custom HTML / Embed</strong> section on your GoDaddy
              testimonials page. Testimonials will appear automatically and refresh whenever new
              ones come in — no manual updating.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            ✕ Close
          </button>
        </div>

        <ol className="mt-4 space-y-2 text-sm text-slate-700">
          <li>1. Log into your GoDaddy Website Builder.</li>
          <li>2. Open your testimonials page.</li>
          <li>3. Add a new section → pick <strong>"HTML"</strong> or <strong>"Embed Code"</strong>.</li>
          <li>4. Paste the snippet below.</li>
          <li>5. Publish.</li>
        </ol>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Snippet</span>
          <button
            onClick={copy}
            className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-dark"
          >
            {copied ? 'Copied!' : 'Copy snippet'}
          </button>
        </div>

        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{snippet}</pre>

        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>Note:</strong> The styling above (dark cards, teal accent) is designed to match
          your existing site. If your GoDaddy theme is different, edit the inline styles directly
          in the snippet — or send me a screenshot of the result and I'll tune it.
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
