// LOOKS (Neal, 2026-10-04: "when somebody clicks on the devotional … it looks like it's part of
// the page"). Each room picks a look on the admin page; the door, the "no meeting" screen, the
// title bar and the topic banner all take it. 'devotional' matches 915devotional.com: cream,
// navy + gold, Cormorant Garamond headings.
export const LOOKS = {
  team: { bg: '#0b0f17', text: '#e5e7eb', muted: '#94a3b8', head: '#ffffff', card: '#111827', border: '#334155', button: '#2563eb', bar: '#0f172a', field: '#111827', fieldText: '#fff', fieldBorder: '#374151', fontHead: 'inherit', fontBody: 'inherit', banner: null },
  company: { bg: '#0b1426', text: '#e5e7eb', muted: '#9fb0c8', head: '#ffffff', card: '#12203a', border: '#2b3d5e', button: '#c8102e', bar: '#0e1a33', field: '#0e1a33', fieldText: '#fff', fieldBorder: '#2b3d5e', fontHead: "'Oswald', 'Arial Narrow', sans-serif", fontBody: 'inherit', banner: { bg: 'linear-gradient(90deg,#c8102e,#8e0b21)', color: '#fff', font: "'Oswald', 'Arial Narrow', sans-serif", upper: true } },
  devotional: { light: true, bg: '#FAF7F2', text: '#334155', muted: '#6b7280', head: '#1A4870', accent: '#B8893D', card: '#ffffff', border: '#e7e0d3', button: '#1A4870', bar: '#ffffff', field: '#fffdf9', fieldText: '#1f2937', fieldBorder: '#ddd5c6', fontHead: "'Cormorant Garamond', Georgia, 'Times New Roman', serif", fontBody: "Inter, system-ui, sans-serif", banner: { bg: '#1A4870', color: '#fff', font: "'Cormorant Garamond', Georgia, serif", upper: false, rule: '#B8893D' } },
}
export const lookOf = (r) => LOOKS[r?.look] || LOOKS.team
export const FontsFor = ({ look }) => (look === LOOKS.devotional
  ? <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" />
  : <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap" />)
