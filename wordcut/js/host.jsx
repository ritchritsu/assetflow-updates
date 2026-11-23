// WordCut host (ExtendScript) - Premiere Pro
function wc_json(o){ // tiny JSON for ExtendScript
  if (o === null) return "null";
  var t = typeof o;
  if (t === "number" || t === "boolean") return String(o);
  if (t === "string") return '"' + o.replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"';
  if (o instanceof Array){ var a=[]; for (var i=0;i<o.length;i++) a.push(wc_json(o[i])); return "["+a.join(",")+"]"; }
  var p=[]; for (var k in o) p.push('"'+k+'":'+wc_json(o[k])); return "{"+p.join(",")+"}";
}
function wc_getSelected(){
  var seq = app.project.activeSequence;
  if (!seq) return wc_json({error:"Open a sequence first."});
  var sel = seq.getSelection(), best = null;
  for (var i=0;i<sel.length;i++){
    var it = sel[i];
    if (!it.projectItem || !it.projectItem.getMediaPath) continue;
    var mp = it.projectItem.getMediaPath();
    if (!mp) continue;
    if (!best || it.mediaType === "Audio") best = {path: mp, inPoint: it.inPoint.seconds,
        start: it.start.seconds, end: it.end.seconds, name: it.name};
  }
  if (!best) return wc_json({error:"Select a clip with audio on the timeline."});
  return wc_json(best);
}
var WC_TPF = {};   // ticks per frame, cached per sequence: reading sequence settings on every click made jumps slow on big projects
function wc_setPlayhead(sec){
  var seq = app.project.activeSequence; if (!seq) return "0";
  // snap UP to the first frame that starts at/after the word, so the playhead never lands on the previous word
  var TPS = 254016000000, id = seq.sequenceID, tpf = WC_TPF[id];
  if (!tpf) { tpf = 0; try { tpf = parseFloat(seq.getSettings().videoFrameRate.ticks); } catch(e) {} WC_TPF[id] = tpf || 1; tpf = WC_TPF[id]; }
  var ticks = sec * TPS; if (tpf > 1) ticks = Math.ceil(ticks / tpf - 1e-6) * tpf;
  seq.setPlayerPosition(String(Math.round(ticks))); return "1";
}
function wc_tc(sec, seq){
  var s = seq.getSettings(), t = new Time(); t.seconds = sec;
  return t.getFormatted(s.videoFrameRate, s.videoDisplayFormat);
}
// Fast apply: (1) razor only tracks that have media in each range, (2) delete pieces inside ranges in one pass,
// (3) shift every remaining clip ONCE by the total time removed before it. O(clips + ranges) instead of O(clips x ranges).
/* first clip on a track that ends after t (binary search: O(log n) instead of reading every clip on long timelines) */
function wc_idxAt(tr, t){ var lo = 0, hi = tr.clips.numItems; while (lo < hi){ var m = (lo + hi) >> 1; if (tr.clips[m].end.seconds <= t) lo = m + 1; else hi = m; } return lo; }
/* clip index range [k0, k1) on a track that overlaps [a, b] */
function wc_span(tr, a, b){ var n = tr.clips.numItems, k0 = wc_idxAt(tr, a), k1 = k0; while (k1 < n && tr.clips[k1].start.seconds < b) k1++; return [k0, k1]; }
/* linked video/audio pairs out of sync, but only for clips touching the given time windows: a cut can only break sync where it was made */
function wc_syncAt(seq, W){ var fd = 1/30, bad = 0; try { fd = seq.getSettings().videoFrameRate.seconds || fd; } catch(e) {}
  for (var i=0;i<seq.videoTracks.numTracks;i++){ var T = seq.videoTracks[i], seen = {}; if (!T.clips.numItems) continue;
    for (var w=0; w<W.length; w++){ var sp = wc_span(T, W[w][0], W[w][1]);
      for (var k=sp[0]; k<sp[1]; k++){ if (seen[k]) continue; seen[k] = 1; var c = T.clips[k], L = null; try { L = c.getLinkedItems(); } catch(e) {} if (!L) continue;
        for (var j=0;j<L.numItems;j++){ var a = L[j]; if (!a || a.mediaType !== "Audio") continue;
          if (Math.abs(a.start.seconds - c.start.seconds) > fd * 1.5 || Math.abs(a.inPoint.seconds - c.inPoint.seconds) > fd * 1.5) { bad++; break; } } } } }
  return bad; }
function wc_applyCuts(rangesJson, mode){
  mode = mode || "remove"; var xfade = /\+xfade$/.test(mode); mode = mode.replace(/\+xfade$/, "");
  var seq = app.project.activeSequence; if (!seq) return "No active sequence";
  var R = eval(rangesJson), i, k, g, r;
  // snap every cut to whole frames: un-snapped cuts left 1-frame gaps after the razor (which snaps) + move (which did not)
  var fd = 1/30; try { fd = seq.getSettings().videoFrameRate.seconds || fd; } catch(e) {}
  for (r=0;r<R.length;r++){ R[r][0] = Math.round(R[r][0]/fd)*fd; R[r][1] = Math.round(R[r][1]/fd)*fd; }
  R.sort(function(a,b){return a[0]-b[0];});
  var M = []; for (r=0;r<R.length;r++){ if (R[r][1]-R[r][0] < 0.04) continue; var L = M[M.length-1];
    if (L && R[r][0] <= L[1] + 0.001) L[1] = Math.max(L[1], R[r][1]); else M.push([R[r][0], R[r][1]]); }
  if (!M.length) return "Nothing to cut";
  var W0 = [], W1 = [], J = [], acc0 = 0, SW = 0.06;   // sync is checked only where the cuts are: before at both cut edges, after at the joins
  for (r=0;r<M.length;r++){ W0.push([M[r][0]-SW, M[r][0]+SW], [M[r][1]-SW, M[r][1]+SW]); J.push(M[r][0] - acc0); acc0 += M[r][1]-M[r][0]; }
  for (r=0;r<J.length;r++) W1.push([J[r]-SW, J[r]+SW]);
  var SB = 0; if (mode !== "markers") { try { SB = wc_syncAt(seq, W0); } catch(e) { SB = 0; } }
  var syncMsg = function(msg, W){ var n = 0; try { n = wc_syncAt(seq, W); } catch(e) {} return n > SB ? msg + " OUT_OF_SYNC " + (n - SB) : msg; };
  var S0 = seq.getSettings(), tcAt = function(t){ var tt = new Time(); tt.seconds = t; return tt.getFormatted(S0.videoFrameRate, S0.videoDisplayFormat); };
  var lo0 = M[0][0] - 0.05, hi0 = M[M.length-1][1] + 0.05;
  if (mode === "markers"){ var nm = 0;
    for (r=0;r<M.length;r++){ try { var mk = seq.markers.createMarker(M[r][0]); mk.end = M[r][1]; mk.name = "WordCut cut"; try { mk.setColorByIndex(1); } catch(e2) {} nm++; } catch(e) {} }
    return "Added " + nm + " cut marker(s) - nothing removed"; }
  var razors = 0, eps = 0.02, groups = [seq.videoTracks, seq.audioTracks];
  app.enableQE(); var q = qe.project.getActiveSequence(), qt = [[],[]];
  // right after a copy is opened, the QE engine can still point at the OLD sequence: razoring it would cut the wrong one
  try { if (!q || String(q.name) !== String(seq.name)) return "WAIT_QE"; } catch(e) { return "WAIT_QE"; }
  for (i=0;i<q.numVideoTracks;i++) qt[0].push(q.getVideoTrackAt(i));
  for (i=0;i<q.numAudioTracks;i++) qt[1].push(q.getAudioTrackAt(i));
  function inside(s, e){ var lo=0, hi=M.length-1; while (lo<=hi){ var m=(lo+hi)>>1; if (M[m][1] < s - eps) lo=m+1; else if (M[m][0] > e + eps) hi=m-1; else return s >= M[m][0]-eps && e <= M[m][1]+eps; } return false; }
  // 1) razor at cut edges, only where a clip spans the edge (empty spots and locked tracks are skipped)
  for (g=0; g<2; g++) for (i=0;i<groups[g].numTracks;i++){
    var tr = groups[g][i]; if (tr.isLocked && tr.isLocked()) continue;
    if (!tr.clips.numItems) continue; var sp0 = wc_span(tr, lo0, hi0), iv = [];
    for (k=sp0[0];k<sp0[1];k++){ var c = tr.clips[k]; iv.push([c.start.seconds, c.end.seconds]); }
    if (!iv.length) continue;
    for (r=M.length-1;r>=0;r--) for (var ed=1; ed>=0; ed--){ var t = M[r][ed];
      for (k=0;k<iv.length;k++) if (iv[k][0] < t - eps && iv[k][1] > t + eps){ qt[g][i].razor(tcAt(t)); razors++; break; } }
  }
  // 2) delete (or disable) every piece that lies inside a cut, one pass per track.
  //    Fast path: if EVERY track that continues past the first cut has a piece inside EVERY cut, Premiere's own ripple delete
  //    keeps all tracks in sync, so each track closes its gaps natively (instant) instead of moving hundreds of clips one by one.
  var removed = 0, rippleAll = (mode === "remove");
  if (rippleAll) for (g=0; g<2 && rippleAll; g++) for (i=0;i<groups[g].numTracks && rippleAll;i++){
    var trc = groups[g][i]; if (trc.isLocked && trc.isLocked()) { if (trc.clips.numItems) rippleAll = false; continue; }
    var later = false, hit = []; for (r=0;r<M.length;r++) hit.push(false); var sp1 = trc.clips.numItems ? wc_span(trc, lo0, hi0) : [0, 0];
    if (trc.clips.numItems && wc_idxAt(trc, M[0][0] + eps) < trc.clips.numItems) later = true;
    for (k=sp1[0];k<sp1[1];k++){ var cc = trc.clips[k], cs = cc.start.seconds, ce = cc.end.seconds;
      for (r=0;r<M.length;r++) if (cs >= M[r][0]-eps && ce <= M[r][1]+eps) hit[r] = true; }
    if (later) for (r=0;r<M.length;r++) if (!hit[r]) { rippleAll = false; break; } }
  for (g=0; g<2; g++) for (i=0;i<groups[g].numTracks;i++){
    var tr2 = groups[g][i]; if (tr2.isLocked && tr2.isLocked()) continue;
    if (!tr2.clips.numItems) continue; var sp2 = wc_span(tr2, lo0, hi0);
    for (k=sp2[1]-1;k>=sp2[0];k--){ var c2 = tr2.clips[k];
      if (inside(c2.start.seconds, c2.end.seconds)) { if (mode === "disable") { try { c2.disabled = true; } catch(e) {} } else { c2.remove(rippleAll, true); } removed++; } }
  }
  if (rippleAll && removed) { var xf = xfade ? +wc_xfadeAt("[" + J.join(",") + "]") : 0; return syncMsg("Applied " + M.length + " cut(s) [razors " + razors + ", removed " + removed + ", ripple, xfades " + xf + ", seq " + seq.name + "]", W1); }
  if (mode === "disable") return "Disabled " + removed + " piece(s) in " + M.length + " cut(s)";
  if (mode !== "lift" && removed === 0) return "NOTHING_REMOVED [razors " + razors + ", cuts " + M.length + ", first " + M[0][0].toFixed(2) + "-" + M[0][1].toFixed(2) + ", seq " + seq.name + "]";
  if (mode === "lift") return "Lifted " + M.length + " cut(s) (gaps left in place)";
  // 3) close the gaps: move each remaining clip once, left by the total cut time before it (keeps ALL tracks in sync)
  var cum = [], acc = 0; for (r=0;r<M.length;r++){ acc += M[r][1]-M[r][0]; cum.push([M[r][1], acc]); }
  function before(s){ var lo=0, hi=cum.length-1, best=0; while (lo<=hi){ var m=(lo+hi)>>1; if (cum[m][0] <= s + eps){ best = cum[m][1]; lo=m+1; } else hi=m-1; } return best; }
  var all = [];
  for (g=0; g<2; g++) for (i=0;i<groups[g].numTracks;i++){
    var tr3 = groups[g][i]; if (tr3.isLocked && tr3.isLocked()) continue;
    for (k=0;k<tr3.clips.numItems;k++){ var c3 = tr3.clips[k], s3 = c3.start.seconds, d = before(s3); if (d > 0.0005) all.push({c:c3, s:s3, d:d}); }
  }
  all.sort(function(a,b){return a.s-b.s;});
  var moved = 0;
  for (k=0;k<all.length;k++){ var it = all[k];
    if (Math.abs(it.c.start.seconds - it.s) > eps) continue;   // already moved as a linked partner
    var off = new Time(); off.seconds = -it.d; it.c.move(off); moved++; }
  var xf2 = xfade ? +wc_xfadeAt("[" + J.join(",") + "]") : 0;
  return syncMsg("Applied " + M.length + " cut(s) [razors " + razors + ", removed " + removed + ", moved " + moved + ", xfades " + xf2 + ", seq " + seq.name + "]", W1);
}
/* after cutting: a 2-frame Constant Power crossfade on every audio join, so cuts never click (QE; silently skipped if unsupported) */
function wc_xfadeJoins(seq, q, M){ var n = 0, fd = 1/30; try { fd = seq.getSettings().videoFrameRate.seconds || fd; } catch(e) {}
  var tr = null; try { tr = qe.project.getAudioTransitionByName("Constant Power"); } catch(e) {} if (!tr) return 0;
  var joins = [], acc = 0; for (var r=0;r<M.length;r++){ joins.push(M[r][0] - acc); acc += M[r][1]-M[r][0]; }
  for (var i=0;i<seq.audioTracks.numTracks;i++){ var T = seq.audioTracks[i]; if (T.isLocked && T.isLocked()) continue; var qtr = q.getAudioTrackAt(i);
    for (var k=1;k<T.clips.numItems;k++){ var c = T.clips[k], p = T.clips[k-1], st = c.start.seconds;
      if (Math.abs(p.end.seconds - st) > fd/2) continue; var hit = false; for (var j=0;j<joins.length;j++) if (Math.abs(joins[j] - st) < fd) { hit = true; break; } if (!hit) continue;
      try { for (var m=0;m<qtr.numItems;m++){ var qi = qtr.getItemAt(m); if (qi && qi.type === "Clip" && Math.abs(parseFloat(qi.start.secs) - st) < fd/2) { qi.addTransition(tr, true, "00:00:00:02", "00:00:00:00", 0.5, false, true); n++; break; } } } catch(e) {} } }
  return n; }
/* crossfade at given join times (seconds) on the active sequence: used after importing a new version */
function wc_xfadeAt(js){ var J = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq || !J.length) return "0"; app.enableQE(); var q = qe.project.getActiveSequence();
  /* fast path for big sequences: called with a few dozen sorted join times at a time; finds them by binary search instead of scanning every clip for every join */
  var fd = 1/30; try { fd = seq.getSettings().videoFrameRate.seconds || fd; } catch(e) {}
  var tr = null; try { tr = qe.project.getAudioTransitionByName("Constant Power"); } catch(e) {} if (!tr) return "0";
  J.sort(function(a, b){ return a - b; }); var n = 0;
  for (var i=0;i<seq.audioTracks.numTracks;i++){ var T = seq.audioTracks[i]; try { if (T.isLocked && T.isLocked()) continue; } catch(e) {}
    var qt = null; try { qt = q.getAudioTrackAt(i); } catch(e) {} if (!qt) continue; var N = qt.numItems; if (!N) continue;
    var stAt = function(m){ try { return parseFloat(qt.getItemAt(m).start.secs); } catch(e) { return -1; } };
    var lo = 0, hi = N - 1, t0 = J[0] - fd; while (lo < hi) { var mid = (lo + hi) >> 1; if (stAt(mid) < t0) lo = mid + 1; else hi = mid; }
    var j = 0; for (var m=lo; m<N && j<J.length; m++){ var qi = null; try { qi = qt.getItemAt(m); } catch(e) {} if (!qi) continue; var st = parseFloat(qi.start.secs);
      while (j < J.length && J[j] < st - fd/2) j++; if (j >= J.length) break;
      if (qi.type === "Clip" && m > 0 && Math.abs(J[j] - st) < fd/2) { try { qi.addTransition(tr, true, "00:00:00:02", "00:00:00:00", 0.5, false, true); n++; } catch(e) {} j++; } } }
  return String(n); }
function wc_getTracks(){
  var seq = app.project.activeSequence; if (!seq) return wc_json({error:"Open a sequence first."});
  var out = [];
  for (var i=0;i<seq.audioTracks.numTracks;i++){ var t=seq.audioTracks[i]; out.push({i:i, name:t.name || ("A"+(i+1)), n:t.clips.numItems}); }
  var pp=""; try{pp=app.project.path||"";}catch(e){} var fps=30; try{ fps = Math.round(1/seq.getSettings().videoFrameRate.seconds*100)/100; }catch(e){} var len=0, sin=0, sout=0; try{ len = parseFloat(seq.end)/254016000000; }catch(e){} try{ sin = parseFloat(seq.getInPoint()); sout = parseFloat(seq.getOutPoint()); }catch(e){}
  return wc_json({seq: seq.name, seqId: String(seq.sequenceID), proj: pp, fps: fps, len: len, sin: sin, sout: sout, tracks: out});
}
// cheap change detector: no media lookups, just clip positions (runs every 1.5 s, must stay tiny)
/* cheap change detector, runs every 1.5 s. Reading every clip of a 4000-piece sequence takes seconds and blocks Premiere
   (the transcript then can't follow the playhead), so big tracks are checked in slices: clip count + sequence end every time,
   the clips around the playhead every time, and a rotating window of the rest; any difference bumps a version number. */
var WC_SIG = {};
function wc_clipH(t, k){ var c = t.clips[k]; return Math.round(c.start.seconds*100) * 7 + Math.round(c.end.seconds*100) + Math.round(c.inPoint.seconds*100) * 3; }
function wc_trackSig(idx){ var seq = app.project.activeSequence; if (!seq) return "none";
  var t = seq.audioTracks[idx]; if (!t) return "none"; var n = t.clips.numItems, k;
  if (n <= 300) { var h = 0; for (k=0;k<n;k++) h = (h * 31 + wc_clipH(t, k)) % 2147483647; return seq.sequenceID + ":" + n + ":" + h; }
  var key = seq.sequenceID + "|" + idx, S = WC_SIG[key], end = ""; try { end = String(seq.end); } catch(e) {}
  /* clip count changed: start a fresh baseline lazily (re-reading every clip here took seconds on long streams, after every cut) */
  if (!S || S.n !== n) { S = WC_SIG[key] = { n: n, h: [], ver: S ? S.ver + 1 : 0, pos: 0 }; }
  var chk = function(k){ if (k < 0 || k >= n) return; var v = wc_clipH(t, k); if (S.h[k] === undefined) { S.h[k] = v; return; } if (S.h[k] !== v) { S.h[k] = v; S.ver++; } };
  var ph = 0; try { ph = seq.getPlayerPosition().seconds; } catch(e) {}
  var lo = 0, hi = n - 1; while (lo < hi) { var m = (lo + hi) >> 1; if (t.clips[m].end.seconds < ph) lo = m + 1; else hi = m; }
  for (k = lo - 6; k <= lo + 6; k++) chk(k);
  for (k = 0; k < 60; k++) chk((S.pos + k) % n); S.pos = (S.pos + 60) % n;
  return seq.sequenceID + ":" + n + ":" + end + ":" + S.ver; }
var WC_MP = {}, WC_MD = {};
/* after WordCut's own edit: forget the old baseline (everything after the edit shifted on purpose) and return the new signature */
function wc_sigRebase(idx){ var seq = app.project.activeSequence; if (!seq) return "none"; var t = seq.audioTracks[idx]; if (!t) return "none";
  var key = seq.sequenceID + "|" + idx, S = WC_SIG[key]; if (S) { S.h = []; S.n = t.clips.numItems; S.ver++; } return wc_trackSig(idx); }
/* read a track's clips in slices, so a background check never holds Premiere for more than a moment */
function wc_getTrackClipsSlice(js){ var P = eval("(" + js + ")"), seq = app.project.activeSequence; if (!seq) return wc_json({error:"Open a sequence first."});
  var t = seq.audioTracks[P[0]]; if (!t) return wc_json({error:"No such track"}); var n = t.clips.numItems, k0 = P[2] >= 0 ? P[2] : (P[1] > 0 ? wc_idxAt(t, P[1]) : 0), k1 = Math.min(n, k0 + P[3]);
  var r = wc_readClips(t, k0, k1); return wc_json({clips: r.out, skipped: r.skipped, next: k1, n: n}); }
function wc_readClips(t, k0, k1){ var out = [], skipped = 0;
  for (var k=k0;k<k1;k++){
    var c = t.clips[k], mp = "";
    try { var pi = c.projectItem; if (pi) { var nid = pi.nodeId; mp = WC_MP[nid]; if (!mp) { mp = pi.getMediaPath(); if (mp) WC_MP[nid] = mp; } } } catch(e) {}
    if (!mp) { skipped++; continue; }
    var td = c.end.seconds - c.start.seconds, md = c.outPoint.seconds - c.inPoint.seconds, sp = td > 0 ? md / td : 1;
    if (!(sp > 0) || Math.abs(sp - 1) < 0.002) sp = 1;
    out.push({path: mp, "in": c.inPoint.seconds, dur: td, mdur: td * sp, spd: sp, off: c.start.seconds, name: c.name});
  }
  return {out: out, skipped: skipped}; }
/* only the clips that end after 'from' (seconds): used after WordCut's own edits, where nothing before the edit changed */
function wc_getTrackClipsFrom(js){ var P = eval("(" + js + ")"); return wc_getTrackClips(P[0], P[1]); }
function wc_getTrackClips(idx, from){
  var seq = app.project.activeSequence; if (!seq) return wc_json({error:"Open a sequence first."});
  var t = seq.audioTracks[idx], out = [], skipped = 0; if (!t) return wc_json({error:"No such track"});
  for (var k=(from > 0 ? wc_idxAt(t, from) : 0);k<t.clips.numItems;k++){
    var c = t.clips[k], mp = "";
    try { var pi = c.projectItem; if (pi) { var nid = pi.nodeId; mp = WC_MP[nid]; if (!mp) { mp = pi.getMediaPath(); if (mp) WC_MP[nid] = mp; } } } catch(e) {}
    if (!mp) { skipped++; continue; }
    var td = c.end.seconds - c.start.seconds, md = c.outPoint.seconds - c.inPoint.seconds, sp = td > 0 ? md / td : 1;
    if (!(sp > 0) || Math.abs(sp - 1) < 0.002) sp = 1;
    out.push({path: mp, "in": c.inPoint.seconds, dur: td, mdur: td * sp, spd: sp, off: c.start.seconds, name: c.name});
  }
  return wc_json({clips: out, skipped: skipped});
}

function wc_import(p){ try { app.project.importFiles([p], true, app.project.getInsertionBin(), false); return "1"; } catch(e) { return "0"; } }

function wc_getPlayhead(){ var seq = app.project.activeSequence; if (!seq) return "-1";
  return String(seq.getPlayerPosition().seconds) + "|" + String(seq.sequenceID); }

/* ---------- Source mode (project items) ---------- */
function wc_findItem(nodeId, bin){
  bin = bin || app.project.rootItem;
  for (var i=0;i<bin.children.numItems;i++){ var c = bin.children[i];
    if (c.nodeId === nodeId) return c;
    if (c.type === 2 /* BIN */) { var r = wc_findItem(nodeId, c); if (r) return r; } }
  return null;
}
function wc_getProjectSelection(){
  var sel = []; try { sel = app.getCurrentProjectViewSelection() || []; } catch(e) {}
  var out = [];
  for (var i=0;i<sel.length;i++){ var it = sel[i], mp = "";
    try { mp = it.getMediaPath(); } catch(e) {}
    if (!mp) continue;
    var d = 0; try { d = it.getOutPoint().seconds - it.getInPoint().seconds; } catch(e) {}
    var fps = 30; try { var fr = it.getFootageInterpretation().frameRate; if (fr) fps = fr; } catch(e) {}
    out.push({ path: mp, nodeId: it.nodeId, name: it.name, dur: d, fps: fps });
  }
  if (!out.length) return wc_json({error:"Select a video or audio clip in the Project panel first."});
  return wc_json({ items: out, proj: app.project.path || "" });
}
function wc_srcMark(nodeId, a, b, open){
  var it = wc_findItem(nodeId); if (!it) return "Clip not found in project";
  try { it.clearInPoint && it.clearInPoint(); it.clearOutPoint && it.clearOutPoint(); } catch(e) {}
  it.setInPoint(a, 4); it.setOutPoint(b, 4);
  if (open) try { app.sourceMonitor.openProjectItem(it); } catch(e) {}
  return "1";
}
// move the Source Monitor playhead (clicking a word in Source mode). Premiere's scripting for this varies by version, so try each known way.
var WC_SM = "";
function wc_srcSeek(nodeId, sec){
  var it = wc_findItem(nodeId); if (!it) return "0";
  try { var cur = app.sourceMonitor.getProjectItem ? app.sourceMonitor.getProjectItem() : null; if (!cur || cur.nodeId !== it.nodeId) app.sourceMonitor.openProjectItem(it); } catch(e) {}
  var t = new Time(); t.seconds = sec; var tk = String(t.ticks), how = "";

  if (WC_SM === "a" || !WC_SM) { try { app.sourceMonitor.setPosition(t.seconds); how = "sm.setPosition"; WC_SM = "a"; } catch(e1) { WC_SM = ""; } }
  if (!how && (WC_SM === "b" || !WC_SM || WC_SM === "a")) { try { app.sourceMonitor.setPosition(tk); how = "sm.setPositionTicks"; WC_SM = "b"; } catch(e2) {} }
  if (!how) { try { app.enableQE(); var p = qe.source.player; if (p) { try { p.setPosition(tk); how = "qe.player"; } catch(e3) { try { p.seek(t.seconds); how = "qe.seek"; } catch(e4) {} } } } catch(e5) {} }
  if (!how) WC_SM = "";
  return how || "unsupported";
}
function wc_srcPos(){ try { var t = app.sourceMonitor.getPosition(); return String(t.seconds); } catch(e) { return "-1"; } }
function wc_srcInsert(nodeId, a, b, overwrite){
  var seq = app.project.activeSequence; if (!seq) return "Open a sequence to insert into";
  var it = wc_findItem(nodeId); if (!it) return "Clip not found in project";
  it.setInPoint(a, 4); it.setOutPoint(b, 4);
  var t = seq.getPlayerPosition();
  if (overwrite) seq.overwriteClip(it, t, 0, 0); else seq.insertClip(it, t, 0, 0);
  try { var nt = new Time(); nt.seconds = t.seconds + (b - a); seq.setPlayerPosition(nt.ticks); } catch(e) {}
  try { it.clearInPoint(); it.clearOutPoint(); } catch(e) {}
  return (overwrite ? "Overwrote " : "Inserted ") + (Math.round((b - a) * 10) / 10) + "s into " + seq.name;
}

/* ---------- History: backup copy of the sequence before each apply (survives quitting Premiere) ---------- */
function wc_histBin(){
  var root = app.project.rootItem;
  for (var i=0;i<root.children.numItems;i++){ var c = root.children[i]; if (c.type === 2 && c.name === "WordCut History") return c; }
  return root.createBin("WordCut History");
}
function wc_backup(label){
  var seq = app.project.activeSequence; if (!seq) return wc_json({error:"No active sequence"});
  var before = {}; for (var i=0;i<app.project.sequences.numSequences;i++) before[app.project.sequences[i].sequenceID] = 1;
  try { seq.clone(); } catch(e) { return wc_json({error:"Could not back up sequence: " + e}); }
  var copy = null; for (i=0;i<app.project.sequences.numSequences;i++){ var s = app.project.sequences[i]; if (!before[s.sequenceID]) copy = s; }
  if (!copy) return wc_json({error:"Backup copy not found"});
  try { copy.name = seq.name + " · " + label; } catch(e) {}
  try { copy.projectItem.moveBin(wc_histBin()); } catch(e) {}
  return wc_json({ id: String(copy.sequenceID), name: copy.name });
}
function wc_openSeq(id){
  for (var i=0;i<app.project.sequences.numSequences;i++){ var s = app.project.sequences[i];
    if (String(s.sequenceID) === String(id)) { try { app.project.openSequence(s.sequenceID); } catch(e) { app.project.activeSequence = s; } return "1"; } }
  return "That backup no longer exists in the project";
}

/* ---------- Apply on a copy: clone the active sequence next to the original and open it ---------- */
function wc_cloneOpen(label){
  var seq = app.project.activeSequence; if (!seq) return wc_json({error:"No active sequence"});
  var before = {}; for (var i=0;i<app.project.sequences.numSequences;i++) before[app.project.sequences[i].sequenceID] = 1;
  try { seq.clone(); } catch(e) { return wc_json({error:"Could not copy sequence: " + e}); }
  var copy = null; for (i=0;i<app.project.sequences.numSequences;i++){ var s = app.project.sequences[i]; if (!before[s.sequenceID]) copy = s; }
  if (!copy) return wc_json({error:"Copy not found"});
  try { copy.name = label; } catch(e) {}
  try { app.project.openSequence(copy.sequenceID); } catch(e) {}
  try { app.project.activeSequence = copy; } catch(e) {}
  var ok = app.project.activeSequence && String(app.project.activeSequence.sequenceID) === String(copy.sequenceID);
  return wc_json({ id: String(copy.sequenceID), name: copy.name, active: ok });
}
// after cutting: put the active (new) sequence in the same bin as the sequence it was copied from
function wc_fileActive(origId){
  try { var act = app.project.activeSequence, orig = null;
    for (var i=0;i<app.project.sequences.numSequences;i++) if (String(app.project.sequences[i].sequenceID) === String(origId)) orig = app.project.sequences[i];
    if (!act || !orig) return "0"; var parent = wc_findParentBin(orig.projectItem.nodeId); if (parent) act.projectItem.moveBin(parent); return "1"; } catch(e) { return "0"; } }
// export the active sequence the way Premiere itself writes XML, so we can copy its exact <file> definitions
function wc_exportXml(outPath){ try { var seq = app.project.activeSequence; if (!seq) return "0"; seq.exportAsFinalCutProXML(outPath, 1); return "1"; } catch(e) { return "ERR " + e; } }
function wc_seqNames(){ var n = []; for (var i=0;i<app.project.sequences.numSequences;i++) n.push(app.project.sequences[i].name); return wc_json({names: n}); }
// copy of the active sequence (uses the ORIGINAL project clips, proxies and links), named and filed next to the source
function wc_cloneVersion(name){
  var seq = app.project.activeSequence; if (!seq) return wc_json({error:"No active sequence"});
  var parent = null; try { parent = seq.projectItem ? wc_findParentBin(seq.projectItem.nodeId) : null; } catch(e) {}
  var before = {}; for (var i=0;i<app.project.sequences.numSequences;i++) before[app.project.sequences[i].sequenceID] = 1;
  try { seq.clone(); } catch(e) { return wc_json({error:"Could not copy sequence: " + e}); }
  var copy = null; for (i=0;i<app.project.sequences.numSequences;i++){ var s = app.project.sequences[i]; if (!before[s.sequenceID]) copy = s; }
  if (!copy) return wc_json({error:"Copy not found"});
  try { copy.name = name; } catch(e) {}
  try { if (parent) copy.projectItem.moveBin(parent); } catch(e) {}
  try { app.project.openSequence(copy.sequenceID); } catch(e) {} try { app.project.activeSequence = copy; } catch(e) {}
  var ok = app.project.activeSequence && String(app.project.activeSequence.sequenceID) === String(copy.sequenceID);
  return wc_json({ id: String(copy.sequenceID), name: copy.name, active: ok });
}
/* ---------- capability probe (shown in Diagnostics) ---------- */
function wc_probe(){
  var r = {}; try { app.enableQE(); var q = qe.project.getActiveSequence();
    var names = ["extract","lift","razor","removeEmptyTracks","rippleDelete"]; for (var i=0;i<names.length;i++) r["qeSeq." + names[i]] = typeof q[names[i]];
    var t = q.getAudioTrackAt(0); r["qeTrack.razor"] = typeof t.razor; r["qeTrack.rippleDelete"] = typeof t.rippleDelete;
    var it = t.getItemAt ? t.getItemAt(0) : null; if (it) { r["qeItem.rippleDelete"] = typeof it.rippleDelete; r["qeItem.remove"] = typeof it.remove; }
  } catch(e) { r.error = String(e); }
  try { var s = app.project.activeSequence; r["seq.clone"] = typeof s.clone; r["trackItem.move"] = s.audioTracks[0].clips.numItems ? typeof s.audioTracks[0].clips[0].move : "no clips"; } catch(e) {}
  r.version = app.version; return wc_json(r);
}

/* ---------- Instant versions: read the whole timeline so the panel can write an edited copy as FCP XML ---------- */
function wc_getAllClips(){
  var seq = app.project.activeSequence; if (!seq) return wc_json({error:"No active sequence"}); WC_MD = {};   /* lengths: fresh each read */
  var st = seq.getSettings(), fps = 30, w = 1920, h = 1080, sr = 48000;
  try { fps = 1 / st.videoFrameRate.seconds; } catch(e) {} try { w = st.videoFrameWidth; h = st.videoFrameHeight; } catch(e) {} try { sr = st.audioSampleRate.seconds ? 1 / st.audioSampleRate.seconds : 48000; } catch(e) {}
  function grab(tracks){ var T = [], skipped = 0;
    for (var i=0;i<tracks.numTracks;i++){ var tr = tracks[i], L = [];
      for (var k=0;k<tr.clips.numItems;k++){ try {   /* one odd clip never fails the whole read */
        var c = tr.clips[k], mp = "", md = 0, pi = null, nid = "";
        try { pi = c.projectItem; nid = pi ? String(pi.nodeId) : ""; } catch(e) {}
        /* media path and length are asked once per source file, not once per clip (each is a slow call into Premiere) */
        if (nid && WC_MP[nid]) mp = WC_MP[nid]; else { try { mp = pi ? pi.getMediaPath() : ""; } catch(e) {} if (nid && mp) WC_MP[nid] = mp; }
        if (!mp) { skipped++; continue; }
        if (nid && WC_MD[nid] != null) md = WC_MD[nid]; else { try { md = pi.getOutPoint(4).seconds; } catch(e) { try { md = pi.getOutPoint().seconds; } catch(e2) {} } if (nid) WC_MD[nid] = md; }
        var td = c.end.seconds - c.start.seconds, mdd = c.outPoint.seconds - c.inPoint.seconds, sp = td > 0 ? mdd / td : 1;
        var dis = false; try { dis = !!c.disabled; } catch(e) {}
        L.push({ path: mp, name: c.name, "in": c.inPoint.seconds, s: c.start.seconds, e: c.end.seconds, spd: Math.abs(sp - 1) < 0.002 ? 1 : sp, md: md, dis: dis });
      } catch(e) { skipped++; } }
      T.push(L); }
    return { T: T, skipped: skipped }; }
  var V = grab(seq.videoTracks), A = grab(seq.audioTracks), names = [];
  for (var s=0;s<app.project.sequences.numSequences;s++) names.push(app.project.sequences[s].name);
  return wc_json({ name: seq.name, fps: fps, w: w, h: h, sr: sr, v: V.T, a: A.T, skipped: V.skipped + A.skipped, names: names });
}
function wc_findParentBin(nodeId, bin){
  bin = bin || app.project.rootItem;
  for (var i=0;i<bin.children.numItems;i++){ var c = bin.children[i];
    if (c.nodeId === nodeId) return bin;
    if (c.type === 2) { var r = wc_findParentBin(nodeId, c); if (r) return r; } }
  return null;
}
function wc_importVersion(xmlPath, name){
  var cur = app.project.activeSequence, target = app.project.rootItem;
  var base0 = 0; try { base0 = wc_syncCheck(cur); } catch(e) {}
  try { var pb = cur && cur.projectItem ? wc_findParentBin(cur.projectItem.nodeId) : null; if (pb) target = pb; } catch(e) {}
  var before = {}, i; for (i=0;i<app.project.sequences.numSequences;i++) before[app.project.sequences[i].sequenceID] = 1;
  var kids = {}; for (i=0;i<target.children.numItems;i++) kids[target.children[i].nodeId] = 1;
  // remember each source file's proxy so the new sequence's copy of the footage gets the same proxy (XML import makes a fresh clip without one)
  var proxies = {}; try { var seen = {};
    for (var g=0; g<2; g++){ var trs = g ? cur.audioTracks : cur.videoTracks;
      for (var ti=0; ti<trs.numTracks; ti++) for (var ci=0; ci<trs[ti].clips.numItems; ci++){ var pi = trs[ti].clips[ci].projectItem; if (!pi || seen[pi.nodeId]) continue; seen[pi.nodeId] = 1;
        try { if (pi.hasProxy()) { var pp = pi.getProxyPath(); if (pp) proxies[pi.getMediaPath()] = pp; } } catch(e) {} } } } catch(e) {}
  try { app.project.importFiles([xmlPath], true, target, false); } catch(e) { return wc_json({error:"Import failed: " + e}); }
  var made = null; for (i=0;i<app.project.sequences.numSequences;i++){ var s = app.project.sequences[i]; if (!before[s.sequenceID]) made = s; }
  if (!made) return wc_json({error:"Premiere imported the edit but no new sequence appeared"});
  try { made.name = name; } catch(e) {}
  // put the sequence right next to the one it came from, and tidy up any bin the import created
  try { made.projectItem.moveBin(target); } catch(e) {}
  try { for (i=target.children.numItems-1;i>=0;i--){ var c = target.children[i];
      if (kids[c.nodeId] || c.type !== 2) continue;
      for (var k=c.children.numItems-1;k>=0;k--){ var m = c.children[k]; try { if (m.type !== 2) m.moveBin(target); } catch(e2) {} }
      if (c.children.numItems === 0) try { c.deleteBin(); } catch(e3) {} } } catch(e) {}
  // the import also adds the source recording as a loose master clip next to the new sequence: file it away in a "WordCut media" bin
  var dupes = 0; try { var loose = [];
    for (i=0;i<target.children.numItems;i++){ var c4 = target.children[i]; if (kids[c4.nodeId] || c4.type === 2) continue; if (c4.nodeId === made.projectItem.nodeId) continue; loose.push(c4); }
    dupes = loose.length; if (loose.length){ var mb = null; for (i=0;i<target.children.numItems;i++){ var c5 = target.children[i]; if (c5.type === 2 && c5.name === "WordCut media") { mb = c5; break; } }
      if (!mb) { target.createBin("WordCut media"); for (i=0;i<target.children.numItems;i++){ var c6 = target.children[i]; if (c6.type === 2 && c6.name === "WordCut media") { mb = c6; break; } } }
      if (mb) for (i=0;i<loose.length;i++) { try { loose[i].moveBin(mb); } catch(e7) {} } } } catch(e) {}
  // attach the proxies to every clip the new sequence uses
  try { var done = {};
    for (var g2=0; g2<2; g2++){ var trs2 = g2 ? made.audioTracks : made.videoTracks;
      for (var t2=0; t2<trs2.numTracks; t2++) for (var c2=0; c2<trs2[t2].clips.numItems; c2++){ var pj = trs2[t2].clips[c2].projectItem; if (!pj || done[pj.nodeId]) continue; done[pj.nodeId] = 1;
        try { var mp2 = pj.getMediaPath(); if (proxies[mp2] && !pj.hasProxy()) pj.attachProxy(proxies[mp2], 0); } catch(e8) {} } } } catch(e) {}
  try { app.project.openSequence(made.sequenceID); } catch(e) {} try { app.project.activeSequence = made; } catch(e) {}
  var oos = 0; try { oos = Math.max(0, wc_syncCheck(made) - base0); } catch(e) {}
  return wc_json({ dupes: dupes, oos: oos, id: String(made.sequenceID), name: made.name, active: String(app.project.activeSequence.sequenceID) === String(made.sequenceID) });
}

/* Premiere sometimes doesn't redraw clips moved by a script: touching each clip's selection forces a redraw */
/* after an edit: are any linked video/audio pairs out of sync? (same clip, different start or different source point) */
function wc_syncCheck(seq){ seq = seq || app.project.activeSequence; if (!seq) return 0; var fd = 1/30, bad = 0; try { fd = seq.getSettings().videoFrameRate.seconds || fd; } catch(e) {}
  for (var i=0;i<seq.videoTracks.numTracks;i++){ var T = seq.videoTracks[i];
    for (var k=0;k<T.clips.numItems;k++){ var c = T.clips[k], L = null; try { L = c.getLinkedItems(); } catch(e) {} if (!L) continue;
      for (var j=0;j<L.numItems;j++){ var a = L[j]; if (!a || a.mediaType !== "Audio") continue;
        if (Math.abs(a.start.seconds - c.start.seconds) > fd * 1.5 || Math.abs(a.inPoint.seconds - c.inPoint.seconds) > fd * 1.5) { bad++; break; } } } }
  return bad; }
var WC_SB = 0;
function wc_syncBase(seq){ try { WC_SB = wc_syncCheck(seq); } catch(e) { WC_SB = 0; } }
function wc_withSync(seq, msg){ var n = 0; try { n = wc_syncCheck(seq); } catch(e) {} return n > WC_SB ? msg + " OUT_OF_SYNC " + (n - WC_SB) : msg; }
function wc_refreshTl(seq){ seq = seq || app.project.activeSequence; if (!seq) return 0; var n = 0;
  for (var g=0; g<2; g++){ var G = g ? seq.audioTracks : seq.videoTracks; for (var i=0;i<G.numTracks;i++){ var T = G[i];
    for (var k=0;k<T.clips.numItems;k++){ try { var c = T.clips[k], was = c.isSelected(); c.setSelected(!was, true); c.setSelected(was, true); var d = c.disabled; c.disabled = !d; c.disabled = d; n++; } catch(e) {} } } }
  return n; }
function wc_dumpClips(){ wc_refreshTl(); var seq = app.project.activeSequence, o = []; if (!seq) return "no seq";
  for (var g=0; g<2; g++){ var G = g ? seq.audioTracks : seq.videoTracks; for (var i=0;i<G.numTracks;i++){ var T = G[i];
    var mu = ""; try { mu = T.isMuted() ? " MUTED" : ""; } catch(e) {} o.push("track " + (g?"A":"V") + (i+1) + mu + " clips " + T.clips.numItems);
    for (var k=0;k<T.clips.numItems;k++){ var c = T.clips[k]; o.push((g?"A":"V") + (i+1) + " " + c.start.seconds.toFixed(3) + "-" + c.end.seconds.toFixed(3) + " in " + c.inPoint.seconds.toFixed(3) + (c.disabled ? " DISABLED" : "") + " " + c.name); } } }
  try { var at = seq.audioTracks; for (var ti=0; ti<at.numTracks; ti++){ if (!at[ti].clips.numItems) continue; var cc = at[ti].clips[0], cs = [];
      for (var m=0;m<cc.components.numItems;m++){ var cm = cc.components[m], ps = []; for (var pp=0; pp<cm.properties.numItems; pp++){ var pr = cm.properties[pp], v = ""; try { v = pr.getValue(); } catch(e) {} ps.push(pr.displayName + "=" + v); } cs.push(cm.displayName + "{" + ps.join(",") + "}"); }
      o.push("A" + (ti+1) + " first clip components: " + cs.join(" | ")); try { o.push("  mediaType " + cc.mediaType + " channels? " + cc.projectItem.getAudioChannelMapping ? "" : ""); } catch(e) {} } } catch(e) { o.push("comp err " + e); }
  try { var pos = parseFloat(seq.getPlayerPosition().ticks) / 254016000000; o.push("--- clips near playhead " + pos.toFixed(2));
    for (var g2=0; g2<2; g2++){ var G2 = g2 ? seq.audioTracks : seq.videoTracks; for (var i2=0;i2<G2.numTracks;i2++){ var T2 = G2[i2];
      for (var k2=0;k2<T2.clips.numItems;k2++){ var c2 = T2.clips[k2]; if (c2.end.seconds < pos - 8 || c2.start.seconds > pos + 8) continue;
        var lab = "?", plab = "?"; try { lab = c2.getColorLabel(); } catch(e) {} try { plab = c2.projectItem.getColorLabel(); } catch(e) {}
        var cs2 = []; try { for (var m2=0;m2<c2.components.numItems;m2++){ var cm2 = c2.components[m2], ps2 = []; for (var q2=0; q2<cm2.properties.numItems; q2++){ var pr2 = cm2.properties[q2], v2 = "", tv2 = ""; try { v2 = pr2.getValue(); } catch(e) {} try { tv2 = pr2.isTimeVarying() ? "~" : ""; } catch(e) {} ps2.push(pr2.displayName + "=" + tv2 + v2); } cs2.push(cm2.displayName + "{" + ps2.join(",") + "}"); } } catch(e) { cs2.push("err " + e); }
        var ex = ""; try { ex += " speed=" + c2.getSpeed(); } catch(e) {} try { ex += " type=" + c2.type + " mt=" + c2.mediaType; } catch(e) {} try { ex += " node=" + c2.projectItem.nodeId; } catch(e) {}
        o.push((g2?"A":"V") + (i2+1) + "#" + k2 + " " + c2.start.seconds.toFixed(3) + "-" + c2.end.seconds.toFixed(3) + " label=" + lab + " itemLabel=" + plab + ex + " " + c2.name + " :: " + cs2.join(" | ")); } } } } catch(e) { o.push("near err " + e); }
  return o.join("\n"); }
/* windows around the edit points (sync is only checked where the move happened) */
function wc_win(P, sw){ var W = []; for (var i=0;i<P.length;i++) W.push([P[i]-sw, P[i]+sw]); return W; }
function wc_moveByInsert(seq, groups, A, B, T, L, eps, SB, W1){
  var P = [], g, i, k, lo = Math.min(A, T);
  for (g=0; g<2; g++) for (i=0;i<groups[g].numTracks;i++){ var tr = groups[g][i], n = tr.clips.numItems, later = false, cover = 0;
    if (!n) continue; later = wc_idxAt(tr, lo + eps) < n;
    if (tr.isLocked && tr.isLocked()) { if (later) return null; continue; }
    var sp = wc_span(tr, A - eps, B + eps);
    for (k=sp[0];k<sp[1];k++){ var c = tr.clips[k], s = c.start.seconds, e = c.end.seconds;
      if (s >= A - eps && e <= B + eps){ if (!c.projectItem) return null; cover += e - s;
        P.push({ g: g, i: i, s: s, e: e, pi: c.projectItem, ins: c.inPoint.seconds, outs: c.outPoint.seconds, c: c }); } }
    if (later && Math.abs(cover - L) > eps * 3) return null;   // a track with a gap or a partial clip there: inserts would knock tracks out of sync
  }
  if (!P.length) return null;
  P.sort(function(a,b){ return a.s - b.s || a.g - b.g; });
  for (k=P.length-1;k>=0;k--) { try { P[k].c.remove(true, true); } catch(e) { return "Couldn't lift the text out: " + e; } }
  var to = T < A ? T : T - L, made = 0, used = {};
  for (k=0;k<P.length;k++){ if (used[k]) continue; var p = P[k], vI = -1, aI = -1;
    // a video piece and its audio piece from the same file and time go in together as one linked clip
    for (var j=k;j<P.length;j++) if (!used[j] && Math.abs(P[j].s - p.s) < eps && P[j].pi.nodeId === p.pi.nodeId){ if (P[j].g === 0 && vI < 0) { vI = P[j].i; used[j] = 1; } else if (P[j].g === 1 && aI < 0) { aI = P[j].i; used[j] = 1; } }
    try { p.pi.setInPoint(p.ins, 4); p.pi.setOutPoint(p.outs, 4); } catch(e) {}
    var at = new Time(); at.seconds = to + (p.s - A);
    try { if (vI >= 0) seq.insertClip(p.pi, at, vI, aI < 0 ? 0 : aI); else groups[1][aI].insertClip(p.pi, at); made++; } catch(e) { return "Couldn't insert the text: " + e; }
    try { p.pi.clearInPoint(4); p.pi.clearOutPoint(4); } catch(e) {} }
  var n2 = 0; try { n2 = wc_syncAt(seq, W1); } catch(e) {}
  return "Moved [insert " + made + " of " + P.length + "]" + (n2 > SB ? " OUT_OF_SYNC " + (n2 - SB) : ""); }
/* ---------- move a stretch of the timeline [A,B] so it starts at T (in the SAME sequence) = drag-to-reorder by text ----------
   Only the clips around A, B and T are ever read: on a 2-hour stream this is a handful of clips instead of every clip, every pass. */
var WC_T0 = 0;
function wc_moveRange(js){ var P = eval("(" + js + ")"), A = P[0], B = P[1], T = P[2]; WC_T0 = new Date().getTime();
  var seq = app.project.activeSequence; if (!seq) return "No active sequence";
  var fd = 1/30; try { fd = seq.getSettings().videoFrameRate.seconds || fd; } catch(e) {}
  var snap = function(x){ return Math.round(x/fd)*fd; }; A = snap(A); B = snap(B); T = snap(T); var L = B - A, eps = fd/3;
  if (L < fd || (T >= A - eps && T <= B + eps)) return "Nothing to move";
  app.enableQE(); var q = qe.project.getActiveSequence(); try { if (!q || String(q.name) !== String(seq.name)) return "WAIT_QE"; } catch(e) { return "WAIT_QE"; }
  var SW = 0.06, W0 = wc_win([A, B, T], SW), W1 = wc_win(T < A ? [T, T + L, B] : [A, T - L, T], SW), SB = 0; try { SB = wc_syncAt(seq, W0); } catch(e) {}
  var S0 = seq.getSettings(), tcAt = function(t){ var tt = new Time(); tt.seconds = t; return tt.getFormatted(S0.videoFrameRate, S0.videoDisplayFormat); };
  var groups = [seq.videoTracks, seq.audioTracks], qt = [[],[]], i, k, g, razors = 0;
  for (i=0;i<q.numVideoTracks;i++) qt[0].push(q.getVideoTrackAt(i)); for (i=0;i<q.numAudioTracks;i++) qt[1].push(q.getAudioTrackAt(i));
  var cuts = [A, B, T];
  for (g=0; g<2; g++) for (i=0;i<groups[g].numTracks;i++){ var tr = groups[g][i]; if (tr.isLocked && tr.isLocked()) continue; if (!tr.clips.numItems) continue;
    for (var r=0;r<3;r++){ var x = cuts[r], kk = wc_idxAt(tr, x + eps); if (kk < tr.clips.numItems){ var c = tr.clips[kk]; if (c.start.seconds < x - eps){ qt[g][i].razor(tcAt(x)); razors++; } } } }
  var lo = Math.min(A, T), hi = Math.max(B, T), end = 0, items = [];
  for (g=0; g<2; g++) for (i=0;i<groups[g].numTracks;i++){ var tr2 = groups[g][i], n = tr2.clips.numItems; if (!n) continue; end = Math.max(end, tr2.clips[n-1].end.seconds);
    if (tr2.isLocked && tr2.isLocked()) continue; var sp = wc_span(tr2, lo - eps, hi + eps);
    for (k=sp[0];k<sp[1];k++){ var c2 = tr2.clips[k], s = c2.start.seconds, e = c2.end.seconds;
      if (s < lo - eps || e > hi + eps) continue;
      var dst = (s >= A - eps && e <= B + eps) ? (T < A ? T + (s - A) : T - L + (s - A)) : (T < A ? s + L : s - L);
      items.push({ g: g, i: i, s: s, cur: s, len: e - s, dst: dst, mv: s >= A - eps && e <= B + eps }); } }
  /* short moves: slide just the few clips between the two spots (fast). Long moves: ripple-delete the stretch and insert it back
     from the source (two native edits; each ripples the rest of the timeline, which costs seconds on a long stream) */
  if (items.length > 40 || !items.length) { var r2 = wc_moveByInsert(seq, groups, A, B, T, L, eps, SB, W1); if (r2) return r2 + " [insert " + (new Date().getTime() - WC_T0) + "ms]"; }
  if (!items.length) return "Nothing on the timeline there";
  var park = Math.ceil(end) + 10, moved = 0;
  /* track items are looked up fresh every time (Premiere's item objects can point at a different clip once clips move); binary search, not a scan */
  function find(it){ var tr = groups[it.g][it.i], n = tr.clips.numItems, k0 = wc_idxAt(tr, it.cur - eps);
    for (var m=Math.max(0, k0-1); m<Math.min(n, k0+3); m++){ var c = tr.clips[m]; if (Math.abs(c.start.seconds - it.cur) < eps && Math.abs((c.end.seconds - c.start.seconds) - it.len) < eps*2) return c; } return null; }
  function moveTo(it, to){ var c = find(it); if (!c) { // a linked partner may already have carried it
      it.cur = to; if (find(it)) return; it.lost = 1; return; }
    var d = to - c.start.seconds; if (Math.abs(d) < eps) { it.cur = to; return; } var tm = new Time(); tm.seconds = d; c.move(tm); it.cur = to; moved++; }
  for (k=0;k<items.length;k++) if (items[k].mv) moveTo(items[k], park + (items[k].s - A));
  var mid = [], park2 = park + L + 10; for (k=0;k<items.length;k++) if (!items[k].mv) mid.push(items[k]);
  for (k=0;k<mid.length;k++) moveTo(mid[k], park2 + (mid[k].s - lo));
  for (k=0;k<mid.length;k++) moveTo(mid[k], mid[k].dst);
  for (k=0;k<items.length;k++) if (items[k].mv) moveTo(items[k], items[k].dst);
  var bad = 0; for (k=0;k<items.length;k++) { items[k].cur = items[k].dst; if (!find(items[k])) bad++; }
  try { wc_refreshSpan(seq, lo - 1, hi + 1); } catch(e) {}
  var n3 = 0; try { n3 = wc_syncAt(seq, W1); } catch(e) {}
  return "Moved [razors " + razors + ", moves " + moved + (bad ? ", OFF " + bad : "") + ", slide " + (new Date().getTime() - WC_T0) + "ms]" + (n3 > SB ? " OUT_OF_SYNC " + (n3 - SB) : "");
}
/* redraw nudge only for the clips that moved (touching every clip of a 2-hour stream took many seconds) */
function wc_refreshSpan(seq, a, b){ var n = 0;
  for (var g=0; g<2; g++){ var G = g ? seq.audioTracks : seq.videoTracks; for (var i=0;i<G.numTracks;i++){ var T = G[i]; if (!T.clips.numItems) continue; var sp = wc_span(T, a, b);
    for (var k=sp[0];k<sp[1];k++){ try { var c = T.clips[k], was = c.isSelected(); c.setSelected(!was, true); c.setSelected(was, true); var d = c.disabled; c.disabled = !d; c.disabled = d; n++; } catch(e) {} } } }
  return n; }
function wc_deleteSeq(id){ for (var i=0;i<app.project.sequences.numSequences;i++){ var s = app.project.sequences[i]; if (String(s.sequenceID) === String(id)) { try { app.project.deleteSequence(s); return "1"; } catch(e) { return "ERR " + e; } } } return "0"; }
/* ---------- text selection -> sequence In/Out (like Premiere's text-based editing) ---------- */
function wc_setInOut(a, b){ var seq = app.project.activeSequence; if (!seq) return "0";
  try { seq.setInPoint(a); seq.setOutPoint(b); return "1"; } catch(e) { return "0"; } }
function wc_clearInOut(){ var seq = app.project.activeSequence; if (!seq) return "0";
  try { seq.setInPoint(0); seq.setOutPoint(parseFloat(seq.end) / 254016000000); return "1"; } catch(e) { return "0"; } }

/* Undo / redo the last Premiere edit (used when Ctrl+Z is pressed while the WordCut panel has focus) */
function wc_undo(redo){
  try { app.enableQE(); if (redo) { if (qe.project.redo) { qe.project.redo(); return "qe"; } } else if (qe.project.undo) { qe.project.undo(); return "qe"; } } catch(e) {}
  try { if (app.findMenuCommandId && app.executeCommand) { var id = app.findMenuCommandId(redo ? "Redo" : "Undo"); if (id) { app.executeCommand(id); return "menu"; } } } catch(e2) {}
  return "unsupported";
}

/* Captions: import the SRT WordCut wrote and put it on a new caption track of the active sequence */
function wc_captionTrack(p){
  var seq = app.project.activeSequence; if (!seq) return "No active sequence";
  var root = app.project.rootItem, bin = null;
  for (var i=0;i<root.children.numItems;i++){ var c = root.children[i]; if (c.type === 2 && c.name === "WordCut captions") bin = c; }
  if (!bin) bin = root.createBin("WordCut captions");
  try { app.project.importFiles([p], true, bin, false); } catch(e) { return "Import failed: " + e; }
  var item = null, want = String(p).replace(/\//g,"\\").toLowerCase();
  for (i=bin.children.numItems-1;i>=0;i--){ var it = bin.children[i]; try { if (String(it.getMediaPath()).replace(/\//g,"\\").toLowerCase() === want) { item = it; break; } } catch(e2) {} }
  if (!item) return "Captions imported into the 'WordCut captions' bin - drag them onto the timeline";
  if (!seq.createCaptionTrack) return "This Premiere version can't add caption tracks from scripts - drag the captions from the 'WordCut captions' bin onto the timeline";
  try { var fmt = (typeof Sequence !== "undefined" && Sequence.CAPTION_FORMAT_SUBTITLE) ? Sequence.CAPTION_FORMAT_SUBTITLE : undefined;
        var ok = fmt !== undefined ? seq.createCaptionTrack(item, 0, fmt) : seq.createCaptionTrack(item, 0); return "OK" + (ok === false ? " - Premiere reported a problem" : ""); }
  catch(e3) { return "Couldn't create the caption track (" + e3 + ") - the captions are in the 'WordCut captions' bin"; }
}
