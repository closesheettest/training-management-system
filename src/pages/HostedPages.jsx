import { Fragment, useMemo, useState } from 'react'
import { HOSTED_PAGES, CATEGORIES, WEEKS } from '../lib/hosted_pages.js'

// /hosted-pages — directory of every standalone HTML page we've shipped
// in public/. Each one has a "hidden URL" (not linked from main nav)
// that Neal hands out via SMS, so this page exists so the link doesn't
// get lost in a text thread.
//
// Layout: sectioned by category (Day 1 / Day 2 / Day 3 / Training
// overview / Trainee-facing / Internal admin) with a fuzzy search box
// at the top that filters in-place. Sticky jump-nav lets admin scroll
// to a section in one tap.
//
// Add new entries by editing src/lib/hosted_pages.js. Pick the most
// specific category — CATEGORIES export there is the canonical list.

const SECTION_TONE = {
  Presentations: { border: 'border-sky-300', head: 'bg-sky-50', week: 'bg-sky-100 text-sky-900' },
  Homework: { border: 'border-amber-300', head: 'bg-amber-50', week: 'bg-amber-100 text-amber-900' },
}

export default function HostedPages() {
  const [copiedSlug, setCopiedSlug] = useState(null)
  const [query, setQuery] = useState('')
  // COLLAPSIBLE SECTIONS (Neal, 2026-09-27: "the hosted page is getting very long").
  // Closed by default; which ones are open is remembered on this browser. A
  // search opens everything so no match is hidden.
  const [openCats, setOpenCats] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('hosted_pages_open') || '[]')) } catch { return new Set() }
  })
  const saveOpen = (next) => { setOpenCats(next); try { localStorage.setItem('hosted_pages_open', JSON.stringify([...next])) } catch { /* private mode */ } }
  const toggleCat = (c) => { const n = new Set(openCats); n.has(c) ? n.delete(c) : n.add(c); saveOpen(n) }
  const isOpen = (c) => !!query.trim() || openCats.has(c)

  function siteOrigin() {
    if (typeof window === 'undefined') return ''
    return window.location.origin
  }

  async function copyLink(slug, url) {
    const full = siteOrigin() + url
    try {
      await navigator.clipboard.writeText(full)
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug((s) => (s === slug ? null : s)), 1500)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = full
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopiedSlug(slug)
        setTimeout(() => setCopiedSlug((s) => (s === slug ? null : s)), 1500)
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  // Filter by case-insensitive substring across title + description + url
  // so admin can search "go-back" or "products" and hit relevant pages
  // regardless of which day they belong to.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return HOSTED_PAGES
    return HOSTED_PAGES.filter((p) => {
      const hay = `${p.title} ${p.description} ${p.url} ${p.category}`.toLowerCase()
      return hay.includes(q)
    })
  }, [query])

  // Group by category, preserving the canonical order from CATEGORIES.
  // Within each group, sort by `created` desc (newest first).
  // Pages with an unknown category fall into "Other".
  const groups = useMemo(() => {
    const byCat = new Map()
    for (const cat of CATEGORIES) byCat.set(cat, [])
    byCat.set('Other', [])
    for (const p of filtered) {
      const bucket = byCat.has(p.category) ? p.category : 'Other'
      byCat.get(bucket).push(p)
    }
    // Sort within each group, drop empty groups.
    const out = []
    for (const [cat, list] of byCat) {
      if (list.length === 0) continue
      // Week-organized sections (Presentations, Homework): by week, then day.
      // Everything else: newest first, as before.
      if (list.some((p) => p.week)) {
        const wk = (p) => { const i = WEEKS.indexOf(p.week); return i < 0 ? 99 : i }
        list.sort((a, b) => wk(a) - wk(b) || (a.order ?? 99) - (b.order ?? 99))
        // A week with nothing in it yet still shows, so the layout reads the same
        // in every section ("Week B · nothing here yet").
        if (!query.trim()) for (const w of WEEKS) if (!list.some((p) => p.week === w)) list.push({ placeholder: true, week: w, slug: `none-${cat}-${w}` })
        list.sort((a, b) => wk(a) - wk(b) || (a.order ?? 99) - (b.order ?? 99))
      } else {
        list.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
      }
      out.push({ category: cat, items: list })
    }
    return out
  }, [filtered, query])

  const totalCount = HOSTED_PAGES.length
  const filteredCount = filtered.length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Hosted pages</h1>
        <p className="mt-2 text-slate-600">
          Standalone HTML pages we've published — typically one-off resource
          pages texted to trainees (sales pitches with downloadable docs) or
          single-page internal docs. Presentations and homework are grouped by week (A, then B) and day, so
          the right link is one scroll away.
        </p>
      </header>

      {/* Search bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="hosted-search" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Search
        </label>
        <input
          id="hosted-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to filter — title, description, or URL…"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy"
          autoComplete="off"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            {query
              ? `Showing ${filteredCount} of ${totalCount} page${totalCount === 1 ? '' : 's'}`
              : `${totalCount} page${totalCount === 1 ? '' : 's'} total`}
          </span>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="font-medium text-sky-700 hover:text-sky-900"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Jump-nav chips — sticky-ish, click to scroll to a section. Hidden
          when filtering since groups may collapse out. */}
      {!query && groups.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <a
              key={g.category}
              href={`#group-${slugify(g.category)}`}
              onClick={() => { if (!openCats.has(g.category)) toggleCat(g.category) }}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-brand-navy hover:text-brand-navy"
            >
              {g.category} <span className="ml-1 text-slate-400">({g.items.filter((x) => !x.placeholder).length})</span>
            </a>
          ))}
          <button type="button" onClick={() => saveOpen(new Set(groups.map((g) => g.category)))}
            className="rounded-full px-3 py-1 text-xs font-semibold text-sky-700 underline">Expand all</button>
          <button type="button" onClick={() => saveOpen(new Set())}
            className="rounded-full px-3 py-1 text-xs font-semibold text-sky-700 underline">Collapse all</button>
        </nav>
      )}

      {/* No results */}
      {filteredCount === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          No pages match "<strong>{query}</strong>". Try a shorter term, or{' '}
          <button
            type="button"
            onClick={() => setQuery('')}
            className="font-semibold text-sky-700 underline hover:text-sky-900"
          >
            clear the search
          </button>
          .
        </div>
      )}

      {/* Grouped list */}
      {groups.map((g) => (
        <section
          key={g.category}
          id={`group-${slugify(g.category)}`}
          className={`overflow-hidden rounded-xl border-2 ${SECTION_TONE[g.category]?.border || 'border-slate-200'} bg-white`}
        >
          {/* Each section is its own box with its own colour, so Presentations
              and Homework never read as one list (Neal, 2026-09-27). */}
          <button type="button" onClick={() => toggleCat(g.category)}
            className={`flex w-full items-baseline gap-3 px-4 py-3 text-left ${SECTION_TONE[g.category]?.head || 'bg-slate-50'}`}>
            <span className="w-4 text-slate-500">{isOpen(g.category) ? '▾' : '▸'}</span>
            <h2 className="text-xl font-semibold text-slate-900">{g.category}</h2>
            <span className="text-sm text-slate-500">
              {g.items.filter((x) => !x.placeholder).length} page{g.items.filter((x) => !x.placeholder).length === 1 ? '' : 's'}
            </span>
          </button>
          {isOpen(g.category) && <ul className="space-y-3 p-4">
            {g.items.map((p, idx) => {
              const weekHead = p.week && (idx === 0 || g.items[idx - 1].week !== p.week)
                ? <li key={`h-${p.week}`} className={`${idx ? 'mt-5' : ''} rounded-md px-3 py-1.5 text-sm font-extrabold uppercase tracking-wide ${SECTION_TONE[g.category]?.week || 'bg-slate-100 text-slate-700'}`}>{p.week}</li> : null
              if (p.placeholder) return <Fragment key={p.slug}>{weekHead}<li className="text-sm text-slate-400">Nothing here yet.</li></Fragment>
              const full = siteOrigin() + p.url
              const copied = copiedSlug === p.slug
              return (
                <Fragment key={p.slug}>{weekHead}<li
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold text-slate-900">{p.title}</h3>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block break-all font-mono text-xs text-sky-700 underline hover:text-sky-900"
                      >
                        {full}
                      </a>
                      <p className="mt-2 text-sm text-slate-600">{p.description}</p>
                      <p className="mt-2 text-xs text-slate-400">Created {p.created}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-brand-navy bg-white px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-50"
                      >
                        Open ↗
                      </a>
                      <button
                        type="button"
                        onClick={() => copyLink(p.slug, p.url)}
                        className={
                          'rounded-md px-3 py-2 text-sm font-semibold ' +
                          (copied
                            ? 'bg-emerald-600 text-white'
                            : 'bg-brand-navy text-white hover:bg-slate-800')
                        }
                      >
                        {copied ? '✓ Copied!' : 'Copy link'}
                      </button>
                    </div>
                  </div>
                </li></Fragment>
              )
            })}
          </ul>}
        </section>
      ))}

      <p className="pt-4 text-xs text-slate-400">
        Need a new page? Ask Claude to build it in <code>public/</code> and add
        a row in <code>src/lib/hosted_pages.js</code> with one of the canonical
        categories ({CATEGORIES.join(' · ')}).
      </p>
    </div>
  )
}

// Slugify category for use as anchor IDs. "Trainee-facing (post-grad)"
// becomes "trainee-facing-post-grad". Strips parens + lowercases +
// collapses non-alphanumerics to dashes.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
