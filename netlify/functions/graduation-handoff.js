// Manager-facing "new rep handoff" page. Texted to a regional manager
// the moment a class graduates (see send-graduation-report.js). Lists
// every new graduate on the manager's team; tapping a name downloads a
// vCard to save the rep to the manager's phone. Up top: a clear
// call-to-action — phone them now, congratulate them, and set up sales
// + inspection ride-alongs.
//
// Usage:
//   GET /.netlify/functions/graduation-handoff?class_id=<uuid>[&zone=Zone+1]
//     → HTML page (mobile-first). When zone is given, only that zone's
//       graduates show (so each manager sees just their own team).
//
// No auth — same admin/manager-only convention as
// download-graduation-report.js; the link is only ever texted to managers.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'

// Zone → team name. Mirrors src/lib/zones.js ZONE_TEAMS (functions can't
// import from src/). Kept in lock-step with _graduation_pdf.js.
const ZONE_TEAMS = { 'Zone 1': 'SQUAD', 'Zone 2': 'SitSold', 'Zone 3': 'SHARKS', 'Zone 4': 'HURRICANE' }
const ZONE_COLORS = {
  'Zone 1': '#E63946', 'Zone 2': '#1D6FB8', 'Zone 3': '#2A9D4A', 'Zone 4': '#F77F00',
}
function teamLabel(zone) {
  if (!zone) return ''
  const team = ZONE_TEAMS[zone]
  return team ? `${team} (${zone})` : zone
}

export const handler = async (event) => {
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return html(500, `<p>Missing env vars: ${missing.join(', ')}</p>`)

  const params = event.queryStringParameters || {}
  const classId = String(params.class_id || '').trim()
  const zoneFilter = String(params.zone || '').trim()
  if (!classId) return html(400, '<p>Missing class_id.</p>')

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: cls, error } = await supabase
    .from('classes')
    .select(`
      id, region, week_start_date, week_end_date,
      trainees!class_id(
        id, first_name, last_name, enrolled, region,
        phone, company_email, email, street_address, city, state, zip,
        test_attempts(submitted_at)
      )
    `)
    .eq('id', classId)
    .maybeSingle()
  if (error) return html(500, `<p>Database error: ${esc(error.message)}</p>`)
  if (!cls) return html(404, '<p>Class not found.</p>')

  // Graduate = enrolled AND submitted the final test. Same filter the
  // report PDF uses, so the manager's list matches the report exactly.
  const allGraduates = (cls.trainees || [])
    .filter((t) => t.enrolled !== false)
    .filter((t) => (t.test_attempts || []).some((a) => a.submitted_at))
    .map((t) => ({ ...t, zone: t.region || cls.region || '' }))

  // zone given → just that team (per-manager text). No zone → all-teams
  // view: every team that has graduates, grouped under its own header.
  let graduates = zoneFilter
    ? allGraduates.filter((t) => t.zone === zoneFilter)
    : allGraduates

  graduates.sort((a, b) =>
    `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`),
  )

  // Per-team view uses that team's color; all-teams view uses brand navy
  // for the hero and gives each team section its own colored header.
  const accent = zoneFilter ? (ZONE_COLORS[zoneFilter] || '#13294b') : '#13294b'
  const team = zoneFilter ? teamLabel(zoneFilter) : ''

  // Group graduates by team, ordered Zone 1..4 (then any stragglers).
  const ZONE_ORDER = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4']
  const byZone = {}
  for (const g of graduates) (byZone[g.zone] = byZone[g.zone] || []).push(g)
  const zonesPresent = Object.keys(byZone).sort((a, b) => {
    const ia = ZONE_ORDER.indexOf(a)
    const ib = ZONE_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  let cards
  if (!graduates.length) {
    cards = `<div class="empty">No new graduates to hand off${zoneFilter ? ' for this team' : ''}.</div>`
  } else if (zoneFilter) {
    cards = graduates.map((t) => repCard(t, accent)).join('')
  } else {
    // All-teams: one colored section per team, e.g. HURRICANE then its
    // graduates' contact cards, then SitSold, etc.
    cards = zonesPresent
      .map((z) => {
        const color = ZONE_COLORS[z] || '#13294b'
        const label = teamLabel(z) || 'Unassigned'
        const n = byZone[z].length
        const sec = byZone[z].map((t) => repCard(t, color)).join('')
        return `<div class="team-section">
          <div class="team-header" style="background:${color}">${esc(label)} · ${n} new rep${n === 1 ? '' : 's'}</div>
          ${sec}
        </div>`
      })
      .join('')
  }

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>New rep handoff${team ? ` — ${esc(team)}` : ''}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f1f5f9; color: #0f172a; -webkit-text-size-adjust: 100%; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 16px; }
  .hero { background: ${accent}; color: #fff; border-radius: 16px; padding: 20px; margin-bottom: 16px; }
  .hero .badge { display: inline-block; background: rgba(255,255,255,0.2); border-radius: 999px;
    padding: 4px 12px; font-size: 12px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; }
  .hero h1 { margin: 0 0 6px; font-size: 24px; line-height: 1.15; }
  .hero p { margin: 0; font-size: 14px; opacity: 0.95; }
  .steps { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px 18px; margin-bottom: 16px; }
  .steps h2 { margin: 0 0 10px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
  .steps ol { margin: 0; padding-left: 20px; }
  .steps li { margin-bottom: 8px; font-size: 15px; line-height: 1.4; }
  .steps li:last-child { margin-bottom: 0; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; margin-bottom: 12px; }
  .card .name { font-size: 20px; font-weight: 800; color: ${accent}; text-decoration: none; display: inline-block; }
  .card .team { font-size: 12px; font-weight: 700; color: #64748b; margin-top: 2px; }
  .card .rows { margin-top: 12px; display: grid; gap: 8px; }
  .card .row { display: flex; gap: 10px; align-items: center; font-size: 14px; }
  .card .row .ic { width: 20px; text-align: center; }
  .card a.link { color: #1d4ed8; text-decoration: none; font-weight: 700; }
  .card .save { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px;
    background: ${accent}; color: #fff; text-decoration: none; font-weight: 800; font-size: 14px;
    padding: 11px 16px; border-radius: 12px; }
  .team-section { margin-bottom: 22px; }
  .team-header { color: #fff; border-radius: 12px; padding: 12px 16px; font-size: 16px; font-weight: 800;
    letter-spacing: 0.02em; text-transform: uppercase; margin-bottom: 12px; }
  .empty { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; color: #64748b; }
  .foot { text-align: center; color: #94a3b8; font-size: 12px; margin: 18px 0 6px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="badge">🎓 New grads${team ? ` · ${esc(team)}` : ''}</div>
      <h1>${graduates.length} new rep${graduates.length === 1 ? '' : 's'}${
        zoneFilter
          ? ' on your team'
          : zonesPresent.length > 1
            ? ` across ${zonesPresent.length} teams`
            : ''
      }</h1>
      <p>They just graduated. Let's get them rolling.</p>
    </div>
    <div class="steps">
      <h2>📞 Do this now</h2>
      <ol>
        <li><strong>Call each rep right away</strong> to congratulate them on graduating.</li>
        <li>Set up a plan to <strong>ride along on sales</strong> with one of your reps.</li>
        <li>Set up a plan to <strong>ride along on inspections</strong> too.</li>
        <li>Tap each name below to <strong>save their contact</strong> to your phone.</li>
      </ol>
    </div>
    ${cards}
    <div class="foot">U.S. Shingle &amp; Metal — Training System</div>
  </div>
</body>
</html>`

  return html(200, body)
}

function repCard(t, accent) {
  const name = `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'New rep'
  const vcardUrl = `/.netlify/functions/graduation-handoff-vcard?trainee_id=${encodeURIComponent(t.id)}`
  const phone = formatPhone(t.phone)
  const phoneRaw = (t.phone || '').replace(/[^\d+]/g, '')
  const addr = formatAddress(t)
  const team = teamLabel(t.zone)
  const rows = []
  if (phone) {
    rows.push(`<div class="row"><span class="ic">📱</span><a class="link" href="tel:${esc(phoneRaw)}">${esc(phone)}</a></div>`)
  }
  if (addr) {
    rows.push(`<div class="row"><span class="ic">📍</span><a class="link" href="https://maps.apple.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noreferrer">${esc(addr)}</a></div>`)
  }
  return `
    <div class="card">
      <a class="name" href="${vcardUrl}">${esc(name)}</a>
      ${team ? `<div class="team">${esc(team)}</div>` : ''}
      <div class="rows">${rows.join('')}</div>
      <a class="save" href="${vcardUrl}">📇 Save to my phone</a>
    </div>`
}

function formatPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return p || ''
}

function formatAddress(t) {
  const line = [t.street_address, t.city, t.state].filter(Boolean).join(', ')
  return [line, t.zip].filter(Boolean).join(' ').trim()
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function html(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  }
}
