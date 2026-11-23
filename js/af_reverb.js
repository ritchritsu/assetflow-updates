/* AssetFlow — Reverb & FX: Editor-Josh-style audio effects for Premiere clips (21 presets in three groups:
   Spaces = room, tiled bathroom, hall, cathedral, cave, stadium announcer, far-away voice; Creative = reverse reverb, reverse echo, shimmer,
   gated 80s, vocal plate, echo out, dub echo throw, slap echo; Character = telephone, megaphone, underwater, muffled, dream/flashback,
   voice of god). Select audio clips in the timeline, pick an effect, Apply. Each clip is rendered with the bundled ffmpeg
   (no plugins, works on any PC) and the clip itself is swapped for the result, EXTENDED so the reverb tail rings out (or the swell plays
   before it), like Editor Josh's Final Cut reverbs: no nesting, no duplicate. If the next clip starts right away, the rest of the tail
   continues on a free track so nothing is cut off. Undo puts the original audio back. */
(function(){
"use strict";
let fs, path, cp, os; try { fs = require("fs"); path = require("path"); cp = require("child_process"); os = require("os"); } catch (e) { return; }
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const blog = m => { try { window._afBootLog && _afBootLog("Reverb: " + m); } catch (e) {} };
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("timeout"); } }, 120000);
  try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : r(""); } catch (e) { r(""); } });
function extDir(){
  try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || "";
    if (raw) { const t = decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, "")); return process.platform === "win32" ? path.normalize(t) : "/" + t.replace(/^\/+/, ""); } } catch (e) {}
  try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
let jsxReady = null;
function host(){ if (!jsxReady) jsxReady = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_reverb.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/afr ok/.test(r || "")) jsxReady = null; return r; }); return jsxReady; }
async function callJ(fn, arg){ const h = await host(); if (!/afr ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 100) + ")");
  const r = await jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(typeof arg === "string" ? arg : JSON.stringify(arg))) + ")");
  let o; try { o = JSON.parse(r); } catch (e) { throw new Error("Premiere answered: " + String(r).slice(0, 120)); } if (o && o.error) throw new Error(o.error); return o; }
const ffmpeg = () => { for (const p of [path.join(extDir(), "ffmpeg.exe"), path.join(extDir(), "ffmpeg")]) { try { if (fs.existsSync(p)) return p; } catch (e) {} } return "ffmpeg"; };
const HOME = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AssetFlow", "fx"), REN = path.join(HOME, "renders");

/* ---------- engine (presets, impulse responses, ffmpeg commands) ---------- */
/* AssetFlow Reverb & FX engine (ffmpeg only, no plugins): presets, impulse responses, render commands. Shared by the panel and the tests. */
/* Preset fields (all optional except id/name/kind):
   kind  verb | reverse | tailout | echo | phone
   t60/lp/hp/pre/gate  impulse response: decay to -60 dB (s), darkening low-pass, high-pass, pre-delay (ms), gate = hard cut after N s (80s gated)
   wet   reverb level 0..1 (the Amount slider)   tail  seconds the clip is extended by
   pre_  chain on the whole sound first (e.g. pitch)   dry  chain on the dry voice only   wetPre/wetPost  chains before/after the reverb
   echo  aecho settings instead of a reverb (reverse/tailout)   lead/last  seconds used for a swell / an echo-out
   cat   which group the card sits in */
const OCT_UP = "asetrate=96000,aresample=48000,atempo=0.5";                      // octave up, same length (shimmer)
const DEEPER = "asetrate=42770,aresample=48000,atempo=1.12233";                 // 2 semitones down, same length (voice of god)
const PRESETS = [
  /* spaces */
  { cat: "Spaces", id: "room", name: "Small room", tip: "A little space around the voice, like a real room. Subtle.", kind: "verb", t60: 0.6, lp: 7000, pre: 8, wet: 0.22, tail: 0.6 },
  { cat: "Spaces", id: "bathroom", name: "Tiled bathroom", tip: "Bright, splashy, close walls: bathrooms, stairwells, school hallways.", kind: "verb", t60: 0.9, lp: 11000, hp: 200, pre: 3, wet: 0.33, tail: 0.9 },
  { cat: "Spaces", id: "hall", name: "Big hall", tip: "Concert-hall reverb with a tail that rings past the clip.", kind: "verb", t60: 2.2, lp: 5200, pre: 25, wet: 0.32, tail: 2.2 },
  { cat: "Spaces", id: "cathedral", name: "Cathedral", tip: "Huge, epic, dramatic. Long tail.", kind: "verb", t60: 4.5, lp: 4200, pre: 45, wet: 0.42, tail: 4.0 },
  { cat: "Spaces", id: "cave", name: "Cave / dungeon", tip: "Dark rock walls with distinct early bounces. Mines, dungeons, tunnels.", kind: "verb", t60: 3.2, lp: 2600, pre: 30, wet: 0.45, tail: 3.0, wetPre: "aecho=0.8:0.7:70|150|240:0.45|0.3|0.2" },
  { cat: "Spaces", id: "stadium", name: "Stadium announcer", tip: "Arena PA: big space plus the long echo bouncing back off the stands.", kind: "verb", t60: 2.8, lp: 4500, pre: 60, wet: 0.4, tail: 3.0, dry: "highpass=f=150", wetPost: "aecho=0.8:0.6:320|640:0.45|0.25" },
  { cat: "Spaces", id: "distant", name: "Far away voice", tip: "Someone calling from across the room or off-screen: thinner, quieter, more room than voice.", kind: "verb", t60: 1.8, lp: 5000, pre: 20, wet: 0.5, tail: 1.6, dry: "highpass=f=350,lowpass=f=2800,volume=0.5" },
  /* creative */
  { cat: "Creative", id: "reverse", name: "Reverse reverb (swell in)", tip: "The ghostly swell that rises INTO the first word. The clip is extended back so the swell plays before it.", kind: "reverse", t60: 2.6, lp: 6500, pre: 0, wet: 0.9, tail: 2.6, lead: 1.2 },
  { cat: "Creative", id: "revecho", name: "Reverse echo", tip: "Stuttering echoes that build up into the first word, like a rewind.", kind: "reverse", echo: "aecho=0.8:0.8:110|220|330|440:0.6|0.45|0.3|0.2", wet: 0.9, tail: 1.1, lead: 0.7 },
  { cat: "Creative", id: "shimmer", name: "Shimmer", tip: "Reverb with an octave-up glow on the tail. Angelic, magical, emotional moments.", kind: "verb", t60: 4.0, lp: 9000, pre: 30, wet: 0.35, tail: 3.5, wetPre: OCT_UP },
  { cat: "Creative", id: "gated", name: "Gated (80s punch)", tip: "Big reverb that cuts off dead. Punchy shouts, impacts, hype lines.", kind: "verb", t60: 2.0, gate: 0.32, lp: 8000, pre: 5, wet: 0.45, tail: 0.4 },
  { cat: "Creative", id: "plate", name: "Vocal plate", tip: "Smooth, bright, dense studio vocal reverb. Music-video polish.", kind: "verb", t60: 1.6, lp: 9500, hp: 300, pre: 15, wet: 0.3, tail: 1.6 },
  { cat: "Creative", id: "echoout", name: "Echo out (last word rings)", tip: "The end of the clip keeps ringing after the cut. The clip is extended so it rings out.", kind: "tailout", t60: 3.0, lp: 5500, pre: 20, wet: 0.8, tail: 3.0, last: 0.8 },
  { cat: "Creative", id: "dubecho", name: "Dub echo throw", tip: "The last word repeats and fades into the distance (1/4-note delays, darker each time).", kind: "tailout", echo: "aecho=0.8:0.9:375|750|1125|1500:0.55|0.38|0.25|0.15,highpass=f=300,lowpass=f=2500", wet: 0.9, tail: 3.0, last: 0.6 },
  { cat: "Creative", id: "slap", name: "Slap echo", tip: "Quick repeats, like shouting in a canyon or a cartoon echo.", kind: "echo", taps: "120|240|360", decays: "0.5|0.3|0.15", tail: 0.6 },
  /* character */
  { cat: "Character", id: "phone", name: "Telephone / radio", tip: "Thin, boxy voice: phone calls, walkie-talkies, radio.", kind: "phone", tail: 0 },
  { cat: "Character", id: "megaphone", name: "Megaphone", tip: "Bullhorn / PA speaker: narrow, distorted, with a short slap off the buildings.", kind: "verb", t60: 0.4, lp: 4000, pre: 5, wet: 0.2, tail: 0.5, dry: "highpass=f=700,highpass=f=700,lowpass=f=3200,lowpass=f=3200,volume=6,asoftclip=type=atan,volume=1.0,aecho=0.8:0.5:85:0.25" },
  { cat: "Character", id: "underwater", name: "Underwater", tip: "Deep, wobbly, swallowed by water. Drowning, dream-sinking, blackout moments.", kind: "verb", t60: 1.2, lp: 500, pre: 10, wet: 0.3, tail: 1.0, dry: "lowpass=f=450,lowpass=f=450,vibrato=f=5:d=0.25,volume=3.3" },
  { cat: "Character", id: "muffled", name: "Muffled (next room)", tip: "Heard through a wall or a closed door.", kind: "verb", t60: 0.5, lp: 650, pre: 5, wet: 0.35, tail: 0.5, pre_: "lowpass=f=650,lowpass=f=650,volume=2" },
  { cat: "Character", id: "dream", name: "Dream / flashback", tip: "Soft, chorused and far away: memories, flashbacks, inner thoughts.", kind: "verb", t60: 3.5, lp: 6000, pre: 40, wet: 0.5, tail: 3.0, dry: "lowpass=f=7000,chorus=0.6:0.9:45|55:0.35|0.3:0.25|0.4:2|2.5", wetPre: "chorus=0.6:0.9:45|55:0.35|0.3:0.25|0.4:2|2.5" },
  { cat: "Character", id: "godvoice", name: "Voice of god", tip: "Deeper voice in a vast space. Epic narrator, boss, prophecy.", kind: "verb", t60: 3.0, lp: 5000, pre: 35, wet: 0.4, tail: 3.0, pre_: DEEPER, dry: "bass=g=4" }
];
/* the ffmpeg input chain for the channels a clip actually plays. streams: channel count of each audio stream in the file;
   n: how many audio clips the file was split into on the timeline (linked together); k: which of them this clip is (0-based) */
function pickFor(streams, n, k){
  const C = (streams || []).reduce((x, y) => x + y, 0); if (!C || !(n > 1) || k == null || k < 0 || k >= n) return "";
  const per = C / n; if (per !== Math.floor(per) || per < 1) return "";
  const a = k * per, b = per >= 2 ? a + 1 : a;
  const head = streams.length > 1 ? streams.map((x, i) => "[0:a:" + i + "]").join("") + "amerge=inputs=" + streams.length + "," : "[0:a]";
  return head + "pan=stereo|c0=c" + a + "|c1=c" + b + ","; }
/* the clip as it sounds now, no effect (kept so Undo can put exactly this back) */
function dryArgs(src, a, b, out, pick){ return ["-hide_banner", "-y", "-ss", a.toFixed(4), "-t", (b - a).toFixed(4), "-i", src, "-filter_complex", (pick || "[0:a]") + fmt + "[o]", "-map", "[o]", "-c:a", "pcm_s24le", out]; }
/* impulse response: decaying stereo noise (two different noise seeds = wide), -60 dB at t60, darker as it decays; gate = flat then a hard stop */
function irArgs(p, out){
  const g = p.gate || 0, d = g ? g + 0.02 : Math.max(0.3, p.t60 * 1.15), k = (6.9 / p.t60).toFixed(4), pre = Math.max(0, p.pre || 0);
  const env = g ? "if(lt(t\\," + g + ")\\,1-0.35*t/" + g + "\\,0)" : "exp(-" + k + "*t)";
  return ["-hide_banner", "-y", "-f", "lavfi", "-i", "anoisesrc=d=" + d.toFixed(2) + ":c=white:r=48000:a=0.5:s=7", "-f", "lavfi", "-i", "anoisesrc=d=" + d.toFixed(2) + ":c=white:r=48000:a=0.5:s=13",
    "-filter_complex", "[0][1]amerge=inputs=2,aeval=val(0)*" + env + "|val(1)*" + env + ":c=stereo,lowpass=f=" + p.lp + ",highpass=f=" + (p.hp || 140) + (pre ? ",adelay=" + pre + "|" + pre : ""),
    "-ac", "2", "-c:a", "pcm_f32le", out]; }
/* which way this ffmpeg normalises an impulse response (the option changed name in ffmpeg 6) */
function afirFor(helpText){ return /irnorm/.test(helpText || "") ? "afir=irnorm=2" : /gtype/.test(helpText || "") ? "afir=gtype=gn" : "afir"; }
/* the limiter delays the sound by its 5 ms look-ahead unless told to compensate (latency=1, ffmpeg 5.1+): without it the voice drifts off the lips */
let LIM = "alimiter=limit=0.97:level=false:latency=1";
function limFor(helpText){ LIM = /latency/.test(helpText || "") ? "alimiter=limit=0.97:level=false:latency=1" : "alimiter=limit=0.97:level=false:attack=0.1"; return LIM; }
const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
const C_ = s => s ? "," + s : "";
const END = x => ",apad,atrim=end_sample=" + Math.round(x * 48000);   // the file is exactly as long as reported (echo/pitch filters add or lose a few ms)
/* one render: src file, media [a,b] (seconds), preset p, wet 0..1 (null = preset default) -> ffmpeg args.
   Returns {args, pre, len}: the rendered file is the WHOLE clip with the effect; it starts `pre` seconds before the clip (a swell) and runs to `len` (tail included) */
function renderArgs(src, a, b, p, wet, ir, out, afir, pick){
  const IN = pick || "[0:a]";   // pick: which channels of the file this clip plays (a clip can be one channel of a split stereo/multitrack file)
  afir = afir || "afir=irnorm=2";   // the IR's energy is normalised, so the wet level means the same for short and long reverbs (older ffmpeg: afir=gtype=gn)
  const w = (wet == null ? p.wet : wet), len = b - a, tail = p.tail || 0, A = ["-hide_banner", "-y", "-ss", a.toFixed(4), "-t", len.toFixed(4), "-i", src];
  const enc = ["-map", "[o]", "-c:a", "pcm_s24le", out];
  if (p.kind === "verb" || p.kind === "muffle") {
    const wetIn = p.wetPre ? "[s]" + p.wetPre + "[s2];[s2][1:a]" : "[s][1:a]", dryOut = p.dry ? "[d]" + p.dry + "[dd];" : "[d]anull[dd];";
    return { args: A.concat(["-i", ir, "-filter_complex", IN + fmt + C_(p.pre_) + ",apad=pad_dur=" + tail.toFixed(2) + ",asplit=2[d][s];" + dryOut + wetIn + afir + ",volume=" + w.toFixed(3) + C_(p.wetPost) + "[wv];[dd][wv]amix=inputs=2:duration=first:normalize=0," + LIM + END(len + tail) + "[o]"], enc), pre: 0, len: len + tail }; }
  if (p.kind === "reverse") {   // the whole clip, with a swell in front of it: the start of the clip reversed, reverbed (or echoed), reversed back (it now comes BEFORE the sound)
    const L = Math.min(len, p.lead || 1.2), ns = Math.round(tail * 48000);
    const fx = p.echo ? "[x]" + p.echo + ",volume=" + w.toFixed(3) : "[x][1:a]" + afir + ",volume=" + w.toFixed(3);
    return { args: A.concat(p.echo ? [] : ["-i", ir], ["-filter_complex", IN + fmt + ",asplit=2[d][s];[s]atrim=end=" + L.toFixed(4) + ",asetpts=PTS-STARTPTS,areverse,apad=pad_dur=" + tail.toFixed(4) + "[x];" + fx + ",areverse,afade=t=out:st=" + (tail + L * 0.6).toFixed(4) + ":d=" + (L * 0.4).toFixed(4) + "[sw];[d]adelay=" + ns + "S|" + ns + "S[dd];[sw][dd]amix=inputs=2:duration=longest:normalize=0," + LIM + END(ns / 48000 + len) + "[o]"], enc), pre: ns / 48000, len: ns / 48000 + len }; }
  if (p.kind === "tailout") {   // the whole clip, and its last words keep ringing (reverb or echoes) after the cut
    const L = Math.min(len, p.last || 0.8), ns = Math.round((len - L) * 48000);
    const fx = p.echo ? "[x]" + p.echo + ",volume=" + w.toFixed(3) : "[x][1:a]" + afir + ",volume=" + w.toFixed(3);
    return { args: A.concat(p.echo ? [] : ["-i", ir], ["-filter_complex", IN + fmt + ",asplit=2[d][s];[s]atrim=start=" + (len - L).toFixed(4) + ",asetpts=PTS-STARTPTS,apad=pad_dur=" + tail.toFixed(4) + "[x];" + fx + ",afade=t=in:st=0:d=" + (L * 0.5).toFixed(4) + ",adelay=" + ns + "S|" + ns + "S[e];[d][e]amix=inputs=2:duration=longest:normalize=0," + LIM + END(len + tail) + "[o]"], enc), pre: 0, len: len + tail }; }
  if (p.kind === "echo") {
    return { args: A.concat(["-filter_complex", IN + fmt + ",apad=pad_dur=" + tail.toFixed(2) + ",aecho=0.9:0.9:" + p.taps + ":" + p.decays + "," + LIM + END(len + tail) + "[o]"], enc), pre: 0, len: len + tail }; }
  if (p.kind === "phone") {
    return { args: A.concat(["-filter_complex", IN + fmt + ",highpass=f=320,highpass=f=320,lowpass=f=3200,lowpass=f=3200,acompressor=threshold=0.1:ratio=6:attack=5:release=60,volume=2.4," + LIM + END(len) + "[o]"], enc), pre: 0, len }; }
  throw new Error("unknown preset " + p.id); }
function run(args){ return new Promise(res => { let p, err = ""; try { p = cp.spawn(ffmpeg(), args, { windowsHide: true }); } catch (e) { return res({ ok: false, err: e.message }); }
  p.stderr.on("data", d => { err = (err + d).slice(-1500); }); p.on("error", e => res({ ok: false, err: e.message })); p.on("close", c => res({ ok: c === 0, err: err.trim().split("\n").pop() || "exit " + c })); }); }
let AFIR = null;
async function afirOpt(){ if (AFIR) return AFIR; const help = await new Promise(res => { let out = ""; try { const p = cp.spawn(ffmpeg(), ["-hide_banner", "-h", "filter=afir"], { windowsHide: true }); p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d); p.on("close", () => res(out)); p.on("error", () => res("")); } catch (e) { res(""); } });
  const lh = await new Promise(res => { let out = ""; try { const p = cp.spawn(ffmpeg(), ["-hide_banner", "-h", "filter=alimiter"], { windowsHide: true }); p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d); p.on("close", () => res(out)); p.on("error", () => res("")); } catch (e) { res(""); } });
  limFor(lh); AFIR = afirFor(help); if (!/afir/.test(help)) throw new Error("The bundled ffmpeg has no convolution reverb (afir). Reinstall AssetFlow to get the full ffmpeg."); return AFIR; }
/* length of a rendered WAV straight from its header (no ffprobe needed) */
function wavSecs(f){ try { const fd = fs.openSync(f, "r"), b = Buffer.alloc(4096); fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd); let rate = 48000, ch = 2, bits = 24, i = 12;
  while (i + 8 < b.length) { const id = b.toString("ascii", i, i + 4), sz = b.readUInt32LE(i + 4);
    if (id === "fmt ") { ch = b.readUInt16LE(i + 10); rate = b.readUInt32LE(i + 12); bits = b.readUInt16LE(i + 22); }
    if (id === "data") { const real = Math.min(sz, fs.statSync(f).size - i - 8); return real / (rate * ch * bits / 8); } i += 8 + sz + (sz & 1); } } catch (e) {} return 0; }
/* channel count of each audio stream in a media file, from ffmpeg's own report (cached) */
const STR = new Map();
function streamsOf(f){ if (STR.has(f)) return Promise.resolve(STR.get(f));
  return new Promise(res => { let out = ""; try { const q = cp.spawn(ffmpeg(), ["-hide_banner", "-i", f], { windowsHide: true }); q.stderr.on("data", d => out += d); q.on("error", () => res([])); q.on("close", () => {
      const L = []; out.split("\n").forEach(l => { const m = /Stream #\d+:\d+.*?: Audio: .*?\d+ Hz, ([^,]+)/.exec(l); if (!m) return; const t = m[1].trim(), n = /(\d+) channels/.exec(t);
        L.push(n ? +n[1] : ({ mono: 1, stereo: 2, "2.1": 3, "3.0": 3, "3.0(back)": 3, "4.0": 4, quad: 4, "quad(side)": 4, "5.0": 5, "5.0(side)": 5, "5.1": 6, "5.1(side)": 6, "6.0": 6, "6.1": 7, "7.0": 7, "7.1": 8, "7.1(wide)": 8 })[t] || 2); });
      STR.set(f, L); res(L); }); } catch (e) { res([]); } }); }
const hash = s => require("crypto").createHash("sha1").update(s).digest("hex").slice(0, 16);
async function irFor(p){ if (!p.t60 || p.echo) return null; fs.mkdirSync(HOME, { recursive: true }); const f = path.join(HOME, "ir_" + p.id + "_" + hash([p.t60, p.lp, p.hp, p.pre, p.gate].join("|")).slice(0, 8) + ".wav"); if (fs.existsSync(f) && fs.statSync(f).size > 1000) return f;
  const r = await run(irArgs(p, f)); if (!r.ok) throw new Error("Couldn't build the " + p.name + " reverb: " + r.err); return f; }

/* ---------- UI ---------- */
document.head.appendChild(el("style", null,
  "#afr-panel{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09);position:relative;z-index:2}" +
  "#afr-panel.open{display:flex}.afr-wrap{padding:16px 14px;display:flex;flex-direction:column;gap:12px}.afr-h{font-size:14px;font-weight:600;color:var(--text,#eee)}.afr-p{font-size:11px;color:var(--text3,#999);line-height:1.5;margin-top:3px}" +
  ".afr-cat{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#888);margin:4px 0 -4px}.afr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.afr-fx{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:9px 10px;cursor:pointer;text-align:left;color:var(--text,#ddd)}" +
  ".afr-fx b{display:block;font-size:11.5px;font-weight:600}.afr-fx i{display:block;font-style:normal;font-size:10px;color:var(--text3,#888);margin-top:3px;line-height:1.4}.afr-fx.on{border-color:var(--accent,#0a84ff);background:rgba(10,132,255,.12)}" +
  ".afr-row{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text2,#bbb)}.afr-row input[type=range]{flex:1}.afr-row b{min-width:34px;text-align:right;color:var(--text,#eee)}" +
  ".afr-go{--p:0%;width:100%;padding:11px 12px;font-size:13px;font-weight:600;border-radius:9px;border:0;color:#fff;cursor:pointer;background:linear-gradient(90deg,rgba(255,255,255,.18) var(--p),transparent var(--p)),var(--accent,#0a84ff)}.afr-go:disabled{cursor:default;opacity:.8}" +
  ".afr-st{font-size:11px;color:var(--text2,#bbb);line-height:1.5;min-height:15px}.afr-link{background:none;border:0;color:var(--accent,#0a84ff);font-size:11px;cursor:pointer;padding:0}"));
let cur = LS.get("afr_fx", "hall");
const Pn = el("div", null,
  '<div class="afr-wrap"><div><div class="afr-h">Reverb &amp; FX</div><div class="afr-p">Select audio clips in your timeline, pick an effect, click Apply. The clip itself gets the effect and is extended so the tail rings out (reverse reverb extends it backwards so the swell comes first). No nesting, no copies. If the next clip starts right after, the rest of the tail carries on on a track below.</div></div>' +
  [...new Set(PRESETS.map(p => p.cat))].map(g => '<div class="afr-cat">' + esc(g) + '</div><div class="afr-grid" role="group" aria-label="' + esc(g) + '">' + PRESETS.filter(p => p.cat === g).map(p => '<button class="afr-fx' + (p.id === cur ? " on" : "") + '" data-id="' + p.id + '" aria-pressed="' + (p.id === cur) + '"><b>' + esc(p.name) + "</b><i>" + esc(p.tip) + "</i></button>").join("") + "</div>").join("") +
  '<div class="afr-row" id="afr-amt-row"><span>Amount</span><input type="range" id="afr-amt" min="0" max="100" step="1"><b id="afr-amt-v"></b></div>' +
  '<button class="afr-go" id="afr-go">Apply to selected clips</button><div class="afr-st" id="afr-st"></div><div><button class="afr-link" id="afr-undo" style="display:none">↩ Undo last</button></div></div>');
Pn.id = "afr-panel"; ["keydown", "keyup", "contextmenu"].forEach(t => Pn.addEventListener(t, e => e.stopPropagation()));
const $ = id => Pn.querySelector("#" + id), st = m => { $("afr-st").textContent = m; }, prog = f => { $("afr-go").style.setProperty("--p", Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"); };
const P_ = () => PRESETS.find(p => p.id === cur) || PRESETS.find(p => p.id === "hall");
function showAmt(){ const p = P_(), has = p.wet != null; $("afr-amt-row").style.display = has ? "" : "none"; if (has) { const v = +LS.get("afr_amt_" + p.id, Math.round(p.wet * 100)); $("afr-amt").value = v; $("afr-amt-v").textContent = v + "%"; } }
Pn.querySelectorAll(".afr-fx").forEach(b => b.onclick = () => { cur = b.dataset.id; LS.set("afr_fx", cur); Pn.querySelectorAll(".afr-fx").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); showAmt(); });
$("afr-amt").oninput = function(){ $("afr-amt-v").textContent = this.value + "%"; LS.set("afr_amt_" + cur, this.value); };
showAmt();
let busy = false, undo = null;
$("afr-go").onclick = async () => { if (busy) return; busy = true; const b = $("afr-go"); b.disabled = true; prog(0);
  try { const p = P_(), wet = p.wet != null ? +$("afr-amt").value / 100 : null;
    st("Reading your selection…"); const S = await callJ("afr_sel");
    const C = S.clips.filter(c => c.path && !c.dis), slow = C.filter(c => Math.abs(c.spd - 1) > 0.01);
    if (!S.clips.length) throw new Error("Select one or more audio clips in the timeline first (click them, Shift-click for more).");
    if (!C.length) throw new Error("The selected clips have no media file (or are switched off).");
    const old = C.filter(c => c.sub); if (old.length) throw new Error("A selected clip (named \u201c… (audio)\u201d) is a leftover from an older Undo and has no matching video above it to take its timing from. Drag the original clip in again (or Ctrl+Z in Premiere), then apply.");
    const use = C.filter(c => Math.abs(c.spd - 1) <= 0.01); if (!use.length) throw new Error("Speed-changed clips aren't supported yet: set them back to 100% first.");
    const afir = await afirOpt(), ir = await irFor(p); fs.mkdirSync(REN, { recursive: true });
    /* render each clip (cached: applying the same effect again is instant) */
    const fr0 = S.fr || 1 / 30, pp = p.kind === "reverse" ? Object.assign({}, p, { tail: Math.ceil(p.tail / fr0 - 1e-6) * fr0 }) : p;   // a swell is a whole number of frames, so the voice stays on the frame grid
    /* which channels each clip really plays: a stereo recording split into two mono clips (A1 voice / A2 game) must not get both */
    const SP = new Map(); for (const c of use) if (!SP.has(c.path)) SP.set(c.path, await streamsOf(c.path));
    const nm = (c, tag, key) => path.join(REN, path.basename(c.path).replace(/\.[^.]+$/, "").slice(0, 40).replace(/[^\w\- ]+/g, "_") + " - " + tag + " [" + hash(key) + "].wav");
    const jobs = []; use.forEach(c => { let mt = 0; try { mt = Math.round(fs.statSync(c.path).mtimeMs); } catch (e) {}
      const pick = pickFor(SP.get(c.path), c.n, c.k), base = [c.path.toLowerCase(), mt, c.in.toFixed(4), c.out.toFixed(4), pick].join("|");
      const out = nm(c, p.id, base + "|" + [p.id, wet, pp.tail.toFixed(4), "v4"].join("|")), dry = nm(c, "original", base + "|dry1");
      jobs.push(Object.assign({ c, out, dry }, renderArgs(c.path, c.in, c.out, pp, wet, ir, out + ".part.wav", afir, pick)));
      jobs.push({ c, out: dry, args: dryArgs(c.path, c.in, c.out, dry + ".part.wav", pick), isDry: true }); });
    let done = 0, i = 0; const errs = [];
    const w = async () => { while (i < jobs.length) { const j = jobs[i++]; if (!(fs.existsSync(j.out) && fs.statSync(j.out).size > 1000)) { const r = await run(j.args);
        if (r.ok) { try { fs.renameSync(j.out + ".part.wav", j.out); } catch (e) { errs.push(e.message); } } else errs.push(path.basename(j.c.path) + ": " + r.err); }
      done++; prog(done / jobs.length * 0.7); st("Rendering " + p.name + "… " + Math.ceil(done / 2) + " / " + use.length); } };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Math.floor((os.cpus().length || 4) / 2))) }, w));
    const ok = jobs.filter(j => !j.isDry && fs.existsSync(j.out) && fs.existsSync(j.dry)); if (!ok.length) throw new Error("Rendering failed: " + (errs[0] || "unknown error"));
    /* the clip itself becomes the rendered file, extended into the free space around it on its own track; whatever doesn't fit
       (the next clip starts right away) continues on a spare track, from the same file, so it plays as one sound */
    const fr = S.fr || 1 / 30, f = x => Math.round(x * 1000) / 1000, main = [], spill = [], undoL = [];
    let longer = 0;
    ok.forEach(j => { const c = j.c, total = wavSecs(j.out) || j.len, clen = c.out - c.in, pre = j.pre, post = Math.max(0, total - pre - clen);
      const gapB = Math.max(0, c.s - c.pv), gapA = c.nx < 0 ? 1e9 : Math.max(0, c.nx - c.e), useB = Math.min(pre, gapB), useA = Math.min(post, gapA);
      const m = { path: j.out, track: c.t, s: f(c.s - useB), in: pre - useB, out: pre + clen + useA, lvl: c.lvl }; main.push(m); longer += useB + useA;
      const sp = [];
      if (pre - useB > 0.02) { let T = c.s - pre, in0 = 0; if (T < 0) { in0 = -T; T = 0; } if (pre - useB - in0 > 0.02) sp.push({ path: j.out, s: f(T), e: T + (pre - useB - in0), in: in0, out: pre - useB, lvl: c.lvl }); }
      if (post - useA > 0.02) sp.push({ path: j.out, s: f(c.e + useA), e: c.e + post, in: pre + clen + useA, out: total, lvl: c.lvl });
      sp.forEach(x => spill.push(x));
      undoL.push({ t: c.t, s: c.s, e: c.e, lvl: c.lvl, path: j.out, dry: j.dry, lo: Math.min(c.s - pre, c.s), hi: c.e + post, sp }); });
    spill.sort((a, b) => a.s - b.s); const lanes = []; spill.forEach(x => { let k = lanes.findIndex(e => e <= x.s + 1e-3); if (k < 0) { lanes.push(x.e); k = lanes.length - 1; } else lanes[k] = x.e; x.lane = k; });
    st("Putting it on the timeline…"); prog(0.8);
    const tr = lanes.length ? (await callJ("afr_tracks", lanes.length)).tracks : [];
    spill.forEach(x => { x.track = tr[x.lane]; });
    const imp = await callJ("afr_import", { paths: [...new Set(ok.map(j => j.out).concat(ok.map(j => j.dry)))] }); if (imp.missing) throw new Error("Premiere didn't import " + imp.missing + " of the rendered files.");
    const r = await callJ("afr_place", { items: main });
    const r2 = spill.length ? await callJ("afr_place", { items: spill.map(x => ({ path: x.path, track: x.track, s: x.s, in: x.in, out: x.out, lvl: x.lvl })) }) : { done: 0, failed: 0 };
    undo = undoL.map(u => ({ t: u.t, s: u.s, e: u.e, lvl: u.lvl, path: u.path, dry: u.dry, lo: u.lo, hi: u.hi, tracks: [u.t].concat(u.sp.map(x => x.track)) })); $("afr-undo").style.display = "";
    const kf = use.filter(c => c.kf).length, n = r.done;
    prog(1); st("✓ " + p.name + " on " + n + " clip" + (n === 1 ? "" : "s") + ": the clip" + (n === 1 ? " itself carries" : "s themselves carry") + " the effect" + (longer > 0.05 ? " and run" + (n === 1 ? "s" : "") + " " + (longer / Math.max(1, n)).toFixed(1) + " s longer" + (p.kind === "reverse" ? " (the build-up comes first)" : " so the tail rings out") : "") + "." +
      (spill.length ? " " + spill.length + " tail" + (spill.length > 1 ? "s" : "") + " didn't fit before the next clip, so " + (spill.length > 1 ? "they carry" : "it carries") + " on on " + tr.map(t => "A" + (t + 1)).join(", ") + "." : "") +
      (kf ? " ⚠ " + kf + " clip" + (kf > 1 ? "s had" : " had") + " volume keyframes: only the level was kept." : "") +
      (r.failed || r2.failed ? " ⚠ " + (r.failed + r2.failed) + " couldn't be placed: " + (r.err || r2.err) : "") + (slow.length ? " (" + slow.length + " speed-changed clip" + (slow.length > 1 ? "s" : "") + " skipped)" : "") + (errs.length ? " ⚠ " + errs.length + " failed to render: " + errs[0] : ""));
    blog(p.id + " on " + r.done + " clips, extended, " + spill.length + " spill" + (errs.length ? ", errors " + errs.length : "")); }
  catch (e) { st("⚠ " + e.message); blog("error " + e.message); } finally { busy = false; b.disabled = false; setTimeout(() => prog(0), 1200); } };
$("afr-undo").onclick = async () => { if (!undo || busy) return; busy = true;
  try { st("Putting the original audio back…"); const r = await callJ("afr_restore", { items: undo });
    st("↩ " + r.back + " clip" + (r.back === 1 ? "" : "s") + " back to the original audio" + (r.failed ? " ⚠ " + r.failed + " couldn't be restored (" + r.err + "): use Ctrl+Z in Premiere for those" : "") + ". The rendered files are kept, so applying again is instant."); undo = null; $("afr-undo").style.display = "none"; }
  catch (e) { st("⚠ " + e.message); } finally { busy = false; } };

/* ---------- sidebar entry (under Finish, after Isolate voice) ---------- */
let hidGrid = false;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { document.querySelectorAll('[id$="-panel"].open, #afx-qc.open').forEach(e => { if (e !== Pn) e.classList.remove("open"); });   // every other page, including ones added later
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); Pn.classList.add("open"); }
  else if (Pn.classList.contains("open")) { Pn.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"); if (!side || !gw) return false; if (document.getElementById("afr-nav")) return true;
  const after = document.getElementById("afv-nav") || document.getElementById("afl-nav") || document.getElementById("afx-nav-qc"); if (!after) return false;
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Reverb &amp; FX">🎚️</span> <span class="cat-label">Reverb &amp; FX</span>'); nav.id = "afr-nav"; nav.dataset.cat = "__afr__"; nav.dataset.tooltip = "Reverb & FX";
  after.parentNode.insertBefore(nav, after.nextSibling); gw.parentNode.insertBefore(Pn, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 120) clearInterval(iv); }, 300); }
window._afReverb = { PRESETS, renderArgs, irArgs, afirFor, wavSecs };
})();
