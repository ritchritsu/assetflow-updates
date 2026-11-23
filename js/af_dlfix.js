/* AssetFlow downloader safety net: finish merges that were interrupted (crash, hang, closed Premiere).
   yt-dlp downloads video and audio as "name.f399.mp4" + "name.f140.m4a" and then merges them. If that merge is cut off,
   a retry tries to "resume" the finished parts and YouTube answers HTTP 416. Here we merge such leftover pairs with ffmpeg ourselves. */
(function(){
"use strict";
window._afMergeLeft = function(dir, ffLoc, log, done){
  let fs, path, cp; try { fs = require("fs"); path = require("path"); cp = require("child_process"); } catch (e) { return done(0); }
  let names = []; try { names = fs.readdirSync(dir); } catch (e) { return done(0); }
  const groups = {};
  names.forEach(n => { const m = /^(.*)\.f(\d+)\.(mp4|webm|mkv|m4a|opus|mp3|aac)$/i.exec(n); if (!m) return;
    if (/\.(merging|temp)\./i.test(n)) return; (groups[m[1]] = groups[m[1]] || []).push({ n, ext: m[3].toLowerCase(), size: (() => { try { return fs.statSync(path.join(dir, n)).size; } catch (e) { return 0; } })() }); });
  const jobs = Object.keys(groups).filter(b => groups[b].length >= 2).map(b => {
    const G = groups[b].sort((x, y) => y.size - x.size), vid = G.find(f => /mp4|webm|mkv/.test(f.ext)) || G[0], aud = G.find(f => f !== vid && /m4a|opus|mp3|aac|webm/.test(f.ext));
    return aud && vid.size > 0 && aud.size > 0 ? { b, vid, aud } : null; }).filter(Boolean);
  if (!jobs.length) return done(0);
  let ff = "ffmpeg"; try { if (ffLoc) { const c = /\.exe$/i.test(ffLoc) ? ffLoc : path.join(ffLoc, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"); if (fs.existsSync(c)) ff = c; } } catch (e) {}
  let ok = 0, i = 0;
  const next = () => {
    if (i >= jobs.length) return done(ok);
    const J = jobs[i++], ext = J.vid.ext === "webm" && /webm|opus/.test(J.aud.ext) ? "webm" : (J.vid.ext === "mp4" && J.aud.ext === "m4a" ? "mp4" : "mkv");
    const out = path.join(dir, J.b + "." + ext), tmp = path.join(dir, J.b + ".merging." + ext);
    try { if (fs.existsSync(out) && fs.statSync(out).size >= 0.97 * (J.vid.size + J.aud.size)) {   // already merged earlier: only the parts are left over
        [J.vid, J.aud].forEach(f => { try { fs.unlinkSync(path.join(dir, f.n)); } catch (e) {} }); ok++; return next(); } } catch (e) {}
    log("⟳ Finishing an interrupted merge: " + J.b + "." + ext + " (" + (((J.vid.size + J.aud.size) / 1073741824).toFixed(1)) + " GB — can take a few minutes)…");
    try { fs.unlinkSync(tmp); } catch (e) {}
    const p = cp.spawn(ff, ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(dir, J.vid.n), "-i", path.join(dir, J.aud.n), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", tmp], { windowsHide: true });
    let err = ""; p.stderr.on("data", d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    p.on("error", e => { log("✗ Could not run ffmpeg to finish the merge: " + e.message); next(); });
    p.on("close", code => {
      let good = false; try { good = code === 0 && fs.statSync(tmp).size >= 0.97 * (J.vid.size + J.aud.size); } catch (e) {}
      if (good) { try { try { fs.unlinkSync(out); } catch (e) {} fs.renameSync(tmp, out); [J.vid, J.aud].forEach(f => { try { fs.unlinkSync(path.join(dir, f.n)); } catch (e) {} }); ok++; log("✓ Merged " + path.basename(out)); }
        catch (e) { log("✗ Merged but could not rename: " + e.message); } }
      else { try { fs.unlinkSync(tmp); } catch (e) {} log("✗ Merge failed for " + J.b + (err ? ": " + err.trim().split(/\r?\n/).pop() : "") + " — the downloaded parts were kept"); }
      next(); });
  };
  next();
};

/* Does the video track really run to the end? (decode one frame from the last 5 seconds of the video stream) */
window._afVerifyVideo = function(file, ffLoc, cb){
  let fs, path, cp; try { fs = require("fs"); path = require("path"); cp = require("child_process"); } catch (e) { return cb(true); }
  let ff = "ffmpeg"; try { const c = ffLoc ? (/\.exe$/i.test(ffLoc) ? ffLoc : path.join(ffLoc, "ffmpeg.exe")) : path.join(cs_ext(), "ffmpeg.exe"); if (fs.existsSync(c)) ff = c; } catch (e) {}
  cp.execFile(ff, ["-hide_banner", "-nostdin", "-v", "error", "-sseof", "-5", "-i", file, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-", "-progress", "pipe:1"], { windowsHide: true, timeout: 120000, maxBuffer: 1 << 20 },
    (e, so) => { const m = /frame=(\d+)/.exec(String(so || "")); cb(!!(m && +m[1] >= 1)); }); };
function cs_ext(){ try { return new CSInterface().getSystemPath("extension"); } catch (e) { return ""; } }
})();
/* remember the downloader toggles (MP4, Import to bin, Rate-limit sleep) between reloads */
(function(){ const K = { "dl-toggle-mp4": "af_dl_mp4", "dl-toggle-bin": "af_dl_bin", "dl-toggle-sleep": "af_dl_sleep" }; let n = 0;
  const iv = setInterval(() => { let all = true;
    Object.keys(K).forEach(id => { const el = document.getElementById(id); if (!el) { all = false; return; } if (el._afRemember) return; el._afRemember = 1;
      let v = null; try { v = localStorage.getItem(K[id]); } catch (e) {}
      if (v != null && el.checked !== (v === "1")) { el.checked = v === "1"; try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} }
      el.addEventListener("change", () => { try { localStorage.setItem(K[id], el.checked ? "1" : "0"); } catch (e) {} }); });
    if (all || ++n > 100) clearInterval(iv); }, 300); })();
