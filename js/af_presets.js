/* Reads Premiere effect-preset files (.prfpset, which are XML) into a compact library AssetFlow can show and apply.
   Works in the panel (node) and from the command line: node af_presets.js <folder> <out.json> */
"use strict";
const fs = require("fs"), path = require("path");
const TPS = 254016000000;
const dec = s => { s = String(s); return s.indexOf("&") < 0 ? s : s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"); };   // most text has nothing to decode
const RX = new Map(), rxT = t => { let r = RX.get(t); if (!r) RX.set(t, r = new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">")); return r; };   // each pattern built once, not per call
const tag = (b, t) => { const m = rxT(t).exec(b); return m ? dec(m[1]) : null; };
const RXR = new Map();
const refs = (b, t) => { const R = []; let re = RXR.get(t); if (!re) RXR.set(t, re = new RegExp("<" + t + " Index=\"(\\d+)\" ObjectRef=\"(\\d+)\"", "g")); re.lastIndex = 0; let m; while ((m = re.exec(b))) R.push([+m[1], m[2]]); return R.sort((a, c) => a[0] - c[0]).map(x => x[1]); };
const RX1 = new Map(), ref = (b, t) => { let r = RX1.get(t); if (!r) RX1.set(t, r = new RegExp("<" + t + " ObjectRef=\"(\\d+)\"")); const m = r.exec(b); return m ? m[1] : null; };
function val(s){ if (s == null) return null; s = String(s).trim(); if (s === "true" || s === "false") return s === "true";
  if (s.indexOf(":") > 0) { const p = s.split(":").map(Number); return p.every(isFinite) ? p : null; }
  const n = Number(s); return isFinite(n) ? n : null; }
function keys(str, t0){ if (!str) return []; return str.split(";").filter(Boolean).map(e => { const a = e.split(","); const t = (Number(a[0]) - t0) / TPS, v = val(a[1]); return v == null || !isFinite(t) ? null : [Math.round(t * 1000) / 1000, v, Number(a[2]) || 0]; }).filter(Boolean); }
function parseFile(file, bundle){
  const s = fs.readFileSync(file, "utf8"), O = {}; const re = /<(\w+) ObjectID="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g; let m;
  while ((m = re.exec(s))) O[m[2]] = { t: m[1], b: m[3] };
  const out = [];
  function walkBin(id, trail){ const o = O[id]; if (!o) return;
    const name = tag(o.b, "Name") || "";
    if (o.t === "BinTreeItem") { const next = name && name !== "Root" && name !== "Presets" ? trail.concat(name) : trail; refs(o.b, "Item").forEach(r => walkBin(r, next)); return; }
    if (o.t !== "TreeItem") return;
    const d = O[ref(o.b, "Data")]; if (!d || d.t !== "FilterPresetItem") return;
    const fx = []; let t0 = null, t1 = null, type = 0, audio = false;
    for (const fr of refs(d.b, "FilterPreset")) { const F = O[fr]; if (!F) continue;
      const a = Number(tag(F.b, "AnchorInPoint")), b = Number(tag(F.b, "AnchorOutPoint")); if (t0 == null && isFinite(a)) { t0 = a; t1 = b; type = Number(tag(F.b, "Type")) || 0; }
      const C = O[ref(F.b, "Component")]; if (!C) continue;
      const P = [];
      refs(C.b, "Param").forEach((pr, i) => { const p = O[pr]; if (!p) return; const n = tag(p.b, "Name"); if (!n) return;
        const tv = tag(p.b, "IsTimeVarying") === "true", K = tv ? keys(tag(p.b, "Keyframes"), isFinite(a) ? a : 0) : [];
        const sv = (tag(p.b, "StartKeyframe") || "").split(",")[1];
        const v = val(sv); if (!tv && v == null) return; P.push(K.length ? { n, i, k: K } : { n, i, v }); });
      if (/^80b8e3d5/.test(tag(F.b, "MediaType") || "")) { audio = true; continue; }   // audio effects (reverb, EQ…) aren't animations
      fx.push({ m: dec(tag(F.b, "FilterMatchName") || tag(C.b, "MatchName") || ""), dn: tag(C.b, "DisplayName") || "", p: P }); }
    if (fx.length) out.push({ n: name, b: [bundle].concat(trail).join(" / "), d: t0 != null && isFinite(t1) ? Math.round((t1 - t0) / TPS * 1000) / 1000 : 0, ty: type, fx }); }
  const root = ref(s, "RootBin"); if (root) walkBin(root, []);
  return out; }
function scan(dir){ const L = [], seen = new Set();
  for (const f of fs.readdirSync(dir)) { if (f.startsWith("._") || !/\.(prfpset|xml)$/i.test(f)) continue;
    const bundle = f.replace(/\.prfpset(\(\d+\))?(\.xml)?$/i, "").replace(/\.xml$/i, "").trim();
    let P = []; try { P = parseFile(path.join(dir, f), bundle); } catch (e) { continue; }
    for (const p of P) { const k = p.b.replace(/\(\d+\)/, "") + "|" + p.n + "|" + JSON.stringify(p.fx).length; if (seen.has(k)) continue; seen.add(k); L.push(p); } }
  return L; }
if (typeof module !== "undefined") module.exports = { scan, parseFile };
if (require.main === module) { const L = scan(process.argv[2]); fs.writeFileSync(process.argv[3], JSON.stringify(L)); console.log(L.length + " presets"); }
