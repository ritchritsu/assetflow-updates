/* AssetFlow layout: groups the sidebar by what you're doing, and keeps the Tools page short (grouped, foldable cards).
   Runs after every page has added its sidebar entry. Only moves existing elements; changes no behaviour. */
(function(){
"use strict";
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const lab = t => { const d = document.createElement("div"); d.className = "cat-section-label"; d.textContent = t; d.dataset.afl = "1"; return d; };
const item = name => [...document.querySelectorAll("#sidebar .cat-item")].find(e => { const l = e.querySelector(".cat-label"); return l && l.textContent.trim() === name; });
const label = name => [...document.querySelectorAll("#sidebar .cat-section-label")].filter(e => e.textContent.trim().toLowerCase() === name.toLowerCase());

function sidebar(){
  const side = document.getElementById("sidebar"); if (!side) return false;
  const need = ["Quality check", "Audio levels", "Isolate voice", "Track", "Find a moment", "Tools", "Markers", "Freesound", "Downloads"];
  const I = {}; for (const n of need) { I[n] = item(n); if (!I[n]) return false; }
  if (side.dataset.aflDone) return true; side.dataset.aflDone = "1";
  const ic = (n, e) => { const x = I[n] && I[n].querySelector(".cat-emoji"); if (x) x.textContent = e; }; ic("Freesound", "🌐"); ic("Audio levels", "📊");   // one 🔊 is enough (Sound FX)
  label("Utilities").forEach(l => l.textContent = "Library");
  label("Setup").forEach(l => l.textContent = "Get assets");
  label("Plan").forEach(l => l.remove());
  const fin = label("Finish"); if (fin[0]) fin[0].remove(); if (fin[1]) fin[1].textContent = "Templates & presets";   // the first "Finish" is ours; the asset one becomes Templates
  const anchor = I["Downloads"], E = lab("Edit"), F = lab("Finish");
  let at = anchor; const put = n => { at.parentNode.insertBefore(n, at.nextSibling); at = n; };
  put(E); ["Find a moment", "Track", "Isolate voice", "Tools"].forEach(n => put(I[n]));
  put(F); ["Markers", "Quality check", "Audio levels"].forEach(n => put(I[n]));
  return true; }

const SUM = { "aft-caps": "word-by-word or editable", "aft-sfx": "whooshes lined up on cuts", "aft-mus": "song ends exactly on time", "aft-batch": "one setting on many clips", "aft-fitc": "fit or fill the frame", "aft-unnest": "nest back into clips", "aft-clean": "unused items, tidy bins", "aft-relink": "find missing media", "aft-export": "many presets in one go", "aft-wc": "edit by transcript" };
const GROUPS = [["On the timeline", ["aft-caps", "aft-sfx", "aft-mus", "aft-batch", "aft-fitc", "aft-unnest"]], ["Project", ["aft-clean", "aft-relink"]], ["Export", ["aft-export"]], ["Apps", ["aft-wc"]]];
function tools(){
  const box = document.getElementById("aft-cards"); if (!box) return false;
  if (!GROUPS.every(([, ids]) => ids.every(id => document.getElementById(id)))) return false;
  if (box.dataset.aflDone) return true; box.dataset.aflDone = "1";
  const st = document.createElement("style");
  st.textContent = ".afl-g{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3,#888);margin:6px 2px 0}" +
    ".aft-card>.aft-t{cursor:pointer;display:flex;align-items:center;gap:8px;margin:0;user-select:none}.aft-card>.aft-t:after{content:'';margin-left:auto;width:6px;height:6px;border-right:1.5px solid #888;border-bottom:1.5px solid #888;transform:rotate(-45deg);transition:transform .15s}" +
    ".aft-card.afl-open>.aft-t:after{transform:rotate(45deg)}.aft-card>.afl-body{display:none;margin-top:8px}.aft-card.afl-open>.afl-body{display:block}.aft-card .afl-sum{font-size:10.5px;color:var(--text3,#888);font-weight:400;margin-left:2px}" +
    ".aft-card:not(.afl-open):hover{background:rgba(255,255,255,.055)}" +
    ".aft-card .aft-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0;font-size:11px;color:var(--text2,#bbb)}.aft-card .aft-row input[type=number]{width:58px;flex:0 0 auto}.aft-card .aft-row select{max-width:100%}.aft-card .aft-out{font-size:11px;color:var(--text2,#aaa);margin-top:6px;line-height:1.45;min-height:14px}";
  document.head.appendChild(st);
  const open = new Set((LS.get("afl_open", "aft-caps") || "").split(",").filter(Boolean));
  for (const [g, ids] of GROUPS) { const h = document.createElement("div"); h.className = "afl-g"; h.textContent = g; box.appendChild(h);
    for (const id of ids) { const c = document.getElementById(id), t = c.querySelector(".aft-t"); if (!t) { box.appendChild(c); continue; }
      const body = document.createElement("div"); body.className = "afl-body"; while (t.nextSibling) body.appendChild(t.nextSibling); c.appendChild(body);
      if (SUM[id]) { const s = document.createElement("span"); s.className = "afl-sum"; s.textContent = SUM[id]; t.appendChild(s); }
      if (open.has(id)) c.classList.add("afl-open");
      t.onclick = () => { c.classList.toggle("afl-open"); if (c.classList.contains("afl-open")) open.add(id); else open.delete(id); LS.set("afl_open", [...open].join(",")); };
      box.appendChild(c); } }
  return true; }

/* A narrow panel (AssetFlow opens 420 px wide): the sidebar shrinks to its icons so the page gets the room. The « button pins it open or closed. */
function narrow(){ const side = document.getElementById("sidebar"); if (!side) return;
  if (!document.getElementById("afl-side-css")) { const st = document.createElement("style"); st.id = "afl-side-css";
    st.textContent = "#afl-tog{display:flex;align-items:center;justify-content:center;height:18px;margin:0 2px 2px;border-radius:7px;color:var(--text3,#888);font-size:11px;cursor:pointer;user-select:none;position:relative;z-index:1}#afl-tog:hover{background:rgba(255,255,255,.07);color:#ddd}" +
      "#afl-tip{display:none;position:fixed;z-index:9999;pointer-events:none;background:rgba(28,28,32,.97);color:#eee;font-size:11px;font-weight:500;padding:4px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 18px rgba(0,0,0,.45);white-space:nowrap}" +
      "#sidebar.collapsed .cat-count{display:none}#sidebar.collapsed .cat-item{min-height:28px}#sidebar.collapsed .cat-section-label[data-afl]{opacity:1;max-height:1px;height:1px;padding:0;margin:5px 9px;background:rgba(255,255,255,.1);overflow:hidden;color:transparent}";
    document.head.appendChild(st); }
  let tog = document.getElementById("afl-tog");
  if (!tog) { tog = document.createElement("div"); tog.id = "afl-tog"; side.insertBefore(tog, side.firstChild);
    tog.onclick = () => { LS.set("afl_side", side.classList.contains("collapsed") ? "open" : "closed"); narrow(); }; }
  const pref = LS.get("afl_side", "auto"), on = pref === "closed" || (pref === "auto" && window.innerWidth < 480);
  if (side.classList.contains("collapsed") !== on) side.classList.toggle("collapsed", on);
  tog.textContent = on ? "»" : "«"; tog.title = on ? "Show the names" : "Icons only (more room for the page)";
  /* icons only: the name pops up beside the icon the moment the pointer is on it (the sidebar clips anything drawn inside it, so this floats above the page) */
  if (!side.dataset.aflTip) { side.dataset.aflTip = "1"; const tip = document.createElement("div"); tip.id = "afl-tip"; document.body.appendChild(tip);
    side.addEventListener("mouseover", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (!it || !side.classList.contains("collapsed")) { tip.style.display = "none"; return; }
      const l = it.querySelector(".cat-label"), t = l && l.textContent.trim(); if (!t) { tip.style.display = "none"; return; } const r = it.getBoundingClientRect(); tip.textContent = t; tip.style.display = "block"; tip.style.left = Math.round(r.right + 8) + "px"; tip.style.top = Math.round(r.top + r.height / 2 - 11) + "px"; });
    side.addEventListener("mouseleave", () => { tip.style.display = "none"; }); side.addEventListener("click", () => { tip.style.display = "none"; }, true); } }
/* Markers: pick a colour by its colour (the page asked for a number from 0 to 7) */
function markers(){ const inp = document.getElementById("mkr-color-filter"); if (!inp) return false; if (inp.dataset.afl) return true; inp.dataset.afl = "1";
  const C = [["green", "#6aa84f"], ["red", "#d9534f"], ["purple", "#9b6bd6"], ["orange", "#e8913a"], ["yellow", "#e2c94a"], ["white", "#e8e8e8"], ["blue", "#4a90d9"], ["cyan", "#4ac6c6"]];
  const st = document.createElement("style"); st.textContent = ".afl-mk{display:flex;gap:5px;align-items:center;flex:0 0 auto}.afl-mk button{width:16px;height:16px;border-radius:50%;border:2px solid transparent;opacity:.7;cursor:pointer;padding:0}.afl-mk button:hover{opacity:1}.afl-mk button.on{border-color:#fff;opacity:1;box-shadow:0 0 0 1px rgba(0,0,0,.6)}.mkr-filter-row{flex-wrap:wrap}"; document.head.appendChild(st);
  const box = document.createElement("div"); box.className = "afl-mk"; box.innerHTML = C.map(([n, c], i) => '<button data-i="' + i + '" title="Only ' + n + ' markers (click again for all)" style="background:' + c + '"></button>').join("");
  inp.style.display = "none"; inp.parentNode.appendChild(box);
  box.querySelectorAll("button").forEach(b => b.onclick = () => { const off = inp.value === b.dataset.i; inp.value = off ? "" : b.dataset.i; box.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b && !off)); inp.dispatchEvent(new Event("input", { bubbles: true })); });
  return true; }
/* On a tool page the library's search box, card-size and sort bars do nothing: they step aside so the page gets their room (about a third more on a small panel) */
const TOOLP = ["afx-qc", "afl-panel", "afv-panel", "afk-panel", "aff-panel", "aft-panel", "afa-panel", "afw-panel", "markers-panel"], seen = new Set();
function chrome(){ const app = document.getElementById("app") || document.body, on = TOOLP.some(id => { const e = document.getElementById(id); return e && e.classList.contains("open"); }); if (app.classList.contains("afl-tool") !== on) app.classList.toggle("afl-tool", on); }
function watchPages(){ if (!document.getElementById("afl-tool-css")) { const st = document.createElement("style"); st.id = "afl-tool-css"; st.textContent = ".afl-tool #search-wrap,.afl-tool #sort-bar{display:none!important}"; document.head.appendChild(st); }
  TOOLP.forEach(id => { if (seen.has(id)) return; const e = document.getElementById(id); if (!e) return; seen.add(id); new MutationObserver(chrome).observe(e, { attributes: true, attributeFilter: ["class"] }); }); chrome(); return seen.size === TOOLP.length; }
let rz = 0; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(narrow, 80); });

let n = 0; const iv = setInterval(() => { const a = sidebar(), b = tools(), c = markers(), d = watchPages(); narrow(); if ((a && b && c && d) || ++n > 200) clearInterval(iv); }, 250);
})();
