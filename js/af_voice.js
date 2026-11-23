/* AssetFlow — Isolate voice: splits the audio of clips into VOICE and EVERYTHING ELSE (game, music) with an AI model on the
   graphics card, optionally cleans the voice, and lays both results on new tracks in sync with the original clips.
   One-time setup installs a private Python with the AI (uv + PyTorch + audio-separator) into %LOCALAPPDATA%\AssetFlow\voice. */
(function(){
"use strict";
let fs, path, cp, os; try { fs = require("fs"); path = require("path"); cp = require("child_process"); os = require("os"); } catch (e) { return; }
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const blog = m => { try { window._afBootLog && _afBootLog("Isolate voice: " + m); } catch (e) {} };
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });
function extDir(){
  try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || "";
    if (raw) { const t = decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, "")); return process.platform === "win32" ? path.normalize(t) : "/" + t.replace(/^\/+/, ""); } } catch (e) {}
  try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
let jsxReady = null;
function host(){ if (!jsxReady) jsxReady = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_voice.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/afv ok/.test(r || "")) jsxReady = null; return r; }); return jsxReady; }
async function call(fn, arg){ const h = await host(); if (!/afv ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 100) + ")");
  const r = await jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(typeof arg === "string" ? arg : JSON.stringify(arg))) + ")"); return r; }
const callJ = async (fn, arg) => { const r = await call(fn, arg); let o; try { o = JSON.parse(r); } catch (e) { throw new Error("Premiere answered: " + String(r).slice(0, 120)); } if (o && o.error) throw new Error(o.error); return o; };

/* ---------- where everything lives ---------- */
const HOME = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AssetFlow", "voice");
const P = { uvDir: path.join(HOME, "uv"), uv: path.join(HOME, "uv", "uv.exe"), env: path.join(HOME, "env"), py: path.join(HOME, "env", "Scripts", "python.exe"),
  models: path.join(HOME, "models"), work: path.join(HOME, "work"), ok: path.join(HOME, "ready.json"), cache: path.join(HOME, "cache"),
  msst: path.join(HOME, "msst"), dnrCfg: path.join(HOME, "models", "config_dnr_bandit_bsrnn_multi_mus64.yaml"), dnrW: path.join(HOME, "models", "model_bandit_plus_dnr_sdr_11.47.chpt") };
const MSST_REL = "https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v.1.0.3/";
const ffmpeg = () => { for (const p of [path.join(extDir(), "ffmpeg.exe"), path.join(extDir(), "ffmpeg")]) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return "ffmpeg"; };
const ready = () => { try { const r = JSON.parse(fs.readFileSync(P.ok, "utf8")); return r && r.v >= SETUP_V ? r : null; } catch (e) { return null; } };   // older setups get finished off automatically
const uvEnv = () => Object.assign({}, process.env, { UV_PYTHON_INSTALL_DIR: path.join(HOME, "python"), UV_CACHE_DIR: P.cache, UV_LINK_MODE: "copy", PYTHONUTF8: "1" });

/* run a program, stream its output lines to onLine; resolves with the exit code */
const running = new Set();
function runProc(exe, args, onLine, env){ return new Promise(res => {
  let p; try { p = cp.spawn(exe, args, { windowsHide: true, env: env || process.env }); } catch (e) { onLine && onLine("✗ " + e.message); return res(-1); }
  running.add(p); let buf = "";
  const feed = d => { buf += d; let i; while ((i = buf.search(/\r\n|\n|\r/)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + (buf[i] === "\r" && buf[i + 1] === "\n" ? 2 : 1)); if (l.trim() && onLine) onLine(l); } };
  p.stdout.on("data", feed); p.stderr.on("data", feed);
  p.on("error", e => { running.delete(p); onLine && onLine("✗ " + e.message); res(-1); });
  p.on("close", c => { running.delete(p); if (buf.trim() && onLine) onLine(buf); res(c); }); }); }
function killAll(){ running.forEach(p => { try { cp.exec("taskkill /pid " + p.pid + " /T /F"); } catch (e) { try { p.kill(); } catch (_) {} } }); running.clear(); }
function download(url, dst, onProg){ return new Promise((ok, bad) => { const https = require("https");
  const get = (u, n) => { if (n > 8) return bad(new Error("too many redirects"));
    https.get(u, { headers: { "User-Agent": "AssetFlow" } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return get(new URL(r.headers.location, u).toString(), n + 1); }
      if (r.statusCode !== 200) { r.resume(); return bad(new Error("HTTP " + r.statusCode)); }
      const tot = +r.headers["content-length"] || 0; let got = 0; const f = fs.createWriteStream(dst);
      r.on("data", d => { got += d.length; tot && onProg && onProg(got / tot); }); r.pipe(f); f.on("finish", () => f.close(ok)); f.on("error", bad); }).on("error", bad); };
  get(url, 0); }); }

/* ---------- one-time setup ---------- */
function driverVersion(){   // NVIDIA driver major version (e.g. 572), 0 if there's no NVIDIA card
  const W = process.env.SystemRoot || "C:\\Windows";
  for (const exe of ["nvidia-smi", path.join(W, "System32", "nvidia-smi.exe"), "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"]) {
    try { const o = cp.execFileSync(exe, [], { encoding: "utf8", timeout: 15000, windowsHide: true }); const m = /Driver Version:\s*(\d+)/.exec(o); if (m) return +m[1]; } catch (e) {} }
  try {   // no nvidia-smi on PATH: ask Windows (DriverVersion 32.0.15.7283 means driver 572.83)
    const o = cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1 -ExpandProperty DriverVersion"], { encoding: "utf8", timeout: 20000, windowsHide: true });
    const d = String(o).trim().replace(/\./g, ""); if (d.length >= 5) return +d.slice(-5, -2); } catch (e) {}
  return 0; }
function gpuIndexes(v){   // PyTorch builds this graphics driver can run, newest first
  if (v >= 580) return ["cu130", "cu129", "cu128", "cu126"]; if (v >= 570) return ["cu128", "cu126"]; if (v >= 560) return ["cu126", "cu124"]; if (v >= 525) return ["cu124", "cu121"]; return []; }
const SETUP_V = 4;
function torchCuda(){   // "12.8" when the installed PyTorch is the graphics-card build, "" for the processor-only one, null if missing
  try { const t = fs.readFileSync(path.join(P.env, "Lib", "site-packages", "torch", "version.py"), "utf8"); const m = /cuda\s*(?::[^=]*)?=\s*['"]([\d.]+)['"]/.exec(t); return m ? m[1] : ""; } catch (e) { return null; } }
async function setup(ui){
  fs.mkdirSync(HOME, { recursive: true }); [P.models, P.work, P.cache].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const step = (f, m) => ui(f, m);
  if (!fs.existsSync(P.uv)) {
    step(0.02, "Downloading the installer…"); const zip = path.join(os.tmpdir(), "af_uv_" + Date.now() + ".zip");
    await download("https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip", zip, f => step(0.02 + f * 0.04, "Downloading the installer… " + Math.round(f * 100) + "%"));
    fs.mkdirSync(P.uvDir, { recursive: true });
    const c = await runProc("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Expand-Archive -Force -LiteralPath '" + zip + "' -DestinationPath '" + P.uvDir + "'"]);
    try { fs.unlinkSync(zip); } catch (e) {}
    if (c !== 0 || !fs.existsSync(P.uv)) { const found = findFile(P.uvDir, "uv.exe"); if (found) fs.copyFileSync(found, P.uv); else throw new Error("Couldn't unpack the installer."); } }
  const last = []; const keep = l => { last.push(l); if (last.length > 12) last.shift(); };
  if (!fs.existsSync(P.py)) { step(0.08, "Getting Python…");
    if (await runProc(P.uv, ["venv", "--python", "3.11", P.env], keep, uvEnv()) !== 0) throw new Error("Couldn't set up Python: " + last.slice(-2).join(" ")); }
  const drv = driverVersion(), IDX = gpuIndexes(drv); blog("NVIDIA driver " + (drv || "none") + ", builds to try: " + (IDX.join(",") || "cpu"));
  step(0.12, "Downloading the AI engine" + (IDX.length ? " for your NVIDIA graphics card" : "") + " (about " + (IDX.length ? "2.5" : "0.3") + " GB, one time)…");
  let n = 0; const tick = l => { keep(l); if (/Downloading|Prepared|Installed|Built/i.test(l)) { n++; step(Math.min(0.7, 0.12 + n * 0.02), "Downloading the AI engine… " + l.replace(/\s+/g, " ").slice(0, 60)); } };
  let idx = "";
  if (IDX.length) {
    if (torchCuda()) idx = "have";   // already the graphics-card build
    for (const i of IDX) { if (idx) break;
      const r = await runProc(P.uv, ["pip", "install", "--python", P.py, "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/" + i, "--reinstall-package", "torch", "--reinstall-package", "torchaudio"], tick, uvEnv());
      blog("torch " + i + " -> exit " + r + ", cuda " + torchCuda()); if (r === 0 && torchCuda()) idx = i; }
    if (!idx) throw new Error("Couldn't download the graphics-card AI engine (" + last.slice(-1).join(" ") + "). Check your internet and click Set up again.");
  } else if (torchCuda() === null && await runProc(P.uv, ["pip", "install", "--python", P.py, "torch", "torchaudio"], tick, uvEnv()) !== 0) throw new Error("Couldn't download the AI engine: " + last.slice(-2).join(" "));
  step(0.72, "Installing the voice tools…");
  if (await runProc(P.uv, ["pip", "install", "--python", P.py, IDX.length ? "audio-separator[gpu]>=0.30" : "audio-separator[cpu]>=0.30"], tick, uvEnv()) !== 0) throw new Error("Couldn't install the voice tools: " + last.slice(-2).join(" "));
  step(0.76, "Installing the music-removal tools…");
  if (await runProc(P.uv, ["pip", "install", "--python", P.py, "pytorch-lightning", "ml_collections", "pyyaml", "soundfile", "numpy", "spafe", "librosa", "scipy"], tick, uvEnv()) !== 0) throw new Error("Couldn't install the music-removal tools: " + last.slice(-2).join(" "));
  if (!fs.existsSync(path.join(P.msst, "models", "bandit", "core", "model", "bsrnn", "wrapper.py"))) {
    step(0.8, "Downloading the music-removal code…"); const zip = path.join(os.tmpdir(), "af_msst_" + Date.now() + ".zip"), tmp = P.msst + "_tmp";
    await download("https://codeload.github.com/ZFTurbo/Music-Source-Separation-Training/zip/refs/heads/main", zip);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    const c2 = await runProc("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Expand-Archive -Force -LiteralPath '" + zip + "' -DestinationPath '" + tmp + "'"]);
    try { fs.unlinkSync(zip); } catch (e) {}
    const inner = (() => { try { return fs.readdirSync(tmp).map(n => path.join(tmp, n)).find(p => fs.statSync(p).isDirectory()); } catch (e) { return null; } })();
    if (c2 !== 0 || !inner) throw new Error("Couldn't unpack the music-removal code.");
    try { fs.rmSync(P.msst, { recursive: true, force: true }); } catch (e) {}
    fs.renameSync(inner, P.msst); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  for (const [u, dst, nm] of [[MSST_REL + "config_dnr_bandit_bsrnn_multi_mus64.yaml", P.dnrCfg, "settings"], [MSST_REL + "model_bandit_plus_dnr_sdr_11.47.chpt", P.dnrW, "model"]]) {
    if (fs.existsSync(dst) && fs.statSync(dst).size > 100) continue;
    step(0.84, "Downloading the music-removal " + nm + "…");
    await download(u, dst + ".part", f => step(0.84 + f * 0.05, "Downloading the music-removal " + nm + "… " + Math.round(f * 100) + "%")); fs.renameSync(dst + ".part", dst); }
  step(0.9, "Checking it works…"); let out = "";
  const chk = "import sys, types, os, torch, onnxruntime\nfrom audio_separator.separator import Separator\nr = sys.argv[1]; sys.path.insert(0, r)\nfor n in ['models', 'models.bandit', 'models.bandit.core']:\n    m = types.ModuleType(n); m.__path__ = [os.path.join(r, *n.split('.'))]; sys.modules[n] = m\nfrom models.bandit.core.model import MultiMaskMultiSourceBandSplitRNNSimple\nprint('AFOK', torch.__version__, torch.cuda.is_available())";
  const c = await runProc(P.py, ["-c", chk, P.msst], l => { out += l + "\n"; keep(l); });
  const m = /AFOK (\S+) (True|False)/.exec(out); if (c !== 0 || !m) throw new Error("The AI didn't start: " + last.slice(-2).join(" "));
  if (IDX.length && m[2] !== "True") throw new Error("The AI installed but can't use your graphics card (PyTorch " + m[1] + "). Update your NVIDIA driver, then click Set up again.");
  const info = { v: SETUP_V, torch: m[1], gpu: m[2] === "True", at: Date.now() }; fs.writeFileSync(P.ok, JSON.stringify(info)); step(1, "Ready"); return info; }
function findFile(dir, name){ try { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (n.toLowerCase() === name) return p; if (fs.statSync(p).isDirectory()) { const r = findFile(p, name); if (r) return r; } } } catch (e) {} return null; }

/* ---------- the job ---------- */
const crypto = require("crypto");
const key = (...a) => crypto.createHash("md5").update(a.join("|")).digest("hex").slice(0, 10);
function outDir(src){ const d = path.join(path.dirname(src), "AssetFlow Voice"); try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch (e) { const w = path.join(HOME, "stems"); fs.mkdirSync(w, { recursive: true }); return w; } }
function planJob(S, pick, clean, mode){ mode = mode || "voice";
  /* stretches of each source file that the chosen clips use (close ones merged), so only that audio gets processed */
  const clips = [], skipped = { speed: 0, nofile: 0 };
  S.a.forEach(t => t.clips.forEach(c => { if (!pick(t, c)) return; if (!c.path || c.dis) { skipped.nofile++; return; } if (Math.abs((c.spd || 1) - 1) > 0.002) { skipped.speed++; return; } clips.push(Object.assign({ ti: t.i }, c)); }));
  const by = new Map(); clips.forEach(c => { const k = c.path + "\u0001" + Math.max(0, (c.st || 1) - 1); if (!by.has(k)) by.set(k, []); by.get(k).push(c); });
  const items = [];
  by.forEach((L, k) => { const [file, sn] = k.split("\u0001"); L.sort((x, y) => x.in - y.in); const G = [];
    L.forEach(c => { const g = G[G.length - 1]; if (g && c.in - g.b < 20) { g.b = Math.max(g.b, c.out); g.clips.push(c); } else G.push({ a: c.in, b: c.out, clips: [c] }); });
    G.forEach(g => { const a = Math.max(0, g.a - 0.25), b = g.b + 0.25, kk = key(file, sn, a.toFixed(2), b.toFixed(2), mode === "nomusic" ? "nm1" : clean ? "c2" : "r2"), d = outDir(file), base = path.basename(file).replace(/\.[^.]+$/, "").slice(0, 60);
      items.push({ key: kk, file, stream: +sn, a, b, clips: g.clips,
        out_voice: path.join(d, base + " - voice" + (clean ? " (clean)" : "") + " [" + kk + "].wav"), out_rest: path.join(d, base + (mode === "nomusic" ? " - no music [" : " - no voice [") + kk + "].wav"), raw_voice: path.join(P.work, "raw_" + kk + ".wav") }); }); });
  return { items, clips, skipped }; }
/* ONE file as long as the sequence: every chosen clip at its place, silence between */
function planTimeline(J, mode, clean){
  const C = J.clips.slice().sort((x, y) => x.s - y.s), total = C.reduce((m, c) => Math.max(m, c.s + (c.out - c.in)), 0);
  const sig = C.map(c => [c.path, Math.max(0, (c.st || 1) - 1), c.s.toFixed(3), c.in.toFixed(3), c.out.toFixed(3)].join(",")).join(";");
  const kk = key(sig, mode === "nomusic" ? "nm1" : clean ? "c2" : "r2", "tl"), d = outDir(C[0].path), nm = mode === "nomusic" ? "no music" : "no voice";
  const tl = { key: kk, total, clips: C.map(c => ({ file: c.path, stream: Math.max(0, (c.st || 1) - 1), in: c.in, out: c.out, s: c.s })) };
  const item = { key: kk, file: "", stream: 0, a: 0, b: total, clips: [{ s: 0, in: 0, out: total }],
    out_voice: path.join(d, "Whole sequence - voice" + (clean ? " (clean)" : "") + " [" + kk + "].wav"), out_rest: path.join(d, "Whole sequence - " + nm + " [" + kk + "].wav"), raw_voice: path.join(P.work, "raw_" + kk + ".wav") };
  return { tl, items: [item], total }; }

/* ---------- UI ---------- */
document.head.appendChild(el("style", null,
  "#afv-panel{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09);position:relative;z-index:2}" +
  "#afv-panel.open{display:flex}.afv-wrap{padding:16px 14px;display:flex;flex-direction:column;gap:14px}.afv-h{font-size:14px;font-weight:600;color:var(--text,#eee)}.afv-p{font-size:11px;color:var(--text3,#999);line-height:1.5;margin-top:3px}" +
  ".afv-card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px}.afv-step{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;color:var(--text,#ddd);margin-bottom:10px}" +
  ".afv-step b{width:18px;height:18px;border-radius:50%;background:rgba(10,132,255,.18);color:var(--accent,#0a84ff);font-size:10px;display:flex;align-items:center;justify-content:center}" +
  ".afv-seg{display:inline-flex;background:rgba(0,0,0,.25);border-radius:7px;padding:2px;gap:2px}.afv-seg button{background:transparent;border:0;border-radius:5px;color:var(--text2,#aaa);font-size:10.5px;padding:5px 10px;cursor:pointer}.afv-seg button.on{background:var(--accent,#0a84ff);color:#fff}" +
  ".afv-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;font-size:11px;color:var(--text2,#bbb)}.afv-row select{background:rgba(0,0,0,.3);color:var(--text,#eee);border:1px solid rgba(255,255,255,.12);border-radius:6px;font-size:11px;padding:4px 6px;max-width:60%}" +
  ".afv-sw{position:relative;width:28px;height:16px;flex:0 0 auto;border-radius:8px;background:rgba(255,255,255,.18);border:0;padding:0;cursor:pointer}.afv-sw::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:left .15s}.afv-sw.on{background:var(--accent,#0a84ff)}.afv-sw.on::after{left:14px}" +
  ".afv-tog{display:flex;align-items:flex-start;gap:9px;cursor:pointer;margin-top:2px}.afv-tog span{font-size:11.5px;color:var(--text,#ddd)}.afv-tog i{display:block;font-style:normal;font-size:10px;color:var(--text3,#888);margin-top:2px;line-height:1.4}" +
  ".afv-cap{font-size:10.5px;color:var(--text3,#888);margin-top:8px;line-height:1.45}" +
  ".afv-go{--p:0%;width:100%;padding:11px 12px;font-size:13px;font-weight:600;border-radius:9px;border:0;color:#fff;cursor:pointer;background:linear-gradient(90deg,rgba(255,255,255,.18) var(--p),transparent var(--p)),var(--accent,#0a84ff)}.afv-go:disabled{cursor:default}" +
  ".afv-under{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:10.5px;color:var(--text3,#888);min-height:14px}.afv-link{background:none;border:0;color:var(--accent,#0a84ff);font-size:11px;cursor:pointer;padding:0}" +
  ".afv-res{display:none;border-radius:10px;padding:12px;font-size:11.5px;line-height:1.55;color:var(--text,#ddd)}.afv-res.show{display:block}.afv-res.ok{background:rgba(52,199,89,.08);border:1px solid rgba(52,199,89,.25)}.afv-res.err{background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.25)}" +
  ".afv-res .t{font-weight:600;font-size:12px;margin-bottom:2px}.afv-res .w{color:#fc6;font-size:10.5px;margin-top:6px}.afv-res .a{display:flex;gap:8px;margin-top:10px}.afv-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:var(--text,#ddd);font-size:11px;padding:6px 12px;cursor:pointer}"));
const Pn = el("div", null,
  '<div class="afv-wrap"><div><div class="afv-h">Isolate voice</div><div class="afv-p">Uses AI on your graphics card to take the <b>music out</b> (voice and game sounds stay), or to split the <b>voice</b> from everything else. Results land on new tracks, in sync.</div></div>' +
  '<div class="afv-card" id="afv-setup" style="display:none"><div class="afv-step"><b>✦</b>One-time setup</div><div class="afv-cap" style="margin-top:0">Downloads the AI (about 3.5 GB with the voice and music models). Takes 5–15 minutes once; after that it starts in seconds.</div>' +
  '<button class="afv-go" id="afv-install" style="margin-top:10px">Set up voice isolation</button><div class="afv-under"><span id="afv-isub"></span></div></div>' +
  '<div id="afv-main" style="display:none;flex-direction:column;gap:14px">' +
  '<div class="afv-card"><div class="afv-step"><b>1</b>What to do</div><div class="afv-seg" id="afv-mode"><button data-v="nomusic">Remove music</button><button data-v="voice">Split voice</button></div><div class="afv-cap" id="afv-modecap"></div></div>' +
  '<div class="afv-card"><div class="afv-step"><b>2</b>Which audio</div><div class="afv-seg" id="afv-scope"><button data-v="track">A whole track</button><button data-v="sel">Selected clips</button></div>' +
  '<div class="afv-row" id="afv-trow"><span>Track</span><select id="afv-track"></select></div><div class="afv-cap" id="afv-what"></div></div>' +
  '<div class="afv-card"><div class="afv-step"><b>3</b>How to add it</div><div class="afv-seg" id="afv-out"><button data-v="clips">Linked to clips</button><button data-v="one">One long file</button></div><div class="afv-cap" id="afv-outcap"></div></div>' +
  '<div class="afv-card"><div class="afv-step"><b>4</b>Extras</div><div class="afv-tog" id="afv-cleanT"><button class="afv-sw" id="afv-clean"></button><div><span>Clean up the voice</span><i>Removes background noise, fans and hum from the voice. Adds about a third more time.</i></div></div>' +
  '<div class="afv-tog" id="afv-muteT" style="margin-top:10px"><button class="afv-sw" id="afv-mute"></button><div><span>Mute the original track</span><i>So you hear only the new voice + everything-else tracks.</i></div></div></div>' +
  '<div><button class="afv-go" id="afv-go">Remove music</button><div class="afv-under"><span id="afv-sub"></span><button class="afv-link" id="afv-stop" style="display:none">Stop</button></div></div>' +
  '<div class="afv-res" id="afv-res"></div>' +
  '<div class="afv-card"><div class="afv-step"><b>+</b>Link clips</div><div class="afv-cap">Links every video clip with the audio clips that start at the same spot, one group per clip, so they move together. Clips that don\'t line up are left alone.</div>' +
  '<button class="afv-btn" id="afv-linkall" style="margin-top:8px;width:100%;padding:8px">Link all clips in this sequence</button></div></div></div>');
Pn.id = "afv-panel"; ["keydown", "keyup", "contextmenu"].forEach(t => Pn.addEventListener(t, e => e.stopPropagation()));
const $ = id => Pn.querySelector("#" + id), res = (k, h) => { const r = $("afv-res"); r.className = "afv-res" + (h ? " show " + k : ""); r.innerHTML = h || ""; };
$("afv-linkall").onclick = async () => { const b = $("afv-linkall"); if (b.disabled) return; b.disabled = true; b.textContent = "Linking…";
  try { const r = await callJ("afv_linkAll", {}); blog("link all: " + JSON.stringify(r));
    res("ok", '<div class="t">✓ Linked ' + r.linked + " clip" + (r.linked === 1 ? "" : "s") + "</div>" + (r.already ? r.already + " were already linked. " : "") + (r.alone ? r.alone + " video clip" + (r.alone === 1 ? " has" : "s have") + " no audio starting at the same spot, so " + (r.alone === 1 ? "it was" : "they were") + " left alone." : "")); }
  catch (e) { res("err", '<div class="t">Couldn\'t link</div>' + esc(e.message)); }
  finally { b.disabled = false; b.textContent = "Link all clips in this sequence"; } };
const prog = (b, f) => b.style.setProperty("--p", f == null ? "0%" : Math.round(Math.max(0, Math.min(1, f)) * 100) + "%");
const sw = (id, key, def) => { const b = $(id); let on = LS.get(key, def ? "1" : "0") === "1"; b.classList.toggle("on", on); b.parentNode.onclick = () => { on = !on; LS.set(key, on ? "1" : "0"); b.classList.toggle("on", on); }; return () => on; };
const cleanOn = sw("afv-clean", "afv_clean2", false), muteOn = sw("afv-mute", "afv_mute", true);
let scope = LS.get("afv_scope", "track"), mode = LS.get("afv_mode2", "nomusic"), outM = LS.get("afv_out", "clips"), info = null, busy = false, stop = false, undo = null;
const goLabel = () => mode === "nomusic" ? "Remove music" : "Isolate voice";
function drawOpts(){
  $("afv-mode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === mode));
  $("afv-out").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === outM));
  $("afv-modecap").innerHTML = mode === "nomusic" ? "Keeps his voice and the game sounds exactly as they are and takes out only the music, so you can add new music. Result: one new track." : "Voice on one new track, everything else (game sounds + music) on another, so you can level or enhance the voice on its own.";
  $("afv-outcap").innerHTML = outM === "one" ? "<b>Fastest.</b> One clip that runs the whole sequence, on its own track. Use it when you won't reorder or trim clips any more." : "Each piece sits under its clip and is <b>linked</b> to it, so it moves when you move or reorder clips.";
  $("afv-cleanT").style.display = mode === "voice" ? "" : "none"; if (!busy) $("afv-go").textContent = goLabel(); }
$("afv-mode").querySelectorAll("button").forEach(b => b.onclick = () => { mode = b.dataset.v; LS.set("afv_mode2", mode); drawOpts(); });
$("afv-out").querySelectorAll("button").forEach(b => b.onclick = () => { outM = b.dataset.v; LS.set("afv_out", outM); drawOpts(); }); drawOpts();
function drawScope(){ $("afv-scope").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === scope)); $("afv-trow").style.display = scope === "track" ? "" : "none"; what(); }
$("afv-scope").querySelectorAll("button").forEach(b => b.onclick = () => { scope = b.dataset.v; LS.set("afv_scope", scope); drawScope(); }); drawScope();
function what(){ const w = $("afv-what"); if (!info) { w.textContent = ""; return; }
  if (scope === "sel") w.textContent = info.sel.length ? info.sel.length + " selected audio clip" + (info.sel.length > 1 ? "s" : "") + "." : "Select some audio clips on the timeline first.";
  else { const t = info.tracks.find(x => String(x.i) === $("afv-track").value); w.textContent = t ? t.n + " clip" + (t.n === 1 ? "" : "s") + " on " + t.name + "." : ""; } }
async function refresh(){ if (busy) return;
  const r = ready(); $("afv-setup").style.display = r ? "none" : ""; $("afv-main").style.display = r ? "flex" : "none"; if (!r) return;
  try { info = await callJ("afv_info"); const s = $("afv-track"), keep = LS.get("afv_track_" + info.id, "");
    s.innerHTML = ""; info.tracks.filter(t => t.n > 0).forEach(t => { const o = el("option", null, esc(t.name) + " (" + t.n + " clip" + (t.n === 1 ? "" : "s") + ")"); o.value = t.i; s.appendChild(o); });
    if (keep && [...s.options].some(o => o.value === keep)) s.value = keep; s.onchange = () => { LS.set("afv_track_" + info.id, s.value); what(); };
    if (!s.options.length) $("afv-what").textContent = "This sequence has no audio clips."; drawScope(); }
  catch (e) { $("afv-what").textContent = e.message; } }

$("afv-install").onclick = async () => { if (busy) return; busy = true; const b = $("afv-install"); b.disabled = true; res();
  try { const r = await setup((f, m) => { prog(b, f); b.textContent = m.length > 46 ? "Setting up… " + Math.round(f * 100) + "%" : m; $("afv-isub").textContent = m; });
    $("afv-isub").textContent = r.gpu ? "✓ Ready, using your graphics card." : "✓ Ready (no NVIDIA graphics card found, so it runs on the processor: slower)."; blog("setup ok " + JSON.stringify(r)); busy = false; refresh(); }
  catch (e) { blog("setup failed: " + e.message); $("afv-isub").innerHTML = '<span style="color:#ff7b7b">Setup didn\'t finish: ' + esc(e.message.slice(-160)) + "</span>"; res("err", '<div class="t">Setup didn\'t finish</div>' + esc(e.message) + "<br>Check your internet connection and click Set up again; it continues where it stopped."); }
  finally { busy = false; b.disabled = false; b.textContent = "Set up voice isolation"; prog(b, null); } };
$("afv-stop").onclick = () => { stop = true; killAll(); };

$("afv-go").onclick = async () => { if (busy) return; busy = true; stop = false; const go = $("afv-go"); go.disabled = true; $("afv-stop").style.display = ""; res(); prog(go, 0.01);
  const say = m => { go.textContent = m; }, sub = m => { $("afv-sub").textContent = m || ""; }; const t0 = Date.now();
  try {
    say("Reading the sequence…"); await refresh(); const Q = window._afxQC; if (!Q || !Q.readSeq) throw new Error("Couldn't read the sequence (Quality check didn't load).");
    const S = await Q.readSeq(); if (S.error) throw new Error(S.error);
    let pick, srcTrack = null;
    if (scope === "sel") { const fr = 0.5 / (S.fps || 30), sel = info.sel; if (!sel.length) throw new Error("No audio clips are selected. Select some on the timeline, or choose A whole track.");
      pick = (t, c) => sel.some(x => x.t === t.i && Math.abs(x.s - c.s) < fr); srcTrack = sel[0].t; }
    else { srcTrack = +$("afv-track").value; if (!(srcTrack >= 0)) throw new Error("Choose a track."); pick = t => t.i === srcTrack; }
    const M = mode, one = outM === "one", clean = M === "voice" && cleanOn(), J = planJob(S, pick, clean, M); if (!J.clips.length) throw new Error("Nothing to process" + (J.skipped.speed ? " (clips with changed speed can't be done yet)" : "") + ".");
    const T = one ? planTimeline(J, M, clean) : null; if (T) J.items = T.items;
    const job = { ffmpeg: ffmpeg(), models: P.models, work: P.work, mode: M, clean, overlap: 2, batch: 4, msst: P.msst, dnr_config: P.dnrCfg, dnr_weights: P.dnrW, timeline: T ? T.tl : null,
      items: J.items.map(it => ({ key: it.key, file: it.file, stream: it.stream, a: it.a, b: it.b, out_voice: it.out_voice, out_rest: it.out_rest, raw_voice: it.raw_voice })) };
    const jf = path.join(P.work, "job_" + Date.now() + ".json"); fs.mkdirSync(P.work, { recursive: true }); fs.writeFileSync(jf, JSON.stringify(job));
    const mins = J.items.reduce((s, it) => s + (it.b - it.a), 0) / 60; blog("job " + M + (one ? " one-file" : " linked") + ", " + J.items.length + " stretches, " + mins.toFixed(1) + " min of audio, clean=" + clean);
    say("Starting the AI…"); sub(mins.toFixed(mins < 10 ? 1 : 0) + " min of audio to process");
    let err = "", tail = [], doneN = 0;
    const code = await runProc(P.py, ["-u", path.join(extDir(), "af_voice.py"), jf], l => {
      let m; try { m = JSON.parse(l); } catch (e) { tail.push(l); if (tail.length > 8) tail.shift(); return; }
      if (m.ev === "stage") { say(m.msg.length > 40 ? m.msg.slice(0, 40) + "…" : m.msg); sub(m.msg); }
      else if (m.ev === "prog") { prog(go, m.f); const el_ = (Date.now() - t0) / 1000, eta = m.f > 0.03 ? el_ / m.f - el_ : 0; say((m.what === "render" ? "Gathering the audio… " : M === "nomusic" ? "Removing music… " : "Isolating… ") + Math.round(m.f * 100) + "%"); sub(eta ? "About " + (eta < 90 ? Math.round(eta) + " s" : Math.round(eta / 60) + " min") + " left" : "Working…"); }
      else if (m.ev === "item") doneN++;
      else if (m.ev === "error") { err = m.msg; blog("worker error: " + m.msg + " | " + (m.tb || "").replace(/\s+/g, " ").slice(-400)); } }, Object.assign({}, process.env, { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }));
    try { fs.unlinkSync(jf); } catch (e) {}
    if (stop) throw new Error("Stopped. Nothing was added to your timeline.");
    if (code !== 0 || err) throw new Error(err || ("The AI stopped unexpectedly: " + tail.slice(-2).join(" ")));
    const miss = J.items.filter(it => !fs.existsSync(it.out_rest) || (M === "voice" && !fs.existsSync(it.out_voice))); if (miss.length) throw new Error("Some results are missing (" + miss.length + "). Try again.");

    say("Adding to your timeline…"); prog(go, 1);
    const files = it => M === "nomusic" ? [it.out_rest] : [it.out_voice, it.out_rest], nT = M === "nomusic" ? 1 : 2;
    await callJ("afv_import", { paths: [].concat(...J.items.map(files)) });
    const tr = (await callJ("afv_emptyTracks", nT)).tracks, placed = tr.map(t => ({ track: t, starts: [] })); let bad = 0, perr = "", linked = 0, placedN = 0; const runId = String(Date.now());
    for (const it of J.items) { const C = it.clips.map(c => ({ s: c.s, in: c.in - it.a, out: c.out - it.a, src: c.ti == null ? -1 : c.ti }));
      for (let i = 0; i < C.length; i += 60) { const r = await callJ("afv_placeLinked", { paths: files(it), tracks: tr, link: !one, src: -1, run: runId, clips: C.slice(i, i + 60) });
        bad += r.failed; linked += r.linked || 0; perr = perr || r.err;
        prog(go, 1); placedN += Math.min(60, C.length - i); say("Adding to your timeline… " + placedN + " / " + J.clips.length + " clips"); }
      C.forEach(c => placed.forEach(p => p.starts.push(c.s))); }
    const srcs = [...new Set(J.clips.map(c => c.ti))]; let muted = [];
    if (muteOn()) for (const t of srcs) { if (await call("afv_mute", { track: t, on: 1 }) === "1") muted.push(t); }
    undo = { placed, muted }; blog("placed on A" + (tr[0] + 1) + (tr[1] != null ? "/A" + (tr[1] + 1) : "") + ", failed " + bad + (perr ? " (" + perr + ")" : "") + ", took " + Math.round((Date.now() - t0) / 1000) + "s");
    const w = []; if (J.skipped.speed) w.push(J.skipped.speed + " clip" + (J.skipped.speed > 1 ? "s" : "") + " with changed speed were skipped.");
    if (bad) w.push(bad + " piece" + (bad > 1 ? "s" : "") + " couldn't be placed" + (perr ? " (" + esc(perr.slice(0, 80)) + ")" : "") + ".");
    if (!one && J.clips.length && linked < J.clips.length - bad) w.push((J.clips.length - bad - linked) + " piece" + (J.clips.length - bad - linked > 1 ? "s aren't" : " isn't") + " linked (no video clip starts at the same spot). They're still in sync.");
    if (one) w.push("Clip volume changes on the original track aren't copied into the long file; set the level on the new clip.");
    const name = i => (info.tracks[i] && info.tracks[i].name) || "A" + (i + 1);
    res("ok", (M === "nomusic" ? '<div class="t">✓ Music removed</div>Voice + game sounds (no music) are on <b>A' + (tr[0] + 1) + "</b>" + (one ? ", as one long clip." : ", linked to your clips.") :
      '<div class="t">✓ Voice isolated</div>Voice' + (clean ? " (cleaned)" : "") + " is on <b>A" + (tr[0] + 1) + "</b>, everything else on <b>A" + (tr[1] + 1) + "</b>.") + (muted.length ? " " + muted.map(i => name(i)).join(", ") + " is muted." : "") +
      " Took " + Math.max(1, Math.round((Date.now() - t0) / 60000)) + " min." + (w.length ? '<div class="w">' + w.join("<br>") + "</div>" : "") +
      '<div class="a"><button class="afv-btn" id="afv-undo">↩ Undo</button><button class="afv-btn" id="afv-open">Show files</button></div>');
    $("afv-undo").onclick = doUndo; const dir0 = path.dirname(J.items[0].out_rest); $("afv-open").onclick = () => { try { cp.exec('explorer "' + dir0 + '"'); } catch (e) {} };
  } catch (e) { res("err", '<div class="t">Couldn\'t isolate the voice</div>' + esc(e.message)); }
  finally { busy = false; go.disabled = false; go.textContent = goLabel(); prog(go, null); $("afv-stop").style.display = "none"; sub(""); refresh(); } };
async function doUndo(){ if (!undo || busy) return; busy = true;
  try { const r = await callJ("afv_remove", undo.placed); for (const t of undo.muted) await call("afv_mute", { track: t, on: 0 });
    res("ok", '<div class="t">↩ Undone</div>Removed ' + r.removed + " clip" + (r.removed === 1 ? "" : "s") + (undo.muted.length ? " and unmuted the original track" : "") + ". The audio files are kept, so doing it again is instant."); undo = null; }
  catch (e) { res("err", '<div class="t">Couldn\'t undo</div>' + esc(e.message)); } busy = false; }

/* ---------- sidebar entry (under Finish) ---------- */
let hidGrid = false;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel", "afx-qc", "afl-panel"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); Pn.classList.add("open"); }
  else if (Pn.classList.contains("open")) { Pn.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"); if (!side || !gw) return false; if (document.getElementById("afv-nav")) return true;
  const after = document.getElementById("afl-nav") || document.getElementById("afx-nav-qc"); if (!after) return false;
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Isolate voice">🎙️</span> <span class="cat-label">Isolate voice</span>'); nav.id = "afv-nav"; nav.dataset.cat = "__afv__"; nav.dataset.tooltip = "Isolate voice";
  after.parentNode.insertBefore(nav, after.nextSibling); gw.parentNode.insertBefore(Pn, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); refresh(); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 120) clearInterval(iv); }, 300); }
window._afVoice = { planJob, setup, ready, P, callJ, call };
})();
