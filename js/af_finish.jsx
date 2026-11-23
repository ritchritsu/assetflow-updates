/* AssetFlow Quality check: Premiere side. Loaded with $.evalFile by js/af_finish.js. ES3 only (checked by tools/es3lint.js). */
var AFX_TPS = 254016000000;
function afx_json(v){
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(afx_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(afx_json(String(k)) + ":" + afx_json(v[k])); return "{" + o.join(",") + "}";
}
function afx_valToDb(v){ return v > 0 ? 20 * Math.log(v) / Math.LN10 + 15 : -200; }   // clip Volume "Level": 0 dB = 0.1778
function afx_level(c){
  try { var C = c.components;
    for (var i = 0; i < C.numItems; i++) { var cp = C[i]; if (cp.displayName !== "Volume") continue;
      for (var j = 0; j < cp.properties.numItems; j++) { var p = cp.properties[j]; if (p.displayName === "Level") return p; } } } catch (e) {}
  return null;
}
/* everything the check needs, in one pass. levels=true also reads each audio clip's gain (slower on huge sequences) */
function afx_seqInfo(levels){
  var seq = app.project.activeSequence; if (!seq) return afx_json({ error: "Open a sequence in Premiere first." });
  levels = levels === true || levels === "true" || levels === "1";
  var fps = 30; try { fps = 1 / seq.getSettings().videoFrameRate.seconds; } catch (e) {}
  var end = 0; try { end = parseFloat(seq.end) / AFX_TPS; } catch (e) {}
  var media = {}, off = {};
  function info(c, k, audio){
    var o = { k: k, name: c.name, s: c.start.seconds, e: c.end.seconds, "in": c.inPoint.seconds, out: c.outPoint.seconds, path: "", off: false, dis: false };
    var pi = null; try { pi = c.projectItem; } catch (e) {}
    if (pi) { var id = ""; try { id = pi.nodeId; } catch (e) {}
      if (id && media.hasOwnProperty(id)) { o.path = media[id]; o.off = off[id]; }
      else { try { o.path = pi.getMediaPath() || ""; } catch (e) {} try { o.off = !!pi.isOffline(); } catch (e) {} if (id) { media[id] = o.path; off[id] = o.off; } } }
    try { o.dis = !!c.disabled; } catch (e) {}
    var td = o.e - o.s, md = o.out - o["in"]; o.spd = td > 0 ? md / td : 1;
    if (audio && levels) { var p = afx_level(c); o.lvl = null; o.tv = false;
      if (p) { try { o.tv = !!p.isTimeVarying(); } catch (e) {} if (!o.tv) { try { o.lvl = Math.round(afx_valToDb(p.getValue()) * 100) / 100; } catch (e) {} } } }
    return o; }
  function grab(tracks, audio){ var T = [];
    for (var i = 0; i < tracks.numTracks; i++) { var tr = tracks[i], L = [], mu = false; try { mu = !!tr.isMuted(); } catch (e) {}
      for (var k = 0; k < tr.clips.numItems; k++) L.push(info(tr.clips[k], k, audio));
      T.push({ i: i, name: tr.name || ((audio ? "A" : "V") + (i + 1)), mute: mu, clips: L }); }
    return T; }
  return afx_json({ name: seq.name, id: String(seq.sequenceID), fps: fps, end: end, v: grab(seq.videoTracks, false), a: grab(seq.audioTracks, true) });
}
/* fast path: Premiere writes the whole sequence as XML in one native call (reading 1000s of clips one by one is very slow) */
function afx_exportXml(p){ var seq = app.project.activeSequence; if (!seq) return "no sequence";
  try { var f = new File(p); if (f.exists) f.remove(); seq.exportAsFinalCutProXML(p, 1); var fps = 0; try { fps = 1 / seq.getSettings().videoFrameRate.seconds; } catch (e) {} return new File(p).exists ? "1|" + String(seq.sequenceID) + "|" + fps + "|" + seq.name : "0"; } catch (e) { return "0 " + e; } }
/* cheap "did the timeline change?" fingerprint: clip counts per track + sequence length + first/last clip edges */
function afx_sig(){
  var seq = app.project.activeSequence; if (!seq) return "none"; var s = String(seq.sequenceID) + "|" + seq.end;
  function add(tracks){ for (var i = 0; i < tracks.numTracks; i++) { var n = tracks[i].clips.numItems; s += "|" + n;
      if (n) { try { s += ":" + tracks[i].clips[0].start.ticks + ":" + tracks[i].clips[n - 1].end.ticks; } catch (e) {} } } }
  add(seq.videoTracks); add(seq.audioTracks); return s;
}
/* jump to a time and select the clips that cover [a,b] (so Delete / Shift+Delete works right away). js: {a,b,sel:[["V"|"A",track,clip],...]} */
function afx_go(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return "0";
  try { seq.setPlayerPosition(String(Math.round(J.a * AFX_TPS))); } catch (e) {}
  if (J.sel && J.sel.length) {
    try { var S = seq.getSelection(); for (var i = 0; i < S.length; i++) S[i].setSelected(false, false); } catch (e) {}
    for (var j = 0; j < J.sel.length; j++) { var x = J.sel[j], tr = (x[0] === "V" ? seq.videoTracks : seq.audioTracks)[x[1]]; if (!tr) continue;
      try { var cl = tr.clips, n = cl.numItems, c = (x[2] < n) ? cl[x[2]] : null;
        /* the clip's start time decides (positions shift after cuts): binary search when the remembered position is stale */
        if (x.length > 3 && (!c || Math.abs(c.start.seconds - x[3]) > 0.02)) { c = null; var lo = 0, hi = n - 1;
          while (lo <= hi) { var m = (lo + hi) >> 1, cm = cl[m], t = cm.start.seconds; if (Math.abs(t - x[3]) <= 0.02) { c = cm; break; } if (t < x[3]) lo = m + 1; else hi = m - 1; } }
        if (c) c.setSelected(true, j === J.sel.length - 1); } catch (e) {} } }
  return "1";
}
/* light read after an edit: just where every clip sits (no XML export, so no "saving" pause).
   returns {end, v:[[s,e,in,out,...],...], a:[...]} flat numbers per track */
function afx_light(){
  var seq = app.project.activeSequence; if (!seq) return afx_json({ error: "no sequence" });
  function grab(tracks){ var T = []; for (var i = 0; i < tracks.numTracks; i++) { var cl = tracks[i].clips, n = cl.numItems, L = [];
      for (var k = 0; k < n; k++) { var c = cl[k]; L.push(Math.round(c.start.seconds * 1000) / 1000, Math.round(c.end.seconds * 1000) / 1000, Math.round(c.inPoint.seconds * 1000) / 1000, Math.round(c.outPoint.seconds * 1000) / 1000); }
      T.push(L); } return T; }
  var end = 0; try { end = parseFloat(seq.end) / AFX_TPS; } catch (e) {}
  return afx_json({ id: String(seq.sequenceID), end: end, v: grab(seq.videoTracks), a: grab(seq.audioTracks) });
}
/* close every gap where NOTHING plays on any track (keeps everything in sync). js: {min: seconds, lead: also the gap at the start, dry: just count}
   returns {gaps, secs, moved, undo:[[kind, track, newStart, shiftBack],...]} */
function afx_closeGaps(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afx_json({ error: "Open a sequence in Premiere first." });
  var fps = 30; try { fps = 1 / seq.getSettings().videoFrameRate.seconds; } catch (e) {}
  var fr = 1 / fps, min = Math.max(fr * 0.5, +J.min || fr * 0.5), all = [], t, k;
  function grab(tracks, kind){ for (t = 0; t < tracks.numTracks; t++) { var cl = tracks[t].clips, n = cl.numItems; for (k = 0; k < n; k++) { var c = cl[k]; all.push({ c: c, kind: kind, t: t, s: c.start.seconds, e: c.end.seconds }); } } }
  grab(seq.videoTracks, "V"); grab(seq.audioTracks, "A");
  if (!all.length) return afx_json({ gaps: 0, secs: 0, moved: 0 });
  all.sort(function (x, y) { return x.s - y.s; });
  var gaps = [], end = J.lead ? 0 : all[0].s;
  for (var i = 0; i < all.length; i++) { var x = all[i]; if (x.s - end >= min) gaps.push([end, x.s]); if (x.e > end) end = x.e; }
  var secs = 0; for (i = 0; i < gaps.length; i++) secs += gaps[i][1] - gaps[i][0];
  if (J.dry || !gaps.length) return afx_json({ gaps: gaps.length, secs: secs, moved: 0 });
  var moved = 0, undo = [], g = 0, shift = 0;
  for (i = 0; i < all.length; i++) { var y = all[i];
    while (g < gaps.length && gaps[g][1] <= y.s + 1e-6) { shift += gaps[g][1] - gaps[g][0]; g++; }
    if (shift <= 1e-6) continue;
    var d = Math.round(shift * fps) / fps, tm = new Time(); tm.seconds = -d;
    try { y.c.move(tm); moved++; undo.push([y.kind, y.t, y.s - d, d]); } catch (e) {} }
  return afx_json({ gaps: gaps.length, secs: secs, moved: moved, undo: undo });
}
/* put clips back where they were before Close all gaps (latest-first so nothing collides). js: [[kind, track, start, shiftBack],...] */
function afx_undoGaps(js){
  var U = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afx_json({ error: "Open a sequence in Premiere first." }); var n = 0;
  for (var i = U.length - 1; i >= 0; i--) { var u = U[i], tr = (u[0] === "V" ? seq.videoTracks : seq.audioTracks)[u[1]]; if (!tr) continue;
    var cl = tr.clips, m = cl.numItems;
    for (var k = 0; k < m; k++) { var c = cl[k]; if (Math.abs(c.start.seconds - u[2]) < 0.01) { var tm = new Time(); tm.seconds = u[3]; try { c.move(tm); n++; } catch (e) {} break; } } }
  return afx_json({ restored: n });
}
/* move / re-trim clips to a new layout in one go (used by "Room to breathe" and its undo).
   js: [[kind, track, curStart, S, E, In, Out], ...]  -> {done, off: clips that didn't land exactly}
   Everything that changes is first parked far to the right (so nothing collides), then put down in order. */
function afx_layout(js){
  var L = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afx_json({ error: "Open a sequence in Premiere first." });
  var fps = 30; try { fps = 1 / seq.getSettings().videoFrameRate.seconds; } catch (e) {}
  var end = 0; try { end = parseFloat(seq.end) / AFX_TPS; } catch (e) {}
  function T(s){ var t = new Time(); t.seconds = s; return t; }
  function findAt(tr, s){ var cl = tr.clips, lo = 0, hi = cl.numItems - 1; while (lo <= hi) { var m = (lo + hi) >> 1, c = cl[m], t = c.start.seconds; if (Math.abs(t - s) <= 0.01) return c; if (t < s) lo = m + 1; else hi = m - 1; }
    for (var k = 0; k < cl.numItems; k++) if (Math.abs(cl[k].start.seconds - s) <= 0.01) return cl[k]; return null; }
  var W = [], i, miss = 0;
  for (i = 0; i < L.length; i++) { var x = L[i], tr = (x[0] === "V" ? seq.videoTracks : seq.audioTracks)[x[1]], c = tr ? findAt(tr, x[2]) : null; if (c) W.push({ c: c, x: x }); else miss++; }
  var park = Math.ceil(end + 600);
  W.sort(function (a, b) { return b.x[2] - a.x[2]; });
  for (i = 0; i < W.length; i++) { try { W[i].c.move(T(park)); } catch (e) {} }
  W.sort(function (a, b) { return a.x[3] - b.x[3]; });
  var done = 0, off = 0;
  for (i = 0; i < W.length; i++) { var c2 = W[i].c, y = W[i].x;
    try { if (Math.abs(c2.inPoint.seconds - y[5]) > 0.0005) c2.inPoint = T(y[5]); } catch (e) {}
    try { if (Math.abs(c2.outPoint.seconds - y[6]) > 0.0005) c2.outPoint = T(y[6]); } catch (e) {}
    try { c2.move(T(y[3] - c2.start.seconds)); } catch (e) {}
    try { if (Math.abs(c2.end.seconds - y[4]) > 0.5 / fps) c2.end = T(y[4]); } catch (e) {}
    var ok = false; try { ok = Math.abs(c2.start.seconds - y[3]) < 0.6 / fps && Math.abs(c2.end.seconds - y[4]) < 0.6 / fps; } catch (e) {}
    if (ok) done++; else off++; }
  return afx_json({ done: done, off: off, missing: miss });
}
/* audio fades (transitions) on one audio track. js: {track, all: true | at: [cut times in seconds], dry}
   -> {total, removed, times:[...] (dry: where they are)} */
function afx_fades(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afx_json({ error: "Open a sequence in Premiere first." });
  try { app.enableQE(); } catch (e) {}
  var qs = null; try { qs = qe.project.getActiveSequence(); } catch (e) {} if (!qs) return afx_json({ error: "Premiere's editing helper isn't available." });
  var tr = null; try { tr = qs.getAudioTrackAt(J.track); } catch (e) {} if (!tr) return afx_json({ error: "No audio track " + (J.track + 1) + "." });
  var n = 0; try { n = tr.numTransitions; } catch (e) {}
  var L = [], i; for (i = 0; i < n; i++) { var x = null; try { x = tr.getTransitionAt(i); } catch (e) {} if (!x) continue;
    var a = NaN, b = NaN; try { a = parseFloat(x.start.secs); b = parseFloat(x.end.secs); } catch (e) {} L.push({ x: x, m: (a + b) / 2 }); }
  if (J.dry) { var T = []; for (i = 0; i < L.length; i++) T.push(Math.round(L[i].m * 1000) / 1000); return afx_json({ total: n, removed: 0, times: T }); }
  var want = {}; if (!J.all) for (i = 0; i < J.at.length; i++) want[Math.round(J.at[i] * 10)] = 1;
  function hit(m){ if (J.all) return true; if (!isFinite(m)) return false; var k = Math.round(m * 10); return !!(want[k] || want[k - 1] || want[k + 1]); }
  var rm = 0; for (i = L.length - 1; i >= 0; i--) { if (!hit(L[i].m)) continue; try { L[i].x.remove(); rm++; } catch (e) {} }
  return afx_json({ total: n, removed: rm });
}
/* Room to breathe: import the new sequence (Premiere XML written by the panel) next to the one it came from, give it its name and open it.
   js: {path, name} -> {id, name, oos: linked clips out of sync, dupes} */
function afx_findParentBin(nodeId, bin){
  bin = bin || app.project.rootItem;
  for (var i = 0; i < bin.children.numItems; i++) { var c = bin.children[i];
    if (c.nodeId === nodeId) return bin;
    if (c.type === 2) { var r = afx_findParentBin(nodeId, c); if (r) return r; } }
  return null;
}
function afx_syncCheck(seq){ if (!seq) return 0; var fd = 1 / 30, bad = 0; try { fd = seq.getSettings().videoFrameRate.seconds || fd; } catch (e) {}
  for (var i = 0; i < seq.videoTracks.numTracks; i++) { var T = seq.videoTracks[i];
    for (var k = 0; k < T.clips.numItems; k++) { var c = T.clips[k], L = null; try { L = c.getLinkedItems(); } catch (e) {} if (!L) continue;
      for (var j = 0; j < L.numItems; j++) { var a = L[j]; if (!a || a.mediaType !== "Audio") continue;
        if (Math.abs(a.start.seconds - c.start.seconds) > fd * 1.5 || Math.abs(a.inPoint.seconds - c.inPoint.seconds) > fd * 1.5) { bad++; break; } } } }
  return bad; }
function afx_importVersion(js){
  var J = eval("(" + js + ")"), cur = app.project.activeSequence, target = app.project.rootItem, i;
  var base0 = 0; try { base0 = afx_syncCheck(cur); } catch (e) {}
  try { var pb = cur && cur.projectItem ? afx_findParentBin(cur.projectItem.nodeId) : null; if (pb) target = pb; } catch (e) {}
  var before = {}; for (i = 0; i < app.project.sequences.numSequences; i++) before[app.project.sequences[i].sequenceID] = 1;
  var kids = {}; for (i = 0; i < target.children.numItems; i++) kids[target.children[i].nodeId] = 1;
  /* proxies: an XML import makes fresh copies of the footage without them, so remember each file's proxy and attach it again */
  var proxies = {}; try { var seen = {};
    for (var g = 0; g < 2; g++) { var trs = g ? cur.audioTracks : cur.videoTracks;
      for (var ti = 0; ti < trs.numTracks; ti++) for (var ci = 0; ci < trs[ti].clips.numItems; ci++) { var pi = trs[ti].clips[ci].projectItem; if (!pi || seen[pi.nodeId]) continue; seen[pi.nodeId] = 1;
        try { if (pi.hasProxy()) { var pp = pi.getProxyPath(); if (pp) proxies[pi.getMediaPath()] = pp; } } catch (e) {} } } } catch (e) {}
  try { app.project.importFiles([J.path], true, target, false); } catch (e) { return afx_json({ error: "Premiere couldn't import the new sequence: " + e }); }
  var made = null; for (i = 0; i < app.project.sequences.numSequences; i++) { var s = app.project.sequences[i]; if (!before[s.sequenceID]) made = s; }
  if (!made) return afx_json({ error: "Premiere read the new sequence but didn't add it to the project. Save the project and try again." });
  try { made.name = J.name; } catch (e) {}
  try { made.projectItem.moveBin(target); } catch (e) {}
  /* tidy up: bins the import created are emptied into the target bin, loose copies of the footage go into one "AssetFlow media" bin */
  try { for (i = target.children.numItems - 1; i >= 0; i--) { var c = target.children[i];
      if (kids[c.nodeId] || c.type !== 2) continue;
      for (var k = c.children.numItems - 1; k >= 0; k--) { var m = c.children[k]; try { if (m.type !== 2) m.moveBin(target); } catch (e2) {} }
      if (c.children.numItems === 0) try { c.deleteBin(); } catch (e3) {} } } catch (e) {}
  var dupes = 0; try { var loose = [];
    for (i = 0; i < target.children.numItems; i++) { var c4 = target.children[i]; if (kids[c4.nodeId] || c4.type === 2) continue; if (c4.nodeId === made.projectItem.nodeId) continue; loose.push(c4); }
    dupes = loose.length;
    if (loose.length) { var mb = null; for (i = 0; i < target.children.numItems; i++) { var c5 = target.children[i]; if (c5.type === 2 && c5.name === "AssetFlow media") { mb = c5; break; } }
      if (!mb) { target.createBin("AssetFlow media"); for (i = 0; i < target.children.numItems; i++) { var c6 = target.children[i]; if (c6.type === 2 && c6.name === "AssetFlow media") { mb = c6; break; } } }
      if (mb) for (i = 0; i < loose.length; i++) { try { loose[i].moveBin(mb); } catch (e7) {} } } } catch (e) {}
  try { var done = {};
    for (var g2 = 0; g2 < 2; g2++) { var trs2 = g2 ? made.audioTracks : made.videoTracks;
      for (var t2 = 0; t2 < trs2.numTracks; t2++) for (var c2 = 0; c2 < trs2[t2].clips.numItems; c2++) { var pj = trs2[t2].clips[c2].projectItem; if (!pj || done[pj.nodeId]) continue; done[pj.nodeId] = 1;
        try { var mp2 = pj.getMediaPath(); if (proxies[mp2] && !pj.hasProxy()) pj.attachProxy(proxies[mp2], 0); } catch (e8) {} } } } catch (e) {}
  try { app.project.openSequence(made.sequenceID); } catch (e) {} try { app.project.activeSequence = made; } catch (e) {}
  var oos = 0; try { oos = Math.max(0, afx_syncCheck(made) - base0); } catch (e) {}
  return afx_json({ id: String(made.sequenceID), name: made.name, oos: oos, dupes: dupes });
}
/* open a sequence by its id (Room to breathe: "Back to original") */
function afx_openSeq(id){
  id = String(id); for (var i = 0; i < app.project.sequences.numSequences; i++) { var s = app.project.sequences[i];
    if (String(s.sequenceID) === id) { try { app.project.openSequence(s.sequenceID); } catch (e) {} try { app.project.activeSequence = s; } catch (e) {} return "1"; } }
  return "0";
}
"afx ok";
