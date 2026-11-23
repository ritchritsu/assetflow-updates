/* AssetFlow — Tools: quick fixes Premiere makes slow. Batch changes, fit to frame (and more cards added over time). */
(function(){
"use strict";
let fs, path, cp, os; try { fs = require("fs"); path = require("path"); cp = require("child_process"); os = require("os"); } catch (e) { return; }
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const blog = m => { try { window._afBootLog && _afBootLog("Tools: " + m); } catch (e) {} };
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r("EvalScript error. Premiere didn't answer for 10 minutes (is a dialog open in Premiere?)"); } }, 600000); try { cs ? cs.evalScript(code, v => { if (!done) { done = true; clearTimeout(t); r(v); } }) : (done = true, clearTimeout(t), r("")); } catch (e) { done = true; clearTimeout(t); r(""); } });
function extDir(){
  try { const raw = (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath("extension")) || (cs && cs.getSystemPath("extension")) || "";
    if (raw) { const t = decodeURIComponent(String(raw).replace(/^file:\/{2,3}/i, "").replace(/\/$/, "")); return process.platform === "win32" ? path.normalize(t) : "/" + t.replace(/^\/+/, ""); } } catch (e) {}
  try { return path.dirname(decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch (e) { return ""; } }
let jsxReady = null;
function host(){ if (!jsxReady) jsxReady = jsx("$.evalFile(" + JSON.stringify(path.join(extDir(), "js", "af_tools.jsx").replace(/\\/g, "/")) + ")").then(r => { if (!/aft ok/.test(r || "")) jsxReady = null; return r; }); return jsxReady; }
async function callJ(fn, arg){ const h = await host(); if (!/aft ok/.test(h || "")) throw new Error("Couldn't load the Premiere helper (" + String(h || "no answer").slice(0, 100) + ")");
  const r = await jsx(fn + "(" + (arg === undefined ? "" : JSON.stringify(JSON.stringify(arg))) + ")"); let o; try { o = JSON.parse(r); } catch (e) { throw new Error("Premiere answered: " + String(r).slice(0, 120)); } if (o && o.error) throw new Error(o.error); return o; }
window._afTools = { callJ, el, esc, blog, extDir };

document.head.appendChild(el("style", null,
  "#aft-panel{display:none;flex-direction:column;flex:1 1 auto;width:100%;min-width:0;min-height:0;overflow-y:auto;background:linear-gradient(180deg,rgba(32,32,32,.68) 0,rgba(20,20,20,.8) 100%);border-radius:var(--r,10px);border:1px solid rgba(255,255,255,.09)}" +
  "#aft-panel.open{display:flex}.aft-wrap{padding:16px 14px;display:flex;flex-direction:column;gap:12px}.aft-h{font-size:14px;font-weight:600;color:var(--text,#eee)}.aft-p{font-size:11px;color:var(--text3,#999);line-height:1.5}" +
  ".aft-card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px}.aft-t{font-size:12px;font-weight:600;color:var(--text,#ddd);margin-bottom:6px}" +
  ".aft-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:11px;color:var(--text2,#bbb)}.aft-row select,.aft-row input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:6px;color:var(--text,#eee);font-size:11.5px;padding:5px 7px}" +
  ".aft-row input[type=number]{width:72px}.aft-btn{background:var(--accent,#0a84ff);border:0;border-radius:7px;color:#fff;font-size:11.5px;font-weight:600;padding:7px 14px;cursor:pointer}.aft-btn.g{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);font-weight:500}.aft-btn:disabled{opacity:.5;cursor:default}" +
  ".aft-out{font-size:11px;color:var(--text2,#bbb);margin-top:8px;min-height:14px;line-height:1.5}"));
const Pn = el("div", null, '<div class="aft-wrap"><div><div class="aft-h">Tools</div><div class="aft-p">Quick fixes for things Premiere makes slow. Select clips in the timeline first where a tool says so.</div></div><div id="aft-cards"></div></div>');
Pn.id = "aft-panel"; ["keydown", "keyup", "contextmenu"].forEach(t => Pn.addEventListener(t, e => e.stopPropagation()));
const $ = id => Pn.querySelector("#" + id);
/* other tool files add their own cards with window._afTools.card(id, html) */
window._afTools.card = (id, html) => { const c = el("div", "aft-card", html); c.id = id; $("aft-cards").appendChild(c); return c; };
window._afTools.$ = $;

/* ---------- Batch changes ---------- */
const B = window._afTools.card("aft-batch",
  '<div class="aft-t">Change many clips at once</div><div class="aft-p">Select clips in the timeline, pick a setting, type the value, Apply. Works on part of an effect too (e.g. one Lumetri slider).</div>' +
  '<div class="aft-row"><select id="aft-what"><option value="scale">Scale (%)</option><option value="pos">Position (X, Y in pixels)</option><option value="rot">Rotation (°)</option><option value="opa">Opacity (%)</option><option value="vol">Volume (dB)</option><option value="fx">An effect setting…</option></select>' +
  '<select id="aft-fx" style="display:none"></select><input type="number" id="aft-v1" step="any" value="100"><input type="number" id="aft-v2" step="any" style="display:none"></div>' +
  '<div class="aft-row"><label><input type="checkbox" id="aft-keys"> Also change clips that have keyframes on it (sets every keyframe)</label></div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-apply">Apply to selected clips</button><button class="aft-btn g" id="aft-reload">Read selection</button></div><div class="aft-out" id="aft-bout"></div>');
let info = null;
const what = () => $("aft-what").value;
function drawWhat(){ const w = what(); $("aft-fx").style.display = w === "fx" ? "" : "none"; $("aft-v2").style.display = w === "pos" ? "" : "none";
  const d = { scale: 100, rot: 0, opa: 100, vol: 0 }; if (d[w] != null) $("aft-v1").value = d[w];
  if (w === "pos" && info) { $("aft-v1").value = info.W / 2; $("aft-v2").value = info.H / 2; } }
$("aft-what").onchange = async () => { if (what() === "fx" || what() === "pos") await readSel(); drawWhat(); };
async function readSel(){ try { info = await callJ("aft_selInfo"); const F = $("aft-fx"); F.innerHTML = "";
    info.fx.forEach(f => f.params.forEach(p => { const o = el("option", null, esc(f.name + " › " + p)); o.value = JSON.stringify([f.name, p, f.kind]); F.appendChild(o); }));
    $("aft-bout").textContent = info.video + " video and " + info.audio + " audio clip" + (info.video + info.audio === 1 ? "" : "s") + " selected" + (what() === "fx" && !info.fx.length ? " (select a clip that has the effect first)" : "") + ".";
  } catch (e) { $("aft-bout").textContent = "⚠ " + e.message; } }
$("aft-reload").onclick = readSel;
$("aft-apply").onclick = async () => { const b = $("aft-apply"); if (b.disabled) return; b.disabled = true;
  try { const w = what(), v1 = parseFloat($("aft-v1").value), v2 = parseFloat($("aft-v2").value), keys = $("aft-keys").checked; if (!isFinite(v1)) throw new Error("Type a number.");
    let job;
    if (w === "scale") job = { comp: "Motion", param: "Scale", value: v1, kind: "V" };
    else if (w === "rot") job = { comp: "Motion", param: "Rotation", value: v1, kind: "V" };
    else if (w === "opa") job = { comp: "Opacity", param: "Opacity", value: v1, kind: "V" };
    else if (w === "vol") job = { comp: "Volume", param: "Level", value: Math.pow(10, (v1 - 15) / 20), kind: "A" };   // Premiere's Level: 0 dB = 0.1778
    else if (w === "pos") { if (!info) await readSel(); if (!isFinite(v2)) throw new Error("Type both X and Y."); job = { comp: "Motion", param: "Position", value: [v1 / info.W, v2 / info.H], kind: "V" }; }
    else { const o = $("aft-fx").value; if (!o) throw new Error("Pick an effect setting (select a clip that has it, then Read selection)."); const [c, p, k] = JSON.parse(o); job = { comp: c, param: p, value: v1, kind: k }; }
    job.keys = keys; const r = await callJ("aft_batch", job);
    $("aft-bout").innerHTML = "✓ Changed " + r.done + " clip" + (r.done === 1 ? "" : "s") + "." + (r.keyed ? " " + r.keyed + " skipped (keyframed: tick the box to change them too)." : "") + (r.missing ? " " + r.missing + " don't have that setting." : "") + (r.done ? " Ctrl+Z undoes it one clip at a time." : "");
    blog("batch " + JSON.stringify(job) + " -> " + JSON.stringify(r)); }
  catch (e) { $("aft-bout").textContent = "⚠ " + e.message; } finally { b.disabled = false; } };

/* ---------- Fit to frame ---------- */
window._afTools.card("aft-fitc",
  '<div class="aft-t">Fit clips to the frame</div><div class="aft-p">Scales every selected video clip to the sequence size, centred. Fit = whole picture visible. Fill = no black bars (edges may be cut).</div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-fit">Fit</button><button class="aft-btn g" id="aft-fill">Fill</button></div><div class="aft-out" id="aft-fout"></div>');
async function fit(mode){ try { const r = await callJ("aft_fit", { mode }); $("aft-fout").textContent = "✓ " + (mode === "fill" ? "Filled" : "Fitted") + " " + r.done + " clip" + (r.done === 1 ? "" : "s") + "." + (r.keyed ? " " + r.keyed + " skipped (Scale/Position keyframed)." : "") + (r.unknown ? " " + r.unknown + " skipped (size unknown, e.g. graphics)." : ""); }
  catch (e) { $("aft-fout").textContent = "⚠ " + e.message; } }
$("aft-fit").onclick = () => fit("fit"); $("aft-fill").onclick = () => fit("fill");

/* ---------- Project cleanup ---------- */
window._afTools.card("aft-clean",
  '<div class="aft-t">Clean up the project</div><div class="aft-p">Finds media no sequence uses, files imported twice, and sorts everything into bins. Nothing is deleted: unused items go into an "Unused" bin you can check, then delete yourself.</div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-scan">Scan project</button></div><div class="aft-out" id="aft-cout"></div>' +
  '<div class="aft-row" id="aft-cact" style="display:none"><button class="aft-btn g" id="aft-unused">Move unused to "Unused"</button><button class="aft-btn g" id="aft-dups">Move unused duplicates too</button><button class="aft-btn g" id="aft-sort">Sort into bins</button></div>');
const GB = b => b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : (b / 1e6).toFixed(0) + " MB";
let scan = null;
function analyse(items){
  const media = items.filter(i => i.kind !== "sequence"), unused = media.filter(i => !i.uses);
  const byPath = {}; media.forEach(i => { if (i.path) (byPath[i.path.toLowerCase()] = byPath[i.path.toLowerCase()] || []).push(i); });
  const dupGroups = Object.values(byPath).filter(g => g.length > 1);
  const extra = []; dupGroups.forEach(g => { const keep = g.slice().sort((a, b) => b.uses - a.uses)[0]; g.forEach(i => { if (i !== keep && !i.uses) extra.push(i); }); });
  const size = L => { const seen = new Set(); let t = 0; L.forEach(i => { if (!i.path || seen.has(i.path.toLowerCase())) return; seen.add(i.path.toLowerCase());
      if (media.some(m => m.uses && m.path && m.path.toLowerCase() === i.path.toLowerCase())) return;   // the same file is used elsewhere: freeing nothing
      try { t += fs.statSync(i.path).size; } catch (e) {} }); return t; };
  return { media, unused, dupGroups, extra, unusedBytes: size(unused), offline: media.filter(i => i.off).length }; }
$("aft-scan").onclick = async () => { const o = $("aft-cout"); o.textContent = "Scanning…";
  try { const r = await callJ("aft_projScan"); scan = analyse(r.items);
    o.innerHTML = "<b>" + scan.media.length + "</b> media items in " + r.sequences + " sequences.<br>" +
      "<b>" + scan.unused.length + "</b> not used in any sequence" + (scan.unusedBytes ? " (" + GB(scan.unusedBytes) + " on disk only they use)" : "") + ".<br>" +
      "<b>" + scan.dupGroups.length + "</b> files imported more than once" + (scan.extra.length ? " (" + scan.extra.length + " unused copies)" : "") + "." + (scan.offline ? "<br><b>" + scan.offline + "</b> offline (use Relink below)." : "");
    $("aft-cact").style.display = ""; } catch (e) { o.textContent = "⚠ " + e.message; } };
async function moveTo(list, bin, what){ if (!list.length) { $("aft-cout").textContent = "Nothing to move."; return; }
  const r = await callJ("aft_projMove", { moves: list.map(i => [i.id, bin]) }); $("aft-cout").textContent = "✓ Moved " + r.moved + " " + what + " into the \"" + bin + "\" bin. Check it, then delete the bin if you don't need them."; }
$("aft-unused").onclick = () => scan && moveTo(scan.unused, "Unused", "unused items").catch(e => $("aft-cout").textContent = "⚠ " + e.message);
$("aft-dups").onclick = () => scan && moveTo(scan.extra, "Unused", "unused duplicate copies").catch(e => $("aft-cout").textContent = "⚠ " + e.message);
$("aft-sort").onclick = async () => { if (!scan) return; const names = { video: "Footage", audio: "Audio", image: "Images", graphic: "Graphics", other: "Other" };
  try { const L = scan.media.filter(i => i.bin !== "/Unused" && names[i.kind]).map(i => [i.id, names[i.kind]]);
    const r = await callJ("aft_projMove", { moves: L }); $("aft-cout").textContent = "✓ Sorted " + r.moved + " items into Footage, Audio, Images, Graphics and Other (sequences stay where they are)."; }
  catch (e) { $("aft-cout").textContent = "⚠ " + e.message; } };

/* ---------- One-click relink ---------- */
window._afTools.card("aft-relink",
  '<div class="aft-t">Relink offline media</div><div class="aft-p">Finds every offline file by its name, preferring matches in the same folder structure, and relinks them all at once. If a whole folder moved, one match finds the rest instantly.</div>' +
  '<div class="aft-row"><span>Look in</span><select id="aft-where"><option value="drives">All drives</option><option value="pick">A folder I choose…</option></select><button class="aft-btn" id="aft-rl">Find and relink</button><button class="aft-btn g" id="aft-rlstop" style="display:none">Stop</button></div><div class="aft-out" id="aft-rout"></div>');
const SKIP = /^(\$recycle\.bin|system volume information|windows|program files|program files \(x86\)|programdata|appdata|node_modules|\.git|\$windows\.~bt|recovery|msocache)$/i;
let rlStop = false;
function drives(){ const L = []; for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ":\\"; try { if (fs.existsSync(d)) L.push(d); } catch (e) {} } return L; }
function pickFolder(){ try { const r = window.cep.fs.showOpenDialogEx(false, true, "Where are the files now?", ""); return r && r.data && r.data[0] ? r.data[0] : null; } catch (e) { return null; } }
/* walk folders breadth-first, looking for the wanted file names; calls back as matches appear */
async function findFiles(roots, names, onFound, onProg){
  const want = new Map(); names.forEach(n => want.set(n.toLowerCase(), true));
  const Q = roots.slice(); let seen = 0, last = 0;
  while (Q.length && want.size && !rlStop) { const d = Q.shift(); let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) { if (e.isDirectory()) { if (!SKIP.test(e.name)) Q.push(path.join(d, e.name)); }
      else if (want.has(e.name.toLowerCase())) onFound(e.name.toLowerCase(), path.join(d, e.name)); }
    if (++seen - last > 200) { last = seen; onProg(seen, d); await new Promise(r => setTimeout(r, 0)); } } }
/* best candidate: shares the most trailing folder names with the old path */
function score(oldP, newP){ const a = oldP.toLowerCase().split(/[\\/]/).reverse(), b = newP.toLowerCase().split(/[\\/]/).reverse(); let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; }
$("aft-rlstop").onclick = () => { rlStop = true; };
$("aft-rl").onclick = async () => { const o = $("aft-rout"), btn = $("aft-rl"); if (btn.disabled) return;
  try { const off = (await callJ("aft_offline")).items; if (!off.length) { o.textContent = "✓ Nothing is offline."; return; }
    let roots = $("aft-where").value === "pick" ? [pickFolder()].filter(Boolean) : drives(); if (!roots.length) { o.textContent = "No folder chosen."; return; }
    btn.disabled = true; rlStop = false; $("aft-rlstop").style.display = "";
    const links = new Map(), cand = {}, maps = [];   // maps: [oldDir, newDir] learned from matches (a whole folder that moved)
    const tryMaps = () => off.forEach(i => { if (links.has(i.id)) return; for (const [od, nd] of maps) { const low = i.path.toLowerCase(); if (low.startsWith(od)) { const np = nd + i.path.slice(od.length); try { if (fs.existsSync(np)) { links.set(i.id, np); return; } } catch (e) {} } } });
    const learn = (oldP, newP) => { const a = oldP.split(/[\\/]/), b = newP.split(/[\\/]/); let k = 0; while (k < a.length - 1 && k < b.length - 1 && a[a.length - 1 - k].toLowerCase() === b[b.length - 1 - k].toLowerCase()) k++;
      const od = a.slice(0, a.length - k).join("\\").toLowerCase() + "\\", nd = b.slice(0, b.length - k).join("\\") + "\\"; if (!maps.some(m => m[0] === od)) { maps.push([od, nd]); tryMaps(); } };
    const byName = {}; off.forEach(i => { const n = path.basename(i.path).toLowerCase(); (byName[n] = byName[n] || []).push(i); });
    o.textContent = off.length + " offline. Searching…";
    await findFiles(roots, Object.keys(byName), (n, p) => { (byName[n] || []).forEach(i => { if (links.has(i.id)) return; (cand[i.id] = cand[i.id] || []).push(p);
        const best = cand[i.id].sort((x, y) => score(i.path, y) - score(i.path, x))[0]; if (score(i.path, best) >= 2) { links.set(i.id, best); learn(i.path, best); } }); },
      (n, d) => { o.textContent = "Searching… " + links.size + "/" + off.length + " found · " + n + " folders · " + d.slice(0, 60); });
    off.forEach(i => { if (!links.has(i.id) && cand[i.id]) links.set(i.id, cand[i.id].sort((x, y) => score(i.path, y) - score(i.path, x))[0]); });   // name-only matches last
    if (!links.size) { o.textContent = "Couldn't find any of the " + off.length + " offline files there."; return; }
    const r = await callJ("aft_relink", { links: [...links.entries()] });
    o.innerHTML = "✓ Relinked " + r.relinked + " of " + off.length + " offline files." + (r.failed.length ? "<br>Premiere refused: " + r.failed.slice(0, 5).map(esc).join(", ") + (r.failed.length > 5 ? "…" : "") : "") + (off.length - links.size ? "<br>Not found: " + (off.length - links.size) + "." : "");
    blog("relink " + r.relinked + "/" + off.length); }
  catch (e) { o.textContent = "⚠ " + e.message; } finally { btn.disabled = false; $("aft-rlstop").style.display = "none"; } };

/* ---------- Multi-export ---------- */
window._afTools.card("aft-export",
  '<div class="aft-t">Export several versions at once</div><div class="aft-p">Tick the presets you want: the open sequence is queued in Media Encoder once per preset (e.g. YouTube master + client preview), named after the sequence and preset.</div>' +
  '<div id="aft-plist" style="max-height:170px;overflow-y:auto;margin-top:8px;font-size:11px;color:var(--text2,#bbb)"></div>' +
  '<div class="aft-row"><span>Save to</span><input id="aft-out" style="flex:1;min-width:120px" placeholder="folder"><button class="aft-btn g" id="aft-outpick">…</button></div>' +
  '<div class="aft-row"><label><input type="checkbox" id="aft-inout"> Only In to Out</label><label><input type="checkbox" id="aft-start" checked> Start right away</label></div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-exp">Queue in Media Encoder</button><button class="aft-btn g" id="aft-prel">Find presets</button></div><div class="aft-out" id="aft-eout"></div>');
const LSx = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
/* your saved presets (Media Encoder / Premiere) + the common built-in ones */
function findPresets(){ const out = [], seen = new Set(), add = (p, tag) => { const k = p.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push({ path: p, name: path.basename(p, ".epr"), tag }); };
  const walk = (d, depth, tag, filt) => { if (depth < 0) return; let E; try { E = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    E.forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth - 1, tag, filt); else if (/\.epr$/i.test(e.name) && (!filt || filt.test(e.name))) add(p, tag); }); };
  const docs = path.join(os.homedir(), "Documents", "Adobe");
  walk(path.join(docs, "Adobe Media Encoder"), 4, "yours"); walk(path.join(docs, "Premiere Pro"), 5, "yours");
  const pf = process.env.ProgramFiles || "C:\\Program Files"; let apps = []; try { apps = fs.readdirSync(path.join(pf, "Adobe")).filter(n => /Premiere Pro|Media Encoder/i.test(n)); } catch (e) {}
  apps.sort().reverse().slice(0, 2).forEach(a => walk(path.join(pf, "Adobe", a, "MediaIO", "systempresets"), 3, "built-in", /match source|youtube|h\.264|high quality 1080|vimeo|prores 422 hq|wav/i));
  return out.sort((a, b) => (a.tag === b.tag ? 0 : a.tag === "yours" ? -1 : 1) || a.name.localeCompare(b.name)); }
function drawPresets(){ const L = findPresets(), box = $("aft-plist"), on = new Set(JSON.parse(LSx.get("aft_presets", "[]"))); box.innerHTML = "";
  if (!L.length) { box.textContent = "No presets found. Save one from Premiere's Export window (Preset > Save Preset), then click Find presets."; return; }
  L.forEach(p => { const r = el("label", null, '<input type="checkbox"> ' + esc(p.name) + ' <span style="opacity:.55">(' + p.tag + ")</span>"); r.style.display = "block"; r.style.margin = "3px 0";
    const c = r.querySelector("input"); c.checked = on.has(p.path); c.dataset.p = p.path; c.dataset.n = p.name;
    c.onchange = () => { const S = [...box.querySelectorAll("input:checked")].map(x => x.dataset.p); LSx.set("aft_presets", JSON.stringify(S)); }; box.appendChild(r); }); }
$("aft-prel").onclick = drawPresets;
$("aft-outpick").onclick = () => { try { const r = window.cep.fs.showOpenDialogEx(false, true, "Export to", $("aft-out").value || ""); if (r && r.data && r.data[0]) { $("aft-out").value = r.data[0]; LSx.set("aft_out", r.data[0]); } } catch (e) {} };
$("aft-exp").onclick = async () => { const o = $("aft-eout"), btn = $("aft-exp"); if (btn.disabled) return; btn.disabled = true;
  try { const P = [...$("aft-plist").querySelectorAll("input:checked")].map(x => ({ path: x.dataset.p, name: x.dataset.n })); if (!P.length) throw new Error("Tick at least one preset.");
    let out = $("aft-out").value.trim(); if (!out) { const r = await callJ("aft_seqName"); out = path.join(os.homedir(), "Videos");
      if (r.project) { let d = path.dirname(r.project); out = d; for (let k = 0; k < 5; k++) { if (fs.existsSync(path.join(d, "04_Exports"))) { out = path.join(d, "04_Exports"); break; } const up = path.dirname(d); if (up === d) break; d = up; } }   // your project's 04_Exports folder if there is one
      try { fs.mkdirSync(out, { recursive: true }); } catch (e) {} $("aft-out").value = out; }
    const r = await callJ("aft_export", { presets: P, out: out.replace(/\\/g, "/"), range: $("aft-inout").checked ? 1 : 0, start: $("aft-start").checked });
    o.innerHTML = "✓ Queued " + r.queued.length + " export" + (r.queued.length === 1 ? "" : "s") + " in Media Encoder" + ($("aft-start").checked ? " (started)" : "") + ".<br>" + r.queued.map(f => esc(path.basename(f))).join("<br>") + (r.failed.length ? "<br>⚠ " + r.failed.map(esc).join("<br>") : "");
    blog("export " + r.queued.length); }
  catch (e) { o.textContent = "⚠ " + e.message; } finally { btn.disabled = false; } };
$("aft-out").value = LSx.get("aft_out", ""); $("aft-out").onchange = () => LSx.set("aft_out", $("aft-out").value);
setTimeout(drawPresets, 500);

/* ---------- Captions from the WordCut transcript ---------- */
window._afTools.card("aft-caps",
  '<div class="aft-t">Captions</div><div class="aft-p">From this sequence\'s WordCut transcript. <b>Animated</b>: words pop in with the spoken word highlighted (new top track). <b>Editable</b>: a normal Premiere caption track.</div>' +
  '<div class="aft-row"><span>Words per caption</span><input type="number" id="aft-cw" min="1" max="8" value="3"><label><input type="checkbox" id="aft-cup" checked> CAPITALS</label></div>' +
  '<div class="aft-row"><span>Highlight</span><input type="color" id="aft-chi" value="#ffd600"><span>Size</span><input type="number" id="aft-csz" min="20" max="300" placeholder="auto"></div><div class="aft-row"><span>Height on screen</span><input type="number" id="aft-cy" min="10" max="95" value="78"><span>% from the top</span></div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-canim">Animated captions</button><button class="aft-btn g" id="aft-csrt">Editable captions</button></div><div class="aft-out" id="aft-cout"></div>');
function capFile(info){ const pj = info.project; if (!pj) throw new Error("Save the project first.");
  const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, ""), want = norm(info.name);   // WordCut writes "V16 (COMBINED)" as "V16_COMBINED_"
  for (const d of [path.join(path.dirname(pj), "Premiere Pro", "WordCut"), path.join(path.dirname(pj), "WordCut")]) { let L; try { L = fs.readdirSync(d); } catch (e) { continue; }
    const M = L.map(f => { const m = /^(.*?)__(.+)_([0-9a-f]{8,})\.json$/i.exec(f); return m && norm(m[2]) === want ? path.join(d, f) : null; }).filter(Boolean).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (M.length) return M[0]; }
  throw new Error("No WordCut transcript for “" + info.name + "”. Transcribe it in WordCut first."); }
/* WordCut's word times are from when it transcribed. Words also remember where they are in the original audio file (p, m, me),
   so each one is placed where that audio plays on the timeline NOW: captions follow Room to breathe, trims and moves, and cut words drop out. */
function remapWords(words, S){ if (!S || !S.a) return words;
  const by = new Map(); S.a.forEach(t => { if (t.mute) return; t.clips.forEach(c => { if (c.dis || !c.path) return; const k = c.path.replace(/\\/g, "/").toLowerCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(c); }); });
  /* per file: clips in source order + the furthest out point so far, so the clips playing a given moment are found by binary search (a long edit has thousands) */
  by.forEach(L => { L.sort((a, b) => a.in - b.in); let m = -Infinity; L.mx = L.map(c => (m = Math.max(m, c.out))); });
  const out = []; let moved = 0, dropped = 0, kept = 0;
  for (const w of words) { if (w.x) continue;
    if (!w.p || w.m == null) { out.push(w); kept++; continue; }
    const L = by.get(String(w.p).replace(/\\/g, "/").toLowerCase()); if (!L) { out.push(w); kept++; continue; }   // its audio isn't on this timeline at all: trust WordCut
    const me = w.me != null ? w.me : w.m + (w.e - w.s), mid = (w.m + me) / 2;
    let lo = 0, hi = L.length; while (lo < hi) { const q = (lo + hi) >> 1; if (L.mx[q] + 1e-3 <= mid) lo = q + 1; else hi = q; }
    /* every place that moment plays: a line reused as a hook at the start is captioned there AND where it comes back (stereo pairs at the same spot count once) */
    const at = []; for (let q = lo; q < L.length && L[q].in - 1e-3 <= mid; q++) { const c = L[q]; if (mid < c.out + 1e-3 && !at.some(x => Math.abs(x.s - c.s) < 0.02)) at.push(c); }
    if (!at.length) { dropped++; continue; }                                   // that part of the recording was cut out
    at.sort((a, b) => Math.abs(a.s + (mid - a.in) / (a.spd || 1) - w.s) - Math.abs(b.s + (mid - b.in) / (b.spd || 1) - w.s));   // the one nearest to where WordCut had it counts as "the" word
    at.forEach((c, i) => { const sp = c.spd || 1, s = c.s + (Math.max(w.m, c.in) - c.in) / sp, e = c.s + (Math.min(me, c.out) - c.in) / sp;
      if (!i && Math.abs(s - w.s) > 0.02) moved++; out.push(Object.assign({}, w, { s, e })); }); }
  out.sort((a, b) => a.s - b.s); out._st = { moved, dropped, kept }; return out; }
function capGroups(words, n){ const G = []; let cur = null;
  for (const w of words) { if (w.x || !w.w || !(w.e > w.s)) continue;
    const brk = !cur || cur.words.length >= n || w.s - cur.e > 0.6 || /[.!?]$/.test(cur.words[cur.words.length - 1].w) || (cur.chars + w.w.length > 22 && cur.words.length);
    if (brk) { cur = { s: w.s, e: w.e, words: [], chars: 0 }; G.push(cur); }
    cur.words.push({ w: w.w, s: w.s, e: w.e }); cur.e = w.e; cur.chars += w.w.length + 1; }
  /* readable: a caption that would only flash (< 0.35 s) joins the next one when it's right after and still short enough */
  for (let i = 0; i + 1 < G.length; i++) { const g = G[i], nx = G[i + 1];
    if (n > 1 && g.e - g.s < 0.35 && nx.s - g.e < 0.2 && g.words.length + nx.words.length <= n + 2 && g.chars + nx.chars <= 30 && !/[.!?]$/.test(g.words[g.words.length - 1].w)) {
      nx.words = g.words.concat(nx.words); nx.s = g.s; nx.chars += g.chars; G.splice(i, 1); i--; } }
  G.forEach((g, i) => { const nx = G[i + 1]; g.e = nx ? Math.min(Math.max(g.e + 0.4, g.s + 0.6), nx.s) : g.e + 0.4; delete g.chars; }); return G; }   // stay up a little after the last word, at least 0.6 s when there's room
const srtT = t => { const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return [h, m, s].map(x => String(x).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0"); };
async function capPrep(){ const info = await callJ("aft_capInfo"), f = capFile(info), d = JSON.parse(fs.readFileSync(f, "utf8"));
  let words = d.words || [], note = "";
  try { const Q = window._afxQC; if (Q && Q.readSeq) { const S = await Q.readSeq(); if (S && !S.error) { words = remapWords(words, S); const x = words._st; if (x && (x.moved || x.dropped)) note = " Synced to your current edit (" + x.moved + " words moved" + (x.dropped ? ", " + x.dropped + " cut words left out" : "") + ")."; } } } catch (e) {}
  const G = capGroups(words, Math.max(1, +$("aft-cw").value || 3)); if (!G.length) throw new Error("The transcript has no words.");
  const up = $("aft-cup").checked; if (up) G.forEach(g => g.words.forEach(w => w.w = w.w.toUpperCase()));
  const out = path.join(path.dirname(f), "captions"); fs.mkdirSync(out, { recursive: true }); return { info, G, out, note, base: path.join(out, String(info.name).replace(/[\\\/:*?"<>|]/g, "_") + " " + Date.now().toString(36)) }; }
$("aft-csrt").onclick = async () => { const o = $("aft-cout"), b = $("aft-csrt"); if (b.disabled) return; b.disabled = true;
  try { o.textContent = "Reading the transcript…"; const { G, base, note } = await capPrep(), p = base + ".srt";
    fs.writeFileSync(p, G.map((g, i) => (i + 1) + "\n" + srtT(g.s) + " --> " + srtT(g.e) + "\n" + g.words.map(w => w.w).join(" ") + "\n").join("\n"), "utf8");
    await callJ("aft_capPlace", { path: p.replace(/\\/g, "/"), kind: "srt" }); o.textContent = "✓ Added a caption track with " + G.length + " captions." + note; blog("captions srt " + G.length); }
  catch (e) { o.textContent = "⚠ " + e.message; } finally { b.disabled = false; } };
$("aft-canim").onclick = async () => { const o = $("aft-cout"), b = $("aft-canim"); if (b.disabled) return; b.disabled = true;
  try { const T = window._afTrack; if (!T || !T.ask) throw new Error("The Track page's AI engine isn't loaded.");
    if (!T.ready()) { o.textContent = "Setting up the engine (one time)…"; await T.setup((f, m) => o.textContent = m || "Setting up…"); }
    o.textContent = "Reading the transcript…"; const { info, G, base, note } = await capPrep(), hx = $("aft-chi").value, hi = [1, 3, 5].map(i => parseInt(hx.substr(i, 2), 16));
    const dur = Math.min(info.dur, G[G.length - 1].e + 0.5), t0 = Date.now();
    const r = await T.ask("captions", { W: info.W, H: info.H, fps: info.fps, dur, groups: G, out: base + ".mov", style: { upper: false, hi, size: +$("aft-csz").value || 0, y: (+$("aft-cy").value || 78) / 100 } },
      m => { if (m.ev === "prog") o.textContent = "Rendering captions… " + Math.round(m.f * 100) + "%"; });
    o.textContent = "Placing…"; const p = await callJ("aft_capPlace", { path: r.out.replace(/\\/g, "/"), kind: "video", y: r.y });
    o.textContent = "✓ " + G.length + " captions on V" + p.track + " (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)." + note; blog("captions anim " + G.length); }
  catch (e) { o.textContent = "⚠ " + e.message; } finally { b.disabled = false; } };

/* ---------- Auto-fit music ---------- */
window._afTools.card("aft-mus",
  '<div class="aft-t">Auto-fit music</div><div class="aft-p">Select a music clip. It skips (or repeats) a stretch of the song where the music sounds the same on both sides, on the beat, so the song\'s real ending lands exactly where you want it. The music keeps its start.</div>' +
  '<div class="aft-row"><span>End the song at</span><select id="aft-mto"><option value="auto">Sequence end (or Out point if set)</option><option value="next">The next clip on its track</option><option value="ph">The playhead</option></select></div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-mgo">Fit music</button></div><div class="aft-out" id="aft-mout"></div>');
function musicPy(){ const la = process.env.LOCALAPPDATA || "", c = [window._afVoice && window._afVoice.P && window._afVoice.P.py, path.join(la, "WordCut", "venv", "Scripts", "python.exe")];
  for (const p of c) if (p && fs.existsSync(p)) return p; return null; }
function runMusic(J){ return new Promise((res, bad) => { const py = musicPy(); if (!py) return bad(new Error("Needs AssetFlow's audio engine: set up Isolate voice once, or install WordCut."));
  const p = require("child_process").spawn(py, ["-u", path.join(extDir(), "af_music.py")], { windowsHide: true }); let out = "", err = "";
  p.stdout.on("data", d => out += d); p.stderr.on("data", d => err = (err + d).slice(-800));
  p.on("close", () => { const l = out.trim().split("\n").map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean).pop(); if (!l) return bad(new Error("The music engine failed: " + (err.trim().split("\n").pop() || "no answer"))); if (l.ev === "error") return bad(new Error(l.msg)); res(l); });
  p.stdin.write(JSON.stringify(J) + "\n"); p.stdin.end(); }); }
$("aft-mgo").onclick = async () => { const o = $("aft-mout"), b = $("aft-mgo"); if (b.disabled) return; b.disabled = true;
  try { const c = await callJ("aft_musicSel"), to = $("aft-mto").value;
    const endAt = to === "next" ? c.next : to === "ph" ? c.ph : (c.outPt || c.seqEnd); if (endAt == null) throw new Error("There's no next clip after the music on its track.");
    const len = endAt - c.s; if (len < 3) throw new Error("That's only " + len.toFixed(1) + " s from the start of the music.");
    o.textContent = "Listening to the song…"; const t0 = Date.now(); const r = await runMusic({ path: c.path, ffmpeg: fs.existsSync(path.join(extDir(), "ffmpeg.exe")) ? path.join(extDir(), "ffmpeg.exe") : "ffmpeg", in: c.in, len });
    /* Premiere puts clip edges on whole frames: move each jump (both sides by the same amount, so the music stays in time) onto a frame boundary */
    const fr = 1 / (c.fps || 30), P = r.pieces.map(x => x.slice());
    const tot = P.reduce((t, [a, b2]) => t + b2 - a, 0), want = Math.round(len / fr) * fr; P[0][0] = Math.max(0, P[0][0] + (tot - want));   // whole length in frames first
    for (let i = 0; i + 1 < P.length; i++) { const l = P[i][1] - P[i][0], d = Math.round(l / fr) * fr - l; P[i][1] += d; P[i + 1][0] += d; }      // then each jump on a frame (total unchanged)
    r.pieces = P;
    const ap = await callJ("aft_musicApply", { track: c.track, s: c.s, pieces: r.pieces });
    o.textContent = "✓ " + c.name + " now ends at the right spot (" + (r.pieces.length - 1 ? (r.pieces.length - 1) + " seamless jump" + (r.pieces.length > 2 ? "s" : "") : "start trimmed") + ", " + ((Date.now() - t0) / 1000).toFixed(1) + " s)." + (r.score < 0.4 ? " The jump may be noticeable: give it a listen." : "") + " Ctrl+Z to undo.";
    blog("music fit " + JSON.stringify(r.pieces) + " placed " + ap.placed); }
  catch (e) { o.textContent = "⚠ " + e.message; } finally { b.disabled = false; } };

/* ---------- Sound effects on cuts ---------- */
window._afTools.card("aft-sfx",
  '<div class="aft-t">Sound effects on cuts</div><div class="aft-p">Puts a whoosh / hit on every cut, lined up so the loudest moment of the sound lands right on the cut. Picks a different sound each time from the ones you choose. Goes on a new audio track.</div>' +
  '<div class="aft-row"><button class="aft-btn g" id="aft-sfxpick">Choose sounds…</button><span id="aft-sfxn" style="font-size:10.5px;color:#999"></span></div>' +
  '<div class="aft-row"><span>On</span><select id="aft-sfxw"><option value="scene">Cuts to different footage</option><option value="all">Every cut</option><option value="sel">Selected clips</option><option value="markers">Sequence markers</option></select></div>' +
  '<div class="aft-row"><span>At least</span><input type="number" id="aft-sfxmin" value="2" min="0" step="0.5" style="width:50px"><span>s apart · Volume</span><input type="number" id="aft-sfxdb" value="-12" step="1" style="width:50px"><span>dB</span></div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-sfxgo">Add sound effects</button></div><div class="aft-out" id="aft-sfxout"></div>');
let SFX = []; try { SFX = JSON.parse(localStorage.getItem("aft_sfx") || "[]").filter(f => fs.existsSync(f)); } catch (e) {}
const shared = () => window._afSounds ? [...window._afSounds.get("whoosh"), ...window._afSounds.get("impact")] : [];   // the same sound library as Animate
const sfxList = () => { const L = shared(); return L.length ? L : SFX; };
const sfxN = () => { const SFX = sfxList(); $("aft-sfxn").textContent = SFX.length ? SFX.length + " sound" + (SFX.length > 1 ? "s" : "") + ": " + SFX.slice(0, 3).map(f => path.basename(f)).join(", ") + (SFX.length > 3 ? "…" : "") : "none chosen"; }; sfxN(); setTimeout(sfxN, 4000);
$("aft-sfxpick").onclick = () => { try { const r = window.cep.fs.showOpenDialogEx(true, false, "Choose sound effects", "", ["wav", "mp3", "aif", "aiff", "m4a", "flac", "ogg"]); if (r && r.data && r.data.length) { SFX = r.data.map(f => f.replace(/^file:\/\//, "")); try { localStorage.setItem("aft_sfx", JSON.stringify(SFX)); } catch (e) {} if (window._afSounds) window._afSounds.set("whoosh", SFX); sfxN(); } } catch (e) { $("aft-sfxout").textContent = "⚠ " + e.message; } };
const PEAK = {};
function sfxPeak(f){ if (PEAK[f] != null) return Promise.resolve(PEAK[f]); return new Promise(res => {
  const ff = fs.existsSync(path.join(extDir(), "ffmpeg.exe")) ? path.join(extDir(), "ffmpeg.exe") : "ffmpeg", B = [];
  let p; try { p = require("child_process").spawn(ff, ["-v", "error", "-i", f, "-t", "8", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { windowsHide: true }); } catch (e) { return res(0); }
  p.stdout.on("data", d => B.push(d)); p.on("error", () => res(0));
  p.on("close", () => { const b = Buffer.concat(B), n = b.length >> 1; let best = 0, bi = 0; const W = 80;   // loudest 10 ms
    for (let i = 0; i + W < n; i += 40) { let e = 0; for (let k = i; k < i + W; k += 4) { const v = b.readInt16LE(k * 2); e += v * v; } if (e > best) { best = e; bi = i; } }
    PEAK[f] = bi / 8000; res(PEAK[f]); }); }); }
$("aft-sfxgo").onclick = async () => { const o = $("aft-sfxout"), b = $("aft-sfxgo"); if (b.disabled) return; b.disabled = true;
  const SFX = sfxList(); try { if (!SFX.length) throw new Error("Choose some sounds first (or in Animate → Sounds…).");
    const r = await callJ("aft_cuts", { mode: $("aft-sfxw").value, min: +$("aft-sfxmin").value || 0 }); if (!r.cuts.length) throw new Error("No cuts found for that choice.");
    o.textContent = "Lining up " + r.cuts.length + " sounds…"; const pk = await Promise.all(SFX.map(sfxPeak));
    let last = -1; const items = r.cuts.map(t => { let k = Math.floor(Math.random() * SFX.length); if (SFX.length > 1 && k === last) k = (k + 1) % SFX.length; last = k; return [SFX[k].replace(/\\/g, "/"), Math.max(0, t - pk[k])]; });
    const p = await callJ("aft_sfxPlace", { items, db: +$("aft-sfxdb").value || 0 });
    o.textContent = "✓ " + p.placed + " sound effects on A" + p.track + ". Mute or delete that track to remove them."; blog("sfx " + p.placed); }
  catch (e) { o.textContent = "⚠ " + e.message; } finally { b.disabled = false; } };

/* ---------- Un-nest ---------- */
window._afTools.card("aft-unnest",
  '<div class="aft-t">Un-nest</div><div class="aft-p">Select a nested sequence clip: its clips come back onto this timeline in the same place, with their position, scale, opacity and volume. Keyframed settings and effects other than those stay inside the nest, so check them.</div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-ungo">Un-nest selected</button></div><div class="aft-out" id="aft-unout"></div>');
$("aft-ungo").onclick = async () => { const o = $("aft-unout"), b = $("aft-ungo"); if (b.disabled) return; b.disabled = true;
  try { o.textContent = "Un-nesting…"; const r = await callJ("aft_unnest"); o.textContent = "✓ " + r.placed + " of " + r.total + " clips back on the timeline" + (r.keptGraphics ? ", " + r.keptGraphics + " graphic" + (r.keptGraphics > 1 ? "s" : "") + " kept on the top track (graphics can't be moved out by script)" : r.graphics ? ", ⚠ " + r.graphics + " graphic(s) couldn't be kept: Ctrl+Z" : "") + (r.skipped - (r.graphics || 0) > 0 ? ", " + (r.skipped - (r.graphics || 0)) + " skipped (speed-changed)" : "") + ". Ctrl+Z to undo."; blog("unnest " + r.placed + "/" + r.total); }
  catch (e) { o.textContent = "⚠ " + e.message; } finally { b.disabled = false; } };

/* ---------- WordCut (same engine as AssetFlow's speech tools) ---------- */
window._afTools.card("aft-wc",
  '<div class="aft-t">WordCut</div><div class="aft-p">Edit by transcript. WordCut is built into AssetFlow now: it has its own tab under Edit, sharing the same speech engine as Room to breathe and captions.</div>' +
  '<div class="aft-row"><button class="aft-btn" id="aft-wcgo">Go to WordCut</button></div><div class="aft-out" id="aft-wcout"></div>');
$("aft-wcgo").onclick = () => { const n = document.getElementById("afw-nav"); if (n) n.click(); else { try { new CSInterface().requestOpenExtension("com.wordcut.panel", ""); } catch (e) {} } };

/* ---------- sidebar entry ---------- */
let hidGrid = false;
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel", "afx-qc", "afl-panel", "afv-panel", "afk-panel", "aff-panel"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); Pn.classList.add("open"); readSel(); }
  else if (Pn.classList.contains("open")) { Pn.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
function install(){
  const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"); if (!side || !gw) return false; if (document.getElementById("aft-nav")) return true;
  const after = document.getElementById("aff-nav") || document.getElementById("afk-nav") || document.getElementById("afv-nav"); if (!after) return false;
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="Tools">🧰</span> <span class="cat-label">Tools</span>'); nav.id = "aft-nav"; nav.dataset.cat = "__aft__"; nav.dataset.tooltip = "Tools";
  after.parentNode.insertBefore(nav, after.nextSibling); gw.parentNode.insertBefore(Pn, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 240) clearInterval(iv); }, 300); }
})();
