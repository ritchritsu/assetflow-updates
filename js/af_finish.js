/* AssetFlow — Quality check for the open Premiere sequence (read-only).
   Finds: black gaps and flash frames, 1–2 frame clips and very short clips, audio out of sync with its video, the same footage
   used twice, missing/offline media, disabled clips, muted tracks, and (when "listen" is on) dead air, clipping and loudness jumps.
   Problems on the same stretch of timeline are merged into one row with a start–end range. Click a row: the playhead jumps there
   and the clips involved are selected, so Delete / Shift+Delete works straight away. The list updates by itself after you edit. */
(function(){
"use strict";
let fs, path, cp; try { fs = require("fs"); path = require("path"); cp = require("child_process"); } catch (e) { return; }
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });
function extDir(){   // CEP gives "file:///C:/Users/.../AssetFlow_v25" - turn it into a normal path
  try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || "";
    if (raw) { const t = decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, "")); return process.platform === "win32" ? path.normalize(t) : "/" + t.replace(/^\/+/, ""); } } catch (e) {}
  try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
function ffmpegPath(){ for (const p of [path.join(extDir(), "ffmpeg.exe"), path.join(extDir(), "ffmpeg")]) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return "ffmpeg"; }
let jsxReady = null;
function host(){ if (!jsxReady) jsxReady = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_finish.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/afx ok/.test(r || "")) jsxReady = null; return r; }); return jsxReady; }
async function call(fn, arg){ const h = await host(); if (!/afx ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 100) + ")");
  return jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(typeof arg === "string" ? arg : JSON.stringify(arg))) + ")"); }
async function seqInfo(levels){ let r; try { r = await call("afx_seqInfo", levels ? "1" : "0"); r = JSON.parse(r); } catch (e) { r = { error: /JSON/.test(e.message) ? "Premiere did not answer (" + String(r).slice(0, 80) + ")" : e.message }; } return r; }

/* ---------- read the sequence fast: Premiere exports it as XML in one go, we parse it here ---------- */
function parseXml(txt, id, fps0, name){
  const doc = new DOMParser().parseFromString(txt, "text/xml"), seq = doc.querySelector("sequence"); if (!seq) throw new Error("bad XML");
  const kid = (n, t) => { for (const c of n.children) if (c.tagName === t) return c; return null; }, num = (n, t, d) => { const c = n && kid(n, t); const v = c ? parseFloat(c.textContent) : NaN; return isFinite(v) ? v : d; };
  const rate = kid(seq, "rate"), tb = num(rate, "timebase", 30), ntsc = /TRUE/i.test((kid(rate, "ntsc") || {}).textContent || ""), fps = fps0 > 1 ? fps0 : (ntsc ? tb * 1000 / 1001 : tb), F = 1 / fps;
  const files = {}, fdur = {}; doc.querySelectorAll("file[id]").forEach(f => { const pu = kid(f, "pathurl"); if (pu && pu.textContent) { let p = decodeURIComponent(pu.textContent.replace(/^file:\/\/(localhost)?\/?/i, "")); if (/^[A-Za-z]:/.test(p)) p = p.replace(/\//g, "\\"); else p = "/" + p.replace(/^\/+/, ""); files[f.getAttribute("id")] = p; const fr_ = kid(f, "rate"), fd = num(f, "duration", 0), ftb = num(fr_, "timebase", tb) * (/TRUE/i.test((kid(fr_ || f, "ntsc") || {}).textContent || "") ? 1000 / 1001 : 1); if (fd > 0 && ftb > 0) fdur[p] = fd / ftb; } });
  const media = kid(seq, "media"), TPS = 254016000000;
  const grab = (kind, label) => { const sec = media && kid(media, kind), out = []; if (!sec) return out; let ti = 0;
    for (const tr of sec.children) { if (tr.tagName !== "track") continue; const en = kid(tr, "enabled"), L = []; let k = 0, prevTx = null;
      for (const it of tr.children) {
        if (it.tagName === "transitionitem") { prevTx = [num(it, "start", 0) * F, num(it, "end", 0) * F]; const al = ((kid(it, "alignment") || {}).textContent || "center").toLowerCase(); prevTx.push(/start/.test(al) ? prevTx[0] : /end/.test(al) ? prevTx[1] : (prevTx[0] + prevTx[1]) / 2);
          if (L.length && L[L.length - 1].e < 0) { L[L.length - 1].e = prevTx[1]; L[L.length - 1].tout = prevTx; } continue; }
        if (it.tagName !== "clipitem") continue;
        let s = num(it, "start", -1), e = num(it, "end", -1); const tin = s < 0 && prevTx ? prevTx : null; s = s >= 0 ? s * F : (prevTx ? prevTx[0] : 0); e = e >= 0 ? e * F : -1; prevTx = null;
        const ti_ = num(it, "pproTicksIn", NaN), to_ = num(it, "pproTicksOut", NaN), cr = kid(it, "rate"), cfps = cr ? (num(cr, "timebase", tb) * (/TRUE/i.test((kid(cr, "ntsc") || {}).textContent || "") ? 1000 / 1001 : 1)) : fps;
        const inS = isFinite(ti_) ? ti_ / TPS : num(it, "in", 0) / cfps, outS = isFinite(to_) ? to_ / TPS : num(it, "out", 0) / cfps;
        const fe = kid(it, "file"), path_ = fe ? (files[fe.getAttribute("id")] || "") : "", ce = kid(it, "enabled");
        let remap = 0; for (const fl of it.children) { if (fl.tagName !== "filter") continue; const ef = kid(fl, "effect"); if (!ef || !/time\s*remap/i.test(((kid(ef, "name") || {}).textContent || "") + ((kid(ef, "effectid") || {}).textContent || ""))) continue;
          for (const pm of ef.children) if (pm.tagName === "parameter" && /speed/i.test((kid(pm, "parameterid") || {}).textContent || "")) { const v = num(pm, "value", 100); if (v > 0) remap = v / 100; } }
        const stk = kid(it, "sourcetrack"); L.push({ k: k++, name: (kid(it, "name") || {}).textContent || "", s, e, in: inS, out: outS, path: path_, dur: fdur[path_] || 0, off: false, dis: !!ce && /FALSE/i.test(ce.textContent), st: Math.max(1, num(stk, "trackindex", 1)), tin, remap }); }
      /* speed: Premiere writes a "Time Remap" filter for speed-changed clips. Without one, a length difference of about a frame is
         rounding in the export (Premiere often writes pproTicksOut one frame long on audio clips next to a crossfade), not a speed
         change: treat it as 100% and trust the timeline length, or linked video/audio stop matching and drift out of sync. */
      L.forEach(c => { if (c.e < 0) c.e = c.s + (c.out - c.in); const len = c.e - c.s, src = c.out - c.in;
        if (c.remap > 0) c.spd = c.remap; else if (len > 0 && Math.abs(src - len) <= F * 1.01) { c.spd = 1; c.out = c.in + len; } else c.spd = len > 0 ? src / len : 1;
        if (Math.abs(c.spd - 1) < 0.002) c.spd = 1; delete c.remap; });
      out.push({ i: ti, name: label + (ti + 1), mute: !!en && /FALSE/i.test(en.textContent), clips: L }); ti++; }
    return out; };
  const v = grab("video", "V"), a = grab("audio", "A"), end = [...v, ...a].reduce((m, t) => t.clips.reduce((m2, c) => Math.max(m2, c.e), m), Math.max(num(seq, "duration", 0) * F, 0));   /* no huge argument list (crashed past ~100k clips) */
  return { name, id, fps, end, v, a, viaXml: true }; }
const os_ = (() => { try { return require("os"); } catch (e) { return null; } })();
async function readSeq(){
  const f = path.join(os_ ? os_.tmpdir() : extDir(), "assetflow_qc_" + process.pid + ".xml");
  try { const r = String(await call("afx_exportXml", f.replace(/\\/g, "/"))); if (/^1\|/.test(r)) { const [, id, fps, ...nm] = r.split("|"); const txt = fs.readFileSync(f, "utf8"); try { fs.unlinkSync(f); } catch (e) {} const S = parseXml(txt, id, +fps, nm.join("|")); S.xml = txt; return S; } }
  catch (e) { if (/helper/.test(e.message)) return { error: e.message }; }
  return seqInfo(false); }   // fallback: ask Premiere clip by clip (slow on huge sequences)

/* ---------- audio listening: ONE ffmpeg pass per source file (not per clip), 0.05 s peak + loudness steps ---------- */
const STEP = 0.05, running = new Set(), cache = new Map();   // cache: path -> [{a, b, pk: Float32Array, rms: Float32Array}]
function stopAll(){ running.forEach(p => { try { cp.exec("taskkill /pid " + p.pid + " /T /F"); } catch (e) { try { p.kill(); } catch (_) {} } }); running.clear(); }
function scanSpan(file, a, b, onProg){ return new Promise(res => {
  const n = Math.max(1, Math.ceil((b - a) / STEP)), pk = new Float32Array(n).fill(-200), rms = new Float32Array(n).fill(-200);
  let p; try { p = cp.spawn(ffmpegPath(), ["-hide_banner", "-nostats", "-ss", String(Math.max(0, a)), "-t", String(b - a), "-i", file, "-map", "0:a:0", "-vn",
    "-af", "aresample=48000,asetnsamples=n=" + Math.round(48000 * STEP) + ":p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level+RMS_level,ametadata=mode=print", "-f", "null", "-"], { windowsHide: true }); }
  catch (e) { return res({ ok: false, err: e.message }); }
  running.add(p); let buf = "", fr = -1, tail = "", got = 0;
  const line = l => { let m;
    if ((m = /frame:(\d+)/.exec(l))) { fr = +m[1]; if (fr % 500 === 0 && onProg) onProg(Math.min(1, fr / n)); }
    else if ((m = /Overall\.Peak_level=(-?[\d.]+|-?inf)/.exec(l)) && fr >= 0 && fr < n) { pk[fr] = /inf/.test(m[1]) ? -200 : +m[1]; got++; }
    else if ((m = /Overall\.RMS_level=(-?[\d.]+|-?inf)/.exec(l)) && fr >= 0 && fr < n) rms[fr] = /inf/.test(m[1]) ? -200 : +m[1];
    else if (!/Parsed_ametadata/.test(l)) tail = (tail + l + "\n").slice(-2000); };
  p.stderr.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  p.on("error", e => { running.delete(p); res({ ok: false, err: e.message }); });
  p.on("close", c => { running.delete(p); if (buf) line(buf); res(got ? { ok: true, a, b, pk, rms, len: fr + 1 } : { ok: false, err: (tail.trim().split("\n").pop() || "exit " + c) }); }); }); }
function metrics(file, a, b){   // peak, average level and quiet stretches of media [a,b] from the cache (null if not listened to)
  const L = cache.get(file); if (!L) return null; const S = L.find(s => s.a <= a + 0.05 && s.b >= b - 0.05); if (!S) return null;
  const i0 = Math.max(0, Math.floor((a - S.a) / STEP)), i1 = Math.min(S.pk.length, Math.ceil((b - S.a) / STEP)); let pk = -200, e = 0, ne = 0; const quiet = []; let q0 = -1;
  for (let i = i0; i < i1; i++) { if (S.pk[i] > pk) pk = S.pk[i]; if (S.rms[i] > -70) { e += Math.pow(10, S.rms[i] / 10); ne++; }
    const silent = S.rms[i] < -50; if (silent && q0 < 0) q0 = i; if ((!silent || i === i1 - 1) && q0 >= 0) { quiet.push([S.a + q0 * STEP, S.a + (silent ? i + 1 : i) * STEP]); q0 = -1; } }
  return { peak: pk, level: ne ? 10 * Math.log10(e / ne) : -200, quiet }; }
/* listened audio is kept on disk, so checking again (or after a restart) doesn't listen again */
const DC = path.join(os_ ? os_.tmpdir() : extDir(), "assetflow_qc_cache");
function dcKey(file, a, b){ let sz = 0, mt = 0; try { const q = fs.statSync(file); sz = q.size; mt = Math.round(q.mtimeMs); } catch (e) { return null; }
  return require("crypto").createHash("sha1").update([file.toLowerCase(), sz, mt, a.toFixed(3), b.toFixed(3), STEP].join("|")).digest("hex").slice(0, 24); }
function dcLoad(file, a, b){ const k = dcKey(file, a, b); if (!k) return null; try { const B = fs.readFileSync(path.join(DC, k + ".bin")), n = B.length / 8;
  const pk = new Float32Array(B.buffer.slice(B.byteOffset, B.byteOffset + n * 4)), rms = new Float32Array(B.buffer.slice(B.byteOffset + n * 4, B.byteOffset + n * 8)); return { ok: true, a, b, pk, rms }; } catch (e) { return null; } }
function dcSave(file, r){ const k = dcKey(file, r.a, r.b); if (!k) return; try { fs.mkdirSync(DC, { recursive: true }); fs.writeFileSync(path.join(DC, k + ".bin"), Buffer.concat([Buffer.from(r.pk.buffer), Buffer.from(r.rms.buffer)])); } catch (e) {} }
function edgeLevel(file, a, b){   // loudness (dB RMS) of media [a,b] from the cache, null if not listened to
  const L = cache.get(file); if (!L) return null; const S = L.find(s => s.a <= a + 0.05 && s.b >= b - 0.05); if (!S) return null;
  const i0 = Math.max(0, Math.floor((a - S.a) / STEP)), i1 = Math.min(S.rms.length, Math.max(i0 + 1, Math.ceil((b - S.a) / STEP))); let e = 0, n = 0;
  for (let i = i0; i < i1; i++) { e += Math.pow(10, Math.max(-120, S.rms[i]) / 10); n++; } return n ? 10 * Math.log10(e / n) : null; }
async function listen(clips, onProg, stopped){
  const by = new Map(); clips.forEach(c => { if (!by.has(c.path)) by.set(c.path, []); by.get(c.path).push([c.in, c.out]); });
  const jobs = []; by.forEach((R, file) => { R.sort((x, y) => x[0] - y[0]); const M = []; R.forEach(r => { const l = M[M.length - 1]; if (l && r[0] - l[1] < 30) l[1] = Math.max(l[1], r[1]); else M.push(r.slice()); });
    M.forEach(([a, b]) => { const have = (cache.get(file) || []).some(s => s.a <= a + 0.05 && s.b >= b - 0.05); if (!have) jobs.push({ file, a: Math.max(0, a - 0.2), b: b + 0.2 }); }); });
  const total = jobs.reduce((t, j) => t + (j.b - j.a), 0) || 1; let done = 0, i = 0; const errs = [];
  const w = async () => { while (i < jobs.length && !stopped()) { const j = jobs[i++]; let r = dcLoad(j.file, j.a, j.b); if (!r) { r = await scanSpan(j.file, j.a, j.b, f => onProg((done + f * (j.b - j.a)) / total)); if (r.ok && !stopped()) dcSave(j.file, r); }
      done += j.b - j.a; onProg(done / total); if (r.ok) { if (!cache.has(j.file)) cache.set(j.file, []); cache.get(j.file).push(r); } else errs.push(path.basename(j.file) + ": " + r.err); } };
  const nW = Math.max(2, Math.min(8, Math.floor(((os_ && os_.cpus().length) || 4) / 2)));
  await Promise.all(Array.from({ length: nW }, w)); return errs; }

/* ---------- the checks (pure: run again on every edit without listening again) ---------- */
let DBG = null;
function check(S, o){
  const fr = 1 / (S.fps || 30), end = S.end, I = [];
  const add = (sev, a, b, msg, sel) => I.push({ sev, a, b: Math.max(a, b), msg, sel: sel || [] });
  const union = L => { L = L.filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]); const out = []; L.forEach(x => { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 1e-4) l[1] = Math.max(l[1], x[1]); else out.push(x.slice()); }); return out; };
  const gaps = (U, a, b) => { const g = []; let t = a; U.forEach(([s, e]) => { if (s > t + 1e-4) g.push([t, Math.min(s, b)]); t = Math.max(t, e); }); if (t < b - 1e-4) g.push([t, b]); return g; };
  const frames = d => Math.round(d / fr), V = S.v, A = S.a;
  // missing media
  const miss = new Map(), exist = new Map();   /* one disk check per file, not per clip */
  [...V.map(t => ["V", t]), ...A.map(t => ["A", t])].forEach(([k, t]) => t.clips.forEach(c => { if (!c.path) return; let m = c.off; if (!m) { if (!exist.has(c.path)) { let ok = true; try { ok = fs.existsSync(c.path); } catch (e) {} exist.set(c.path, ok); } m = !exist.get(c.path); } if (m) { if (!miss.has(c.path)) miss.set(c.path, []); miss.get(c.path).push([k, t.i, c]); } }));
  miss.forEach((L, p) => { const c0 = L[0][2]; add("err", c0.s, c0.e, "Missing / offline media: " + path.basename(p) + (L.length > 1 ? " (" + L.length + " clips)" : ""), L.slice(0, 50).map(([k, ti, c]) => [k, ti, c.k])); });
  // black gaps / flash frames (only when the sequence has video at all)
  if (V.some(t => t.clips.length)) gaps(union(V.filter(t => !t.mute).flatMap(t => t.clips.filter(c => !c.dis).map(c => [c.s, c.e]))), 0, end).forEach(([a, b]) => {
    const n = frames(b - a); if (n < 1) return; add(n <= 3 ? "err" : "warn", a, b, n <= 3 ? "Flash of black (" + n + " empty frame" + (n > 1 ? "s" : "") + ")" : "No video — black screen"); });
  // very short clips
  [...V.map(t => ["V", t]), ...A.map(t => ["A", t])].forEach(([k, t]) => t.clips.forEach(c => { if (c.dis) return; const n = frames(c.e - c.s); if (n < 1) return;
    if (n <= 2) add("err", c.s, c.e, n + "-frame clip on " + t.name + " (" + c.name + ")", [[k, t.i, c.k]]);
    else if (k === "V" && n <= 8) add("warn", c.s, c.e, "Very short clip on " + t.name + ": " + n + " frames (" + c.name + ")", [[k, t.i, c.k]]); }));
  // audio out of sync with its own video (same file, different offset)
  const aByPath = new Map(); A.forEach(t => { if (t.mute) return; t.clips.forEach(c => { if (c.dis || !c.path) return; if (!aByPath.has(c.path)) aByPath.set(c.path, []); aByPath.get(c.path).push([t, c]); }); });
  aByPath.forEach(L => { L.forEach((x, i) => x.oi = i); L.sort((x, y) => x[1].s - y[1].s); let mx = -Infinity; L.mx = L.map(([, c]) => (mx = Math.max(mx, c.e))); });
  V.forEach(t => t.clips.forEach(v => { if (v.dis || !v.path || !aByPath.has(v.path)) return;
    /* only the audio clips of that file that overlap this video clip in time (binary search; every pair was checked before) */
    const L = aByPath.get(v.path); let lo = 0, hi = L.length; while (lo < hi) { const m = (lo + hi) >> 1; if (L.mx[m] <= v.s + 0.2) lo = m + 1; else hi = m; }
    const near = []; for (let q = lo; q < L.length && L[q][1].s < v.e - 0.2; q++) near.push(L[q]); near.sort((x, y) => x.oi - y.oi);
    near.forEach(([at, a]) => { const s = Math.max(v.s, a.s), e = Math.min(v.e, a.e); if (e - s < 0.2 || Math.abs((v.spd || 1) - (a.spd || 1)) > 1e-3) return;
      const d = (v.in - v.s * (v.spd || 1)) - (a.in - a.s * (a.spd || 1)), n = Math.round(d / fr);
      if (Math.abs(n) >= 1) add("err", s, e, "Audio out of sync with video by " + Math.abs(n) + " frame" + (Math.abs(n) > 1 ? "s" : "") + " (" + t.name + "/" + at.name + ", " + v.name + ")", [["V", t.i, v.k], ["A", at.i, a.k]]); }); }));
  // same footage twice
  const vByPath = new Map(); V.forEach(t => t.clips.forEach(c => { if (c.dis || !c.path) return; if (!vByPath.has(c.path)) vByPath.set(c.path, []); vByPath.get(c.path).push([t, c]); }));
  vByPath.forEach(L => { L.sort((x, y) => x[1].s - y[1].s);
    /* pairs whose source ranges overlap, found by sweeping in source order (comparing every pair was quadratic: millions of checks on a cut-up stream) */
    const ord = L.map((x, i) => i).sort((p, q) => L[p][1].in - L[q][1].in), P = [];
    for (let x = 0; x < ord.length; x++) { const A0 = L[ord[x]][1]; for (let y = x + 1; y < ord.length; y++) { const B0 = L[ord[y]][1]; if (B0.in >= A0.out - 1) break; P.push(ord[x] < ord[y] ? [ord[x], ord[y]] : [ord[y], ord[x]]); } }
    P.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    for (const [i, j] of P) { const A1 = L[i][1], B1 = L[j][1], ov = Math.min(A1.out, B1.out) - Math.max(A1.in, B1.in);
      if (ov > 1 && Math.abs(A1.s - B1.s) > 0.01) add("warn", B1.s, B1.e, "Same footage shown twice (" + ov.toFixed(1) + " s, first at " + tcode(A1.s, S.fps) + ")", [["V", L[j][0].i, B1.k], ["V", L[i][0].i, A1.k]]); } });
  // notes
  [...V.map(t => ["V", t]), ...A.map(t => ["A", t])].forEach(([k, t]) => { if (t.mute && t.clips.length) add("info", t.clips[0].s, t.clips[t.clips.length - 1].e, t.name + " is " + (k === "V" ? "hidden" : "muted") + " but has " + t.clips.length + " clip(s)");
    t.clips.forEach(c => { if (c.dis) add("info", c.s, c.e, "Disabled clip on " + t.name + ": " + c.name, [[k, t.i, c.k]]); }); });
  // audio
  const aud = A.filter(t => !t.mute), AC = aud.flatMap(t => t.clips.filter(c => !c.dis && c.path && !c.off).map(c => Object.assign({ tn: t.name, ti: t.i }, c)));
  if (!AC.length) { if (end > 0) add("warn", 0, end, "This sequence has no audio"); return I; }
  let sound = [], heard = 0;
  AC.forEach(c => { const m = o.listen ? metrics(c.path, c.in, c.out) : null; c.m = m; const sp = c.spd || 1;
    if (!m) { sound.push([c.s, c.e]); return; } heard++;
    let t = c.in; m.quiet.forEach(([qa, qb]) => { if (qa > t) sound.push([c.s + (t - c.in) / sp, c.s + (qa - c.in) / sp]); t = Math.max(t, qb); }); if (t < c.out) sound.push([c.s + (t - c.in) / sp, c.e]);
    const g = c.tv || c.lvl == null ? (o.gain.get(c.path + "|" + c.in.toFixed(3)) || 0) : c.lvl;
    if (m.peak + g > -0.1 && m.peak > -199) add("err", c.s, c.e, "Clipping on " + c.tn + ": peaks at " + (m.peak + g > 0 ? "+" : "") + (m.peak + g).toFixed(1) + " dB (" + c.name + ")", [["A", c.ti, c.k]]);
    c.L = m.level > -60 ? m.level + g : null; });
  /* audio cut mid-sound: the first / last 0.05 s of a clip is nearly as loud as the clip itself (a word or sound chopped at the cut).
     Not flagged when the next clip simply continues the same recording. */
  if (o.edges) aud.forEach(t => { const L = AC.filter(c => c.ti === t.i && c.m).sort((a, b) => a.s - b.s);
    L.forEach((c, i) => { const sp = c.spd || 1, P = L[i - 1], N = L[i + 1], ref = c.m.level; if (ref <= -60) return;
      const contP = !!P && P.path === c.path && Math.abs(P.e - c.s) < 0.02 && Math.abs(P.out - c.in) < 0.06, contN = !!N && N.path === c.path && Math.abs(N.s - c.e) < 0.02 && Math.abs(N.in - c.out) < 0.06;
      const hot = v => v != null && v > Math.max(-42, ref - o.edgeDb);
      const lin = edgeLevel(c.path, c.in, c.in + 0.05 * sp), lout = edgeLevel(c.path, c.out - 0.05 * sp, c.out);
      /* only a real cut-off if the sound carries on past the cut in the source too (a word that ends right at the cut is fine) */
      const el2 = (x, y) => { const v = edgeLevel(c.path, x, y); return v == null ? -200 : v; };
      const pin = c.in > 0.11 * sp ? Math.min(el2(c.in - 0.05 * sp, c.in), el2(c.in - 0.1 * sp, c.in - 0.05 * sp)) : -200, pout = Math.min(el2(c.out, c.out + 0.05 * sp), el2(c.out + 0.05 * sp, c.out + 0.1 * sp));
      let cutIn = hot(lin) && hot(pin), cutOut = hot(lout) && hot(pout);
      const sI = spNear(c.path, c.in, "i"), sO = spNear(c.path, c.out, "o"), inW = (r, x) => !!(r.w || []).find(w => w[0] + 0.03 < x && x < w[1] - 0.03);   // words known: only a chopped WORD counts
      if (sI) cutIn = inW(sI, c.in); if (sO) cutOut = inW(sO, c.out);
      if (DBG) DBG.push({ t: t.name, n: c.name, s: c.s, e: c.e, in: c.in, out: c.out, ref, lin, pin, lout, pout, contP, contN, cutIn, cutOut, path: c.path });
      if (cutIn && !contP) add("warn", c.s, Math.min(c.e, c.s + 0.5), "Sound cut off at the START of " + c.name + " on " + t.name + " (" + lin.toFixed(0) + " dB right at the cut)", [["A", t.i, c.k]]);
      if (cutOut && !contN) add("warn", Math.max(c.s, c.e - 0.5), c.e, "Sound cut off at the END of " + c.name + " on " + t.name + " (" + lout.toFixed(0) + " dB right at the cut)", [["A", t.i, c.k]]); }); });
  gaps(union(sound), 0, end).forEach(([a, b]) => { if (b - a >= o.dead) add(heard ? "warn" : "info", a, b, heard ? "Dead air: " + (b - a).toFixed(1) + " s with nothing to hear" : "No audio clips for " + (b - a).toFixed(1) + " s"); });
  if (heard) aud.forEach(t => { const L = AC.filter(c => c.ti === t.i && c.L != null).sort((a, b) => a.s - b.s);
    for (let i = 1; i < L.length; i++) { const P = L[i - 1], N = L[i]; if (N.s - P.e > 0.5) continue; const dl = N.L - P.L;
      if (Math.abs(dl) > o.jump) add("warn", Math.max(P.s, N.s - 1), Math.min(N.e, N.s + 1), "Volume jump on " + t.name + ": " + (dl > 0 ? "+" : "") + dl.toFixed(1) + " dB (" + P.name + " → " + N.name + ")", [["A", t.i, P.k], ["A", t.i, N.k]]); } });
  return I; }

/* problems on the same stretch become one row with a start–end range */
function rows(I, fps){ const fr = 1 / (fps || 30), sevN = { err: 0, warn: 1, info: 2 };
  const L = I.slice().sort((a, b) => a.a - b.a || a.b - b.b), R = [];
  let open = [];   /* rows that can still merge: their end is within reach of the current issue (issues come in start order) */
  L.forEach(x => { open = open.filter(r => !(x.a > r.b + 2 * fr)); const r = open.find(r => { if (x.sev === "info" || r.sev === "info" || x.a > r.b + 2 * fr || x.b < r.a - 2 * fr) return false;
      const ov = Math.min(x.b, r.b) - Math.max(x.a, r.a), short = Math.min(x.b - x.a, r.b - r.a);
      return (x.b - x.a < 1 && r.b - r.a < 1) || (short > 0 && ov >= 0.5 * short); });   // same spot: tiny neighbours, or mostly the same range
    if (r) { r.a = Math.min(r.a, x.a); r.b = Math.max(r.b, x.b); if (!r.msgs.includes(x.msg)) r.msgs.push(x.msg); if (sevN[x.sev] < sevN[r.sev]) r.sev = x.sev; x.sel.forEach(s => { if (!r.sel.some(q => q.join() === s.join())) r.sel.push(s); }); }
    else { const nr = { sev: x.sev, a: x.a, b: x.b, msgs: [x.msg], sel: x.sel.slice() }; R.push(nr); open.push(nr); } });
  return R.sort((a, b) => sevN[a.sev] - sevN[b.sev] || a.a - b.a); }
function tcode(t, fps){ const f = Math.round(fps || 30), F = Math.round(Math.max(0, t) * (fps || 30)), ff = F % f, s = Math.floor(F / f), p = n => String(n).padStart(2, "0");
  return (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + p(Math.floor(s / 60) % 60) + ":" + p(s % 60) + ":" + p(ff); }

/* ---------- UI ---------- */
document.head.appendChild(el("style", null,
  "#afx-qc{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09);position:relative;z-index:2}" +
  "#afx-qc.open{display:flex}#afx-qc h3{font-size:12px;font-weight:600;color:var(--text,#eee);margin:0 0 4px}.afx-sec{padding:12px 14px;border-bottom:1px solid var(--border,#333)}" +
  ".afx-hint{font-size:10.5px;color:var(--text3,#888);line-height:1.5;margin-bottom:8px}" +
  ".afx-row{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:11px;color:var(--text2,#bbb);flex-wrap:wrap}.afx-row>span:first-child{min-width:140px}" +
  ".afx-row input[type=range]{flex:1;min-width:90px}.afx-row b{min-width:34px;text-align:right;color:var(--text,#eee);font-weight:500}" +
  ".afx-fold{display:none;margin-top:8px;padding:8px 10px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:8px}.afx-fold.open{display:block}" +
  ".afx-gear{background:transparent;border:1px solid rgba(255,255,255,.12);color:var(--text2,#bbb);border-radius:8px;font-size:10.5px;padding:5px 9px;cursor:pointer;white-space:nowrap}.afx-gear:hover{color:#fff;border-color:rgba(255,255,255,.3)}.afx-gear.on{background:rgba(255,255,255,.1);color:#fff}" +
  ".afx-more{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:10.5px;color:var(--text3,#888)}.afx-more span{display:flex;flex-wrap:wrap;gap:6px}.afx-more .btn{padding:4px 10px;font-size:10.5px}" +
  ".afx-btns{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}.afx-btns .btn{padding:6px 12px;font-size:11px;flex:0 0 auto}" +
  ".afx-st{font-size:11px;color:var(--text2,#aaa);margin-top:6px;min-height:14px}.afx-bar{height:3px;background:#333;border-radius:2px;overflow:hidden;margin-top:4px}.afx-bar>div{height:100%;width:0;background:var(--accent,#0a84ff);transition:width .2s}" +
  ".afx-filt{display:flex;flex-wrap:wrap;gap:5px;padding:8px 14px;border-bottom:1px solid var(--border,#2a2a2a);position:sticky;top:0;background:#1c1c1c;z-index:2}.afx-filt button{font-size:10.5px;padding:3px 9px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:transparent;color:var(--text2,#bbb);cursor:pointer}.afx-filt button.on{background:var(--accent,#0a84ff);border-color:transparent;color:#fff}.afx-filt b{font-weight:600;opacity:.8}" +
  ".afx-grp{padding:10px 14px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3,#888)}" +
  ".afx-item{display:flex;gap:10px;padding:7px 14px;border-bottom:1px solid var(--border,#2a2a2a);cursor:pointer;font-size:11px;align-items:flex-start}" +
  ".afx-item:hover{background:rgba(255,255,255,.05)}.afx-item.cur{background:rgba(10,132,255,.14)}.afx-item .t{color:var(--accent,#0a84ff);min-width:150px;font-variant-numeric:tabular-nums;font-family:var(--mono,monospace);font-size:10.5px}" +
  ".afx-item .t i{display:block;font-style:normal;color:var(--text3,#777);font-size:10px}.afx-item .m{flex:1;color:var(--text2,#ccc);line-height:1.45}" +
  ".afx-sev{font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;flex:0 0 auto}.afx-sev.err{background:#c443;color:#f77}.afx-sev.warn{background:#d8a3;color:#fc6}.afx-sev.info{background:#4683;color:#9bd}"));
const slider = (id, label, min, max, step, def, unit) => '<div class="afx-row"><span>' + label + '</span><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + LS.get("afx_" + id, def) + '"><b id="' + id + '-v"></b><i style="font-style:normal;color:#777">' + unit + "</i></div>";
const fold = (id, body) => '<div class="afx-fold' + (LS.get("afx_" + id, "0") === "1" ? " open" : "") + '" id="' + id + '">' + body + "</div>";
const P = el("div", null,
  '<div class="afx-sec"><h3>Quality check</h3><div class="afx-hint">Checks the open sequence before you export. Click a problem to jump there with its clips selected, then ↑ ↓ to step through them. The list updates by itself after you edit.</div>' +
  '<div class="afx-row"><label><input type="checkbox" id="afx-qc-deep" ' + (LS.get("afx_qc_listen", "1") === "1" ? "checked" : "") + "> Also listen to the audio (dead air, clipping, volume jumps)</label></div>" +
  '<div class="afx-btns"><button class="btn btn-primary" id="afx-qc-go">Check sequence</button><button class="btn btn-ghost" id="afx-qc-stop" disabled>Stop</button><button class="afx-gear" data-fold="afx-qc-fold" title="What counts as a problem">⚙ Settings</button></div>' +
  '<div class="afx-st" id="afx-qc-st"></div><div class="afx-bar"><div id="afx-qc-bar"></div></div>' +
  fold("afx-qc-fold", '<div class="afx-row"><label><input type="checkbox" id="afx-qc-auto" ' + (LS.get("afx_qc_auto2", "1") === "1" ? "checked" : "") + '> Update the list after each edit</label></div>' + slider("afx-qc-dead", "Dead air longer than", 1, 15, 0.5, 3, "s") + '<div class="afx-row"><label><input type="checkbox" id="afx-qc-edges" ' + (LS.get("afx_qc_edges", "1") === "1" ? "checked" : "") + '> Flag sound cut off at clip edges</label></div>' + slider("afx-qc-edge", "Edge counts as cut-off within", 4, 20, 1, 10, "dB") + slider("afx-qc-jump", "Volume jump bigger than", 3, 15, 1, 8, "dB")) + "</div>" +
  '<div class="afx-sec"><h3>Room to breathe</h3><div class="afx-hint">Every cut gets real silence around the words: a little room before the first word and after the last, long pauses at cuts shortened, chopped words finished. It finds real words (game sound doesn\'t fool it) and never adds new ones. The result is a NEW sequence next to yours, with every clip still linked and in sync and a tiny fade on each audio cut. Your original sequence isn\'t touched.</div>' +
  '<div class="afx-btns"><button class="btn btn-primary" id="afx-br-go">Give cuts room</button><button class="afx-gear" data-fold="afx-br-fold" id="afx-br-gear" title="How much room, and on which track"></button><button class="btn btn-ghost" id="afx-br-orig" style="display:none" title="Open the sequence you started from (it was not changed)">Back to original</button><button class="btn btn-ghost" id="afx-br-undo" style="display:none">Undo</button></div>' +
  fold("afx-br-fold", slider("afx-br-a3", "Before the first word", 0, 0.5, 0.01, 0.2, "s") + slider("afx-br-b3", "After the last word", 0, 0.6, 0.01, 0.25, "s") +
    '<div class="afx-row" style="color:#888;font-size:10px">0.20 + 0.25 = about 0.45 s between two sentences across a cut.</div>' +
    '<div class="afx-row"><span>Voice track</span><select id="afx-br-t" style="background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:5px;font-size:11px;padding:3px"><option value="-1">Auto (most cuts)</option></select></div>' +
    '<div class="afx-row"><label><input type="checkbox" id="afx-br-trim" ' + (LS.get("afx_br_trim", "1") === "1" ? "checked" : "") + '> Shorten long pauses at cuts (untick to only ADD room: keeps the breathing room of battles and gameplay)</label></div>' +
    '<div class="afx-row"><label><input type="checkbox" id="afx-br-fix" checked> Also fix cuts that chop a word</label></div>' +
    '<div class="afx-row"><span>Audio fades</span><select id="afx-br-fd2" style="background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:5px;font-size:11px;padding:3px"><option value="2f">Tiny 2-frame fade on every audio cut (no clicks)</option><option value="none">No audio fades</option></select></div>') +
  '<div class="afx-more">More fixes<span><button class="btn btn-ghost" id="afx-gaps" title="Remove every gap where nothing plays on any track. Everything stays in sync.">Close all gaps</button><button class="btn btn-ghost" id="afx-gaps-undo" style="display:none">Undo gaps</button><button class="btn btn-ghost" id="afx-vg" title="Fill gaps in the video where the clip\'s own audio keeps playing">Fill video gaps</button><button class="btn btn-ghost" id="afx-fd" title="Remove every audio fade (crossfade) on the voice track">Remove audio fades</button></span></div>' +
  '<div class="afx-st" id="afx-br-st"></div></div><div id="afx-qc-list"></div>');
P.id = "afx-qc";
P.querySelectorAll(".afx-gear").forEach(g => g.onclick = () => { const f = P.querySelector("#" + g.dataset.fold); f.classList.toggle("open"); g.classList.toggle("on", f.classList.contains("open")); LS.set("afx_" + g.dataset.fold, f.classList.contains("open") ? "1" : "0"); });
P.querySelectorAll(".afx-gear").forEach(g => g.classList.toggle("on", P.querySelector("#" + g.dataset.fold).classList.contains("open")));
["keydown", "keyup", "contextmenu"].forEach(t => P.addEventListener(t, e => e.stopPropagation()));   // keys pressed on this page (arrow keys on a slider…) don't reach the library's shortcuts
let ROOM = false; const $ = id => P.querySelector("#" + id), st = m => { if (ROOM) $("afx-br-st").textContent = m; else $("afx-qc-st").textContent = m; }, bar = f => { $("afx-qc-bar").style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; };
P.querySelectorAll("input[type=range]").forEach(r => { const show = () => { $(r.id + "-v").textContent = r.value; }; show(); r.addEventListener("input", show); r.addEventListener("change", () => { LS.set("afx_" + r.id, r.value); if (last) render(); }); });
const brSum = () => { $("afx-br-gear").textContent = "⚙ " + (+$("afx-br-a3").value).toFixed(2) + " s before · " + (+$("afx-br-b3").value).toFixed(2) + " s after"; };   // the settings in use, readable without opening them
brSum(); ["afx-br-a3", "afx-br-b3"].forEach(id => $(id).addEventListener("input", brSum));
$("afx-br-fd2").value = LS.get("afx_br_fd2", "2f"); $("afx-br-fd2").onchange = function(){ LS.set("afx_br_fd2", this.value); };
$("afx-br-trim").onchange = function(){ LS.set("afx_br_trim", this.checked ? "1" : "0"); };
$("afx-qc-auto").onchange = function(){ LS.set("afx_qc_auto2", this.checked ? "1" : "0"); };
$("afx-qc-deep").onchange = function(){ LS.set("afx_qc_listen", this.checked ? "1" : "0"); };
$("afx-qc-edges").onchange = function(){ LS.set("afx_qc_edges", this.checked ? "1" : "0"); if (last) render(); };

let last = null, gain = new Map(), sig = "", busy = false, stop = false, cur = -1, filt = LS.get("afx_qc_filt", "all");
/* after an edit: read only where clips sit now, and carry each clip's file/name over from the last full check (matched by the part of the source it plays) */
async function lightSeq(S0){ let r; try { r = JSON.parse(await call("afx_light")); } catch (e) { return null; } if (!r || r.error || r.id !== S0.id) return null;
  const map = (old, flat) => old.map((t, ti) => { const F = flat[ti] || [], O = t.clips, out = [];
    for (let q = 0, k = 0; q + 3 < F.length; q += 4, k++) { const s = F[q], e = F[q + 1], i0 = F[q + 2], o0 = F[q + 3]; let best = null, bo = 0;
      for (const c of O) { const ov = Math.min(c.out, o0) - Math.max(c.in, i0); if (ov > bo + 1e-6 || (ov === bo && best && Math.abs(c.s - s) < Math.abs(best.s - s))) { bo = ov; best = c; } }
      if (!best) continue; const n = Object.assign({}, best, { k, s, e, in: i0, out: o0 }); n.spd = e > s ? (o0 - i0) / (e - s) : 1; if (Math.abs(n.spd - 1) < 0.002) n.spd = 1; out.push(n); }
    return Object.assign({}, t, { clips: out }); });
  return Object.assign({}, S0, { end: Math.max(r.end || 0, 0), v: map(S0.v, r.v), a: map(S0.a, r.a) }); }
const kindOf = r => { const m = r.msgs.join(" "); return /Sound cut off/.test(m) ? "cut" : /Dead air|nothing to hear/.test(m) ? "dead" : /Clipping|Volume jump/.test(m) ? "loud" : "other"; };
const opts = () => ({ listen: $("afx-qc-deep").checked, dead: +$("afx-qc-dead").value, jump: +$("afx-qc-jump").value, edges: $("afx-qc-edges").checked, edgeDb: +$("afx-qc-edge").value, gain });
function render(note){ const S = last; if (!S) return; const ALL = rows(check(S, opts()), S.fps);
  if (DBG) { try { fs.writeFileSync(path.join(extDir(), "qc_debug.json"), JSON.stringify({ at: new Date().toISOString(), seq: S.name, tracks: S.a.map(t => [t.name, t.clips.length, t.mute]), edges: DBG.filter(d => d.cutIn || d.cutOut || (d.lin > -45 || d.lout > -45)) })); } catch (e) {} DBG = null; }
  const L = $("afx-qc-list"); L.innerHTML = "";
  const cnt = { all: ALL.length, cut: 0, dead: 0, loud: 0, other: 0 }; ALL.forEach(r => cnt[kindOf(r)]++);
  const F = el("div", "afx-filt", [["all", "All"], ["cut", "Sound cut off"], ["dead", "Dead air"], ["loud", "Too loud"], ["other", "Other"]].map(([k, t]) => '<button data-k="' + k + '" class="' + (filt === k ? "on" : "") + '">' + t + " <b>" + cnt[k] + "</b></button>").join(""));
  F.querySelectorAll("button").forEach(b => b.onclick = () => { filt = b.dataset.k; LS.set("afx_qc_filt", filt); cur = -1; render(note); }); L.appendChild(F);
  const R = filt === "all" ? ALL : ALL.filter(r => kindOf(r) === filt);
  const head = { err: "To fix", warn: "To check", info: "Notes" }; let g = "";
  R.forEach((r, i) => { if (r.sev !== g) { g = r.sev; L.appendChild(el("div", "afx-grp", head[g] + " · " + R.filter(x => x.sev === g).length)); }
    const one = r.b - r.a < 1 / (S.fps || 30) * 1.5, row = el("div", "afx-item" + (i === cur ? " cur" : ""),
      '<span class="t">' + tcode(r.a, S.fps) + (one ? "" : " – " + tcode(r.b, S.fps)) + "<i>" + (one ? "" : ((r.b - r.a) < 10 ? Math.round((r.b - r.a) * (S.fps || 30)) + " frames" : (r.b - r.a).toFixed(1) + " s")) + '</i></span><span class="m">' + r.msgs.map(esc).join("<br>") + '</span><span class="afx-sev ' + r.sev + '">' + ({ err: "FIX", warn: "CHECK", info: "NOTE" })[r.sev] + "</span>");
    row.onclick = () => { cur = i; L.querySelectorAll(".afx-item").forEach(x => x.classList.remove("cur")); row.classList.add("cur"); try { L.focus({ preventScroll: true }); } catch (e) {} call("afx_go", { a: r.a, b: r.b, sel: r.sel.map(([k, ti, ck]) => { const t = (k === "V" ? S.v : S.a)[ti], c = t && t.clips[ck]; return c ? [k, ti, ck, c.s] : [k, ti, ck]; }) }).catch(e => st("⚠ " + e.message)); };
    L.appendChild(row); });
  /* ↑ ↓ step through the problems (the playhead follows) once one is clicked */
  L.tabIndex = 0; L.style.outline = "none"; L.onkeydown = e => { if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return; e.preventDefault(); const W = L.querySelectorAll(".afx-item"), n = Math.max(0, Math.min(R.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1))); if (R.length && W[n] && n !== cur) { W[n].click(); W[n].scrollIntoView({ block: "nearest" }); } };
  const ne = R.filter(x => x.sev === "err").length, nw = R.filter(x => x.sev === "warn").length;
  if (!R.length) L.appendChild(el("div", "afx-item", '<span class="m">✓ Everything looks good.</span>'));
  st((note ? note + " · " : "") + (R.length ? ne + " to fix, " + nw + " to check, " + (R.length - ne - nw) + " notes" : "No problems") + " in " + S.name + (opts().listen ? "" : " (audio not listened to: tick \"Also listen to the audio\" to check it)")); }


/* ---------- Room to breathe: silence at every cut, never new sound ---------- */
/* ---------- speech at clip edges (WordCut's speech model on the GPU): where words start and end ---------- */
const SPC = new Map();   // "path|t|side" -> {sp, w, len, a}
const spKey = (p, t, side) => p.toLowerCase() + "|" + t.toFixed(3) + "|" + side;
/* the words around an edge that has since moved (Room to breathe moves it; Premiere may land it a few ms off): look near it.
   Kept on disk too, so tomorrow's Quality check still knows these edges are clean instead of guessing from loudness */
const SPN = new Map(), spB = (p, t, side) => p.toLowerCase() + "|" + side + "|" + Math.round(t * 10);
let spNotes = null, spT = 0;
const spFile = () => path.join(os_ ? os_.tmpdir() : extDir(), "assetflow_speech", "edges_done.json");
function spPut(p, t, side, w){ const k = spB(p, t, side); let L = SPN.get(k); if (!L) SPN.set(k, L = []); L.push([t, { w, sp: [] }]); }
function spLoad(){ if (spNotes) return; spNotes = []; try { JSON.parse(fs.readFileSync(spFile(), "utf8")).forEach(x => { spNotes.push(x); spPut(x[0], x[1], x[2], x[3]); }); } catch (e) {} }
function spNote(p, t, side, r){ if (!r) return; spLoad(); const w = (r.w || []).filter(x => x[1] > t - 0.5 && x[0] < t + 0.5).map(x => [Math.round(x[0] * 1000) / 1000, Math.round(x[1] * 1000) / 1000]);
  spPut(p, t, side, w); spNotes.push([p.toLowerCase(), Math.round(t * 1000) / 1000, side, w]); if (spNotes.length > 30000) spNotes.splice(0, spNotes.length - 30000);
  clearTimeout(spT); spT = setTimeout(() => { try { fs.mkdirSync(path.dirname(spFile()), { recursive: true }); fs.writeFileSync(spFile(), JSON.stringify(spNotes)); } catch (e) {} }, 300); }
function spNear(p, t, side){ const r = SPC.get(spKey(p, t, side)); if (r) return r; spLoad(); if (!SPN.size) return undefined; let best, bd = 0.045;
  for (const dt of [0, -0.1, 0.1]) { const L = SPN.get(spB(p, t + dt, side)); if (L) for (const [x, v] of L) { const d = Math.abs(x - t); if (d <= bd) { bd = d; best = v; } } } return best; }
function wcDir(){ const la = process.env.LOCALAPPDATA || path.join(require("os").homedir(), "AppData", "Local"); return path.join(la, "WordCut"); }
function speechEdges(clips, onProg, stopped){ return new Promise((res, bad) => {
  const py = path.join(wcDir(), "venv", "Scripts", "python.exe"), model = path.join(wcDir(), "models", "w2v");
  if (!fs.existsSync(py) || !fs.existsSync(path.join(model, "model.onnx"))) return bad(new Error("This needs WordCut's speech model. Open WordCut once and transcribe anything (it installs it), then try again."));
  const jobs = [], seen = new Set();
  clips.forEach(c => [["i", c.in], ["o", c.out]].forEach(([side, t]) => { const k = spKey(c.path, t, side); if (SPC.has(k) || seen.has(k)) return; seen.add(k); jobs.push({ id: String(jobs.length), key: k, path: c.path, a: Math.max(0, t - 1.6), b: t + 1.6 }); }));
  if (!jobs.length) return res([]);
  let p; try { p = cp.spawn(py, ["-u", path.join(extDir(), "af_speech.py")], { windowsHide: true }); } catch (e) { return bad(e); }
  running.add(p); let buf = "", err = "", errs = [];
  p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(l); } catch (e) { continue; }
      if (m.ev === "res") { const j = jobs[+m.id]; if (j) SPC.set(j.key, m); } else if (m.ev === "prog") onProg(m.f); else if (m.ev === "done") { try { window._afBootLog && _afBootLog("speech edges " + jobs.length + " in " + m.secs + "s on " + m.prov); } catch (e) {} } } });
  p.stderr.on("data", d => { err = (err + d).slice(-1500); });
  p.on("close", c => { running.delete(p); if (stopped()) return res([]); const miss = jobs.filter(j => !SPC.has(j.key)).length; if (miss && miss === jobs.length) return bad(new Error("The speech model failed: " + (err.trim().split("\n").pop() || "exit " + c))); res(miss ? ["speech: " + miss + " edges not read"] : []); });
  p.stdin.write(JSON.stringify({ model, ffmpeg: ffmpegPath(), jobs: jobs.map(({ id, path, a, b }) => ({ id, path, a, b })), cache: path.join(os_ ? os_.tmpdir() : extDir(), "assetflow_speech") }) + "\n"); p.stdin.end(); }); }
/* where a clip edge should be. side "o": out point, "i": in point; t = the edge now (media seconds); r = speech around it.
   -> {k: "none"} leave it | {k: "chop"} a word is cut and can't be fixed | {k: "ok"|"fix", t: new edge, lo, hi: the edge must stay between these (after the word before it, before the word after it)} */
function edgeDecision(side, t, r, o){
  const W = (r && r.w) || [], SP = (r && r.sp) || [], m = 0.03; if (!W.length) return { k: "none" };
  const end = r.a + r.len - 0.02, chop = W.find(w => w[0] + m < t && t < w[1] - m);
  if (side === "o") { let L;
    if (chop) { if (!o.fix) return { k: "chop" }; L = (t - chop[0]) >= (chop[1] - t) ? chop : W.filter(w => w[1] <= chop[0] + 1e-3).pop(); if (!L) return { k: "chop" }; }   // mostly in the clip: finish the word, else end before it
    else L = W.filter(w => w[1] <= t + m).pop();
    if (!L) return { k: "none" };
    const N = W.find(w => w[0] >= L[1] - 1e-3 && w !== L), dec = (SP.find(s => s[0] <= L[1] + 1e-3 && s[1] >= L[1] - 1e-3) || [0, L[1]])[1];
    const want = Math.max(L[1] + o.after, Math.min(dec + 0.04, L[1] + 0.15)), cap = N ? N[0] - Math.min(0.06, (N[0] - L[1]) / 2) : end;
    return { k: chop ? "fix" : "ok", t: Math.max(L[1], Math.min(want, cap)), lo: L[1], hi: Math.max(L[1], cap) }; }
  let F;
  if (chop) { if (!o.fix) return { k: "chop" }; F = (chop[1] - t) >= (t - chop[0]) ? chop : W.find(w => w[0] >= chop[1] - 1e-3); if (!F) return { k: "chop" }; }
  else F = W.find(w => w[0] >= t - m);
  if (!F) return { k: "none" };
  const Pv = W.filter(w => w[1] <= F[0] + 1e-3 && w !== F).pop(), on = (SP.find(s => s[0] <= F[0] + 1e-3 && s[1] >= F[0] - 1e-3) || [F[0]])[0];
  const want = Math.min(F[0] - o.before, Math.max(on - 0.02, F[0] - 0.1)), cap = Pv ? Pv[1] + Math.min(0.06, (F[0] - Pv[1]) / 2) : r.a;
  return { k: chop ? "fix" : "ok", t: Math.min(F[0], Math.max(want, cap, 0)), lo: Math.min(F[0], Math.max(cap, 0)), hi: F[0] }; }
const EC = new Map();   // file -> [{a, rms, len}] edge windows of the source media
async function scanEdges(clips, Rb, Ra, onProg, stopped){
  const by = new Map(); clips.forEach(c => { const sp = c.spd || 1; if (!by.has(c.path)) by.set(c.path, []);
    by.get(c.path).push([Math.max(0, c.in - Rb * sp - 0.3), c.in + 0.8], [Math.max(0, c.out - 0.8), c.out + Ra * sp + 0.3]); });
  const jobs = []; by.forEach((R, file) => { R.sort((x, y) => x[0] - y[0]); const M = []; R.forEach(r => { const l = M[M.length - 1]; if (l && r[0] - l[1] < 3) l[1] = Math.max(l[1], r[1]); else M.push(r.slice()); });
    M.forEach(([a, b]) => { if (!(EC.get(file) || []).some(s => s.a <= a + 1e-3 && s.b >= b - 1e-3)) jobs.push({ file, a, b }); }); });
  let i = 0, done = 0; const errs = [];
  const w = async () => { while (i < jobs.length && !stopped()) { const j = jobs[i++]; const r = await scanSpan(j.file, j.a, j.b); done++; onProg(done / jobs.length);
      if (r.ok) { if (!EC.has(j.file)) EC.set(j.file, []); EC.get(j.file).push({ a: j.a, b: j.b, rms: r.rms, len: Math.min(r.len, r.rms.length), eof: r.len < r.rms.length - 1 }); } else errs.push(path.basename(j.file) + ": " + r.err); } };
  const nW = Math.max(2, Math.min(12, ((os_ && os_.cpus().length) || 4)));
  await Promise.all(Array.from({ length: nW }, w)); return errs; }
/* loudness of the 0.05 s step that holds media time t; null = not read or past the end of the file */
function rmsAt(file, t){ if (t < 0) return null; const L = EC.get(file); if (!L) return null;
  for (const s of L) { const i = Math.floor((t - s.a) / STEP); if (i >= 0 && i < s.len) return s.rms[i]; } return null; }
/* ---------- Room to breathe v2: plan the new edges, then write a NEW sequence (Premiere XML) instead of moving clips one by one ----------
   Why: moving 1000+ clips with the scripting API left audio fades at their old spots (fades in the middle of clips), lost video clips
   (black screen) and was slow. Now the whole timeline is recalculated in memory and imported as a new sequence next to the original:
   the original is never touched (that is the undo), every linked clip keeps its sync, fades sit exactly on the new cuts. */
/* Premiere writes a clip that meets a transition with start or end "-1": it really starts / ends at the cut in the middle of the
   transition, and its in / out reach into the handle. Put every clip back on its real cut before planning */
function atCuts(S){ const fix = T => T.map(t => Object.assign({}, t, { clips: t.clips.map(c0 => { const c = Object.assign({}, c0), sp = c.spd || 1;
    if (c.tin && c.tin.length > 2) { const d = c.tin[2] - c.s; if (d > 0 && d < c.e - c.s) { c.s += d; c.in += d * sp; } }
    if (c.tout && c.tout.length > 2) { const d = c.e - c.tout[2]; if (d > 0 && d < c.e - c.s) { c.e -= d; c.out -= d * sp; } }
    return c; }) }));
  return Object.assign({}, S, { v: fix(S.v), a: fix(S.a) }); }
function roomPlan(S0, ti, o, SPC, spKey, edgeDecision){
  const S = atCuts(S0);
  const fps = S.fps || 30, fr = 1 / fps, hf = fr * 0.5, tol = fr * 1.5;
  const R = (S.a[ti] || { clips: [] }).clips.filter(c => !c.dis && c.path).slice().sort((a, b) => a.s - b.s), n = R.length;
  const st = { cuts: n, ext: 0, trim: 0, fixed: 0, none: 0, secs: 0, flagged: [], gapsLeft: 0, unsynced: 0, trimmedOther: 0 };
  const H = new Array(n).fill(0), Tl = new Array(n).fill(0);
  /* an edge moves by whole frames: the frame nearest to where it should be that keeps it between lo and hi (after the last word it keeps,
     before the next word). Where two words sit closer together than one frame, the frame that cuts the least */
  const snap = (v, lo, hi) => { const a = Math.floor(v * fps + 0.01), b = Math.ceil(v * fps - 0.01); if (a >= b) return Math.round(v * fps) / fps;
    const bad = k => { const x = Math.max(lo - k / fps, k / fps - hi, 0); return x < 0.002 ? 0 : x; }, va = bad(a), vb = bad(b);
    if (a <= 0 && b >= 0 && bad(0) <= Math.min(va, vb)) return 0;
    return (va < vb ? a : vb < va ? b : Math.round(v * fps)) / fps; };
  R.forEach((c, i) => { const sp = c.spd || 1, P = R[i - 1], N = R[i + 1], len = c.e - c.s;
    /* a cut inside one continuous take (same file, the sound carries straight on) is not a cut in what you hear: leave it */
    const contP = !!P && P.path === c.path && Math.abs(P.e - c.s) < 0.02 && Math.abs(P.out - c.in) < 0.06, contN = !!N && N.path === c.path && Math.abs(N.s - c.e) < 0.02 && Math.abs(N.in - c.out) < 0.06;
    const dO = contN ? null : edgeDecision("o", c.out, SPC.get(spKey(c.path, c.out, "o")), o), dI = contP ? null : edgeDecision("i", c.in, SPC.get(spKey(c.path, c.in, "i")), o); let h = 0, tl = 0, fx = 0;
    if (dO) { if (dO.k === "chop") st.flagged.push(c.e); else if (dO.t != null) { tl = snap((dO.t - c.out) / sp, (dO.lo - c.out) / sp, (dO.hi - c.out) / sp); if (dO.k === "fix") fx++; } }
    if (dI) { if (dI.k === "chop") st.flagged.push(c.s); else if (dI.t != null) { h = snap((c.in - dI.t) / sp, (c.in - dI.hi) / sp, (c.in - dI.lo) / sp); if (dI.k === "fix") fx++; } }
    /* only a clip with a whole word in it is touched: a breath, a laugh, a pause left on purpose or game sound stays exactly as it is */
    const lastEnd = dO && dO.t != null ? dO.lo : null, firstStart = dI && dI.t != null ? dI.hi : null;
    const noWord = (lastEnd != null && lastEnd <= (firstStart != null ? firstStart : c.in) + 0.03) || (firstStart != null && firstStart >= (lastEnd != null ? lastEnd : c.out) - 0.03);
    if (noWord || len + h + tl < Math.min(len, 2 * fr) - 1e-6) { if (dO && dO.k === "fix") st.flagged.push(c.e); if (dI && dI.k === "fix") st.flagged.push(c.s); h = 0; tl = 0; fx = 0; }
    /* never past the start or end of the recording */
    if (c.in - h * sp < 0) h = Math.floor(c.in / sp * fps + 1e-6) / fps;
    if (c.dur && c.out + tl * sp > c.dur) tl = Math.max(-len, Math.floor((c.dur - c.out) / sp * fps + 1e-6) / fps);
    if (o.trim === false) { h = Math.max(0, h); tl = Math.max(0, tl); }   // "only add room": a long pause stays (battles, gameplay)
    H[i] = h; Tl[i] = tl; st.fixed += fx; });
  /* new voice timeline: every clip keeps its order; new room is taken out of an existing gap first, a trimmed pause closes up */
  const NS = new Array(n), NE = new Array(n), NI = new Array(n), NO = new Array(n), GAP = new Array(n).fill(0), NGAP = new Array(n).fill(0);
  const snapT = x => Math.round(x * fps) / fps;
  let shift0 = 0;
  for (let i = 0; i < n; i++) { const c = R[i], sp = c.spd || 1;
    if (i === 0) { let s = c.s - Math.max(0, H[0]); if (s < 0) { shift0 = -s; s = 0; } NS[0] = snapT(s); }   // a trimmed start doesn't leave a hole before the first clip
    else { const g = R[i].s - R[i - 1].e; GAP[i] = g; let ng = g;
      if (g > hf) ng = Math.max(0, g - Math.max(0, Tl[i - 1]) - Math.max(0, H[i]));   // room comes out of the gap that was already there
      else ng = Math.max(0, g);
      NGAP[i] = ng; NS[i] = snapT(NE[i - 1] + ng); }
    NE[i] = snapT(NS[i] + (c.e - c.s) + H[i] + Tl[i]); if (NE[i] - NS[i] < fr) NE[i] = NS[i] + fr;
    NI[i] = c.in - H[i] * sp; NO[i] = NI[i] + (NE[i] - NS[i]) * sp; }
  /* where a moment of the old timeline lands. Inside a voice clip it moves with the clip (and stops at the clip's new edges);
     in a gap between two voice clips it keeps its place in that gap (scaled when the gap got shorter) */
  const kAt = t => { let lo = 0, hi = n - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (R[m].s <= t + 1e-6) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  const M = (t, side) => { if (!n) return t; const k = kAt(t);
    if (k < 0) return Math.max(0, t + (NS[0] + H[0] - R[0].s));
    const c = R[k];
    if (Math.abs(t - c.s) < hf) return NS[k];                                  // on a voice cut: stays on it
    if (Math.abs(t - c.e) < hf) return NE[k];
    if (t < c.e) return Math.min(NE[k], Math.max(NS[k], NS[k] + H[k] + (t - c.s)));
    if (k + 1 < n) { if (side === "e" && Math.abs(t - R[k + 1].s) < hf) return NS[k + 1]; const g = R[k + 1].s - c.e, ng = NS[k + 1] - NE[k]; return NE[k] + (g > 1e-6 ? (t - c.e) * ng / g : 0); }
    return NE[k] + (t - c.e); };
  /* every clip on every track: [kind, track, k, S, E, In, Out] */
  const out = { V: S.v.map(() => []), A: S.a.map(() => []) };
  const byPath = new Map(); R.forEach((c, i) => { if (!byPath.has(c.path)) byPath.set(c.path, []); byPath.get(c.path).push(i); });
  const offOf = (c, s, inn) => inn - s * (c.spd || 1);
  const linkedTo = c => { const L = byPath.get(c.path); if (!L) return -1; let best = -1, bo = 0;
    for (const q of L) { const v = R[q]; if (Math.abs((c.spd || 1) - (v.spd || 1)) > 0.002 || Math.abs(offOf(c, c.s, c.in) - offOf(v, v.s, v.in)) > tol) continue;
      const ov = Math.min(c.e, v.e) - Math.max(c.s, v.s); if (ov > bo + 1e-6) { bo = ov; best = q; } } return bo > fr ? best : -1; };
  const Ridx = new Map(); R.forEach((c, i) => Ridx.set(c, i));
  [["V", S.v], ["A", S.a]].forEach(([kind, T]) => T.forEach((tr, t) => { const L = out[kind][t];
    tr.clips.forEach(c => { const sp = c.spd || 1, dur = c.dur || 0;
      if (kind === "A" && t === ti && Ridx.has(c)) { const i = Ridx.get(c); L.push({ c, s: NS[i], e: NE[i], in: NI[i], out: NO[i], j: i, voice: true }); return; }
      const j = c.path ? linkedTo(c) : -1;
      if (j >= 0) { const v = R[j], off2 = NI[j] - NS[j] * sp;   // same take as a voice clip: keeps exactly the same sync as the voice
        const s2 = Math.abs(c.s - v.s) < tol ? NS[j] : snapT(M(c.s, "s")), e2 = Math.abs(c.e - v.e) < tol ? NE[j] : snapT(M(c.e, "e"));
        if (c.s < v.s - tol || c.e > v.e + tol) { const others = (byPath.get(c.path) || []).filter(q => q !== j && Math.min(c.e, R[q].e) - Math.max(c.s, R[q].s) > fr); if (others.length) st.unsynced++; }
        L.push({ c, s: s2, e: Math.max(s2 + fr, e2), in: off2 + s2 * sp, out: off2 + Math.max(s2 + fr, e2) * sp, j }); return; }
      const s2 = snapT(M(c.s, "s")); let e2 = s2 + (c.e - c.s);                 // anything else (b-roll, music, titles) moves as it is
      const eOnCut = n && R.some((v, i) => Math.abs(c.e - v.e) < hf || Math.abs(c.e - v.s) < hf);
      if (eOnCut) e2 = snapT(M(c.e, "e"));
      const still = !c.path || /\.(png|jpe?g|tga|tiff?|bmp|gif|psd|ai|eps|webp|exr|dpx|heic)$/i.test(c.path);
      let o2 = c.in + (e2 - s2) * sp; if (!still && dur && o2 > dur) { e2 = s2 + Math.max(fr, (dur - c.in) / sp); o2 = c.in + (e2 - s2) * sp; }
      L.push({ c, s: s2, e: snapT(e2) > s2 ? snapT(e2) : s2 + fr, in: c.in, out: c.in + ((snapT(e2) > s2 ? snapT(e2) : s2 + fr) - s2) * sp, j: -1 }); });
    /* clean up the track: in order, never overlapping, nothing thinner than a frame; video clips that touched still touch (no black frames) */
    L.sort((a, b) => a.s - b.s || a.c.s - b.c.s);
    const keepTouch = kind === "V";
    for (let q = 0; q + 1 < L.length; q++) { const A = L[q], B = L[q + 1], sa = A.c.spd || 1, sb = B.c.spd || 1;
      if (A.e > B.s + 1e-6) { const cut = Math.min(A.e - B.s, A.e - A.s - fr); if (cut > 1e-6) { A.e -= cut; A.out -= cut * sa; st.trimmedOther++; }
        if (A.e > B.s + 1e-6) { const d = A.e - B.s; B.s += d; B.in += d * sb; if (B.e - B.s < fr) { B.e = B.s + fr; B.out = B.in + fr * sb; } } }
      else if (keepTouch && Math.abs(B.c.s - A.c.e) < hf && B.s - A.e > hf) {
        let g = B.s - A.e; const roomA = A.c.dur && !/\.(png|jpe?g|gif|psd|tiff?)$/i.test(A.c.path || "") ? Math.max(0, (A.c.dur - A.out) / sa) : (A.c.path ? 0 : Infinity);
        const grow = Math.min(g, Math.floor(roomA * fps + 1e-6) / fps); if (grow > 1e-6) { A.e += grow; A.out += grow * sa; g -= grow; }
        if (g > hf) { const back = Math.min(g, Math.floor(Math.max(0, B.in) / sb * fps + 1e-6) / fps); if (back > 1e-6) { B.s -= back; B.in -= back * sb; g -= back; } }
        if (g > hf) st.gapsLeft++; } }
    L.forEach(x => { if (x.in < 0) { const d = -x.in / (x.c.spd || 1); x.s += d; x.in = 0; } }); }));
  R.forEach((c, i) => { if (H[i] > 1e-6 || Tl[i] > 1e-6) st.ext++; if (H[i] < -1e-6 || Tl[i] < -1e-6) st.trim++; if (Math.abs(H[i]) < 1e-6 && Math.abs(Tl[i]) < 1e-6) st.none++; });
  st.secs = n ? (NE[n - 1] - R[n - 1].e) : 0;
  const moved = ["V", "A"].reduce((m, kd) => m + out[kd].reduce((m2, L) => m2 + L.filter(x => Math.abs(x.s - x.c.s) > 1e-4 || Math.abs(x.e - x.c.e) > 1e-4 || Math.abs(x.in - x.c.in) > 1e-4).length, 0), 0);
  return { ti, R, H, Tl, NS, NE, NI, NO, out, st, moved }; }

/* write the planned timeline as a new Premiere XML from the one Premiere exported. o.fades: "2f" = a 2-frame crossfade at every audio cut
   (no clicks, never long enough to play part of a word), "none" = no audio fades. Video dissolves are kept, centred on their cut. */
function roomXml(txt, S, plan, o, DOMParserC, XMLSerializerC){
  const doc = new DOMParserC().parseFromString(txt, "text/xml"), seq = doc.querySelector("sequence"), fps = S.fps || 30, fr = 1 / fps, TPS = 254016000000;
  const kid = (n, t) => { for (const c of n.children) if (c.tagName === t) return c; return null; };
  const setT = (n, t, v) => { let c = kid(n, t); if (!c) { c = doc.createElement(t); n.appendChild(c); } c.textContent = String(v); };
  const media = kid(seq, "media"), F = x => Math.round(x * fps);
  const tracksOf = kind => { const sec = kid(media, kind === "V" ? "video" : "audio"); return sec ? [...sec.children].filter(c => c.tagName === "track") : []; };
  const cfpsOf = it => { const cr = kid(it, "rate"); if (!cr) return fps; const tb = parseFloat((kid(cr, "timebase") || {}).textContent) || fps; return /TRUE/i.test((kid(cr, "ntsc") || {}).textContent || "") ? tb * 1000 / 1001 : tb; };
  const fileDur = new Map(); doc.querySelectorAll("file[id]").forEach(f => { const d = kid(f, "duration"), r = kid(f, "rate"); if (d && r) { const tb = parseFloat((kid(r, "timebase") || {}).textContent) || fps, nt = /TRUE/i.test((kid(r, "ntsc") || {}).textContent || ""); fileDur.set(f.getAttribute("id"), parseFloat(d.textContent) / (nt ? tb * 1000 / 1001 : tb)); } });
  let tpl = { V: null, A: null };   // a transition from the original to copy (keeps Premiere's own format)
  const where = new Map();   // clipitem id -> [kind, trackIndex(1-based), clipindex(1-based)]
  let maxEnd = 0, nFades = 0, nDiss = 0;
  ["V", "A"].forEach(kind => tracksOf(kind).forEach((tr, ti) => {
    const items = [...tr.children].filter(c => c.tagName === "clipitem" || c.tagName === "transitionitem"), clips = items.filter(c => c.tagName === "clipitem");
    const P = (plan.out[kind][ti] || []);
    /* old video dissolves: remember which cut they sat on (the clip before + after) and how long they were */
    const diss = [];
    items.forEach((it, q) => { if (it.tagName !== "transitionitem") return; const eff = kid(it, "effect"), mt = eff && kid(eff, "mediatype");
      if (mt && /audio/i.test(mt.textContent)) { if (!tpl.A) tpl.A = it.cloneNode(true); }
      else { if (!tpl.V) tpl.V = it.cloneNode(true); let a = null, b = null; for (let k = q - 1; k >= 0; k--) if (items[k].tagName === "clipitem") { a = items[k]; break; } for (let k = q + 1; k < items.length; k++) if (items[k].tagName === "clipitem") { b = items[k]; break; }
        const s = parseFloat((kid(it, "start") || {}).textContent), e = parseFloat((kid(it, "end") || {}).textContent); diss.push({ it, a, b, len: e - s }); }
      tr.removeChild(it); });
    /* new edges for every clip (by its position in the track: the k-th clipitem is S[kind][ti].clips[k]) */
    const byClip = new Map(); P.forEach(x => byClip.set(x.c.k, x));
    const placed = clips.map((ci, k) => { const x = byClip.get(k); return { ci, x, s: x ? x.s : null }; });
    placed.forEach(p => { if (!p.x) return; const ci = p.ci, cf = cfpsOf(ci), x = p.x;
      setT(ci, "start", F(x.s)); setT(ci, "end", F(x.e)); setT(ci, "in", Math.round(x.in * cf)); setT(ci, "out", Math.round(x.out * cf));
      setT(ci, "pproTicksIn", Math.round(x.in * TPS)); setT(ci, "pproTicksOut", Math.round(x.out * TPS)); maxEnd = Math.max(maxEnd, F(x.e)); });
    placed.sort((a, b) => (a.s == null ? 1e12 : a.s) - (b.s == null ? 1e12 : b.s));
    placed.forEach(p => tr.appendChild(p.ci));   // in time order
    /* transitions back in, on the new cuts */
    const seqItems = []; const after = new Map();
    for (let q = 0; q + 1 < placed.length; q++) { const A = placed[q], B = placed[q + 1]; if (!A.x || !B.x) continue;
      if (Math.abs(F(B.x.s) - F(A.x.e)) > 0) continue;   // only where two clips touch
      const ca = A.x.c, cb = B.x.c, cut = F(A.x.e);
      const fdA = (ca.dur || fileDur.get((kid(A.ci, "file") || { getAttribute: () => "" }).getAttribute("id")) || 0), fdB = (cb.dur || fileDur.get((kid(B.ci, "file") || { getAttribute: () => "" }).getAttribute("id")) || 0);
      const roomA = fdA ? Math.floor((fdA - A.x.out) / (ca.spd || 1) * fps + 1e-6) : 99, roomB = Math.floor(B.x.in / (cb.spd || 1) * fps + 1e-6);
      if (kind === "A") { if (o.fades !== "2f" || !tpl.A && !o.audioTpl) continue;
        const cont = ca.path && ca.path === cb.path && Math.abs(A.x.out - B.x.in) < 0.06; if (cont) continue;   // the same take carrying on: nothing to smooth
        if (roomA < 1 || roomB < 1) continue;
        const t = (tpl.A || o.audioTpl).cloneNode(true); setT(t, "start", cut - 1); setT(t, "end", cut + 1); setT(t, "pproTicksIn", Math.round((cut - 1) * TPS / fps)); setT(t, "pproTicksOut", Math.round((cut + 1) * TPS / fps));
        setT(t, "alignment", "center"); setT(t, "cutPointTicks", Math.round(TPS / fps)); after.set(B.ci, t); nFades++; }
      else { const d = diss.find(z => z.a === A.ci && z.b === B.ci); if (!d) continue;
        let half = Math.floor(d.len / 2); half = Math.min(half, roomA, roomB); if (half < 1) continue;
        const t = d.it; setT(t, "start", cut - half); setT(t, "end", cut + half); setT(t, "alignment", "center"); setT(t, "cutPointTicks", Math.round(half * TPS / fps));
        if (kid(t, "pproTicksIn")) { setT(t, "pproTicksIn", Math.round((cut - half) * TPS / fps)); setT(t, "pproTicksOut", Math.round((cut + half) * TPS / fps)); }
        after.set(B.ci, t); nDiss++; } }
    after.forEach((t, ci) => tr.insertBefore(t, ci));
    [...tr.children].filter(c => c.tagName === "clipitem" || c.tagName === "transitionitem").forEach((it, q) => { if (it.tagName === "clipitem") where.set(it.getAttribute("id"), [kind, ti + 1, q + 1]); }); }));
  /* links: Premiere finds linked clips by track + position (clips and transitions both count), so every link is pointed at the new spot */
  doc.querySelectorAll("clipitem > link").forEach(l => { const r = kid(l, "linkclipref"); if (!r) return; const w = where.get(r.textContent); if (!w) return; setT(l, "trackindex", w[1]); setT(l, "clipindex", w[2]); });
  setT(seq, "duration", maxEnd); const nm = kid(seq, "name"); if (nm) nm.textContent = o.name || (nm.textContent + " - room");
  const u = kid(seq, "uuid"); if (u) u.textContent = "af" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2, 10) + "-room";
  let x = new XMLSerializerC().serializeToString(doc); if (!/^<\?xml/.test(x)) x = '<?xml version="1.0" encoding="UTF-8"?>\n' + x; if (!/<!DOCTYPE xmeml>/.test(x)) x = x.replace(/(<\?xml[^>]*>\s*)/, "$1<!DOCTYPE xmeml>\n");
  return { xml: x, fades: nFades, dissolves: nDiss }; }
function voiceTrack(S){ let best = -1, bn = -1; S.a.forEach((t, i) => { if (t.mute) return; const n = t.clips.filter(c => !c.dis && c.path).length; if (n > bn) { bn = n; best = i; } }); return best; }
let brUndo = null;
$("afx-fd").onclick = async () => { ROOM = true; if (busy) return; busy = true; const b = $("afx-fd"); b.disabled = true;
  try { const S = await readSeq(); if (S.error) throw new Error(S.error); let ti = +$("afx-br-t").value; if (!(ti >= 0) || !S.a[ti]) ti = voiceTrack(S); if (ti < 0) throw new Error("No audio clips in this sequence.");
    const d = JSON.parse(await call("afx_fades", { track: ti, dry: true })); if (d.error) throw new Error(d.error);
    if (!d.total) { st("No audio fades on " + S.a[ti].name + "."); return; }
    if (!confirm("Remove all " + d.total + " audio fades on " + S.a[ti].name + "?\\n\\nFades blend in sound from past each cut, which can bring back pauses or bits of words. Ctrl+Z in Premiere brings them back.")) { st("Cancelled."); return; }
    const r = JSON.parse(await call("afx_fades", { track: ti, all: true })); if (r.error) throw new Error(r.error);
    st("✓ Removed " + r.removed + " of " + r.total + " audio fades."); try { window._afBootLog && _afBootLog("fades removed " + r.removed + "/" + r.total); } catch (e) {} }
  catch (e) { st("⚠ " + e.message); } finally { busy = false; b.disabled = false; } };
/* repair: close gaps on video tracks where the clip's own audio (same file, in sync) keeps playing across the gap */
function videoGapPlan(S, maxGap){ const fr = 1 / (S.fps || 30), off = c => c.in - c.s * (c.spd || 1), lay = [], undo = []; let n = 0, secs = 0;
  const AU = new Map(); S.a.forEach(t => t.clips.forEach(c => { if (c.dis || !c.path) return; if (!AU.has(c.path)) AU.set(c.path, []); AU.get(c.path).push(c); }));
  const MX = new Map(); AU.forEach((L, k) => { L.sort((x, y) => x.s - y.s); let m = -1e9; MX.set(k, L.map(c => (m = Math.max(m, c.e)))); });
  /* audio of the same file that overlaps this clip, exactly: clips sorted by start + the longest end so far, so a binary search finds
     the first one that could still be playing (even a 10-minute clip that started long before) */
  const near = c => { const L = AU.get(c.path) || [], E = MX.get(c.path) || [], R = []; let lo = 0, hi = L.length - 1, k = L.length;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (E[m] > c.s) { k = m; hi = m - 1; } else lo = m + 1; }
    for (let q = k; q < L.length && L[q].s < c.e; q++) if (L[q].e > c.s) R.push(L[q]); return R; };
  const audioOf = c => { let best = null, bo = 0; near(c).forEach(a => { if (a.path !== c.path || Math.abs((a.spd || 1) - (c.spd || 1)) > 0.002 || Math.abs(off(a) - off(c)) > fr * 1.5) return; const ov = Math.min(a.e, c.e) - Math.max(a.s, c.s); if (ov > bo) { bo = ov; best = a; } }); return best; };
  S.v.forEach((tr, t) => { const L = tr.clips.slice().sort((a, b) => a.s - b.s), N = L.map(c => [c.s, c.e]);
    for (let q = 0; q + 1 < L.length; q++) { const c1 = L[q], c2 = L[q + 1], g = c2.s - N[q][1]; if (g < fr * 0.5 || g > maxGap) continue;
      const a1 = audioOf(c1); if (a1 && a1.e > N[q][1] + fr * 0.5) N[q][1] = Math.min(a1.e, c2.s);
      const a2 = audioOf(c2); if (c2.s - N[q][1] > fr * 0.5 && a2 && a2.s < c2.s - fr * 0.5) N[q + 1][0] = Math.max(a2.s, N[q][1], c2.s - c2.in / (c2.spd || 1));
      if (N[q + 1][0] - N[q][1] < g - 1e-4) { n++; secs += g - Math.max(0, N[q + 1][0] - N[q][1]); } }
    L.forEach((c, q) => { const [S2, E2] = N[q]; if (Math.abs(S2 - c.s) < 1e-4 && Math.abs(E2 - c.e) < 1e-4) return; const sp = c.spd || 1, I2 = c.in + (S2 - c.s) * sp, O2 = c.out + (E2 - c.e) * sp, r = v => Math.round(v * 1e5) / 1e5;
      lay.push(["V", t, r(c.s), r(S2), r(E2), r(I2), r(O2)]); undo.push(["V", t, r(S2), r(c.s), r(c.e), r(c.in), r(c.out)]); }); });
  return { lay, undo, n, secs }; }
$("afx-vg").onclick = async () => { ROOM = true; if (busy) return; busy = true; const b = $("afx-vg"); b.disabled = true;
  try { st("Reading the sequence…"); const S = await readSeq(); if (S.error) throw new Error(S.error);
    const p = videoGapPlan(S, 2); if (!p.lay.length) { st("No video gaps that its own audio covers."); return; }
    if (!confirm("Fill " + p.n + " gaps in the video (" + p.secs.toFixed(1) + " s) by extending each clip to match its own audio?\nNothing else moves. You can undo it here.")) { st("Cancelled."); return; }
    const r = JSON.parse(await call("afx_layout", p.lay)); if (r.error) throw new Error(r.error); brUndo = p.undo; $("afx-br-undo").style.display = "";
    st("✓ Filled " + p.n + " video gaps (" + r.done + " clips" + (r.off + r.missing ? ", " + (r.off + r.missing) + " didn't land exactly" : "") + ")."); try { window._afBootLog && _afBootLog("video gaps " + p.n + " done " + r.done + " off " + r.off); } catch (e) {}
    if (last) { const S2 = await readSeq(); if (!S2.error) { last = S2; render("Updated"); } } }
  catch (e) { st("⚠ " + e.message); } finally { busy = false; b.disabled = false; } };

let brOrig = null;
$("afx-br-go").onclick = async () => { ROOM = true; if (busy) return; busy = true; stop = false; const b = $("afx-br-go"); b.disabled = true; $("afx-qc-stop").disabled = false; bar(0);
  try { st("Reading the sequence…"); const S = await readSeq(); if (S.error) throw new Error(S.error);
    if (!S.xml) throw new Error("Premiere couldn't hand over the sequence as XML (File > Export > Final Cut Pro XML must work for this sequence). Save the project and try again.");
    const sel = $("afx-br-t"), keep = sel.value; sel.innerHTML = '<option value="-1">Auto (most cuts)</option>' + S.a.map((t, i) => '<option value="' + i + '">' + esc(t.name) + " (" + t.clips.length + " clips)</option>").join(""); sel.value = keep;
    let ti = +sel.value; if (!(ti >= 0) || !S.a[ti]) ti = voiceTrack(S); if (ti < 0) throw new Error("No audio clips in this sequence.");
    const o = { before: +$("afx-br-a3").value, after: +$("afx-br-b3").value, fix: $("afx-br-fix").checked, trim: $("afx-br-trim").checked, fades: $("afx-br-fd2").value || "2f" };
    const C = atCuts(S).a[ti].clips.filter(c => !c.dis && c.path && !c.off);   /* the words around each REAL cut (clips meeting a transition are put back on their cut first) */
    st("Finding the words around " + C.length + " clips…"); const errs = await speechEdges(C, f => { bar(f); st("Finding the words around the cuts… " + Math.round(f * 100) + "%"); }, () => stop);
    if (stop) { st("Stopped."); return; }
    const t0 = Date.now(), p = roomPlan(S, ti, o, SPC, spKey, edgeDecision), x = p.st;
    if (!p.moved) { st("Cuts already good: nothing to change."); return; }
    if (!confirm("Room to breathe on " + S.a[ti].name + ":\n\n• " + x.ext + " cuts get a little room\n• " + x.trim + " long pauses at cuts shortened\n• " + x.fixed + " chopped words finished\n• " + x.none + " cuts already right or with no talking at the edge (left as they are)\n• " + (x.secs >= 0 ? "+" : "") + x.secs.toFixed(1) + " s overall" + (x.flagged.length ? "\n• " + x.flagged.length + " chopped words couldn't be fixed (left for you to check)" : "") + (o.fades === "2f" ? "\n• a tiny 2-frame fade on every audio cut" : "") + "\n\nThis makes a NEW sequence next to \"" + S.name + "\" (yours stays exactly as it is).")) { st("Cancelled."); return; }
    st("Writing the new sequence…"); const name = S.name + " - room", w = roomXml(S.xml, S, p, Object.assign({ name }, o), DOMParser, XMLSerializer);
    const f = path.join(os_ ? os_.tmpdir() : extDir(), "assetflow_room_" + Date.now() + ".xml"); fs.writeFileSync(f, w.xml, "utf8");
    st("Opening it in Premiere…"); const r = JSON.parse(await call("afx_importVersion", { path: f.replace(/\\/g, "/"), name })); try { fs.unlinkSync(f); } catch (e) {}
    if (r.error) throw new Error(r.error);
    brOrig = S.id; $("afx-br-orig").style.display = "";
    p.R.forEach((c, i) => { const sp = c.spd || 1; if (p.H[i]) spNote(c.path, c.in - p.H[i] * sp, "i", SPC.get(spKey(c.path, c.in, "i"))); if (p.Tl[i]) spNote(c.path, c.out + p.Tl[i] * sp, "o", SPC.get(spKey(c.path, c.out, "o"))); });   // so Quality check knows the words at the moved edges
    st("✓ New sequence \"" + r.name + "\": " + x.ext + " cuts got room, " + x.trim + " pauses shortened, " + x.fixed + " chopped words finished" + (w.fades ? ", " + w.fades + " audio fades on the cuts" : "") + (w.dissolves ? ", " + w.dissolves + " dissolves kept" : "") + "." + (r.oos ? " ⚠ " + r.oos + " linked clips report out of sync: check them." : "") + (x.gapsLeft ? " ⚠ " + x.gapsLeft + " short video gap" + (x.gapsLeft > 1 ? "s" : "") + " where a clip had no footage left (Check sequence lists them)." : "") + (x.flagged.length ? " " + x.flagged.length + " chopped words couldn't be fixed." : "") + (Math.abs(x.secs) > 1 ? " It is " + Math.abs(x.secs).toFixed(1) + " s " + (x.secs < 0 ? "shorter" : "longer") + ": run Tools → Auto-fit music again so the song still ends with it." : "") + (errs && errs.length ? " (" + errs.join("; ") + ")" : ""));
    try { window._afBootLog && _afBootLog("room v2 " + x.ext + "/" + x.trim + "/" + x.fixed + " fades " + w.fades + " diss " + w.dissolves + " gaps " + x.gapsLeft + " in " + (Date.now() - t0) + "ms"); } catch (e) {}
    if (last) { const S2 = await readSeq(); if (!S2.error) { last = S2; render("Room added"); } } }
  catch (e) { st("⚠ " + e.message); try { window._afBootLog && _afBootLog("room v2 error " + e.message); } catch (e2) {} } finally { busy = false; b.disabled = false; $("afx-qc-stop").disabled = true; bar(1); } };
$("afx-br-orig").onclick = async () => { ROOM = true; if (!brOrig) return; try { const r = await call("afx_openSeq", brOrig); st(/^1/.test(r || "") ? "↩ Back on your original sequence (the new one is still in the project)." : "⚠ Couldn't find the original sequence."); } catch (e) { st("⚠ " + e.message); } };
$("afx-br-undo").onclick = async () => { ROOM = true; if (!brUndo || busy) return; busy = true;   /* undo for "Fill video gaps" */
  try { const r = JSON.parse(await call("afx_layout", brUndo)); st(r.error ? "⚠ " + r.error : "↩ Put " + r.done + " clips back" + (r.off + r.missing ? " (" + (r.off + r.missing) + " didn't land exactly)" : "") + "."); brUndo = null; $("afx-br-undo").style.display = "none"; }
  catch (e) { st("⚠ " + e.message); } finally { busy = false; } };
$("afx-qc-stop").onclick = () => { stop = true; stopAll(); };
let gapUndo = null;
$("afx-gaps").onclick = async () => { ROOM = true; if (busy) return; busy = true; const b = $("afx-gaps"); b.disabled = true;
  try { const d = JSON.parse(await call("afx_closeGaps", { dry: true }));
    if (d.error) throw new Error(d.error);
    if (!d.gaps) { st("No gaps to close."); return; }
    if (!confirm("Close " + d.gaps + " gap" + (d.gaps > 1 ? "s" : "") + " (" + d.secs.toFixed(1) + " s in total)?\n\nEverything after each gap moves left; all tracks stay in sync. You can undo it here.")) return;
    st("Closing gaps…"); const r = JSON.parse(await call("afx_closeGaps", {})); if (r.error) throw new Error(r.error);
    gapUndo = r.undo || null; $("afx-gaps-undo").style.display = gapUndo && gapUndo.length ? "" : "none";
    st("✓ Closed " + r.gaps + " gap" + (r.gaps > 1 ? "s" : "") + " (" + r.secs.toFixed(1) + " s), " + r.moved + " clips moved."); try { window._afBootLog && _afBootLog("close gaps " + r.gaps + "/" + r.moved); } catch (e) {}
    if (last) { const S = await readSeq(); if (!S.error) { last = S; render("Updated"); } } }
  catch (e) { st("⚠ " + e.message); } finally { busy = false; b.disabled = false; } };
$("afx-gaps-undo").onclick = async () => { ROOM = true; if (!gapUndo || busy) return; busy = true;
  try { const r = JSON.parse(await call("afx_undoGaps", gapUndo)); st(r.error ? "⚠ " + r.error : "↩ Put " + r.restored + " clips back."); gapUndo = null; $("afx-gaps-undo").style.display = "none"; }
  catch (e) { st("⚠ " + e.message); } finally { busy = false; } };
$("afx-qc-go").onclick = async () => { ROOM = false; if (busy) return; busy = true; stop = false; cur = -1; $("afx-qc-go").disabled = true; $("afx-qc-stop").disabled = false; bar(0);
  try { st("Reading the sequence…"); const deep = $("afx-qc-deep").checked, t0 = Date.now(), S = await readSeq(); if (S.error) throw new Error(S.error); try { window._afBootLog && _afBootLog("QC read " + S.name + " in " + (Date.now() - t0) + "ms" + (S.viaXml ? " (xml)" : "")); } catch (e) {}
    if (deep) { S.a.forEach(t => t.clips.forEach(c => { if (c.lvl != null && !c.tv) gain.set(c.path + "|" + c.in.toFixed(3), c.lvl); }));
      const AC = S.a.filter(t => !t.mute).flatMap(t => t.clips.filter(c => !c.dis && c.path && !c.off));
      st("Listening to the audio…"); const errs = await listen(AC, f => { bar(f); st("Listening to the audio… " + Math.round(f * 100) + "%"); }, () => stop);
      if (errs.length) st("Couldn't read some audio: " + errs.slice(0, 2).join("; "));
      if ($("afx-qc-edges").checked && !stop) { const vt = voiceTrack(S); if (vt >= 0) { st("Finding the words at the cuts…"); try { await speechEdges(S.a[vt].clips.filter(c => !c.dis && c.path && !c.off), f => { bar(f); st("Finding the words at the cuts… " + Math.round(f * 100) + "%"); }, () => stop); } catch (e) { st("⚠ " + e.message); } } } }
    last = S; sig = await call("afx_sig"); DBG = []; render(stop ? "Stopped — audio partly listened to" : ""); bar(1); }
  catch (e) { st("⚠ " + e.message); }
  busy = false; $("afx-qc-go").disabled = false; $("afx-qc-stop").disabled = true; };

/* keep the list in sync with the timeline: when you delete/trim something, the problems update by themselves */
setInterval(async () => { if (busy || !last || !P.classList.contains("open") || document.hidden || !$("afx-qc-auto").checked) return;
  try { const s = await call("afx_sig"); if (!s || s === sig) return; busy = true; sig = s; const S = await lightSeq(last); if (S) { last = S; cur = -1; render("Updated after your edit"); } } catch (e) {}
  busy = false; }, 1500);

/* ---------- sidebar entry; the panel takes the whole content area ---------- */
let hidGrid = false;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); P.classList.add("open"); }
  else if (P.classList.contains("open")) { P.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"); if (!side || !gw) return false; if (document.getElementById("afx-nav-qc")) return true;
  const mk = document.getElementById("markers-nav-item"), lab = el("div", "cat-section-label", "Finish");
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Quality check">✅</span> <span class="cat-label">Quality check</span>'); nav.id = "afx-nav-qc"; nav.dataset.cat = "__afx_qc__"; nav.dataset.tooltip = "Quality check";
  const after = mk || side.lastChild; after.parentNode.insertBefore(nav, after.nextSibling); after.parentNode.insertBefore(lab, nav);
  gw.parentNode.insertBefore(P, gw.nextSibling);   // same place as the library grid, so it gets the full width
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); if (!last) st("Click Check sequence."); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 100) clearInterval(iv); }, 300); }
window._afxQC = { check, rows, metrics, listen, seqInfo, call, readSeq, parseXml, roomPlan, roomXml, atCuts, edgeDecision, voiceTrack, SPC, spKey };
})();
