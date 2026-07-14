// Netlify Function: no-show / dropout detection + auto-unenroll.
//
// Cron schedule: every 30 min from 14:00 to 22:30 UTC (see
// netlify.toml). The function self-gates to the 10:30 AM – 5:30 PM
// ET window via withinTrainingDayWindowET() — fires outside that
// window are no-ops. Net effect: detection runs every 30 min from
// 10:30 AM to 5:30 PM Eastern, year-round, DST-safe.
//
// Why every 30 min instead of once daily: the first fire at 10:30 AM
// catches everyone who didn't show in the morning, but subsequent
// fires reconcile late attendance corrections (e.g. kiosk was down,
// Neal entered an attendance row manually at noon) and catch any
// trainee whose attendance got recorded after the morning sweep.
//
// For every enrolled, provisioned trainee in a class that's currently
// active:
//   - If today has NO confirmed attendance for them AND
//     they haven't been dropout-notified yet
//   → they're flagged as a dropout.
//
// EXCEPTION: Day 1 of every class is the short noon → 4 PM day. The
// 10:30 AM cron-window gate is too early for those trainees — they
// haven't even arrived yet. So on a trainee's Day 1, the dropout filter
// skips them until 12:30 PM ET (noon + 30-min grace). Day 2+ uses the
// original 10:30 AM gate. Applies whether the class started Monday or
// Tuesday (both have noon Day-1 schedule). Without this guard, the
// 10:30 AM Monday cron flagged the entire roster as no-shows and
// unenrolled them, which made the kiosk go empty mid-morning.
//
// On flag, we do TWO things:
//   1. Auto-unenroll them: set enrolled=false, unenrolled_at=now,
//      unenrolled_reason='No-show on Day N'. This drops the /progress
//      "Registered" count in real-time (e.g. 12 → 9 when 3 no-show).
//   2. Notify IT and HR via SMS/email so accounts get cleaned up:
//        * 'trainee_dropout_delete_email' → IT (delete Google Workspace email)
//        * 'trainee_dropout_delete_apps'  → HR (remove from RepCard/JobNimbus/Sales Academy)
//
// Each trainee's dropout_notified_at is stamped so the same name won't
// appear in a future day's report.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET. Optional: RESEND_API_KEY, EMAIL_FROM.
//
// GET auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.
// POST: { class_id, date? } — fires for one class immediately, no secret
//   required (admin UI is implicit auth). Used by the trainer's "Send
//   credentials" button so the no-show fan-out fires the same day they
//   close out the class.
// Query params: ?dry_run=1, ?date=YYYY-MM-DD (override today, for testing).

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'
import { isLateStartDate } from './_late-start.js'

export const handler = async (event) => {
  const isPost = event.httpMethod === 'POST'

  if (!isPost) {
    const provided =
      event.headers['x-cron-secret'] ||
      event.headers['X-Cron-Secret'] ||
      event.queryStringParameters?.secret
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return json(401, { error: 'Unauthorized' })
    }

    // Self-gate to the 10:30 AM – 5:30 PM ET window so cron fires
    // BEFORE the grace period (e.g. 14:00 UTC = 10:00 EDT) are no-ops.
    // This is what makes the multi-fire schedule safe: training starts
    // at 10 AM, we don't flag anyone before 10:30 AM ET. Bypassed for
    // POST (admin button) and for the ?force=1 query param.
    const forced = event.queryStringParameters?.force === '1'
    if (!forced) {
      const gate = withinTrainingDayWindowET()
      if (!gate.inside) {
        return json(200, {
          skipped: true,
          reason: 'outside 10:30 AM – 5:30 PM ET training-day window',
          et_time: gate.et_time,
        })
      }
    }
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'
  const diagnose = params.diagnose || null  // e.g. ?diagnose=irina returns status of every trainee matching "irina"
  const repair = params.repair === '1' || params.repair === 'true'  // one-shot repair for trainees stuck in half-processed state

  let targetClassId = null
  let postDate = null
  if (isPost) {
    try {
      const body = JSON.parse(event.body || '{}')
      targetClassId = body.class_id || null
      postDate = body.date || null
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }
    if (!targetClassId) return json(400, { error: 'class_id required for POST' })
  }

  const today = params.date || postDate || computeFloridaToday()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // ─────────────────────────────────────────────────────────────
  // Diagnostic mode: ?diagnose=<name>
  // Returns the FULL state of every trainee whose first or last
  // name matches the substring (case-insensitive). No filtering on
  // enrolled, dropout_notified_at, or class window — shows
  // everything so we can see WHY a trainee was or wasn't picked up
  // as a no-show.
  if (diagnose) {
    const pattern = `%${diagnose.replace(/[%_]/g, '')}%`
    const { data: rows, error } = await supabase
      .from('trainees')
      .select(`
        id, first_name, last_name, company_email, enrolled,
        registered, declined_at, unenrolled_at, unenrolled_reason,
        dropout_notified_at, class_id,
        classes!class_id(id, region, week_start_date, week_end_date, locations(name)),
        attendance(attendance_date, confirmed)
      `)
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
    if (error) return json(500, { error: `Supabase: ${error.message}` })

    const report = (rows || []).map((t) => {
      const c = t.classes
      const todayAtt = (t.attendance || []).find((a) => a.attendance_date === today)
      const reasons = []
      if (t.enrolled === false) reasons.push(`enrolled=false (unenrolled_at=${t.unenrolled_at}, reason=${t.unenrolled_reason})`)
      if (t.declined_at) reasons.push(`declined_at=${t.declined_at}`)
      if (t.dropout_notified_at) reasons.push(`dropout_notified_at=${t.dropout_notified_at}`)
      if (!c) reasons.push('no class assigned')
      else {
        if (today < c.week_start_date) reasons.push(`class hasn't started (week_start_date=${c.week_start_date})`)
        if (today > c.week_end_date) reasons.push(`class already ended (week_end_date=${c.week_end_date})`)
      }
      if (todayAtt?.confirmed) reasons.push(`attended today (confirmed=true on ${today})`)
      else if (todayAtt) reasons.push(`attendance row exists for today but confirmed=${todayAtt.confirmed}`)
      const wouldFlagAsDropout =
        t.enrolled === true &&
        !t.dropout_notified_at &&
        c &&
        today >= c.week_start_date &&
        today <= c.week_end_date &&
        !(todayAtt?.confirmed)
      return {
        name: `${t.first_name} ${t.last_name}`,
        id: t.id,
        enrolled: t.enrolled,
        registered: t.registered,
        company_email: t.company_email,
        class: c ? `${c.region} ${c.week_start_date} – ${c.week_end_date} @ ${c.locations?.name || 'no location'}` : null,
        today_attendance: todayAtt || null,
        would_flag_as_dropout: wouldFlagAsDropout,
        notes: reasons.length ? reasons : ['—'],
      }
    })

    return json(200, { target_date: today, query: diagnose, matched: report.length, trainees: report })
  }
  // ─────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────
  // Repair mode: ?repair=1
  // One-shot cleanup for trainees stuck in a half-processed state:
  // dropout_notified_at IS NOT NULL (an earlier cron flagged them)
  // but enrolled IS STILL true (the auto-unenroll commit hadn't
  // deployed yet when that cron fired). Flips enrolled=false on
  // those trainees so the /progress count drops correctly. Does NOT
  // re-send IT/HR alerts (they were already sent the first time).
  if (repair) {
    const { data: stuck, error } = await supabase
      .from('trainees')
      .select(`
        id, first_name, last_name, company_email, class_id,
        dropout_notified_at,
        classes!class_id(id, region, week_start_date, week_end_date)
      `)
      .eq('enrolled', true)
      .not('dropout_notified_at', 'is', null)
    if (error) return json(500, { error: `Supabase: ${error.message}` })

    // Normalize t.classes — PostgREST sometimes returns embedded
    // relations as an array even for many-to-one foreign keys. Pull
    // the first element if it's an array.
    function cls(t) {
      if (!t.classes) return null
      return Array.isArray(t.classes) ? t.classes[0] : t.classes
    }

    const inWindow = (stuck || []).filter((t) => {
      const c = cls(t)
      if (!c) return false
      return today >= c.week_start_date && today <= c.week_end_date
    })

    if (inWindow.length === 0) {
      // Verbose debug so we can see WHY nothing matched. Lists every
      // row scanned with its class window so the comparison is visible.
      const sample = (stuck || []).slice(0, 10).map((t) => {
        const c = cls(t)
        return {
          name: `${t.first_name} ${t.last_name}`,
          class: c ? `${c.region || '?'} ${c.week_start_date} – ${c.week_end_date}` : 'NO CLASS JOINED',
          raw_classes_field_type: Array.isArray(t.classes) ? 'array' : typeof t.classes,
        }
      })
      return json(200, {
        target_date: today,
        repair: true,
        message: 'No trainees stuck in half-processed state. Nothing to repair.',
        scanned: (stuck || []).length,
        debug_first_10: sample,
      })
    }

    if (dryRun) {
      return json(200, {
        target_date: today,
        repair: true,
        dry_run: true,
        would_repair: inWindow.map((t) => `${t.first_name} ${t.last_name} (id=${t.id}, dropout_notified_at=${t.dropout_notified_at})`),
      })
    }

    const nowIso = new Date().toISOString()
    await Promise.all(
      inWindow.map((t) => {
        const c = cls(t)
        let dayN = null
        if (c?.week_start_date) {
          const ms = new Date(today + 'T12:00:00Z').getTime() - new Date(c.week_start_date + 'T12:00:00Z').getTime()
          dayN = Math.floor(ms / 86_400_000) + 1
        }
        const reason = dayN ? `No-show on Day ${dayN} (repair backfill)` : 'No-show during active training week (repair backfill)'
        return supabase
          .from('trainees')
          .update({
            enrolled: false,
            unenrolled_at: nowIso,
            unenrolled_reason: reason,
          })
          .eq('id', t.id)
      }),
    )

    return json(200, {
      target_date: today,
      repair: true,
      repaired: inWindow.map((t) => `${t.first_name} ${t.last_name}`),
      count: inWindow.length,
    })
  }
  // ─────────────────────────────────────────────────────────────

  // Pull every enrolled trainee in any class who hasn't been
  // dropout-flagged yet. We deliberately DO NOT filter by
  // company_email — Day-1 no-shows haven't been provisioned yet
  // (IT only creates the @shingleusa.com email after they sign in
  // at the kiosk). If we filtered on company_email, the trainees
  // who never showed up at all would slip through. Provisioning
  // status is handled later when deciding whether to alert IT/HR.
  let query = supabase
    .from('trainees')
    .select(`
      id, first_name, last_name, company_email, class_id,
      classes!class_id(id, region, week_start_date, week_end_date, locations(name)),
      attendance(attendance_date, confirmed)
    `)
    .eq('enrolled', true)
    .is('dropout_notified_at', null)
  if (targetClassId) query = query.eq('class_id', targetClassId)
  const { data: trainees, error: trErr } = await query
  if (trErr) return json(500, { error: `Supabase: ${trErr.message}` })

  // Compute "Day N" for each trainee. N = (today - week_start_date) + 1.
  // Hoisted above the dropout filter so we can use it to skip Day-1
  // trainees during the noon-class grace window.
  function dayNumberFor(t) {
    const start = t.classes?.week_start_date
    if (!start) return null
    const ms = new Date(today + 'T12:00:00Z').getTime() - new Date(start + 'T12:00:00Z').getTime()
    return Math.floor(ms / 86_400_000) + 1
  }

  // Day 1 of every class runs noon → 4 PM (not 8 AM like Day 2+). The
  // function-level gate at 10:30 AM ET is correct for Day 2+ but WAY too
  // early for Day 1 — at 10:30 AM Mon, class doesn't start for another
  // 90 minutes, so flagging non-attendees is just flagging "people who
  // are still on the way." This guard skips Day-1 trainees until 12:30 PM
  // ET (noon + 30-min grace), regardless of week_start_date's day-of-week
  // (Mon-start AND Tue-start both have noon-Day-1). The 30-min grace
  // matches the hotel-noshow alert gate for consistency.
  const nowEt = currentEtHour()
  const day1GraceEndEt = 12.5 // 12:30 PM ET
  const tooEarlyForDay1 = nowEt < day1GraceEndEt
  // On a LATE_START_DATES day the whole class starts at noon (not just Day 1),
  // so EVERY day gets the same 12:30 PM grace — don't flag noon-arrivers as
  // no-shows before they're even due. See _late-start.js.
  const lateStartToday = isLateStartDate(today)

  const dropouts = (trainees || []).filter((t) => {
    const c = t.classes
    if (!c) return false
    if (today < c.week_start_date || today > c.week_end_date) return false
    const dayN = dayNumberFor(t)
    if ((dayN === 1 || lateStartToday) && tooEarlyForDay1) return false  // noon-class grace
    const attendedToday = (t.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    return !attendedToday
  })

  if (dropouts.length === 0) {
    return json(200, {
      target_date: today,
      candidate_count: 0,
      message: 'No new dropouts today.',
    })
  }

  // Split dropouts into PROVISIONED (have company_email — IT/HR
  // need to clean up accounts) and UNPROVISIONED (never showed up
  // at all on Day 1, no accounts to delete). Both groups get
  // unenrolled; only provisioned ones trigger the IT/HR fan-out.
  const provisioned = dropouts.filter((t) => t.company_email)
  const unprovisioned = dropouts.filter((t) => !t.company_email)

  const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  // Group dropouts by class so the summary message is clearer when multiple
  // classes have dropouts on the same day. Only provisioned trainees go in
  // the IT/HR message lines (they're the ones with accounts to delete).
  const lines = provisioned.map((t) => {
    const region = t.classes?.region || 'training'
    const loc = t.classes?.locations?.name
    const locStr = loc ? ` · ${loc}` : ''
    return `• ${t.first_name} ${t.last_name} — ${t.company_email} (${region}${locStr})`
  })

  const itSms =
    provisioned.length === 1
      ? `[Training] Dropout on ${dateLabel}: ${lines[0].slice(2)}. Please delete the Google Workspace account.`
      : `[Training] ${provisioned.length} dropouts on ${dateLabel}. Please delete these Google Workspace accounts:\n${lines.join('\n')}`
  const itEmailSubject = `Delete ${provisioned.length} Google Workspace account${provisioned.length === 1 ? '' : 's'} — dropouts on ${dateLabel}`
  const itEmailBody =
    `The following provisioned trainee${provisioned.length === 1 ? '' : 's'} no-showed on ${dateLabel} and appear${provisioned.length === 1 ? 's' : ''} to have dropped out. Please delete their company email account${provisioned.length === 1 ? '' : 's'}:\n\n` +
    `${lines.join('\n')}\n\n` +
    `— Training System`

  const hrSms =
    provisioned.length === 1
      ? `[Training] Dropout on ${dateLabel}: ${lines[0].slice(2)}. Please remove from RepCard, JobNimbus, and Sales Academy.`
      : `[Training] ${provisioned.length} dropouts on ${dateLabel}. Please remove from RepCard, JobNimbus, and Sales Academy:\n${lines.join('\n')}`
  const hrEmailSubject = `Remove ${provisioned.length} dropout${provisioned.length === 1 ? '' : 's'} from apps — ${dateLabel}`
  const hrEmailBody =
    `The following provisioned trainee${provisioned.length === 1 ? '' : 's'} no-showed on ${dateLabel} and appear${provisioned.length === 1 ? 's' : ''} to have dropped out. Please remove their account${provisioned.length === 1 ? '' : 's'} from RepCard, JobNimbus, and Sales Academy:\n\n` +
    `${lines.join('\n')}\n\n` +
    `— Training System`

  // Look up recipients for each event.
  const itLookup = await recipientsForEvent(supabase, 'trainee_dropout_delete_email', { legacyRole: 'it' })
  const hrLookup = await recipientsForEvent(supabase, 'trainee_dropout_delete_apps', { legacyRole: 'hr' })

  if (dryRun) {
    return json(200, {
      target_date: today,
      candidate_count: dropouts.length,
      provisioned_count: provisioned.length,
      unprovisioned_count: unprovisioned.length,
      dropouts: dropouts.map((t) =>
        t.company_email
          ? `${t.first_name} ${t.last_name} (${t.company_email})`
          : `${t.first_name} ${t.last_name} (no company email — never provisioned)`,
      ),
      dry_run: true,
      preview_it_sms: provisioned.length ? itSms : '(skipped — no provisioned dropouts)',
      preview_hr_sms: provisioned.length ? hrSms : '(skipped — no provisioned dropouts)',
      it_subscribers: itLookup.recipients.length,
      hr_subscribers: hrLookup.recipients.length,
    })
  }

  // Only fan out to IT/HR if there ARE provisioned dropouts to act
  // on. Day-1 no-shows (never provisioned) get unenrolled silently —
  // no accounts to delete, no need to alert IT/HR.
  let itResult = { skipped: true, reason: 'no provisioned dropouts' }
  let hrResult = { skipped: true, reason: 'no provisioned dropouts' }
  if (provisioned.length > 0) {
    itResult = await notifyAll(itLookup.recipients, {
      smsBody: itSms,
      emailSubject: itEmailSubject,
      emailBody: itEmailBody,
      contactLabel: 'IT',
    })
    hrResult = await notifyAll(hrLookup.recipients, {
      smsBody: hrSms,
      emailSubject: hrEmailSubject,
      emailBody: hrEmailBody,
      contactLabel: 'HR',
    })
  }

  // Stamp dropout_notified_at + flip enrolled=false on each dropout
  // regardless of send outcome — a partial failure is better than
  // re-spamming the same name tomorrow. The enrolled flip is what
  // makes the /progress count drop in real-time (12 → 9).
  //
  // We do this per-row instead of with a bulk .in() because each
  // trainee needs an unenrolled_reason that includes their own
  // training-day-number.
  const nowIso = new Date().toISOString()
  await Promise.all(
    dropouts.map((t) => {
      const dayN = dayNumberFor(t)
      const reason = dayN ? `No-show on Day ${dayN}` : 'No-show during active training week'
      return supabase
        .from('trainees')
        .update({
          dropout_notified_at: nowIso,
          enrolled: false,
          unenrolled_at: nowIso,
          unenrolled_reason: reason,
        })
        .eq('id', t.id)
    }),
  )

  return json(200, {
    target_date: today,
    candidate_count: dropouts.length,
    provisioned_count: provisioned.length,
    unprovisioned_count: unprovisioned.length,
    dropouts: dropouts.map((t) =>
      t.company_email
        ? `${t.first_name} ${t.last_name} (${t.company_email})`
        : `${t.first_name} ${t.last_name} (no company email — never provisioned)`,
    ),
    it_notified: {
      ...itResult,
      source: itLookup.source,
      recipient_count: itLookup.recipients.length,
    },
    hr_notified: {
      ...hrResult,
      source: hrLookup.source,
      recipient_count: hrLookup.recipients.length,
    },
  })
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

// Returns { inside: bool, et_time: 'HH:MM' }. inside === true only
// when the current America/New_York time is between 10:30 and 17:30
// inclusive — i.e. during the training day, after the 30-min grace
// period for late arrivals. Used to gate the every-30-min cron so it
// doesn't fire too early (and false-positive anyone running late) or
// too late (when training is over).
// Current wall-clock hour in America/New_York as a float (14.5 = 2:30 PM).
// Used by the Day-1 noon-class grace gate inside the dropouts filter.
function currentEtHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const et = fmt.format(new Date()).replace('24:', '00:')
  const [h, m] = et.split(':').map(Number)
  return h + (m || 0) / 60
}

function withinTrainingDayWindowET() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  // Some locales emit "24:00" for midnight; coerce.
  const et = fmt.format(new Date()).replace('24:', '00:')
  const [h, m] = et.split(':').map(Number)
  const minutesFromMidnight = h * 60 + m
  const start = 10 * 60 + 30  // 10:30 AM
  const end   = 17 * 60 + 30  //  5:30 PM
  return {
    inside: minutesFromMidnight >= start && minutesFromMidnight <= end,
    et_time: et,
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
