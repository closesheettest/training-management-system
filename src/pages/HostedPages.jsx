import { useMemo, useState } from 'react'
import { HOSTED_PAGES, CATEGORIES } from '../lib/hosted_pages.js'

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

export default function HostedPages() {
  const [copiedSlug, setCopiedSlug] = useState(null)
  const [query, setQuery] = useState('')

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
      list.sort((a, b) => (b.created || '').localeCompare(a.created || ''))
      out.push({ category: cat, items: list })
    }
    return out
  }, [filtered])

  const totalCount = HOSTED_PAGES.length
  const filteredCount = filtered.length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Hosted pages</h1>
        <p className="mt-2 text-slate-600">
          Standalone HTML pages we've published — typically one-off resource
          pages texted to trainees (sales pitches with downloadable docs) or
          single-page internal docs. Grouped by training day + use case so
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
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-brand-navy hover:text-brand-navy"
            >
              {g.category} <span className="ml-1 text-slate-400">({g.items.length})</span>
            </a>
          ))}
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
          className="space-y-3"
        >
          <div className="flex items-baseline gap-3 border-b border-slate-200 pb-2">
            <h2 className="text-xl font-semibold text-slate-900">{g.category}</h2>
            <span className="text-sm text-slate-500">
              {g.items.length} page{g.items.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="space-y-3">
            {g.items.map((p) => {
              const full = siteOrigin() + p.url
              const copied = copiedSlug === p.slug
              return (
                <li
                  key={p.slug}
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
                </li>
              )
            })}
          </ul>
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
