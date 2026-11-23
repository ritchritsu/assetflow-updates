/* AssetFlow startup speed: the music tag filters used to read every song's .af.json analysis file one by one, synchronously,
   before the panel could draw (4 s of gray screen on big libraries, more on Google Drive / external drives).
   Now the library draws immediately, the analysis files are read in the background (24 at a time, no freezing),
   and the tag filters fill in when that's done. */
(function(){
"use strict";
let fs; try { fs = require("fs"); } catch (e) { return; }
const has = n => typeof window[n] === "function";
if (!has("_readAfSidecar") || !has("_renderAfMetaFilterWrap") || typeof _afMetaCache === "undefined") return;
const log = m => { try { window._afBootLog && _afBootLog(m); } catch (e) {} };

let running = false, again = false;
const tagged = () => (typeof allAssets !== "undefined" ? allAssets : []).filter(a => a && a.path && (a.category === "MUSIC" || a.category === "SFX"));
const coldCount = () => { let n = 0; for (const a of tagged()) if (!_afMetaCache.has(a.path)) n++; return n; };

function prefetch(){
  if (running) { again = true; return; }
  const todo = tagged().map(a => a.path).filter(p => !_afMetaCache.has(p)); if (!todo.length) return;
  running = true; window._afPrefetching = true; const t0 = Date.now(); let i = 0, active = 0, found = 0;
  const finish = () => { running = false; window._afPrefetching = false; log("tags read in background: " + todo.length + " files, " + found + " analyzed, " + (Date.now() - t0) + "ms");
    try { if (typeof _mlAnalyzedSet !== "undefined" && typeof _mlSave === "function") _mlSave(); } catch (e) {}
    if (again) { again = false; return prefetch(); }
    try { if (typeof _gfInvalidate === "function") _gfInvalidate(); renderGrid(true); } catch (e) {} };
  const pump = () => {
    while (active < 24 && i < todo.length) { const p = todo[i++]; active++;
      fs.readFile(p + ".af.json", "utf8", (err, txt) => { let v = null; if (!err) { try { v = JSON.parse(txt); } catch (e) {} }
        if (!_afMetaCache.has(p)) _afMetaCache.set(p, v);
        if (v) { found++; try { if (typeof _mlAnalyzedSet !== "undefined") _mlAnalyzedSet.add(p); if (typeof _mlAnalyzedCache !== "undefined" && _mlAnalyzedCache && !_mlAnalyzedCache[p]) _mlAnalyzedCache[p] = { t: Date.now() }; } catch (e) {} }
        active--; if (i >= todo.length && active === 0) finish(); else pump(); }); } };
  pump();
}

/* while the background read is running, never block on a single file: unknown = "not analyzed yet" for now */
const readOrig = window._readAfSidecar;
window._readAfSidecar = function(p){ if (!_afMetaCache.has(p) && (window._afPrefetching || (window._afColdCheck && window._afColdCheck()))) { prefetch(); return null; } return readOrig.apply(this, arguments); };

/* the tag filter panel: only build it when the analysis files are already in memory */
const wrapOrig = window._renderAfMetaFilterWrap; let coldT = 0, coldV = false;
window._afColdCheck = () => { const now = Date.now(); if (now - coldT > 500) { coldT = now; coldV = coldCount() > 40; } return coldV; };
window._renderAfMetaFilterWrap = function(list){
  if (window._afPrefetching || window._afColdCheck()) { coldT = 0; prefetch(); const s = document.getElementById("af-tags-sections"); if (s && !s.children.length) s.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:8px 0 4px;">Loading tags…</div>'; return; }
  return wrapOrig.apply(this, arguments); };

/* sort by date: file dates are looked up in the background (32 at a time) instead of freezing the panel; the list re-sorts when done */
let statting = false;
window._afStatSoon = function(list){ if (statting || !list.length) return; statting = true; const t0 = Date.now(); let i = 0, active = 0;
  const fin = () => { statting = false; log("file dates read in background: " + list.length + " files, " + (Date.now() - t0) + "ms"); try { if (typeof _gfInvalidate === "function") _gfInvalidate(); renderGrid(true); } catch (e) {} };
  const pump = () => { while (active < 32 && i < list.length) { const a = list[i++]; active++;
      fs.stat(a.path, (err, st) => { a.mtime = !err && st && st.mtimeMs ? st.mtimeMs : 1; active--; if (i >= list.length && active === 0) fin(); else pump(); }); } };
  pump(); };


/* ---- remembered between sessions: file dates and music tags. Reading 27,000 file dates and 24,000 tag files on every start
   took 30-50 s of disk work; now the remembered values are used instantly and only new or changed files are looked at. ---- */
const path = require("path"), os = require("os"), DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "AssetFlow");
const MF = path.join(DIR, "file_dates_cache.json"), TF = path.join(DIR, "tags_cache.json"), DAY = 86400000;
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
const MT = new Map(); let mtWhen = 0, mtDirty = false, tagWhen = 0;
try { const j = JSON.parse(fs.readFileSync(MF, "utf8")); mtWhen = j.t || 0; for (const k in j.m) MT.set(k, j.m[k]); } catch (e) {}
let TAGM = null;
try { const j = JSON.parse(fs.readFileSync(TF, "utf8")); tagWhen = j.t || 0; TAGM = j.m; for (const k in j.m) if (!_afMetaCache.has(k)) _afMetaCache.set(k, j.m[k]); log("tags from cache: " + Object.keys(j.m).length); } catch (e) {}
/* loading the library wipes the tag memory right after it was filled from the cache, so every start re-read all 24,000
   tag files (30-50 s of disk work). Put the remembered tags back after that first wipe; the folder re-check below still
   catches anything analyzed or removed since. A wipe you ask for (Refresh tags, Re-analyze) is never undone. */
/* every automatic wipe (library load, rescan) keeps what is already known; only a wipe you ask for (Refresh tags, Re-analyze,
   any click right before it) really empties it. After the first minute, "not analyzed" entries are dropped so new analyses show. */
let userAct = 0; ["click", "keydown"].forEach(ev => document.addEventListener(ev, () => { userAct = Date.now(); }, true));
{ const clear0 = _afMetaCache.clear.bind(_afMetaCache), t0 = Date.now(); let n = 0;
  _afMetaCache.clear = function(){ if (Date.now() - userAct < 3000) return clear0();
    const early = Date.now() - t0 < 60000, keep = []; _afMetaCache.forEach((v, k) => { if (v || early) keep.push([k, v]); }); clear0();
    if (early && TAGM) for (const k in TAGM) if (!_afMetaCache.has(k)) _afMetaCache.set(k, TAGM[k]);
    for (const [k, v] of keep) _afMetaCache.set(k, v); if (n++ < 3) log("tags kept through library reload: " + _afMetaCache.size); }; }
/* the panel asked for a full disk scan right after showing the library from its cache (two start-up calls): skip that
   duplicate - the background check already looks for changes. A rescan you ask for always runs. */
{ const scan0 = window.scanAssets; let hitAt = 0;
  if (typeof scan0 === "function") window.scanAssets = function(){ const had = _cacheLoaded;
    if (had && hitAt && Date.now() - hitAt < 20000 && Date.now() - userAct > 5000) { log("skipped duplicate start-up scan (library already loaded from cache)"); return; }
    const r = scan0.apply(this, arguments); if (!had && _cacheLoaded && !isScanning) hitAt = Date.now(); return r; }; }
const saveMT = full => { if (!mtDirty && !full) return; mtDirty = false; const o = {}; MT.forEach((v, k) => o[k] = v);
  fs.writeFile(MF + ".tmp", JSON.stringify({ t: full ? Date.now() : mtWhen, m: o }), e => { if (!e) fs.rename(MF + ".tmp", MF, () => {}); }); if (full) mtWhen = Date.now(); };
const saveTags = () => { const o = {}; let n = 0; for (const a of tagged()) if (_afMetaCache.has(a.path)) { o[a.path] = _afMetaCache.get(a.path); n++; }
  const txt = JSON.stringify({ t: Date.now(), m: o }); if (txt.length > 60e6) return;   /* never write a giant cache */
  fs.writeFile(TF + ".tmp", txt, e => { if (!e) fs.rename(TF + ".tmp", TF, () => {}); }); };
const statAll = (list, done) => { let i = 0, active = 0, changed = 0; if (!list.length) return done(0);
  const pump = () => { while (active < 32 && i < list.length) { const a = list[i++]; active++;
      fs.stat(a.path, (err, st) => { const m = !err && st && st.mtimeMs ? st.mtimeMs : 1; if (a.mtime !== m) changed++; a.mtime = m; if (MT.get(a.path) !== m) { MT.set(a.path, m); mtDirty = true; }
        active--; if (i >= list.length && active === 0) done(changed); else pump(); }); } };
  pump(); };
const redraw = () => { try { if (typeof _gfInvalidate === "function") _gfInvalidate(); renderGrid(true); } catch (e) {} };
let revalidated = false;
window._afStatSoon = function(list){ if (statting || !list.length) return;
  const miss = []; for (const a of list) { const m = MT.get(a.path); if (m) a.mtime = m; else miss.push(a); }   /* remembered dates: the sort is right immediately */
  const t0 = Date.now(); statting = true;
  statAll(miss, () => { statting = false; log("file dates: " + (list.length - miss.length) + " remembered, " + miss.length + " read in " + (Date.now() - t0) + "ms"); saveMT(false); if (miss.length) redraw();
    if (!revalidated && Date.now() - mtWhen > DAY) { revalidated = true; const all = (typeof allAssets !== "undefined" ? allAssets : []).filter(a => a && a.path), t1 = Date.now();   /* once a day: quietly re-check every date */
      setTimeout(() => statAll(all, ch => { saveMT(true); log("file dates re-checked: " + all.length + " files, " + ch + " changed, " + (Date.now() - t1) + "ms"); if (ch) redraw(); }), 3000); } }); };
/* tags: pick up songs analyzed (or un-analyzed) while the panel was closed - one folder listing per folder instead of opening every file */
function tagCheck(){ const list = tagged(); if (!list.length) return; const byDir = new Map(), t0 = Date.now();
  for (const a of list) { if (!_afMetaCache.has(a.path)) continue; const d = path.dirname(a.path); (byDir.get(d) || byDir.set(d, []).get(d)).push(a.path); }
  const dirs = [...byDir.keys()]; let i = 0, active = 0, changed = 0, pend = 0;
  const end = () => { log("tags re-checked: " + dirs.length + " folders, " + changed + " changed, " + (Date.now() - t0) + "ms"); if (changed) { saveTags(); redraw(); } };
  const pump = () => { while (active < 8 && i < dirs.length) { const d = dirs[i++]; active++;
      fs.readdir(d, (err, names) => { if (!err) { const N = new Set(names);
          for (const p of byDir.get(d)) { const has = N.has(path.basename(p) + ".af.json"), v = _afMetaCache.get(p);
            if (!has && v) { _afMetaCache.set(p, null); changed++; }
            else if (has && !v) { pend++; fs.readFile(p + ".af.json", "utf8", (e2, txt) => { let j = null; if (!e2) { try { j = JSON.parse(txt); } catch (x) {} } if (j) { _afMetaCache.set(p, j); changed++; try { _mlAnalyzedSet.add(p); } catch (x) {} } if (--pend === 0 && i >= dirs.length && active === 0) end(); }); } } }
        active--; if (i >= dirs.length && active === 0) { if (!pend) end(); } else pump(); }); } };
  pump(); }
const finishHook = setInterval(() => { if (!running && coldCount() === 0) { clearInterval(finishHook); saveTags(); } }, 5000);
setTimeout(tagCheck, tagWhen ? 4000 : 60000);
window.addEventListener("beforeunload", () => { try { const o = {}; MT.forEach((v, k) => o[k] = v); if (mtDirty) fs.writeFileSync(MF, JSON.stringify({ t: mtWhen, m: o })); } catch (e) {}
  try { const o = {}; for (const a of tagged()) if (_afMetaCache.has(a.path)) o[a.path] = _afMetaCache.get(a.path); const txt = JSON.stringify({ t: Date.now(), m: o }); if (txt.length < 60e6) fs.writeFileSync(TF, txt); } catch (e) {} });
})();
/* ---- library refresh after a cached start: the original walked every folder with synchronous disk calls, checking the
   clock only between folders, so one big folder (thousands of sounds) froze the panel for seconds right after opening.
   Same checks, same result, but every disk call is asynchronous: the panel never waits on the disk. ---- */
(function(){
"use strict";
let fs, path; try { fs = require("fs"); path = require("path"); } catch (e) { return; }
if (typeof window._backgroundRefreshCache !== "function") return;
const log = m => { try { window._afBootLog && _afBootLog(m); } catch (e) {} };
const P = (fn, ...a) => new Promise(res => fn(...a, (err, v) => res(err ? null : v)));
window._backgroundRefreshCache = function(prev){
  try { const roots = getLibraryRoots(); if (!roots.length) return;
    const old = new Map(prev.map(a => [a.path, a])), out = [], seen = new Set(), queue = roots.slice(), t0 = Date.now(); let changed = false, files = 0;
    const ex = (() => { if (!settings.excludeFolders) return null; const e = settings.excludeFolders.split(",").map(x => x.trim().toLowerCase()).filter(Boolean); return e.length ? new Set(e) : null; })();
    const run = async () => {
      while (queue.length) { if (isScanning) return; const dir = queue.shift(); const ents = await P(fs.readdir, dir, { withFileTypes: true }); if (!ents) continue;
        const fl = [];
        for (const d of ents) { if (!settings.scanHidden && d.name.startsWith(".")) continue; const full = path.join(dir, d.name);
          if (d.isDirectory()) { if (ex && ex.has(d.name.toLowerCase())) continue; queue.push(full); } else if (d.isFile()) fl.push([d, full]); }
        /* stat this folder's files 32 at a time, keep their order */
        const st = new Array(fl.length); let k = 0; await Promise.all(Array.from({ length: Math.min(32, fl.length) }, async () => { while (k < fl.length) { const q = k++; st[q] = await P(fs.stat, fl[q][1]); } }));
        if (isScanning) return;
        fl.forEach(([d, full], q) => { seen.add(full); const s = st[q]; if (!s) return; files++; const pa = old.get(full), mt = s.mtimeMs || 0, sz = s.size || 0;
          if (pa && pa.mtime === mt && pa.size === sz) { out.push(pa); return; }
          const ext = d.name.toLowerCase().endsWith(".prfpset.xml") ? ".prfpset.xml" : path.extname(d.name).toLowerCase(); if (!ext || ext === "." || SKIP_EXTS.has(ext)) return;
          const cat = getCategory(full, ext, 0); if (!cat) return;
          out.push({ name: path.basename(d.name, ext), filename: d.name, path: full, ext, category: cat, size: sz, mtime: mt, dir, _needsDurationRefine: EXT_MAP[ext] === "AUDIO", _estimatedDuration: 0 }); changed = true; });
      }
      if (isScanning) return;
      for (const [p] of old) if (!seen.has(p)) { changed = true; break; }
      log("library re-checked in background: " + files + " files, " + (changed || out.length !== prev.length ? "changes found" : "no changes") + ", " + (Date.now() - t0) + "ms");
      if (changed || out.length !== prev.length) { allAssets = out.filter(x => !!EXT_MAP[x.ext]); _saveAssetCache(allAssets, getLibraryRoots()); updateCounts(); renderGrid(true); _afPostRefresh(); setStatus(out.length + " assets (refreshed)", "ok"); }
      else setStatus(prev.length + " assets", "ok"); };
    setTimeout(() => { run().catch(e => console.warn("[AssetFlow] Background refresh error:", e && e.message)); }, 500);
  } catch (e) { console.warn("[AssetFlow] Background refresh error:", e.message); } };
})();

/* ---- music tag labels are worked out from each song's analysis once (they were rebuilt for every song on every redraw:
   ~200 ms of each grid refresh in your log) ---- */
(function(){
  const gt0 = window._getAfTags; if (typeof gt0 !== "function" || typeof window._readAfSidecar !== "function") return;
  const WM = new WeakMap();
  window._getAfTags = function(p){ const sc = window._readAfSidecar(p); if (!sc || typeof sc !== "object") return gt0.apply(this, arguments);
    let v = WM.get(sc); if (!v) { v = gt0.apply(this, arguments); WM.set(sc, v); } return v.slice(); };
})();
