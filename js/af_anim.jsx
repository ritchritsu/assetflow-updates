/* AssetFlow Animate: Premiere side. Keyframes Motion / Opacity on the selected clips. ES3 only. */
var AFA_TPS = 254016000000;
function afa_json(v){
  if (v === null || v === undefined) return "null"; var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null"; if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(afa_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(afa_json(String(k)) + ":" + afa_json(v[k])); return "{" + o.join(",") + "}"; }
function afa_comp(c, n){ try { for (var i = 0; i < c.components.numItems; i++) if (c.components[i].displayName === n) return c.components[i]; } catch (e) {} return null; }
function afa_par(cp, n){ if (!cp) return null; for (var j = 0; j < cp.properties.numItems; j++) if (cp.properties[j].displayName === n) return cp.properties[j]; return null; }
function afa_sel(){ var seq = app.project.activeSequence; if (!seq) return afa_json({ error: "Open a sequence in Premiere first." });
  var n = 0, ph = 0; try { ph = seq.getPlayerPosition().seconds; } catch (e) {}
  for (var t = 0; t < seq.videoTracks.numTracks; t++) { var cl = seq.videoTracks[t].clips; for (var k = 0; k < cl.numItems; k++) { try { if (cl[k].isSelected()) n++; } catch (e) {} } }
  return afa_json({ n: n, ph: ph }); }
/* js: {tracks: [{p: "Scale"|"Position"|"Rotation"|"Opacity", k: [[sec, value], ...]}], at: "in"|"out"|"ph", dur, ease: 0 linear | 5 smooth, replace}
   values: Scale/Opacity are multipliers of the clip's own value (1 = as it is), Position is an offset [dx, dy] in frame widths, Rotation adds degrees */
function afa_apply(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afa_json({ error: "Open a sequence in Premiere first." });
  var ph = 0; try { ph = seq.getPlayerPosition().seconds; } catch (e) {}
  var done = 0, skipped = 0, clips = [], at = [];
  for (var t = 0; t < seq.videoTracks.numTracks; t++) { var cl = seq.videoTracks[t].clips; for (var k = 0; k < cl.numItems; k++) { var on = false; try { on = cl[k].isSelected(); } catch (e) {} if (on) clips.push(cl[k]); } }
  if (!clips.length) return afa_json({ error: "Select one or more clips on the timeline first." });
  for (var c = 0; c < clips.length; c++) { var C = clips[c], s = C.start.seconds, e = C.end.seconds, len = e - s, ok = true;
    var t0 = J.at === "out" ? Math.max(s, e - J.dur) : J.at === "ph" ? Math.min(Math.max(ph, s), e - 0.02) : s;
    if (J.at === "ph" && (ph < s || ph > e)) { skipped++; continue; }
    var base = C.inPoint.seconds - s;   /* keyframe times are in the clip's own media time */
    for (var q = 0; q < J.tracks.length; q++) { var T = J.tracks[q], cp = T.p === "Opacity" ? afa_comp(C, "Opacity") : afa_comp(C, "Motion"), P = afa_par(cp, T.p);
      if (!P) { ok = false; continue; }
      try { var b = P.getValue(); if (P.isTimeVarying()) { var ks = P.getKeys(); if (J.replace && ks) { for (var r = ks.length - 1; r >= 0; r--) { var kt = ks[r].seconds; if (kt >= base + t0 - 0.001 && kt <= base + t0 + J.dur + 0.001) P.removeKey(ks[r]); } } b = P.getValueAtTime ? P.getValueAtTime(afa_t(base + t0)) : b; }
        else P.setTimeVarying(true);
        for (var i = 0; i < T.k.length; i++) { var kk = T.k[i], tt = afa_t(base + Math.min(e - 0.001, t0 + kk[0])), v;
          if (T.p === "Position") v = [b[0] + kk[1][0], b[1] + kk[1][1]]; else if (T.p === "Rotation") v = b + kk[1]; else v = b * kk[1];
          P.addKey(tt); P.setValueAtKey(tt, v, i === T.k.length - 1);
          try { P.setInterpolationTypeAtKey(tt, J.ease, false); } catch (e3) {} } }
      catch (e2) { ok = false; } }
    if (ok) { done++; at.push(t0); } else skipped++; }
  return afa_json({ done: done, skipped: skipped, at: at }); }
/* set one keyframe, robustly: Premiere versions differ in what addKey / setValueAtKey accept (a Time object or plain seconds).
   Returns true only if the key is really there afterwards. AFA_ERR keeps the first real error so the panel can show it. */
var AFA_ERR = "", AFA_NP = "";
function afa_names(cp){ var n = []; try { for (var j = 0; j < cp.properties.numItems; j++) n.push(cp.properties[j].displayName); } catch (e) {} return (cp.displayName || "?") + "[" + n.join("|") + "]"; }
function afa_key(P, sec, v, last, interp){
  var forms = [afa_t(sec), sec], ok = false, i, e1 = "";
  for (i = 0; i < forms.length && !ok; i++) { try { P.addKey(forms[i]); P.setValueAtKey(forms[i], v, last); ok = true; } catch (e) { e1 = String(e); } }
  if (!ok) { if (!AFA_ERR) AFA_ERR = P.displayName + ": " + e1; return false; }
  try { P.setInterpolationTypeAtKey(forms[i - 1], interp, false); } catch (e2) {}
  return true; }
function afa_tv(P){ try { if (!P.isTimeVarying()) P.setTimeVarying(true); return true; } catch (e) { if (!AFA_ERR) AFA_ERR = P.displayName + " (keyframes on): " + e; return false; } }
/* point values (Position, Anchor Point…): preset files store them as fractions of the frame, but Premiere's effects can
   want pixels. A fresh effect's Position is the centre, so it tells us which: if it's 960,540 the frame is 1920x1080 pixels. */
function afa_unit(cp){ var P = afa_par(cp, "Position") || afa_par(cp, "Center"), j;
  if (!P) for (j = 0; j < cp.properties.numItems && !P; j++) { var q0 = cp.properties[j]; if (/Center|Point/.test(q0.displayName)) { try { var w = q0.getValue(); if (w && w.length === 2) P = q0; } catch (e) {} } }
  if (!P) return null; var v = null; try { v = P.getValue(); } catch (e) {}
  if (!(v && v.length === 2 && (v[0] > 2 || v[1] > 2))) return null;
  if (cp.displayName === "Motion" || P.displayName !== "Position") { try { var q = app.project.activeSequence; return [q.frameSizeHorizontal, q.frameSizeVertical]; } catch (e) {} }   /* Motion may already be moved off centre */
  return [v[0] * 2, v[1] * 2]; }
function afa_pt(v, U){ return U && v && v.length === 2 && typeof v[0] === "number" ? [v[0] * U[0], v[1] * U[1]] : v; }
/* selected video clips with their track number: Premiere's own selection list (fast), not a walk over every clip */
function afa_selected(seq){ var R = [], S = null, t, k; try { S = seq.getSelection(); } catch (e) {}
  if (S && S.length !== undefined) { for (var i = 0; i < S.length; i++) { var c = S[i]; try { if (c.mediaType && c.mediaType !== "Video") continue; } catch (e) {}
      var ti = -1, st = c.start.seconds; try { if (typeof c.parentTrackIndex === "number") ti = c.parentTrackIndex; } catch (e) {}
      for (t = 0; t < seq.videoTracks.numTracks && ti < 0; t++) { var cl = seq.videoTracks[t].clips, lo = 0, hi = cl.numItems - 1;   /* clips are in time order: binary search by start */
        while (lo <= hi) { var m = (lo + hi) >> 1, x = cl[m], xs = x.start.seconds; if (Math.abs(xs - st) < 0.0005) { if (x.nodeId === c.nodeId) { ti = t; c = x; } break; } if (xs < st) lo = m + 1; else hi = m - 1; } }
      if (ti >= 0) R.push([c, ti]); }
    if (R.length || S.length === 0) return R; }
  for (t = 0; t < seq.videoTracks.numTracks; t++) { var cl2 = seq.videoTracks[t].clips; for (k = 0; k < cl2.numItems; k++) { var on = false; try { on = cl2[k].isSelected(); } catch (e) {} if (on) R.push([cl2[k], t]); } }
  return R; }
function afa_t(s){ var x = new Time(); x.seconds = s; return x; }
/* replay one of your Premiere presets on the selected clips. js: {fx:[{m, dn, p:[{n, v} | {n, k:[[t, v, interp]]}]}], ty: 0 stretch | 1 from the start | 2 from the end, d: preset length}
   effects that aren't Motion/Opacity are added fresh; values and keyframes are copied over by parameter name */
function afa_qeItem(seq, ti, c){ try { app.enableQE(); var qt = qe.project.getActiveSequence().getVideoTrackAt(ti);
    for (var i = 0; i < qt.numItems; i++) { var it = qt.getItemAt(i); if (it && it.type === "Clip" && Math.abs(parseFloat(it.start.secs) - c.start.seconds) < 0.02) return it; } } catch (e) {} return null; }
function afa_preset(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afa_json({ error: "Open a sequence in Premiere first." });
  var L = afa_selected(seq), t, k, i;
  if (!L.length) return afa_json({ error: "Select one or more clips on the timeline first." });
  var done = 0, missing = {}, keysSet = 0, spans = []; AFA_ERR = ""; AFA_NP = "";
  for (var c = 0; c < L.length; c++) { var C = L[c][0], s = C.start.seconds, e = C.end.seconds, len = e - s, base = C.inPoint.seconds - s;
    function when(x){ var r = J.ty === 2 ? len - (J.d - x) : J.ty === 0 && J.d > 0 ? x / J.d * len : x; return base + s + Math.max(0, Math.min(len - 0.001, r)); }
    for (var f = 0; f < J.fx.length; f++) { var F = J.fx[f], comp = null;
      if (F.m === "AE.ADBE Motion" || F.dn === "Motion") comp = afa_comp(C, "Motion");
      else if (F.m === "AE.ADBE Opacity" || F.dn === "Opacity") comp = afa_comp(C, "Opacity");
      else { var q = afa_qeItem(seq, L[c][1], C), fx = null; try { fx = qe.project.getVideoEffectByName(F.dn); } catch (e) {}
        if (!q || !fx) { missing[F.dn] = 1; continue; }
        var n0 = afa_count(C, F.dn); try { q.addVideoEffect(fx); } catch (e) { missing[F.dn] = 1; continue; }
        comp = afa_newest(C, F.dn, n0); if (!comp) { missing[F.dn] = 1; continue; } }
      if (!comp) continue;
      var U = afa_unit(comp);
      for (i = 0; i < F.p.length; i++) { var X = F.p[i], P = afa_par(comp, X.n); if (!P) { if (X.k && X.k.length && !AFA_NP) AFA_NP = "no " + X.n + " in " + afa_names(comp); continue; }
        if (X.k && X.k.length) { try { if (P.isTimeVarying()) { var ok = P.getKeys(); if (ok) for (var r = ok.length - 1; r >= 0; r--) P.removeKey(ok[r]); } } catch (e5) {}
            if (!afa_tv(P)) continue;
            for (var j = 0; j < X.k.length; j++) if (afa_key(P, when(X.k[j][0]), afa_pt(X.k[j][1], U), j === X.k.length - 1, X.k[j][2])) keysSet++; }
        else if (X.v !== null && X.v !== undefined) { try { P.setValue(afa_pt(X.v, U), true); } catch (e2) { if (!AFA_ERR) AFA_ERR = X.n + ": " + e2; } } }
      if (J.tag && comp.displayName === "Transform") { var sa = afa_par(comp, "Skew Axis"), sk = afa_par(comp, "Skew"); try { if (sa && !sa.isTimeVarying() && (!sk || (!sk.isTimeVarying() && sk.getValue() === 0))) sa.setValue(J.tag, true); } catch (e4) {} } }
    done++; spans.push([s, e]); }
  var M = []; for (var mk in missing) if (missing.hasOwnProperty(mk)) M.push(mk);
  return afa_json({ done: done, keys: keysSet, missing: M, spans: spans, err: AFA_ERR, np: AFA_NP }); }
/* ---------- each animation as its own Transform effect (stack them, remove one at a time) ----------
   Premiere won't let scripts rename an effect, so each one AssetFlow adds is tagged through its Skew Axis
   (with Skew at 0, Skew Axis changes nothing on screen). tag = 7000 + animation number. */
/* the effect we just added: the newest one with that name (it isn't always last in the list, e.g. after Lumetri) */
function afa_newest(C, name, before){ var last = null, n = 0; for (var i = 0; i < C.components.numItems; i++) { var c = C.components[i]; if (c.displayName === name) { n++; last = c; } } return n > before ? last : null; }
function afa_count(C, name){ var n = 0; for (var i = 0; i < C.components.numItems; i++) if (C.components[i].displayName === name) n++; return n; }
function afa_addTransform(seq, ti, C){ var q = afa_qeItem(seq, ti, C), fx = null; try { fx = qe.project.getVideoEffectByName("Transform"); } catch (e) {}
  if (!q || !fx) return null; var n0 = afa_count(C, "Transform"); try { q.addVideoEffect(fx); } catch (e) { return null; }
  return afa_newest(C, "Transform", n0); }
function afa_set(cp, name, v){ var P = afa_par(cp, name); if (!P) return false; try { if (P.isTimeVarying()) P.setTimeVarying(false); P.setValue(v, true); return true; } catch (e) { return false; } }
/* js: like afa_apply plus {tag} */
function afa_layer(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afa_json({ error: "Open a sequence in Premiere first." });
  var ph = 0; try { ph = seq.getPlayerPosition().seconds; } catch (e) {}
  var L = afa_selected(seq);
  if (!L.length) return afa_json({ error: "Select one or more clips on the timeline first." });
  var done = 0, skipped = 0, at = [], noFx = 0, keys = 0; AFA_ERR = ""; AFA_NP = "";
  for (var c = 0; c < L.length; c++) { var C = L[c][0], s = C.start.seconds, e = C.end.seconds;
    var t0 = J.at === "out" ? Math.max(s, e - J.dur) : J.at === "ph" ? Math.min(Math.max(ph, s), e - 0.02) : s;
    if (J.at === "ph" && (ph < s || ph > e)) { skipped++; continue; }
    var cp = afa_addTransform(seq, L[c][1], C); if (!cp) { noFx++; continue; }
    var base = C.inPoint.seconds - s, U = afa_unit(cp);
    afa_set(cp, "Uniform Scale", true); afa_set(cp, "Skew", 0); afa_set(cp, "Skew Axis", J.tag);
    afa_set(cp, "Use Composition's Shutter Angle", false); afa_set(cp, "Shutter Angle", J.blur ? 180 : 0);
    var B = { Position: afa_pt([0.5, 0.5], U), Scale: 100, Rotation: 0, Opacity: 100 };
    for (var q = 0; q < J.tracks.length; q++) { var T = J.tracks[q], P = afa_par(cp, T.p); if (!P) { if (!AFA_NP) AFA_NP = "no " + T.p + " in " + afa_names(cp); continue; }
      if (!afa_tv(P)) continue;
      for (var i = 0; i < T.k.length; i++) { var kk = T.k[i], b = B[T.p], v;
        if (T.p === "Position") { var o = afa_pt(kk[1], U); v = [b[0] + o[0], b[1] + o[1]]; } else if (T.p === "Rotation") v = b + kk[1]; else v = b * kk[1];
        if (afa_key(P, base + Math.min(e - 0.001, t0 + kk[0]), v, i === T.k.length - 1, J.ease)) keys++; } }
    done++; at.push(t0); }
  if (!done && noFx) return afa_json({ error: "Couldn't add a Transform effect (Premiere's effect list wasn't reachable)." });
  return afa_json({ done: done, skipped: skipped, at: at, keys: keys, err: AFA_ERR, np: AFA_NP }); }
/* AssetFlow animations on the first selected clip: [{i, tag}] */
function afa_list(){ var seq = app.project.activeSequence; if (!seq) return afa_json({ error: "Open a sequence in Premiere first." });
  var L = afa_selected(seq); if (!L.length) return afa_json({ clip: null, list: [] });
  var C = L[0][0], R = [];
  for (var i = 0; i < C.components.numItems; i++) { var cp = C.components[i]; if (cp.displayName !== "Transform") continue; var P = afa_par(cp, "Skew Axis"), v = null; try { v = P ? P.getValue() : null; } catch (e) {}
    if (typeof v === "number" && v >= 7000 && v < 9000) R.push({ i: i, tag: Math.round(v) }); }
  return afa_json({ clip: C.name, list: R }); }
/* turn one of them off: found by its tag (not its place in the list), only the settings it changed are reset, one screen refresh */
function afa_remove(js){ var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afa_json({ error: "Open a sequence in Premiere first." });
  var L = afa_selected(seq); if (!L.length) return afa_json({ error: "Select the clip first." });
  for (var c = 0; c < L.length; c++) { var C = L[c][0];
    for (var i = 0; i < C.components.numItems; i++) { var cp = C.components[i]; if (cp.displayName !== "Transform") continue; var SA = afa_par(cp, "Skew Axis"), v = null; try { v = SA.getValue(); } catch (e) {}
      if (typeof v !== "number" || Math.round(v) !== J.tag) continue;
      var Pz = afa_par(cp, "Position"), px = false; try { var pv = Pz.getValue(); px = pv && (pv[0] > 2 || pv[1] > 2); } catch (e) {}
      var W = 1920, H = 1080; try { W = seq.frameSizeHorizontal; H = seq.frameSizeVertical; } catch (e) {}
      var ctr = px ? [W / 2, H / 2] : [0.5, 0.5], D = { "Position": ctr, "Anchor Point": ctr, "Scale": 100, "Scale Height": 100, "Scale Width": 100, "Rotation": 0, "Opacity": 100, "Skew": 0, "Shutter Angle": 0 };
      var todo = [];
      for (var j = 0; j < cp.properties.numItems; j++) { var P = cp.properties[j], n = P.displayName; if (!D.hasOwnProperty(n)) continue; var tv = false; try { tv = P.isTimeVarying(); } catch (e) {}
        var cur = null; try { cur = P.getValue(); } catch (e) {}
        var same = !tv && (cur === D[n] || (cur && D[n].length && Math.abs(cur[0] - D[n][0]) < 0.01 && Math.abs(cur[1] - D[n][1]) < 0.01));
        if (!same) todo.push([P, tv, D[n]]); }
      todo.push([SA, false, 0]);
      for (var q = 0; q < todo.length; q++) { try { if (todo[q][1]) todo[q][0].setTimeVarying(false); todo[q][0].setValue(todo[q][2], q === todo.length - 1); } catch (e) {} }
      return afa_json({ ok: 1, changed: todo.length }); } }
  return afa_json({ error: "That animation isn't on the selected clip." }); }
"afa ok";
