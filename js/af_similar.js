/* AssetFlow "Find Similar Tracks", rebuilt. The old version mostly matched musical KEY and shared tag names, which says little about
   whether a track fits the same scene. This one compares what an editor hears: mood (happy/sad/relaxed/party/aggressive/acoustic/
   electronic/danceable), genre and style, themes, tempo (half/double time counts as a match), energy and vocals vs instrumental.
   Results are sorted best match first and the banner shows how close they are. Uses the same .af.json analysis, nothing new to run. */
(function(){
"use strict";
const MOODS = ["happy", "sad", "relaxed", "party", "aggressive", "acoustic", "electronic", "danceable"];
const W = { mood: 0.30, genre: 0.25, theme: 0.15, bpm: 0.15, energy: 0.08, vocal: 0.07 };
const clamp = x => Math.max(0, Math.min(1, x));
const wj = (A, B) => { let mn = 0, mx = 0; const K = new Set([...A.keys(), ...B.keys()]); if (!K.size) return null; K.forEach(k => { const a = A.get(k) || 0, b = B.get(k) || 0; mn += Math.min(a, b); mx += Math.max(a, b); }); return mx > 0 ? mn / mx : null; };
function feat(j){ if (!j) return null; const f = { bpm: +j.bpm || 0 }, m = j.mood || {};
  f.mood = MOODS.map(k => typeof m[k] === "number" ? m[k] : null);
  f.genre = new Map(); f.parent = new Map();
  (j.genre_top || []).forEach(g => { if (!g || !g.genre) return; const s = +g.score || 0, p = String(g.genre).split("---")[0].toLowerCase();
    f.genre.set(String(g.genre).toLowerCase(), s); f.parent.set(p, Math.max(f.parent.get(p) || 0, s)); });
  f.theme = new Map(); (j.theme_tags || []).forEach(t => { if (t && t.tag) f.theme.set(String(t.tag).toLowerCase(), +t.score || 0); });
  f.energy = j.energy && typeof j.energy.energy_norm === "number" ? j.energy.energy_norm : null;
  f.vocal = j.instrumentation && typeof j.instrumentation.vocal === "number" ? j.instrumentation.vocal : null;
  return f; }
function score(a, b){ const parts = {};
  { let d = 0, n = 0; for (let i = 0; i < MOODS.length; i++) if (a.mood[i] != null && b.mood[i] != null) { d += Math.abs(a.mood[i] - b.mood[i]); n++; } if (n >= 3) parts.mood = clamp(1 - 2.5 * d / n); }
  { const g1 = wj(a.genre, b.genre), g2 = wj(a.parent, b.parent); if (g1 != null || g2 != null) parts.genre = 0.6 * (g1 || 0) + 0.4 * (g2 || 0); }
  { const t = wj(a.theme, b.theme); if (t != null) parts.theme = t; }
  if (a.bpm > 0 && b.bpm > 0) { const r = Math.min(Math.abs(a.bpm - b.bpm), Math.abs(a.bpm * 2 - b.bpm), Math.abs(a.bpm / 2 - b.bpm)) / b.bpm; parts.bpm = clamp(1 - r / 0.12); }
  if (a.energy != null && b.energy != null) parts.energy = clamp(1 - 2 * Math.abs(a.energy - b.energy));
  if (a.vocal != null && b.vocal != null) parts.vocal = clamp(1 - Math.abs(a.vocal - b.vocal));
  let s = 0, w = 0; for (const k in parts) { s += W[k] * parts[k]; w += W[k]; }
  return w >= 0.4 ? s / w : 0; }
window._afSimilarScore = (j1, j2) => { const a = feat(j1), b = feat(j2); return a && b ? score(a, b) : 0; };   /* for tests */
if (typeof document === "undefined") { if (typeof module !== "undefined") module.exports = { score: window._afSimilarScore }; return; }

/* best match first while a "similar to" list is showing */
const gfOrig = window.getFiltered; let memo = null;
if (typeof gfOrig === "function") window.getFiltered = getFiltered = function(){ const r = gfOrig.apply(this, arguments), S = window._similarScore;
  if (!S || !window._similarFilter || !Array.isArray(r)) return r; if (memo && memo.r === r && memo.S === S) return memo.out;
  const out = r.slice().sort((x, y) => (S.get(y.path) || 0) - (S.get(x.path) || 0)); memo = { r, S, out }; return out; };

function run(){ const ref = typeof ctxAsset !== "undefined" ? ctxAsset : null; try { hideCtx(); } catch (e) {} if (!ref) return;
  const j = _readAfSidecar(ref.path); if (!j) return showToast("This track hasn't been analyzed yet, so there's nothing to compare", "warn");
  const A = feat(j), t0 = Date.now(), res = [];
  for (const a of allAssets) { if (!a || a.category !== "MUSIC" || a.path === ref.path) continue; const k = _readAfSidecar(a.path); if (!k) continue; const s = score(A, feat(k)); if (s > 0) res.push({ a, s }); }
  res.sort((x, y) => y.s - x.s);
  const top = res.filter((r, i) => i < 10 || (r.s >= 0.62 && i < 40));
  if (!top.length) return showToast("No analyzed tracks to compare with yet", "info");
  try { window._afBootLog && _afBootLog("similar: " + res.length + " compared in " + (Date.now() - t0) + "ms"); } catch (e) {}
  window._similarScore = new Map(top.map(r => [r.a.path, r.s])); window._similarFilter = new Set(top.map(r => r.a.path)); window._similarRefName = ref.name;
  try { _gfInvalidate(); } catch (e) {} currentCat = "MUSIC"; document.querySelectorAll(".cat-item").forEach(e => e.classList.remove("active"));
  const c = document.querySelector('.cat-item[data-cat="MUSIC"]'); c && c.classList.add("active"); renderGrid();
  let d = document.getElementById("similar-filter-banner");
  if (!d) { d = document.createElement("div"); d.id = "similar-filter-banner"; d.style.cssText = "position:fixed;top:46px;left:50%;transform:translateX(-50%);background:rgba(28,28,30,0.97);border:1px solid rgba(100,210,255,0.4);border-radius:10px;padding:7px 14px;z-index:560;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);white-space:nowrap;font-size:11px;max-width:92vw;"; document.body.appendChild(d); }
  const pct = Math.round(top[0].s * 100), esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  d.innerHTML = '<span style="color:#64d2ff">🎵 Like: </span><span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;max-width:40vw">' + esc(ref.name) + '</span><span style="color:var(--text3)">' + top.length + " tracks, best first (top match " + pct + '%)</span><button id="similar-clear-btn" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;font-weight:600;padding:0">Clear</button>';
  d.style.display = "flex";
  document.getElementById("similar-clear-btn").onclick = () => { window._similarFilter = null; window._similarScore = null; window._similarRefName = null; try { _gfInvalidate(); } catch (e) {} renderGrid(); d.style.display = "none"; };
  showToast("Most similar first: " + top.length + " tracks", "info", 3000); }
const old = document.getElementById("ctx-similar"); if (!old) return;
const nu = old.cloneNode(true); old.parentNode.replaceChild(nu, old);   /* drops the old key-based handler */
nu.addEventListener("click", run);
})();
