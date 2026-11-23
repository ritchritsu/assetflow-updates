/* AssetFlow — Track: click an object, the AI (SAM 2 on the graphics card) follows it, and the graphic above follows along
   (Position / Scale / Rotation keyframes), or the clip is stabilized on it. Uses the private Python that Isolate voice set up. */
(function(){
"use strict";
let fs, path, cp, os; try { fs = require("fs"); path = require("path"); cp = require("child_process"); os = require("os"); } catch (e) { return; }
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const blog = m => { try { window._afBootLog && _afBootLog("Track: " + m); } catch (e) {} };
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });
function extDir(){
  try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || "";
    if (raw) { const t = decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, "")); return process.platform === "win32" ? path.normalize(t) : "/" + t.replace(/^\/+/, ""); } } catch (e) {}
  try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
let jsxReady = null;
function host(){ if (!jsxReady) jsxReady = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_track.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/afk ok/.test(r || "")) jsxReady = null; return r; }); return jsxReady; }
async function callJ(fn, arg){ const h = await host(); if (!/afk ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 100) + ")");
  const r = await jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(JSON.stringify(arg))) + ")"); let o; try { o = JSON.parse(r); } catch (e) { throw new Error("Premiere answered: " + String(r).slice(0, 120)); } if (o && o.error) throw new Error(o.error); return o; }
const ffmpeg = () => { for (const p of [path.join(extDir(), "ffmpeg.exe"), path.join(extDir(), "ffmpeg")]) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return "ffmpeg"; };
const V = () => window._afVoice;                     // shares Isolate voice's private Python (PyTorch on the graphics card)
const HOME = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AssetFlow", "voice");
const OK = path.join(HOME, "track_ready.json"), WORK = path.join(HOME, "track"), TRACK_V = 1;
const tready = () => { try { return JSON.parse(fs.readFileSync(OK, "utf8")).v >= TRACK_V && V() && V().ready(); } catch (e) { return false; } };

/* ---------- setup: Isolate voice's AI engine + the tracking AI ---------- */
async function setup(step){
  if (!V()) throw new Error("AssetFlow's AI engine isn't loaded. Restart Premiere and try again.");
  if (!V().ready()) { step(0.02, "Installing the AI engine (shared with Isolate voice)…"); await V().setup((f, m) => step(f * 0.7, m)); }
  const P = V().P; step(0.72, "Installing the tracking AI…"); let last = [];
  const env = Object.assign({}, process.env, { UV_PYTHON_INSTALL_DIR: path.join(HOME, "python"), UV_CACHE_DIR: P.cache, UV_LINK_MODE: "copy", PYTHONUTF8: "1" });
  const code = await new Promise(res => { const p = cp.spawn(P.uv, ["pip", "install", "--python", P.py, "transformers>=4.57", "accelerate", "opencv-python-headless", "pillow"], { windowsHide: true, env });
    const f = d => { String(d).split(/\r?\n/).forEach(l => { if (l.trim()) { last.push(l); last = last.slice(-6); } }); }; p.stdout.on("data", f); p.stderr.on("data", f); p.on("close", res); p.on("error", () => res(-1)); });
  if (code !== 0) throw new Error("Couldn't install the tracking AI: " + last.slice(-2).join(" "));
  step(0.9, "Checking it works…");
  const chk = cp.spawnSync(P.py, ["-c", "import torch, cv2; from transformers import Sam2VideoModel; print('AFOK', torch.cuda.is_available())"], { encoding: "utf8", windowsHide: true, env });
  if (!/AFOK/.test(chk.stdout || "")) throw new Error("The tracking AI didn't start: " + String(chk.stderr || "").trim().split("\n").slice(-1)[0]);
  fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(OK, JSON.stringify({ v: TRACK_V, gpu: /True/.test(chk.stdout), at: Date.now() })); step(1, "Ready"); }

/* ---------- the tracking server (keeps the AI loaded between clicks) ---------- */
let srv = null, seq = 0; const waiting = new Map();
let srvVer = 0;
const engineVer = () => { try { return fs.statSync(path.join(extDir(), "af_track.py")).mtimeMs; } catch (e) { return 0; } };
function server(){
  if (srv && !srv.killed && srv.exitCode == null && srvVer === engineVer()) return srv;
  if (srv) { try { cp.exec("taskkill /pid " + srv.pid + " /T /F"); } catch (e) { try { srv.kill(); } catch (_) {} } srv = null; }   // engine updated: restart it
  srvVer = engineVer();
  const P = V().P; fs.mkdirSync(WORK, { recursive: true });
  const env = Object.assign({}, process.env, { PYTHONUTF8: "1", HF_HOME: path.join(P.models, "hf"), HF_HUB_DISABLE_TELEMETRY: "1" });
  srv = cp.spawn(P.py, ["-u", path.join(extDir(), "af_track.py")], { windowsHide: true, env }); let buf = "", err = "";
  srv.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(l); } catch (e) { continue; }
    const w = m.id != null && waiting.get(m.id);
    if (m.ev === "stage" || m.ev === "prog") { (w ? w.on : onAny)(m); continue; }
    if (w && (m.ev === "error" || ["frame", "preview", "track", "probe", "calib", "diffbox", "blur", "captions"].includes(m.ev))) { waiting.delete(m.id); m.ev === "error" ? (blog("error " + m.msg + " " + (m.tb || "")), w.bad(new Error(m.msg))) : w.ok(m); } } });
  srv.stderr.on("data", d => { err = (err + d).slice(-3000); const m = /(\d+)%\|/.exec(String(d)); if (m && /Download|\.safetensors|model/i.test(String(d))) onAny({ ev: "stage", msg: "Downloading the tracking AI (one time)… " + m[1] + "%" }); });
  srv.on("close", c => { const tail = err.trim().split("\n").slice(-2).join(" "); waiting.forEach(w => w.bad(new Error("The tracking AI stopped" + (tail ? ": " + tail.slice(-200) : "")))); waiting.clear(); srv = null; });
  return srv; }
let onAny = () => {};
function ask(cmd, J, on){ return new Promise((ok, bad) => { const id = ++seq; waiting.set(id, { ok, bad, on: on || onAny }); server().stdin.write(JSON.stringify(Object.assign({ cmd, id, ffmpeg: ffmpeg() }, J)) + "\n"); }); }
window.addEventListener("beforeunload", () => { try { srv && cp.exec("taskkill /pid " + srv.pid + " /T /F"); } catch (e) {} try { srv && srv.kill(); } catch (e) {} });

/* ---------- maths: video-frame point -> sequence pixels (through the clip's own Motion) ---------- */
const isNorm = v => Array.isArray(v) && Math.abs(v[0]) <= 2.5 && Math.abs(v[1]) <= 2.5;
function geo(c, W, H, SW, SH){   // how the tracked clip sits in the sequence
  const pos = c.pos || [0.5, 0.5], an = c.anchor || [0.5, 0.5];
  return { px: isNorm(pos) ? pos[0] * SW : pos[0], py: isNorm(pos) ? pos[1] * SH : pos[1], ax: isNorm(an) ? an[0] * W : an[0], ay: isNorm(an) ? an[1] * H : an[1],
    k: (c.scale == null ? 100 : +c.scale) / 100, r: (+c.rot || 0) * Math.PI / 180, W, H }; }
function toSeq(G, u, v){ const dx = u * G.W - G.ax, dy = v * G.H - G.ay, c = Math.cos(G.r), s = Math.sin(G.r); return [G.px + G.k * (dx * c - dy * s), G.py + G.k * (dx * s + dy * c)]; }
function smooth(A, sig){ if (!(sig > 0.05)) return A.slice(); const R = Math.ceil(sig * 3), w = []; for (let i = -R; i <= R; i++) w.push(Math.exp(-i * i / (2 * sig * sig)));
  return A.map((_, i) => { let s = 0, n = 0; for (let j = -R; j <= R; j++) { const k = i + j; if (k < 0 || k >= A.length) continue; s += A[k] * w[j + R]; n += w[j + R]; } return s / n; }); }

/* ---------- UI ---------- */
document.head.appendChild(el("style", null,
  "#afk-panel{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09)}" +
  "#afk-panel.open{display:flex}.afk-wrap{padding:16px 14px;display:flex;flex-direction:column;gap:12px}.afk-h{font-size:14px;font-weight:600;color:var(--text,#eee)}.afk-p{font-size:11px;color:var(--text3,#999);line-height:1.5}" +
  ".afk-card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px}.afk-step{font-size:11px;font-weight:600;color:var(--text,#ddd);margin-bottom:8px;display:flex;align-items:center;gap:7px}.afk-step b{display:inline-flex;width:17px;height:17px;border-radius:50%;background:var(--accent,#0a84ff);color:#fff;font-size:10px;align-items:center;justify-content:center}" +
  ".afk-cap{font-size:10.5px;color:var(--text3,#999);line-height:1.5;margin-top:6px}.afk-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:7px;color:var(--text,#ddd);font-size:11px;padding:6px 12px;cursor:pointer}.afk-btn:disabled{opacity:.45;cursor:default}" +
  ".afk-go{--p:0%;width:100%;padding:11px 12px;font-size:13px;font-weight:600;border-radius:9px;border:0;color:#fff;cursor:pointer;background:linear-gradient(90deg,rgba(255,255,255,.2) var(--p),transparent var(--p)),var(--accent,#0a84ff)}.afk-go:disabled{cursor:default;opacity:.8}" +
  ".afk-img{position:relative;width:100%;border-radius:8px;overflow:hidden;background:#000;cursor:crosshair;min-height:60px}.afk-img img{display:block;width:100%;transform-origin:0 0;user-select:none;-webkit-user-drag:none}.afk-img.drag{cursor:grabbing}" +
  ".afk-zoom{position:absolute;right:6px;top:6px;display:flex;gap:3px;z-index:2}.afk-zoom button{width:24px;height:22px;border:0;border-radius:5px;background:rgba(0,0,0,.7);color:#fff;font-size:12px;cursor:pointer;padding:0}.afk-zoom span{font-size:10px;color:#fff;background:rgba(0,0,0,.7);border-radius:5px;padding:4px 6px}.afk-img .hint{position:absolute;left:8px;bottom:8px;font-size:10.5px;background:rgba(0,0,0,.65);color:#fff;padding:3px 8px;border-radius:5px;pointer-events:none}" +
  ".afk-seg{display:flex;gap:4px;background:rgba(255,255,255,.05);border-radius:8px;padding:3px}.afk-seg button{flex:1;border:0;background:transparent;color:var(--text2,#bbb);font-size:11px;padding:6px;border-radius:6px;cursor:pointer}.afk-seg button.on{background:var(--accent,#0a84ff);color:#fff}" +
  ".afk-row{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text2,#bbb);margin-top:8px}.afk-row input[type=range]{flex:1}.afk-chk{display:flex;gap:12px;font-size:11px;color:var(--text2,#bbb)}" +
  ".afk-res{display:none;border-radius:10px;padding:12px;font-size:11.5px;line-height:1.55;color:var(--text,#ddd)}.afk-res.show{display:block}.afk-res.ok{background:rgba(52,199,89,.08);border:1px solid rgba(52,199,89,.25)}.afk-res.err{background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.25)}.afk-res .t{font-weight:600;margin-bottom:2px}"));
const Pn = el("div", null,
  '<div class="afk-wrap"><div><div class="afk-h">Track</div><div class="afk-p">Click an object: AI on your graphics card follows it through the clip, and your title / image follows along. Or steady the shot on it.</div></div>' +
  '<div class="afk-card" id="afk-setup" style="display:none"><div class="afk-step"><b>✦</b>One-time setup</div><div class="afk-p">Downloads the tracking AI (about 0.5 GB, more if Isolate voice isn\'t set up yet).</div><button class="afk-go" id="afk-inst" style="margin-top:10px">Set up tracking</button><div class="afk-cap" id="afk-isub"></div></div>' +
  '<div id="afk-main">' +
  '<div class="afk-card"><div class="afk-step"><b>1</b>Select in the timeline</div><div class="afk-p" id="afk-selinfo">Select the clip to follow, plus the title / image above it (Ctrl+click both). Then click the button.</div><button class="afk-btn" id="afk-use" style="margin-top:8px;width:100%">Use selected clips</button></div>' +
  '<div class="afk-card" style="margin-top:12px"><div class="afk-step"><b>2</b>Click the object</div><div class="afk-img" id="afk-imgw"><img id="afk-img" alt="" draggable="false"><div class="afk-zoom"><span id="afk-zl">100%</span><button id="afk-zo" title="Zoom out">−</button><button id="afk-zi" title="Zoom in">+</button><button id="afk-zf" title="Fit">⤢</button></div><span class="hint" id="afk-hint">Load the clips first</span></div>' +
  '<div class="afk-cap"><b>Scroll</b> to zoom in where you point, <b>drag</b> to move around. Click the object to follow. Click more spots if it isn\'t fully covered, <b>Alt+click</b> (or right-click) to leave a part out. The blue area is what will be followed.</div><div style="display:flex;gap:6px;margin-top:6px"><button class="afk-btn" id="afk-clear">Clear clicks</button><button class="afk-btn" id="afk-here">Use playhead frame</button></div></div>' +
  '<div class="afk-card" style="margin-top:12px"><div class="afk-step"><b>3</b>What to do</div><div class="afk-seg" id="afk-mode"><button data-v="attach">Graphic follows it</button><button data-v="stab">Steady the shot</button><button data-v="blur">Blur it</button><button data-v="vert">Vertical 9:16</button></div>' +
  '<div class="afk-cap" style="margin:9px 0 4px">Stick to</div><div class="afk-seg" id="afk-pin"><button data-v="object">The thing I clicked</button><button data-v="ground">Where it stands</button></div><div class="afk-cap" id="afk-pincap"></div>' +
  '<div id="afk-bluropts" style="display:none;margin-top:9px"><div class="afk-seg" id="afk-bstyle"><button data-v="blur">Blur</button><button data-v="pixelate">Pixelate</button></div>' +
  '<div class="afk-seg" id="afk-bshape" style="margin-top:6px"><button data-v="ellipse">Oval</button><button data-v="box">Box</button></div>' +
  '<div class="afk-row"><span>Strength</span><input type="range" id="afk-bstr" min="0" max="10" step="1"><b id="afk-bstrv" style="min-width:20px;text-align:right"></b></div>' +
  '<div class="afk-row"><span>Extra room around it</span><input type="range" id="afk-bpad" min="0" max="10" step="1"><b id="afk-bpadv" style="min-width:20px;text-align:right"></b></div>' +
  '<div class="afk-cap">Renders the blur as its own clip on the track above, so it plays and exports like any clip. Turn it off or delete it any time.</div></div>' +
  '<div id="afk-vertopts" style="display:none;margin-top:9px"><div class="afk-cap" id="afk-vertinfo"></div><button class="afk-btn" id="afk-vcopy" style="margin-top:6px">Make a 9:16 copy of this sequence</button>' +
  '<div class="afk-row"><span>Camera feel</span><input type="range" id="afk-vsm" min="0" max="10" step="1"><b id="afk-vsmv" style="min-width:20px;text-align:right"></b></div><div class="afk-cap">0 = follows tightly, 10 = slow, smooth camera.</div></div>' +
  '<div class="afk-chk" id="afk-chkrow" style="margin-top:9px"><label><input type="checkbox" id="afk-up" checked> Position</label><label><input type="checkbox" id="afk-us"> Scale</label><label><input type="checkbox" id="afk-ur"> Rotation</label></div>' +
  '<div class="afk-row"><span>Smoothing</span><input type="range" id="afk-sm" min="0" max="10" step="1"><b id="afk-smv" style="min-width:20px;text-align:right"></b></div></div>' +
  '<div style="margin-top:12px"><button class="afk-go" id="afk-go">Track</button><div class="afk-cap" id="afk-sub"></div></div>' +
  '<div class="afk-res" id="afk-res" style="margin-top:12px"></div></div></div>');
Pn.id = "afk-panel"; ["keydown", "keyup", "contextmenu"].forEach(t => Pn.addEventListener(t, e => e.stopPropagation()));
const $ = id => Pn.querySelector("#" + id), res = (k, h) => { const r = $("afk-res"); r.className = "afk-res" + (h ? " show " + k : ""); r.innerHTML = h || ""; };
const sub = m => { $("afk-sub").textContent = m || ""; }, prog = f => $("afk-go").style.setProperty("--p", Math.round(f * 100) + "%");

let pin = LS.get("afk_pin", "object");
let ctx = null, pts = [], refT = 0, last = null, undo = null, busy = false, mode = LS.get("afk_mode", "attach"), pv = 0;
["afk-up", "afk-us", "afk-ur"].forEach((id, i) => { const c = $(id); c.checked = LS.get(id, i === 0 ? "1" : "0") === "1"; c.onchange = () => LS.set(id, c.checked ? "1" : "0"); });
$("afk-sm").value = LS.get("afk_sm2", "0"); const smv = () => { $("afk-smv").textContent = $("afk-sm").value; }; smv(); $("afk-sm").oninput = smv; $("afk-sm").onchange = () => LS.set("afk_sm2", $("afk-sm").value);
function drawPin(){ $("afk-pin").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === pin));
  $("afk-pincap").innerHTML = pin === "object" ? "Follows exactly what you clicked. Best for flags, banners, or the space between two things (click both)." : "Pins to the spot on the map where it stands. Best for a character or unit: arms, weapons and blur don't shake it."; }
let bstyle = LS.get("afk_bstyle", "blur"), bshape = LS.get("afk_bshape", "ellipse");
function drawBlur(){ $("afk-bstyle").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === bstyle)); $("afk-bshape").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === bshape)); }
function drawMode(){ $("afk-mode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === mode));
  try { $("afk-bluropts").style.display = mode === "blur" ? "" : "none"; $("afk-chkrow").style.display = mode === "blur" || mode === "vert" ? "none" : ""; $("afk-vertopts").style.display = mode === "vert" ? "" : "none";
    if (mode === "vert") $("afk-vertinfo").innerHTML = ctx && ctx.SW < ctx.SH ? "This sequence is vertical (" + ctx.SW + "×" + ctx.SH + "). Click the subject, then Track: the clip fills the height and pans to keep it centred." : "Open a <b>vertical</b> sequence first (the button below makes a 9:16 copy of this one), then select the clip there and click Use selected clips."; } catch (e) {} if (!busy) $("afk-go").textContent = last && sameJob() ? "Apply again (no re-tracking)" : "Track"; }
$("afk-mode").querySelectorAll("button").forEach(b => b.onclick = () => { mode = b.dataset.v; LS.set("afk_mode", mode); drawMode(); }); drawMode();
$("afk-pin").querySelectorAll("button").forEach(b => b.onclick = () => { pin = b.dataset.v; LS.set("afk_pin", pin); drawPin(); drawMode(); }); drawPin();
$("afk-bstyle").querySelectorAll("button").forEach(b => b.onclick = () => { bstyle = b.dataset.v; LS.set("afk_bstyle", bstyle); drawBlur(); });
$("afk-bshape").querySelectorAll("button").forEach(b => b.onclick = () => { bshape = b.dataset.v; LS.set("afk_bshape", bshape); drawBlur(); }); drawBlur();
[["afk-bstr", "6"], ["afk-bpad", "3"], ["afk-vsm", "5"]].forEach(([id, d]) => { const r = $(id); r.value = LS.get(id, d); const v = () => { $(id + "v").textContent = r.value; }; v(); r.oninput = v; r.onchange = () => LS.set(id, r.value); }); drawMode();
const imgSrc = f => "file:///" + f.replace(/\\/g, "/") + "?v=" + Date.now();
const spd = () => { const c = ctx.src; if (c.speed > 0) return c.speed; const d = c.e - c.s; return d > 0 ? Math.max(0.01, (c.out - c.in) / d) : 1; };   // 0.8 for a clip at 80% speed (asked from Premiere)
/* Premiere may play a file at a different frame rate than it was recorded at (Interpret Footage): then Premiere's "media time"
   isn't real time in the file. fr = Premiere's frame rate for the file / the file's own frame rate */
const fr = () => (ctx.ifps > 0 && ctx.nfps > 0 && Math.abs(ctx.ifps / ctx.nfps - 1) > 0.01) ? ctx.ifps / ctx.nfps : 1;
const mt = t => ctx.cal ? ctx.cal.a + ctx.cal.b * t : (ctx.src.in * spd() + (t - ctx.src.s) * spd()) / fr();   /* Premiere reports a speed-changed clip's In divided by its speed */   // sequence time -> real time inside the video file
const rate = () => ctx.cal ? ctx.cal.b : spd() / fr();   // seconds of video per second of timeline
/* measure the timing exactly: Premiere exports 3 timeline frames, the tracker finds which moment of the file each one is */
async function calibrate(){ const d = ctx.r1 - ctx.r0, T = [0.1, 0.5, 0.9].map(f => Math.round((ctx.r0 + f * d) * ctx.fps) / ctx.fps), shots = [];
  fs.mkdirSync(WORK, { recursive: true });
  for (let i = 0; i < T.length; i++) { const base = path.join(WORK, "cal_" + i), want = [base + ".png", base];
    want.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} }); await callJ("afk_frame", { t: T[i], out: base });
    let f = null; for (let k = 0; k < 60 && !f; k++) { f = want.find(x => { try { return fs.statSync(x).size > 1000; } catch (e) { return false; } }); if (!f) await new Promise(r => setTimeout(r, 100)); }
    if (f) { await new Promise(r => setTimeout(r, 150)); shots.push({ t: T[i], png: f }); } }
  if (shots.length < 2) throw new Error("Premiere didn't export the frames needed to line up the timing.");
  const g0 = (ctx.src.in * spd() + (T[0] - ctx.src.s) * spd()) / fr(), lo = Math.max(0, Math.min(g0, ctx.src.in * spd()) - 6), hi = lo + (ctx.r1 - ctx.r0) * 3 + 14;
  const c = await ask("calib", { file: ctx.src.path, shots, lo, hi }); blog("timing " + JSON.stringify(c));
  if (!(c.b > 0.05 && c.b < 20) || c.res > 0.08 || c.score < 0.35) throw new Error("Couldn't line up the video timing exactly (match " + (c.score || 0).toFixed(2) + ").");
  ctx.cal = { a: c.a, b: c.b }; return c; }
const sameJob = () => last && ctx && last.key === jobKey();
const jobKey = () => ctx ? [ctx.src.path, ctx.src.s, ctx.r0, ctx.r1, refT.toFixed(3), JSON.stringify(pts), pin, JSON.stringify(ctx.cal || 0)].join("|") : "";

async function showFrame(){ if (!ctx) return; const f = path.join(WORK, "frame.jpg"); $("afk-hint").textContent = "Reading the frame…";
  try { const r = await ask("frame", { file: ctx.src.path, t: mt(refT), out: f }); ctx.W = r.W; ctx.H = r.H; $("afk-img").src = imgSrc(f); $("afk-hint").textContent = "Click the object to follow"; }
  catch (e) { $("afk-hint").textContent = "⚠ " + e.message; } }
async function showMask(){ if (!ctx || !pts.length) return showFrame(); const my = ++pv, f = path.join(WORK, "mask_" + (my % 2) + ".jpg"); $("afk-hint").textContent = "Finding the object…";
  try { const r = await ask("preview", { file: ctx.src.path, t: mt(refT), pts, out: f }, m => { if (m.msg) $("afk-hint").textContent = m.msg; }); if (my !== pv) return;
    $("afk-img").src = imgSrc(f); $("afk-hint").textContent = r.box ? "Blue = what will be followed. Click to add, Alt+click to remove" : "Nothing found there — click right on the object"; drawMode(); }
  catch (e) { if (my === pv) $("afk-hint").textContent = "⚠ " + e.message; } }
let Z = { s: 1, x: 0, y: 0 }, drag = null, moved = false;
function zoomDraw(){ const W = $("afk-imgw").clientWidth, H = $("afk-imgw").clientHeight; Z.s = Math.min(8, Math.max(1, Z.s));
  Z.x = Math.min(0, Math.max(W - W * Z.s, Z.x)); Z.y = Math.min(0, Math.max(H - H * Z.s, Z.y));
  $("afk-img").style.transform = "translate(" + Z.x + "px," + Z.y + "px) scale(" + Z.s + ")"; $("afk-zl").textContent = Math.round(Z.s * 100) + "%"; }
function zoomAt(f, cx, cy){ const b = $("afk-imgw").getBoundingClientRect(); cx = cx == null ? b.width / 2 : cx - b.left; cy = cy == null ? b.height / 2 : cy - b.top;
  const ns = Math.min(8, Math.max(1, Z.s * f)); Z.x = cx - (cx - Z.x) * ns / Z.s; Z.y = cy - (cy - Z.y) * ns / Z.s; Z.s = ns; zoomDraw(); }
$("afk-imgw").addEventListener("wheel", e => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY); }, { passive: false });
$("afk-zi").onclick = e => { e.stopPropagation(); zoomAt(1.5); }; $("afk-zo").onclick = e => { e.stopPropagation(); zoomAt(1 / 1.5); }; $("afk-zf").onclick = e => { e.stopPropagation(); Z = { s: 1, x: 0, y: 0 }; zoomDraw(); };
$("afk-imgw").addEventListener("mousedown", e => { if (e.button === 2 || e.target.closest(".afk-zoom")) return; drag = { x: e.clientX, y: e.clientY, zx: Z.x, zy: Z.y }; moved = false; });
window.addEventListener("mousemove", e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!moved && Math.hypot(dx, dy) < 4) return;
  moved = true; $("afk-imgw").classList.add("drag"); Z.x = drag.zx + dx; Z.y = drag.zy + dy; zoomDraw(); });
window.addEventListener("mouseup", () => { drag = null; $("afk-imgw").classList.remove("drag"); });
function clickAt(e, label){ if (!ctx || busy || e.target.closest(".afk-zoom")) return; e.preventDefault(); if (moved && label === 1) { moved = false; return; } const b = $("afk-img").getBoundingClientRect(); if (!b.width) return;
  if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) return;
  pts.push([Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)), label]); showMask(); }
$("afk-imgw").addEventListener("click", e => clickAt(e, e.altKey ? 0 : 1)); $("afk-imgw").addEventListener("contextmenu", e => clickAt(e, 0));
$("afk-clear").onclick = () => { pts = []; showFrame(); drawMode(); };
$("afk-here").onclick = async () => { if (!ctx) return; try { const r = await callJ("afk_sel"); refT = Math.min(ctx.r1 - 1 / ctx.fps, Math.max(ctx.r0, r.ph)); pts = []; showFrame(); drawMode(); } catch (e) { res("err", esc(e.message)); } };

$("afk-use").onclick = async () => { res("", ""); try {
    const r = await callJ("afk_sel"), C = r.clips.filter(c => c.path || c.kind);
    const vids = C.filter(c => /\.(mp4|mov|mkv|avi|mxf|m4v|webm|ts|mts)$/i.test(c.path)).sort((a, b) => a.t - b.t);
    if (!vids.length) throw new Error("Select the video clip you want to follow (plus the title / image above it).");
    const src = vids[0], tg = C.filter(c => c !== src && c.t > src.t && c.e > src.s && c.s < src.e);
    const r0 = tg.length ? Math.max(src.s, Math.min(...tg.map(c => c.s))) : src.s, r1 = tg.length ? Math.min(src.e, Math.max(...tg.map(c => c.e))) : src.e;
    const ctx0 = ctx; ctx = { src, tg, r0, r1, fps: r.fps, SW: r.W, SH: r.H, seqId: r.id };
    if (!tg.length && mode === "attach") { mode = "stab"; drawMode(); }
    const newRef = (r.ph >= r0 && r.ph < r1) ? r.ph : r0;     // always the frame at the playhead (or the start of the clip)
    const same = ctx0 && ctx0.src.path === src.path && Math.abs(ctx0.src.s - src.s) < 0.02 && Math.abs(refT - newRef) < 0.5 / (r.fps || 30);
    refT = newRef; if (!same) pts = []; last = null;
    $("afk-selinfo").innerHTML = "Following <b>" + esc(src.name) + "</b>" + (tg.length ? ", moving <b>" + tg.map(c => esc(c.name)).join("</b>, <b>") + "</b>" : " (no graphic selected: you can steady the shot)") + " · " + (r1 - r0).toFixed(1) + " s";
    try { const pr = await ask("probe", { file: src.path }); ctx.nfps = pr.fps; ctx.ifps = +src.ifps || 0;
      blog("fps: premiere " + ctx.ifps + " file " + ctx.nfps + " speed " + spd()); if (fr() !== 1) $("afk-selinfo").innerHTML += "<br>Premiere plays this file at " + (+ctx.ifps).toFixed(2) + " fps (it was recorded at " + (+ctx.nfps).toFixed(2) + "): taken into account."; } catch (e) {}
    $("afk-hint").textContent = "Lining up the timing with Premiere…";
    try { const c = await calibrate(); $("afk-selinfo").innerHTML += "<br>✓ Timing matched to Premiere exactly (video runs at " + Math.round(c.b * 100) + "% speed)."; }
    catch (e) { blog("calibration skipped: " + e.message); $("afk-selinfo").innerHTML += "<br>⚠ " + esc(e.message) + " Using Premiere's clip info instead."; }
    if (same && pts.length) showMask(); else showFrame(); drawMode(); } catch (e) { res("err", '<div class="t">Couldn\'t load</div>' + esc(e.message)); } };

/* keyframes from the track: graphic follows (attach) or the clip is steadied (stab) */
function build(T, use, sig){ const fps = ctx.fps, G = geo(ctx.src, T.W, T.H, ctx.SW, ctx.SH), F = T.fr, n = F.length;
  const X = smooth(F.map(f => f[0]), sig), Y = smooth(F.map(f => f[1]), sig), S = smooth(F.map(f => f[2]), sig), R = smooth(F.map(f => f[3]), sig), k0 = T.k_ref;
  const O = i => toSeq(G, X[i], Y[i]), Oref = toSeq(G, X[k0], Y[k0]), out = [];
  const units = (c, p) => isNorm(c.pos || [0.5, 0.5]) ? [p[0] / ctx.SW, p[1] / ctx.SH] : p;
  /* Jseq(i): how a small step next to the object (in sequence pixels) changes from the clicked frame to frame i: the map's turn, squash and zoom there */
  const hasJ = F[k0] && F[k0].length >= 9, Wv = T.W, Hv = T.H, cr = Math.cos(G.r), sr = Math.sin(G.r);
  const inv = M => { const D = M[0][0] * M[1][1] - M[0][1] * M[1][0] || 1e-9; return [[M[1][1] / D, -M[0][1] / D], [-M[1][0] / D, M[0][0] / D]]; };
  const mul = (A, B) => [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
  const Rc = [[cr, -sr], [sr, cr]], RcT = [[cr, sr], [-sr, cr]];
  const Jseq = i => { const f = F[i]; return mul(mul(Rc, [[f[5], f[6] * Wv / Hv], [f[7] * Hv / Wv, f[8]]]), RcT); };   // video-pixel J, turned like the clip sits in the sequence
  const Jref = hasJ ? inv(Jseq(k0)) : null;
  if (mode === "attach") ctx.tg.forEach(g => { const g0p = isNorm(g.pos || [0.5, 0.5]) ? [(g.pos || [.5, .5])[0] * ctx.SW, (g.pos || [.5, .5])[1] * ctx.SH] : g.pos, vx = g0p[0] - Oref[0], vy = g0p[1] - Oref[1], K = [];
    const vis = g.vis || g0p, ux = vis[0] - Oref[0], uy = vis[1] - Oref[1], ex = vis[0] - g0p[0], ey = vis[1] - g0p[1];   // where it really shows, and how far that is from its Position
    for (let i = 0; i < n; i++) { const t = ctx.r0 + i / fps; if (t < g.s - 1e-6 || t > g.e + 1e-6) continue; const ds = use.s ? S[i] / S[k0] : 1, th = use.r ? (R[i] - R[k0]) * Math.PI / 180 : 0, o = O(i);
      let p;
      if (!use.p) p = g0p;
      else if (hasJ) { const M = mul(Jseq(i), Jref), tx = o[0] + M[0][0] * ux + M[0][1] * uy, ty = o[1] + M[1][0] * ux + M[1][1] * uy;   // where it should show
        p = [tx - ds * (ex * Math.cos(th) - ey * Math.sin(th)), ty - ds * (ex * Math.sin(th) + ey * Math.cos(th))]; }               // the Position that puts it there
      else p = [o[0] + ds * (vx * Math.cos(th) - vy * Math.sin(th)), o[1] + ds * (vx * Math.sin(th) + vy * Math.cos(th))];
      K.push([t].concat(units(g, p), [(g.scale == null ? 100 : +g.scale) * ds, (+g.rot || 0) + (use.r ? R[i] - R[k0] : 0)])); }
    out.push({ c: g, K }); });
  else { const c = ctx.src, K = [];   // steady: put the object back where it was on the clicked frame
    for (let i = 0; i < n; i++) { const t = ctx.r0 + i / fps, ds = use.s ? S[k0] / S[i] : 1, rot = (+c.rot || 0) - (use.r ? R[i] - R[k0] : 0), k = G.k * ds, rr = rot * Math.PI / 180;
      const dx = X[i] * G.W - G.ax, dy = Y[i] * G.H - G.ay, p = use.p ? [Oref[0] - k * (dx * Math.cos(rr) - dy * Math.sin(rr)), Oref[1] - k * (dx * Math.sin(rr) + dy * Math.cos(rr))] : [G.px, G.py];
      K.push([t].concat(units(c, p), [(c.scale == null ? 100 : +c.scale) * ds, rot])); }
    out.push({ c, K }); }
  return out; }

/* where each graphic REALLY is on screen at the clicked frame (a text's Position is usually just the frame centre):
   export the frame with and without the graphic, and look at what changed */
async function exportAt(t, hide){ const base = path.join(WORK, "loc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)), want = [base + ".png", base];
  await callJ("afk_frame", { t, out: base, hide }); let f = null;
  for (let k = 0; k < 60 && !f; k++) { f = want.find(x => { try { return fs.statSync(x).size > 1000; } catch (e) { return false; } }); if (!f) await new Promise(r => setTimeout(r, 100)); }
  if (f) await new Promise(r => setTimeout(r, 150)); return f; }
async function locateGraphics(){ const t = Math.round(refT * ctx.fps) / ctx.fps;
  for (const g of ctx.tg) { if (g.vis !== undefined && g.visT === t) continue; g.vis = null; g.visT = t;
    try { if (t < g.s || t >= g.e) continue; const a = await exportAt(t, []), b = await exportAt(t, [{ t: g.t, s: g.s }]); if (!a || !b) continue;
      const r = await ask("diffbox", { a, b }); if (r.c) g.vis = [r.c[0] * ctx.SW, r.c[1] * ctx.SH]; blog("graphic " + g.name + (r.c ? " sits at " + JSON.stringify(r.c) : ": not found on screen, using its clip position")); } catch (e) { blog("locate " + g.name + ": " + e.message); } } }
async function apply(T){ const use = { p: $("afk-up").checked, s: $("afk-us").checked, r: $("afk-ur").checked }; if (!use.p && !use.s && !use.r) throw new Error("Tick at least one of Position, Scale, Rotation.");
  const jobs = build(T, use, +$("afk-sm").value * 0.2);   /* gentle: at most about ±6 frames, so motion never starts early */
  try { fs.writeFileSync(path.join(extDir(), "track_debug.json"), JSON.stringify({ at: new Date().toISOString(), mode, use, smooth: +$("afk-sm").value, refT, pts, spd: spd(), vis: ctx.tg.map(g => g.vis), nfps: ctx.nfps, ifps: ctx.ifps, fr: fr(), cal: ctx.cal, ctx: { src: ctx.src, tg: ctx.tg, r0: ctx.r0, r1: ctx.r1, fps: ctx.fps, SW: ctx.SW, SH: ctx.SH },
    track: { k_ref: T.k_ref, W: T.W, H: T.H, secs: T.secs, fr: T.fr }, keys: jobs.map(j => ({ name: j.c.name, K: j.K })) })); } catch (e) {} let n = 0; undo = { use, items: [] };
  for (const j of jobs) { const c = j.c; undo.items.push({ t: c.t, s: c.s, pos: c.pos, scale: c.scale, rot: c.rot, keyed: c.keyed });
    for (let i = 0; i < j.K.length; i += 120) { sub("Writing keyframes… " + Math.round(i / j.K.length * 100) + "%");
      const r = await callJ("afk_apply", { t: c.t, s: c.s, keys: j.K.slice(i, i + 120), use, clear: i === 0, clearFrom: ctx.r0, clearTo: ctx.r1, mode: kmode }); n += r.keys; kmode = r.mode || kmode;
      if (!r.keys) { blog("apply failed on " + c.name + ": " + r.err); throw new Error("Premiere didn't accept the keyframes on \"" + c.name + "\": " + (r.err || "unknown reason")); } } }
  return n; }
let kmode = 0;

$("afk-go").onclick = async () => { if (busy) return; if (!ctx) return res("err", "<div class='t'>Nothing loaded</div>Select the clips in the timeline and click <b>Use selected clips</b>.");
  if (mode === "attach" && !ctx.tg.length) return res("err", "<div class='t'>No graphic selected</div>In the timeline, Ctrl+click the video clip <b>and</b> the title / image above it, then click <b>Use selected clips</b> again (your clicks on the object are kept). Or choose <b>Steady the shot</b>.");
  if (!pts.some(p => p[2] === 1)) return res("err", "<div class='t'>Click the object first</div>Click on it in the frame above, so the AI knows what to follow.");
  busy = true; const go = $("afk-go"); go.disabled = true; res("", ""); prog(0); const t0 = Date.now();
  try { if (mode === "attach") { sub("Finding where your graphics sit…"); await locateGraphics(); }
    if (!sameJob()) { go.textContent = "Tracking…";
      const T = await ask("track", { file: ctx.src.path, a: mt(ctx.r0), b: mt(ctx.r1), ref: mt(refT), fps: ctx.fps / rate(), pts, pin }, m => { if (m.ev === "prog") { prog(m.f); sub("Tracking… " + Math.round(m.f * 100) + "%" + (m.fps ? " · " + m.fps + " frames/s" : "")); } else if (m.msg) sub(m.msg); });
      last = Object.assign(T, { key: jobKey() }); blog("tracked " + T.fr.length + " frames in " + T.secs + "s"); }
    if (mode === "blur") { await blurIt(last, t0); return; }
    if (mode === "vert") { await reframe(last, t0); return; }
    go.textContent = "Writing keyframes…"; const n = await apply(last); if (!n) throw new Error("No keyframes were written. Check that the graphic above overlaps the tracked part of the clip."); const lost = last.fr.filter(f => !f[4]).length;
    res("ok", '<div class="t">✓ ' + (mode === "attach" ? "Now following the object: " + ctx.tg.map(c => esc(c.name)).join(", ") : "Shot steadied: " + esc(ctx.src.name)) + "</div>" + n + " keyframes · " + last.fr.length + " frames in " + ((Date.now() - t0) / 1000).toFixed(1) + " s." +
      (lost ? "<br>⚠ The object was out of view for " + lost + " frame" + (lost > 1 ? "s" : "") + "; it held still there." : "") +
      "<br>Change Smoothing or the boxes and click again: it re-applies without tracking again." + (mode === "stab" ? "<br>Tip: raise the clip's Scale a little to hide the moving edges." : "") +
      '<div style="margin-top:8px"><button class="afk-btn" id="afk-undo">Undo</button></div>');
    $("afk-undo").onclick = doUndo; sub(""); }
  catch (e) { res("err", '<div class="t">Tracking stopped</div>' + esc(e.message)); sub(""); blog("failed: " + e.message); }
  finally { busy = false; go.disabled = false; prog(0); drawMode(); } };
/* blur: one box per timeline frame from the track, rendered as a see-through clip and placed on the track above */
async function blurIt(T, t0){ const b0 = T.box0 || [0.45, 0.45, 0.55, 0.55, 0.5, 0.5], pad = 1 + (+$("afk-bpad").value) * 0.06, sig = +$("afk-sm").value * 0.2;
  const X = smooth(T.fr.map(f => f[0]), sig), Y = smooth(T.fr.map(f => f[1]), sig), S = smooth(T.fr.map(f => f[2]), sig);
  const boxes = T.fr.map((f, i) => { const s = S[i] / (S[T.k_ref] || 1), x = X[i], y = Y[i];
    return [x - (b0[4] - b0[0]) * s * pad, y - (b0[5] - b0[1]) * s * pad, x + (b0[2] - b0[4]) * s * pad, y + (b0[3] - b0[5]) * s * pad]; });
  const dir = path.join(path.dirname(ctx.src.path), "AssetFlow Blur"); try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const out = path.join(dir, path.basename(ctx.src.path).replace(/\.[^.]+$/, "") + " - blur " + Date.now().toString(36) + ".mov");
  $("afk-go").textContent = "Rendering the blur…";
  const r = await ask("blur", { file: ctx.src.path, a: mt(ctx.r0), rate: rate(), fps: ctx.fps, n: T.fr.length, boxes, strength: (+$("afk-bstr").value) / 10, style: bstyle, shape: bshape, feather: 0.2, out },
    m => { if (m.ev === "prog") { prog(m.f); sub("Rendering the blur… " + Math.round(m.f * 100) + "%"); } });
  sub("Adding it to your timeline…"); const p = await callJ("afk_placeLayer", { path: out, t: ctx.src.t, s: ctx.src.s, at: ctx.r0, dur: ctx.r1 - ctx.r0 });
  undo = null; res("ok", '<div class="t">✓ ' + (bstyle === "pixelate" ? "Pixelated" : "Blurred") + "</div>On <b>V" + (p.track + 1) + "</b> above your clip · " + T.fr.length + " frames in " + ((Date.now() - t0) / 1000).toFixed(1) + " s.<br>It's a normal clip: turn it off, trim or delete it any time. Change the options and click again for a new version.");
  blog("blur " + out + " -> V" + (p.track + 1)); }
/* vertical: fill the height, pan so the subject stays centred, never past the picture's edges; slow camera = heavier smoothing */
async function reframe(T, t0){ if (!(ctx.SW < ctx.SH)) throw new Error("This sequence isn't vertical. Make a 9:16 copy first (button above), select the clip in it, and click Use selected clips.");
  const c = ctx.src, W = T.W, H = T.H, k = Math.max(ctx.SW / W, ctx.SH / H), fps = ctx.fps, sig = (+$("afk-vsm").value) * fps * 0.06;
  const ok = T.fr.map(f => f[4]), X0 = T.fr.map(f => f[0]), Y0 = T.fr.map(f => f[1]);
  const X = smooth(X0, sig), Y = smooth(Y0, sig), mx = Math.max(0, (k * W - ctx.SW) / 2), my = Math.max(0, (k * H - ctx.SH) / 2);
  const isN = isNorm(c.pos || [0.5, 0.5]), K = [];
  for (let i = 0; i < T.fr.length; i++) { const t = ctx.r0 + i / fps;
    const dx = Math.max(-mx, Math.min(mx, -(X[i] - 0.5) * W * k)), dy = Math.max(-my, Math.min(my, -(Y[i] - 0.5) * H * k));
    const px = ctx.SW / 2 + dx, py = ctx.SH / 2 + dy; K.push([t].concat(isN ? [px / ctx.SW, py / ctx.SH] : [px, py], [Math.round(k * 10000) / 100, +c.rot || 0])); }
  undo = { use: { p: true, s: true, r: false }, items: [{ t: c.t, s: c.s, pos: c.pos, scale: c.scale, rot: c.rot, keyed: c.keyed }] };
  let n = 0; for (let i = 0; i < K.length; i += 120) { sub("Writing keyframes… " + Math.round(i / K.length * 100) + "%");
    const r = await callJ("afk_apply", { t: c.t, s: c.s, keys: K.slice(i, i + 120), use: { p: true, s: true, r: false }, clear: i === 0, clearFrom: ctx.r0, clearTo: ctx.r1, mode: kmode }); n += r.keys; kmode = r.mode || kmode; }
  res("ok", '<div class="t">✓ Reframed for vertical</div>' + n + " keyframes · fills the height at " + (k * 100).toFixed(0) + "% and follows the subject · " + ((Date.now() - t0) / 1000).toFixed(1) + " s." +
    "<br>Raise <b>Camera feel</b> for a smoother pan and click again (no re-tracking)." + '<div style="margin-top:8px"><button class="afk-btn" id="afk-undo">Undo</button></div>');
  $("afk-undo").onclick = doUndo; sub(""); }
$("afk-vcopy").onclick = async () => { try { const r = await callJ("afk_vertCopy"); res("ok", '<div class="t">✓ Made "' + esc(r.name) + '"</div>It\'s open now (1080×1920). Select the clip in it, click <b>Use selected clips</b>, click the subject, then <b>Track</b>.'); }
  catch (e) { res("err", '<div class="t">Couldn\'t make the copy</div>' + esc(e.message)); } };
async function doUndo(){ if (!undo) return; try { for (const u of undo.items) await callJ("afk_restore", { t: u.t, s: u.s, use: undo.use, pos: u.pos, scale: u.scale, rot: u.rot });
    res("ok", '<div class="t">↩ Undone</div>Back to how it was' + (undo.items.some(u => u.keyed) ? " (it had keyframes before: use Ctrl+Z in Premiere if some are missing)" : "") + "."); undo = null; } catch (e) { res("err", esc(e.message)); } }

async function refresh(){ const ok = tready(); $("afk-setup").style.display = ok ? "none" : ""; $("afk-main").style.display = ok ? "" : "none"; if (ok) { onAny = m => { if (m.msg) sub(m.msg); }; try { server(); } catch (e) {} } }
$("afk-inst").onclick = async () => { const b = $("afk-inst"); if (b.disabled) return; b.disabled = true;
  try { await setup((f, m) => { b.style.setProperty("--p", Math.round(f * 100) + "%"); $("afk-isub").textContent = m; }); refresh(); }
  catch (e) { $("afk-isub").innerHTML = '<span style="color:#ff7b7b">' + esc(e.message) + "</span>"; blog("setup failed: " + e.message); } finally { b.disabled = false; } };

/* ---------- sidebar entry (after Isolate voice) ---------- */
let hidGrid = false;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel", "afx-qc", "afl-panel", "afv-panel"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); Pn.classList.add("open"); }
  else if (Pn.classList.contains("open")) { Pn.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"); if (!side || !gw) return false; if (document.getElementById("afk-nav")) return true;
  const after = document.getElementById("afv-nav"); if (!after) return false;
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Track">🎯</span> <span class="cat-label">Track</span>'); nav.id = "afk-nav"; nav.dataset.cat = "__afk__"; nav.dataset.tooltip = "Track";
  after.parentNode.insertBefore(nav, after.nextSibling); gw.parentNode.insertBefore(Pn, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); refresh(); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 160) clearInterval(iv); }, 300); }
window._afTrack = { setup, ready: tready, ask };   // Find a moment uses the same AI engine
})();
