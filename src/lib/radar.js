// 🌧 RAIN RADAR on a map (DeWayne, 2026-10-15: "an overlay on the map with the radar" — managers checking where a rep
// is can see at a glance whether that spot is actually under rain; reps see it before they drive; inspectors see it before
// they climb a roof). A "🌧 Radar" button under the zoom buttons turns a see-through live radar layer on/off
// (remembered on this device). National Weather Service NEXRAD radar via Iowa State's free tile service — works down
// to street zoom (RainViewer's free tiles stopped at zoom 7: "Zoom Level Not Supported"). Updated every ~5 minutes at
// the source; the layer reloads every 5 minutes while it's on.
const KEY = "map_radar_on";
const IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";
async function latestFrame() {
  // A fresh query string each reload so the browser doesn't keep showing an old picture.
  const t = Math.floor(Date.now() / 300000) * 300;   // 5-minute buckets
  return { url: `${IEM}?_=${t}`, time: t };
}

export function addRadarControl(L, map) {
  let layer = null, timer = null, on = false, btn = null;
  const label = (t) => { if (btn) btn.innerHTML = on ? `🌧 Radar on${t ? ` · ${new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}` : "🌧 Radar"; if (btn) btn.style.background = on ? "#1d4ed8" : "#fff"; if (btn) btn.style.color = on ? "#fff" : "#0f172a"; };
  const draw = async () => {
    try {
      const f = await latestFrame(); if (!f || !on) return;
      const next = L.tileLayer(f.url, { opacity: 0.6, maxZoom: 20, zIndex: 400, attribution: "Radar: NWS NEXRAD via Iowa Env. Mesonet" });
      next.addTo(map); if (layer) map.removeLayer(layer); layer = next; label(f.time);
    } catch { /* radar unavailable — leave the map alone */ }
  };
  const set = (v) => {
    on = v; try { localStorage.setItem(KEY, v ? "1" : ""); } catch { /* private */ }
    clearInterval(timer);
    if (on) { draw(); timer = setInterval(draw, 5 * 60000); } else { if (layer) map.removeLayer(layer); layer = null; }
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
