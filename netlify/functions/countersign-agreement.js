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
import { renderAgreementPdf, COMPANY, AGREEMENT, EXHIBIT_A } from './_ic-agreement.js'

const html = (body, code = 200) => ({ statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body })
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)


const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// The WHOLE agreement, filled in, so she can read what she is signing.
//
// Jennifer will not sign a document she cannot read, and the page previously
// showed only a name and a signature box. Built from the same AGREEMENT and
// EXHIBIT_A arrays the PDF renders from, so the thing on screen and the thing
// that gets filed can never drift apart (Neal, 2026-08-25).
function agreementHtml(row) {
  const on = row.signed_at ? new Date(row.signed_at) : new Date()
  const dd = on.getDate(), mm = on.toLocaleString('en-US', { month: 'long', timeZone: 'America/New_York' }), yy = String(on.getFullYear()).slice(2)
  const agent = esc(row.agent_legal_name || row.sign_name || '')
  const out = []
  const render = (blocks) => {
    for (const b of blocks) {
      if (b.h) { out.push(`<h3>${esc(b.h)}</h3>`); continue }
      if (b.intro) { out.push(`<p>This agreement is entered into effective as of this ${dd} day of ${mm}, 20${yy} between ${esc(COMPANY.name)} (SHINGLE) a Florida Corporation at ${esc(COMPANY.address)} and <b>${agent}</b> (AGENT) located at ${esc(row.agent_address)} email ${esc(row.agent_email)}.</p>`); continue }
      if (b.exhibitIntro) { out.push(`<p>This Exhibit A form is part of the Independent Contractor Partner Agreement date effective as of this ${dd} day of ${mm}, 20${yy} between ${esc(COMPANY.name)} and <b>${agent}</b> (Independent Contractor).</p>`); continue }
      if (b.li) { out.push(`<p class=li>&bull;&nbsp;&nbsp;${esc(b.li)}</p>`); continue }
      if (b.n) { out.push(`<p><b>${esc(b.n)}</b>&nbsp;&nbsp;${esc(b.p)}</p>`); continue }
      out.push(`<p>${esc(b.p)}</p>`)
    }
  }
  render(AGREEMENT)
  out.push(`<div class=sigblk><b>Agent / Independent Contractor</b><br>
    Signature: <i>${esc(row.sign_name || agent)}</i> &nbsp;·&nbsp; Printed: ${esc(row.sign_name || agent)}<br>
    Title: Independent Contractor &nbsp;·&nbsp; Date: ${on.toLocaleDateString('en-US')}</div>`)
  render(EXHIBIT_A)
  return out.join('')
}

function page({ token, agent, signedOn, done, row }) {
  if (done) return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#f1f5f9;display:grid;place-items:center;min-height:100vh}
.c{background:#fff;padding:34px 30px;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:460px;text-align:center}
h1{font-size:19px;margin:0 0 8px;color:#166534}p{color:#475569;font-size:14.5px;line-height:1.5;margin:0}</style>
<div class=c><div style="font-size:40px">✅</div><h1>Signed — thank you</h1>
<p>The agreement for <b>${agent}</b> is now fully executed and the PDF has been filed.</p></div>`

  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Countersign — ${agent}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Great+Vibes&family=Homemade+Apple&family=Caveat:wght@600&display=swap">
<style>
 body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#f1f5f9;padding:18px;color:#0f172a}
 .c{background:#fff;padding:22px;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:760px;margin:0 auto}
 h1{font-size:19px;margin:0 0 4px}.sub{color:#64748b;font-size:14px;margin:0 0 16px}
 .doc{border:1px solid #cbd5e1;border-radius:10px;padding:16px 18px;max-height:52vh;overflow-y:auto;background:#fcfcfd;font-size:13.2px;line-height:1.5}
 @supports (height:100dvh){ .doc{max-height:52dvh} }
 .doc h3{text-align:center;font-size:15px;margin:16px 0 8px}
 .doc p{margin:0 0 9px}.doc p.li{margin-left:14px}
 .sigblk{margin:14px 0;padding:10px 12px;border:1px dashed #94a3b8;border-radius:8px;background:#fff;font-size:12.5px;line-height:1.6}
 .read{font-size:12.5px;color:#b45309;font-weight:700;margin:8px 0 0}
 label{display:block;font-weight:700;font-size:13px;color:#334155;margin:16px 0 5px}
 input{width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:9px;font-size:16px;box-sizing:border-box}
 .tabs{display:flex;gap:8px;margin:14px 0 0}
 .tabs button{flex:1;padding:9px;border:1px solid #cbd5e1;background:#fff;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer}
 .tabs button.on{background:#0f172a;color:#fff;border-color:#0f172a}
 .styles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px;margin-top:10px}
 .sty{border:2px solid #e2e8f0;border-radius:11px;padding:12px 10px;cursor:pointer;background:#fff;text-align:center;min-height:56px;display:flex;align-items:center;justify-content:center;overflow:hidden}
 .sty.on{border-color:#15803d;background:#f0fdf4}
 .sty span{font-size:27px;line-height:1.15;white-space:nowrap}
 canvas{border:1.5px dashed #94a3b8;border-radius:10px;width:100%;height:170px;touch-action:none;background:#fff}
 .row{display:flex;gap:9px;margin-top:14px}
 .go{flex:1;padding:13px;border:0;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;background:#15803d;color:#fff}
 .go.notready{background:#94a3b8}
 .jump{flex:0 0 auto;padding:13px 16px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#334155;font-size:14px;font-weight:800;cursor:pointer}
 .clr{flex:0 0 100px;padding:13px;border:0;border-radius:10px;background:#e2e8f0;color:#334155;font-weight:800;cursor:pointer}
 .step{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:999px;background:#0f172a;color:#fff;font-size:11.5px;margin-right:7px}
 .hint{font-size:12px;color:#94a3b8;margin:5px 0 0}
 .preview{margin-top:12px;border:1px solid #e2e8f0;border-radius:11px;background:#fff;padding:14px 12px;text-align:center;min-height:62px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px}
 .preview .sig{font-size:34px;line-height:1.2;color:#0f172a;white-space:nowrap;overflow:hidden;max-width:100%}
 .preview .cap{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
 .err{color:#b91c1c;font-weight:700;font-size:13.5px;margin-top:10px;min-height:18px}
</style>
<div class=c>
 <h1>Countersign for ${COMPANY.name}</h1>
 <p class=sub><b>${agent}</b> signed their Independent Contractor Agreement on ${signedOn}. Read it below, then add your signature.</p>

 <div class=doc id=doc>${agreementHtml(row)}</div>
 <p class=read id=read>Scroll to the end of the agreement (or tap &ldquo;Jump to the end&rdquo;) before signing.</p>

 <label><span class=step>1</span> Your name, spelled how you want it signed</label>
 <input id=nm value="Jennifer VonGraupen" autocomplete=name>
 <p class=hint>Already filled in — change it only if you want it to read differently.</p>

 <label><span class=step>2</span> Pick your signature</label>
 <div class=tabs>
   <button type=button id=tType class=on>Choose a style</button>
   <button type=button id=tDraw>Draw it instead</button>
 </div>

 <div id=typeWrap>
   <div class=styles id=styles></div>
   <div class=preview id=preview></div>
 </div>
 <div id=drawWrap style="display:none">
   <canvas id=cv></canvas>
   <div class=row><button class=clr id=clr type=button>Clear</button></div>
 </div>

 <div class=row>
   <button class=jump id=jump type=button>Jump to the end</button>
   <button class=go id=go type=button>Sign &amp; file it</button>
 </div>
 <div class=err id=err></div>
</div>
<script>
const FONTS=[['Dancing Script','cursive'],['Great Vibes','cursive'],['Homemade Apple','cursive'],['Caveat','cursive']];
let mode='type', styleIdx=0, drew=false, read=false;
const $=(id)=>document.getElementById(id);

// Don't enable signing until the agreement has actually been scrolled through.
const doc=$('doc');
const checkRead=()=>{
  if(doc.scrollTop+doc.clientHeight>=doc.scrollHeight-24){
    read=true;$('read').textContent='\u2713 Read to the end — you can sign now.';$('read').style.color='#15803d';
  }
  gate();
};
doc.addEventListener('scroll',checkRead);
setTimeout(checkRead,300);   // a short agreement may need no scrolling at all

function renderStyles(){
  const nm=$('nm').value.trim()||'Your name';
  $('styles').innerHTML=FONTS.map((f,i)=>
    '<div class="sty'+(i===styleIdx?' on':'')+'" data-i="'+i+'"><span style="font-family:\''+f[0]+'\','+f[1]+'">'+
    nm.replace(/[&<>]/g,'')+'</span></div>').join('');
  [...document.querySelectorAll('.sty')].forEach(el=>el.onclick=()=>{styleIdx=+el.dataset.i;renderStyles();gate();});
  const f=FONTS[styleIdx];
  $('preview').innerHTML='<div class=cap>This will be your signature</div>'+
    '<div class=sig style="font-family:\''+f[0]+'\','+f[1]+'">'+nm.replace(/[&<>]/g,'')+'</div>';
}
// NEVER DISABLE THE BUTTON. Jennifer typed her name, pressed Sign & file it and
// nothing happened — a greyed-out button gives no reason and no way forward. It
// now always responds and says exactly what is missing (Neal, 2026-08-25).
function ready(){
  const nm=$('nm').value.trim();
  return read && nm && (mode==='type' || drew);
}
function gate(){
  $('go').className = ready() ? 'go' : 'go notready';
}
$('nm').addEventListener('input',()=>{renderStyles();gate();});
$('tType').onclick=()=>{mode='type';$('tType').className='on';$('tDraw').className='';$('typeWrap').style.display='';$('drawWrap').style.display='none';gate();};
$('tDraw').onclick=()=>{mode='draw';$('tDraw').className='on';$('tType').className='';$('drawWrap').style.display='';$('typeWrap').style.display='none';gate();};

// Draw pad
const cv=$('cv'),ctx=cv.getContext('2d');let down=false;
function fit(){const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=r.width*d;cv.height=r.height*d;ctx.scale(d,d);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.strokeStyle='#0f172a'}
fit();addEventListener('resize',fit);
const pt=e=>{const r=cv.getBoundingClientRect(),t=e.touches?e.touches[0]:e;return[t.clientX-r.left,t.clientY-r.top]};
const start=e=>{e.preventDefault();down=true;drew=true;ctx.beginPath();ctx.moveTo(...pt(e));gate()};
const move=e=>{if(!down)return;e.preventDefault();ctx.lineTo(...pt(e));ctx.stroke()};
cv.addEventListener('mousedown',start);cv.addEventListener('mousemove',move);addEventListener('mouseup',()=>down=false);
cv.addEventListener('touchstart',start,{passive:false});cv.addEventListener('touchmove',move,{passive:false});cv.addEventListener('touchend',()=>down=false);
$('clr').onclick=()=>{ctx.clearRect(0,0,cv.width,cv.height);drew=false;gate()};

// A typed signature becomes the same PNG a drawn one does, so nothing downstream
// has to care which she chose.
function typedPng(){
  const nm=$('nm').value.trim(), f=FONTS[styleIdx];
  const c=document.createElement('canvas'), s=3;
  c.width=760*s; c.height=150*s;
  const x=c.getContext('2d'); x.scale(s,s);
  x.fillStyle='#0f172a'; x.textBaseline='middle';
  x.font="64px '"+f[0]+"', "+f[1];
  x.fillText(nm, 8, 78);
  return c.toDataURL('image/png');
}

$('go').onclick=async()=>{
  const err=$('err'),nm=$('nm').value.trim(),btn=$('go');
  if(!read){
    err.textContent='Please read to the end of the agreement first — use "Jump to the end".';
    doc.scrollTo({top:doc.scrollHeight,behavior:'smooth'});
    return
  }
  if(!nm){err.textContent='Please type your name.';$('nm').focus();return}
  if(mode==='draw'&&!drew){err.textContent='Please draw your signature in the box.';return}
  btn.disabled=true;btn.textContent='Filing…';err.textContent='';
  try{
    const sig = mode==='draw' ? cv.toDataURL('image/png') : typedPng();
    const r=await fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({t:${JSON.stringify(token)},name:nm,signature:sig,style:mode==='draw'?'drawn':FONTS[styleIdx][0]})});
    const j=await r.json();
    if(!j.ok)throw new Error(j.error||'Could not save');
    location.reload();
  }catch(e){err.textContent=e.message;btn.disabled=false;btn.textContent='Sign & file it'}
};
$('jump').onclick=()=>{doc.scrollTo({top:doc.scrollHeight,behavior:'smooth'})};
document.fonts && document.fonts.ready.then(renderStyles);
renderStyles();gate();
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
      // Which of the typed styles she chose (or 'drawn') — part of the audit
      // trail for how the signature was produced.
      company_sign_style: String(b.style || '').slice(0, 40) || null,
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

    // company_sign_style is a newer column. If the migration has not been run,
    // writing it 400s and takes the whole countersignature down with it — a
    // signature lost to an audit field nobody would miss. Save the signature
    // first, then add the style only if the column is there.
    const core = {
      company_signature: merged.company_signature, company_sign_name: merged.company_sign_name,
      company_sign_title: merged.company_sign_title, company_signed_at: nowIso, company_sign_ip: ip,
      ...(path ? { agreement_pdf_path: path } : {}), ...(pdfError ? { pdf_error: `agreement: ${pdfError}` } : {}),
    }
    const { error } = await supabase.from('trainee_onboarding').update(core).eq('countersign_token', t)
    if (error) return json(500, { ok: false, error: error.message })
    if (merged.company_sign_style) {
      const { error: styleErr } = await supabase.from('trainee_onboarding')
        .update({ company_sign_style: merged.company_sign_style }).eq('countersign_token', t)
      if (styleErr) console.warn('company_sign_style not stored (run sql/ic_countersign.sql):', styleErr.message)
    }
    return json(200, { ok: true, signed: true, pdf: path, pdf_error: pdfError })
  }

  if (!token) return html('<p style="font-family:system-ui;padding:24px">This link is missing its code.</p>', 400)
  const { data: row } = await supabase
    .from('trainee_onboarding')
    .select('*')   // the page renders the full agreement, so it needs every filled field
    .eq('countersign_token', token).maybeSingle()
  if (!row) return html('<p style="font-family:system-ui;padding:24px">This link is not valid. Ask the office.</p>', 404)

  const agent = row.agent_legal_name || row.sign_name || 'the rep'
  const signedOn = row.signed_at ? new Date(row.signed_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : ''
  return html(page({ token, agent, signedOn, done: !!row.company_signed_at, row }))
}
