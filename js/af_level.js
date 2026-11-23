/* AssetFlow — Audio levels: measures every audio clip on the open sequence and sets its Volume so voice, music and
   sound effects each sit at the right level (voice at YouTube loudness, music under the voice, effects at a set peak).
   Loudness is measured the way YouTube and broadcast do it (EBU R128 / LUFS, silence ignored), one ffmpeg pass per source
   file. Peaks are kept under -1 dB so nothing clips. "Undo" puts every clip back exactly as it was. */
(function(){
"use strict";
let fs, path, cp; try { fs = require("fs"); path = require("path"); cp = require("child_process"); } catch (e) { return; }
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });
function extDir(){
  try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || "";
    if (raw) { const t = decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, "")); return process.platform === "win32" ? path.normalize(t) : "/" + t.replace(/^\/+/, ""); } } catch (e) {}
  try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
function ffmpegPath(){ for (const p of [path.join(extDir(), "ffmpeg.exe"), path.join(extDir(), "ffmpeg")]) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return "ffmpeg"; }
let jsxReady = null;
function host(){ if (!jsxReady) jsxReady = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_level.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/afl ok/.test(r || "")) jsxReady = null; return r; }); return jsxReady; }
async function call(fn, arg){ const h = await host(); if (!/afl ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 100) + ")");
  return jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(typeof arg === "string" ? arg : JSON.stringify(arg))) + ")"); }

/* ---------- measuring: EBU R128 momentary loudness + peak every 0.1 s, one ffmpeg run per stretch of a source file ---------- */
const STEP = 0.1, running = new Set(), cache = new Map();   // cache: file -> [{a, b, M: Float32Array, P: Float32Array}]
function stopAll(){ running.forEach(p => { try { cp.exec("taskkill /pid " + p.pid + " /T /F"); } catch (e) { try { p.kill(); } catch (_) {} } }); running.clear(); }
function parseLine(l){   // "[Parsed_ebur128_0 @ ..] t: 1.2  TARGET:-23 LUFS  M: -20.1 S: ... FTPK: -9.8 -10.1 dBFS ..."
  const t = /\bt:\s*([\d.]+)/.exec(l); if (!t) return null;
  const m = /\bM:\s*(-?[\d.]+|-?inf|nan)/i.exec(l), f = /FTPK:\s*([-\d.\sinf]+?)\s*dBFS/i.exec(l);
  let pk = -200; if (f) f[1].trim().split(/\s+/).forEach(x => { const v = parseFloat(x); if (isFinite(v) && v > pk) pk = v; });
  const mv = m ? parseFloat(m[1]) : NaN; return { t: parseFloat(t[1]), M: isFinite(mv) ? mv : -200, pk };
}
function scanSpan(file, a, b, onProg, stream){ return new Promise(res => {
  const n = Math.max(1, Math.ceil((b - a) / STEP) + 1), M = new Float32Array(n).fill(-200), P = new Float32Array(n).fill(-200);
  let p; try { p = cp.spawn(ffmpegPath(), ["-hide_banner", "-nostats", "-ss", String(Math.max(0, a)), "-t", String(b - a), "-i", file, "-map", "0:a:" + (stream || 0), "-vn",
    "-af", "aresample=48000,ebur128=peak=true:framelog=info", "-f", "null", "-"], { windowsHide: true }); }
  catch (e) { return res({ ok: false, err: e.message }); }
  running.add(p); let buf = "", tail = "", got = 0;
  const line = l => { const r = /Parsed_ebur128/.test(l) && parseLine(l);
    if (r) { const i = Math.round(r.t / STEP) - 1; if (i >= 0 && i < n) { M[i] = r.M; P[i] = r.pk; got++; if (got % 300 === 0 && onProg) onProg(Math.min(1, i / n)); } }
    else tail = (tail + l + "\n").slice(-2000); };
  p.stderr.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  p.on("error", e => { running.delete(p); res({ ok: false, err: e.message }); });
  p.on("close", c => { running.delete(p); if (buf) line(buf); res(got ? { ok: true, a, b, M, P } : { ok: false, err: (tail.trim().split("\n").pop() || "exit " + c) }); }); }); }
/* block i of a scan ends at a + (i+1)*STEP and (momentary loudness) covers the 0.4 s before that */
function blocks(file, x, y){
  const L = cache.get(file); if (!L) return null; const S = L.find(s => s.a <= x + 0.05 && s.b >= y - 0.05); if (!S) return null;
  const M = [], P = []; for (let i = 0; i < S.M.length; i++) { const end = S.a + (i + 1) * STEP;
    if (end > x + 0.05 && end <= y + 0.05) { P.push(S.P[i]); if (end - 0.4 >= x - 0.05) M.push(S.M[i]); } }
  return { M, P }; }
/* integrated loudness from momentary blocks, with the two BS.1770 gates (-70 LUFS, then 10 LU under the average) */
function integrated(Ms){
  const en = m => Math.pow(10, (m + 0.691) / 10), lu = e => -0.691 + 10 * Math.log10(e);
  const A = Ms.filter(m => m > -70); if (!A.length) return { I: null, n: 0 };
  const rel = lu(A.reduce((s, m) => s + en(m), 0) / A.length) - 10, B = A.filter(m => m > rel);
  return { I: B.length ? lu(B.reduce((s, m) => s + en(m), 0) / B.length) : null, n: B.length }; }
async function measureAll(clips, onProg, stopped){
  const by = new Map(); clips.forEach(c => { const key = ck(c); if (!by.has(key)) by.set(key, []); by.get(key).push([c.in, c.out]); });
  const jobs = []; by.forEach((R, file) => { R.sort((x, y) => x[0] - y[0]); const G = []; R.forEach(r => { const l = G[G.length - 1]; if (l && r[0] - l[1] < 30) l[1] = Math.max(l[1], r[1]); else G.push(r.slice()); });
    G.forEach(([a, b]) => { const have = (cache.get(file) || []).some(s => s.a <= a + 0.05 && s.b >= b - 0.05); if (!have) jobs.push({ file, a: Math.max(0, a - 0.5), b: b + 0.2 }); }); });
  const total = jobs.reduce((t, j) => t + (j.b - j.a), 0) || 1; let done = 0, i = 0; const errs = [];
  const w = async () => { while (i < jobs.length && !stopped()) { const j = jobs[i++], [fp, sn] = j.file.split("\u0001"), prog = f => onProg((done + f * (j.b - j.a)) / total);
      /* the clip's own audio track inside the file (OBS recordings keep mic and game on separate tracks); a file with one track: track 0 */
      let r = await scanSpan(fp, j.a, j.b, prog, +sn); if (!r.ok && +sn > 0) r = await scanSpan(fp, j.a, j.b, prog, 0);
      done += j.b - j.a; onProg(done / total); if (r.ok) { if (!cache.has(j.file)) cache.set(j.file, []); cache.get(j.file).push(r); } else errs.push(path.basename(fp) + ": " + r.err); } };
  await Promise.all([w(), w(), w()]); return errs; }

/* ---------- the plan: how loud each clip is now and what its Volume should be ---------- */
const ck = c => c.path + "\u0001" + Math.max(0, (c.st || 1) - 1);   // cache key: file + which of its audio tracks
const CEIL = -1;   // never let a clip peak above -1 dB (YouTube's re-encode can push higher peaks into clipping)
function plan(S, roles, T, onlySel){
  const out = [], note = { quiet: 0, silent: 0, unread: 0, short: 0, under: 0 }, fileI = new Map(), ceil = T.ceil;   // no clip is ever pushed past the loudest peak you allow
  const want = S.a.filter(t => roles[t.i] && roles[t.i] !== "skip").flatMap(t => t.clips.filter(c => !c.dis && c.path && (!onlySel || c.sel)).map(c => ({ t, c, role: roles[t.i] })));
  /* whole-file loudness per track, used for short clips (a 1 s voice clip is too short to measure on its own) */
  want.forEach(({ t, c }) => { const k = t.i + "|" + ck(c), b = blocks(ck(c), c.in, c.out); if (!b) return; if (!fileI.has(k)) fileI.set(k, []); fileI.get(k).push(...b.M); });
  fileI.forEach((Ms, k) => fileI.set(k, integrated(Ms).I));
  want.forEach(({ t, c, role }) => {
    const b = blocks(ck(c), c.in, c.out); if (!b) { note.unread++; return; }
    const pk = b.P.reduce((m, v) => Math.max(m, v), -200); if (pk < -60) { note.silent++; return; }
    let g, how;
    if (role === "sfx") { g = T.sfx - pk; how = "peak " + pk.toFixed(1) + " dB"; }
    else { const r = integrated(b.M); let I = r.I;
      if (I == null || r.n < 25) { I = fileI.get(t.i + "|" + ck(c)); note.short++; }
      if (I == null) { g = (role === "voice" ? -10 : -20) - pk; how = "peak " + pk.toFixed(1) + " dB"; }   // nothing long enough anywhere: fall back to peaks
      else { g = (role === "voice" ? T.voice : T.music) - I; how = I.toFixed(1) + " LUFS"; } }
    if (T.render) {   // the limiter catches the peaks, so every clip gets exactly the gain it needs
      g = Math.max(-40, Math.min(40, g)); out.push({ t: t.i, tn: t.name, k: c.k, s: c.s, name: c.name, role, db: Math.round(g * 10) / 10, how, lim: false, c }); return; }
    let lim = false; if (pk + g > ceil) { const g0 = g; g = ceil - pk; lim = true; if (role !== "sfx") { note.quiet++; note.under += g0 - g; } }
    g = Math.max(-60, Math.min(15, g));   // Premiere's Volume can go from silent to +15 dB
    out.push({ t: t.i, tn: t.name, k: c.k, s: c.s, name: c.name, role, db: Math.round(g * 10) / 10, how, lim }); });
  return { out, note }; }

/* ---------- render: each clip's gain + a real limiter (your settings), written to new audio files with ffmpeg ---------- */
const crypto_ = (() => { try { return require("crypto"); } catch (e) { return null; } })();
const hkey = (...a) => crypto_ ? crypto_.createHash("md5").update(a.join("|")).digest("hex").slice(0, 10) : String(Date.now());
function levelsDir(src){ const d = path.join(path.dirname(src), "AssetFlow Levels"); try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; }
  catch (e) { const w = path.join(require("os").tmpdir(), "AssetFlow Levels"); fs.mkdirSync(w, { recursive: true }); return w; } }
/* stretches of each source file used by the clips (close ones merged); every clip keeps its own gain inside the stretch */
function renderPlan(out, L){
  const by = new Map(); out.forEach(x => { const k = x.t + "\u0002" + ck(x.c); if (!by.has(k)) by.set(k, []); by.get(k).push(x); });
  const jobs = [];
  by.forEach((X, k) => { X.sort((p, q) => p.c.in - q.c.in); const G = [];
    X.forEach(x => { const g = G[G.length - 1]; if (g && x.c.in - g.b < 20) { g.b = Math.max(g.b, x.c.out); g.X.push(x); } else G.push({ a: x.c.in, b: x.c.out, X: [x] }); });
    G.forEach(g => { const a = Math.max(0, g.a - 3), b = g.b + 3, /* 3 s of handle each side, so clips can still be trimmed */ c0 = g.X[0].c, st = Math.max(0, (c0.st || 1) - 1);
      const cmds = g.X.map(x => (Math.max(0, x.c.in - a)).toFixed(3) + " volume@g volume " + x.db.toFixed(2) + "dB;").join("\n");
      const key = hkey(c0.path, st, a.toFixed(3), b.toFixed(3), cmds, L.off ? "off" : L.ceil + "|" + L.rel, "v2"), base = path.basename(c0.path).replace(/\.[^.]+$/, "").slice(0, 60);
      jobs.push({ t: g.X[0].t, file: c0.path, st, a, b, X: g.X, cmds, out: path.join(levelsDir(c0.path), base + " - leveled [" + key + "].wav") }); }); });
  return jobs; }
function renderOne(j, L, onP){ return new Promise(res => {
  if (fs.existsSync(j.out)) return res({ ok: true, cached: true });
  const dir = path.dirname(j.out), cf = "afl_cmd_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".txt", tmp = j.out.replace(/\.wav$/, ".part.wav");
  try { fs.writeFileSync(path.join(dir, cf), j.cmds + "\n"); } catch (e) { return res({ ok: false, err: e.message }); }
  const lim = Math.pow(10, (L.ceil - 0.5) / 20);   // 0.5 dB under the ceiling: covers the peaks between samples
  const af = "asendcmd=f=" + cf + ",volume@g=volume=0dB:eval=frame" + (L.off ? "" : ",alimiter=limit=" + lim.toFixed(4) + ":attack=5:release=" + L.rel + ":level=false:latency=true");
  const go = st => { const args = ["-hide_banner", "-nostdin", "-y", "-ss", j.a.toFixed(3), "-t", (j.b - j.a).toFixed(3), "-i", j.file, "-map", "0:a:" + st, "-vn", "-af", af, "-c:a", "pcm_s24le", "-progress", "pipe:1", "-nostats", "-loglevel", "error", tmp];
    let p; try { p = cp.spawn(ffmpegPath(), args, { cwd: dir, windowsHide: true }); } catch (e) { return done({ ok: false, err: e.message }); }
    running.add(p); let err = "", buf = "";
    p.stdout.on("data", d => { buf += d; const m = buf.match(/out_time_us=(\d+)/g); if (m) { onP(Math.min(1, +m[m.length - 1].slice(12) / 1e6 / (j.b - j.a))); buf = buf.slice(-200); } });
    p.stderr.on("data", d => { err = (err + d).slice(-1500); });
    p.on("error", e => { running.delete(p); done({ ok: false, err: e.message }); });
    p.on("close", c => { running.delete(p);
      if (c !== 0 && st > 0) return go(0);   // the file has only one audio track
      if (c === 0) { try { fs.renameSync(tmp, j.out); fs.writeFileSync(j.out + ".json", JSON.stringify({ file: j.file, st: j.st, a: j.a })); } catch (e) { return done({ ok: false, err: e.message }); } return done({ ok: true }); }
      try { fs.unlinkSync(tmp); } catch (e) {} done({ ok: false, err: err.trim().split(/\r?\n/).pop() || "ffmpeg exit " + c }); }); };
  const done = r => { try { fs.unlinkSync(path.join(dir, cf)); } catch (e) {} res(r); };
  go(j.st); }); }

/* ---------- UI ---------- */
const DEF = { voice: -14, music: -26, sfx: -10, ceil: -1 };
const PRESETS = [[-18, "Quiet", "−18 LUFS. Calm, like a podcast."], [-14, "YouTube", "−14 LUFS. YouTube's own loudness: what most channels use."], [-11, "Loud", "−11 LUFS. Punchy, for intense gaming videos."]];
const RELEASE = [[50, "Fast"], [150, "Normal"], [400, "Smooth"]];
document.head.appendChild(el("style", null,
  "#afl-panel{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09);position:relative;z-index:2}" +
  "#afl-panel.open{display:flex}.afl-wrap{padding:16px 14px;display:flex;flex-direction:column;gap:14px}" +
  ".afl-h{font-size:14px;font-weight:600;color:var(--text,#eee)}.afl-p{font-size:11px;color:var(--text3,#999);line-height:1.5;margin-top:3px}" +
  ".afl-card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px}" +
  ".afl-step{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;color:var(--text,#ddd);margin-bottom:10px}.afl-step b{width:18px;height:18px;border-radius:50%;background:rgba(10,132,255,.18);color:var(--accent,#0a84ff);font-size:10px;display:flex;align-items:center;justify-content:center}.afl-step .sp{flex:1}" +
  ".afl-tr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.05)}.afl-tr:first-child{border-top:0;padding-top:0}" +
  ".afl-tr .l{display:flex;align-items:center;gap:9px;min-width:0;cursor:pointer}.afl-tr.off .n,.afl-tr.off .afl-seg{opacity:.4}.afl-tr.off .afl-seg{pointer-events:none}" +
  ".afl-sw{position:relative;width:28px;height:16px;flex:0 0 auto;border-radius:8px;background:rgba(255,255,255,.18);border:0;padding:0;cursor:pointer;transition:background .15s}.afl-sw::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:left .15s}" +
  ".afl-sw.on{background:var(--accent,#0a84ff)}.afl-sw.on::after{left:14px}" +
  ".afl-tr .n{font-size:11.5px;color:var(--text,#ddd);min-width:0}.afl-tr .n i{display:block;font-style:normal;font-size:10px;color:var(--text3,#777);margin-top:1px}" +
  ".afl-seg{display:flex;background:rgba(0,0,0,.25);border-radius:7px;padding:2px;gap:2px;flex:0 0 auto}.afl-seg button{background:transparent;border:0;border-radius:5px;color:var(--text2,#aaa);font-size:10.5px;padding:5px 9px;cursor:pointer}" +
  ".afl-seg button:hover{color:var(--text,#eee)}.afl-seg button.on{background:var(--accent,#0a84ff);color:#fff}" +
  ".afl-chips{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.afl-chip{background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 6px;cursor:pointer;color:var(--text2,#aaa);text-align:center}" +
  ".afl-chip b{display:block;font-size:11.5px;color:var(--text,#ddd);font-weight:600}.afl-chip span{font-size:10px}.afl-chip.on{border-color:var(--accent,#0a84ff);background:rgba(10,132,255,.12)}" +
  ".afl-cap{font-size:10.5px;color:var(--text3,#888);margin-top:8px;line-height:1.45}.afl-off{opacity:.4;pointer-events:none}" +
  ".afl-go{--p:0%;width:100%;padding:11px 12px;font-size:13px;font-weight:600;border-radius:9px;border:0;color:#fff;cursor:pointer;background:linear-gradient(90deg,rgba(255,255,255,.18) var(--p),transparent var(--p)),var(--accent,#0a84ff)}.afl-go:disabled{cursor:default}" +
  ".afl-under{display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:11px;color:var(--text3,#888)}" +
  ".afl-link{background:none;border:0;color:var(--accent,#0a84ff);font-size:11px;cursor:pointer;padding:0}" +
  ".afl-res{display:none;border-radius:10px;padding:12px;font-size:11.5px;line-height:1.55;color:var(--text,#ddd)}.afl-res.show{display:block}.afl-res.ok{background:rgba(52,199,89,.08);border:1px solid rgba(52,199,89,.25)}.afl-res.err{background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.25)}" +
  ".afl-res .t{font-weight:600;font-size:12px;margin-bottom:2px}.afl-res .w{color:#fc6;font-size:10.5px;margin-top:6px}.afl-res .a{display:flex;gap:8px;margin-top:10px}" +
  ".afl-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:var(--text,#ddd);font-size:11px;padding:6px 12px;cursor:pointer}" +
  "details.afl-more{font-size:11px;color:var(--text2,#aaa);border-top:1px solid rgba(255,255,255,.06);padding-top:10px}details.afl-more summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between}details.afl-more summary::after{content:'›'}details.afl-more[open] summary::after{transform:rotate(90deg)}" +
  ".afl-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0;font-size:11px;color:var(--text2,#bbb)}.afl-row input[type=range]{min-width:70px}.afl-row span:first-child{min-width:100px}.afl-row input{flex:1}.afl-row b{min-width:62px;text-align:right;color:var(--text,#eee);font-weight:500}" +
  ".afl-item{display:flex;gap:10px;padding:4px 0;border-top:1px solid rgba(255,255,255,.05);font-size:10.5px;color:var(--text2,#bbb)}.afl-item .d{min-width:56px;text-align:right;font-family:var(--mono,monospace);color:var(--text,#eee)}"));
const tgt = (id, label, min, max, unit, step) => '<div class="afl-row"><span>' + label + '</span><input type="range" id="afl-' + id + '" min="' + min + '" max="' + max + '" step="' + (step || 0.5) + '" value="' + LS.get("afl3_" + id, DEF[id]) + '"><b><span id="afl-' + id + '-v"></span> ' + unit + "</b></div>";
const P = el("div", null,
  '<div class="afl-wrap">' +
  '<div><div class="afl-h">Audio levels</div><div class="afl-p">Makes every clip equally loud, then a limiter catches the spikes (game sounds, shouts) so nothing ever goes over the ceiling you set. You can undo it.</div></div>' +
  '<div class="afl-card"><div class="afl-step"><b>1</b>What\'s on each track</div><div id="afl-tracks"><div class="afl-cap">Reading your sequence…</div></div></div>' +
  '<div class="afl-card"><div class="afl-step"><b>2</b>How loud</div><div class="afl-chips" id="afl-chips"></div><div class="afl-cap" id="afl-chipcap"></div></div>' +
  '<div class="afl-card"><div class="afl-step"><b>3</b>Limiter (catches the spikes)</div><div class="afl-seg" id="afl-mode" style="display:inline-flex"><button data-v="mix">On the Mix track</button><button data-v="files">In new audio files</button><button data-v="off">Off</button></div>' +
  '<div id="afl-mixbody" style="margin-top:10px"><button class="afl-btn" id="afl-addmix">Add a limiter to the Mix track</button><div class="afl-cap" id="afl-mixcap"></div></div>' +
  '<div id="afl-limbody" style="margin-top:6px">' + tgt("ceil", "Ceiling", -12, -0.5, "dB") +
  '<div class="afl-row"><span>Release</span><div class="afl-seg" id="afl-rel"></div></div></div>' +
  '<div class="afl-cap" id="afl-limcap"></div></div>' +
  '<div><button class="afl-go" id="afl-go">Fix audio levels</button>' +
  '<div class="afl-cap" id="afl-go-why" style="display:none;text-align:center">Turn on at least one track above.</div><div class="afl-under"><div class="afl-seg" id="afl-scope"><button data-v="all">Whole sequence</button><button data-v="sel">Selected clips</button></div><button class="afl-link" id="afl-stop" style="display:none">Stop</button></div>' +
  '<div class="afl-cap" style="text-align:center">Tip: try your settings on a few selected clips first, listen, then do the whole sequence.</div></div>' +
  '<div class="afl-res" id="afl-res"></div><div id="afl-list"></div>' +
  '<details class="afl-more"><summary>Music and sound effects levels</summary>' + tgt("music", "Music under voice", -36, -14, "LUFS") + tgt("sfx", "Sound effects peak", -24, -3, "dB") +
  '<div style="margin-top:8px"><button class="afl-link" id="afl-reset">Back to recommended</button></div></details>' +
  '</div>');
P.id = "afl-panel"; ["keydown", "keyup", "contextmenu"].forEach(t => P.addEventListener(t, e => e.stopPropagation()));
const $ = id => P.querySelector("#" + id);
const prog = f => { $("afl-go").style.setProperty("--p", f == null ? "0%" : Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"); };
const res = (kind, html) => { const r = $("afl-res"); r.className = "afl-res" + (html ? " show " + kind : ""); r.innerHTML = html || ""; };
let voiceT = +LS.get("afl3_voice", DEF.voice), relMs = +LS.get("afl3_rel", 150), mode = LS.get("afl3_mode", "mix"), limOn = mode === "files";
const showT = () => ["music", "sfx", "ceil"].forEach(k => { $("afl-" + k + "-v").textContent = (+$("afl-" + k).value).toFixed(1).replace(/\.0$/, ""); });
function limCap(){ $("afl-limcap").textContent = mode === "files" ? "Writes leveled + limited audio and swaps it in on the same track, linked to the video. Nothing goes above " + (+$("afl-ceil").value) + " dB. " + ({ 50: "Fast release grabs every spike, can sound a bit tight.", 150: "Normal release: clean on voice.", 400: "Smooth release: most natural." })[relMs]
  : mode === "mix" ? "Fastest: Fix only sets each clip's volume (your clips stay as they are), and one limiter on the Mix track catches every spike. Change its settings any time in the Audio Track Mixer while you listen."
  : "No limiter: every clip is turned up only as far as its loudest spike allows, so spiky clips stay quieter."; }
function drawChips(){ const box = $("afl-chips"); box.innerHTML = ""; let hit = null;
  PRESETS.forEach(([v, n, cap]) => { const b = el("button", "afl-chip" + (v === voiceT ? " on" : ""), "<b>" + n + "</b><span>" + v + " LUFS</span>"); if (v === voiceT) hit = cap;
    b.onclick = () => { voiceT = v; LS.set("afl3_voice", v); drawChips(); }; box.appendChild(b); });
  $("afl-chipcap").textContent = hit || ("Voice at " + voiceT + " LUFS."); }
function drawRel(){ const box = $("afl-rel"); box.innerHTML = ""; RELEASE.forEach(([v, n]) => { const b = el("button", v === relMs ? "on" : "", n); b.onclick = () => { relMs = v; LS.set("afl3_rel", v); drawRel(); limCap(); }; box.appendChild(b); }); }
function drawLim(){ limOn = mode === "files"; $("afl-mode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === mode));
  $("afl-limbody").style.display = mode === "files" ? "" : "none"; $("afl-mixbody").style.display = mode === "mix" ? "" : "none"; limCap(); }
$("afl-mode").querySelectorAll("button").forEach(b => b.onclick = () => { mode = b.dataset.v; LS.set("afl3_mode", mode); drawLim(); });
const MIXGUIDE = "Do it once: Window → Audio Track Mixer → click ▸ at the top-left → in the <b>Mix</b> column click a slot ▾ → Amplitude and Compression → <b>Hard Limiter</b>. Double-click it and set Maximum Amplitude to <b>−1 dB</b> (or what you like).";
$("afl-addmix").onclick = async () => { const cap = $("afl-mixcap"); cap.textContent = "Adding…";
  try { const r = JSON.parse(await call("afl_mixLimiter")); try { window._afBootLog && _afBootLog("Audio levels mix limiter: " + JSON.stringify(r).slice(0, 1500)); } catch (e) {}
    if (r.ok) { LS.set("afl3_mixdone", "1"); cap.innerHTML = "✓ Added a Hard Limiter to the Mix track. Set its ceiling in the Audio Track Mixer (double-click it): Maximum Amplitude <b>−1 dB</b> is a good start."; }
    else cap.innerHTML = "Premiere won't let a panel add it here, so it's a 20-second job: " + MIXGUIDE; }
  catch (e) { cap.innerHTML = "Premiere won't let a panel add it here, so it's a 20-second job: " + MIXGUIDE; } };
["music", "sfx", "ceil"].forEach(k => { const r = $("afl-" + k); r.addEventListener("input", () => { showT(); limCap(); }); r.addEventListener("change", () => LS.set("afl3_" + k, r.value)); });
showT(); drawChips(); drawRel(); drawLim();
$("afl-reset").onclick = () => { ["music", "sfx"].forEach(k => { $("afl-" + k).value = DEF[k]; LS.set("afl3_" + k, DEF[k]); }); showT(); };
let scope = LS.get("afl2_scope", "all");
const drawScope = () => $("afl-scope").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === scope));
$("afl-scope").querySelectorAll("button").forEach(b => b.onclick = () => { scope = b.dataset.v; LS.set("afl2_scope", scope); drawScope(); }); drawScope();

const ROLES = [["voice", "Voice"], ["music", "Music"], ["sfx", "SFX"]], RN = { voice: "voice", music: "music", sfx: "sound effect" };
const guess = t => { const n = (t.name || "").toLowerCase();
  if (/voice|vo\b|dial|mic|talk|narr|speech|host|cam/.test(n)) return "voice"; if (/music|song|bgm|score|beat/.test(n)) return "music"; if (/sfx|fx|effect|whoosh|sound/.test(n)) return "sfx";
  return t.i === 0 ? "voice" : t.i === 1 ? "music" : "sfx"; };
let roles = {};
function canGo(){ const ok = Object.values(roles).some(v => v !== "skip"); const c = $("afl-go-why"); if (c) c.style.display = ok ? "none" : ""; if (!busy) $("afl-go").disabled = !ok; return ok; }
function drawTracks(S){ const box = $("afl-tracks"); box.innerHTML = ""; roles = {};
  if (!S || S.error) { box.innerHTML = '<div class="afl-cap">' + esc((S && S.error) || "Open a sequence in Premiere.") + "</div>"; canGo(); return; }
  /* tracks this panel made itself (leveled audio) aren't offered again */
  const used = S.a.filter(t => t.clips.length); if (!used.length) { box.innerHTML = '<div class="afl-cap">This sequence has no audio clips yet.</div>'; canGo(); return; }
  used.forEach(t => { const key = "afl2_role_" + S.id + "_" + t.i, okey = "afl2_on_" + S.id + "_" + t.i;
    let role = LS.get(key, guess(t)); if (role === "skip") role = guess(t);
    let on = LS.get(okey, t.mute ? "0" : "1") === "1"; const sync = () => { roles[t.i] = on ? role : "skip"; };
    const r = el("div", "afl-tr" + (on ? "" : " off")), lab = el("div", "l"), sw = el("button", "afl-sw" + (on ? " on" : ""));
    lab.appendChild(sw); lab.appendChild(el("span", "n", esc(t.name) + "<i>" + (on ? t.clips.length + " clip" + (t.clips.length > 1 ? "s" : "") : "Left as it is") + (t.mute ? " · muted" : "") + "</i>"));
    lab.onclick = () => { on = !on; LS.set(okey, on ? "1" : "0"); sw.classList.toggle("on", on); r.classList.toggle("off", !on);
      lab.querySelector("i").textContent = (on ? t.clips.length + " clip" + (t.clips.length > 1 ? "s" : "") : "Left as it is") + (t.mute ? " · muted" : ""); sync(); canGo(); };
    const seg = el("div", "afl-seg");
    ROLES.forEach(([v, l]) => { const b = el("button", v === role ? "on" : "", l); b.onclick = () => { role = v; LS.set(key, v); seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); sync(); }; seg.appendChild(b); });
    sync(); r.appendChild(lab); r.appendChild(seg); box.appendChild(r); }); canGo(); }
const side = new Map();
function origin(S){   // clips that are already leveled audio point back at the original recording, so a re-run starts from the original sound
  if (!S || S.error) return S;
  S.a.forEach(t => t.clips.forEach(c => { if (!c.path || !/\.wav$/i.test(c.path)) return; let m = side.get(c.path);
    if (m === undefined) { try { m = JSON.parse(fs.readFileSync(c.path + ".json", "utf8")); } catch (e) { m = null; } side.set(c.path, m); }
    if (m && m.file) { c.lev = c.path; c.path = m.file; c.st = (m.st || 0) + 1; c.in += m.a; c.out += m.a; } })); return S; }
async function readSeq(){ const Q = window._afxQC; if (Q && Q.readSeq) return origin(await Q.readSeq()); return { error: "Couldn't read the sequence (the Quality check part of AssetFlow didn't load)." }; }
/* write leveled audio and swap it in place on the clips' own track, linked to their video */
async function renderSwap(out, L, onP, say){
  const jobs = renderPlan(out, L), tot = jobs.reduce((s, j) => s + (j.b - j.a), 0) || 1; let doneS = 0, k = 0; const bad = [];
  const w = async () => { while (k < jobs.length && !stop) { const j = jobs[k++]; const r = await renderOne(j, L, f => { const g = (doneS + f * (j.b - j.a)) / tot; onP(g * 0.85); say((L.off ? "Restoring… " : "Leveling + limiting… ") + Math.round(g * 100) + "%"); });
      doneS += j.b - j.a; if (!r.ok) bad.push(path.basename(j.file) + ": " + r.err); } };
  await Promise.all([w(), w(), w()]);
  if (stop) return { stopped: true };
  if (bad.length) throw new Error("Couldn't write the audio: " + bad[0]);
  say("Updating your timeline…"); onP(0.86);
  await V().callJ("afv_import", { paths: jobs.map(j => j.out) });
  let done = 0, linked = 0, failed = 0, err = "", canLink = true;
  for (let i = 0; i < jobs.length; i++) { const j = jobs[i], C = j.X.map(x => ({ s: x.c.s, e: x.c.e, in: x.c.in - j.a, out: x.c.out - j.a }));
    const r = await V().callJ("afv_swap", { path: j.out, track: j.t, clips: C }); done += r.done; linked += r.linked; failed += r.failed; err = err || r.err; canLink = canLink && r.canLink !== false; onP(0.86 + 0.14 * (i + 1) / jobs.length); }
  return { jobs, done, linked, failed, err, canLink }; }

let busy = false, stop = false, undo = null, lastSig = "";
async function refresh(){ if (busy) return; try { drawTracks(await readSeq()); } catch (e) { drawTracks({ error: e.message }); } }
setInterval(async () => { if (busy || !P.classList.contains("open") || document.hidden || !window._afxQC) return;
  try { const s = String(await window._afxQC.call("afx_sig")).split("|")[0]; if (s !== lastSig) { const first = !lastSig; lastSig = s; if (!first) refresh(); } } catch (e) {} }, 3000);
const V = () => { const v = window._afVoice; if (!v || !v.callJ) throw new Error("Part of AssetFlow didn't load (reload the panel)."); return v; };
async function doUndo(){ if (!undo || busy) return; busy = true;
  try { if (undo.mode === "inplace") { const r = await renderSwap(undo.out.map(x => Object.assign({}, x, { db: 0 })), { off: true }, f => prog(f), m => { $("afl-go").textContent = m; });
      res("ok", '<div class="t">↩ Undone</div>' + r.done + " clip" + (r.done === 1 ? " has" : "s have") + " the original sound back (still linked to the video)."); }
    else if (undo.mode === "render") { const r = await V().callJ("afv_remove", undo.placed); for (const t of undo.muted) await V().call("afv_mute", { track: t, on: 0 });
      res("ok", '<div class="t">↩ Undone</div>Removed the ' + r.removed + " leveled clip" + (r.removed === 1 ? "" : "s") + " and turned your original track" + (undo.muted.length > 1 ? "s" : "") + " back on."); }
    else { const r = JSON.parse(await call("afl_apply", undo.list)); res("ok", '<div class="t">↩ Undone</div>' + r.done + " clip" + (r.done === 1 ? " is" : "s are") + " back to how they were."); }
    undo = null; $("afl-list").innerHTML = ""; }
  catch (e) { res("err", '<div class="t">Couldn\'t undo</div>' + esc(e.message)); } busy = false; }
$("afl-stop").onclick = () => { stop = true; stopAll(); };

$("afl-go").onclick = async () => { if (busy) return; busy = true; stop = false; const go = $("afl-go"); go.disabled = true; $("afl-stop").style.display = ""; prog(0); res(); $("afl-list").innerHTML = "";
  const say = m => { go.textContent = m; }, t0 = Date.now();
  try { say("Reading the sequence…"); const S = await readSeq(); if (S.error) throw new Error(S.error); drawTracks(S);
    const onlySel = scope === "sel";
    if (onlySel) { const sel = JSON.parse(await call("afl_selected")); if (sel.error) throw new Error(sel.error); const fr = 0.5 / (S.fps || 30);
      S.a.forEach(t => t.clips.forEach(c => { c.sel = sel.some(x => x.t === t.i && Math.abs(x.s - c.s) < fr); }));
      if (!S.a.some(t => t.clips.some(c => c.sel))) throw new Error("No audio clips are selected. Select some on the timeline, or switch to Whole sequence."); }
    const R = {}; S.a.forEach(t => { R[t.i] = roles[t.i] || "skip"; });
    const AC = S.a.filter(t => R[t.i] !== "skip").flatMap(t => t.clips.filter(c => !c.dis && c.path && (!onlySel || c.sel)));
    if (!AC.length) throw new Error("Nothing to fix: turn on at least one track.");
    const errs = await measureAll(AC, f => { prog(f * (limOn ? 0.35 : 0.9)); say("Listening… " + Math.round(f * 100) + "%"); }, () => stop);
    if (stop) { res("err", '<div class="t">Stopped</div>Nothing was changed.'); return; }
    const L = { ceil: +$("afl-ceil").value, rel: relMs };
    const T = { voice: voiceT, music: +$("afl-music").value, sfx: +$("afl-sfx").value, ceil: mode === "files" ? L.ceil : mode === "mix" ? 100 : -1, render: mode === "files" }, { out, note } = plan(S, R, T, onlySel);
    if (!out.length) throw new Error("Couldn't hear any of the clips" + (errs.length ? " (" + errs[0] + ")" : "") + ".");
    const by = {}; out.forEach(x => { by[x.role] = (by[x.role] || 0) + 1; });
    const parts = ["voice", "music", "sfx"].filter(k => by[k]).map(k => by[k] + " " + RN[k] + " clip" + (by[k] > 1 ? "s" : ""));
    if (limOn) {
      const keep = undo && undo.mode === "inplace" ? undo.out : null;
      const r = await renderSwap(out, L, f => prog(0.35 + f * 0.65), say);
      if (r.stopped) { res("err", '<div class="t">Stopped</div>Nothing on your timeline was changed.'); return; }
      undo = { mode: "inplace", out: keep ? keep.concat(out.filter(x => !keep.some(k => k.t === x.t && Math.abs(k.s - x.s) < 0.02))) : out };   // Undo always goes back to the original sound
      const warn = []; if (r.failed) warn.push(r.failed + " clip" + (r.failed > 1 ? "s" : "") + " couldn't be updated" + (r.err ? " (" + esc(String(r.err).slice(0, 80)) + ")" : "") + ".");
      if (!r.canLink) warn.push("This Premiere version can't link clips from a panel, so the new audio isn't linked to the video. Select each pair and press Ctrl+L, or move them together.");
      else if (r.linked < r.done) warn.push((r.done - r.linked) + " clip" + (r.done - r.linked > 1 ? "s have" : " has") + " no video clip exactly above, so " + (r.done - r.linked > 1 ? "they weren't" : "it wasn't") + " linked.");
      if (errs.length) warn.push("Couldn't listen to " + errs.length + " file" + (errs.length > 1 ? "s" : "") + ".");
      try { window._afBootLog && _afBootLog("Audio levels in place: " + r.jobs.length + " files, done " + r.done + ", linked " + r.linked + ", failed " + r.failed + (r.err ? " " + r.err : "") + ", " + Math.round((Date.now() - t0) / 1000) + "s"); } catch (e) {}
      res("ok", '<div class="t">✓ Done</div>Leveled ' + parts.join(", ") + " to " + voiceT + " LUFS with the limiter at " + L.ceil + " dB, right on the same track" + (r.canLink ? ", linked to the video" : "") + "." + (warn.length ? '<div class="w">' + warn.join("<br>") + "</div>" : "") +
        '<div class="a"><button class="afl-btn" id="afl-undo">↩ Undo</button><button class="afl-btn" id="afl-det">Show each clip</button></div>');
    } else {
      say("Setting " + out.length + " clips…"); prog(0.95);
      const r = JSON.parse(await call("afl_apply", out.map(x => ({ t: x.t, s: x.s, k: x.k, db: x.db })))); if (r.error) throw new Error(r.error);
      if (undo && undo.mode === "vol") { const have = new Set(undo.list.map(u => u.t + "|" + u.s)); r.old.forEach(u => { if (!have.has(u.t + "|" + u.s)) undo.list.push(u); }); } else undo = { mode: "vol", list: r.old };
      const warn = []; if (note.quiet) warn.push(note.quiet + " clip" + (note.quiet > 1 ? "s have" : " has") + " sharp spikes, so " + (note.quiet > 1 ? "they sit" : "it sits") + " about " + (note.under / note.quiet).toFixed(1) + " dB quieter. Turn the limiter on to bring them up evenly.");
      if (r.missing) warn.push(r.missing + " clip" + (r.missing > 1 ? "s" : "") + " couldn't be changed. Click Fix again.");
      const top = out.filter(x => x.db >= 15).length; if (mode === "mix" && top) warn.push(top + " very quiet clip" + (top > 1 ? "s are" : " is") + " at Premiere's maximum (+15 dB) and still a bit under the target.");
      res("ok", '<div class="t">✓ Done</div>Leveled ' + parts.join(", ") + " to " + voiceT + " LUFS by setting each clip's volume" + (mode === "mix" ? ". Your Mix track limiter catches the spikes" + (LS.get("afl3_mixdone", "0") === "1" ? "" : ' <b>(add it with the button in step 3 if you haven\'t)</b>') : " (no limiter, peaks under −1 dB)") + "." + (warn.length ? '<div class="w">' + warn.join("<br>") + "</div>" : "") +
        '<div class="a"><button class="afl-btn" id="afl-undo">↩ Undo</button><button class="afl-btn" id="afl-det">Show each clip</button></div>');
    }
    prog(1); $("afl-undo").onclick = doUndo;
    $("afl-det").onclick = function(){ const Lst = $("afl-list"); if (Lst.childNodes.length) { Lst.innerHTML = ""; this.textContent = "Show each clip"; return; } this.textContent = "Hide clips";
      out.slice().sort((a, b) => a.t - b.t || a.s - b.s).slice(0, 500).forEach(x => Lst.appendChild(el("div", "afl-item", '<span class="d">' + (x.db > 0 ? "+" : "") + x.db.toFixed(1) + " dB</span><span>" + esc(x.tn) + " · " + esc(x.name) + "</span>"))); }; }
  catch (e) { res("err", '<div class="t">Couldn\'t fix the levels</div>' + esc(e.message)); }
  finally { busy = false; go.textContent = "Fix audio levels"; $("afl-stop").style.display = "none"; canGo(); setTimeout(() => { if (!busy) prog(null); }, 1200); } };

/* ---------- sidebar entry (under Finish, next to Quality check) ---------- */
let hidGrid = false;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel", "afx-qc"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); P.classList.add("open"); }
  else if (P.classList.contains("open")) { P.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"); if (!side || !gw) return false; if (document.getElementById("afl-nav")) return true;
  const qc = document.getElementById("afx-nav-qc"); if (!qc) return false;   // wait for Quality check, sit right under it
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Audio levels">🔊</span> <span class="cat-label">Audio levels</span>'); nav.id = "afl-nav"; nav.dataset.cat = "__afl__"; nav.dataset.tooltip = "Audio levels";
  qc.parentNode.insertBefore(nav, qc.nextSibling); gw.parentNode.insertBefore(P, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); refresh(); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 100) clearInterval(iv); }, 300); }
window._afLevel = { parseLine, integrated, blocks, plan, cache, measureAll };
})();
