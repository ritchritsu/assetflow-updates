/* AssetFlow downloader tune-up (video downloads):
   - every file name gets the video ID, so two videos with the same title can't overwrite or skip each other
     (before: "NA - title.mp4" for both, and the 2nd one was skipped as "already downloaded")
   - single videos don't get a "NA - " prefix
   - livestream recordings (HLS, thousands of small pieces): 3 pieces at a time instead of 8 (YouTube answered 8 with HTTP 500),
     and every piece retries until it arrives, waiting a little longer each time, instead of giving up
   - the "rate-limit sleep" pauses only kick in when they matter: a handful of single videos (up to 10) download back to back,
     big batches and real playlists keep the pauses (YouTube limits lots of requests in a row, not a few videos)
   yt-dlp uses the LAST value of an option, so these are simply added after AssetFlow's own options. */
(function(){
"use strict";
const VIDEO = ["-o", "%(playlist_index&{} - |)s%(title).150B [%(id)s].%(ext)s",
  "--concurrent-fragments", "3", "--retries", "15", "--fragment-retries", "infinite", "--extractor-retries", "3",
  "--retry-sleep", "http:exp=1:20", "--retry-sleep", "fragment:exp=1:20", "--file-access-retries", "10"];
/* progress for the panel: one machine-readable line every half second (the panel turns it into a bar and hides the line) */
const PROG = ["--newline", "--progress-delta", "0.5", "--progress-template",
  "download:[afprog] %(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.format_id)s"];
const NO_SLEEP = ["--sleep-requests", "0", "--sleep-interval", "0", "--max-sleep-interval", "0"];
function smallBatch(){   // only single-video links, and not many of them
  const t = (document.getElementById("dl-urls") || {}).value || "", U = t.split(/\s+/).filter(x => /^https?:\/\//i.test(x));
  const one = u => /^(https?:\/\/)?(www\.|m\.)?(youtu\.be\/|youtube\.com\/(watch|shorts|live)\b)/i.test(u) && !/[?&]list=/.test(u);
  return U.length > 0 && U.length <= 10 && U.every(one); }
function wrap(){ const orig = window._afYtPrep; if (typeof orig !== "function" || orig._afSpeed) return !!orig;
  const w = function(yt, log, cb){ return orig(yt, log, ex => { const mp4 = document.getElementById("dl-toggle-mp4"), sl = document.getElementById("dl-toggle-sleep");
      let add = PROG.slice(); if (mp4 && mp4.checked) add = add.concat(VIDEO);
      if ((!sl || sl.checked) && smallBatch()) { add = add.concat(NO_SLEEP); if (!w._said) { w._said = 1; try { log("⚡ Only a few single videos: skipping the rate-limit pauses"); } catch (e) {} } }
      cb((ex || []).concat(add)); }); };
  w._afSpeed = 1; window._afYtPrep = w; return true; }
/* ---------- the progress card: file name, bar, "1.2 GB of 3.4 GB · 8 MB/s · 2 min left" ---------- */
const fmtB = b => { if (!(b >= 0)) return "?"; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (i >= 3 ? b.toFixed(2) : i ? b.toFixed(1) : Math.round(b)) + " " + u[i]; };
const fmtT = s => { if (!(s >= 0)) return ""; s = Math.round(s); if (s < 60) return s + " s left"; if (s < 3600) return Math.round(s / 60) + " min left"; return Math.floor(s / 3600) + " h " + Math.round(s % 3600 / 60) + " min left"; };
const num = x => { const v = parseFloat(x); return isFinite(v) ? v : NaN; };
function card(){ let c = document.getElementById("afdl-card"); if (c) return c; const w = document.getElementById("dl-progress-wrap"); if (!w) return null;
  c = document.createElement("div"); c.id = "afdl-card"; c.style.cssText = "display:none;margin-top:10px;padding:10px 12px;background:var(--bg3,#222);border:1px solid var(--border,#333);border-radius:8px";
  c.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span id="afdl-name" style="font-size:10.5px;color:var(--text,#eee);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0"></span><span id="afdl-pct" style="font-family:var(--mono,monospace);font-size:10px;color:var(--accent,#0a84ff);flex:0 0 auto"></span></div>' +
    '<div style="height:6px;background:var(--bg5,#333);border-radius:3px;overflow:hidden;margin:7px 0 6px"><div id="afdl-bar" style="height:100%;width:0;background:linear-gradient(90deg,var(--accent2,#0a84ff),#30d158);border-radius:3px;transition:width .4s ease"></div></div>' +
    '<div style="display:flex;justify-content:space-between;gap:8px;font-family:var(--mono,monospace);font-size:9.5px;color:var(--text3,#999)"><span id="afdl-size"></span><span id="afdl-rate"></span></div>';
  w.parentNode.insertBefore(c, w.nextSibling); return c; }
let part = "", name = "";
function show(p){ const c = card(); if (!c) return; c.style.display = "";
  const [dl, tot, est0, sp, eta0, fi, fc] = p.split("|").map(num), frag = fc > 0;
  const est = est0 > 0 ? est0 : (frag && fi > 0 && dl > 0 ? dl * fc / fi : NaN), T = tot > 0 ? tot : est;   // livestream pieces: guess the total from the pieces so far
  const eta = eta0 >= 0 ? eta0 : (sp > 0 && T > dl ? (T - dl) / sp : NaN);
  const f = frag && !(T > 0) ? fi / fc : (T > 0 ? dl / T : 0), pct = Math.max(0, Math.min(1, f || 0));
  document.getElementById("afdl-name").textContent = (part ? part + " · " : "") + (name || "Downloading…");
  document.getElementById("afdl-pct").textContent = Math.round(pct * 100) + "%";
  document.getElementById("afdl-bar").style.width = (pct * 100).toFixed(1) + "%";
  document.getElementById("afdl-size").textContent = fmtB(dl) + " of " + (T > 0 ? (tot > 0 ? "" : "~") + fmtB(T) : "?") + (frag ? "  ·  piece " + (fi || 0) + "/" + fc : "");
  document.getElementById("afdl-rate").textContent = (sp > 0 ? fmtB(sp) + "/s" : "") + (eta >= 0 ? "  ·  " + fmtT(eta) : ""); }
function status(t){ const c = card(); if (!c) return; c.style.display = ""; document.getElementById("afdl-rate").textContent = t; }
function watchLog(){ const pre = document.getElementById("dl-log"); if (!pre || pre._afProg) return !!pre; pre._afProg = 1;
  new MutationObserver(() => { const t = pre.textContent; if (t.indexOf("[afprog]") < 0) { scan(t); return; }
    const L = t.match(/\[afprog\][^\n]*/g), keep = t.replace(/^.*\[afprog\].*\n?/gm, ""); scan(keep);   // file name first, then its progress
    if (L && L.length) show(L[L.length - 1].replace("[afprog]", "").trim()); pre.textContent = keep; pre.scrollTop = pre.scrollHeight; }).observe(pre, { childList: true, characterData: true, subtree: true });
  let seen = 0;
  function scan(t){ if (t.length < seen) seen = 0; const nw = t.slice(seen); seen = t.length; if (!nw) return;
    nw.split("\n").forEach(l => { let m;
      if ((m = /\[download\] Destination: (.+)/.exec(l))) { const b = m[1].split(/[\\/]/).pop(); part = /\.f\d+\.(m4a|webm|opus|mp3|aac)$/i.test(b) ? "Audio" : /\.f\d+\./.test(b) ? "Video" : ""; name = b.replace(/\.f\d+\.\w+$|\.\w+$/, "").replace(/ \[[\w-]{11}\]$/, ""); }
      else if (/\[Merger\]|\[ExtractAudio\]|\[VideoConvertor\]/.test(l)) status("Putting video and audio together…");
      else if (/Playlist \d+ done|Playlist \d+ failed|Cancelled|Download complete/i.test(l)) { const c = card(); if (c) c.style.display = "none"; part = name = ""; } }); }
  return true; }
{ let n = 0; const iv = setInterval(() => { if (watchLog() || ++n > 400) clearInterval(iv); }, 500); }
if (!wrap()) { let n = 0; const iv = setInterval(() => { if (wrap() || ++n > 200) clearInterval(iv); }, 250); }
})();
