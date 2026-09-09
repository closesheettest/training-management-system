// The Draw Program + Inspection Compensation Plan — the two pay documents every
// rep signs, delivered as ONE form with a SEPARATE signature on each.
//
// Same arrangement as _ic-agreement.js and for the same reason: the full text
// lives here rather than in a template file, because this is what the rep is
// agreeing to — the page they read and the PDF they sign must be the same words,
// so both are generated from this one source.
//
// TWO signatures, not one (Neal, 2026-09-09). These are two different
// commitments — the Draw Program is money we advance and they repay, the
// Compensation Plan is how they get paid — and one signature under a combined
// page leaves it arguable which one they actually agreed to. Two signatures, two
// timestamps, one PDF.
//
// Text is VERBATIM from "Draw Program.docx" and "Inspection Compensation
// Plan.docx". Do not tidy the grammar: this is a pay agreement people sign, and
// the signed copy has to match the document the office circulated.
//
// `_`-prefixed helper module — not a Netlify endpoint.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const COMPANY = {
  name: 'U.S. Shingle and Metal LLC',
  address: '3845 Gateway Centre Blvd, Suite 300 Pinellas Park, FL 33782',
}

// { h: title } | { h2: sub-heading } | { p: paragraph } | { li: bullet }
export const DRAW_PROGRAM = [
  { h: 'Draw Program' },
  { p: 'Draw amounts will be $500 per sold job that has moved to Signed Contract.' },
  { p: 'Draw program extends for a period of 12 weeks from the date you graduated sales training.' },
  { p: 'Draws request are to be emailed to draws@shingleusa.com by Wednesday for that Fridays payroll. Texts message, phone calls or in person conversations are not acceptable.' },
  { h2: 'Qualifications' },
  { p: 'A sales representative must have knocked on 150 doors the week prior and should have no files in “Sales Rep Fix” to qualify to receive a draw.' },
  { h2: 'Repayment' },
  { p: 'Repayment will be 25% of any regular commissions and 100% of any bonus dollars until all draws are repaid.' },
  { p: 'Resign or released from the company and 100% of commissions are held until all draws are repaid.' },
]

export const INSPECTION_COMP = [
  { h: 'Inspection Compensation Plan' },
  { p: 'The dollar amounts are based on inspections that were completed in any given work week (Monday through Sunday) and not on inspections written.' },
  { li: '0 to 4 Inspections = Zero Commission' },
  { li: '5 to 9 Inspections = $50 per inspection' },
  { li: '10 inspections = $1000' },
  { li: 'No additional commissions after 10' },
  { p: 'You should write more than 10 in case you lose some to people who change their minds.' },
  { h2: 'Back To-Public Adjuster (BT-PA)' },
  { p: 'Each Storm Damaged roof that is setup with the Public Adjuster and a claim is filed receives $50' },
  { h2: 'Back To Retail (BTR)' },
  { p: 'Each sales is calculated with the estimated commission percentage and paid the following Friday provided it has moved to Signed Contract.' },
]

// The two documents, in the order they are signed. The page and the PDF both
// iterate this, so adding a third pay document later means adding it here only.
export const DOCUMENTS = [
  { key: 'draw', title: 'Draw Program', blocks: DRAW_PROGRAM },
  { key: 'comp', title: 'Inspection Compensation Plan', blocks: INSPECTION_COMP },
]

const W = 612, H = 792, M = 56

function wrap(s, font, size, maxW) {
  const out = []
  for (const para of String(s).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = word }
      else line = test
    }
    out.push(line)
  }
  return out
}

// d: { rep_name, draw_sign_name, draw_signature, draw_signed_at,
//      comp_sign_name, comp_signature, comp_signed_at, sign_ip }
export async function renderCompAgreementsPdf(d) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold)

  let page = pdf.addPage([W, H])
  let y = H - M
  const need = (h) => { if (y - h < M) { page = pdf.addPage([W, H]); y = H - M } }
  const text = (s, { f = font, size = 11, indent = 0, gap = 6 } = {}) => {
    for (const line of wrap(s, f, size, W - M * 2 - indent)) {
      need(size + 3)
      page.drawText(line, { x: M + indent, y, size, font: f, color: rgb(0, 0, 0) })
      y -= size + 3
    }
    y -= gap
  }

  // One signature block per document. Printed name / signature / date, the same
  // shape as the IC agreement's Exhibit A foot so a rep who has signed that one
  // recognises this.
  const signBlock = async (name, signature, when) => {
    need(72)
    y -= 10
    const on = when ? new Date(when) : new Date()
    page.drawText('Print Name:', { x: M, y, size: 10, font })
    page.drawText(String(name || ''), { x: M + 66, y, size: 10, font })
    page.drawLine({ start: { x: M + 62, y: y - 3 }, end: { x: M + 232, y: y - 3 }, thickness: 0.5 })
    page.drawText('Signature:', { x: M + 244, y, size: 10, font })
    page.drawLine({ start: { x: M + 300, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.5 })
    if (signature && String(signature).startsWith('data:image')) {
      try {
        const png = await pdf.embedPng(Buffer.from(String(signature).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
        const w = 150, h = Math.min((png.height / png.width) * w, 26)
        page.drawImage(png, { x: M + 304, y: y - 2, width: w, height: h })
      } catch { page.drawText(String(name || ''), { x: M + 304, y, size: 10, font }) }
    } else page.drawText(String(name || ''), { x: M + 304, y, size: 10, font })
    y -= 26
    page.drawText('Date Signed:', { x: M, y, size: 10, font })
    page.drawText(on.toLocaleDateString('en-US'), { x: M + 74, y, size: 10, font })
    page.drawLine({ start: { x: M + 70, y: y - 3 }, end: { x: M + 232, y: y - 3 }, thickness: 0.5 })
    y -= 24
  }

  for (let i = 0; i < DOCUMENTS.length; i++) {
    const doc = DOCUMENTS[i]
    // Each document starts its own page — they are signed separately, so they
    // must not run together in a way that makes one signature look like it
    // covers both.
    if (i > 0) { page = pdf.addPage([W, H]); y = H - M }
    for (const b of doc.blocks) {
      if (b.h) {
        need(30)
        const w = bold.widthOfTextAtSize(b.h, 16)
        page.drawText(b.h, { x: (W - w) / 2, y, size: 16, font: bold })
        y -= 30
        continue
      }
      if (b.h2) { need(20); page.drawText(b.h2, { x: M, y, size: 12, font: bold }); y -= 19; continue }
      if (b.li) { text(`•  ${b.li}`, { indent: 22, gap: 2 }); continue }
      text(b.p)
    }
    y -= 6
    await signBlock(
      doc.key === 'draw' ? d.draw_sign_name : d.comp_sign_name,
      doc.key === 'draw' ? d.draw_signature : d.comp_signature,
      doc.key === 'draw' ? d.draw_signed_at : d.comp_signed_at,
    )
  }

  // Electronic-signature footer — what makes this enforceable is the record of
  // how it was signed, so it is printed on the document rather than kept only in
  // the database.
  need(46)
  y -= 8
  const stamp = d.signed_at ? new Date(d.signed_at) : new Date()
  page.drawText(
    `Signed electronically by ${d.rep_name || ''} on ${stamp.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`
    + (d.sign_ip ? ` from IP ${d.sign_ip}` : '') + '.',
    { x: M, y, size: 8.5, font, color: rgb(0.35, 0.35, 0.35) },
  )
  y -= 12
  page.drawText(`${COMPANY.name} · ${COMPANY.address}`, { x: M, y, size: 8.5, font, color: rgb(0.35, 0.35, 0.35) })

  return Buffer.from(await pdf.save())
}
