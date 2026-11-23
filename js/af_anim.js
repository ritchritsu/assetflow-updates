/* AssetFlow Animate: a library of motion presets (in, out, emphasis, camera) with live previews.
   Double-click a preset (or Apply) and it keyframes the selected clips' Motion / Opacity in Premiere: no templates, fully editable after.
   The preview is drawn from the same keyframes that go into Premiere, so what you see is what you get. */
(function(){
"use strict";
let fs, path; try { fs = require("fs"); path = require("path"); } catch (e) { return; }
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });
function extDir(){ let p = ""; try { p = cs.getSystemPath(SystemPath.EXTENSION); } catch (e) {} return decodeURI(String(p).replace(/^file:\/{2,3}/, "")).replace(/^\/([A-Za-z]:)/, "$1"); }
let ready = null;
function host(){ if (!ready) ready = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_anim.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/afa ok/.test(r || "")) ready = null; return r; }); return ready; }
async function call(fn, arg){ const h = await host(); if (!/afa ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 80) + ")");
  const r = await jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(typeof arg === "string" ? arg : JSON.stringify(arg))) + ")"); const o = JSON.parse(r); if (o && o.error) throw new Error(o.error); return o; }

/* ---------- the presets: keys are [fraction of the duration, value] ---------- */
const op = (...k) => ({ p: "Opacity", k }), sc = (...k) => ({ p: "Scale", k }), po = (...k) => ({ p: "Position", k }), ro = (...k) => ({ p: "Rotation", k });
const fadeIn = op([0, 0], [0.35, 1]);
const jitter = (n, a, decay) => { const k = [[0, [0, 0]]]; for (let i = 1; i < n; i++) { const d = decay ? 1 - i / n : 1, s = i % 2 ? 1 : -1; k.push([i / n, [s * a * d * (0.6 + ((i * 37) % 5) / 10), -s * a * 0.7 * d * (0.5 + ((i * 53) % 5) / 10)]]); } k.push([1, [0, 0]]); return k; };
const IN = [
  ["fade", "Fade in", 0.4, [op([0, 0], [1, 1])]],
  ["pop", "Pop in", 0.45, [sc([0, 0], [0.6, 1.12], [1, 1]), op([0, 0], [0.25, 1])]],
  ["zoomin", "Zoom in", 0.5, [sc([0, 1.35], [1, 1]), fadeIn]],
  ["grow", "Grow", 0.5, [sc([0, 0.6], [1, 1]), fadeIn]],
  ["up", "Slide up", 0.45, [po([0, [0, 0.12]], [1, [0, 0]]), fadeIn]],
  ["down", "Slide down", 0.45, [po([0, [0, -0.12]], [1, [0, 0]]), fadeIn]],
  ["left", "Slide from left", 0.45, [po([0, [-0.18, 0]], [1, [0, 0]]), fadeIn]],
  ["right", "Slide from right", 0.45, [po([0, [0.18, 0]], [1, [0, 0]]), fadeIn]],
  ["drop", "Drop & bounce", 0.6, [po([0, [0, -0.16]], [0.55, [0, 0]], [0.75, [0, -0.03]], [1, [0, 0]]), op([0, 0], [0.2, 1])]],
  ["spin", "Spin in", 0.6, [ro([0, -180], [1, 0]), sc([0, 0], [1, 1])]],
  ["swing", "Swing in", 0.6, [ro([0, -25], [0.6, 6], [1, 0]), fadeIn]],
  ["stretch", "Elastic", 0.7, [sc([0, 0.3], [0.45, 1.15], [0.7, 0.95], [0.85, 1.03], [1, 1]), op([0, 0], [0.2, 1])]],
  ["whip", "Whip in", 0.35, [po([0, [0.45, 0]], [1, [0, 0]]), ro([0, 8], [1, 0])]] ];
const rev = T => T.map(t => ({ p: t.p, k: t.k.map(([f, v]) => [1 - f, v]).reverse() }));
const ON = { "Fade in": "Fade out", "Pop in": "Pop out", "Zoom in": "Zoom out", "Grow": "Shrink", "Slide up": "Slide down out", "Slide down": "Slide up out", "Slide from left": "Slide out left", "Slide from right": "Slide out right", "Drop & bounce": "Lift & go", "Spin in": "Spin out", "Swing in": "Swing out", "Elastic": "Elastic out", "Whip in": "Whip out" };
const OUT = IN.map(([id, n, d, T]) => [id + "-out", ON[n] || n + " out", d, rev(T)]);
const EMPH = [
  ["pulse", "Pulse", 0.5, [sc([0, 1], [0.5, 1.15], [1, 1])]],
  ["beat", "Heartbeat", 0.8, [sc([0, 1], [0.15, 1.12], [0.3, 1], [0.45, 1.12], [0.6, 1], [1, 1])]],
  ["shake", "Shake", 0.5, [po(...jitter(8, 0.012, false))]],
  ["wiggle", "Wiggle", 0.6, [ro([0, 0], [0.2, 7], [0.4, -7], [0.6, 4], [0.8, -2], [1, 0])]],
  ["jump", "Jump", 0.6, [po([0, [0, 0]], [0.4, [0, -0.07]], [0.7, [0, 0]], [0.85, [0, -0.015]], [1, [0, 0]])]],
  ["rubber", "Rubber band", 0.7, [sc([0, 1], [0.3, 1.22], [0.5, 0.9], [0.7, 1.06], [1, 1])]],
  ["flash", "Blink", 0.4, [op([0, 1], [0.3, 0.15], [0.6, 1], [1, 1])]],
  ["tada", "Tada", 0.8, [sc([0, 1], [0.15, 0.92], [0.3, 1.1], [0.9, 1.1], [1, 1]), ro([0, 0], [0.3, -4], [0.45, 4], [0.6, -4], [0.75, 4], [1, 0])]] ];
const CAM = [
  ["punch", "Zoom punch", 0.6, [sc([0, 1], [0.15, 1.2], [0.7, 1.2], [1, 1])]],
  ["snap", "Snap zoom (stay)", 0.2, [sc([0, 1], [1, 1.25])]],
  ["push", "Slow push in", 3, [sc([0, 1], [1, 1.12])]],
  ["pull", "Slow pull out", 3, [sc([0, 1.12], [1, 1])]],
  ["impact", "Impact shake", 0.6, [po(...jitter(10, 0.025, true)), sc([0, 1.06], [1, 1.06])]],
  ["hand", "Handheld", 4, [po([0, [0, 0]], [0.25, [0.006, -0.004]], [0.5, [-0.004, 0.005]], [0.75, [0.005, 0.003]], [1, [0, 0]]), ro([0, 0], [0.33, 0.6], [0.66, -0.5], [1, 0]), sc([0, 1.04], [1, 1.04])]],
  ["tilt", "Dutch tilt", 0.6, [ro([0, 0], [1, 4]), sc([0, 1], [1, 1.08])]],
  ["drift", "Drift right", 3, [po([0, [-0.02, 0]], [1, [0.02, 0]]), sc([0, 1.06], [1, 1.06])]] ];

/* ---------- Effects (CapCut-style looks), made from Premiere's own effects so everything stays editable ----------
   [id, name, group, [effect, {setting: value}]..., preview CSS filter, preview motion ("flicker" | "wobble" | "shake" | "")] */
const E_ = (dn, m, P) => ({ dn, m, p: Object.entries(P).map(([n, v]) => ({ n, v })) });
const HLS = (h, l, s) => E_("Color Balance (HLS)", "AE.ADBE Color Balance (HLS)", { Hue: h, Lightness: l, Saturation: s }), BC = (b, c) => E_("Brightness & Contrast", "AE.ADBE Brightness & Contrast 2", { Brightness: b, Contrast: c });
const NOISE = a => E_("Noise", "AE.ADBE Noise2", { "Amount of Noise": a }), BW = E_("Black & White", "AE.ADBE Black & White", {});
const STROBE = (blend, dur, per) => E_("Strobe Light", "AE.ADBE Strobe", { "Blend With Original": blend, "Strobe Duration (secs)": dur, "Strobe Period (secs)": per });
const LOOKS = [
  ["vintage", "Vintage", "Retro", [HLS(-6, 0, -40), BC(4, 14), NOISE(10)], "sepia(.45) saturate(.75) contrast(1.1)", ""],
  ["oldfilm", "Old film", "Retro", [BW, BC(-4, 22), NOISE(24), STROBE(88, 0.04, 0.13)], "grayscale(1) contrast(1.25) brightness(.95)", "flicker"],
  ["vhs", "VHS", "Retro", [E_("Channel Blur", "AE.ADBE Channel Blur", { "Red Blurriness": 18 }), E_("Wave Warp", "AE.ADBE Wave Warp", { "Wave Height": 2, "Wave Width": 90 }), HLS(0, 0, -15), NOISE(14)], "saturate(.8) contrast(1.1) drop-shadow(2px 0 0 rgba(255,0,80,.7))", "wobble"],
  ["faded", "Faded", "Retro", [BC(10, -30), HLS(0, 0, -25)], "contrast(.75) brightness(1.1) saturate(.75)", ""],
  ["stopmo", "Stop motion", "Retro", [E_("Posterize Time", "AE.ADBE Posterize Time", { "Frame Rate": 8 })], "", "steps"],
  ["bw", "Black & white", "Color", [BW], "grayscale(1)", ""],
  ["noir", "Noir", "Color", [BW, BC(-10, 45)], "grayscale(1) contrast(1.5) brightness(.85)", ""],
  ["vivid", "Vivid", "Color", [HLS(0, 0, 40), BC(0, 12)], "saturate(1.6) contrast(1.12)", ""],
  ["warm", "Warm", "Color", [HLS(-10, 0, 12)], "sepia(.25) saturate(1.2) hue-rotate(-10deg)", ""],
  ["cool", "Cool", "Color", [HLS(14, 0, -5)], "hue-rotate(18deg) saturate(.95)", ""],
  ["dreamy", "Dreamy", "Color", [E_("Gaussian Blur", "AE.ADBE Gaussian Blur 2", { Blurriness: 4 }), BC(10, -10)], "blur(1px) brightness(1.12) contrast(.9)", ""],
  ["invert", "Invert", "Color", [E_("Invert", "AE.ADBE Invert", {})], "invert(1)", ""],
  ["flicker", "Flicker", "Light", [STROBE(70, 0.04, 0.1)], "", "flicker"],
  ["strobe", "Strobe flash", "Light", [STROBE(0, 0.03, 0.25)], "brightness(1.05)", "flicker"],
  ["crisp", "Crisp", "Light", [E_("Sharpen", "AE.ADBE Sharpen", { "Sharpen Amount": 60 })], "contrast(1.15)", ""],
  ["glitch", "Glitch", "Glitch", [E_("Channel Blur", "AE.ADBE Channel Blur", { "Red Blurriness": 40 }), E_("Wave Warp", "AE.ADBE Wave Warp", { "Wave Height": 8, "Wave Width": 30, "Wave Type": 7 }), NOISE(8)], "drop-shadow(3px 0 0 rgba(255,0,60,.8)) drop-shadow(-3px 0 0 rgba(0,220,255,.8))", "shake"],
  ["wavy", "Wavy", "Glitch", [E_("Wave Warp", "AE.ADBE Wave Warp", { "Wave Height": 12, "Wave Width": 120 })], "", "wobble"],
  ["pixel", "Pixelate", "Glitch", [E_("Mosaic", "AE.ADBE Mosaic", { "Horizontal Blocks": 64, "Vertical Blocks": 36 })], "contrast(1.2) saturate(.9)", "pixel"],
  ["grain", "Film grain", "Glitch", [NOISE(28)], "contrast(1.08)", "grain"],
  ["fisheye", "Fisheye", "Lens", [E_("Lens Distortion", "PR.ADBE Lens Distortion", { Curvature: -45 })], "", "bulge"],
  ["pinch", "Pinch", "Lens", [E_("Lens Distortion", "PR.ADBE Lens Distortion", { Curvature: 35 })], "", "pinch"],
  ["mirror", "Mirror", "Lens", [E_("Mirror", "AE.ADBE Mirror", { "Reflection Center": [0.5, 0.5], "Reflection Angle": 0 })], "", "mirror"],
  ["emboss", "Emboss", "Lens", [E_("Color Emboss", "AE.ADBE Color Emboss", { Relief: 2, Contrast: 250, "Blend With Original": 40 })], "contrast(1.4) saturate(.6)", ""] ];
const CATS = [["mine", "My presets", "Where each preset was made for (start, end, or the whole clip)", []], ["in", "In", "Start of the clip", IN], ["out", "Out", "End of the clip", OUT], ["ph", "Emphasis", "At the playhead", EMPH], ["cam", "Camera", "At the playhead (on footage)", CAM], ["fx", "Effects", "The whole clip (stack as many as you like)", []]];
const AT = { in: "in", out: "out", ph: "ph", cam: "ph" };

/* strength scales how far each value goes from "as it is" */
function shape(T, dur, str){ return T.map(t => ({ p: t.p, k: t.k.map(([f, v]) => [Math.round(f * dur * 1000) / 1000,
  t.p === "Position" ? [v[0] * str, v[1] * str] : t.p === "Rotation" ? v * str : t.p === "Opacity" ? v : Math.max(0, 1 + (v - 1) * str)]) })); }

/* ---------- preview: the same keys as CSS keyframes ---------- */
function css(name, T, smooth, look){
  const F = [...new Set(T.flatMap(t => t.k.map(k => k[0])).concat([0, 1]))].sort((a, b) => a - b);
  const at = (t, f) => { const k = t.k; if (f <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (f <= k[i][0]) { const a = k[i - 1], b = k[i], u = (f - a[0]) / Math.max(1e-6, b[0] - a[0]); return Array.isArray(a[1]) ? [a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u] : a[1] + (b[1] - a[1]) * u; } return k[k.length - 1][1]; };
  const get = (p, f, d) => { const t = T.find(x => x.p === p); return t ? at(t, f) : d; };
  const frame = f => { const p = get("Position", f, [0, 0]), bl = get("Blur", f, 0), br = get("Bright", f, 1);
    return "transform:translate(" + (p[0] * 128).toFixed(1) + "px," + (p[1] * 68).toFixed(1) + "px) scale(" + (get("Scale", f, 1) * get("ScaleX", f, 1)).toFixed(3) + "," + get("Scale", f, 1).toFixed(3) + ") rotate(" + get("Rotation", f, 0).toFixed(2) + "deg) rotateY(" + get("RotY", f, 0).toFixed(1) + "deg) rotateX(" + get("RotX", f, 0).toFixed(1) + "deg);opacity:" + Math.min(1, get("Opacity", f, 1)).toFixed(2); };   // only transform + opacity move: no repainting, so dozens of previews stay light
  const run = 0.7;   // the move plays in the first 70% of the loop, then holds
  let out = "@keyframes " + name + "{";
  F.forEach(f => { out += (f * run * 100).toFixed(2) + "%{" + frame(f) + ";animation-timing-function:" + (smooth ? "ease-in-out" : "linear") + "}"; });
  return out + "100%{" + frame(1) + "}}"; }

/* ---------- your own Premiere presets (.prfpset) ---------- */
const DEF_DIR = "F:\\EDITING ASSETS\\ASSETS\\PRPRO PRESETS\\prfpsets";
let LIB = null, libErr = "", mineQ = LS.get("afa_q", ""), mineB = LS.get("afa_b", ""), mineN = 120;
function libSig(dir){ try { return fs.readdirSync(dir).filter(f => /\.(prfpset|xml)$/i.test(f) && !f.startsWith("._")).map(f => { const q = fs.statSync(path.join(dir, f)); return f + ":" + q.size + ":" + Math.round(q.mtimeMs); }).join("|"); } catch (e) { return null; } }
function loadLib(){ const dir = LS.get("afa_pdir", DEF_DIR), sig = libSig(dir), cf = path.join(extDir(), "af_presets_cache.json");
  if (sig == null) { LIB = []; libErr = "Can't open your presets folder: " + dir; return; }
  try { const C = JSON.parse(fs.readFileSync(cf, "utf8")); if (C.dir === dir && C.sig === sig) { LIB = C.L; libErr = ""; return; } } catch (e) {}
  try { LIB = require(path.join(extDir(), "js", "af_presets.js")).scan(dir); libErr = ""; try { fs.writeFileSync(cf, JSON.stringify({ dir, sig, L: LIB })); } catch (e) {} } catch (e) { LIB = []; libErr = "Couldn't read the presets: " + e.message; } }
/* the movement a preset makes (Transform / Motion / Opacity keys), turned into preview keys */
function prevOf(p){ const T = [], mv = p.fx.filter(f => /Geometry2|Motion|Opacity|Basic 3D/.test(f.m) || /^(Transform|Motion|Opacity|Basic 3D)$/.test(f.dn));
  let lo = 1e9, hi = -1e9; mv.forEach(f => f.p.forEach(x => (x.k || []).forEach(k => { lo = Math.min(lo, k[0]); hi = Math.max(hi, k[0]); })));
  const look = lookOf(p); if (!(hi > lo)) return look ? { T: [], span: 1, look } : null; const span = hi - lo, restAtEnd = p.ty !== 2;
  const one = (x, f) => { const K = x.k, rest = (restAtEnd ? K[K.length - 1] : K[0])[1];
    return { p: x.n, k: K.map(([t, v]) => [(t - lo) / span, f(v, rest)]) }; };
  p.fx.forEach(F => F.p.forEach(x => { if (!x.k || x.k.length < 2 || typeof x.k[0][1] !== "number") return;   // animated blur / brightness show too
    if (/Blurriness|Blur Length/.test(x.n)) { const K = x.k; lo = Math.min(lo, K[0][0]); hi = Math.max(hi, K[K.length - 1][0]); T.push({ p: "Blur", k: K, raw: 1 }); }
    else if (x.n === "Brightness" && /Brightness/.test(F.dn)) { const K = x.k; lo = Math.min(lo, K[0][0]); hi = Math.max(hi, K[K.length - 1][0]); T.push({ p: "Bright", k: K.map(([t, v]) => [t, 1 + v / 100]), raw: 1 }); } }));
  mv.forEach(F => F.p.forEach(x => { if (!x.k || x.k.length < 2) return;
    if (x.n === "Scale" || x.n === "Scale Height") { const t = one(x, (v, r) => r ? v / r : 1); t.p = "Scale"; T.push(t); }
    else if (x.n === "Scale Width") { const t = one(x, (v, r) => r ? v / r : 1); t.p = "ScaleX"; T.push(t); }
    else if (x.n === "Swivel") { const t = one(x, (v, r) => v - r); t.p = "RotY"; T.push(t); }
    else if (x.n === "Tilt") { const t = one(x, (v, r) => v - r); t.p = "RotX"; T.push(t); }
    else if (x.n === "Position" && Array.isArray(x.k[0][1])) T.push(one(x, (v, r) => [v[0] - r[0], v[1] - r[1]]));
    else if (x.n === "Rotation") T.push(one(x, (v, r) => v - r));
    else if (x.n === "Opacity") T.push(one(x, (v, r) => r ? Math.min(1.5, v / r) : v / 100)); }));
  T.forEach(t => { if (t.raw) { t.k = t.k.map(([tt, v]) => [(tt - lo) / span, t.p === "Blur" ? Math.min(12, v / 6) : v]); delete t.raw; } });
  return T.length || look ? { T: T.filter((t, i, a) => a.findIndex(u => u.p === t.p) === i), span, look, lo } : null; }
/* the look of the preset's still effects, as a CSS filter (approximate) */
function lookOf(p){ const f = []; p.fx.forEach(F => { const n = F.dn, P = x => { const q = F.p.find(y => y.n === x); return q ? (q.v != null ? q.v : q.k && q.k[q.k.length - 1][1]) : null; };
    if (/Gaussian Blur|Fast Blur|Camera Blur/.test(n)) { const b = P("Blurriness"); if (typeof b === "number" && b > 0) f.push("blur(" + Math.min(10, b / 6).toFixed(1) + "px)"); }
    else if (/Directional Blur/.test(n)) { const b = P("Blur Length"); if (typeof b === "number" && b > 0) f.push("blur(" + Math.min(6, b / 10).toFixed(1) + "px)"); }
    else if (/Drop Shadow/.test(n)) f.push("drop-shadow(3px 4px 3px rgba(0,0,0,.75))");
    else if (/Glow/.test(n)) f.push("drop-shadow(0 0 6px rgba(255,255,255,.9)) brightness(1.15)");
    else if (/Black & White|Tint/.test(n)) f.push("grayscale(1)");
    else if (/Invert/.test(n)) f.push("invert(1)");
    else if (/Brightness & Contrast/.test(n)) { const b = P("Brightness"), c = P("Contrast"); if (typeof b === "number") f.push("brightness(" + (1 + b / 100).toFixed(2) + ")"); if (typeof c === "number") f.push("contrast(" + (1 + c / 100).toFixed(2) + ")"); }
    else if (/Lumetri/.test(n)) f.push("saturate(1.35) contrast(1.1)");
    else if (/Color Balance|Color Replace|Change to Color/.test(n)) f.push("hue-rotate(40deg)");
    else if (/Mosaic/.test(n)) f.push("contrast(1.4) saturate(.6)");
    else if (/Channel Blur|Chromatic/.test(n)) f.push("drop-shadow(2px 0 0 rgba(255,0,60,.8)) drop-shadow(-2px 0 0 rgba(0,200,255,.8))");
    else if (/Turbulent|Wave Warp|Roughen/.test(n)) f.push("contrast(1.2)"); });
  return f.join(" "); }
const prevStyle = el("style"); document.head.appendChild(prevStyle); const prevDone = new Set();
const VIS = new Set();
const seen = new IntersectionObserver(E => { E.forEach(e => { const c = e.target; if (e.isIntersecting) { VIS.add(c); c._play && c._play(); } else { VIS.delete(c); stop(c); } });
  [...VIS].filter(c => c.isConnected && !PLAY.has(c)).sort((a, b) => a.offsetTop - b.offsetTop).forEach(c => c._play && c._play()); }, { root: null, rootMargin: "60px" });   // a freed slot goes to the next visible card
const watch = c => { try { seen.observe(c); } catch (e) { c.classList.add("play"); } };
const pkey = p => p._k || (p._k = p.n.trim().toLowerCase() + "|" + p.ty + "|" + JSON.stringify(p.fx));   // computed once per preset, not on every keystroke
function mine(G){ if (!LIB) { G.innerHTML = '<div class="afa-where">Reading your presets…</div>'; if (Pn.classList.contains("open")) setTimeout(() => { loadLib(); grid(); }, 30); return; }   // read only once the page is opened (keeps AssetFlow's start-up fast)
  if (!LIB._d) { const u = new Set(); LIB = LIB.filter(p => { const k = pkey(p); if (u.has(k)) return false; u.add(k); return true; }); LIB._d = 1; }   // same preset in several packs: once
  const bundles = [...new Set(LIB.map(p => p.b.split(" / ")[0]))].sort((a, b) => a.localeCompare(b));
  const uniq = new Set(), dedup = p => { const k = pkey(p); if (uniq.has(k)) return false; uniq.add(k); return true; };
  const words = mineQ.toLowerCase().split(/\s+/).filter(Boolean).map(w => new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), F = LIB.filter(p => dedup(p) && (!mineB || p.b.split(" / ")[0] === mineB) && words.every(w => w.test((p.n + " " + p.b).toLowerCase())));
  { const T = $("afa-tabs"); if (T && !T._ro && window.ResizeObserver) { T._ro = new ResizeObserver(() => Pn.style.setProperty("--afa-th", (T.offsetHeight + 6) + "px")); T._ro.observe(T); } }   /* tabs and the search row stay in view while scrolling */
  const top = el("div", "afa-mtop", '<input id="afa-mq" placeholder="Search ' + LIB.length + ' presets (e.g. zoom, shake, glitch, out)" value="' + mineQ.replace(/"/g, "&quot;") + '"><select id="afa-mb"><option value="">All packs</option>' + bundles.map(b => '<option' + (b === mineB ? " selected" : "") + ">" + b.replace(/</g, "&lt;") + "</option>").join("") + '</select><button id="afa-mdir" title="Choose your presets folder">Folder…</button>');
  G.parentNode.insertBefore(top, G);
  top.querySelector("#afa-mq").oninput = function(){ mineQ = this.value; LS.set("afa_q", mineQ); mineN = 120; clearTimeout(mine.t); mine.t = setTimeout(() => { const f = document.activeElement === this; grid(); if (f) { const q = $("afa-mq"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 150); };
  top.querySelector("#afa-mb").onchange = function(){ mineB = this.value; LS.set("afa_b", mineB); mineN = 120; grid(); };
  top.querySelector("#afa-mdir").onclick = () => { try { const r = window.cep.fs.showOpenDialogEx(false, true, "Your presets folder", LS.get("afa_pdir", DEF_DIR)); if (r && r.data && r.data[0]) { LS.set("afa_pdir", r.data[0].replace(/^file:\/\//, "")); LIB = null; grid(); } } catch (e) {} };
  $("afa-where").textContent = libErr || (F.length + " of " + LIB.length + " presets · each one goes where it was made for: start, end, or across the whole clip");
  const card = (p, i) => { const id = "m" + LIB.indexOf(p), pv = prevOf(p), fxs = [...new Set(p.fx.map(f => f.dn))].join(" + ");
    const c = el("div", "afa-card" + (pick && pick.mine === p ? " sel" : ""), '<div class="afa-stage">' + ('<div class="afa-tile"' + (pv && pv.look && !pv.T.length ? ' style="filter:' + pv.look + '"' : "") + '>Aa</div>') + '<div class="afa-fxn">' + fxs.replace(/</g, "&lt;") + "</div>" + '</div><div class="afa-name" title="' + (p.b + " / " + p.n).replace(/"/g, "&quot;") + '"><span class="afa-nm">' + p.n.replace(/</g, "&lt;") + "</span><i>" + ({ 0: "↔", 1: "▶", 2: "◀" })[p.ty] + "</i></div>"); c.dataset.id = id;
    if (pv && pv.T.length) { const sm = p.fx.some(f => f.p.some(x => (x.k || []).some(k => k[2] === 5))); c._play = () => play(c, pv.T, pv.span, sm); }
    if (false) c.onmouseenter = () => { if (prevDone.has(id)) return; prevDone.add(id); const nm = "afa_" + id, d = Math.max(0.4, Math.min(2.5, pv.span)); if (!pv.T.length) return; prevStyle.textContent += css(nm, pv.T, p.fx.some(f => f.p.some(x => (x.k || []).some(k => k[2] === 5))), pv.look) + ".afa-card.play[data-id='" + id + "'] .afa-tile{animation:" + nm + " " + (d / 0.7).toFixed(2) + "s infinite}"; };
    c.onclick = () => { pick = { mine: p, 1: p.n }; G.querySelectorAll(".afa-card").forEach(x => x.classList.toggle("sel", x === c)); copyName(p.n); };
    G.appendChild(c); watch(c); };
  /* endless scroll: cards are added in batches as you get near the bottom (no "Show more"), without rebuilding what's already there */
  let shown = 0; const end = el("div", "afa-end");
  const more = () => { const n = Math.min(F.length, shown + 90); for (; shown < n; shown++) card(F[shown], shown); G.appendChild(end); };
  more();
  const io = new IntersectionObserver(E => { if (E.some(e => e.isIntersecting) && shown < F.length) more(); else if (shown >= F.length) io.disconnect(); }, { root: null, rootMargin: "600px" });
  io.observe(end); }

/* ---------- one sound library for all of AssetFlow (Animate, Sound effects on cuts) ---------- */
const SND_T = [["pop", "Pop", /\b(pop|bubble|blip|plop|click|boop|tick)/i], ["whoosh", "Whoosh", /(whoosh|swoosh|swish|swipe|woosh|swoop|wind|transition)/i], ["impact", "Impact", /(impact|hit|boom|punch|thud|slam|braam|stomp|kick|smash|bass)/i], ["soft", "Riser / soft", /(riser|rise|shimmer|sparkle|chime|swell|reverse|magic|ding)/i]];
const Snd = window._afSounds = window._afSounds || (() => { let L = {}; try { L = JSON.parse(localStorage.getItem("af_sounds") || "{}"); } catch (e) {}
  try { const old = JSON.parse(localStorage.getItem("aft_sfx") || "[]"); if (old.length && !(L.whoosh || []).length) L.whoosh = old; } catch (e) {}   // sounds already chosen in Tools
  const save = () => { try { localStorage.setItem("af_sounds", JSON.stringify(L)); } catch (e) {} };
  const PK = {};
  return { get: t => (L[t] || []).filter(f => { try { return fs.existsSync(f); } catch (e) { return true; } }), set: (t, F) => { L[t] = F; save(); }, count: t => (L[t] || []).length,
    last: {}, pick(t){ const F = this.get(t); if (!F.length) return null; let k = Math.floor(Math.random() * F.length); if (F.length > 1 && k === this.last[t]) k = (k + 1) % F.length; this.last[t] = k; return F[k]; },
    fill(dir){ const found = { pop: [], whoosh: [], impact: [], soft: [] }; let n = 0; const walk = d => { if (n > 30000) return; let E; try { E = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        for (const e of E) { const p = path.join(d, e.name); if (e.isDirectory()) { walk(p); continue; } if (!/\.(wav|mp3|aif|aiff|flac|ogg|m4a)$/i.test(e.name)) continue; n++;
          const key = (path.basename(d) + " " + e.name); for (const [t, , re] of SND_T) if (re.test(key)) { if (found[t].length < 60) found[t].push(p); break; } } };
      walk(dir); SND_T.forEach(([t]) => { if (found[t].length) L[t] = found[t]; }); save(); return found; },
    peak(f){ if (PK[f] != null) return Promise.resolve(PK[f]); return new Promise(res => { const ff = fs.existsSync(path.join(extDir(), "ffmpeg.exe")) ? path.join(extDir(), "ffmpeg.exe") : "ffmpeg", B = [];
      let p; try { p = require("child_process").spawn(ff, ["-v", "error", "-i", f, "-t", "8", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { windowsHide: true }); } catch (e) { return res(0); }
      p.stdout.on("data", d => B.push(d)); p.on("error", () => res(0));
      p.on("close", () => { const b = Buffer.concat(B), n = b.length >> 1; let best = 0, bi = 0; for (let i = 0; i + 80 < n; i += 40) { let e = 0; for (let k = i; k < i + 80; k += 4) { const v = b.readInt16LE(k * 2); e += v * v; } if (e > best) { best = e; bi = i; } } PK[f] = bi / 8000; res(PK[f]); }); }); } }; })();
/* which sound an animation needs, and the moment it should hit (seconds from the start of the animation). T = tracks with keys in seconds */
function soundFor(T){ if (!T.length) return null; const t0 = Math.min(...T.map(t => t.k[0][0])), t1 = Math.max(...T.map(t => t.k[t.k.length - 1][0])); if (!(t1 > t0)) return null;
  const at = (t, f) => { const k = t.k; if (f <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (f <= k[i][0]) { const a = k[i - 1], b = k[i], u = (f - a[0]) / Math.max(1e-6, b[0] - a[0]); return Array.isArray(a[1]) ? [a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u] : a[1] + (b[1] - a[1]) * u; } return k[k.length - 1][1]; };
  const N = 80, g = p => T.find(t => t.p === p); let best = 0, bt = t0, travel = 0, rot = 0, flips = 0, lastS = 0, smin = 9, smax = 0;
  for (let i = 1; i <= N; i++) { const a = t0 + (t1 - t0) * (i - 1) / N, b = t0 + (t1 - t0) * i / N; let v = 0;
    if (g("Position")) { const p0 = at(g("Position"), a), p1 = at(g("Position"), b), dx = p1[0] - p0[0], dy = p1[1] - p0[1], d = Math.hypot(dx, dy); travel += d; v += d * 6; const sg = Math.sign(dx + dy); if (sg && lastS && sg !== lastS) flips++; if (sg) lastS = sg; }
    if (g("Scale")) { const s0 = at(g("Scale"), a), s1 = at(g("Scale"), b); v += Math.abs(s1 - s0); smin = Math.min(smin, s1); smax = Math.max(smax, s1); }
    if (g("Rotation")) { const r = Math.abs(at(g("Rotation"), b) - at(g("Rotation"), a)); rot += r; v += r / 90; }
    if (v > best) { best = v; bt = (a + b) / 2; } }
  const r3 = ["RotY", "RotX"].some(p => { const t = g(p); return t && Math.abs(t.k[t.k.length - 1][1] - t.k[0][1]) + Math.max(...t.k.map(k => Math.abs(k[1]))) > 60; });
  if (r3) return { type: "whoosh", t: t0 + (t1 - t0) * 0.4 };
  if (t1 - t0 > 2.5 && !g("Position")) return null;   // slow constant zooms / drifts don't need a sound
  if (!best) return g("Opacity") ? { type: "soft", t: t0 } : null;
  const fast = (t1 - t0) < 0.9;
  if (flips >= 4) return { type: "impact", t: t0 };
  if (g("Scale") && smin < 0.75 && smax > 1.02) return { type: "pop", t: bt };
  if (travel > 0.08 || rot > 30) return { type: "whoosh", t: bt };
  const sc = g("Scale"); if (sc && sc.k[0][1] > 1.15 && Math.abs(sc.k[sc.k.length - 1][1] - 1) < 0.05) return { type: "whoosh", t: t0 + (t1 - t0) * 0.3 };   // zooming in from big
  if (sc && sc.k[sc.k.length - 1][1] > 1.15 && Math.abs(sc.k[0][1] - 1) < 0.05 && g("Opacity")) return { type: "whoosh", t: t0 + (t1 - t0) * 0.6 };   // zooming away
  if (sc && fast) return { type: smax > 1.18 ? "impact" : "pop", t: bt };
  return { type: "soft", t: t0 }; }

/* ---------- previews: one timer moves every visible preview at 24 fps (CSS animations ran at 60 fps and Premiere panels draw on the CPU) ---------- */
const PLAY = new Map();   // card -> {tile, T, period, smooth}
const easeIO = u => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
function valAt(t, f, smooth){ const k = t.k; if (f <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (f <= k[i][0]) { const a = k[i - 1], b = k[i]; let u = (f - a[0]) / Math.max(1e-6, b[0] - a[0]); if (smooth) u = easeIO(u);
    return Array.isArray(a[1]) ? [a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u] : a[1] + (b[1] - a[1]) * u; } return k[k.length - 1][1]; }
function pose(T, f, smooth){ const g = (p, d) => { const t = T.find(x => x.p === p); return t ? valAt(t, f, smooth) : d; }, P = g("Position", [0, 0]), S = g("Scale", 1);
  return ["translate(" + (P[0] * 128).toFixed(1) + "px," + (P[1] * 68).toFixed(1) + "px) scale(" + (S * g("ScaleX", 1)).toFixed(3) + "," + S.toFixed(3) + ") rotate(" + g("Rotation", 0).toFixed(1) + "deg)" + (T.some(t => t.p === "RotY" || t.p === "RotX") ? " perspective(220px) rotateY(" + g("RotY", 0).toFixed(1) + "deg) rotateX(" + g("RotX", 0).toFixed(1) + "deg)" : ""), Math.max(0, Math.min(1, g("Opacity", 1))).toFixed(2)]; }
let tick = null, scrolling = 0;
function runPreviews(){ if (tick) return;
  Pn.addEventListener("scroll", () => { scrolling = performance.now(); }, { passive: true, capture: true });   // nothing moves while you scroll
  tick = setInterval(() => { if (document.hidden || !Pn.classList.contains("open") || !PLAY.size || performance.now() - scrolling < 250) return; const now = performance.now();
    PLAY.forEach(v => { if (v.gpu) return; const ph = (now % v.period) / v.period, f = Math.min(1, ph / 0.7), q = pose(v.T, f, v.smooth); if (v.last === q[0] + q[1]) return; v.last = q[0] + q[1]; v.tile.style.transform = q[0]; v.tile.style.opacity = q[1]; }); }, 1000 / 20); }
/* with the GPU drawing, previews are plain CSS animations: the graphics card moves them at full frame rate with no CPU work.
   Without it (software drawing), a 20 fps timer moves them instead, which costs far less than redrawing 60 times a second. */
const GPU = (() => { try { const g = document.createElement("canvas").getContext("webgl"); if (!g) return false; const d = g.getExtension("WEBGL_debug_renderer_info"), r = String(d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER));
  return !/swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(r); } catch (e) { return false; } })();
const gpuRules = el("style"); document.head.appendChild(gpuRules); const gpuDone = new Set(); let gpuN = 0;
const MAXP = 60;
function play(c, T, dur, smooth){ const tile = c.querySelector(".afa-tile"); if (!tile || !T || !T.length) return;
  const period = Math.max(0.4, Math.min(2.5, dur)) / 0.7;
  if (GPU) { let nm = c._anim; if (!nm) { nm = c._anim = "afg" + (++gpuN); gpuRules.appendChild(document.createTextNode(css(nm, T, smooth))); }
    tile.style.willChange = "transform,opacity"; tile.style.animation = nm + " " + period.toFixed(2) + "s infinite"; PLAY.set(c, { tile, gpu: 1 }); return; }
  PLAY.set(c, { tile, T, period: period * 1000, smooth }); runPreviews(); }
function stop(c){ const v = PLAY.get(c); if (!v) return; PLAY.delete(c); v.tile.style.transform = ""; v.tile.style.opacity = ""; v.tile.style.animation = ""; v.tile.style.willChange = ""; }

/* a small scene (sky, sun, hills) so colour looks show; motion looks get a light CSS animation (cheap: opacity / transform only) */
document.head.appendChild(el("style", null, ".afa-end{grid-column:1/-1;height:1px}.afa-lg{grid-column:1/-1;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3,#888);margin:6px 2px -2px}.afa-scene{position:relative;contain:none}.afa-sky{position:absolute;inset:0;background:linear-gradient(#ff9a5a 0,#d9668f 45%,#5a4f9e 100%)}.afa-sky .sun{position:absolute;left:58%;top:22%;width:20px;height:20px;border-radius:50%;background:#ffe27a}.afa-sky .h1{position:absolute;left:-10%;right:30%;bottom:0;height:42%;background:#2f6b4f;border-radius:50% 50% 0 0}.afa-sky .h2{position:absolute;left:35%;right:-15%;bottom:0;height:30%;background:#244f3b;border-radius:50% 50% 0 0}@keyframes afl-flicker{0%,100%{opacity:1}10%{opacity:.55}14%{opacity:1}40%{opacity:.8}44%{opacity:1}72%{opacity:.6}75%{opacity:1}}@keyframes afl-wobble{0%,100%{transform:translateX(0) skewX(0)}50%{transform:translateX(2px) skewX(3deg)}}@keyframes afl-shake{0%,100%{transform:translate(0)}20%{transform:translate(-2px,1px)}40%{transform:translate(2px,-1px)}60%{transform:translate(-1px,0)}80%{transform:translate(1px,1px)}}@keyframes afl-steps{0%{transform:translateX(-6px)}100%{transform:translateX(6px)}}.m-flicker .afa-sky{animation:afl-flicker .9s infinite}.m-wobble .afa-sky{animation:afl-wobble 1.2s ease-in-out infinite}.m-shake .afa-sky{animation:afl-shake .35s steps(2) infinite}.m-steps .afa-sky{animation:afl-steps 1.6s steps(8) infinite alternate}.m-pixel .afa-sky:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.18) 1px,transparent 1px) 0 0/8px 8px,linear-gradient(rgba(0,0,0,.18) 1px,transparent 1px) 0 0/8px 8px}.m-grain .afa-sky:after{content:'';position:absolute;inset:0;opacity:.35;background:radial-gradient(rgba(255,255,255,.9) .5px,transparent .9px) 0 0/3px 3px,radial-gradient(rgba(0,0,0,.9) .5px,transparent .9px) 1px 2px/4px 4px}.m-bulge .afa-sky{transform:scale(1.18);border-radius:40%}.m-pinch .afa-sky{transform:scale(.86);border-radius:12%}.m-mirror .afa-sky{transform:scaleX(-1)}"));
function looksGrid(G){ let g0 = "";
  LOOKS.forEach(L => { if (L[2] !== g0) { g0 = L[2]; G.appendChild(el("div", "afa-lg", g0)); }
    const c = el("div", "afa-card" + (pick && pick.look === L ? " sel" : ""), '<div class="afa-stage afa-scene' + (L[5] ? " m-" + L[5] : "") + '"><div class="afa-sky" style="filter:' + (L[4] || "none") + '"><i class="sun"></i><i class="h1"></i><i class="h2"></i></div></div><div class="afa-name">' + L[1] + "<i>" + L[3].map(e => e.dn).filter((v, i, a) => a.indexOf(v) === i).length + " fx</i></div>");
    c.title = L[3].map(e => e.dn).join(" + ");
    c.onclick = () => { pick = { look: L, 1: L[1] }; G.querySelectorAll(".afa-card").forEach(x => x.classList.toggle("sel", x === c)); st(L[1] + " (" + c.title + ") — double-click or Apply."); };
    c.ondblclick = () => { c.onclick(); apply(); };
    G.appendChild(c); }); }

/* ---------- page ---------- */
document.head.appendChild(el("style", null,
  "#afa-panel{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09);position:relative;z-index:2}" +
  "#afa-panel.open{display:flex}.afa-wrap{padding:16px 14px 90px}.afa-tabs{position:sticky;top:0;z-index:5;box-shadow:0 0 0 6px #1b1b1b;background:#262626!important}.afa-mtop{position:sticky;top:var(--afa-th,38px);z-index:5;background:#1b1b1b;padding:8px 0 6px;margin-top:-8px;box-shadow:0 6px 8px -6px rgba(0,0,0,.6)}.afa-h{font-size:14px;font-weight:600;color:var(--text,#eee)}.afa-p{font-size:11px;color:var(--text3,#999);line-height:1.5;margin:2px 0 10px}" +
  ".afa-tabs{display:flex;flex-wrap:wrap;gap:4px;background:rgba(255,255,255,.05);border-radius:9px;padding:3px;margin-bottom:6px}.afa-tabs button{flex:1 0 auto;white-space:nowrap;border:0;background:transparent;color:var(--text2,#bbb);font-size:11px;padding:6px 4px;border-radius:7px;cursor:pointer}.afa-tabs button.on{background:var(--accent,#0a84ff);color:#fff}" +
  ".afa-where{font-size:10.5px;color:var(--text3,#888);margin:0 2px 10px}" +
  ".afa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}" +
  ".afa-card{border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;cursor:pointer;background:rgba(255,255,255,.03);transition:border-color .12s,transform .12s}.afa-card:hover{border-color:rgba(255,255,255,.25)}.afa-card.sel{border-color:var(--accent,#0a84ff);box-shadow:0 0 0 1px var(--accent,#0a84ff)}" +
  ".afa-stage{height:68px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#1b2130;contain:strict}" +
  ".afa-tile{width:52px;height:30px;border-radius:6px;background:#6a73ff;display:flex;align-items:center;justify-content:center;color:#fff;font:700 13px/1 system-ui;}" +
  ".afa-name{font-size:10.5px;color:var(--text2,#ccc);padding:6px 8px;display:flex;justify-content:space-between;gap:4px}.afa-name i{font-style:normal;color:var(--text3,#777)}" +
  ".afa-bar{position:sticky;bottom:0;margin:12px -14px -90px;padding:10px 14px;background:rgba(18,18,18,.96);border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:6px}" +
  ".afa-row{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text2,#bbb)}.afa-row>span:first-child{min-width:62px}.afa-row input[type=range]{flex:1}.afa-row b{min-width:40px;text-align:right;font-weight:500;color:#eee}" +
  ".afa-go{border:0;border-radius:8px;background:var(--accent,#0a84ff);color:#fff;font-size:12px;font-weight:600;padding:9px;cursor:pointer}.afa-go:disabled{opacity:.5}.afa-st{font-size:11px;color:var(--text2,#aaa);min-height:14px}" +
  ".afa-mtop{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.afa-mtop input{flex:1 1 130px;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#eee;font-size:11.5px;padding:7px 9px;outline:none}.afa-mtop input:focus{border-color:var(--accent,#0a84ff)}.afa-mtop select{flex:1 1 80px;max-width:140px;min-height:28px;background:#262626;color:#ddd;border:1px solid rgba(255,255,255,.14);border-radius:8px;font-size:11px}.afa-mtop button{min-height:28px;background:transparent;border:1px solid rgba(255,255,255,.14);color:#bbb;border-radius:8px;font-size:11px;padding:0 9px;cursor:pointer}" +
  ".afa-stage{position:relative}.afa-fxn{position:absolute;left:4px;right:4px;bottom:3px;font-size:9px;color:rgba(200,215,235,.75);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.afa-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.afa-more{grid-column:1/-1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#ccc;border-radius:8px;padding:8px;font-size:11px;cursor:pointer}" +
  ".afa-srow{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text2,#bbb)}.afa-sndt{color:var(--text3,#888);font-size:10.5px}.afa-link{margin-left:auto;background:transparent;border:0;color:var(--accent,#0a84ff);font-size:11px;cursor:pointer;padding:0}" +
  ".afa-sbox{display:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px;font-size:11px;color:#bbb}.afa-sbox.open{display:block}.afa-sbox .r{display:flex;align-items:center;gap:8px;margin:3px 0}.afa-sbox .r b{min-width:86px;font-weight:500;color:#ddd}.afa-sbox .r span{color:#888;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.afa-sbox button{background:transparent;border:1px solid rgba(255,255,255,.14);color:#ccc;border-radius:6px;font-size:10.5px;padding:2px 8px;cursor:pointer}" +
  ".afa-sbox input{background:#262626;color:#eee;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:2px 5px;font-size:11px}" +
  ".afa-onrow{display:flex;align-items:flex-start;gap:6px}.afa-on{flex:1;display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:10.5px}.afa-dim{color:var(--text3,#888)}" +
  ".afa-chip{display:inline-flex;align-items:center;gap:4px;background:rgba(10,132,255,.16);border:1px solid rgba(10,132,255,.35);color:#cfe3ff;border-radius:10px;padding:1px 4px 1px 8px}.afa-chip button{background:transparent;border:0;color:#9bb;cursor:pointer;font-size:10px;padding:0 2px}.afa-chip button:hover{color:#fff}" +
  "#afa-panel.pv .afa-bar>*:not(#afa-st){display:none!important}#afa-panel.pv .afa-bar{margin-top:8px}" +
  ".afa-seg{display:flex;gap:3px}.afa-seg button{border:1px solid rgba(255,255,255,.12);background:transparent;color:#bbb;font-size:10.5px;padding:3px 9px;border-radius:12px;cursor:pointer}.afa-seg button.on{background:rgba(255,255,255,.12);color:#fff}"));
const Pn = el("div", null, '<div class="afa-wrap"><div class="afa-h">Animate</div><div class="afa-p" id="afa-p"></div>' +
  '<div class="afa-tabs" id="afa-tabs"></div><div class="afa-where" id="afa-where"></div><div class="afa-grid" id="afa-grid"></div>' +
  '<div class="afa-bar"><div class="afa-row"><span>Duration</span><input type="range" id="afa-dur" min="0" max="1" step="0.01"><b id="afa-durv"></b></div>' +
  '<div class="afa-row"><span>Strength</span><input type="range" id="afa-str" min="0.25" max="2" step="0.05" value="' + LS.get("afa_str", "1") + '"><b id="afa-strv"></b></div>' +
  '<div class="afa-row"><span>Easing</span><div class="afa-seg" id="afa-ease"><button data-v="5">Smooth</button><button data-v="0">Linear</button></div></div>' +
  '<div class="afa-srow"><label><input type="checkbox" id="afa-snd" ' + (LS.get("afa_snd", "0") === "1" ? "checked" : "") + '> Add a matching sound</label><span id="afa-sndt" class="afa-sndt"></span><button id="afa-sndb" class="afa-link">Sounds…</button></div>' +
  '<div class="afa-sbox" id="afa-sbox"></div>' +
  '<button class="afa-go" id="afa-go">Apply to selected clips</button><div class="afa-st" id="afa-st"></div>' +
  '<div class="afa-onrow"><div id="afa-on" class="afa-on"><span class="afa-dim">Select a clip, then ↻ to see its animations.</span></div><button id="afa-onr" class="afa-link" title="Show the animations on the selected clip">↻</button></div></div></div>');
Pn.id = "afa-panel"; ["keydown", "keyup", "contextmenu"].forEach(t => Pn.addEventListener(t, e => e.stopPropagation()));
const $ = id => Pn.querySelector("#" + id), st = m => { $("afa-st").textContent = m; };
let cat = LS.get("afa_cat", "mine"), pick = null, durOver = null, ease = +LS.get("afa_ease", "5");
const styleEl = el("style"); document.head.appendChild(styleEl);
const durOf = () => durOver != null ? durOver : (pick ? pick[2] : 0.5);
const toDur = v => Math.round(Math.pow(v, 2) * 4.9 * 100) / 100 + 0.1, fromDur = d => Math.sqrt(Math.max(0, d - 0.1) / 4.9);   // 0.1 – 5 s, finer at the short end
function showVals(){ $("afa-durv").textContent = durOf().toFixed(2) + " s"; $("afa-strv").textContent = Math.round(+$("afa-str").value * 100) + "%"; $("afa-dur").value = fromDur(durOf()); }
function tabs(){ $("afa-tabs").innerHTML = CATS.map(([k, n]) => '<button data-k="' + k + '" class="' + (k === cat ? "on" : "") + '">' + n + "</button>").join("");
  $("afa-tabs").querySelectorAll("button").forEach(b => b.onclick = () => { cat = b.dataset.k; LS.set("afa_cat", cat); pick = null; durOver = null; tabs(); grid(); }); }
/* your own presets are already in Premiere's Effects panel, so those are preview + copy the name (a native drag is instant and one Ctrl+Z);
   AssetFlow's own animations and looks only exist here, so those keep Apply */
const HELP = { mine: "Your Premiere presets, playing so you can see them. Click one to copy its name, paste it into the Effects panel search (Ctrl+V) and drag it onto your clip.",
  fx: "Looks built from Premiere's own effects. Select clips, then double-click a look (or click it and press Apply). Stack as many as you like.",
  "": "AssetFlow's own animations. Select clips, then double-click one (or click it, adjust it below and press Apply). Each goes on as its own Transform, so you can stack them and take one off later." };
function grid(){ const C = CATS.find(c => c[0] === cat), str = +$("afa-str").value, smooth = ease === 5; $("afa-where").textContent = "Applies at: " + C[2].toLowerCase();
  Pn.classList.toggle("pv", cat === "mine"); $("afa-p").textContent = HELP[cat] || HELP[""]; if (!busy) st("");
  let rules = "", c0 = null; PLAY.clear(); VIS.clear(); gpuRules.textContent = ""; const G = $("afa-grid"); G.innerHTML = ""; Pn.querySelectorAll(".afa-mtop").forEach(x => x.remove());
  Pn.querySelectorAll(".afa-row,.afa-srow").forEach(r => r.style.display = cat === "mine" || cat === "fx" ? "none" : ""); if (cat === "fx") $("afa-sbox").classList.remove("open"); if (cat === "mine") { mine(G); return; } if (cat === "fx") { looksGrid(G); return; }
  C[3].forEach(A => { const nm = "afa_" + A[0].replace(/\W/g, "_"), d = Math.max(0.35, Math.min(1.6, pick && pick[0] === A[0] ? durOf() : A[2]));
    c0 = null; rules += "" + ".afa-card.play[data-id='" + A[0] + "'] .afa-tile{animation:" + nm + " " + (d / 0.7).toFixed(2) + "s infinite}";
    const c = el("div", "afa-card" + (pick && pick[0] === A[0] ? " sel" : ""), '<div class="afa-stage"><div class="afa-tile">Aa</div></div><div class="afa-name">' + A[1] + "<i>" + A[2] + "s</i></div>"); c.dataset.id = A[0];
    c.onclick = () => { pick = A; durOver = null; G.querySelectorAll(".afa-card").forEach(x => x.classList.toggle("sel", x === c)); showVals(); st(A[1] + " — double-click or Apply."); };
    c.ondblclick = () => { pick = A; apply(); };
    { const T = shape(A[3], 1, str), D = d; c._play = () => play(c, T, D, smooth); }
    G.appendChild(c); watch(c); });
  styleEl.textContent = rules; showVals(); }
$("afa-dur").oninput = function(){ durOver = toDur(+this.value); showVals(); };
$("afa-str").oninput = function(){ LS.set("afa_str", this.value); showVals(); grid(); };
$("afa-ease").querySelectorAll("button").forEach(b => { b.classList.toggle("on", +b.dataset.v === ease); b.onclick = () => { ease = +b.dataset.v; LS.set("afa_ease", ease); $("afa-ease").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); grid(); }; });
function sbox(){ const B = $("afa-sbox");
  B.innerHTML = SND_T.map(([t, n]) => '<div class="r"><b>' + n + '</b><span>' + (Snd.count(t) ? Snd.count(t) + " sound" + (Snd.count(t) > 1 ? "s" : "") + ": " + Snd.get(t).slice(0, 2).map(f => path.basename(f)).join(", ") : "none yet") + '</span><button data-t="' + t + '">Choose…</button></div>').join("") +
    '<div class="r" style="margin-top:6px"><button id="afa-sfill">Fill all from a folder…</button><span>Finds pops, whooshes, impacts and risers by their file names.</span></div><div class="r"><b>Volume</b><input type="number" id="afa-sdb" value="' + LS.get("afa_sdb", "-10") + '" step="1" style="width:52px"> dB</div>';
  B.querySelectorAll("button[data-t]").forEach(b => b.onclick = () => { try { const r = window.cep.fs.showOpenDialogEx(true, false, "Choose " + b.dataset.t + " sounds", "", ["wav", "mp3", "aif", "aiff", "flac", "ogg", "m4a"]); if (r && r.data && r.data.length) { Snd.set(b.dataset.t, r.data.map(f => f.replace(/^file:\/\//, ""))); sbox(); sndT(); } } catch (e) {} });
  B.querySelector("#afa-sfill").onclick = () => { try { const r = window.cep.fs.showOpenDialogEx(false, true, "Your sound effects folder", ""); if (r && r.data && r.data[0]) { st("Looking through your sounds…"); setTimeout(() => { const f = Snd.fill(r.data[0].replace(/^file:\/\//, "")); st("Found " + SND_T.map(([t, n]) => f[t].length + " " + n.toLowerCase()).join(", ") + "."); sbox(); sndT(); }, 20); } } catch (e) {} };
  B.querySelector("#afa-sdb").onchange = function(){ LS.set("afa_sdb", this.value); }; }
function sndT(){ const n = SND_T.filter(([t]) => Snd.count(t)).length; $("afa-sndt").textContent = n ? "" : "(choose your sounds first)"; }
$("afa-sndb").onclick = () => { const B = $("afa-sbox"); B.classList.toggle("open"); if (B.classList.contains("open")) sbox(); };
$("afa-snd").onchange = function(){ LS.set("afa_snd", this.checked ? "1" : "0"); if (this.checked && !SND_T.some(([t]) => Snd.count(t))) { $("afa-sbox").classList.add("open"); sbox(); } };
sndT();
/* place the matching sound for each animated clip. T: keys in seconds from the start of the animation; starts: where each animation starts on the timeline */
async function addSounds(T, starts){ if (!$("afa-snd").checked || !starts.length) return "";
  const S = soundFor(T); if (!S) return " No sound needed.";
  let type = S.type; if (!Snd.count(type)) type = ["whoosh", "pop", "impact", "soft"].find(t => Snd.count(t)); if (!type) return " (No sounds chosen yet: Sounds…)";
  const items = []; for (const t0 of starts) { const f = Snd.pick(type); const pk = await Snd.peak(f); items.push([f.replace(/\\/g, "/"), Math.max(0, t0 + S.t - pk)]); }
  try { const r = await window._afTools.callJ("aft_sfxPlace", { items, db: +LS.get("afa_sdb", "-10") || 0, reuse: true }); return " + " + r.placed + " " + (SND_T.find(x => x[0] === type) || [, type])[1].toLowerCase() + " sound" + (r.placed > 1 ? "s" : "") + " on A" + r.track + "."; }
  catch (e) { return " (Sound: " + e.message + ")"; } }
/* every animation AssetFlow adds gets a number (kept here with its name) so it can be listed and removed later */
const TAGS = (() => { try { return JSON.parse(localStorage.getItem("afa_tags") || "{}"); } catch (e) { return {}; } })();
function newTag(name){ let n = +LS.get("afa_tagn", "7000"); n = n >= 8999 ? 7001 : n + 1; LS.set("afa_tagn", String(n)); TAGS[n] = name; try { localStorage.setItem("afa_tags", JSON.stringify(TAGS)); } catch (e) {} return n; }
async function onClip(){ const B = $("afa-on"); try { const r = await call("afa_list"); if (!r.clip) { B.innerHTML = '<span class="afa-dim">Select a clip to see its animations.</span>'; return; }
    B.innerHTML = r.list.length ? '<span class="afa-dim">On ' + r.clip.replace(/</g, "&lt;") + ':</span>' + r.list.map(x => '<span class="afa-chip">' + (TAGS[x.tag] || "Animation").replace(/</g, "&lt;") + '<button data-i="' + x.i + '" data-tag="' + x.tag + '" title="Remove this animation">✕</button></span>').join("") : '<span class="afa-dim">No AssetFlow animations on ' + r.clip.replace(/</g, "&lt;") + ".</span>";
    B.querySelectorAll("button[data-i]").forEach(b => b.onclick = async () => { b.disabled = true; try { await call("afa_remove", { i: +b.dataset.i, tag: +b.dataset.tag }); st("✓ Removed. It's left as an empty Transform in Effect Controls (delete it there if you like)."); } catch (e) { st("⚠ " + e.message); } onClip(); }); }
  catch (e) { B.innerHTML = '<span class="afa-dim">' + e.message + "</span>"; } }
/* preview only: a click copies the preset's exact name, to paste into Premiere's Effects panel search and drag onto the clip
   (native drag and drop is instant and is a single Ctrl+Z; applying from a script is many small steps) */
function copyName(n){ let ok = false; try { const t = document.createElement("textarea"); t.value = n; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch (e) {}
  st((ok ? "📋 Copied “" + n + "”" : "“" + n + "”") + " — paste it into the Effects panel search (Ctrl+V), then drag it onto your clip."); }
let busy = false;
async function apply(){ if (busy) return; if (!pick) { st("Pick an animation first."); return; } busy = true; $("afa-go").disabled = true;
  if (pick.look) { try { const L = pick.look, r = await call("afa_preset", { fx: L[3], ty: 0, d: 1, tag: newTag(L[1]) });
      st(r.missing.length ? "⚠ " + L[1] + ": Premiere doesn't have " + r.missing.join(", ") + " here." : "✓ " + L[1] + " on " + r.done + " clip" + (r.done > 1 ? "s" : "") + ". Stack more if you like; to take it off, delete its effects in Effect Controls (or Ctrl+Z).");
      try { window._afBootLog && _afBootLog("look " + L[0] + " " + r.done + " miss " + r.missing.join("|") + " err " + (r.err || "-") + " np " + (r.np || "-")); } catch (e) {} }
    catch (e) { st("⚠ " + e.message); } finally { busy = false; $("afa-go").disabled = false; onClip(); } return; }
  if (pick.mine) { try { const p = pick.mine, r = await call("afa_preset", { fx: p.fx, ty: p.ty, d: p.d, tag: newTag(p.n) });
      const pv = prevOf(p), Tsec = pv ? pv.T.map(t => ({ p: t.p, k: t.k.map(([f, v]) => [pv.lo + f * pv.span, v]) })) : [];
      const starts = (r.spans || []).map(([s0, e0]) => p.ty === 2 ? e0 - p.d : p.ty === 0 && p.d > 0 ? s0 : s0), scale = (r.spans || []).map(([s0, e0]) => p.ty === 0 && p.d > 0 ? (e0 - s0) / p.d : 1);
      let sn = ""; if (Tsec.length && starts.length) { const sc = scale[0] || 1; sn = await addSounds(Tsec.map(t => ({ p: t.p, k: t.k.map(([tt, v]) => [tt * sc, v]) })), starts); }
      const animated = p.fx.some(f => f.p.some(x => x.k && x.k.length > 1)), bad = animated && !r.keys;
      st(bad ? "⚠ The effect went on but Premiere didn't take its keyframes" + (r.err ? " (" + r.err + ")" : r.np ? " (" + r.np.slice(0, 120) + ")" : "") + ". Send me this message." :
        "✓ " + p.n + " on " + r.done + " clip" + (r.done > 1 ? "s" : "") + (r.missing.length ? ". Not available here: " + r.missing.join(", ") : "") + "." + sn + " Ctrl+Z to undo."); try { window._afBootLog && _afBootLog("preset " + p.n + " " + r.done + " keys " + r.keys + " miss " + r.missing.join("|") + " err " + (r.err || "-") + " np " + (r.np || "-")); } catch (e) {} }
    catch (e) { st("⚠ " + e.message); } finally { busy = false; $("afa-go").disabled = false; onClip(); } return; }
  try { const dur = durOf(), tr = shape(pick[3], dur, +$("afa-str").value), r = await call("afa_layer", { tracks: tr, at: AT[cat], dur, ease, tag: newTag(pick[1]), blur: true });
    const sn = r.done ? await addSounds(tr, r.at || []) : "";
    if (r.done && !r.keys) { st("⚠ The Transform went on but Premiere didn't take its keyframes" + (r.err ? " (" + r.err + ")" : r.np ? " (" + r.np.slice(0, 120) + ")" : "") + ". Send me this message."); try { window._afBootLog && _afBootLog("animate " + pick[0] + " NOKEYS err " + (r.err || "-") + " np " + (r.np || "-")); } catch (e) {} return; }
    st(r.done ? "✓ " + pick[1] + " on " + r.done + " clip" + (r.done > 1 ? "s" : "") + (r.skipped ? " (" + r.skipped + " skipped" + (AT[cat] === "ph" ? ": the playhead isn't over them" : "") + ")" : "") + "." + sn + " Take it off any time with its ✕ below." : "⚠ Nothing changed" + (AT[cat] === "ph" ? ": put the playhead over the selected clip." : "."));
    try { window._afBootLog && _afBootLog("animate " + pick[0] + " " + r.done + "/" + r.skipped + " keys " + r.keys + " err " + (r.err || "-") + " np " + (r.np || "-")); } catch (e) {} }
  catch (e) { st("⚠ " + e.message); } finally { busy = false; $("afa-go").disabled = false; onClip(); } }
$("afa-go").onclick = apply;
$("afa-onr").onclick = onClip;
tabs(); grid();
window._afAnim = { reload: () => { LIB = null; grid(); }, setLib: L => { LIB = L; libErr = ""; grid(); } };

/* ---------- sidebar entry (under Edit, after Tools) ---------- */
let hidGrid = false, waitL = 0;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel", "afx-qc", "afl-panel", "afv-panel", "afk-panel", "aff-panel", "aft-panel"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); Pn.classList.add("open"); if (cat === "mine" && !LIB) grid(); }
  else if (Pn.classList.contains("open")) { Pn.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"), after = document.getElementById("aft-nav"); if (!side || !gw || !after) return false; if (document.getElementById("afa-nav")) return true;
  if (!side.dataset.aflDone && ++waitL < 40) return false;   // let the sidebar be grouped first, so this lands under Edit
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Animate">✨</span> <span class="cat-label">Animate</span>'); nav.id = "afa-nav"; nav.dataset.cat = "__afa__"; nav.dataset.tooltip = "Animate";
  after.parentNode.insertBefore(nav, after.nextSibling); gw.parentNode.insertBefore(Pn, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 240) clearInterval(iv); }, 300); }
})();
