/* AssetFlow Isolate voice: Premiere side. Loaded with $.evalFile by js/af_voice.js. ES3 only. */
var AFV_TPS = 254016000000;
function afv_json(v){
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(afv_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(afv_json(String(k)) + ":" + afv_json(v[k])); return "{" + o.join(",") + "}";
}
function afv_seq(){ return app.project.activeSequence; }
/* tracks + what's selected: {tracks:[{i,name,n,mute}], sel:[{t,s}]} */
function afv_info(){
  var seq = afv_seq(); if (!seq) return afv_json({ error: "Open a sequence in Premiere first." });
  var T = [], sel = [];
  for (var t = 0; t < seq.audioTracks.numTracks; t++) { var tr = seq.audioTracks[t], mu = false; try { mu = !!tr.isMuted(); } catch (e) {}
    T.push({ i: t, name: tr.name || ("A" + (t + 1)), n: tr.clips.numItems, mute: mu });
    for (var k = 0; k < tr.clips.numItems; k++) { var c = tr.clips[k], on = false; try { on = !!c.isSelected(); } catch (e) {} if (on) sel.push({ t: t, s: c.start.seconds }); } }
  return afv_json({ id: String(seq.sequenceID), tracks: T, sel: sel });
}
/* make sure `need` empty audio tracks exist (below everything); returns their indexes */
function afv_emptyTracks(need){
  var seq = afv_seq(); if (!seq) return afv_json({ error: "Open a sequence in Premiere first." });
  need = +need || 2;
  function empties(){ var E = []; for (var t = 0; t < seq.audioTracks.numTracks; t++) if (seq.audioTracks[t].clips.numItems === 0) E.push(t); return E; }
  var E = empties();
  if (E.length < need) {
    try { app.enableQE(); var q = qe.project.getActiveSequence(); q.addTracks(0, 0, need - E.length, 1, seq.audioTracks.numTracks, 0, 0); } catch (e) {}
    E = empties(); }
  if (E.length < need) return afv_json({ error: "Please add " + (need - E.length) + " empty audio track" + (need - E.length > 1 ? "s" : "") + " to the sequence (right-click a track > Add Tracks), then try again." });
  return afv_json({ tracks: E.slice(0, need) });
}
function afv_bin(name){
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) { var c = root.children[i]; if (c.type === ProjectItemType.BIN && c.name === name) return c; }
  return root.createBin(name);
}
function afv_findItem(bin, p){
  var want = String(p).replace(/\\/g, "/").toLowerCase();
  for (var i = 0; i < bin.children.numItems; i++) { var c = bin.children[i]; var mp = ""; try { mp = c.getMediaPath(); } catch (e) {}
    if (mp && String(mp).replace(/\\/g, "/").toLowerCase() === want) return c; }
  return null;
}
/* import the stem files into the "AssetFlow Voice" bin (skips ones already there) */
function afv_import(js){
  var J = eval("(" + js + ")"), bin = afv_bin("AssetFlow Voice"), need = [];
  for (var i = 0; i < J.paths.length; i++) if (!afv_findItem(bin, J.paths[i])) need.push(J.paths[i]);
  if (need.length) { try { app.project.importFiles(need, true, bin, false); } catch (e) { return afv_json({ error: "Premiere couldn't import the new audio: " + e }); } }
  var miss = 0; for (var j = 0; j < J.paths.length; j++) if (!afv_findItem(bin, J.paths[j])) miss++;
  return afv_json({ ok: true, missing: miss });
}
function afv_time(sec){ var tm = new Time(); tm.seconds = sec; return tm; }
/* put pieces of one stem file on a track. js: {path, track, clips:[{s, in, out}]} (s = timeline seconds, in/out = seconds inside the stem file) */
function afv_place(js){
  var J = eval("(" + js + ")"), seq = afv_seq(); if (!seq) return afv_json({ error: "Open a sequence in Premiere first." });
  var bin = afv_bin("AssetFlow Voice"), pi = afv_findItem(bin, J.path); if (!pi) return afv_json({ error: "The new audio file isn't in the project: " + J.path });
  var tr = seq.audioTracks[J.track]; if (!tr) return afv_json({ error: "Track " + (J.track + 1) + " is missing." });
  var done = 0, failed = 0, err = "";
  for (var i = 0; i < J.clips.length; i++) { var x = J.clips[i];
    try {
      pi.setInPoint(afv_time(x["in"]).ticks, 4); pi.setOutPoint(afv_time(x.out).ticks, 4);
      var ok = false; try { tr.overwriteClip(pi, afv_time(x.s).ticks); ok = true; } catch (e1) { try { tr.overwriteClip(pi, x.s); ok = true; } catch (e2) { err = String(e2); } }
      if (ok) done++; else failed++;
    } catch (e) { failed++; err = String(e); } }
  try { pi.clearInPoint(); pi.clearOutPoint(); } catch (e) {}
  return afv_json({ done: done, failed: failed, err: err });
}
function afv_mute(js){ var J = eval("(" + js + ")"), seq = afv_seq(); if (!seq) return "0"; var tr = seq.audioTracks[J.track]; try { tr.setMute(J.on ? 1 : 0); } catch (e) { return "0"; } return "1"; }
/* undo: remove what we placed (clips on the given tracks starting at the given times) */
function afv_remove(js){
  var J = eval("(" + js + ")"), seq = afv_seq(); if (!seq) return afv_json({ error: "Open a sequence in Premiere first." }); var n = 0, fr = 0.02;
  for (var a = 0; a < J.length; a++) { var tr = seq.audioTracks[J[a].track]; if (!tr) continue; var S = J[a].starts;
    for (var k = tr.clips.numItems - 1; k >= 0; k--) { var c = tr.clips[k], s = c.start.seconds;
      for (var q = 0; q < S.length; q++) if (Math.abs(S[q] - s) < fr) { try { c.remove(false, false); n++; } catch (e) {} break; } } }
  return afv_json({ removed: n });
}
/* find a project item by its file, anywhere in the project */
function afv_findPI(item, want){
  for (var i = 0; i < item.children.numItems; i++) { var c = item.children[i];
    if (c.type === ProjectItemType.BIN) { var r = afv_findPI(c, want); if (r) return r; continue; }
    var mp = ""; try { mp = c.getMediaPath(); } catch (e) {} if (mp && String(mp).replace(/\\/g, "/").toLowerCase() === want) return c; }
  return null;
}
function afv_clipAt(tr, s){ var fr = 0.02; for (var k = 0; k < tr.clips.numItems; k++) { var c = tr.clips[k]; if (Math.abs(c.start.seconds - s) < fr) return c; } return null; }
/* replace the audio of clips IN PLACE on their own track and link it back to the video clip above it, so it moves with the video.
   js: {path, track, clips:[{s, e, in, out}]} (in/out = seconds inside `path`). Returns {done, linked, failed, err} */
function afv_swap(js){
  var J = eval("(" + js + ")"), seq = afv_seq(); if (!seq) return afv_json({ error: "Open a sequence in Premiere first." });
  var pi = afv_findPI(app.project.rootItem, String(J.path).replace(/\\/g, "/").toLowerCase()); if (!pi) return afv_json({ error: "This file isn't in the project: " + J.path });
  var tr = seq.audioTracks[J.track]; if (!tr) return afv_json({ error: "Track " + (J.track + 1) + " is missing." });
  var canLink = typeof seq.linkSelection === "function", done = 0, linked = 0, failed = 0, err = "", fr = 0.02;
  for (var i = 0; i < J.clips.length; i++) { var x = J.clips[i];
    try { pi.setInPoint(afv_time(x["in"]).ticks, 4); pi.setOutPoint(afv_time(x.out).ticks, 4); tr.overwriteClip(pi, afv_time(x.s).ticks); done++; }
    catch (e) { failed++; err = String(e); continue; }
    if (!canLink) continue;
    try { var a = afv_clipAt(tr, x.s), v = null;
      for (var t = 0; t < seq.videoTracks.numTracks && !v; t++) { var vt = seq.videoTracks[t];
        for (var k = 0; k < vt.clips.numItems; k++) { var c = vt.clips[k]; if (Math.abs(c.start.seconds - x.s) < fr && Math.abs(c.end.seconds - x.e) < fr) { v = c; break; } } }
      if (a && v) { var S = seq.getSelection(); for (var q = 0; q < S.length; q++) S[q].setSelected(false, false);
        a.setSelected(true, false); v.setSelected(true, true); seq.linkSelection(); a.setSelected(false, false); v.setSelected(false, true); linked++; } } catch (e2) {} }
  try { pi.clearInPoint(); pi.clearOutPoint(); } catch (e) {}
  return afv_json({ done: done, linked: linked, failed: failed, err: err, canLink: canLink });
}
/* place pieces of one or two result files on new tracks and LINK each piece to the original clip and its video,
   so the new audio moves with the clip. js: {paths:[p0,p1?], tracks:[t0,t1?], src, link, clips:[{s,in,out,src?}]}
   Fast: every track is read ONCE into a start-time map (Premiere's clip lists are slow to walk). */
function afv_key(sec){ return String(Math.round(sec * 100)); }
function afv_map(tr){ var M = {}, cl = tr.clips, n = cl.numItems; for (var k = 0; k < n; k++) { var c = cl[k]; M[afv_key(c.start.seconds)] = c; } return M; }
/* new clip at time s on a track: binary search in a fresh list (clips are sorted by start) */
function afv_find(tr, s){ var cl = tr.clips, lo = 0, hi = cl.numItems - 1, fr = 0.02;
  while (lo <= hi) { var m = (lo + hi) >> 1, c = cl[m], t = c.start.seconds; if (Math.abs(t - s) < fr) return c; if (t < s) lo = m + 1; else hi = m - 1; }
  return null; }
var AFV_CACHE = null;
function afv_placeLinked(js){
  var J = eval("(" + js + ")"), seq = afv_seq(); if (!seq) return afv_json({ error: "Open a sequence in Premiere first." });
  var PI = [], TR = [], k, q;
  for (k = 0; k < J.paths.length; k++) {
    var want = String(J.paths[k]).replace(/\\/g, "/").toLowerCase(), p = (AFV_CACHE && AFV_CACHE.pi[want]) || afv_findPI(app.project.rootItem, want);
    if (!p) return afv_json({ error: "The new audio file isn't in the project: " + J.paths[k] }); PI.push(p);
    var t = seq.audioTracks[J.tracks[k]]; if (!t) return afv_json({ error: "Track " + (J.tracks[k] + 1) + " is missing." }); TR.push(t); }
  var canLink = !!J.link && typeof seq.linkSelection === "function";
  /* maps of the ORIGINAL clips (video tracks + source audio tracks); kept between calls of the same run */
  if (canLink && (!AFV_CACHE || AFV_CACHE.run !== J.run)) {
    var V = {}; for (var vt = seq.videoTracks.numTracks - 1; vt >= 0; vt--) { var mv = afv_map(seq.videoTracks[vt]); for (var kk in mv) V[kk] = mv[kk]; }
    AFV_CACHE = { run: J.run, V: V, A: {}, pi: {} }; }
  if (AFV_CACHE) for (k = 0; k < PI.length; k++) AFV_CACHE.pi[String(J.paths[k]).replace(/\\/g, "/").toLowerCase()] = PI[k];
  if (canLink) { var S0 = seq.getSelection(); for (q = 0; q < S0.length; q++) S0[q].setSelected(false, false); }
  var done = 0, failed = 0, linked = 0, err = "", lastIn = [], lastOut = [];
  for (var i = 0; i < J.clips.length; i++) { var x = J.clips[i], ok = true;
    for (k = 0; k < PI.length; k++) {
      try { if (lastIn[k] !== x["in"]) { PI[k].setInPoint(afv_time(x["in"]).ticks, 4); lastIn[k] = x["in"]; }
        if (lastOut[k] !== x.out) { PI[k].setOutPoint(afv_time(x.out).ticks, 4); lastOut[k] = x.out; }
        TR[k].overwriteClip(PI[k], afv_time(x.s).ticks); }
      catch (e) { ok = false; err = String(e); } }
    if (ok) done++; else { failed++; continue; }
    if (!canLink) continue;
    try { var L = [], key = afv_key(x.s), st = (x.src >= 0) ? x.src : J.src;
      for (k = 0; k < TR.length; k++) { var a = afv_find(TR[k], x.s); if (a) L.push(a); }
      if (st >= 0) { if (!AFV_CACHE.A[st]) AFV_CACHE.A[st] = afv_map(seq.audioTracks[st]); var o = AFV_CACHE.A[st][key]; if (o) L.push(o); }
      var v = AFV_CACHE.V[key]; if (v) L.push(v);
      if (L.length > TR.length) { for (q = 0; q < L.length; q++) L[q].setSelected(true, false);
        seq.linkSelection(); for (q = 0; q < L.length; q++) L[q].setSelected(false, false); linked++; } } catch (e2) {} }
  for (k = 0; k < PI.length; k++) { try { PI[k].clearInPoint(); PI[k].clearOutPoint(); } catch (e) {} }
  return afv_json({ done: done, failed: failed, linked: linked, err: err, canLink: canLink });
}
/* link every video clip with the audio clips that start (and end) at the same spot: one link group per clip */
function afv_linkAll(){
  var seq = afv_seq(); if (!seq) return afv_json({ error: "Open a sequence in Premiere first." });
  if (typeof seq.linkSelection !== "function") return afv_json({ error: "This version of Premiere can't link clips from a panel." });
  var A = [], t, k, q;
  for (t = 0; t < seq.audioTracks.numTracks; t++) { var cl = seq.audioTracks[t].clips, n = cl.numItems;
    for (k = 0; k < n; k++) { var c = cl[k]; A.push({ c: c, s: c.start.seconds, e: c.end.seconds }); } }
  var M = {}; for (k = 0; k < A.length; k++) { var key = afv_key(A[k].s); (M[key] = M[key] || []).push(A[k]); }
  var S0 = seq.getSelection(); for (q = 0; q < S0.length; q++) S0[q].setSelected(false, false);
  var linked = 0, alone = 0, already = 0;
  for (t = 0; t < seq.videoTracks.numTracks; t++) { var vl = seq.videoTracks[t].clips, vn = vl.numItems;
    for (k = 0; k < vn; k++) { var v = vl[k], s = v.start.seconds, e = v.end.seconds, G = M[afv_key(s)], L = [];
      if (G) for (q = 0; q < G.length; q++) if (Math.abs(G[q].e - e) < 0.05 && !G[q].used) { L.push(G[q]); }
      if (!L.length) { alone++; continue; }
      var lk = false; try { if (typeof v.getLinkedItems === "function") { var li = v.getLinkedItems(); lk = li && li.numItems > L.length; } } catch (e0) {}
      if (lk) { already++; for (q = 0; q < L.length; q++) L[q].used = true; continue; }
      try { v.setSelected(true, false); for (q = 0; q < L.length; q++) { L[q].c.setSelected(true, false); L[q].used = true; }
        seq.linkSelection(); linked++; } catch (e1) {}
      try { v.setSelected(false, false); for (q = 0; q < L.length; q++) L[q].c.setSelected(false, false); } catch (e2) {} } }
  return afv_json({ linked: linked, alone: alone, already: already });
}
"afv ok";
