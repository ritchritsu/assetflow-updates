/* AssetFlow — Proxy maker (based on Ritch_Proxy_Maker.cmd): NVENC 540p proxies into a "Proxy" subfolder, 3 at a time,
   CPU fallback when there's no NVIDIA GPU, live progress, and the proxies are attached to the clips in Premiere when done. */
(function(){
"use strict";
let fs, path, cp; try { fs = require("fs"); path = require("path"); cp = require("child_process"); } catch (e) { return; }
const VIDEO = /\.(mp4|mov|m4v|mts|m2ts|mkv|avi|mxf|webm)$/i;
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let ov = null; const $ = id => document.getElementById(id) || (ov && ov.querySelector("#" + id));
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const evalJsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });

function extDir(){ try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || ""; if (raw) return path.normalize(decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, ""))); } catch (e) {} try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
function ffmpegPath(){ const c = [path.join(extDir(), "ffmpeg.exe"), path.join(extDir(), "ffmpeg")]; for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return "ffmpeg"; }

/* ---------- UI ---------- */
document.head.appendChild(el("style", null,
  "#dl-tab-proxy{display:none}#dl-tab-proxy.active{display:flex;flex-direction:column;flex:1;min-height:0}" +
  "#px{flex:1;min-height:320px;display:flex;flex-direction:column;color:#ddd;font-size:12px}" +
  "#px header{display:flex;flex-wrap:wrap;gap:6px;padding:10px;border-bottom:1px solid var(--border,#333);align-items:center}" +
  "#px button,#px select{background:var(--bg4,#333);border:1px solid var(--border2,#444);color:#eee;border-radius:4px;padding:5px 9px;cursor:pointer;font-size:12px}" +
  "#px button:hover{background:var(--bg5,#3d3d3d)}#px .pri{background:#2d6cdf;border-color:#2d6cdf}#px button:disabled{opacity:.5;cursor:default}" +
  "#px label{display:flex;align-items:center;gap:4px;color:#bbb}#px-src{flex:1 1 100%;color:#999;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
  "#px-list{flex:1;overflow:auto;padding:4px 10px}.px-r{padding:6px 0;border-bottom:1px solid var(--border,#333)}.px-r b{font-weight:500}" +
  ".px-r i{float:right;font-style:normal;color:#999;font-size:11px}.px-bar{height:4px;background:#333;border-radius:2px;margin-top:4px;overflow:hidden}" +
  ".px-bar>div{height:100%;width:0;background:#2d6cdf;transition:width .3s}.px-r.ok .px-bar>div{background:#3a9a4a;width:100%}.px-r.err .px-bar>div{background:#c44;width:100%}" +
  "#px footer{padding:8px 10px;border-top:1px solid var(--border,#333);display:flex;gap:8px;align-items:center;color:#999;font-size:11px}#px footer span{flex:1}"));
ov = el("div", "dl-tab-pane",
  '<div id="px"><header><button id="px-sel">Use clips selected in Project panel</button><button id="px-dir">Choose a folder…</button>' +
  '<select id="px-h"><option value="540">540p (fastest)</option><option value="720">720p</option><option value="1080">1080p</option></select>' +
  '<label><input type="checkbox" id="px-att" checked> Attach in Premiere</label>' +
  '<div id="px-src">Pick footage: clips you selected in Premiere\'s Project panel, or a whole folder. Proxies go into a "Proxy" folder next to the footage.</div></header>' +
  '<div id="px-list"></div><footer><span id="px-st">NVIDIA GPU encoding (3 at a time), automatic CPU fallback.</span><button id="px-cancel" disabled>Cancel</button><button class="pri" id="px-go" disabled>Make proxies</button></footer></div>');
ov.id = "dl-tab-proxy";
$("px-h").value = LS.get("af_px_h", "540"); $("px-h").onchange = function(){ LS.set("af_px_h", this.value); };
$("px-att").checked = LS.get("af_px_att", "1") === "1"; $("px-att").onchange = function(){ LS.set("af_px_att", this.checked ? "1" : "0"); };
["keydown", "keyup", "contextmenu"].forEach(t => ov.addEventListener(t, e => e.stopPropagation()));
const st = m => { $("px-st").textContent = m; };

/* a "Proxies" tab next to "Playlist Downloader" */
function show(on){ document.querySelectorAll("#downloads-tabs .dl-tab-btn").forEach(b => b.classList.toggle("active", on ? b.id === "px-tab" : b.dataset.tab === "dl-tab-playlist"));
  document.querySelectorAll("#downloader-panel .dl-tab-pane").forEach(p => p.classList.toggle("active", on ? p.id === "dl-tab-proxy" : p.id === "dl-tab-playlist")); }
function addTab(){ const bar = $("downloads-tabs"), pl = $("dl-tab-playlist"); if (!bar || !pl) return false; if ($("px-tab")) return true;
  const b = el("button", "dl-tab-btn", "🎞 Proxies"); b.id = "px-tab"; b.dataset.tab = "dl-tab-proxy"; bar.appendChild(b); pl.parentNode.insertBefore(ov, pl.nextSibling);
  bar.addEventListener("click", e => { const t = e.target.closest && e.target.closest(".dl-tab-btn"); if (!t) return; e.stopPropagation(); e.preventDefault(); show(t.id === "px-tab"); }, true); return true; }
if (!addTab()) { let n = 0; const iv = setInterval(() => { if (addTab() || ++n > 100) clearInterval(iv); }, 300); }
const open = () => { const d = $("cat-downloader"); d && d.click(); setTimeout(() => show(true), 50); };

/* ---------- choose footage ---------- */
let files = [], run = null;
function setFiles(list, label){ files = list.filter(f => VIDEO.test(f) && !/[\\/]Proxy[\\/][^\\/]+$/i.test(f)); $("px-src").textContent = label + " — " + files.length + " video file(s)";
  const L = $("px-list"); L.innerHTML = ""; files.forEach((f, i) => { const r = el("div", "px-r", "<b>" + esc(path.basename(f)) + "</b><i id=\"px-i" + i + "\">" + (fs.existsSync(proxyOf(f)) ? "proxy exists — skip" : "waiting") + "</i><div class=\"px-bar\"><div id=\"px-b" + i + "\"></div></div>"); r.id = "px-r" + i; L.appendChild(r); });
  $("px-go").disabled = !files.length; if (!files.length) st("No video files found there."); else st("Ready: " + files.length + " file(s). Click Make proxies."); }
$("px-dir").onclick = () => afPickFolder("Choose the footage folder", LS.get("af_px_dir", ""), d => {
  if (!d) return; LS.set("af_px_dir", d); let list = []; try { list = fs.readdirSync(d).map(n => path.join(d, n)).filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }); } catch (e) {}
  setFiles(list, d); });
$("px-sel").onclick = async () => {
  const r = await evalJsx('(function(){try{var s=app.getCurrentProjectViewSelection();if(!s||!s.length)return "[]";var o=[];function add(it){try{if(it.type===2){for(var i=0;i<it.children.numItems;i++)add(it.children[i]);return;}var p=it.getMediaPath();if(p)o.push(p);}catch(e){}}for(var i=0;i<s.length;i++)add(s[i]);var q=[];for(var j=0;j<o.length;j++)q.push(\'"\'+String(o[j]).replace(/\\\\/g,"\\\\\\\\").replace(/"/g,\'\\\\"\')+\'"\');return "["+q.join(",")+"]";}catch(e){return "[]";}})()');
  let list = []; try { list = JSON.parse(r || "[]"); } catch (e) {}
  if (!Array.isArray(list)) return st("Couldn't read Premiere's selection" + (list && list.error ? ": " + list.error : "") + ". Try again, or pick the footage folder instead.");
  list = [...new Set(list.filter(p => typeof p === "string" && p))];
  if (!list.length) return st("Select clips (or bins) in Premiere's Project panel first, then click this again.");
  setFiles(list, "Selected in Project panel"); };

/* ---------- encode ---------- */
function proxyOf(f){ return path.join(path.dirname(f), "Proxy", path.basename(f).replace(/\.[^.]+$/, "") + ".mp4"); }
function probe(ff, f){ return new Promise(res => { cp.execFile(ff, ["-hide_banner", "-nostdin", "-i", f], { windowsHide: true, timeout: 30000, maxBuffer: 4 << 20 }, (e, so, se) => {
  const t = String(se || ""), d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(t), v = /Stream #[^\n]*Video:[^\n]*?([\d.]+) fps/.exec(t), tb = /Stream #[^\n]*Video:[^\n]*?([\d.]+k?) tbr/.exec(t);
  let fps = v ? +v[1] : 0; if (!fps && tb) fps = parseFloat(tb[1]) || 0;
  res({ dur: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, fps, hasAudio: /Stream #[^\n]*Audio:/.test(t), video: /Stream #[^\n]*Video:/.test(t) }); }); }); }
function rateArg(fps){ if (!fps) return null; const near = [[23.976, "24000/1001"], [29.97, "30000/1001"], [59.94, "60000/1001"], [47.952, "48000/1001"], [119.88, "120000/1001"]];
  for (const [r, s] of near) if (Math.abs(fps - r) < 0.01) return s; return String(Math.round(fps * 1000) / 1000); }
function encArgs(f, out, info, H, gpu){ const fr = rateArg(info.fps), g = Math.max(1, Math.round(info.fps || 30));
  const v = gpu ? ["-c:v", "h264_nvenc", "-preset", "p1", "-tune", "hq", "-rc", "constqp", "-qp", "28", "-bf", "0"] : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-bf", "0"];
  return ["-hide_banner", "-loglevel", "error", "-stats", "-nostdin", "-y", ...(gpu ? ["-hwaccel", "cuda"] : []), "-i", f, "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=-2:" + H + (gpu ? "" : ",format=yuv420p"),
    ...(fr ? ["-r", fr] : []), ...v, "-g", String(g), "-pix_fmt", "yuv420p", ...(info.hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []), "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", out]; }
function encode(ff, f, out, info, H, gpu, onP){ return new Promise(res => {
  const tmp = out.replace(/\.mp4$/, ".making.mp4"); try { fs.unlinkSync(tmp); } catch (e) {}
  const p = cp.spawn(ff, encArgs(f, tmp, info, H, gpu), { windowsHide: true }); let err = "", buf = "";
  run && run.procs.add(p);
  p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const m = /^out_time_(?:ms|us)=(\d+)/.exec(l); if (m && info.dur) onP(Math.min(1, +m[1] / 1e6 / info.dur)); } });
  p.stderr.on("data", d => { err += d; if (err.length > 6000) err = err.slice(-6000); });
  p.on("error", e => res({ ok: false, err: e.message }));
  p.on("close", code => { run && run.procs.delete(p); let ok = code === 0; try { ok = ok && fs.statSync(tmp).size > 1000; } catch (e) { ok = false; }
    if (ok) { try { try { fs.unlinkSync(out); } catch (e) {} fs.renameSync(tmp, out); } catch (e) { ok = false; err = e.message; } } else { try { fs.unlinkSync(tmp); } catch (e) {} }
    res({ ok, err: err.trim().split(/\r?\n/).slice(-3).join(" | "), gpuErr: /nvenc|cuda|CUDA|No NVENC|Cannot load nvcuda|hwaccel|OpenEncodeSessionEx|minimum required Nvidia driver/i.test(err) }); }); }); }

async function attach(pairs){ if (!pairs.length) return 0;
  const js = JSON.stringify(pairs.map(([a, b]) => [a.replace(/\//g, "\\").toLowerCase(), b]));
  const r = await evalJsx('(function(){var P=' + js + ',M={},n=0;for(var i=0;i<P.length;i++)M[P[i][0]]=P[i][1];' +
    'function walk(it){try{if(it.type===2){for(var i=0;i<it.children.numItems;i++)walk(it.children[i]);return;}var p=String(it.getMediaPath()||"").replace(/\\//g,"\\\\").toLowerCase();' +
    'if(M[p]){try{if(it.canProxy&&!it.canProxy())return;}catch(e){}try{it.attachProxy(M[p],0);n++;}catch(e){}}}catch(e){}}walk(app.project.rootItem);return String(n);})()');
  return +r || 0; }

$("px-cancel").onclick = () => { if (!run) return; run.cancel = true; run.procs.forEach(p => { try { p.kill(); } catch (e) {} }); st("Cancelling…"); };
$("px-go").onclick = async () => {
  if (run || !files.length) return; const ff = ffmpegPath(), H = +$("px-h").value || 540;
  run = { cancel: false, procs: new Set(), gpu: true }; $("px-go").disabled = true; $("px-cancel").disabled = false; $("px-sel").disabled = $("px-dir").disabled = true;
  let done = 0, made = 0, skipped = 0, failed = 0; const pairs = [], todo = files.map((f, i) => ({ f, i }));
  const mark = (i, cls, txt, pct) => { const r = $("px-r" + i); if (r) { r.classList.remove("ok", "err"); cls && r.classList.add(cls); } $("px-i" + i).textContent = txt; if (pct != null) $("px-b" + i).style.width = Math.round(pct * 100) + "%"; };
  const worker = async () => { while (todo.length && !run.cancel) { const { f, i } = todo.shift(), out = proxyOf(f);
      if (fs.existsSync(out)) { skipped++; pairs.push([f, out]); mark(i, "ok", "proxy exists — skipped"); continue; }
      try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch (e) {}
      mark(i, null, "reading…", 0); const info = await probe(ff, f);
      if (!info.video) { failed++; mark(i, "err", "no video stream — skipped"); continue; }
      const t0 = Date.now(); let res = await encode(ff, f, out, info, H, run.gpu, p => mark(i, null, (run.gpu ? "GPU " : "CPU ") + Math.round(p * 100) + "%", p));
      if (!res.ok && run.gpu && res.gpuErr && !run.cancel) { run.gpu = false; st("No usable NVIDIA encoder — switching to CPU encoding (slower).");
        res = await encode(ff, f, out, info, H, false, p => mark(i, null, "CPU " + Math.round(p * 100) + "%", p)); }
      if (res.ok) { made++; pairs.push([f, out]); mark(i, "ok", "done in " + Math.round((Date.now() - t0) / 1000) + "s"); }
      else if (run.cancel) mark(i, "err", "cancelled");
      else { failed++; mark(i, "err", "failed: " + (res.err || "ffmpeg error").slice(0, 120)); }
      done++; st("Made " + made + ", skipped " + skipped + ", failed " + failed + " — " + todo.length + " left"); } };
  st("Encoding… (" + (run.gpu ? "NVIDIA GPU" : "CPU") + ")");
  await Promise.all(Array.from({ length: run.gpu ? 3 : 2 }, worker));
  let att = 0; if ($("px-att").checked && pairs.length && !run.cancel) { st("Attaching proxies in Premiere…"); att = await attach(pairs); }
  st((run.cancel ? "Cancelled. " : "Done. ") + "Made " + made + ", skipped " + skipped + ", failed " + failed + ($("px-att").checked ? " · attached " + att + " in Premiere" + (att < pairs.length ? " (clips not in this project aren't attached)" : "") : ""));
  if (made && typeof showToast === "function") showToast("Proxies ready: " + made, "success");
  run = null; $("px-go").disabled = false; $("px-cancel").disabled = true; $("px-sel").disabled = $("px-dir").disabled = false; setTimeout(startAuto, 500); };
/* ---------- automatic proxies for downloaded videos ---------- */
let autoQ = [];
function startAuto(){ if (run || !autoQ.length) return; const list = [...new Set(autoQ)]; autoQ = []; setFiles(list, "New downloads"); if (files.length) $("px-go").click(); }
window._afAutoProxy = function(dir, since, log){
  try { if (LS.get("af_dl_proxy", "0") !== "1") return; const mp4 = document.getElementById("dl-toggle-mp4"); if (mp4 && !mp4.checked) return;
    const list = fs.readdirSync(dir).map(n => path.join(dir, n)).filter(p => { if (!VIDEO.test(p) || /\.f\d+\.\w+$|\.(merging|making|temp|part)\./i.test(p)) return false;
      try { const st = fs.statSync(p); return st.isFile() && st.mtimeMs >= since - 5000 && st.size > 100000 && !fs.existsSync(proxyOf(p)); } catch (e) { return false; } });
    if (!list.length) return; log && log("▣ Making proxies for " + list.length + " new video(s) — progress in Downloads → Proxies");
    let left = list.length; const good = [];
    list.forEach(f => (window._afVerifyVideo || ((x, y, cb) => cb(true)))(f, "", ok => { if (ok) good.push(f); else log && log("✗ " + path.basename(f) + " looks INCOMPLETE (the video stops before the end). Delete it and download that link again — no proxy made.");
      if (--left === 0 && good.length) { autoQ.push(...good); startAuto(); } })); } catch (e) { log && log("✗ Couldn't start proxies: " + e.message); } };
function addDlToggle(){ const mp4 = document.getElementById("dl-toggle-mp4"); if (!mp4) return false; if (document.getElementById("dl-toggle-proxy")) return true;
  const host = mp4.closest("label"); if (!host) return false;
  const lb = el("label", null, '<input type="checkbox" id="dl-toggle-proxy" style="accent-color:#2d6cdf;margin:0"><div><div style="font-size:10px;font-weight:600;color:var(--text)">Make proxies</div><div style="font-size:8px;color:var(--text3);margin-top:1px">540p proxy for each video, attached in Premiere</div></div>');
  lb.setAttribute("style", "display:flex;align-items:center;gap:7px;cursor:pointer;padding:6px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;flex:1;min-width:120px");
  host.parentNode.insertBefore(lb, host.nextSibling);
  const cb = lb.querySelector("input"); cb.checked = LS.get("af_dl_proxy", "0") === "1"; cb.onchange = () => LS.set("af_dl_proxy", cb.checked ? "1" : "0");
  const sync = () => { lb.style.opacity = mp4.checked ? "1" : ".45"; lb.title = mp4.checked ? "" : "Turn on Download as MP4 to get videos (and proxies)"; }; mp4.addEventListener("change", sync); sync(); return true; }
if (!addDlToggle()) { let n = 0; const iv = setInterval(() => { if (addDlToggle() || ++n > 100) clearInterval(iv); }, 300); }
window.AF_Proxy = { open };
})();
