// countersign-agreement.js
//
// The COMPANY's half of the Independent Contractor Agreement.
//
// The agreement is between two parties and was only ever signed by one: the rep
// signed and the PDF was rendered immediately with the U.S. Shingle side of the
// signature block blank. Now the rep signs, Jennifer gets a text, she signs, and
// only then is the PDF created — carrying both signatures (Neal, 2026-08-24).
//
//   GET  ?t=<token>          the signing page (plain HTML, no login)
//   POST { t, signature, name }  countersign, then render and store the PDF
//
// Serves its own HTML rather than adding a route to the SPA: a class starts in
// half an hour and a self-contained page cannot break the app the trainees are
// about to use.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'
import { renderAgreementPdf, COMPANY } from './_ic-agreement.js'

const html = (body, code = 200) => ({ statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body })
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

function page({ token, agent, signedOn, done }) {
  if (done) return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#f1f5f9;display:grid;place-items:center;min-height:100vh}
.c{background:#fff;padding:34px 30px;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:460px;text-align:center}
h1{font-size:19px;margin:0 0 8px;color:#166534}p{color:#475569;font-size:14.5px;line-height:1.5;margin:0}</style>
<div class=c><div style="font-size:40px">✅</div><h1>Signed — thank you</h1>
<p>The agreement for <b>${agent}</b> is now fully executed and the PDF has been filed.</p></div>`

  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Countersign — ${agent}</title>
<style>
 body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#f1f5f9;padding:18px}
 .c{background:#fff;padding:22px;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:560px;margin:0 auto}
 h1{font-size:19px;margin:0 0 4px;color:#0f172a}.sub{color:#64748b;font-size:14px;margin:0 0 16px}
 label{display:block;font-weight:700;font-size:13px;color:#334155;margin:14px 0 5px}
 input{width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:9px;font-size:16px;box-sizing:border-box}
 canvas{border:1.5px dashed #94a3b8;border-radius:10px;width:100%;height:170px;touch-action:none;background:#fff}
 .row{display:flex;gap:9px;margin-top:12px}
 button{flex:1;padding:13px;border:0;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer}
 .go{background:#15803d;color:#fff}.clr{background:#e2e8f0;color:#334155;flex:0 0 100px}
 .err{color:#b91c1c;font-weight:700;font-size:13.5px;margin-top:10px;min-height:18px}
</style>
<div class=c>
 <h1>Countersign for ${COMPANY.name}</h1>
 <p class=sub><b>${agent}</b> signed their Independent Contractor Agreement on ${signedOn}. It needs the company signature to be complete.</p>
 <label>Your name</label>
 <input id=nm value="Jennifer VonGraupen" autocomplete=name>
 <label>Sign below</label>
 <canvas id=cv></canvas>
 <div class=row><button class=clr id=clr type=button>Clear</button><button class=go id=go type=button>Sign &amp; file it</button></div>
 <div class=err id=err></div>
</div>
<script>
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');let drew=false,down=false;
function fit(){const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=r.width*d;cv.height=r.height*d;ctx.scale(d,d);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.strokeStyle='#0f172a'}
fit();addEventListener('resize',fit);
const pt=e=>{const r=cv.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return[t.clientX-r.left,t.clientY-r.top]};
const start=e=>{e.preventDefault();down=true;drew=true;ctx.beginPath();ctx.moveTo(...pt(e))};
const move=e=>{if(!down)return;e.preventDefault();ctx.lineTo(...pt(e));ctx.stroke()};
const end=()=>{down=false};
cv.addEventListener('mousedown',start);cv.addEventListener('mousemove',move);addEventListener('mouseup',end);
cv.addEventListener('touchstart',start,{passive:false});cv.addEventListener('touchmove',move,{passive:false});cv.addEventListener('touchend',end);
document.getElementById('clr').onclick=()=>{ctx.clearRect(0,0,cv.width,cv.height);drew=false};
document.getElementById('go').onclick=async()=>{
  const err=document.getElementById('err'),nm=document.getElementById('nm').value.trim(),btn=document.getElementById('go');
  if(!nm){err.textContent='Please type your name.';return}
  if(!drew){err.textContent='Please sign in the box.';return}
  btn.disabled=true;btn.textContent='Filing…';err.textContent='';
  try{
    const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({t:${JSON.stringify(token)},name:nm,signature:cv.toDataURL('image/png')})});
    const j=await r.json();
    if(!j.ok)throw new Error(j.error||'Could not save');
    location.reload();
  }catch(e){err.textContent=e.message;btn.disabled=false;btn.textContent='Sign & file it'}
};
</script>`
}

export const handler = async (event) => {
  const supabase = db()
  const token = String((event.queryStringParameters || {}).t || '').trim()

  if (event.httpMethod === 'POST') {
    let b = {}
    try { b = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Bad request' }) }
    const t = String(b.t || token || '').trim()
    if (!t || !b.signature || !String(b.name || '').trim()) return json(400, { ok: false, error: 'Name and signature are both needed.' })

    const { data: row } = await supabase.from('trainee_onboarding').select('*').eq('countersign_token', t).maybeSingle()
    if (!row) return json(404, { ok: false, error: 'This link is not valid.' })
    if (!row.signed_at) return json(400, { ok: false, error: 'The rep has not signed this yet.' })
    if (row.company_signed_at) return json(200, { ok: true, already: true })

    const nowIso = new Date().toISOString()
    const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || null
    const merged = {
      ...row,
      company_signature: b.signature,
      company_sign_name: String(b.name).trim(),
      company_sign_title: 'Authorized Representative',
      company_signed_at: nowIso,
      company_sign_ip: ip,
    }

    // NOW render the agreement — with both signatures on it. This is the first
    // time an agreement PDF exists, which is the point: a one-sided PDF is not
    // an executed contract and should never have been filed as one.
    let path = null, pdfError = null
    try {
      const pdf = await renderAgreementPdf(merged)
      const name = `${row.trainee_id}/agreement_${Date.now()}.pdf`
      const bytes = Buffer.from(pdf, 'base64')
      const { error } = await supabase.storage.from('trainee-docs').upload(name, bytes, { contentType: 'application/pdf', upsert: true })
      if (error) throw error
      path = name
    } catch (e) { pdfError = e.message }

    const { error } = await supabase.from('trainee_onboarding').update({
      company_signature: merged.company_signature, company_sign_name: merged.company_sign_name,
      company_sign_title: merged.company_sign_title, company_signed_at: nowIso, company_sign_ip: ip,
      ...(path ? { agreement_pdf_path: path } : {}), ...(pdfError ? { pdf_error: `agreement: ${pdfError}` } : {}),
    }).eq('countersign_token', t)
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, signed: true, pdf: path, pdf_error: pdfError })
  }

  if (!token) return html('<p style="font-family:system-ui;padding:24px">This link is missing its code.</p>', 400)
  const { data: row } = await supabase
    .from('trainee_onboarding')
    .select('trainee_id, sign_name, signed_at, company_signed_at, agent_legal_name')
    .eq('countersign_token', token).maybeSingle()
  if (!row) return html('<p style="font-family:system-ui;padding:24px">This link is not valid. Ask the office.</p>', 404)

  const agent = row.agent_legal_name || row.sign_name || 'the rep'
  const signedOn = row.signed_at ? new Date(row.signed_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : ''
  return html(page({ token, agent, signedOn, done: !!row.company_signed_at }))
}
