/* AssetFlow: WordCut as a tab (Edit → WordCut). WordCut lives in ./wordcut and runs in a frame that borrows AssetFlow's
   Node and Premiere connection (see the shim at the top of wordcut/index.html). It's only loaded the first time you open
   the tab, so AssetFlow's start-up stays fast; after that it stays alive while you switch tabs. */
(function(){
"use strict";
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
document.head.appendChild(el("style", null,
  "#afw-panel{display:none;flex:1 1 auto;width:100%;min-width:0;min-height:0;position:relative;z-index:2;border-radius:var(--r,10px);overflow:hidden;border:1px solid rgba(255,255,255,.09);background:#1d1d1d}" +
  "#afw-panel.open{display:flex}#afw-panel iframe{flex:1;border:0;width:100%;height:100%;background:#1d1d1d}" +
  ".afw-fail{margin:auto;max-width:320px;text-align:center;font-size:12px;color:#bbb;line-height:1.6}.afw-fail button{margin-top:10px;border:0;border-radius:8px;background:var(--accent,#0a84ff);color:#fff;padding:8px 14px;cursor:pointer}"));
const Pn = el("div"); Pn.id = "afw-panel";
let frame = null, hidGrid = false;
function load(){ if (frame) return;
  frame = el("iframe"); frame.src = "./wordcut/index.html?v=" + Date.now(); Pn.appendChild(frame);
  frame.addEventListener("load", () => { let ok = false; try { const w = frame.contentWindow; ok = !!w.__wcEmbedded && !w.__wcEmbedError && typeof w.require === "function"; } catch (e) {}
    if (!ok) { Pn.innerHTML = '<div class="afw-fail">WordCut couldn\'t start inside AssetFlow on this Premiere.<br>It still works as its own panel.<br><button id="afw-open">Open WordCut panel</button></div>';
      const b = Pn.querySelector("#afw-open"); if (b) b.onclick = () => { try { new CSInterface().requestOpenExtension("com.wordcut.panel", ""); } catch (e) {} }; } }); }
function setOpen(on, nav){ const gw = document.getElementById("grid-wrap");
  if (on) { ["freesound-panel", "downloader-panel", "timestamp-panel", "markers-panel", "versioning-panel", "settings-panel", "afx-qc", "afl-panel", "afv-panel", "afk-panel", "aff-panel", "aft-panel", "afa-panel"].forEach(x => { const e = document.getElementById(x); e && e.classList.remove("open"); });
    const tb = document.getElementById("tags-browser"); tb && tb.classList.remove("show");
    if (gw && gw.style.display !== "none") { gw.style.display = "none"; hidGrid = true; }
    document.querySelectorAll(".cat-item").forEach(e => e.classList.toggle("active", e === nav)); Pn.classList.add("open"); load(); }
  else if (Pn.classList.contains("open")) { Pn.classList.remove("open"); if (hidGrid && gw) { gw.style.display = ""; hidGrid = false; } } }
let waitL = 0;
function install(){ const side = document.getElementById("sidebar"), gw = document.getElementById("grid-wrap"), anchor = document.getElementById("aff-nav");
  if (!side || !gw || !anchor) return false; if (document.getElementById("afw-nav")) return true;
  if (!side.dataset.aflDone && ++waitL < 40) return false;   // after the sidebar is grouped, so it lands under Edit
  const nav = el("div", "cat-item", '<span class="cat-emoji" data-tip="WordCut">✂️</span> <span class="cat-label">WordCut</span>'); nav.id = "afw-nav"; nav.dataset.cat = "__afw__"; nav.dataset.tooltip = "WordCut";
  anchor.parentNode.insertBefore(nav, anchor);               // first item under Edit
  gw.parentNode.insertBefore(Pn, gw.nextSibling);
  nav.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setOpen(true, nav); }, true);
  side.addEventListener("click", e => { const it = e.target.closest && e.target.closest(".cat-item"); if (it && it !== nav) setOpen(false); }, true);
  return true; }
if (!install()) { let n = 0; const iv = setInterval(() => { if (install() || ++n > 240) clearInterval(iv); }, 300); }
})();
