/* Auto-update: a few seconds after AssetFlow opens, it checks update_url.txt's address for a newer version.json.
   If there is one, the changed files are downloaded into this extension folder (old ones kept in _update_backup)
   and take effect the next time the panel opens. Offline or no address set: nothing happens. */
(function(){
"use strict";
let fs, path, https; try { fs = require("fs"); path = require("path"); https = require("https"); } catch (e) { return; }
const log = m => { try { window._afBootLog && _afBootLog("update: " + m); } catch (e) {} };
let ext; try { ext = decodeURI(String(window.__adobe_cep__.getSystemPath("extension")).replace(/^file:\/{2,3}/, "")).replace(/^\/([A-Za-z]:)/, "$1"); } catch (e) { return; }
const P = f => path.join(ext, f), ver = () => { try { return +JSON.parse(fs.readFileSync(P("version.json"), "utf8")).v || 0; } catch (e) { return 0; } };
const get = (url, n = 0) => new Promise((ok, no) => https.get(url, { headers: { "User-Agent": "AssetFlow" }, timeout: 20000 }, r => {
  if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) { r.resume(); return ok(get(r.headers.location, n + 1)); }
  if (r.statusCode !== 200) { r.resume(); return no(new Error("HTTP " + r.statusCode)); }
  const B = []; r.on("data", d => B.push(d)); r.on("end", () => ok(Buffer.concat(B))); }).on("error", no).on("timeout", function(){ this.destroy(new Error("timeout")); }));
const toast = t => { try { const d = document.createElement("div"); d.textContent = t; d.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;background:#1f2a1f;color:#cfe9cf;border:1px solid #3c6b3c;border-radius:9px;padding:8px 14px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,.5)"; document.body.appendChild(d); setTimeout(() => d.remove(), 9000); } catch (e) {} };
async function check(){
  let base = ""; try { base = fs.readFileSync(P("update_url.txt"), "utf8").trim().replace(/\/+$/, ""); } catch (e) {}
  if (!base) return;
  const man = JSON.parse((await get(base + "/version.json")).toString("utf8")), have = ver();
  if (!(+man.v > have)) return;
  const files = (man.files || []).filter(f => typeof f === "string" && !/(^|[\\/])\.\.([\\/]|$)/.test(f) && !path.isAbsolute(f));
  const got = []; for (const f of files) got.push([f, await get(base + "/" + f.split(/[\\/]/).map(encodeURIComponent).join("/"))]);   // download everything first: never half an update
  const bk = P(path.join("_update_backup", "v" + have));
  for (const [f, data] of got) { const to = P(f); fs.mkdirSync(path.dirname(to), { recursive: true });
    try { if (fs.existsSync(to)) { fs.mkdirSync(path.dirname(path.join(bk, f)), { recursive: true }); fs.copyFileSync(to, path.join(bk, f)); } } catch (e) {}
    fs.writeFileSync(to + ".new", data); fs.renameSync(to + ".new", to); }
  fs.writeFileSync(P("version.json"), JSON.stringify({ v: +man.v, notes: man.notes || "" }));
  log("installed v" + man.v + " (" + got.length + " files)");
  toast("AssetFlow updated to v" + man.v + (man.notes ? ": " + man.notes : "") + ". Close and reopen the panel to use it.");
}
setTimeout(() => check().catch(e => log("skipped: " + e.message)), 4000);
})();
