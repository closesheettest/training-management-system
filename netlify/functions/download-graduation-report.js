// Returns the graduation-report PDF as a binary download for a given
// class. Same PDF body as the auto/manual emailed report, just delivered
// to the admin's browser instead of via Resend.
//
// Useful as a workaround when Resend hasn't been domain-verified yet
// (testing mode = "You can only send testing emails to your own
// email address"). Admin downloads, attaches to a regular email, sends
// manually.
//
// Usage: POST /.netlify/functions/download-graduation-report
//        Body: { class_id: "<uuid>" }
// Response: PDF bytes with Content-Type: application/pdf and a
// Content-Disposition that prompts the browser to save with the
// "graduating-class-<region>-<date>.pdf" filename.
//
// No auth — admin-only triggers, same convention as other manual
// admin buttons in this app.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, PDFSHIFT_API_KEY.

import { createClient } from '@supabase/supabase-js'
import { buildReportHtml, renderPdf, filenameFor } from './_graduation_pdf.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return text(405, 'Method Not Allowed')
  }

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

  const { data: cls, error } = await supabase
    .from('classes')
    .select(`
      id, region, week_start_date, week_end_date,
      locations(name, street_address, city, state, zip),
      trainees(
        id, first_name, last_name, enrolled,
        phone, street_address, city, state, zip,
        test_attempts(submitted_at)
      )
    `)
    .eq('id', classId)
    .maybeSingle()
  if (error) return text(500, `Supabase: ${error.message}`)
  if (!cls) return text(404, 'Class not found')

  const html = buildReportHtml(cls)
  const pdfRes = await renderPdf(html)
  if (!pdfRes.ok) {
    return text(500, `PDF render failed: ${pdfRes.error}`)
  }

  const filename = filenameFor(cls)
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

function text(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  }
}
