// 🌧 RAIN RADAR on a map (DeWayne, 2026-10-15: "an overlay on the map with the radar" — managers checking where a rep
// is can see at a glance whether that spot is actually under rain; reps see it before they drive). A "🌧 Radar" button
// under the zoom buttons turns a see-through live radar layer on/off (remembered on this device). Free RainViewer
// tiles — the newest radar frame, refreshed every 10 minutes while it's on. Their tiles stop at zoom 10; zoomed in
// further, Leaflet stretches them (rain is blocks-wide anyway).
const KEY = "map_radar_on";
let frame = null, frameAt = 0;
async function latestFrame() {
  if (frame && Date.now() - frameAt < 9 * 60000) return frame;
  const d = await fetch("https://api.rainviewer.com/public/weather-maps.json").then((r) => r.json());
  const p = (d.radar?.past || []).slice(-1)[0];
  frame = p ? { url: `${d.host}${p.path}/256/{z}/{x}/{y}/2/1_1.png`, time: p.time } : null; frameAt = Date.now();
  return frame;
}

export function addRadarControl(L, map) {
  let layer = null, timer = null, on = false, btn = null;
  const label = (t) => { if (btn) btn.innerHTML = on ? `🌧 Radar on${t ? ` · ${new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}` : "🌧 Radar"; if (btn) btn.style.background = on ? "#1d4ed8" : "#fff"; if (btn) btn.style.color = on ? "#fff" : "#0f172a"; };
  const draw = async () => {
    try {
      const f = await latestFrame(); if (!f || !on) return;
      const next = L.tileLayer(f.url, { opacity: 0.6, maxNativeZoom: 10, maxZoom: 20, zIndex: 400, attribution: "Radar © RainViewer" });
      next.addTo(map); if (layer) map.removeLayer(layer); layer = next; label(f.time);
    } catch { /* radar unavailable — leave the map alone */ }
  };
  const set = (v) => {
    on = v; try { localStorage.setItem(KEY, v ? "1" : ""); } catch { /* private */ }
    clearInterval(timer);
    if (on) { draw(); timer = setInterval(draw, 10 * 60000); } else { if (layer) map.removeLayer(layer); layer = null; }
    label();
  };
  const Ctl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      btn = L.DomUtil.create("button");
      btn.type = "button";
      btn.title = "Show live rain radar";
      btn.style.cssText = "font:800 13px system-ui,sans-serif;padding:6px 10px;border-radius:8px;border:2px solid rgba(0,0,0,.25);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.2);white-space:nowrap";
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", (e) => { L.DomEvent.stop(e); set(!on); });
      label();
      return btn;
    },
  });
  const ctl = new Ctl(); ctl.addTo(map);
  let saved = false; try { saved = !!localStorage.getItem(KEY); } catch { /* private */ }
  if (saved) set(true);
  return () => { clearInterval(timer); if (layer) map.removeLayer(layer); ctl.remove(); };
}
