/* AssetFlow Reverb & FX: Premiere side. Loaded with $.evalFile by js/af_reverb.js. ES3 only (no let/const/arrows). */
var AFR_TPS = 254016000000;
function afr_json(v){
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(afr_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(afr_json(String(k)) + ":" + afr_json(v[k])); return "{" + o.join(",") + "}";
}
function afr_time(sec){ var tm = new Time(); tm.seconds = sec; return tm; }
/* the clip's Volume > Level property (null when there's none) */
function afr_lvlProp(c){ try { var cs = c.components; for (var i = 0; i < cs.numItems; i++) { var cm = cs[i]; if (cm.displayName !== "Volume") continue;
  for (var j = 0; j < cm.properties.numItems; j++) if (cm.properties[j].displayName === "Level") return cm.properties[j]; } } catch (e) {} return null; }
/* a file whose audio Premiere split into several linked clips (e.g. a stereo recording as two mono clips on A1 + A2, or
   OBS's separate tracks): how many there are (n) and which one this clip is (k, by track order = Premiere's default mapping) */
function afr_split(seq, c, t, p){
  var L = null; try { L = c.getLinkedItems(); } catch (e) { return { n: 1, k: 0 }; } if (!L) return { n: 1, k: 0 };
  var T = [t];
  for (var i = 0; i < L.numItems; i++) { var x = L[i]; try { if (x.mediaType !== "Audio" || x.nodeId === c.nodeId || !x.projectItem || x.projectItem.getMediaPath() !== p) continue; } catch (e) { continue; }
    for (var q = 0; q < seq.audioTracks.numTracks; q++) { var y = afr_clipAt(seq.audioTracks[q], x.start.seconds); if (y && y.nodeId === x.nodeId) { T.push(q); break; } } }
  T.sort(function (a, b) { return a - b; }); var k = 0; for (var j = 0; j < T.length; j++) if (T[j] === t) { k = j; break; }
  return { n: T.length, k: k }; }
/* the selected audio clips: [{t, s, e, in, out, path, name, spd, dis, pv (end of the clip before it on its track), nx (start of the next one, -1 = none), node, lvl, kf}] */
function afr_sel(){
  var seq = app.project.activeSequence; if (!seq) return afr_json({ error: "Open a sequence in Premiere first." });
  var L = [], fr = 1 / 30; try { fr = Number(seq.timebase) / AFR_TPS; if (!(fr > 0.001 && fr < 1)) fr = 1 / 30; } catch (e) {}
  for (var t = 0; t < seq.audioTracks.numTracks; t++) { var cl = seq.audioTracks[t].clips;
    for (var k = 0; k < cl.numItems; k++) { var c = cl[k], on = false; try { on = !!c.isSelected(); } catch (e) {} if (!on) continue;
      var p = "", node = ""; try { p = c.projectItem ? c.projectItem.getMediaPath() : ""; node = c.projectItem ? String(c.projectItem.nodeId) : ""; } catch (e) {}
      var s = c.start.seconds, e2 = c.end.seconds, i0 = c.inPoint.seconds, o0 = c.outPoint.seconds, sp = e2 > s ? (o0 - i0) / (e2 - s) : 1;
      var pv = 0, nx = -1; for (var q = 0; q < cl.numItems; q++) { if (q === k) continue; var cs0 = cl[q].start.seconds, ce0 = cl[q].end.seconds;
        if (ce0 <= s + 0.001 && ce0 > pv) pv = ce0; if (cs0 >= e2 - 0.001 && (nx < 0 || cs0 < nx)) nx = cs0; }
      var lv = null, kf = false, lp = afr_lvlProp(c); if (lp) { try { kf = !!lp.isTimeVarying(); } catch (e) {} try { lv = lp.getValue(); } catch (e) {} }
      var sib = afr_split(seq, c, t, p), sub = false; try { sub = / \(audio\)$/.test(c.projectItem.name) && !/\.wav$/i.test(p); } catch (e) {}
      if (sub) {   /* a leftover subclip from the first version's Undo: its own timing can't be trusted, so take it from the video
                      it sits under (same file, still in sync): where that video clip is in the file + how far into it this audio starts */
        for (var vt = 0; vt < seq.videoTracks.numTracks && sub; vt++) { var vc = seq.videoTracks[vt].clips;
          for (var vq = 0; vq < vc.numItems; vq++) { var v = vc[vq]; if (v.start.seconds > s + 0.01 || v.end.seconds < s + 0.05) continue;
            var vp = ""; try { vp = v.projectItem ? v.projectItem.getMediaPath() : ""; } catch (e) {} if (vp !== p) continue;
            i0 = v.inPoint.seconds + (s - v.start.seconds); o0 = i0 + (e2 - s); sub = false; break; } } }
      L.push({ t: t, s: s, e: e2, "in": i0, out: o0, path: p || "", name: c.name, spd: Math.round(sp * 1000) / 1000, dis: !!c.disabled, pv: pv, nx: nx, node: node, lvl: (typeof lv === "number" ? lv : null), kf: kf, n: sib.n, k: sib.k, sub: sub }); } }
  return afr_json({ id: String(seq.sequenceID), fr: fr, clips: L });
}
/* make sure `need` empty audio tracks exist (added at the bottom when missing); returns their indexes */
function afr_tracks(need){
  var seq = app.project.activeSequence; if (!seq) return afr_json({ error: "Open a sequence in Premiere first." });
  need = +need || 1;
  function empties(){ var E = []; for (var t = 0; t < seq.audioTracks.numTracks; t++) if (seq.audioTracks[t].clips.numItems === 0) E.push(t); return E; }
  var E = empties();
  if (E.length < need) { try { app.enableQE(); var q = qe.project.getActiveSequence(); q.addTracks(0, 0, need - E.length, 1, seq.audioTracks.numTracks, 0, 0); } catch (e) {} E = empties(); }
  if (E.length < need) return afr_json({ error: "Please add " + (need - E.length) + " empty audio track" + (need - E.length > 1 ? "s" : "") + " (right-click a track > Add Tracks), then try again." });
  return afr_json({ tracks: E.slice(0, need) });
}
function afr_bin(name){
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) { var c = root.children[i]; if (c.type === ProjectItemType.BIN && c.name === name) return c; }
  return root.createBin(name);
}
function afr_findItem(bin, p){
  var want = String(p).replace(/\\/g, "/").toLowerCase();
  for (var i = 0; i < bin.children.numItems; i++) { var c = bin.children[i]; var mp = ""; try { mp = c.getMediaPath(); } catch (e) {}
    if (mp && String(mp).replace(/\\/g, "/").toLowerCase() === want) return c; }
  return null;
}
/* import the rendered files into the "AssetFlow FX" bin (skips ones already there). js: {paths:[...]} */
function afr_import(js){
  var J = eval("(" + js + ")"), bin = afr_bin("AssetFlow FX"), need = [];
  for (var i = 0; i < J.paths.length; i++) if (!afr_findItem(bin, J.paths[i])) need.push(J.paths[i]);
  if (need.length) { try { app.project.importFiles(need, true, bin, false); } catch (e) { return afr_json({ error: "Premiere couldn't import the new audio: " + e }); } }
  var miss = 0; for (var j = 0; j < J.paths.length; j++) if (!afr_findItem(bin, J.paths[j])) miss++;
  return afr_json({ ok: true, missing: miss });
}
/* put rendered files on tracks (overwrite: on the clip's own track this replaces the clip). js: {items:[{path, track, s, in, out, lvl}]} (s = timeline seconds; in/out = seconds inside the rendered file) */
function afr_place(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afr_json({ error: "Open a sequence in Premiere first." });
  var bin = afr_bin("AssetFlow FX"), done = 0, failed = 0, err = "";
  for (var i = 0; i < J.items.length; i++) { var x = J.items[i], pi = afr_findItem(bin, x.path), tr = seq.audioTracks[x.track];
    if (!pi || !tr) { failed++; err = !pi ? "a rendered file isn't in the project" : "track " + (x.track + 1) + " is missing"; continue; }
    try { pi.setInPoint(afr_time(x["in"]).ticks, 4); pi.setOutPoint(afr_time(x.out).ticks, 4);
      var ok = false; try { tr.overwriteClip(pi, afr_time(x.s).ticks); ok = true; } catch (e1) { try { tr.overwriteClip(pi, x.s); ok = true; } catch (e2) { err = String(e2); } }
      if (ok) { done++; if (x.lvl !== null && x.lvl !== undefined) { var nc = afr_clipAt(tr, x.s), lp = nc ? afr_lvlProp(nc) : null; if (lp) { try { lp.setValue(x.lvl, 1); } catch (e3) {} } } } else failed++;
    } catch (e) { failed++; err = String(e); }
    try { pi.clearInPoint(); pi.clearOutPoint(); } catch (e) {} }
  return afr_json({ done: done, failed: failed, err: err });
}
function afr_clipAt(tr, s){ var cl = tr.clips, lo = 0, hi = cl.numItems - 1;
  while (lo <= hi) { var m = (lo + hi) >> 1, c = cl[m], t = c.start.seconds; if (Math.abs(t - s) < 0.02) return c; if (t < s) lo = m + 1; else hi = m - 1; }
  for (var k = 0; k < cl.numItems; k++) if (Math.abs(cl[k].start.seconds - s) < 0.02) return cl[k]; return null; }
function afr_samePath(c, want){ var mp = ""; try { mp = c.projectItem ? c.projectItem.getMediaPath() : ""; } catch (e) {} return !!mp && String(mp).replace(/\\/g, "/").toLowerCase() === want; }
/* undo: take the effect clip (and any tail that continued on another track) out, and put the original sound back where it was
   (an exact copy rendered when the effect was applied: no subclips, so its timing can never be misread later).
   js: {items:[{t, s, e, lvl, path, dry, lo, hi, tracks:[...]}]} */
function afr_restore(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return afr_json({ error: "Open a sequence in Premiere first." });
  var bin = afr_bin("AssetFlow FX"), back = 0, removed = 0, failed = 0, err = "";
  for (var i = 0; i < J.items.length; i++) { var x = J.items[i], want = String(x.path).replace(/\\/g, "/").toLowerCase();
    for (var u = 0; u < x.tracks.length; u++) { var tr = seq.audioTracks[x.tracks[u]]; if (!tr) continue;
      for (var k = tr.clips.numItems - 1; k >= 0; k--) { var c = tr.clips[k], cs = c.start.seconds; if (cs < x.lo - 0.05 || cs > x.hi + 0.05 || !afr_samePath(c, want)) continue; try { c.remove(false, false); removed++; } catch (e) {} } }
    var T = seq.audioTracks[x.t], pi = afr_findItem(bin, x.dry);
    if (!pi || !T) { failed++; err = !pi ? "the saved copy of the original audio isn't in the project" : "track " + (x.t + 1) + " is missing"; continue; }
    try { pi.setInPoint(afr_time(0).ticks, 4); pi.setOutPoint(afr_time(x.e - x.s).ticks, 4);
      T.overwriteClip(pi, afr_time(x.s).ticks); back++; try { pi.clearInPoint(); pi.clearOutPoint(); } catch (e) {}
      if (x.lvl !== null && x.lvl !== undefined) { var nc = afr_clipAt(T, x.s), lp = nc ? afr_lvlProp(nc) : null; if (lp) { try { lp.setValue(x.lvl, 1); } catch (e) {} } }
    } catch (e) { failed++; err = String(e); } }
  return afr_json({ back: back, removed: removed, failed: failed, err: err });
}
"afr ok";
