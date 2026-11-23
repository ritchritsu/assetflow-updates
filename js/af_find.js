/* AssetFlow — Find a moment: describe what's on screen ("Nagash's army on the map", "big battle with fire") and jump to it,
   across hours of footage. AI (SigLIP) on the graphics card; every video is read once (keyframes only) and remembered. */
(function(){
"use strict";
let fs, path, cp, os; try { fs = require("fs"); path = require("path"); cp = require("child_process"); os = require("os"); } catch (e) { return; }
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const blog = m => { try { window._afBootLog && _afBootLog("Find: " + m); } catch (e) {} };
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });
function extDir(){
  try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || "";
    if (raw) { const t = decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, "")); return process.platform === "win32" ? path.normalize(t) : "/" + t.replace(/^\/+/, ""); } } catch (e) {}
  try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
let jsxReady = null;
function host(){ if (!jsxReady) jsxReady = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_find.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/aff ok/.test(r || "")) jsxReady = null; return r; }); return jsxReady; }
async function callJ(fn, arg){ const h = await host(); if (!/aff ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 100) + ")");
  const r = await jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(JSON.stringify(arg))) + ")"); let o; try { o = JSON.parse(r); } catch (e) { throw new Error("Premiere answered: " + String(r).slice(0, 120)); } if (o && o.error) throw new Error(o.error); return o; }
const ffmpeg = () => { for (const p of [path.join(extDir(), "ffmpeg.exe"), path.join(extDir(), "ffmpeg")]) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return "ffmpeg"; };
const HOME = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AssetFlow", "voice");
const CACHE = path.join(HOME, "find_index"), THUMBS = path.join(HOME, "find_thumbs");
const ready = () => !!(window._afTrack && window._afTrack.ready());   // same AI engine as Track
const tc = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60), p = n => String(n).padStart(2, "0"); return (h ? h + ":" + p(m) : m) + ":" + p(s); };

/* ---------- the search engine (keeps the AI loaded) ---------- */
let srv = null, seq = 0, srvVer = 0; const waiting = new Map();
const engineVer = () => { try { return fs.statSync(path.join(extDir(), "af_find.py")).mtimeMs; } catch (e) { return 0; } };
function server(){
  if (srv && srv.exitCode == null && srvVer === engineVer()) return srv;
  if (srv) { try { cp.exec("taskkill /pid " + srv.pid + " /T /F"); } catch (e) {} srv = null; }
  srvVer = engineVer(); const P = window._afVoice.P;
  const env = Object.assign({}, process.env, { PYTHONUTF8: "1", HF_HOME: path.join(P.models, "hf"), HF_HUB_DISABLE_TELEMETRY: "1" });
  srv = cp.spawn(P.py, ["-u", path.join(extDir(), "af_find.py")], { windowsHide: true, env }); let buf = "", err = "";
  srv.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(l); } catch (e) { continue; }
    const w = m.id != null && waiting.get(m.id);
    if (m.ev === "stage" || m.ev === "prog") { if (w) w.on(m); else if (m.msg) sub(m.msg); continue; }
    if (w && ["error", "indexed", "hits"].includes(m.ev)) { waiting.delete(m.id); m.ev === "error" ? (blog("error " + m.msg + " " + (m.tb || "")), w.bad(new Error(m.msg))) : w.ok(m); } } });
  srv.stderr.on("data", d => { err = (err + d).slice(-3000); const m = /(\d+)%\|/.exec(String(d)); if (m && /safetensors|Download|model/i.test(String(d))) sub("Downloading the search AI (one time)… " + m[1] + "%"); });
  srv.on("close", () => { const tail = err.trim().split("\n").slice(-2).join(" "); waiting.forEach(w => w.bad(new Error("The search AI stopped" + (tail ? ": " + tail.slice(-200) : "")))); waiting.clear(); srv = null; });
  return srv; }
function ask(cmd, J, on){ return new Promise((ok, bad) => { const id = ++seq; waiting.set(id, { ok, bad, on: on || (() => {}) }); server().stdin.write(JSON.stringify(Object.assign({ cmd, id, ffmpeg: ffmpeg(), cache: CACHE }, J)) + "\n"); }); }
window.addEventListener("beforeunload", () => { try { srv && cp.exec("taskkill /pid " + srv.pid + " /T /F"); } catch (e) {} });

/* ---------- UI ---------- */
document.head.appendChild(el("style", null,
  "#aff-panel{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09)}" +
  "#aff-panel.open{display:flex}.aff-wrap{padding:16px 14px;display:flex;flex-direction:column;gap:12px}.aff-h{font-size:14px;font-weight:600;color:var(--text,#eee)}.aff-p{font-size:11px;color:var(--text3,#999);line-height:1.5}" +
  ".aff-q{display:flex;gap:6px}.aff-q input{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:var(--text,#eee);font-size:12.5px;padding:9px 11px;outline:none}.aff-q input:focus{border-color:var(--accent,#0a84ff)}" +
  ".aff-go{--p:0%;padding:0 16px;font-size:12.5px;font-weight:600;border-radius:8px;border:0;color:#fff;cursor:pointer;background:linear-gradient(90deg,rgba(255,255,255,.2) var(--p),transparent var(--p)),var(--accent,#0a84ff)}.aff-go:disabled{opacity:.8;cursor:default}" +
  ".aff-seg{display:flex;gap:4px;background:rgba(255,255,255,.05);border-radius:8px;padding:3px}.aff-seg button{flex:1;border:0;background:transparent;color:var(--text2,#bbb);font-size:11px;padding:6px;border-radius:6px;cursor:pointer}.aff-seg button.on{background:var(--accent,#0a84ff);color:#fff}" +
  ".aff-sub{font-size:10.5px;color:var(--text3,#999);min-height:14px}.aff-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}" +
  ".aff-hit{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;overflow:hidden;cursor:pointer}.aff-hit:hover{border-color:var(--accent,#0a84ff)}.aff-hit img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}" +
  ".aff-hit .i{padding:6px 8px;font-size:10.5px;color:var(--text2,#ccc);display:flex;justify-content:space-between;gap:6px}.aff-hit .i span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aff-bar{height:3px;background:var(--accent,#0a84ff)}" +
  ".aff-chips{display:flex;flex-wrap:wrap;gap:5px}.aff-chips button{font-size:10.5px;padding:3px 9px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:transparent;color:var(--text2,#bbb);cursor:pointer}"));
const Pn = el("div", null,
  '<div class="aff-wrap"><div><div class="aff-h">Find a moment</div><div class="aff-p">Describe what\'s on screen and jump to it, across all your footage. AI on your graphics card. Each video is read once, then searches are instant.</div></div>' +
  '<div class="aff-seg" id="aff-scope"><button data-v="seq">Videos in this sequence</button><button data-v="proj">All videos in the project</button></div>' +
  '<div class="aff-q"><input id="aff-in" placeholder="Describe the moment, e.g. a big battle with fire" title="Put - before a word to leave it out, e.g. battle -menu"><button class="aff-go" id="aff-go">Search</button></div>' +
  '<div class="aff-chips" id="aff-ex"></div><div class="aff-sub" id="aff-sub"></div><div class="aff-grid" id="aff-res"></div></div>');
Pn.id = "aff-panel"; ["keydown", "keyup", "contextmenu"].forEach(t => Pn.addEventListener(t, e => e.stopPropagation()));
const $ = id => Pn.querySelector("#" + id), sub = m => { $("aff-sub").textContent = m || ""; }, prog = f => $("aff-go").style.setProperty("--p", Math.round(f * 100) + "%");
let scope = LS.get("aff_scope", "seq"), busy = false;
const drawScope = () => $("aff-scope").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === scope));
$("aff-scope").querySelectorAll("button").forEach(b => b.onclick = () => { scope = b.dataset.v; LS.set("aff_scope", scope); drawScope(); }); drawScope();
["a big battle", "the campaign map zoomed out", "a castle siege", "the facecam reaction", "a menu or loading screen", "a dragon"].forEach(x => { const b = el("button", null, esc(x)); b.onclick = () => { $("aff-in").value = x; search(); }; $("aff-ex").appendChild(b); });
$("aff-in").addEventListener("keydown", e => { if (e.key === "Enter") search(); });
$("aff-go").onclick = () => search();

/* one-time: the text part of the search AI needs two small libraries Track didn't install */
const FREADY = path.join(HOME, "find_ready.json");
async function setupOnce(){ try { if (JSON.parse(fs.readFileSync(FREADY, "utf8")).v >= 1) return; } catch (e) {}
  const P = window._afVoice.P; sub("Installing the search AI's text tools (one time)…"); let last = "";
  const env = Object.assign({}, process.env, { UV_PYTHON_INSTALL_DIR: path.join(HOME, "python"), UV_CACHE_DIR: P.cache, UV_LINK_MODE: "copy", PYTHONUTF8: "1" });
  const code = await new Promise(res => { const p = cp.spawn(P.uv, ["pip", "install", "--python", P.py, "sentencepiece", "protobuf"], { windowsHide: true, env }); p.stderr.on("data", d => { last = String(d).trim().slice(-200); }); p.on("close", res); p.on("error", () => res(-1)); });
  if (code !== 0) throw new Error("Couldn't install the search AI's text tools: " + last);
  fs.writeFileSync(FREADY, JSON.stringify({ v: 1, at: Date.now() })); }
async function search(){
  const q = $("aff-in").value.trim(); if (!q || busy) return;
  if (!ready()) { sub("Set up the AI first: open the Track page and click Set up tracking (Find uses the same engine)."); return; }
  busy = true; $("aff-go").disabled = true; prog(0); const t0 = Date.now();
  try { await setupOnce(); const r = await callJ(scope === "seq" ? "aff_seqFiles" : "aff_projFiles"); const files = r.files || [];
    if (!files.length) throw new Error(scope === "seq" ? "No video clips in this sequence." : "No videos in this project.");
    sub("Reading your footage (only new videos, once)…");
    const ix = await ask("index", { files }, m => { if (m.ev === "prog") { prog(m.f); sub("Reading " + m.file + " (" + m.n + "/" + m.of + ")… " + Math.round(m.f * 100) + "%"); } else if (m.msg) sub(m.msg); });
    if (ix.new) blog("indexed " + ix.new + " new videos in " + ix.secs + "s");
    sub("Searching…"); const h = await ask("search", { files, q, top: 24, thumbs: THUMBS });
    show(h.hits || [], q, files.length, (Date.now() - t0) / 1000); }
  catch (e) { sub("⚠ " + e.message); blog("failed " + e.message); }
  finally { busy = false; $("aff-go").disabled = false; prog(0); } }

function show(H, q, nf, secs){ const R = $("aff-res"); R.innerHTML = "";
  sub(H.length ? H.length + " moments for “" + q + "” in " + nf + " video" + (nf > 1 ? "s" : "") + " · " + secs.toFixed(1) + " s · click one to jump there" : "Nothing found.");
  H.forEach(h => { const c = el("div", "aff-hit", (h.thumb ? '<img src="file:///' + esc(h.thumb.replace(/\\/g, "/")) + '">' : '<img>') + '<div class="aff-bar" style="width:' + Math.max(8, h.match) + '%"></div><div class="i"><span title="' + esc(h.file) + '">' + esc(path.basename(h.file)) + "</span><span>" + tc(h.t) + "</span></div>");
    c.onclick = async () => { try { const r = await callJ("aff_go", { file: h.file, t: h.t }); sub(r.where === "sequence" ? "Playhead moved to it in your sequence." : "It isn't in this sequence: opened in the Source Monitor at " + tc(h.t) + "."); } catch (e) { sub("⚠ " + e.message); } };
    R.appendChild(c); }); }

/* ---------- sidebar entry (after Track) ---------- */
let hidGrid = false;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel", "afx-qc", "afl-panel", "afv-panel", "afk-panel"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); Pn.classList.add("open"); setTimeout(() => $("aff-in").focus(), 50);
    if (ready()) { try { server(); } catch (e) {} } }
  else if (Pn.classList.contains("open")) { Pn.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"); if (!side || !gw) return false; if (document.getElementById("aff-nav")) return true;
  const after = document.getElementById("afk-nav") || document.getElementById("afv-nav"); if (!after) return false;
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Find a moment">🔎</span> <span class="cat-label">Find a moment</span>'); nav.id = "aff-nav"; nav.dataset.cat = "__aff__"; nav.dataset.tooltip = "Find a moment";
  after.parentNode.insertBefore(nav, after.nextSibling); gw.parentNode.insertBefore(Pn, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 200) clearInterval(iv); }, 300); }
})();
