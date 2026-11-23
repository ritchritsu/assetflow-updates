/* AssetFlow — Tools: quick fixes Premiere makes slow. Batch changes, fit to frame (and more cards added over time). */
(function(){
"use strict";
let fs, path, cp, os; try { fs = require("fs"); path = require("path"); cp = require("child_process"); os = require("os"); } catch (e) { return; }
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const blog = m => { try { window._afBootLog && _afBootLog("Tools: " + m); } catch (e) {} };
const cs = (() => { try { return new CSInterface(); } catch (e) { return null; } })();
const jsx = code => new Promise(r => { try { cs ? cs.evalScript(code, v => r(v)) : r(""); } catch (e) { r(""); } });
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
