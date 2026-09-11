import { useEffect, useState, Fragment } from 'react'

// CCG functions origin.
const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

// MAIL → CONVERSION.
//
// What went out in the mail each week, and the two ways a homeowner answers it:
// they phone in and a setter books them (Viviana, Dustin, Hannah take ~95% of
// those), or an Instant Quote lead syncs in from JobNimbus.
//
// That second column is NOT a QR scan and must not be labelled as one. It counts
// every JN contact whose source is "Instant Quote", whatever brought them to the
// form — mailer, Facebook, the website, typing the URL. Nothing in the record
// says how they arrived (Neal, 2026-09-11). Attributing it to the mail needs a
// tracked parameter on the printed QR; until then the rate is a mix, and the
// column name says so.
//
// Cities sorted by name, each opening to the ZIPs inside it (Neal, 2026-09-11):
// ZIP is how mail actually drops, city is how a person reads a list.
//
// Read from CCG's mail_response_weekly, which a nightly job fills. It is a
// SNAPSHOT, not a live query, and deliberately so — David's source field is
// last_mailed_date, one date per property that gets overwritten every time that
// house is mailed again. Asked live in October, August shrinks. The nightly
// capture keeps history his table structurally cannot.
const nf = (n) => (n == null ? '—' : Number(n).toLocaleString())
const pf = (n) => (n == null ? '—' : `${n.toFixed(2)}%`)

// Anything at or above this is a genuinely good direct-mail week; the industry
// rule of thumb for cold mail is well under 1%.
const strong = (p) => p != null && p >= 1

export default function MailResponseReport() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [weeks, setWeeks] = useState(8)
  const [openWeek, setOpenWeek] = useState(null)
  const [openCity, setOpenCity] = useState({})

  useEffect(() => {
    if (!open) return              // nothing is fetched until somebody opens it
    setData(null); setErr('')
    fetch(`${LB_ORIGIN}mail-response-report?weeks=${weeks}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'Could not load')
        setData(d)
        if (d.weeks && d.weeks.length) setOpenWeek(d.weeks[0].week_start)
      })
      .catch((e) => setErr(e.message || 'Could not load'))
  }, [open, weeks])

  const toggleCity = (wk, city) => setOpenCity((p) => ({ ...p, [`${wk}|${city}`]: !p[`${wk}|${city}`] }))

  return (
    <section className="mb-6">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full rounded-lg bg-[#1d4ed8] px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95">
        📬 Mail &amp; Conversion {open ? '▾' : '▸'}
        <div className="text-xs font-normal opacity-90">
          What we mailed, and who answered — by ZIP, grouped under the city. <b>Called in</b> is a setter booking
          it off an inbound call. <b>JN Sync Pin</b> is an Instant Quote lead synced in from JobNimbus —
          however that person found the form, not only from the mailer. Every percentage is out of the pieces
          mailed into that ZIP. <b>Response rate</b> is both together ÷ pieces mailed — a response, not a sale.
        </div>
      </button>

      {open && (
      <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}
          className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-sm">
          {[4, 8, 13, 26, 52].map((n) => <option key={n} value={n}>Last {n} weeks</option>)}
        </select>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{err}</div>}
      {!err && data === null && <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>}

      {data && !data.weeks.length && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">
          {data.note || 'Nothing rolled up yet.'}
        </div>
      )}

      {data && data.weeks.map((w) => {
        const open = openWeek === w.week_start
        return (
          <div key={w.week_start} className="mb-2 rounded-lg border border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setOpenWeek(open ? null : w.week_start)}
              className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 text-left">
              <span className="text-sm font-bold text-slate-900">{open ? '▾' : '▸'} Week of {w.week_label}</span>
              <span className="text-xs text-slate-600">{nf(w.totals.mailed)} mailed</span>
              <span className="text-xs text-slate-600">
                {nf(w.totals.called_in)} called in <span className="text-slate-400">({pf(w.totals.called_in_pct)})</span>
              </span>
              <span className="text-xs text-slate-600">
                {nf(w.totals.iq_pins)} JN sync pins <span className="text-slate-400">({pf(w.totals.iq_pct)})</span>
              </span>
              <span className={`ml-auto text-sm font-extrabold ${strong(w.totals.responded_pct) ? 'text-green-700' : 'text-slate-900'}`}>
                {pf(w.totals.responded_pct)} response rate
              </span>
            </button>

            {open && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-white border-b border-slate-200">
                    <th className="text-left font-semibold px-3 py-1.5">City</th>
                    <th className="text-right font-semibold px-2 py-1.5">Mailed</th>
                    <th className="text-right font-semibold px-2 py-1.5">Called in</th>
                    <th className="text-right font-semibold px-2 py-1.5">JN Sync Pin</th>
                    <th className="text-right font-semibold px-3 py-1.5">Response rate</th>
                  </tr>
                </thead>
                <tbody>
                  {w.cities.map((c) => {
                    const co = !!openCity[`${w.week_start}|${c.city}`]
                    return (
                      <Fragment key={c.city}>
                        <tr onClick={() => toggleCity(w.week_start, c.city)}
                          className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                          <td className="px-3 py-1.5 font-semibold text-slate-800">
                            {c.zips.length > 1 ? (co ? '▾ ' : '▸ ') : ''}{c.city}
                            {c.county && <span className="text-slate-400 font-normal"> · {c.county}</span>}
                            {c.zips.length > 1 && <span className="text-slate-400 font-normal"> ({c.zips.length} ZIPs)</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{nf(c.mailed)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {nf(c.called_in)}<div className="text-[11px] font-normal text-slate-400">{pf(c.called_in_pct)}</div>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {nf(c.iq_pins)}<div className="text-[11px] font-normal text-slate-400">{pf(c.iq_pct)}</div>
                          </td>
                          <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${strong(c.responded_pct) ? 'text-green-700' : 'text-slate-800'}`}>
                            {pf(c.responded_pct)}
                            <div className="text-[11px] font-normal text-slate-400">{nf(c.responded)} total</div>
                          </td>
                        </tr>
                        {co && c.zips.map((z) => (
                          <tr key={z.zip} className="border-b border-slate-100 bg-slate-50/60 text-[13px]">
                            <td className="px-3 py-1 pl-8 text-slate-600">{z.zip}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-600">{nf(z.mailed)}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                              {nf(z.called_in)} <span className="text-[11px] text-slate-400">{pf(z.called_in_pct)}</span>
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                              {nf(z.iq_pins)} <span className="text-[11px] text-slate-400">{pf(z.iq_pct)}</span>
                            </td>
                            <td className={`px-3 py-1 text-right tabular-nums font-semibold ${strong(z.responded_pct) ? 'text-green-700' : 'text-slate-600'}`}>
                              {pf(z.responded_pct)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
            {open && w.unmailed && w.unmailed.cities > 0 && (
              <div className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">
                {w.unmailed.cities} more cities had activity this week but no mail drop
                ({w.unmailed.called_in} called in, {w.unmailed.iq_pins} scanned QR) — not listed, but included in the week total above.
              </div>
            )}
          </div>
        )
      })}

      {data && data.captured_at && (
        <div className="text-[11px] text-slate-400 mt-2">
          Captured {new Date(data.captured_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET ·
          {' '}a homeowner with a JN sync pin who was <i>also</i> booked by a setter appears in both columns.
        </div>
      )}
      </div>
      )}
    </section>
  )
}
