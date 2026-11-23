/* AssetFlow Find: Premiere side. Loaded with $.evalFile by js/af_find.js. ES3 only. */
var AFF_TPS = 254016000000;
function aff_json(v){
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(aff_json(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) if (v.hasOwnProperty(k)) o.push(aff_json(String(k)) + ":" + aff_json(v[k])); return "{" + o.join(",") + "}";
}
var AFF_VID = /\.(mp4|mov|mkv|avi|mxf|m4v|webm|ts|mts|flv)$/i;
/* video files used in the open sequence */
function aff_seqFiles(){
  var seq = app.project.activeSequence; if (!seq) return aff_json({ error: "Open a sequence in Premiere first." });
  var seen = {}, F = [];
  for (var t = 0; t < seq.videoTracks.numTracks; t++) { var cl = seq.videoTracks[t].clips, n = cl.numItems;
    for (var k = 0; k < n; k++) { var p = ""; try { p = cl[k].projectItem.getMediaPath(); } catch (e) {} if (p && AFF_VID.test(p) && !seen[p]) { seen[p] = 1; F.push(p); } } }
  return aff_json({ files: F, name: seq.name });
}
/* every video file in the project */
function aff_projFiles(){
  var seen = {}, F = [];
  function walk(it){ for (var i = 0; i < it.children.numItems; i++) { var c = it.children[i];
      if (c.type === ProjectItemType.BIN) { walk(c); continue; }
      var p = ""; try { p = c.getMediaPath(); } catch (e) {} if (p && AFF_VID.test(p) && !seen[p]) { seen[p] = 1; F.push(p); } } }
  walk(app.project.rootItem); return aff_json({ files: F });
}
/* jump to a moment: in the open sequence if a clip shows it, otherwise open the file in the Source Monitor. js: {file, t} */
function aff_go(js){
  var J = eval("(" + js + ")"), seq = app.project.activeSequence, want = String(J.file).replace(/\\/g, "/").toLowerCase();
  if (seq) for (var tr = 0; tr < seq.videoTracks.numTracks; tr++) { var cl = seq.videoTracks[tr].clips, n = cl.numItems;
    for (var k = 0; k < n; k++) { var c = cl[k], p = ""; try { p = String(c.projectItem.getMediaPath()).replace(/\\/g, "/").toLowerCase(); } catch (e) {}
      if (p !== want) continue;
      var sp = 1; try { if (typeof c.getSpeed === "function") sp = c.getSpeed() || 1; } catch (e) {}
      var a = c.inPoint.seconds * sp, b = a + (c.end.seconds - c.start.seconds) * sp;   /* Premiere reports a speed-changed clip's In divided by its speed */
      if (J.t >= a - 0.05 && J.t <= b + 0.05) { var st = c.start.seconds + (J.t - a) / sp;
        try { seq.setPlayerPosition(String(Math.round(st * AFF_TPS))); } catch (e) {} return aff_json({ where: "sequence", t: st }); } } }
  try { app.sourceMonitor.openFilePath(J.file); } catch (e) { return aff_json({ error: "Couldn't open the file: " + e }); }
  try { app.enableQE(); var tc = J.t; qe.source.player.startScrubbing(); qe.source.player.scrubTo(String(Math.round(tc * AFF_TPS))); qe.source.player.endScrubbing(); } catch (e2) {}
  return aff_json({ where: "source", t: J.t });
}
"aff ok";
