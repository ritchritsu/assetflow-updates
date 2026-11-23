/* AssetFlow accessibility: keyboard use and screen-reader names for the whole panel (loaded last; works on everything
   the other modules add later too, in idle time so it never slows scrolling).
   - Every sidebar page, card and clickable control can be reached with Tab and shows a clear focus ring.
   - Sidebar: Up/Down arrows move between pages, Enter or Space opens one.
   - Cards: Enter or Space opens the card's preview; then AssetFlow's own keys work (Enter = import, Space = play).
   - Icon-only buttons and inputs get a spoken name from their tooltip or placeholder; status lines are announced.
   - "Reduce motion" in Windows turns off the panel's own animations (not the Animate page's previews). */
(function(){
"use strict";
const css = document.createElement("style");
css.textContent =
  ":focus-visible{outline:2px solid var(--accent,#0a84ff)!important;outline-offset:2px!important;border-radius:6px}" +
  ".cat-item:focus-visible,.asset-card:focus-visible{outline-offset:-2px!important}" +
  "@media (prefers-reduced-motion: reduce){body *:not([class*=\"afa-\"]):not([class*=\"afa-\"] *){animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}";
document.head.appendChild(css);

const NAMED = "button,a[href],input:not([type=hidden]),select,textarea,[role=button]";
const nameOf = e => (e.getAttribute("aria-label") || e.getAttribute("title") || e.getAttribute("data-tooltip") || e.getAttribute("data-tip") || e.getAttribute("placeholder") || "").trim();
const textOf = e => (e.textContent || "").replace(/\s+/g, " ").trim();
function fix(root){
  if (!root || root.nodeType !== 1) return;
  const q = s => { const L = root.matches && root.matches(s) ? [root] : []; return L.concat(Array.from(root.querySelectorAll(s))); };
  q(".cat-item:not([data-a11y])").forEach(e => { e.dataset.a11y = "1"; e.tabIndex = 0; e.setAttribute("role", "button");
    if (!e.getAttribute("aria-label")) { const n = (e.dataset.tooltip || textOf(e.querySelector(".cat-label") || e)).trim(); if (n) e.setAttribute("aria-label", n); } });
  q(".asset-card:not([data-a11y])").forEach(e => { e.dataset.a11y = "1"; if (e.tabIndex < 0) e.tabIndex = 0;
    if (!e.getAttribute("aria-label")) { const n = textOf(e.querySelector(".card-name,.asset-name,.name,[class*=name]") || e).slice(0, 120); if (n) e.setAttribute("aria-label", n); } });
  q(NAMED).forEach(e => { if (e.dataset.a11y) return; e.dataset.a11y = "1";
    if (!e.getAttribute("aria-label") && !textOf(e) && !(e.labels && e.labels.length)) { const n = nameOf(e); if (n) e.setAttribute("aria-label", n); }
    else if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) && !e.getAttribute("aria-label") && !(e.labels && e.labels.length)) { const n = nameOf(e); if (n) e.setAttribute("aria-label", n); } });
  q("img:not([alt])").forEach(e => e.setAttribute("alt", ""));
  q("[id$=-st]:not([aria-live]),[class$=-st]:not([aria-live]),#status:not([aria-live]),.toast:not([aria-live])").forEach(e => e.setAttribute("aria-live", "polite"));
}
/* new elements: labelled in idle time, in batches */
let pend = new Set(), sched = false;
const idle = window.requestIdleCallback || (f => setTimeout(f, 200));
function run(){ sched = false; const L = Array.from(pend); pend = new Set(); L.forEach(n => { if (n.isConnected) try { fix(n); } catch (e) {} }); }
new MutationObserver(M => { for (const m of M) for (const n of m.addedNodes) if (n.nodeType === 1) pend.add(n);
  if (pend.size > 400) { const keep = new Set([document.body]); pend = keep; }   // a big redraw: one pass over the page is cheaper
  if (!sched && pend.size) { sched = true; idle(run, { timeout: 1500 }); } }).observe(document.body, { childList: true, subtree: true });
idle(() => fix(document.body), { timeout: 2000 });

/* the page that's open, for screen readers */
function current(){ document.querySelectorAll(".cat-item").forEach(e => { if (e.classList.contains("active")) e.setAttribute("aria-current", "page"); else e.removeAttribute("aria-current"); }); }
document.addEventListener("click", e => { if (e.target.closest && e.target.closest(".cat-item")) setTimeout(current, 50); }, true);

/* keyboard */
document.addEventListener("keydown", e => {
  const t = e.target; if (!t || !t.closest || e.altKey || e.ctrlKey || e.metaKey) return;
  const nav = t.classList && t.classList.contains("cat-item") ? t : null;
  if (nav) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); t.click(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation();
      const L = Array.from(document.querySelectorAll("#sidebar .cat-item")).filter(x => x.offsetParent !== null), i = L.indexOf(t);
      const n = L[(i + (e.key === "ArrowDown" ? 1 : -1) + L.length) % L.length]; if (n) n.focus(); return; } }
  if (t.classList && t.classList.contains("asset-card") && (e.key === "Enter" || e.key === " ")) {
    /* first press opens the card's preview; once it's the previewed card, AssetFlow's own keys take over (Enter = import, Space = play) */
    let cur = null; try { cur = window._previewAssetForImport || (typeof _previewAssetForImport !== "undefined" ? _previewAssetForImport : null); } catch (x) {}
    if (!(cur && t._asset && cur.path === t._asset.path)) { e.preventDefault(); e.stopPropagation(); t.click(); } return; }
  if (t.getAttribute && t.getAttribute("role") === "button" && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); }
}, true);
})();
