/* AssetFlow Audio levels: Premiere side. Loaded with $.evalFile by js/af_level.js. ES3 only. */
function afl_json(v){
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(afl_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(afl_json(String(k)) + ":" + afl_json(v[k])); return "{" + o.join(",") + "}";
}
/* clip Volume "Level": Premiere stores it as a gain factor where 0 dB = 0.1778 (10^(-15/20)) and +15 dB = 1 */
function afl_dbToVal(db){ return Math.pow(10, (db - 15) / 20); }
function afl_level(c){
  try { var C = c.components;
    for (var i = 0; i < C.numItems; i++) { var cp = C[i]; if (cp.displayName !== "Volume" && cp.matchName !== "audioVolume" && cp.matchName !== "Internal Volume Stereo") continue;
      for (var j = 0; j < cp.properties.numItems; j++) { var p = cp.properties[j]; if (p.displayName === "Level") return p; } } } catch (e) {}
  return null;
}
/* the clip on audio track t that starts at s seconds (k = its index when we read the sequence, tried first) */
function afl_find(seq, t, s, k){
  var tr = seq.audioTracks[t]; if (!tr) return null; var n = tr.clips.numItems, fr = 1 / 60;
  try { fr = seq.getSettings().videoFrameRate.seconds / 2; } catch (e) {}
  if (k !== undefined && k !== null && k < n) { var c0 = tr.clips[k]; if (Math.abs(c0.start.seconds - s) < fr) return c0; }
  for (var i = 0; i < n; i++) { var c = tr.clips[i]; if (Math.abs(c.start.seconds - s) < fr) return c; }
  return null;
}
/* selected audio clips: [{t, s}] */
function afl_selected(){
  var seq = app.project.activeSequence; if (!seq) return afl_json({ error: "Open a sequence in Premiere first." });
  var out = [];
  for (var t = 0; t < seq.audioTracks.numTracks; t++) { var tr = seq.audioTracks[t];
    for (var k = 0; k < tr.clips.numItems; k++) { var c = tr.clips[k]; var on = false; try { on = !!c.isSelected(); } catch (e) {} if (on) out.push({ t: t, s: c.start.seconds }); } }
  return afl_json(out);
}
function afl_time(ticks){ var tm = new Time(); tm.ticks = String(ticks); return tm; }
/* set each clip's Volume Level. js: [{t, s, k, db}] (db = where the clip's loudest volume point should end up)
   or the "old" list this returns (used by Undo: {v} for a plain level, {keys:[[ticks, v],...]} for keyframes).
   Clips with volume keyframes keep their keyframes: every keyframe moves by the same amount, so fades and dips stay. */
function afl_apply(js){
  var L = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afl_json({ error: "Open a sequence in Premiere first." });
  var done = 0, keyed = 0, missing = 0, old = [], last = L.length - 1;
  for (var i = 0; i < L.length; i++) { var x = L[i], c = afl_find(seq, x.t, x.s, x.k); if (!c) { missing++; continue; }
    var p = afl_level(c); if (!p) { missing++; continue; }
    var ui = i === last || i % 50 === 0, tv = false; try { tv = !!p.isTimeVarying(); } catch (e) {}
    try {
      if (x.keys) {   // undo of a keyframed clip
        for (var q = 0; q < x.keys.length; q++) p.setValueAtKey(afl_time(x.keys[q][0]), x.keys[q][1], ui && q === x.keys.length - 1);
        done++; continue; }
      if (x.v !== undefined && !tv) { p.setValue(x.v, ui); done++; continue; }   // undo of a plain clip
      if (tv) {
        var K = p.getKeys(), was = [], top = 0;
        if (!K || !K.length) { tv = false; }
        else { for (var j = 0; j < K.length; j++) { var v0 = p.getValueAtKey(K[j]); was.push([K[j].ticks, v0]); if (v0 > top) top = v0; }
          if (top <= 0) { missing++; continue; }
          var f = afl_dbToVal(x.db) / top;
          for (var j2 = 0; j2 < K.length; j2++) { var nv = was[j2][1] * f; if (nv > 1) nv = 1; p.setValueAtKey(K[j2], nv, ui && j2 === K.length - 1); }
          old.push({ t: x.t, s: x.s, k: x.k, keys: was }); keyed++; done++; continue; } }
      var before = p.getValue(), v = afl_dbToVal(x.db); if (v > 1) v = 1; if (v < 0) v = 0;
      p.setValue(v, ui); old.push({ t: x.t, s: x.s, k: x.k, v: before }); done++;
    } catch (e) { missing++; } }
  return afl_json({ done: done, keyed: keyed, missing: missing, old: old });
}
/* ---------- "Stop spikes": a Hard Limiter on each clip does the boosting, so loud moments are caught instead of clipping ---------- */
var AFL_TPS = 254016000000;
function afl_qeItem(qtr, c, k){   // the QE twin of a clip (QE lists gaps as items too, so match by start time, then name/order)
  var n = 0; try { n = qtr.numItems; } catch (e) { return null; }
  var s = c.start.seconds, idx = 0, byOrder = null;
  for (var i = 0; i < n; i++) { var it = qtr.getItemAt(i); if (!it) continue; var ty = ""; try { ty = String(it.type); } catch (e) {} if (/empty/i.test(ty)) continue;
    var st = NaN; try { st = it.start.secs; } catch (e) {} if (!(st >= 0)) { try { st = parseFloat(it.start.ticks) / AFL_TPS; } catch (e) {} }
    if (st >= 0 && Math.abs(st - s) < 0.02) return it;
    if (idx === k) byOrder = it; idx++; }
  try { if (byOrder && byOrder.name === c.name) return byOrder; } catch (e) {}
  return null;
}
function afl_comp(c, name){ try { var C = c.components, hit = null; for (var i = 0; i < C.numItems; i++) if (C[i].displayName === name) hit = C[i]; return hit; } catch (e) { return null; } }
function afl_prop(cp, rx){ try { for (var j = 0; j < cp.properties.numItems; j++) { var p = cp.properties[j]; if (rx.test(p.displayName)) return p; } } catch (e) {} return null; }
/* Premiere stores the Hard Limiter's settings as slider positions (0..1), not dB. Its defaults: */
var AFL_LIM_DEF = { max: 0.9990000128746, boost: 0.66666698455811 };
/* js: [{t, s, k, raw:{max, boost}}] -> adds (or reuses) a Hard Limiter on each clip and sets the raw slider values.
   Returns {done, added, failed, info} (info = the first limiter's settings, for the log). */
function afl_limit(js){
  var L = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afl_json({ error: "Open a sequence in Premiere first." });
  try { app.enableQE(); } catch (e) {}
  var qs = null; try { qs = qe.project.getActiveSequence(); } catch (e) {}
  var fx = null; try { fx = qe.project.getAudioEffectByName("Hard Limiter"); } catch (e) {}
  if (!qs || !fx) return afl_json({ error: "Premiere wouldn't let me add the Hard Limiter effect (" + (!qs ? "no QE sequence" : "effect not found") + ")." });
  var done = 0, added = 0, failed = 0, info = null;
  for (var i = 0; i < L.length; i++) { var x = L[i], c = afl_find(seq, x.t, x.s, x.k); if (!c) { failed++; continue; }
    var cp = afl_comp(c, "Hard Limiter");
    if (!cp) { var qi = afl_qeItem(qs.getAudioTrackAt(x.t), c, x.k); if (!qi) { failed++; continue; }
      try { qi.addAudioEffect(fx); added++; } catch (e) { failed++; continue; }
      cp = afl_comp(c, "Hard Limiter"); if (!cp) { failed++; continue; } }
    var pMax = afl_prop(cp, /max/i), pBoost = afl_prop(cp, /boost/i), R = x.raw || AFL_LIM_DEF;
    try { if (pMax && R.max != null) pMax.setValue(R.max, false); if (pBoost && R.boost != null) pBoost.setValue(R.boost, i === L.length - 1); done++; } catch (e) { failed++; continue; }
    if (!info) { info = []; try { for (var j = 0; j < cp.properties.numItems; j++) { var pp = cp.properties[j], vv = null; try { vv = pp.getValue(); } catch (e) {} info.push(pp.displayName + "=" + vv); } } catch (e) {} } }
  return afl_json({ done: done, added: added, failed: failed, info: info });
}
/* every audio clip in the sequence that has a Hard Limiter: back to Premiere's default settings (does nothing audible) */
function afl_limitReset(){
  var seq = app.project.activeSequence; if (!seq) return afl_json({ error: "Open a sequence in Premiere first." }); var n = 0;
  for (var t = 0; t < seq.audioTracks.numTracks; t++) { var tr = seq.audioTracks[t];
    for (var k = 0; k < tr.clips.numItems; k++) { var cp = afl_comp(tr.clips[k], "Hard Limiter"); if (!cp) continue;
      try { var pM = afl_prop(cp, /max/i), pB = afl_prop(cp, /boost/i); if (pM) pM.setValue(AFL_LIM_DEF.max, false); if (pB) pB.setValue(AFL_LIM_DEF.boost, false); n++; } catch (e) {} } }
  return afl_json({ done: n });
}
/* copy the Hard Limiter on the selected clip (set up by hand in Effect Controls) to every clip on the given audio tracks.
   js: {tracks:[0,1,...]}. Values are copied as Premiere stores them, so whatever the user set is exactly what every clip gets. */
function afl_limitCopy(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afl_json({ error: "Open a sequence in Premiere first." });
  var src = null, srcClip = null, S = []; try { S = seq.getSelection(); } catch (e) {}
  for (var i = 0; i < S.length && !src; i++) { var cp0 = afl_comp(S[i], "Hard Limiter"); if (cp0) { src = cp0; srcClip = S[i]; } }
  if (!src) return afl_json({ error: "Select the clip that has your Hard Limiter on it first." });
  var V = []; for (var j = 0; j < src.properties.numItems; j++) { var v = null; try { v = src.properties[j].getValue(); } catch (e) {} V.push(v); }
  try { app.enableQE(); } catch (e) {}
  var qs = null, fx = null; try { qs = qe.project.getActiveSequence(); fx = qe.project.getAudioEffectByName("Hard Limiter"); } catch (e) {}
  var done = 0, added = 0, failed = 0;
  for (var a = 0; a < J.tracks.length; a++) { var t = J.tracks[a], tr = seq.audioTracks[t]; if (!tr) continue;
    for (var k = 0; k < tr.clips.numItems; k++) { var c = tr.clips[k]; if (srcClip && c.nodeId && srcClip.nodeId === c.nodeId) { done++; continue; }
      var cp = afl_comp(c, "Hard Limiter");
      if (!cp) { if (!qs || !fx) { failed++; continue; } var qi = afl_qeItem(qs.getAudioTrackAt(t), c, k); if (!qi) { failed++; continue; }
        try { qi.addAudioEffect(fx); added++; } catch (e) { failed++; continue; } cp = afl_comp(c, "Hard Limiter"); if (!cp) { failed++; continue; } }
      try { for (var q = 0; q < cp.properties.numItems && q < V.length; q++) if (V[q] !== null && V[q] !== undefined) { try { cp.properties[q].setValue(V[q], false); } catch (e) {} }
        done++; } catch (e) { failed++; } } }
  return afl_json({ done: done, added: added, failed: failed, values: V });
}
/* try to put Premiere's Hard Limiter on the Mix (master) track through the unofficial QE scripting layer.
   Returns {ok, how, info}; info lists what the QE objects can do, so the log shows why if it doesn't work. */
function afl_names(o){ var r = []; try { var m = o.reflect.methods; for (var i = 0; i < m.length; i++) r.push(m[i].name); } catch (e) {} return r.join(","); }
function afl_mixLimiter(){
  var seq = app.project.activeSequence; if (!seq) return afl_json({ error: "Open a sequence in Premiere first." });
  try { app.enableQE(); } catch (e) {}
  var q = null, fx = null, info = {}; try { q = qe.project.getActiveSequence(); fx = qe.project.getAudioEffectByName("Hard Limiter"); } catch (e) { info.err = String(e); }
  if (!q || !fx) return afl_json({ ok: false, info: info });
  info.seq = afl_names(q);
  var cands = [];
  try { if (typeof q.getMasterTrack === "function") cands.push(["master", q.getMasterTrack()]); } catch (e) {}
  try { if (typeof q.getAudioMasterTrack === "function") cands.push(["master2", q.getAudioMasterTrack()]); } catch (e) {}
  try { var n = q.numAudioTracks; if (typeof q.getAudioTrackAt === "function") cands.push(["last+1", q.getAudioTrackAt(n)]); } catch (e) {}
  for (var i = 0; i < cands.length; i++) { var tr = cands[i][1]; if (!tr) continue; info[cands[i][0]] = afl_names(tr);
    try { if (typeof tr.addAudioEffect === "function") { tr.addAudioEffect(fx); return afl_json({ ok: true, how: cands[i][0], info: info }); } } catch (e) { info[cands[i][0] + "_err"] = String(e); } }
  try { var t0 = q.getAudioTrackAt(0); info.track0 = afl_names(t0); } catch (e) {}
  return afl_json({ ok: false, info: info });
}
"afl ok";
