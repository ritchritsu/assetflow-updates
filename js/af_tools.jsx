/* AssetFlow Tools: Premiere side. Loaded with $.evalFile by js/af_tools.js. ES3 only. */
var AFT_TPS = 254016000000;
function aft_json(v){
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(aft_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(aft_json(String(k)) + ":" + aft_json(v[k])); return "{" + o.join(",") + "}";
}
function aft_seq(){ return app.project.activeSequence; }
function aft_time(s){ var t = new Time(); t.seconds = s; return t; }
/* all selected track items: [{c, kind, t}] */
function aft_selected(seq){ var R = [], T, i, k;
  for (var g = 0; g < 2; g++) { T = g === 0 ? seq.videoTracks : seq.audioTracks;
    for (i = 0; i < T.numTracks; i++) { var cl = T[i].clips, n = cl.numItems; for (k = 0; k < n; k++) { var c = cl[k], on = false; try { on = c.isSelected(); } catch (e) {} if (on) R.push({ c: c, kind: g === 0 ? "V" : "A", t: i }); } } }
  return R; }
function aft_comp(c, name){ try { var C = c.components; for (var i = 0; i < C.numItems; i++) if (C[i].displayName === name) return C[i]; } catch (e) {} return null; }
function aft_param(comp, name){ if (!comp) return null; for (var j = 0; j < comp.properties.numItems; j++) if (comp.properties[j].displayName === name) return comp.properties[j]; return null; }
/* what's selected + the effects/settings of the first clip (for the "any effect" picker) */
function aft_selInfo(){
  var seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var S = aft_selected(seq), nv = 0, na = 0, fx = [];
  for (var i = 0; i < S.length; i++) { if (S[i].kind === "V") nv++; else na++; }
  if (S.length) { try { var C = S[0].c.components; for (var a = 0; a < C.numItems; a++) { var P = [], cp = C[a];
        for (var b = 0; b < cp.properties.numItems; b++) { var p = cp.properties[b], v = null; try { v = p.getValue(); } catch (e) {} if (typeof v === "number") P.push(p.displayName); }
        if (P.length) fx.push({ name: cp.displayName, params: P, kind: S[0].kind }); } } catch (e) {} }
  var W = 1920, H = 1080; try { W = seq.frameSizeHorizontal; H = seq.frameSizeVertical; } catch (e) {}
  return aft_json({ video: nv, audio: na, fx: fx, W: W, H: H });
}
/* set one value on every selected clip. js: {comp, param, value, kind: "V"|"A"|""} -> {done, skipped(keyframed), missing} */
function aft_batch(js){
  var J = eval("(" + js + ")"), seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var S = aft_selected(seq), done = 0, keyed = 0, missing = 0;
  for (var i = 0; i < S.length; i++) { if (J.kind && S[i].kind !== J.kind) continue;
    var p = aft_param(aft_comp(S[i].c, J.comp), J.param); if (!p) { missing++; continue; }
    var tv = false; try { tv = p.isTimeVarying(); } catch (e) {}
    if (tv) { if (!J.keys) { keyed++; continue; }
      try { var K = p.getKeys(); for (var q = 0; q < K.length; q++) p.setValueAtKey(K[q], J.value, q === K.length - 1); done++; } catch (e2) { keyed++; } continue; }
    try { p.setValue(J.value, true); done++; } catch (e3) { missing++; } }
  return aft_json({ done: done, keyed: keyed, missing: missing });
}
/* the picture size of a clip's media, from Premiere's own metadata ("1920 x 1080") */
function aft_size(pi){ try { var m = pi.getProjectMetadata(), r = /VideoInfo>\s*(\d+)\s*x\s*(\d+)/.exec(m); if (r) return [+r[1], +r[2]]; } catch (e) {} return null; }
/* scale every selected video clip to fit (whole picture visible) or fill (no black bars) the sequence frame, centred. js: {mode} */
function aft_fit(js){
  var J = eval("(" + js + ")"), seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var W = seq.frameSizeHorizontal, H = seq.frameSizeVertical, S = aft_selected(seq), done = 0, unknown = 0, keyed = 0;
  for (var i = 0; i < S.length; i++) { if (S[i].kind !== "V") continue; var c = S[i].c, sz = null; try { sz = aft_size(c.projectItem); } catch (e) {}
    if (!sz) { unknown++; continue; }
    var f = J.mode === "fill" ? Math.max(W / sz[0], H / sz[1]) : Math.min(W / sz[0], H / sz[1]), m = aft_comp(c, "Motion");
    var sc = aft_param(m, "Scale"), po = aft_param(m, "Position"), un = aft_param(m, "Uniform Scale");
    try { if ((sc && sc.isTimeVarying()) || (po && po.isTimeVarying())) { keyed++; continue; } } catch (e) {}
    try { if (un) un.setValue(true, true); } catch (e) {}
    try { sc.setValue(Math.round(f * 10000) / 100, true); if (po) po.setValue([0.5, 0.5], true); done++; } catch (e) { unknown++; } }
  return aft_json({ done: done, unknown: unknown, keyed: keyed });
}
/* ---------- project cleanup ---------- */
var AFT_KIND = { video: /\.(mp4|mov|mkv|avi|mxf|m4v|webm|ts|mts|flv|wmv)$/i, audio: /\.(wav|mp3|aac|m4a|flac|ogg|aif|aiff|wma)$/i, image: /\.(png|jpe?g|psd|tiff?|gif|bmp|webp|ai|eps|svg|exr)$/i };
function aft_kind(pi, p){ try { if (pi.isSequence()) return "sequence"; } catch (e) {} if (!p) return "graphic"; for (var k in AFT_KIND) if (AFT_KIND[k].test(p)) return k; return "other"; }
function aft_walk(item, binPath, fn){ for (var i = 0; i < item.children.numItems; i++) { var c = item.children[i];
    if (c.type === ProjectItemType.BIN) { aft_walk(c, binPath + "/" + c.name, fn); continue; } fn(c, binPath); } }
/* every item in the project, whether any sequence uses it */
function aft_projScan(){
  var used = {}, nseq = 0;
  try { var Q = app.project.sequences; nseq = Q.numSequences;
    for (var q = 0; q < nseq; q++) { var sq = Q[q]; used[sq.projectItem ? sq.projectItem.nodeId : ""] = used[sq.projectItem ? sq.projectItem.nodeId : ""] || 0;
      for (var g = 0; g < 2; g++) { var T = g === 0 ? sq.videoTracks : sq.audioTracks;
        for (var t = 0; t < T.numTracks; t++) { var cl = T[t].clips, n = cl.numItems; for (var k = 0; k < n; k++) { try { var id = cl[k].projectItem.nodeId; used[id] = (used[id] || 0) + 1; } catch (e) {} } } } } } catch (e) {}
  var R = [];
  aft_walk(app.project.rootItem, "", function (c, bp) { var p = ""; try { p = c.getMediaPath() || ""; } catch (e) {} var id = ""; try { id = c.nodeId; } catch (e) {}
    var off = false; try { off = c.isOffline(); } catch (e) {}
    R.push({ id: id, name: c.name, path: p, kind: aft_kind(c, p), uses: used[id] || 0, bin: bp, off: off }); });
  return aft_json({ items: R, sequences: nseq });
}
function aft_getBin(name){ var root = app.project.rootItem; for (var i = 0; i < root.children.numItems; i++) { var c = root.children[i]; if (c.type === ProjectItemType.BIN && c.name === name) return c; } return root.createBin(name); }
/* move items (by id) into a bin at the top of the project. js: {moves: [[id, binName], ...]} */
function aft_projMove(js){
  var J = eval("(" + js + ")"), want = {}, bins = {}, n = 0, i;
  for (i = 0; i < J.moves.length; i++) want[J.moves[i][0]] = J.moves[i][1];
  var list = []; aft_walk(app.project.rootItem, "", function (c) { var id = ""; try { id = c.nodeId; } catch (e) {} if (want.hasOwnProperty(id)) list.push([c, want[id]]); });
  for (i = 0; i < list.length; i++) { var b = list[i][1]; if (!bins[b]) bins[b] = aft_getBin(b); try { list[i][0].moveBin(bins[b]); n++; } catch (e) {} }
  return aft_json({ moved: n });
}
/* ---------- relink ---------- */
function aft_offline(){ var R = [];
  aft_walk(app.project.rootItem, "", function (c) { var off = false; try { off = c.isOffline(); } catch (e) {} if (!off) return; var p = ""; try { p = c.getMediaPath() || ""; } catch (e) {}
    var id = ""; try { id = c.nodeId; } catch (e) {} if (p) R.push({ id: id, name: c.name, path: p }); });
  return aft_json({ items: R }); }
/* js: {links: [[id, newPath], ...]} */
function aft_relink(js){
  var J = eval("(" + js + ")"), want = {}, ok = 0, bad = [], i;
  for (i = 0; i < J.links.length; i++) want[J.links[i][0]] = J.links[i][1];
  var list = []; aft_walk(app.project.rootItem, "", function (c) { var id = ""; try { id = c.nodeId; } catch (e) {} if (want.hasOwnProperty(id)) list.push(c); });
  for (i = 0; i < list.length; i++) { var c = list[i], np = want[c.nodeId], done = false;
    try { if (c.canChangeMediaPath && !c.canChangeMediaPath()) { bad.push(c.name); continue; } } catch (e) {}
    try { done = c.changeMediaPath(np, true); } catch (e) { done = false; }
    if (done !== false) ok++; else bad.push(c.name); }
  return aft_json({ relinked: ok, failed: bad });
}
/* ---------- multi-export ---------- */
function aft_seqName(){ var seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." }); var pp = ""; try { pp = app.project.path; } catch (e) {} return aft_json({ name: seq.name, project: pp }); }
/* queue the open sequence in Media Encoder once per preset. js: {presets:[{path, name}], out, range: 0 whole | 1 in-to-out, start} */
function aft_export(js){
  var J = eval("(" + js + ")"), seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  try { app.encoder.launchEncoder(); } catch (e) { return aft_json({ error: "Couldn't start Media Encoder: " + e }); }
  var Q = [], bad = [], safe = String(seq.name).replace(/[\\\/:*?"<>|]/g, "_");
  for (var i = 0; i < J.presets.length; i++) { var P = J.presets[i], ext = "mp4";
    try { ext = seq.getExportFileExtension(P.path) || ext; } catch (e) {}
    var f = J.out.replace(/[\\\/]+$/, "") + "/" + safe + " - " + String(P.name).replace(/[\\\/:*?"<>|]/g, "_") + "." + String(ext).replace(/^\./, "");
    try { var id = app.encoder.encodeSequence(seq, f, P.path, J.range ? 1 : 0, 1); Q.push(f); } catch (e) { bad.push(P.name + ": " + e); } }
  if (J.start && Q.length) { try { app.encoder.startBatch(); } catch (e) {} }
  return aft_json({ queued: Q, failed: bad });
}
/* ---------- captions ---------- */
function aft_capInfo(){ var seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var fps = 30; try { fps = Math.round(AFT_TPS / Number(seq.timebase) * 1000) / 1000; } catch (e) {}
  var pp = ""; try { pp = app.project.path; } catch (e) {}
  return aft_json({ name: seq.name, id: seq.sequenceID, project: pp, W: seq.frameSizeHorizontal, H: seq.frameSizeVertical, fps: fps, dur: seq.end / AFT_TPS }); }
function aft_capImport(p){ var root = app.project.rootItem, bin = null, i;
  for (i = 0; i < root.children.numItems; i++) { var c = root.children[i]; if (c.type === ProjectItemType.BIN && c.name === "AssetFlow Captions") bin = c; }
  if (!bin) bin = root.createBin("AssetFlow Captions");
  app.project.importFiles([p], true, bin, false); var want = String(p).replace(/\\/g, "/").toLowerCase();
  for (i = bin.children.numItems - 1; i >= 0; i--) { var b = bin.children[i], mp = ""; try { mp = String(b.getMediaPath()).replace(/\\/g, "/").toLowerCase(); } catch (e) {} if (mp === want) return b; }
  return null; }
/* js: {path, kind: "srt"|"video"} */
function aft_capPlace(js){
  var J = eval("(" + js + ")"), seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var pi = null; try { pi = aft_capImport(J.path); } catch (e) { return aft_json({ error: "Premiere couldn't import the captions: " + e }); }
  if (!pi) return aft_json({ error: "The captions file didn't import." });
  if (J.kind === "srt") { try { seq.createCaptionTrack(pi, 0); } catch (e) { return aft_json({ error: "Couldn't make the caption track: " + e }); } return aft_json({ ok: 1 }); }
  try { app.enableQE(); qe.project.getActiveSequence().addTracks(1, seq.videoTracks.numTracks, 0); } catch (e) {}
  var ti = seq.videoTracks.numTracks - 1, tr = seq.videoTracks[ti]; if (tr.clips.numItems) return aft_json({ error: "Please add an empty video track at the top, then try again." });
  try { tr.overwriteClip(pi, "0"); } catch (e) { try { tr.overwriteClip(pi, 0); } catch (e2) { return aft_json({ error: "Couldn't place the captions: " + e2 }); } }
  if (J.y) { var cl = tr.clips; if (cl.numItems) { var po = aft_param(aft_comp(cl[0], "Motion"), "Position"); try { if (po) po.setValue([0.5, J.y], true); } catch (e) {} } }   /* the strip sits at this height */
  return aft_json({ track: ti + 1 }); }
/* ---------- auto-fit music ---------- */
function aft_musicSel(){ var seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var S = aft_selected(seq), c = null, t = -1, i; for (i = 0; i < S.length; i++) if (S[i].kind === "A") { c = S[i].c; t = S[i].t; break; }
  if (!c) return aft_json({ error: "Select the music clip on the timeline first." });
  var p = ""; try { p = c.projectItem.getMediaPath(); } catch (e) {}
  var end = 0, g, k, q;   /* where the video ends: the last clip that isn't this music */
  for (g = 0; g < 2; g++) { var TT = g ? seq.audioTracks : seq.videoTracks; for (k = 0; k < TT.numTracks; k++) { var cc = TT[k].clips; for (q = 0; q < cc.numItems; q++) { var x = cc[q]; if (g && k === t && Math.abs(x.start.seconds - c.start.seconds) < 0.001) continue; if (x.end.seconds > end) end = x.end.seconds; } } }
  var io = null, oo = null; try { io = seq.getInPointAsTime().seconds; oo = seq.getOutPointAsTime().seconds; } catch (e) {}
  var ph = 0; try { ph = seq.getPlayerPosition().seconds; } catch (e) {}
  var nxt = null, cl = seq.audioTracks[t].clips; for (i = 0; i < cl.numItems; i++) { var s0 = cl[i].start.seconds; if (s0 > c.start.seconds + 0.01 && (nxt === null || s0 < nxt)) nxt = s0; }
  var fps = 30; try { fps = 1 / seq.getSettings().videoFrameRate.seconds; } catch (e) {}
  return aft_json({ track: t, s: c.start.seconds, e: c.end.seconds, "in": c.inPoint.seconds, out: c.outPoint.seconds, path: p, name: c.name, seqEnd: end, outPt: (oo && oo > 0 && oo < end - 0.01) ? oo : null, ph: ph, next: nxt, fps: fps }); }
/* js: {track, s, pieces: [[mediaIn, mediaOut], ...]} -> the clip plays piece 1, then the other pieces follow straight after */
function aft_musicApply(js){
  var J = eval("(" + js + ")"), seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var tr = seq.audioTracks[J.track], cl = tr.clips, c = null, i; for (i = 0; i < cl.numItems; i++) if (Math.abs(cl[i].start.seconds - J.s) < 0.01) { c = cl[i]; break; }
  if (!c) return aft_json({ error: "Couldn't find the music clip any more." });
  var pi = c.projectItem, P = J.pieces, t = J.s, lvl = null; try { var lp = aft_param(aft_comp(c, "Volume"), "Level"); if (lp && !lp.isTimeVarying()) lvl = lp.getValue(); } catch (e) {}
  /* clear room: everything of this clip after its start on this track up to the new end belongs to the music */
  var total = 0; for (i = 0; i < P.length; i++) total += P[i][1] - P[i][0];
  try { c.remove(false, false); } catch (e) { return aft_json({ error: "Couldn't change the clip: " + e }); }
  var placed = 0;
  for (i = 0; i < P.length; i++) {
    try { pi.setInPoint(P[i][0], 4); pi.setOutPoint(P[i][1], 4); } catch (e) {}
    try { tr.overwriteClip(pi, String(Math.round(t * AFT_TPS))); placed++; } catch (e) { try { tr.overwriteClip(pi, t); placed++; } catch (e2) {} }
    t += P[i][1] - P[i][0]; }
  try { pi.clearInPoint(4); pi.clearOutPoint(4); } catch (e) {}
  if (lvl !== null) { cl = tr.clips; for (i = 0; i < cl.numItems; i++) { var x = cl[i]; if (x.start.seconds > J.s - 0.01 && x.start.seconds < J.s + total - 0.01) { try { aft_param(aft_comp(x, "Volume"), "Level").setValue(lvl, true); } catch (e) {} } } }
  return aft_json({ placed: placed, end: J.s + total }); }
/* ---------- sound effects on cuts ---------- */
/* js: {mode: "scene" (cuts between different footage) | "all" | "sel" (starts of selected clips) | "markers", min: seconds between effects} -> {cuts:[t...]} */
function aft_cuts(js){ var J = eval("(" + js + ")"), seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var T = [], i, k;
  if (J.mode === "markers") { try { var m = seq.markers.getFirstMarker(); while (m) { T.push(m.start.seconds); m = seq.markers.getNextMarker(m); } } catch (e) {} }
  else if (J.mode === "sel") { var S = aft_selected(seq); for (i = 0; i < S.length; i++) if (S[i].kind === "V") T.push(S[i].c.start.seconds); }
  else { for (k = 0; k < seq.videoTracks.numTracks; k++) { var cl = seq.videoTracks[k].clips, n = cl.numItems, prev = null;
      for (i = 0; i < n; i++) { var c = cl[i], p = ""; try { p = c.projectItem.getMediaPath(); } catch (e) {}
        if (prev && Math.abs(prev.e - c.start.seconds) < 0.02 && (J.mode === "all" || p !== prev.p)) T.push(c.start.seconds);
        prev = { e: c.end.seconds, p: p }; } } }
  T.sort(function (a, b) { return a - b; }); var R = [], last = -1e9; for (i = 0; i < T.length; i++) if (T[i] - last >= (J.min || 0)) { R.push(T[i]); last = T[i]; }
  return aft_json({ cuts: R }); }
/* js: {items: [[file, timelineStart], ...], db} -> new audio track at the bottom with every effect on it */
function aft_sfxPlace(js){ var J = eval("(" + js + ")"), seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var root = app.project.rootItem, bin = null, i; for (i = 0; i < root.children.numItems; i++) { var c = root.children[i]; if (c.type === ProjectItemType.BIN && c.name === "AssetFlow SFX") bin = c; }
  if (!bin) bin = root.createBin("AssetFlow SFX");
  var want = {}, files = []; for (i = 0; i < J.items.length; i++) { var f = J.items[i][0]; if (!want[f]) { want[f] = 1; files.push(f); } }
  var have = {}; function scan(){ for (var q = 0; q < bin.children.numItems; q++) { var b = bin.children[q], mp = ""; try { mp = String(b.getMediaPath()).replace(/\\/g, "/").toLowerCase(); } catch (e) {} have[mp] = b; } }
  scan(); var need = []; for (i = 0; i < files.length; i++) if (!have[String(files[i]).replace(/\\/g, "/").toLowerCase()]) need.push(files[i]);
  if (need.length) { try { app.project.importFiles(need, true, bin, false); } catch (e) { return aft_json({ error: "Couldn't import the sound effects: " + e }); } scan(); }
  var n0 = seq.audioTracks.numTracks, ti = -1, tr = null;
  if (J.reuse && n0) {   /* keep adding to the bottom track if it only holds AssetFlow sounds */
    var bt = seq.audioTracks[n0 - 1], all = bt.clips.numItems > 0; for (i = 0; i < bt.clips.numItems && all; i++) { var mp2 = ""; try { mp2 = String(bt.clips[i].projectItem.getMediaPath()).replace(/\\/g, "/").toLowerCase(); } catch (e) {} if (!have[mp2]) all = false; }
    if (all) { ti = n0 - 1; tr = bt; } }
  if (!tr) { try { app.enableQE(); qe.project.getActiveSequence().addTracks(0, 0, 1, 1, n0); } catch (e) {}
    ti = seq.audioTracks.numTracks - 1; tr = seq.audioTracks[ti]; if (seq.audioTracks.numTracks === n0 || tr.clips.numItems) return aft_json({ error: "Couldn't add a new audio track. Add an empty audio track at the bottom and try again." }); }
  var ok = 0, gain = Math.pow(10, ((J.db || 0) - 15) / 20) * 1;
  for (i = 0; i < J.items.length; i++) { var pi = have[String(J.items[i][0]).replace(/\\/g, "/").toLowerCase()]; if (!pi) continue;
    try { tr.overwriteClip(pi, String(Math.round(Math.max(0, J.items[i][1]) * AFT_TPS))); ok++; } catch (e) {} }
  if (J.db) { var cl = tr.clips; for (i = 0; i < cl.numItems; i++) { var hit = false; for (var z = 0; z < J.items.length; z++) if (Math.abs(cl[i].start.seconds - Math.max(0, J.items[z][1])) < 0.02) hit = true; if (!hit) continue; try { aft_param(aft_comp(cl[i], "Volume"), "Level").setValue(Math.pow(10, J.db / 20) * 0.17782794, true); } catch (e) {} } }
  return aft_json({ placed: ok, track: ti + 1 }); }
/* ---------- un-nest: put a nested sequence's clips back on this timeline ---------- */
function aft_copyFx(from, to){ var n = 0, names = ["Motion", "Opacity", "Volume"];
  for (var q = 0; q < names.length; q++) { var A = aft_comp(from, names[q]), B = aft_comp(to, names[q]); if (!A || !B) continue;
    for (var j = 0; j < A.properties.numItems; j++) { var p = A.properties[j], t = aft_param(B, p.displayName); if (!t) continue;
      try { if (p.isTimeVarying()) continue; var v = p.getValue(); if (v === undefined || v === null) continue; t.setValue(v, true); n++; } catch (e) {} } }
  return n; }
function aft_findAt(tr, pi, s){ var cl = tr.clips; for (var i = 0; i < cl.numItems; i++) { var c = cl[i]; try { if (Math.abs(c.start.seconds - s) < 0.02 && c.projectItem && c.projectItem.nodeId === pi.nodeId) return c; } catch (e) {} } return null; }
function aft_unnest(){
  var seq = aft_seq(); if (!seq) return aft_json({ error: "Open a sequence in Premiere first." });
  var S = aft_selected(seq), N = null, i, k, g; for (i = 0; i < S.length; i++) { var pi = null; try { pi = S[i].c.projectItem; } catch (e) {} if (S[i].kind === "V" && pi && pi.isSequence()) { N = S[i]; break; } }
  if (!N) return aft_json({ error: "Select a nested sequence clip on the timeline first." });
  var c = N.c, npi = c.projectItem, inner = null; for (i = 0; i < app.project.sequences.numSequences; i++) { var q = app.project.sequences[i]; try { if (q.projectItem.nodeId === npi.nodeId) inner = q; } catch (e) {} }
  if (!inner) return aft_json({ error: "Couldn't find the nested sequence in the project." });
  var a0 = c.inPoint.seconds, a1 = c.outPoint.seconds, off = c.start.seconds - a0, vBase = N.t, aBase = 0, nestA = null;
  for (k = 0; k < seq.audioTracks.numTracks; k++) { var x = aft_findAt(seq.audioTracks[k], npi, c.start.seconds); if (x) { aBase = k; nestA = x; break; } }
  var sp = 1; try { sp = c.getSpeed(); } catch (e) {} if (Math.abs(sp - 1) > 0.001) return aft_json({ error: "The nested clip has a speed change; un-nesting would change its timing." });
  /* everything to place: [kind, parentTrack, projectItem, mediaIn, mediaOut, timelineStart, source clip] */
  var P = [], skipped = 0, lost = [];
  for (g = 0; g < 2; g++) { var T = g ? inner.audioTracks : inner.videoTracks;
    for (k = 0; k < T.numTracks; k++) { var cl = T[k].clips;
      for (i = 0; i < cl.numItems; i++) { var ic = cl[i], s = Math.max(ic.start.seconds, a0), e = Math.min(ic.end.seconds, a1); if (e - s < 0.001) continue;
        var isp = 1; try { isp = ic.getSpeed(); } catch (er) {} if (Math.abs(isp - 1) > 0.001) { skipped++; continue; }
        var ipi = null; try { ipi = ic.projectItem; } catch (er) {} if (!ipi) { if (!g) lost.push([k, s + off, e + off, ic.name]); skipped++; continue; }
        var mi = ic.inPoint.seconds + (s - ic.start.seconds); P.push([g ? "A" : "V", (g ? aBase : vBase) + k, ipi, mi, mi + (e - s), s + off, ic]); } } }
  var needV = 0, needA = 0; for (i = 0; i < P.length; i++) { if (P[i][0] === "V") needV = Math.max(needV, P[i][1] + 1); else needA = Math.max(needA, P[i][1] + 1); }
  if (needV > seq.videoTracks.numTracks || needA > seq.audioTracks.numTracks) { try { app.enableQE(); qe.project.getActiveSequence().addTracks(Math.max(0, needV - seq.videoTracks.numTracks), seq.videoTracks.numTracks, Math.max(0, needA - seq.audioTracks.numTracks), 1, seq.audioTracks.numTracks); } catch (er) {} }
  if (needV > seq.videoTracks.numTracks || needA > seq.audioTracks.numTracks) return aft_json({ error: "Needs " + needV + " video and " + needA + " audio tracks. Add tracks and try again." });
  try { c.remove(false, false); } catch (er) { return aft_json({ error: "Couldn't remove the nested clip: " + er }); } if (nestA) { try { nestA.remove(false, false); } catch (er) {} }
  var placed = 0, fx = 0, snap = {}, g2, q2;
  function akey(tk, c2){ var id = ""; try { id = c2.projectItem.nodeId; } catch (e) {} return tk + "|" + Math.round(c2.start.seconds * 1000) + "|" + id; }
  for (g2 = 0; g2 < seq.audioTracks.numTracks; g2++) { var ac = seq.audioTracks[g2].clips; for (q2 = 0; q2 < ac.numItems; q2++) snap[akey(g2, ac[q2])] = 1; }
  P.sort(function (x, y) { return x[0] === y[0] ? 0 : x[0] === "V" ? -1 : 1; });
  var audioStarted = false; P.push(["END"]);
  for (i = 0; i < P.length; i++) { var it = P[i];
    if (it[0] !== "V" && !audioStarted) { audioStarted = true;   /* Premiere may have brought each video clip's own audio along: remove that, the nest's real audio goes in next */
      for (g2 = 0; g2 < seq.audioTracks.numTracks; g2++) { var bc = seq.audioTracks[g2].clips; for (q2 = bc.numItems - 1; q2 >= 0; q2--) if (!snap[akey(g2, bc[q2])]) { try { bc[q2].remove(false, false); } catch (e) {} } } }
    if (it[0] === "END") break; var tr = (it[0] === "V" ? seq.videoTracks : seq.audioTracks)[it[1]];
    try { it[2].setInPoint(it[3], 4); it[2].setOutPoint(it[4], 4); } catch (er) {}
    try { tr.overwriteClip(it[2], String(Math.round(it[5] * AFT_TPS))); placed++; } catch (er) { if (it[0] === "V") lost.push([it[1] - vBase, it[5], it[5] + it[4] - it[3], it[6].name]); continue; }
    try { it[2].clearInPoint(4); it[2].clearOutPoint(4); } catch (er) {}
    var nc = aft_findAt(tr, it[2], it[5]); if (nc) fx += aft_copyFx(it[6], nc); }
  var kept = 0;
  if (lost.length) { try {
      var top = seq.videoTracks.numTracks; app.enableQE(); qe.project.getActiveSequence().addTracks(1, top, 0, 1, seq.audioTracks.numTracks);
      var lk = {}; for (i = 0; i < lost.length; i++) lk[lost[i][0]] = 1;
      for (k = 0; k < inner.videoTracks.numTracks; k++) if (!lk[k]) { try { inner.videoTracks[k].setMute(1); } catch (e) {} }   /* inside the nest only the graphics stay visible */
      for (k = 0; k < inner.audioTracks.numTracks; k++) { try { inner.audioTracks[k].setMute(1); } catch (e) {} }
      for (i = 0; i < lost.length; i++) { var L = lost[i]; npi.setInPoint(L[1] - off, 4); npi.setOutPoint(L[2] - off, 4);
        seq.videoTracks[top].overwriteClip(npi, String(Math.round(L[1] * AFT_TPS))); kept++; }
      try { npi.clearInPoint(4); npi.clearOutPoint(4); } catch (e) {}
      for (k = 0; k < seq.audioTracks.numTracks; k++) { var cc = seq.audioTracks[k].clips; for (q2 = cc.numItems - 1; q2 >= 0; q2--) { try { if (cc[q2].projectItem.nodeId === npi.nodeId) cc[q2].remove(false, false); } catch (e) {} } }
    } catch (er) {} }
  return aft_json({ placed: placed, skipped: skipped, fx: fx, total: P.length, graphics: lost.length, keptGraphics: kept }); }
"aft ok";
