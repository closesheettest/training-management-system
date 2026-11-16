// The Independent Contractor Agreement (v9.2025) + Exhibit A (11.2025), "Rep .v3 Final" since 2026-11-16, that every
// rep e-signs on Day 1, rendered to PDF with pdf-lib.
//
// The full text lives here rather than in a template file because this is what
// the rep is legally agreeing to — the page they read and the PDF they sign must
// be the same words, so both are generated from this one source.
//
// `_`-prefixed helper module — not a Netlify endpoint.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const COMPANY = {
  name: 'U.S. Shingle and Metal LLC',
  short: 'SHINGLE',
  address: '12910 Automobile Boulevard, Suite A, Clearwater, FL 33762', // v3 agreement address (2026-11-16; was 3845 Gateway Centre Blvd, Pinellas Park)
}

// { h: heading } | { p: paragraph } | { li: bullet } | { n: 'N.', p: text }
// v3 (Neal, 2026-11-16: "We want the new independent contractors agreement to be this that they're signing"): text is
// VERBATIM from "Independant Contractor Agreement v9.2025 & Exhibit A 11.2025 - Rep .v3 Final .pdf". Do not tidy the grammar.
export const AGREEMENT = [
  { h: "Independent Contractor Agreement" },
  { intro: true },
  { p: "WHEREAS, SHINGLE is a Florida limited liability company organized and existing under the laws of the State of Florida that is engaged in the business of \"Residential/Commercial Improvements\" and AGENT desires to become associated with SHINGLE as an independent contractor for the purpose(s) of soliciting and contracting clients for the services provided by or in conjunction with SHINGLE; and to receive a commission from SHINGLE on all agreement(s) entered into between SHINGLE and an entity originally introduced to SHINGLE by AGENT or for entities introduced to AGENT by SHINGLE and in consideration of this agreement the two parties agree as follows:" },
  { n: "1.", p: "The AGENT is not an employee, servant, partner or joint venture of SHINGLE. SHINGLE is not responsible for withholding, and shall not be made liable to withhold, any federal, state or local taxes, social security or Medicare taxes, from the commissions earned by the AGENT. The AGENT shall provide SHINGLE with their Employer Tax Identification number (EIN), if applicable, or Social Security number for IRS Form No. 1099 purposes within 30 days of the execution of this agreement. SHINGLE is not responsible for any injuries the AGENT may sustain while performing their duties." },
  { n: "2.", p: "Neither the AGENT nor any employee of the AGENT shall be entitled to receive any benefits to which SHINGLE employees are entitled; including but not limited to workers' compensation, unemployment compensation, medical insurance, life insurance, paid vacations, paid holidays, pension, profit sharing, or social security, except as may otherwise be provided for under this Agreement. SHINGLE is not obligated to provide training or supervision for or to the AGENT." },
  { n: "3.", p: "The AGENT can terminate this Agreement at any time by giving SHINGLE at least ten (10) days' prior written notice of termination." },
  { n: "4.", p: "SHINGLE can terminate this Agreement, effective upon delivery of written notice of termination to AGENT, if:" },
  { li: "a.  AGENT makes any unauthorized use or disclosure of any Confidential Information or uses, duplicates or discloses any portion of SHINGLE’s confidential information." },
  { li: "b.  AGENT violates any law, ordinance or regulation and does not correct the violation within seventy-two (72) hours after written notice is delivered to AGENT." },
  { li: "c.  AGENT fails to comply with any other provisions of this Agreement and does not correct the failure within thirty (30) days after written notice of the failure to comply is delivered to AGENT." },
  { li: "d.  AGENT portrays or substantially causes potential clients to believe that SHINGLE has any agreement or arrangement with any State or Governmental Offices." },
  { n: "5.", p: "The AGENT agrees to use good-faith efforts to provide SHINGLE with new business opportunities and account leads and to support business development in the areas covered by this agreement." },
  { n: "6.", p: "If any license is required for the AGENT, or any employees of AGENT by reason of any activity in the furtherance of this Agreement, it shall be the sole obligation of the AGENT, or its employees, to obtain such a license or licenses, and to otherwise comply with all legal and/or governmental requirements for the performance of the activities of the AGENT under this Agreement." },
  { n: "7.", p: "AGENT will at all times follow an Industry-acceptable standard for appearance and professionalism while selling services provided by or in conjunction with SHINGLE. AGENT will also use the sales process and sales tools provided by SHINGLE. AGENT will not produce or distribute any sales, marketing or other proprietary materials, whether written or verbal to any other AGENT, entity or individual without express written consent of SHINGLE." },
  { n: "8.", p: "SHINGLE shall always have, in its sole and absolute discretion, the right to not accept and/or to terminate any Residential/Commercial contract, without any obligation or liability whatsoever, including but not limited to loss of commissions or damages to the AGENT. The AGENT has absolutely no authority to bind SHINGLE and shall not represent to anyone or any entity that such authority does exist. All proposals for Residential/Commercial Improvement services shall be submitted to SHINGLE and shall be subject to approval by SHINGLE." },
  { n: "9.", p: "Non-Disclosure of Information Concerning Business; Trade Secrets. Except in connection with the performance of this Agreement, AGENT shall not at any time, either directly or indirectly divulge, disclose, or communicate to any person, firm, corporation, or any entity whatsoever in any manner whatsoever any information of any kind, nature or description concerning any matters affecting or relating to SHINGLE’s business, including, but not limited to, the names of SHINGLE's employees, or clients, or any of SHINGLE's financial, marketing, software, or operational information including sales methods and procurement methods concerning SHINGLE' business. It is expressly understood that the above items are confidential information of and belonging to SHINGLE and these are considered and have been demonstrated to AGENT as protected and are trade secrets of SHINGLE." },
  { p: "Except in connection with its the performance of this Agreement, SHINGLE shall not at any time, either directly or indirectly divulge, disclose, or communicate to any person, firm, corporation, or any entity whatsoever in any manner whatsoever any information of any kind, nature or description concerning any matters affecting or relating to the business of AGENT, including, but not limited to, the names of AGENT's employees, or clients, or any of AGENT's financial, marketing, or operational information including sales methods and procurement methods concerning AGENT's business." },
  { n: "10.", p: "Compensation - AGENT shall be paid a commission fee for operating contracts successfully placed with SHINGLE for providing Residential/Commercial Restoration services. Commissions paid shall be according to the attached schedule “A”. If after 7 days of inactivity or no communication, we will accept that as your resignation, and you will no longer be receiving compensation(s). If AGENT becomes disassociated with SHINGLE, any remaining commissions will be paid according to the letter of this agreement." },
  { n: "11.", p: "Non-Disparagement and Contingent Commission Forfeiture - Upon termination of this Agreement, AGENT agrees that they shall not make, publish, or communicate to any person or entity, in any form—whether orally, in writing, online, or otherwise—any disparaging or knowingly false statements about SHINGLE, its affiliates, officers, employees, clients, products, or services." },
  { p: "For purposes of this Agreement, a “disparaging” statement is defined as any false or malicious statement that would reasonably be expected to damage the reputation, business interests, or goodwill of SHINGLE." },
  { p: "AGENT acknowledges and agrees that compliance with this non-disparagement obligation is a condition precedent to receiving any commissions not yet paid as of the date of disassociation or termination. In the event AGENT breaches this provision, AGENT shall forfeit any unpaid commissions. SHINGLE shall have the sole discretion to determine whether a statement violates this section, provided such discretion is exercised reasonably and in good faith." },
  { p: "Nothing in this section shall be construed to prohibit AGENT from:" },
  { li: "Providing truthful information as required by law or in response to a valid subpoena or government inquiry; or" },
  { li: "Communicating with legal counsel or exercising rights protected by applicable law." },
  { n: "12.", p: "Miscellaneous" },
  { p: "Severability of Provisions. If any provision of this agreement is held to be unenforceable by any court or tribunal for any reason, such unenforceability shall not affect the enforceability of the remaining provisions of this agreement, each of which shall remain in full force and effect and be enforceable in accordance with its terms." },
  { p: "Applicability of Florida Law; Venue. The laws of the State of Florida shall govern the interpretation, performance and enforcement of this agreement. Any litigation between SHINGLE and AGENT arising out of this agreement must be brought in the circuit court in Florida, or in such inferior state court of said county and state which may have jurisdiction because of the amount in controversy." },
  { p: "Waiver. The waiver by SHINGLE of a breach of any provision of this agreement shall not operate or be construed as a waiver of any subsequent breach." },
  { p: "Indemnity. Should either party to this Agreement deem it necessary to institute or defend legal proceedings arising out of the terms of this Agreement, then, and in such event, the prevailing party therein shall be entitled to recover from the non-prevailing party all court costs and attorney’s fees incurred by the prevailing party therein, including, but not limited to, all court costs and attorney’s fees incurred at all trial and appellate levels, and in bankruptcy proceedings. The parties hereby agree to the State Courts of Pinellas County, Florida, as the sole and exclusive venue for any legal proceedings arising between the parties." },
  { p: "Agreement Binding on Successors in Interest. This agreement shall be binding upon and shall inure to the benefit of SHINGLE and AGENT and their respective successors, heirs, and legal representatives." },
  { p: "Entire Agreement. This agreement constitutes the entire agreement between the parties and may not be changed or amended except by a subsequent agreement in writing signed by SHINGLE and AGENT." },
  { p: "Headings. The headings in this Agreement are intended for convenience or reference and shall not affect its interpretation." },
]

export const EXHIBIT_A = [
  { h: "EXHIBIT A" },
  { h2: "Agent Compensation and Payment Terms" },
  { li: "AGENT will be paid according to the fee structure listed on AGENT’S dashboard located at: https://us-shingle-rep-dashboard.netlify.app, for all services sold." },
  { li: "Par pricing may change from time to time based on many factors such as material and labor costs, marketing costs and other expenses which may fluctuate." },
  { li: "Funds collected by Sunday for standard retail sales will be disbursed on the following Friday." },
  { li: "Back to Retail (BTR) sales written from Monday to Sunday are disbursed the following Friday." },
  { li: "All payments are made by ACH or wire transfer. The AGENT’S bank may charge fees, for which SHINGLE is not responsible." },
  { li: "The AGENT must obtain prior approval before selling any services and / or products outside the preset plans, packages, and offerings." },
  { li: "Back to Retail (BTR) sales commissions are calculated by estimating the commission and disbursed the following Friday provided the sale has moved from “Sold” to “Signed Contract”. After installation, if the actual commission differs from the estimate, the amount will be adjusted. Any additional amount owed will be disbursed, and any overpayment will be added to the AGENT’S draw balance." },
  { li: "If the AGENT offers additional services or materials at no charge as an inducement to enter into a contract, the AGENT will be responsible for such costs." },
  { li: "AGENT understands that any special financing expense exceeding 1% of the total contract amount will be shared equally (50/50) by the AGENT and SHINGLE." },
  { li: "If an expense charged to the Agent for a job exceeds the AGENT’S commission for that job, the difference will be added to the AGENT’S draw balance." },
  { h2: "Draw Program" },
  { li: "Draw amounts will be $500 per sold job that has moved to “Signed Contract”." },
  { li: "The draw program extends for a period of 12 weeks from the date AGENT graduates from sales training." },
  { li: "Draw requests are to be emailed to draws@shingleusa.com by Wednesday for that Fridays payroll. Text messages, phone calls or in-person requests will not be accepted." },
  { li: "To qualify for a draw, a sales representative must have knocked on 150 doors during the preceding week and must have no files in “Sales Rep Fix”." },
  { li: "Repayment will be made from 25% of regular commissions and 100% of bonus payments until all draws have been repaid." },
  { li: "If the AGENT resigns or is released from the Company, 100% of the AGENT’S commissions will be withheld until all draws have been repaid." },
  { h2: "Inspection Program" },
  { li: "0 - 4 Inspections: No Commission." },
  { li: "5 - 9 Inspections: $50 per inspection." },
  { li: "10 inspections: $1,000 total." },
  { li: "No additional inspection commissions will be disbursed for more than 10 Inspections completed in a week." },
  { li: "Each storm-damaged roof that is setup with a Public Adjuster and for which a claim is filed will earn $50, payable the following Friday." },
  { li: "Commissions are based on inspections completed, NOT on inspections written." },
  { h2: "AGENT ACKNOWLEDGMENT" },
  { p: "By signing below, the AGENT acknowledges receipt of and agreement to the terms outlined in this Exhibit A." },
  { exhibitSign: true },
]

// HARVESTER EXHIBIT A (Neal, 2026-11-08): a harvester (door-knocker who books appointments for the reps, like William,
// not a sales rep) signs the SAME agreement with this schedule as Exhibit A instead of the sales commission schedule,
// and does not sign the Draw Program / Inspection Compensation Plan. Numbers = the Harvester Comp Plan Neal set
// 2026-11-04 (CCG harvester-pay.js). Who is a harvester = "Harvester" in trainees.departments.
// Mirrored in src/lib/agreementText.js (HARVESTER_EXHIBIT_BLOCKS) — change one, change both.
export const HARVESTER_EXHIBIT_A = [
  { h: 'Exhibit A: Harvester Compensation Schedule' },
  { exhibitIntro: true },
  { p: 'Harvester is paid $100 for each harvested sit: an appointment the Harvester booked that sat with a U.S. Shingle representative.' },
  { p: 'Harvester also earns a $500 bonus at each of 10, 15, 20 and 25 sits in one week.' },
  { p: 'Weeks run Monday through Sunday and are paid the Friday after.' },
  { p: 'All payments are made via ACH or Wire. Please note your bank may charge you fees and SHINGLE is not responsible for those.' },
  { exhibitSign: true },
]

export const isHarvesterDepts = (departments) =>
  Array.isArray(departments) && departments.some((d) => String(d || '').trim().toLowerCase() === 'harvester')

// Adds { harvester } to a trainee_onboarding row by reading the trainee's departments. Any error → not a harvester
// (the normal sales schedule), so a lookup hiccup can never break a regular rep's agreement.
export async function withHarvesterFlag(supabase, row) {
  if (!row?.trainee_id) return row
  try {
    const { data } = await supabase.from('trainees').select('departments').eq('id', row.trainee_id).maybeSingle()
    return { ...row, harvester: isHarvesterDepts(data?.departments) }
  } catch { return row }
}

const M = 56               // page margin
const W = 612, H = 792     // US Letter

function wrap(text, font, size, maxWidth) {
  const out = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) { out.push(line); line = word }
      else line = test
    }
    out.push(line)
  }
  return out
}

// Render the agreement + Exhibit A, with the blanks filled and the signature
// applied. `d` is the trainee_onboarding row plus the trainee's details.
export async function renderAgreementPdf(d) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold)

  let page = pdf.addPage([W, H])
  let y = H - M
  const need = (h) => { if (y - h < M) { page = pdf.addPage([W, H]); y = H - M } }
  const text = (s, { f = font, size = 10.5, indent = 0, gap = 5 } = {}) => {
    for (const line of wrap(s, f, size, W - M * 2 - indent)) {
      need(size + 3)
      page.drawText(line, { x: M + indent, y, size, font: f, color: rgb(0, 0, 0) })
      y -= size + 3
    }
    y -= gap
  }

  const signedOn = d.signed_at ? new Date(d.signed_at) : new Date()
  const dd = signedOn.getDate(), mm = signedOn.toLocaleString('en-US', { month: 'long' }), yy = String(signedOn.getFullYear()).slice(2)

  // The signature block closes the MAIN AGREEMENT and Exhibit A follows it, the
  // way the template has always read. Emitting everything in one pass pushed
  // "In Witness Whereof" to the end of Exhibit A — nothing was missing, but Jen
  // compares the signed copy against the blank template and a signature block in
  // the wrong place is exactly the kind of difference that stops her signing
  // (Neal, 2026-08-25).
  const draw = async (blocks) => {
  for (const block of blocks) {
    if (block.pagebreak) { page = pdf.addPage([W, H]); y = H - M; continue }
    // v3 Exhibit A has sub-headings (Agent Compensation and Payment Terms / Draw Program / Inspection Program / AGENT ACKNOWLEDGMENT).
    if (block.h2) {
      need(22)
      const w = bold.widthOfTextAtSize(block.h2, 12)
      page.drawText(block.h2, { x: (W - w) / 2, y, size: 12, font: bold })
      y -= 20
      continue
    }
    if (block.h) {
      need(26)
      const w = bold.widthOfTextAtSize(block.h, 16)
      page.drawText(block.h, { x: (W - w) / 2, y, size: 16, font: bold })
      y -= 30
      continue
    }
    if (block.intro) {
      text(`This Independent Contractor Agreement (“Agreement”) is entered into as of the ${dd} day of ${mm}, 20${yy} by and between ${COMPANY.name}, a Florida limited liability company (SHINGLE) with an address at ${COMPANY.address} and ${d.agent_legal_name || d.sign_name || ''} (AGENT) whose address is ${d.agent_address || ''} and whose email address is ${d.agent_email || ''}.`) // v3 wording (2026-11-16)
      continue
    }
    if (block.exhibitIntro) {
      text(`This Exhibit A form is part of the Independent Contractor Partner Agreement date effective as of this ${dd} day of ${mm}, 20${yy} between ${COMPANY.name} and ${d.agent_legal_name || d.sign_name || ''} (Independent Contractor).`)
      continue
    }
    if (block.exhibitSign) {
      // Print Name / Signature / Date Signed, as the template has at the foot of
      // Exhibit A. The rep signed the whole document in one action, so the same
      // signature stands here.
      need(82)
      y -= 30 // room for the Initials line above, clear of the paragraph before it (v3 ends Exhibit A with a sentence, 2026-11-16)
      const who = d.agent_legal_name || d.sign_name || ''
      // Initials, only when we have them. An agreement signed before the field
      // existed must not render with an empty initials line implying something
      // is missing from it.
      if (d.agent_initials) {
        page.drawText('Initials:', { x: W - M - 150, y: y + 26, size: 10, font })
        page.drawText(String(d.agent_initials).toUpperCase(), { x: W - M - 96, y: y + 26, size: 11, font: bold })
        page.drawLine({ start: { x: W - M - 100, y: y + 23 }, end: { x: W - M, y: y + 23 }, thickness: 0.5 })
      }
      page.drawText('Print Name:', { x: M, y, size: 10, font })
      page.drawText(who, { x: M + 66, y, size: 10, font })
      page.drawLine({ start: { x: M + 62, y: y - 3 }, end: { x: M + 232, y: y - 3 }, thickness: 0.5 })
      page.drawText('Signature:', { x: M + 244, y, size: 10, font })
      page.drawLine({ start: { x: M + 300, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.5 })
      if (d.signature && String(d.signature).startsWith('data:image')) {
        try {
          const png = await pdf.embedPng(Buffer.from(String(d.signature).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
          const w = 150, h = Math.min((png.height / png.width) * w, 26)
          page.drawImage(png, { x: M + 304, y: y - 2, width: w, height: h })
        } catch { page.drawText(who, { x: M + 304, y, size: 10, font }) }
      } else page.drawText(who, { x: M + 304, y, size: 10, font })
      y -= 26
      page.drawText('Date Signed:', { x: M, y, size: 10, font })
      page.drawText(signedOn.toLocaleDateString('en-US'), { x: M + 74, y, size: 10, font })
      page.drawLine({ start: { x: M + 70, y: y - 3 }, end: { x: M + 232, y: y - 3 }, thickness: 0.5 })
      y -= 20
      continue
    }
    if (block.li) { text(/^[a-z]\.\s/.test(block.li) ? block.li : `•  ${block.li}`, { indent: 22 }); continue } // v3 4.a–d are lettered, not bulleted
    if (block.n) { text(`${block.n}    ${block.p}`, { indent: 0 }); continue }
    text(block.p)
  }
  }

  await draw(AGREEMENT)

  // ── signature block ────────────────────────────────────────────────────────
  need(190)
  y -= 10
  text('IN WITNESS WHEREOF, the parties have executed this Independent Contractor Agreement as of the dates set for below.', { size: 10 }) // v3 wording (2026-11-16)
  need(160)
  page.drawText('Agent / Independent Contractor', { x: M, y, size: 11, font: bold })
  page.drawText(COMPANY.name.toUpperCase(), { x: W / 2 + 10, y, size: 11, font: bold })
  y -= 34

  if (d.signature && String(d.signature).startsWith('data:image')) {
    try {
      const png = await pdf.embedPng(Buffer.from(String(d.signature).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      const w = 170, h = Math.min((png.height / png.width) * w, 34)
      page.drawImage(png, { x: M + 58, y: y - 4, width: w, height: h })
    } catch { /* fall through to the typed name below */ }
  }
  // The COMPANY countersignature, drawn in the right-hand column that has always
  // been headed with the company name and left blank. An agreement signed by only
  // one party is not executed, so the PDF is not rendered at all until Jennifer
  // has signed too (Neal, 2026-08-24).
  const RX = W / 2 + 10
  const yTop = y
  if (d.company_signature && String(d.company_signature).startsWith('data:image')) {
    try {
      const png = await pdf.embedPng(Buffer.from(String(d.company_signature).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      const w = 170, h = Math.min((png.height / png.width) * w, 34)
      page.drawImage(png, { x: RX + 58, y: y - 4, width: w, height: h })
    } catch { /* typed name below still stands */ }
  }
  const coSignedOn = d.company_signed_at ? new Date(d.company_signed_at) : signedOn
  let ry = y
  const rowRight = (label, value, dy = 22) => {
    page.drawText(label, { x: RX, y: ry, size: 10, font })
    page.drawText(String(value || ''), { x: RX + 58, y: ry, size: 10, font })
    page.drawLine({ start: { x: RX + 54, y: ry - 3 }, end: { x: W - M, y: ry - 3 }, thickness: 0.5 })
    ry -= dy
  }
  rowRight('Signature:', d.company_signature ? '' : (d.company_sign_name || ''))
  rowRight('Printed:', d.company_sign_name)
  rowRight('Title:', d.company_sign_title || 'Authorized Representative')
  rowRight('Date:', coSignedOn.toLocaleDateString('en-US'))
  y = yTop

  const row = (label, value, dy = 22) => {
    page.drawText(label, { x: M, y, size: 10, font })
    page.drawText(String(value || ''), { x: M + 58, y, size: 10, font })
    page.drawLine({ start: { x: M + 54, y: y - 3 }, end: { x: W / 2 - 20, y: y - 3 }, thickness: 0.5 })
    y -= dy
  }
  row('Signature:', d.signature ? '' : (d.sign_name || ''))
  row('Printed:', d.sign_name)
  row('Title:', d.sign_title || 'Independent Contractor')
  row('Date:', signedOn.toLocaleDateString('en-US'))
  row('Phone:', d.agent_phone)
  row('DOB:', d.agent_dob ? new Date(`${d.agent_dob}T12:00:00Z`).toLocaleDateString('en-US') : '')
  row('Social/EIN:', d.w9_tin ? `•••••-${String(d.w9_tin).replace(/\D/g, '').slice(-4)}` : '')

  y -= 8
  text(`AGENT signed electronically on ${signedOn.toLocaleString('en-US')}${d.sign_ip ? ` from ${d.sign_ip}` : ''}.`, { size: 8 })
  if (d.company_signed_at) {
    text(`${COMPANY.name} countersigned electronically on ${new Date(d.company_signed_at).toLocaleString('en-US')} by ${d.company_sign_name || ''}${d.company_sign_ip ? ` from ${d.company_sign_ip}` : ''}.`, { size: 8 })
  }
  text("Each signer's typed name, drawn signature, timestamp and IP address constitute their electronic signature.", { size: 8 })

  // Exhibit A last, on its own page, as the template has it.
  page = pdf.addPage([W, H]); y = H - M
  await draw(d.harvester ? HARVESTER_EXHIBIT_A : EXHIBIT_A)

  return Buffer.from(await pdf.save()).toString('base64')
}
