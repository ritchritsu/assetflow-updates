/* Freeze finder. Whenever the panel stops responding for more than 300 ms, af_errors.log gets one line saying what ran:
   which handler (click, timer, Premiere reply, file read, background job…), where it lives (file:line), what page was open
   and what you did just before. Always on; costs about a microsecond per callback. At most 300 lines per session. */
(function(){
"use strict";
const log0 = m => { try { window._afBootLog && _afBootLog(m); } catch (e) {} };
let lines = 0; const log = m => { if (lines++ < 300) log0(m); };
const now = () => performance.now(), SLOW = 200;
/* ---- 1. named panel functions (the first minute, as before) ---- */
const orig = {}; let depth = 0;
for (const k of Object.getOwnPropertyNames(window)) {
  let f; try { f = window[k]; } catch (e) { continue; }
  if (typeof f !== "function" || /^[A-Z]/.test(k) || /^(on|handle)/i.test(k) || k === "_afBootLog" || k.startsWith("webkit")) continue;
  let src = ""; try { src = Function.prototype.toString.call(f); } catch (e) { continue; } if (/\[native code\]/.test(src)) continue;
  const d = Object.getOwnPropertyDescriptor(window, k); if (!d || !d.writable && !d.set) continue;
  orig[k] = f;
  const w = function(){ depth++; const t = now(); try { return f.apply(this, arguments); } finally { depth--; const ms = now() - t; if (ms > 150) log("slow " + k + " " + Math.round(ms) + "ms" + (depth ? " (inside another)" : "")); } };
  try { Object.defineProperty(w, "length", { value: f.length }); w.prototype = f.prototype; window[k] = w; } catch (e) { delete orig[k]; }
}
log0("trace on: " + Object.keys(orig).length + " functions watched");
setTimeout(() => { for (const k in orig) { try { window[k] = orig[k]; } catch (e) {} } }, 60000);
/* ---- 2. every callback: where it came from, how long it took ---- */
const here = () => { const e = {}; try { Error.captureStackTrace ? Error.captureStackTrace(e, here) : (e.stack = new Error().stack); } catch (x) {} return e; };   // stack text is only built if it's ever read
const where = (reg, fn) => { let s = ""; try { s = String(reg.stack || ""); } catch (e) {}
  const L = s.split("\n").map(x => x.trim()).filter(x => /^at /.test(x) && !/af_trace\.js/.test(x)), top = L[0] || "";
  const m = /([\w.\-]+\.(?:js|html|jsx))(?:\?[^:)]*)?:(\d+)(?::\d+)?\)?$/.exec(top); const fnm = (fn && fn.name) || ((/^at ([^\s(]+)/.exec(top) || [])[1]) || "";
  return (fnm ? fnm + " " : "") + (m ? m[1] + ":" + m[2] : (top.slice(3, 80) || "?")); };
let last = null;   // the slowest callback since the last freeze report
const timed = (kind, fn, reg, extra) => function(){ const t = now(); try { return fn.apply(this, arguments); } finally { const ms = now() - t;
  if (ms > SLOW) { const lab = kind + " " + where(reg, fn) + (extra ? " " + extra(arguments) : ""); log("slow " + lab + " " + Math.round(ms) + "ms"); if (!last || ms > last[1]) last = [lab, ms, t]; } } };
const wrapTimer = name => { const o = window[name]; if (typeof o !== "function") return;
  window[name] = function(fn){ if (typeof fn !== "function") return o.apply(this, arguments); const a = Array.prototype.slice.call(arguments); a[0] = timed(name === "requestAnimationFrame" ? "frame" : name === "setInterval" ? "repeating timer" : "timer", fn, here()); return o.apply(this, a); }; };
["setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback"].forEach(wrapTimer);
/* event listeners: the same function must be removable, so remember each wrapper */
const WM = new WeakMap(), ET = EventTarget.prototype, add0 = ET.addEventListener, rem0 = ET.removeEventListener;
const desc = el => { try { if (!el || el === window) return "window"; if (el === document) return "document"; return (el.tagName || "").toLowerCase() + (el.id ? "#" + el.id : el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""); } catch (e) { return "?"; } };
ET.addEventListener = function(type, fn, opt){ if (typeof fn !== "function") return add0.call(this, type, fn, opt);
  let m = WM.get(fn); if (!m) WM.set(fn, m = {}); const tgt = this; const w = m[type] || (m[type] = timed(type, fn, here(), () => "on " + desc(tgt)));
  return add0.call(this, type, w, opt); };
ET.removeEventListener = function(type, fn, opt){ const m = typeof fn === "function" && WM.get(fn); return rem0.call(this, type, m && m[type] || fn, opt); };
/* onclick = … style handlers and anything that stops the event early: remember when each user action started; a freeze that
   begins during one is credited to it */
let last_act = null; const ACTS = [];
const txt = el => { try { const s = (el.closest && el.closest("button,[title],.cat-item,.afa-card,.asset-card") || el); const t = (s.getAttribute && (s.getAttribute("title") || s.getAttribute("data-tooltip"))) || s.textContent || ""; return t.trim() ? " \"" + t.trim().replace(/\s+/g, " ").slice(0, 28) + "\"" : ""; } catch (e) { return ""; } };
["click", "dblclick", "input", "change", "keydown", "mousedown", "wheel", "dragstart", "drop", "scroll"].forEach(t => add0.call(window, t, e => {
  const a = [t, desc(e.target) + (t === "scroll" || t === "wheel" ? "" : txt(e.target)), now(), Date.now()]; last_act = a; ACTS.push(a); if (ACTS.length > 20) ACTS.shift(); }, true));
/* observers */
["IntersectionObserver", "MutationObserver", "ResizeObserver", "PerformanceObserver"].forEach(n => { const O = window[n]; if (typeof O !== "function" || n === "PerformanceObserver") return;
  const W = function(cb, o){ return new O(typeof cb === "function" ? timed(n.replace("Observer", "").toLowerCase() + " watcher", cb, here()) : cb, o); }; W.prototype = O.prototype; try { window[n] = W; } catch (e) {} });
/* Premiere replies (ExtendScript results come back as callbacks) */
try { const A = window.__adobe_cep__; if (A && A.evalScript) { const ev0 = A.evalScript.bind(A);
  A.evalScript = function(s, cb){ return ev0(s, typeof cb === "function" ? timed("Premiere reply", cb, here(), () => "to " + String(s).replace(/\s+/g, " ").slice(0, 40)) : cb); }; } } catch (e) {}
/* Node: file reads, programs' output, finished processes */
try { const EE = require("events"), P = (EE.EventEmitter || EE).prototype, on0 = P.on;
  const wrapE = function(t, fn){ if (typeof fn !== "function" || typeof t !== "string") return on0.apply(this, arguments);   /* Node's own internal events use symbols: left alone */ let m = WM.get(fn); if (!m) WM.set(fn, m = {}); const w = m["n:" + t] || (m["n:" + t] = timed("node " + String(t), fn, here())); w.listener = fn; return on0.call(this, t, w); };
  P.on = P.addListener = wrapE; const once0 = P.once; P.once = function(t, fn){ return typeof fn === "function" && typeof t === "string" ? once0.call(this, t, timed("node " + String(t), fn, here())) : once0.apply(this, arguments); };
  const rm0 = P.removeListener; P.removeListener = P.off = function(t, fn){ const m = typeof fn === "function" && typeof t === "string" && WM.get(fn); return rm0.call(this, t, m && m["n:" + t] || fn); };
  const fs = require("fs"); ["readFile", "readdir", "stat", "writeFile", "lstat", "open", "close", "read", "rename", "unlink", "access", "mkdir", "copyFile"].forEach(k => { const o = fs[k]; if (typeof o !== "function") return;
    fs[k] = function(){ const a = Array.prototype.slice.call(arguments), i = a.length - 1; if (typeof a[i] === "function") a[i] = timed("file " + k, a[i], here()); return o.apply(this, a); }; });
  const cp = require("child_process"); ["exec", "execFile"].forEach(k => { const o = cp[k]; if (typeof o !== "function") return;
    cp[k] = function(){ const a = Array.prototype.slice.call(arguments), i = a.length - 1; if (typeof a[i] === "function") a[i] = timed("program finished (" + k + ")", a[i], here(), () => String(arguments[0] || "").split(/[\\/ ]/).filter(Boolean).slice(-1)[0] || ""); return o.apply(this, a); }; });
} catch (e) {}
/* ---- 3. the freeze itself, with what ran and where you were ---- */
const page = () => { try { const a = document.querySelector("#sidebar .cat-item.active .cat-label, #sidebar .cat-item.active"); return a ? a.textContent.trim().replace(/\s*\d[\d,.]*\s*$/, "").slice(0, 24) : ""; } catch (e) { return ""; } };
try { new PerformanceObserver(list => { for (const e of list.getEntries()) { if (e.duration <= 300) continue; const s0 = e.startTime, s1 = s0 + e.duration;
    const c = last && last[2] >= s0 - 50 && last[2] <= s1 + 50 ? last : null, u = ACTS.filter(a => a[2] >= s0 - 5 && a[2] <= s1).pop();
    log("freeze " + Math.round(e.duration) + "ms at +" + Math.round(s0) + "ms" + (c ? " ← " + c[0] + " (" + Math.round(c[1]) + "ms)" : u ? " ← " + u[0] + " on " + u[1] : " (no script ran long: layout/drawing, memory clean-up or a synchronous wait)") +
      " | page: " + (page() || "?") + (!u && last_act && Date.now() - last_act[3] < 5000 ? " | after " + last_act[0] + " on " + last_act[1] : ""));
    last = null; } }).observe({ entryTypes: ["longtask"] }); } catch (e) {}
})();
