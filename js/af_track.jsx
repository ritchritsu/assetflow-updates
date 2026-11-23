/* AssetFlow Track: Premiere side. Loaded with $.evalFile by js/af_track.js. ES3 only. */
var AFK_TPS = 254016000000;
function afk_json(v){
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(afk_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(afk_json(String(k)) + ":" + afk_json(v[k])); return "{" + o.join(",") + "}";
}
function afk_time(sec){ var t = new Time(); t.seconds = sec; return t; }
function afk_motion(c){ try { var C = c.components; for (var i = 0; i < C.numItems; i++) { var m = C[i]; if (m.displayName === "Motion" || m.matchName === "AE.ADBE Motion") return m; } } catch (e) {} return null; }
function afk_prop(m, names){ for (var j = 0; j < m.properties.numItems; j++) { var p = m.properties[j]; for (var q = 0; q < names.length; q++) if (p.displayName === names[q]) return p; } return null; }
function afk_val(p){ try { return p.getValue(); } catch (e) { return null; } }
function afk_find(tr, s){ var cl = tr.clips, n = cl.numItems; for (var k = 0; k < n; k++) { var c = cl[k]; if (Math.abs(c.start.seconds - s) < 0.02) return c; } return null; }
function afk_info(c, kind, ti){
  var o = { kind: kind, t: ti, name: c.name, s: c.start.seconds, e: c.end.seconds, "in": c.inPoint.seconds, out: c.outPoint.seconds, path: "" };
  try { if (typeof c.getSpeed === "function") o.speed = c.getSpeed(); } catch (e) {}
  try { if (typeof c.isSpeedReversed === "function") o.rev = !!c.isSpeedReversed(); } catch (e) {}
  try { var pi = c.projectItem; if (pi) { o.path = pi.getMediaPath() || "";
      try { var fi = pi.getFootageInterpretation(); if (fi) { o.ifps = fi.frameRate; o.ifpsOver = fi.alphaUsage === undefined ? null : null; } } catch (e2) {} } } catch (e) {}
  var m = afk_motion(c);
  if (m) { var P = afk_prop(m, ["Position"]), S = afk_prop(m, ["Scale"]), R = afk_prop(m, ["Rotation"]), A = afk_prop(m, ["Anchor Point"]);
    o.pos = P ? afk_val(P) : null; o.scale = S ? afk_val(S) : null; o.rot = R ? afk_val(R) : null; o.anchor = A ? afk_val(A) : null;
    try { o.keyed = (P && P.isTimeVarying()) || (S && S.isTimeVarying()) || (R && R.isTimeVarying()); } catch (e) {} }
  return o; }
/* the selected clips: the one with video footage to follow, and the graphic(s) above it */
function afk_sel(){
  var seq = app.project.activeSequence; if (!seq) return afk_json({ error: "Open a sequence in Premiere first." });
  var S = [], fps = 30, W = 1920, H = 1080, ph = 0;
  try { fps = 1 / seq.getSettings().videoFrameRate.seconds; } catch (e) {}
  try { W = seq.frameSizeHorizontal; H = seq.frameSizeVertical; } catch (e) {}
  try { ph = seq.getPlayerPosition().seconds; } catch (e) {}
  for (var t = 0; t < seq.videoTracks.numTracks; t++) { var cl = seq.videoTracks[t].clips, n = cl.numItems;
    for (var k = 0; k < n; k++) { var c = cl[k], on = false; try { on = c.isSelected(); } catch (e) {} if (on) S.push(afk_info(c, "V", t)); } }
  return afk_json({ id: String(seq.sequenceID), name: seq.name, fps: fps, W: W, H: H, ph: ph, clips: S });
}
/* write keyframes on Motion. js: {t: track, s: clip start, keys: [[seqTime, x, y, scale, rot], ...], use: {p,s,r}, clearFrom, clearTo} (x,y in the same units Premiere uses for Position) */
function afk_apply(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afk_json({ error: "Open a sequence in Premiere first." });
  var tr = seq.videoTracks[J.t]; if (!tr) return afk_json({ error: "That track is gone." });
  var c = afk_find(tr, J.s); if (!c) return afk_json({ error: "Couldn't find the clip (was it moved?). Select it again and click Use selected clips." });
  var m = afk_motion(c); if (!m) return afk_json({ error: "That clip has no Motion settings." });
  var P = afk_prop(m, ["Position"]), S = afk_prop(m, ["Scale"]), R = afk_prop(m, ["Rotation"]), n = 0, err = "no Position/Scale/Rotation found", mode = J.mode || 0;
  var off = c.inPoint.seconds - c.start.seconds;     // keyframe times are in the clip's own time
  var L = [];
  if (J.use.p && P) L.push([P, function(k){ return [k[1], k[2]]; }]);
  if (J.use.s && S) L.push([S, function(k){ return k[3]; }]);
  if (J.use.r && R) L.push([R, function(k){ return k[4]; }]);
  for (var q = 0; q < L.length; q++) { var p = L[q][0], f = L[q][1];
    try { if (!p.isTimeVarying()) p.setTimeVarying(true);
      else if (J.clear) { try { p.removeKeyRange(afk_time(J.clearFrom + off), afk_time(J.clearTo + off), false); } catch (e0) {} } } catch (e) {}
    for (var i = 0; i < J.keys.length; i++) { var k = J.keys[i], sec = k[0] + off, ui = i === J.keys.length - 1;
      /* Premiere versions differ: some take a Time object, some plain seconds */
      if (mode !== 2) { try { var tt = afk_time(sec); p.addKey(tt); p.setValueAtKey(tt, f(k), ui); n++; mode = 1; continue; } catch (e1) { err = String(e1); if (mode === 1) continue; } }
      try { p.addKey(sec); p.setValueAtKey(sec, f(k), ui); n++; mode = 2; } catch (e2) { err = String(e2); } } }
  return afk_json({ keys: n, err: n ? "" : err, mode: mode });
}
/* put Motion back the way it was before tracking (static values) */
function afk_restore(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afk_json({ error: "Open a sequence in Premiere first." });
  var c = afk_find(seq.videoTracks[J.t], J.s); if (!c) return afk_json({ error: "Couldn't find the clip." }); var m = afk_motion(c);
  var P = afk_prop(m, ["Position"]), S = afk_prop(m, ["Scale"]), R = afk_prop(m, ["Rotation"]);
  try { if (J.use.p && P) { P.setTimeVarying(false); P.setValue(J.pos, true); } } catch (e) {}
  try { if (J.use.s && S) { S.setTimeVarying(false); S.setValue(J.scale, true); } } catch (e) {}
  try { if (J.use.r && R) { R.setTimeVarying(false); R.setValue(J.rot, true); } } catch (e) {}
  return afk_json({ ok: true });
}
/* export what the timeline shows at a time to a PNG (used to measure exactly which moment of the video Premiere shows). js: {t, out} */
function afk_frame(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afk_json({ error: "Open a sequence in Premiere first." });
  var keep = null; try { keep = seq.getPlayerPosition().ticks; } catch (e) {}
  var hid = [];
  if (J.hide) for (var h = 0; h < J.hide.length; h++) { try { var hc = afk_find(seq.videoTracks[J.hide[h].t], J.hide[h].s); if (hc && !hc.disabled) { hc.disabled = true; hid.push(hc); } } catch (e0) {} }
  try { seq.setPlayerPosition(String(Math.round(J.t * AFK_TPS))); app.enableQE(); var q = qe.project.getActiveSequence(); q.exportFramePNG(q.CTI.timecode, J.out); }
  catch (e) { for (var u = 0; u < hid.length; u++) { try { hid[u].disabled = false; } catch (e1) {} } return afk_json({ error: "Premiere couldn't export a frame: " + e }); }
  for (var v = 0; v < hid.length; v++) { try { hid[v].disabled = false; } catch (e2) {} }
  try { if (keep !== null) seq.setPlayerPosition(keep); } catch (e) {}
  return afk_json({ ok: true, hidden: hid.length });
}
/* put a rendered layer (e.g. the blur) on a free video track above the clip, lined up with it and with the same Motion.
   js: {path, t: clip's track, s: clip start, at: sequence time, dur} -> {track} */
function afk_placeLayer(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afk_json({ error: "Open a sequence in Premiere first." });
  var src = afk_find(seq.videoTracks[J.t], J.s); if (!src) return afk_json({ error: "Couldn't find the clip (was it moved?)." });
  var root = app.project.rootItem, bin = null, i;
  for (i = 0; i < root.children.numItems; i++) { var c = root.children[i]; if (c.type === ProjectItemType.BIN && c.name === "AssetFlow Track") bin = c; }
  if (!bin) bin = root.createBin("AssetFlow Track");
  try { app.project.importFiles([J.path], true, bin, false); } catch (e) { return afk_json({ error: "Premiere couldn't import the blur clip: " + e }); }
  var pi = null, want = String(J.path).replace(/\\/g, "/").toLowerCase();
  for (i = 0; i < bin.children.numItems; i++) { var b = bin.children[i], mp = ""; try { mp = String(b.getMediaPath()).replace(/\\/g, "/").toLowerCase(); } catch (e) {} if (mp === want) pi = b; }
  if (!pi) return afk_json({ error: "The blur clip didn't import." });
  function free(tr){ var cl = tr.clips; for (var k = 0; k < cl.numItems; k++) { var x = cl[k]; if (x.end.seconds > J.at + 0.001 && x.start.seconds < J.at + J.dur - 0.001) return false; } return true; }
  var ti = -1; for (i = J.t + 1; i < seq.videoTracks.numTracks; i++) if (free(seq.videoTracks[i])) { ti = i; break; }
  if (ti < 0) { try { app.enableQE(); qe.project.getActiveSequence().addTracks(1, seq.videoTracks.numTracks, 0); } catch (e) {} ti = seq.videoTracks.numTracks - 1; if (ti <= J.t || !free(seq.videoTracks[ti])) return afk_json({ error: "Please add an empty video track above the clip, then try again." }); }
  try { seq.videoTracks[ti].overwriteClip(pi, afk_time(J.at).ticks); } catch (e) { try { seq.videoTracks[ti].overwriteClip(pi, J.at); } catch (e2) { return afk_json({ error: "Couldn't place the blur clip: " + e2 }); } }
  var lay = afk_find(seq.videoTracks[ti], J.at);
  if (lay) { var ms = afk_motion(src), ml = afk_motion(lay); if (ms && ml) { var N = ["Position", "Scale", "Rotation", "Anchor Point"];
      for (i = 0; i < N.length; i++) { var a = afk_prop(ms, [N[i]]), d = afk_prop(ml, [N[i]]); try { if (a && d && !a.isTimeVarying()) d.setValue(a.getValue(), i === N.length - 1); } catch (e) {} } } }
  return afk_json({ track: ti });
}
/* a copy of the open sequence, set to 1080x1920, and open it */
function afk_vertCopy(){
  var seq = app.project.activeSequence; if (!seq) return afk_json({ error: "Open a sequence in Premiere first." });
  var before = {}, Q = app.project.sequences, i; for (i = 0; i < Q.numSequences; i++) before[Q[i].sequenceID] = 1;
  try { seq.clone(); } catch (e) { return afk_json({ error: "Premiere couldn't copy the sequence: " + e }); }
  var ns = null; Q = app.project.sequences; for (i = 0; i < Q.numSequences; i++) if (!before[Q[i].sequenceID]) ns = Q[i];
  if (!ns) return afk_json({ error: "The copy didn't appear." });
  try { ns.name = seq.name + " (9x16)"; } catch (e) {}
  try { var st = ns.getSettings(); st.videoFrameWidth = 1080; st.videoFrameHeight = 1920; ns.setSettings(st); } catch (e) { return afk_json({ error: "Couldn't change the copy to 9:16: " + e }); }
  try { app.project.openSequence(ns.sequenceID); } catch (e) {}
  return afk_json({ name: ns.name });
}
"afk ok";
