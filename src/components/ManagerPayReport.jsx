// Managers Pay (override) report — Region → Sales rep → Deal, with per-region
// column totals and the manager's override pay. Shared by the admin Regional
// Managers page (admin={true} → editable rate config) and each manager's
// dashboard (read-only, all regions). Data: CCG all-manager-pay; rates:
// manager-pay-config. See those functions for the formula.
import { useState, useEffect } from 'react'
import { teamLabel, ZONE_COLORS } from '../lib/zones.js'

const RATE_ZONES = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4']

const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString()
const pctOf = (f) => (Math.round((Number(f) || 0) * 1000) / 10) + '%'
const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/New_York' }) } catch { return '' } }
const weekLabel = (range) => { if (!range) return ''; const endMinus1 = new Date(new Date(range.end).getTime() - 864e5); return `${fmtDay(range.start)} – ${fmtDay(endMinus1.toISOString())}` }

export default function ManagerPayReport({ admin = false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [wb, setWb] = useState(0)
  const [openZone, setOpenZone] = useState(null)
  const [cfgOpen, setCfgOpen] = useState(false)

  const load = async (weeksBack = wb) => {
    setLoading(true); setErr('')
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(LB_ORIGIN + 'all-manager-pay?weeks_back=' + weeksBack)
        const d = await res.json()
        if (d && d.ok) { setData(d); setLoading(false); return d }
        lastErr = d?.error || 'Could not load.'
      } catch { lastErr = 'Network error.' }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500))
    }
    setErr(lastErr); setLoading(false)
  }
  const go = (delta) => { const n = Math.max(0, wb + delta); setWb(n); load(n) }

  const downloadCsv = () => {
    if (!data) return
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const head = ['Region', 'Manager', 'Rep', 'Own sale?', 'Customer', 'Sold', 'Contract', 'Roof', 'IRBAD', 'Base OR', 'Own +1%', 'IRBAD OR', 'Deal OR']
    const rows = [head]
    for (const z of data.regions) {
      for (const r of z.reps) for (const d of r.deals)
        rows.push([z.zone, z.manager || '', r.rep, r.is_manager ? 'Y' : '', d.customer, d.sold, d.contract, d.roof, d.irbad, d.base_or, d.own_or, d.irbad_or, d.deal_or])
      const t = z.totals
      rows.push([z.zone + ' TOTAL', z.manager || '', '', '', '', '', t.contract, t.roof, t.irbad, t.base_or, t.own_or, t.irbad_or, t.deal_or])
      if (z.monthly_bonus) rows.push([z.zone + ' MONTHLY BONUS', '', '', '', '', '', '', '', '', '', '', '', z.monthly_bonus])
      rows.push([z.zone + ' MANAGER PAY', z.manager || '', '', '', '', '', '', '', '', '', '', '', z.grand_or])
    }
    rows.push(['GRAND TOTAL MANAGER PAY', '', '', '', '', '', data.totals.contract, data.totals.roof, data.totals.irbad, data.totals.base_or, data.totals.own_or, data.totals.irbad_or, data.totals.grand_or])
    const csv = rows.map((row) => row.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `managers-pay-${weekLabel(data.range).replace(/[^\d]/g, '-')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-brand-navy">💵 Managers Pay <span className="text-sm font-normal text-slate-500">(override — last week's results)</span></h2>
          <p className="text-xs text-slate-500">Region → rep → deal. Rates are set per region (each region's % shows in its column headers).</p>
        </div>
        <div className="flex items-center gap-2">
          {admin && <button onClick={() => setCfgOpen((v) => !v)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">⚙️ Rates</button>}
          {data && <button onClick={downloadCsv} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">⬇ CSV</button>}
          <button onClick={() => load()} disabled={loading} className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">{loading ? 'Loading…' : data ? 'Refresh' : 'Load report'}</button>
        </div>
      </div>

      {admin && cfgOpen && <RateEditor onSaved={() => load()} />}
      {err && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {data && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => go(1)} className="rounded-md border border-slate-300 px-3 py-1 text-sm font-bold text-slate-600 hover:bg-slate-50">◀ Older</button>
            <div className="text-center">
              <div className="text-sm font-bold text-slate-700">Week of {weekLabel(data.range)}</div>
              <div className="text-xs text-slate-400">{wb === 0 ? 'Most recent completed week' : `${wb} week${wb > 1 ? 's' : ''} back`}</div>
            </div>
            <button onClick={() => go(-1)} disabled={wb === 0} className="rounded-md border border-slate-300 px-3 py-1 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Newer ▶</button>
          </div>

          <div className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Total manager override pay</div>
            <div className="text-2xl font-extrabold text-emerald-700">{usd(data.totals.grand_or)}</div>
            <div className="text-xs text-emerald-600">on {usd(data.totals.contract)} contract{data.totals.monthly_bonus ? ` · incl ${usd(data.totals.monthly_bonus)} monthly bonus` : ''}</div>
          </div>

          {data.regions.map((z) => (
            <RegionBlock key={z.zone} z={z} open={openZone === z.zone} onToggle={() => setOpenZone(openZone === z.zone ? null : z.zone)} />
          ))}
        </div>
      )}
    </div>
  )
}

function RegionBlock({ z, open, onToggle }) {
  const c = ZONE_COLORS[z.zone] || { deep: '#64748b', light: '#f1f5f9' }
  const cfg = z.config || { base_rate: 0.02, irbad_rate: 0.20, irbad_bonus: 0.10 }
  const basePct = pctOf(cfg.base_rate)
  const irbadPct = pctOf(cfg.irbad_rate + cfg.irbad_bonus)
  return (
    <div className="mt-3 overflow-hidden rounded-lg border" style={{ borderColor: c.deep }}>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" style={{ background: c.light }}>
        <div>
          <span className="font-bold" style={{ color: c.deep }}>{z.unassigned ? '⚠️ Unassigned — no manager' : teamLabel(z.zone)}</span>
          {z.manager && <span className="ml-2 text-sm text-slate-600">{z.manager}</span>}
          <span className="ml-2 text-xs text-slate-500">{z.totals.deals} deal{z.totals.deals !== 1 ? 's' : ''}</span>
        </div>
        <div className="text-right">
          <div className="font-extrabold" style={{ color: c.deep }}>{z.unassigned ? '—' : usd(z.grand_or)}</div>
          <div className="text-[11px] text-slate-500">{open ? 'hide' : 'show deals'}</div>
        </div>
      </button>
      {z.unassigned && <div className="bg-amber-50 px-3 py-1.5 text-[12px] text-amber-700">These reps have no zone set — no manager earns their override. Fix their zone on Active sales reps.</div>}
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="px-2 py-1 font-semibold">Rep / Deal</th>
                <th className="px-2 py-1 text-right font-semibold">Contract</th>
                <th className="px-2 py-1 text-right font-semibold">Override ({basePct})</th>
                <th className="px-2 py-1 text-right font-semibold">IRBAD</th>
                <th className="px-2 py-1 text-right font-semibold">IRBAD OR ({irbadPct})</th>
                <th className="px-2 py-1 text-right font-semibold">+Own</th>
                <th className="px-2 py-1 text-right font-semibold">Deal OR</th>
              </tr>
            </thead>
            <tbody>
              {z.reps.map((r) => (
                <RepRows key={r.rep} r={r} />
              ))}
              <tr className="border-t-2 font-bold" style={{ borderColor: c.deep }}>
                <td className="px-2 py-1.5" style={{ color: c.deep }}>{z.zone} TOTAL</td>
                <td className="px-2 py-1.5 text-right">{usd(z.totals.contract)}</td>
                <td className="px-2 py-1.5 text-right">{usd(z.totals.base_or)}</td>
                <td className="px-2 py-1.5 text-right">{usd(z.totals.irbad)}</td>
                <td className="px-2 py-1.5 text-right">{usd(z.totals.irbad_or)}</td>
                <td className="px-2 py-1.5 text-right">{usd(z.totals.own_or)}</td>
                <td className="px-2 py-1.5 text-right" style={{ color: c.deep }}>{usd(z.totals.deal_or)}</td>
              </tr>
              {!z.unassigned && z.monthly_bonus > 0 && (
                <tr className="text-slate-600"><td className="px-2 py-1" colSpan={6}>+ Monthly bonus</td><td className="px-2 py-1 text-right font-bold">{usd(z.monthly_bonus)}</td></tr>
              )}
              {!z.unassigned && (
                <tr className="bg-emerald-50 font-extrabold text-emerald-700"><td className="px-2 py-1.5" colSpan={6}>{z.manager} — TOTAL PAY</td><td className="px-2 py-1.5 text-right">{usd(z.grand_or)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RepRows({ r }) {
  return (
    <>
      <tr className="bg-white"><td className="px-2 pt-2 font-bold text-slate-700" colSpan={7}>{r.rep}{r.is_manager && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">★ MANAGER'S OWN</span>}</td></tr>
      {r.deals.map((d, i) => (
        <tr key={i} className="border-b border-slate-100 text-slate-600">
          <td className="px-2 py-1 pl-4">{d.customer}<span className="ml-1 text-[11px] text-slate-400">{d.sold}</span></td>
          <td className="px-2 py-1 text-right">{usd(d.contract)}</td>
          <td className="px-2 py-1 text-right">{usd(d.base_or)}</td>
          <td className="px-2 py-1 text-right">{d.irbad ? usd(d.irbad) : '—'}</td>
          <td className="px-2 py-1 text-right">{d.irbad_or ? usd(d.irbad_or) : '—'}</td>
          <td className="px-2 py-1 text-right">{d.own_or ? usd(d.own_or) : '—'}</td>
          <td className="px-2 py-1 text-right font-bold text-slate-800">{usd(d.deal_or)}</td>
        </tr>
      ))}
    </>
  )
}

// Admin-only PER-REGION rate editor → POST manager-pay-config (PIN-gated). Each
// region has its own rates so a bonus can sit on one region without touching the
// others. Inputs are inlined (not a sub-component) to avoid focus loss on keystroke.
function RateEditor({ onSaved }) {
  const [rows, setRows] = useState(null) // { zone: { base, own, irbad, bonus, monthly } as strings }
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(LB_ORIGIN + 'manager-pay-config')
        const d = await res.json()
        const reg = d.regions || {}
        const init = {}
        for (const z of RATE_ZONES) {
          const c = reg[z] || { base_rate: 0.02, own_sale_rate: 0.01, irbad_rate: 0.20, irbad_bonus: 0.10, monthly_bonus: 0 }
          init[z] = { base: (c.base_rate * 100).toString(), own: (c.own_sale_rate * 100).toString(), irbad: (c.irbad_rate * 100).toString(), bonus: (c.irbad_bonus * 100).toString(), monthly: (c.monthly_bonus || 0).toString() }
        }
        setRows(init)
      } catch { setRows({}) }
    })()
  }, [])

  const setField = (z, k, v) => setRows((r) => ({ ...r, [z]: { ...r[z], [k]: v } }))

  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const regions = {}
      for (const z of RATE_ZONES) { const x = rows[z]; regions[z] = { base_rate: +x.base / 100, own_sale_rate: +x.own / 100, irbad_rate: +x.irbad / 100, irbad_bonus: +x.bonus / 100, monthly_bonus: +x.monthly } }
      const res = await fetch(LB_ORIGIN + 'manager-pay-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, config: { regions } }) })
      const d = await res.json()
      if (!d.ok) { setMsg(d.error || 'Save failed.'); setBusy(false); return }
      setMsg('Saved ✓'); setBusy(false); onSaved && onSaved()
    } catch { setMsg('Network error.'); setBusy(false) }
  }

  if (!rows) return <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">Loading rates…</div>
  const inp = 'w-14 rounded border border-slate-300 px-1 py-1 text-right text-sm text-slate-800'

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-bold text-slate-600">Manager pay rates — <span className="font-normal">per region. Set a monthly bonus on one region without touching the others; the report recalculates.</span></div>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-[520px] text-[12px]">
          <thead>
            <tr className="text-slate-500">
              <th className="px-1 py-1 text-left font-semibold">Region</th>
              <th className="px-1 py-1 font-semibold">Base %</th>
              <th className="px-1 py-1 font-semibold">Own +%</th>
              <th className="px-1 py-1 font-semibold">IRBAD %</th>
              <th className="px-1 py-1 font-semibold">IRBAD bonus %</th>
              <th className="px-1 py-1 font-semibold">Monthly $</th>
            </tr>
          </thead>
          <tbody>
            {RATE_ZONES.map((z) => {
              const col = ZONE_COLORS[z]?.deep || '#334155'
              const r = rows[z] || { base: '', own: '', irbad: '', bonus: '', monthly: '' }
              return (
                <tr key={z}>
                  <td className="px-1 py-1 font-semibold" style={{ color: col }}>{teamLabel(z, { showZone: false })} <span className="font-normal text-slate-400">{z}</span></td>
                  <td className="px-1 py-1 text-center"><input value={r.base} onChange={(e) => setField(z, 'base', e.target.value)} inputMode="decimal" className={inp} /></td>
                  <td className="px-1 py-1 text-center"><input value={r.own} onChange={(e) => setField(z, 'own', e.target.value)} inputMode="decimal" className={inp} /></td>
                  <td className="px-1 py-1 text-center"><input value={r.irbad} onChange={(e) => setField(z, 'irbad', e.target.value)} inputMode="decimal" className={inp} /></td>
                  <td className="px-1 py-1 text-center"><input value={r.bonus} onChange={(e) => setField(z, 'bonus', e.target.value)} inputMode="decimal" className={inp} /></td>
                  <td className="px-1 py-1 text-center"><input value={r.monthly} onChange={(e) => setField(z, 'monthly', e.target.value)} inputMode="decimal" className="w-20 rounded border border-slate-300 px-1 py-1 text-right text-sm text-slate-800" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label className="text-[11px] font-semibold text-slate-500">Admin PIN <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" className="ml-1 w-20 rounded border border-slate-300 px-1.5 py-1 text-sm" /></label>
        <button onClick={save} disabled={busy || !pin} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save rates'}</button>
        {msg && <span className={`text-sm font-semibold ${msg.includes('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{msg}</span>}
      </div>
    </div>
  )
}
