// Shared graduation-report PDF builder. Used by:
//   - send-graduation-report.js (auto cron + manual re-send via email)
//   - download-graduation-report.js (manual download workaround
//     when Resend hasn't been domain-verified yet)
//
// The minimal-info roster: graduate count + (Name, Phone, Home
// address). Per user request — no test scores, no company email,
// no days attended.

export function formatDateRange(startIso, endIso) {
  if (!startIso) return ''
  const start = new Date(startIso + 'T12:00:00')
  const end = endIso ? new Date(endIso + 'T12:00:00') : null
  const sFmt = { month: 'short', day: 'numeric' }
  const eFmt = { month: 'short', day: 'numeric', year: 'numeric' }
  if (!end || start.getTime() === end.getTime()) {
    return start.toLocaleDateString('en-US', eFmt)
  }
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', sFmt)} – ${end.getDate()}, ${end.getFullYear()}`
  }
  return `${start.toLocaleDateString('en-US', sFmt)} – ${end.toLocaleDateString('en-US', eFmt)}`
}

export function formatPhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return String(raw)
}

export function formatAddress(street, city, state, zip) {
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [street, cityStateZip].filter(Boolean).join(', ')
}

// Zone → team name. Mirrors src/lib/zones.js ZONE_TEAMS (kept in sync by
// hand — this is a Netlify function and can't import from src/). The team
// is stored on trainees.region as "Zone 1".."Zone 4".
const ZONE_TEAMS = {
  'Zone 1': 'SQUAD',
  'Zone 2': 'SitSold',
  'Zone 3': 'SHARKS',
  'Zone 4': 'HURRICANE',
}

export function teamLabel(zone) {
  if (!zone) return ''
  const team = ZONE_TEAMS[zone]
  return team ? `${team} (${zone})` : zone
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildReportHtml(cls) {
  // "Graduate" = enrolled AND actually submitted the final test.
  // Trainees who were enrolled but no-showed (no test submission) get
  // dropped from the roster — they didn't complete training.
  // Requires the caller's Supabase query to include
  // `test_attempts(submitted_at)` nested under trainees.
  const graduates = (cls.trainees || [])
    .filter((t) => t.enrolled !== false)
    .filter((t) => (t.test_attempts || []).some((a) => a.submitted_at))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
  const locationName = esc(cls.locations?.name || `${cls.region || 'Region'} — TBD`)
  const region = esc(cls.region || '')
  const weekLabel = formatDateRange(cls.week_start_date, cls.week_end_date)
  const totalGraduates = graduates.length

  const rows = graduates
    .map((t, i) => {
      const phone = formatPhone(t.phone)
      const address = formatAddress(t.street_address, t.city, t.state, t.zip)
      const team = teamLabel(t.region)
      return `
        <tr>
          <td style="text-align:center;color:#94a3b8;width:32px;">${i + 1}</td>
          <td><div style="font-weight:600;">${esc(t.first_name)} ${esc(t.last_name)}</div></td>
          <td style="white-space:nowrap;">${team ? esc(team) : '<span style="color:#94a3b8;">—</span>'}</td>
          <td style="white-space:nowrap;">${phone ? esc(phone) : '<span style="color:#94a3b8;">—</span>'}</td>
          <td style="color:#334155;">${esc(address) || '<span style="color:#94a3b8;">—</span>'}</td>
        </tr>
      `
    })
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; }
  h1 { color: #13294b; font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #475569; font-size: 13px; margin: 0 0 16px; }
  .stripe { height: 4px; background: #b8324f; margin: 0 0 16px; }
  .headcount { display: inline-block; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 16px; background: #f8fafc; margin: 0 0 16px; }
  .headcount .num { font-size: 28px; font-weight: 700; color: #13294b; }
  .headcount .lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #13294b; color: white; text-align: left; padding: 8px 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 18px; color: #94a3b8; font-size: 10px; }
</style>
</head>
<body>
  <div class="stripe"></div>
  <h1>Graduating class — ${region}</h1>
  <p class="subtitle">${locationName} · Week of ${esc(weekLabel)}</p>

  <div class="headcount">
    <span class="num">${totalGraduates}</span><span class="lbl">graduate${totalGraduates === 1 ? '' : 's'}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center;width:32px;">#</th>
        <th style="width:26%;">Name</th>
        <th style="width:18%;">Team</th>
        <th style="width:20%;">Phone</th>
        <th>Home address</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px;">No enrolled trainees</td></tr>'}</tbody>
  </table>

  <p class="footer">Generated ${new Date().toLocaleString('en-US')} · U.S. Shingle &amp; Metal Training System</p>
</body></html>`
}

export async function renderPdf(html) {
  const key = process.env.PDFSHIFT_API_KEY
  if (!key) return { ok: false, error: 'PDFSHIFT_API_KEY not set' }
  try {
    const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`api:${key}`).toString('base64'),
      },
      body: JSON.stringify({ source: html, format: 'Letter' }),
    })
    if (!res.ok) {
      const err = await res.text()
      return { ok: false, error: `PDFShift ${res.status}: ${err.slice(0, 300)}` }
    }
    const buf = await res.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    if (!base64.startsWith('JVBERi')) {
      return { ok: false, error: 'PDFShift returned non-PDF content' }
    }
    return { ok: true, base64 }
  } catch (err) {
    return { ok: false, error: err.message || 'Unknown' }
  }
}

export function filenameFor(cls) {
  const slug = (cls.region || 'class').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `graduating-class-${slug}-${cls.week_start_date}.pdf`
}
