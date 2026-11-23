/* AssetFlow speed-ups for scrolling and saving (loaded after the main scripts; replaces three slow helpers in place):
   1. Thumbnail lookups: every card used to check up to 8 possible "cover image" files one by one, synchronously, while
      you scrolled (slow on big libraries, network and external drives). Now each folder is listed once (refreshed
      every minute) and cards look their cover up in that list.
   2. MOGRT previews: the whole .mogrt (up to 80 MB) was read and scanned byte by byte, and EVERY video in it unpacked,
      for each card that scrolled into view (the "MOGRTs" page froze). Now only the zip's index and the one preview file
      are read, and the result is remembered.
   3. Library cache: saved with a blocking write (up to ~0.8 s freeze after a library change). Now written in the
      background to a temp file and swapped in (a crash mid-save can no longer leave a broken cache), coalesced so
      back-to-back saves only write once. */
(function(){
"use strict";
let fs, path, zlib; try { fs = require("fs"); path = require("path"); zlib = require("zlib"); } catch (e) { return; }
const blog = m => { try { window._afBootLog && _afBootLog(m); } catch (e) {} };

/* ---------- 1. folder listings for thumbnail lookups ---------- */
const DIRS = new Map(), DIR_TTL = 60000, DIR_MAX = 400;
window._afHas = function(p){
  const d = path.dirname(p), now = Date.now(); let L = DIRS.get(d);
  if (!L || now - L.t > DIR_TTL) {
    try { L = { t: now, s: new Set(fs.readdirSync(d).map(n => n.toLowerCase())) }; }
    catch (e) { try { return fs.existsSync(p); } catch (e2) { return false; } }
    DIRS.delete(d); DIRS.set(d, L); if (DIRS.size > DIR_MAX) DIRS.delete(DIRS.keys().next().value); }
  return L.s.has(path.basename(p).toLowerCase()); };
window._afHasForget = d => { if (d) DIRS.delete(d); else DIRS.clear(); };

/* ---------- 2. MOGRT previews from the zip index ---------- */
const MG = new Map(); let mgBytes = 0; const MG_MAX = 120 * 1048576, MG_N = 60;
function zipIndex(fd, size){
  const tl = Math.min(size, 65557), tail = Buffer.alloc(tl); fs.readSync(fd, tail, 0, tl, size - tl);
  let i = tl - 22; while (i >= 0 && tail.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return null;
  const cdSize = tail.readUInt32LE(i + 12), cdOff = tail.readUInt32LE(i + 16);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || cdOff + cdSize > size) return null;   // zip64 / odd file: use the old reader
  const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
  const E = []; let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    E.push({ m: cd.readUInt16LE(p + 10), cs: cd.readUInt32LE(p + 20), us: cd.readUInt32LE(p + 24), off: cd.readUInt32LE(p + 42), name: cd.slice(p + 46, p + 46 + nl).toString("utf8") });
    p += 46 + nl + xl + cl; }
  return E; }
function readEntry(fd, e){
  const h = Buffer.alloc(30); fs.readSync(fd, h, 0, 30, e.off); if (h.readUInt32LE(0) !== 0x04034b50) return null;
  const raw = Buffer.alloc(e.cs); fs.readSync(fd, raw, 0, e.cs, e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28));
  if (e.m === 0) return raw; if (e.m === 8) { try { return zlib.inflateRawSync(raw); } catch (x) { return null; } } return null; }
function fastMogrt(a){
  let fd = -1;
  try { const st = fs.statSync(a.path); fd = fs.openSync(a.path, "r"); const E = zipIndex(fd, st.size); if (!E) return undefined;
    const pick = re => E.filter(e => re.test(e.name) && e.cs > 0 && e.cs < 64 * 1048576).sort((x, y) => y.us - x.us);
    for (const e of pick(/\.(mp4|m4v)$/i)) { const d = readEntry(fd, e); if (d && d.length > 1000) return { type: "video", data: d, mime: "video/mp4" }; }
    for (const e of pick(/\.(png|jpe?g)$/i)) { const d = readEntry(fd, e); if (d && d.length > 500) return { type: "image", data: d, mime: d[0] === 137 && d[1] === 80 ? "image/png" : "image/jpeg" }; }
    return null; }
  catch (e) { return undefined; } finally { if (fd >= 0) try { fs.closeSync(fd); } catch (e) {} } }
if (typeof window._extractMogrtPreviewMedia === "function") {
  const old = window._extractMogrtPreviewMedia;
  window._extractMogrtPreviewMedia = function(a){
    if (!a || !a.path) return old.apply(this, arguments);
    let k = a.path; try { const st = fs.statSync(a.path); k += "|" + st.size + "|" + st.mtimeMs; } catch (e) {}
    if (MG.has(k)) { const v = MG.get(k); MG.delete(k); MG.set(k, v); return v; }
    let r = fastMogrt(a); if (r === undefined) r = old.apply(this, arguments);
    MG.set(k, r); mgBytes += r && r.data ? r.data.length : 0;
    while (MG.size > MG_N || mgBytes > MG_MAX) { const [k0, v0] = MG.entries().next().value; MG.delete(k0); mgBytes -= v0 && v0.data ? v0.data.length : 0; }
    return r; }; }

/* ---------- 3. library cache saved in the background ---------- */
if (typeof window._saveAssetCache === "function" && typeof window._getCachePath === "function") {
  let writing = false, next = null;
  const pack = (e, t) => JSON.stringify({ version: 1, scanRoots: t, savedAt: Date.now(), assets: e.map(e => ({ name: e.name, filename: e.filename, path: e.path, ext: e.ext, category: e.category, size: e.size || 0, mtime: e.mtime || 0, dir: e.dir, _needsDurationRefine: e._needsDurationRefine || !1, _estimatedDuration: e._estimatedDuration || 0 })) });
  function flush(){
    if (writing || !next) return; const { f, j } = next; next = null; writing = true;
    const tmp = f + "." + process.pid + "." + Date.now() + ".tmp", t0 = Date.now();
    fs.writeFile(tmp, j, "utf8", er => {
      const done = () => { writing = false; if (Date.now() - t0 > 2000) blog("library cache saved in " + (Date.now() - t0) + "ms (background)"); flush(); };
      if (er) { console.warn("[AssetFlow] Cache save failed:", er.message); try { fs.unlinkSync(tmp); } catch (x) {} return done(); }
      fs.rename(tmp, f, er2 => { if (er2) { try { fs.writeFileSync(f, j, "utf8"); } catch (x) { console.warn("[AssetFlow] Cache save failed:", x.message); } try { fs.unlinkSync(tmp); } catch (x) {} } done(); }); }); }
  window._saveAssetCache = function(e, t){
    const f = _getCachePath(); if (!f || !Array.isArray(e)) return;
    try { next = { f, j: pack(e, t) }; } catch (x) { console.warn("[AssetFlow] Cache save failed:", x.message); return; }
    flush(); };
  /* closing the panel mid-save: finish the newest one synchronously so the next start-up has it */
  window.addEventListener("beforeunload", () => { if (next) { try { fs.writeFileSync(next.f, next.j, "utf8"); } catch (e) {} next = null; } });
}
})();
