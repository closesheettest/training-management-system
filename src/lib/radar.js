// 🌧 RAIN RADAR on a map (DeWayne, 2026-10-15: "an overlay on the map with the radar" — managers checking where a rep
// is can see at a glance whether that spot is actually under rain; reps see it before they drive; inspectors see it before
// they climb a roof). A "🌧 Radar" button under the zoom buttons turns a see-through live radar layer on/off
// (remembered on this device). National Weather Service NEXRAD radar via Iowa State's free tile service — works down
// to street zoom (RainViewer's free tiles stopped at zoom 7: "Zoom Level Not Supported"). Updated every ~5 minutes at
// the source; the layer reloads every 5 minutes while it's on.
// ▶ PLAY (Neal, 2026-10-15: "obviously it's not moving") loops the last 50 minutes in 5-minute steps so you can see
// which way the rain is heading and how fast.
const KEY = "map_radar_on";
const IEM = (ago) => `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${ago ? `-m${String(ago).padStart(2, "0")}m` : ""}/{z}/{x}/{y}.png`;
const bucket = () => Math.floor(Date.now() / 300000) * 300;   // 5-minute buckets — a fresh query so the browser doesn't keep an old picture
const AGOS = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];       // oldest → now
const tl = (L, ago) => L.tileLayer(`${IEM(ago)}?_=${bucket()}`, { opacity: 0, maxZoom: 20, zIndex: 400, attribution: "Radar: NWS NEXRAD via Iowa Env. Mesonet" });

export function addRadarControl(L, map) {
  let layer = null, timer = null, on = false, btn = null, playBtn = null;
  let loop = null, loopTimer = null, step = 0;
  const clock = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const label = (txt) => {
    if (!btn) return;
    btn.innerHTML = on ? `🌧 Radar on${txt ? ` · ${txt}` : ""}` : "🌧 Radar";
    btn.style.background = on ? "#1d4ed8" : "#fff"; btn.style.color = on ? "#fff" : "#0f172a";
    if (playBtn) { playBtn.style.display = on ? "inline-block" : "none"; playBtn.innerHTML = loop ? "⏸" : "▶ Play"; }
  };
  const draw = () => {
    if (!on || loop) return;
    const next = tl(L, 0).setOpacity(0.6); next.addTo(map);
    if (layer) map.removeLayer(layer); layer = next; label(clock(bucket()));
  };
  const stopLoop = () => {
    clearInterval(loopTimer); loopTimer = null;
    (loop || []).forEach((l) => map.removeLayer(l)); loop = null;
    if (on) { if (layer) layer.setOpacity(0.6); label(clock(bucket())); }
  };
  const startLoop = () => {
    if (layer) layer.setOpacity(0);
    loop = AGOS.map((a) => tl(L, a).addTo(map)); step = 0;
    let hold = 0;
    loopTimer = setInterval(() => {
      if (hold > 0) { hold--; return; }                                  // linger on "now" before starting over
      loop.forEach((l, i) => l.setOpacity(i === step ? 0.6 : 0));
      const ago = AGOS[step];
      label(ago ? `${ago} min ago` : `now · ${clock(bucket())}`);
      step = (step + 1) % loop.length;
      if (step === 0) hold = 3;
    }, 700);
    label("loading…");
  };
  const set = (v) => {
    on = v; try { localStorage.setItem(KEY, v ? "1" : ""); } catch { /* private */ }
    clearInterval(timer);
    if (!on) stopLoop();
    if (on) { draw(); timer = setInterval(draw, 5 * 60000); } else { if (layer) map.removeLayer(layer); layer = null; }
    label(on ? clock(bucket()) : "");
  };
  const style = "font:800 13px system-ui,sans-serif;padding:6px 10px;border-radius:8px;border:2px solid rgba(0,0,0,.25);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.2);white-space:nowrap";
  const Ctl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const wrap = L.DomUtil.create("div");
      wrap.style.cssText = "display:flex;gap:6px;align-items:center";
      btn = L.DomUtil.create("button", "", wrap); btn.type = "button"; btn.title = "Show live rain radar"; btn.style.cssText = style;
      playBtn = L.DomUtil.create("button", "", wrap); playBtn.type = "button"; playBtn.title = "Play the last 50 minutes — see which way the rain is moving";
      playBtn.style.cssText = style + ";background:#fff;color:#0f172a;display:none";
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.on(btn, "click", (e) => { L.DomEvent.stop(e); set(!on); });
      L.DomEvent.on(playBtn, "click", (e) => { L.DomEvent.stop(e); if (loop) stopLoop(); else startLoop(); });
      label();
      return wrap;
    },
  });
  const ctl = new Ctl(); ctl.addTo(map);
  let saved = false; try { saved = !!localStorage.getItem(KEY); } catch { /* private */ }
  if (saved) set(true);
  return () => { clearInterval(timer); stopLoop(); if (layer) map.removeLayer(layer); ctl.remove(); };
}
