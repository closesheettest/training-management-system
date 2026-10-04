// LINK PREVIEWS FOR MEETING ROOMS (Neal, 2026-10-04: a pasted /meet link showed
// "training-management-system"; it should say "9:15 Devotional"). Texts, iMessage and
// Facebook read the page's <title> and og: tags WITHOUT running the app, so this puts the
// room's own name, schedule/welcome line and banner picture into the HTML before it's sent.
// Anything that goes wrong just serves the normal page.
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export default async (request, context) => {
  const res = await context.next()
  try {
    const url = new URL(request.url)
    const slug = url.pathname.split('/')[2]
    if (!slug || !(res.headers.get('content-type') || '').includes('text/html')) return res
    const info = await fetch(`${url.origin}/.netlify/functions/meet`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'info', room: slug }),
    }).then((r) => r.json()).catch(() => null)
    const r = info?.ok ? info.room : null
    if (!r) return res
    const title = r.team ? `${r.team} · ${r.title}` : r.title
    const desc = [r.schedule, r.welcome || (r.topic ? `Today: ${r.topic}` : '')].filter(Boolean).join(' · ') || 'Tap to join the meeting.'
    const img = r.banner_url || (r.badge ? `${url.origin}${r.badge}` : '')
    const tags = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(r.look === 'devotional' ? '9:15 Devotional' : 'U.S. Shingle')}" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(desc)}" />`,
      `<meta property="og:url" content="${esc(url.origin + url.pathname)}" />`,
      ...(img ? [`<meta property="og:image" content="${esc(img)}" />`, `<meta name="twitter:card" content="summary_large_image" />`] : []),
    ].join('\n    ')
    const html = (await res.text()).replace(/<title>[^<]*<\/title>/, tags)
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    return new Response(html, { status: res.status, headers })
  } catch {
    return res
  }
}

export const config = { path: '/meet/*' }
