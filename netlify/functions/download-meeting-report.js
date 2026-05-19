// Builds a PDF report for an attendance-only company meeting,
// breaking the roster into four buckets:
//   ✅ Attended & updated info
//   ⚠️ Attended but still needs to update
//   👻 Did not attend, already updated
//   ❌ Did not attend & still needs to update
//
// Triggered by the "📄 Download meeting report PDF" button on
// the MeetingReportCard in Class detail. Used after admin closes
// sign-ins so the snapshot is fresh.
//
// Usage: POST /.netlify/functions/download-meeting-report
//        Body: { class_id: "<uuid>", attendance_date?: "YYYY-MM-DD" }
//        - attendance_date defaults to the class's week_start_date
//          (single-day meetings).
//
// Returns PDF bytes with Content-Disposition for browser download.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, PDFSHIFT_API_KEY.

import { createClient } from '@supabase/supabase-js'
import { renderPdf, formatPhone } from './_graduation_pdf.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return text(405, 'Method Not Allowed')

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'PDFSHIFT_API_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return text(500, `Missing env vars: ${missing.join(', ')}`)

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return text(400, 'Invalid JSON body')
  }
  const classId = body.class_id
  if (!classId) return text(400, 'class_id required')

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: cls, error: cErr } = await supabase
    .from('classes')
    .select(`
      id, region, week_start_date, week_end_date, attendance_only,
      locations(name),
      trainees(
        id, first_name, last_name, phone, enrolled, declined_at,
        info_updated_at, region
      )
    `)
    .eq('id', classId)
    .maybeSingle()
  if (cErr) return text(500, `Supabase: ${cErr.message}`)
  if (!cls) return text(404, 'Class not found')

  const attendanceDate = body.attendance_date || cls.week_start_date
  if (!attendanceDate) return text(400, 'attendance_date required (or class needs week_start_date)')

  // Attendance for this class on the requested date.
  const { data: att, error: aErr } = await supabase
    .from('attendance')
    .select('trainee_id, confirmed')
    .eq('class_id', classId)
    .eq('attendance_date', attendanceDate)
  if (aErr) return text(500, `Supabase attendance: ${aErr.message}`)

  const confirmedIds = new Set(
    (att || []).filter((a) => a.confirmed).map((a) => a.trainee_id),
  )

  // Bucket each trainee. Exclude declined / unenrolled — they weren't
  // supposed to be at the meeting anyway.
  const buckets = {
    attendedUpdated: [],
    attendedNotUpdated: [],
    noShowUpdated: [],
    noShowNotUpdated: [],
  }
  const enrolledRoster = (cls.trainees || [])
    .filter((t) => t.enrolled !== false && !t.declined_at)
    .sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`),
    )
  for (const t of enrolledRoster) {
    const attended = confirmedIds.has(t.id)
    const updated = !!t.info_updated_at
    if (attended && updated) buckets.attendedUpdated.push(t)
    else if (attended && !updated) buckets.attendedNotUpdated.push(t)
    else if (!attended && updated) buckets.noShowUpdated.push(t)
    else buckets.noShowNotUpdated.push(t)
  }

  const html = buildMeetingHtml(cls, attendanceDate, buckets, enrolledRoster.length)
  const pdfRes = await renderPdf(html)
  if (!pdfRes.ok) return text(500, `PDF render failed: ${pdfRes.error}`)

  const filename = filenameFor(cls, attendanceDate)
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
    body: pdfRes.base64,
    isBase64Encoded: true,
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// Florida regions in display order. Reps without a region land under
// a "Region not set yet" bucket at the bottom — usually CSV imports
// that haven't filled in /update-info.
const REGION_ORDER = ['St Pete', 'Jacksonville', 'Orlando', 'Miami']
const NO_REGION = '— Region not set yet —'

function groupByRegion(trainees) {
  const map = new Map()
  // Pre-seed in display order so we render St Pete first, then Jax, etc.
  for (const r of REGION_ORDER) map.set(r, [])
  for (const t of trainees) {
    const r = t.region && REGION_ORDER.includes(t.region) ? t.region : NO_REGION
    if (!map.has(r)) map.set(r, [])
    map.get(r).push(t)
  }
  // Drop empty regions for a tighter PDF. Sort within each region
  // alphabetically by last name + first name.
  const out = []
  for (const [region, list] of map.entries()) {
    if (list.length === 0) continue
    const sorted = [...list].sort((a, b) =>
      `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(
        `${b.last_name || ''} ${b.first_name || ''}`,
      ),
    )
    out.push({ region, trainees: sorted })
  }
  return out
}

function renderBucket({ title, color, trainees, showPhone, note }) {
  const grouped = groupByRegion(trainees)
  const sections = grouped.length
    ? grouped
        .map((g) => {
          const rows = g.trainees
            .map((t, i) => {
              const phone = showPhone ? formatPhone(t.phone) : ''
              return `
                <tr>
                  <td style="text-align:center;color:#94a3b8;width:32px;">${i + 1}</td>
                  <td><div style="font-weight:600;">${esc(t.first_name)} ${esc(t.last_name)}</div></td>
                  ${
                    showPhone
                      ? `<td style="white-space:nowrap;">${phone ? esc(phone) : '<span style="color:#94a3b8;">—</span>'}</td>`
                      : ''
                  }
                </tr>`
            })
            .join('')
          const isUnknown = g.region === NO_REGION
          const regionLabel = isUnknown
            ? esc(g.region)
            : `📍 ${esc(g.region)}`
          return `
            <div style="margin-top:14px;">
              <div style="font-size:12px;font-weight:700;color:${isUnknown ? '#92400e' : '#334155'};margin:0 0 4px;text-transform:uppercase;letter-spacing:0.04em;font-family:-apple-system,sans-serif;">
                ${regionLabel} <span style="color:#64748b;font-weight:500;text-transform:none;letter-spacing:0;">(${g.trainees.length})</span>
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <thead>
                  <tr>
                    <th style="text-align:center;width:32px;background:#13294b;color:white;padding:5px;text-transform:uppercase;font-size:10px;letter-spacing:0.04em;">#</th>
                    <th style="text-align:left;background:#13294b;color:white;padding:5px 10px;text-transform:uppercase;font-size:10px;letter-spacing:0.04em;">Name</th>
                    ${showPhone ? `<th style="text-align:left;background:#13294b;color:white;padding:5px 10px;text-transform:uppercase;font-size:10px;letter-spacing:0.04em;width:30%;">Phone</th>` : ''}
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `
        })
        .join('')
    : `<div style="text-align:center;color:#94a3b8;padding:14px;font-size:11px;">— none —</div>`
  return `
    <section style="margin-top:20px;">
      <h2 style="font-size:14px;color:${color};margin:0 0 4px;">${esc(title)} <span style="color:#64748b;font-weight:500;">(${trainees.length})</span></h2>
      ${note ? `<p style="font-size:11px;color:#475569;margin:0 0 8px;">${esc(note)}</p>` : ''}
      ${sections}
    </section>
  `
}

function buildMeetingHtml(cls, attendanceDate, buckets, total) {
  const locationName = esc(cls.locations?.name || `${cls.region || 'Region'} — TBD`)
  const region = esc(cls.region || '')
  const dateLabel = formatDate(attendanceDate)

  const attended = buckets.attendedUpdated.length + buckets.attendedNotUpdated.length
  const noShow = buckets.noShowUpdated.length + buckets.noShowNotUpdated.length

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; }
  h1 { color: #13294b; font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #475569; font-size: 13px; margin: 0 0 16px; }
  .stripe { height: 4px; background: #b8324f; margin: 0 0 16px; }
  .summary { display: flex; gap: 10px; margin: 0 0 12px; flex-wrap: wrap; }
  .stat { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 16px; background: #f8fafc; flex: 1; min-width: 140px; }
  .stat .num { font-size: 22px; font-weight: 700; color: #13294b; display: block; }
  .stat .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  .footer { margin-top: 18px; color: #94a3b8; font-size: 10px; }
</style>
</head>
<body>
  <div class="stripe"></div>
  <h1>Meeting attendance &amp; info-update report</h1>
  <p class="subtitle">${region ? region + ' · ' : ''}${locationName} · ${esc(dateLabel)}</p>

  <div class="summary">
    <div class="stat"><span class="num">${total}</span><span class="lbl">Enrolled</span></div>
    <div class="stat"><span class="num">${attended}</span><span class="lbl">Attended</span></div>
    <div class="stat"><span class="num">${noShow}</span><span class="lbl">Did not attend</span></div>
    <div class="stat"><span class="num">${buckets.attendedUpdated.length + buckets.noShowUpdated.length}</span><span class="lbl">Info updated</span></div>
    <div class="stat"><span class="num">${buckets.attendedNotUpdated.length + buckets.noShowNotUpdated.length}</span><span class="lbl">Info missing</span></div>
  </div>

  ${renderBucket({
    title: '✅ Attended & updated info',
    color: '#15803d',
    trainees: buckets.attendedUpdated,
    showPhone: false,
  })}
  ${renderBucket({
    title: '⚠️ Attended but still needs to update info',
    color: '#b45309',
    trainees: buckets.attendedNotUpdated,
    showPhone: true,
    note: 'Action: send these reps the /update-info link so they fill it in while at the meeting.',
  })}
  ${renderBucket({
    title: '👻 Did not attend (but info already updated)',
    color: '#475569',
    trainees: buckets.noShowUpdated,
    showPhone: true,
  })}
  ${renderBucket({
    title: '❌ Did not attend & still needs to update info',
    color: '#b91c1c',
    trainees: buckets.noShowNotUpdated,
    showPhone: true,
    note: 'Action: include in the next group "update info" blast.',
  })}

  <p class="footer">Generated ${new Date().toLocaleString('en-US')} · U.S. Shingle &amp; Metal Training System</p>
</body></html>`
}

function filenameFor(cls, attendanceDate) {
  const slug = (cls.region || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `meeting-report-${slug}-${attendanceDate}.pdf`
}

function text(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  }
}
