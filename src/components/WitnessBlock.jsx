// The "IN WITNESS WHEREOF" signature block that closes the main agreement, shown on the signing pages between the
// agreement and Exhibit A, the way the template and the signed PDF have it (Jenn, 2026-11-24: "The ICA is missing
// this"). The PDF (_ic-agreement.js) already drew it; only the pages left it out. Fills in as the rep types.
export default function WitnessBlock({ name, title, phone }) {
  const Row = ({ label, value, hint }) => (
    <div className="flex items-end gap-2 py-1">
      <span className="w-16 shrink-0">{label}</span>
      <span className="flex-1 border-b border-slate-500 pb-0.5 font-medium text-slate-900">{value || <span className="font-normal italic text-slate-400">{hint || ' '}</span>}</span>
    </div>
  )
  return (
    <div className="my-4">
      <p className="mb-3">IN WITNESS WHEREOF, the parties have executed this Independent Contractor Agreement as of the dates set for below.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 font-bold text-slate-900">Agent / Independent Contractor</p>
          <Row label="Signature:" hint="your signature below" />
          <Row label="Printed:" value={name} hint="your printed name below" />
          <Row label="Title:" value={title || 'Independent Contractor'} />
          <Row label="Phone:" value={phone} />
          <Row label="Date:" value={new Date().toLocaleDateString('en-US')} />
        </div>
        <div>
          <p className="mb-1 font-bold text-slate-900">U.S. SHINGLE AND METAL, LLC</p>
          <Row label="Signature:" hint="company signs after you" />
          <Row label="Printed:" hint="company signs after you" />
          <Row label="Title:" />
          <Row label="Date:" />
        </div>
      </div>
    </div>
  )
}
