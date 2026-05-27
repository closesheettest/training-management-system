import { useState } from 'react'
import { HOSTED_PAGES } from '../lib/hosted_pages.js'

// /hosted-pages — directory of every standalone HTML page we've shipped
// in public/. Each one has a "hidden URL" (not linked from main nav)
// that Neal hands out via SMS, so this page exists so the link doesn't
// get lost in a text thread.
//
// Add new entries by editing src/lib/hosted_pages.js — keep newest first.

export default function HostedPages() {
  // Per-row toast: after clicking "Copy link", show "Copied!" for 1.5s
  // on that specific card so multiple Copy buttons don't interfere.
  const [copiedSlug, setCopiedSlug] = useState(null)

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
      // Older browsers: fall back to a tiny textarea trick
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Hosted pages</h1>
        <p className="mt-2 text-slate-600">
          Standalone HTML pages we've published — typically one-off resource
          pages texted to trainees (sales pitches with downloadable docs) or
          single-page internal docs. They live at "hidden" URLs that aren't
          linked from main nav, so this page is the catalog so they don't get lost.
        </p>
      </header>

      <ul className="space-y-3">
        {HOSTED_PAGES.map((p) => {
          const full = siteOrigin() + p.url
          const copied = copiedSlug === p.slug
          return (
            <li
              key={p.slug}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{p.title}</h2>
                    <CategoryChip value={p.category} />
                  </div>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block break-all font-mono text-xs text-sky-700 underline hover:text-sky-900"
                  >
                    {full}
                  </a>
                  <p className="mt-2 text-sm text-slate-600">{p.description}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Created {p.created}
                  </p>
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

      <p className="text-xs text-slate-400">
        Need a new page? Ask Claude to build it in <code>public/</code> and add
        a row here. Source list lives at <code>src/lib/hosted_pages.js</code>.
      </p>
    </div>
  )
}

function CategoryChip({ value }) {
  const palette =
    value === 'Sales resources'
      ? 'bg-emerald-100 text-emerald-800'
      : value === 'Internal docs'
        ? 'bg-sky-100 text-sky-800'
        : value === 'Public form'
          ? 'bg-violet-100 text-violet-800'
          : 'bg-slate-100 text-slate-700'
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
        palette
      }
    >
      {value}
    </span>
  )
}
