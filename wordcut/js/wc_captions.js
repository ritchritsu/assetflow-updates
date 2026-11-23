/* WordCut captions built for reading, not just for timing.
   Rules (adjustable in the panel):
   - at most `maxChars` characters per line (default 30) and `maxLines` lines on screen (default 2)   [caption best-practice guide]
   - lines and captions break at natural places: sentence ends, then commas/clauses, never right after
     "the / a / to / of / and / my / I ..." (a line never ends on a word that needs the next one)
   - every caption stays up at least `minDur` seconds and, where there is room, long enough to read at `maxCps` characters/second
   - a caption never runs longer than `maxDur` seconds and never spans a long pause or a change of clip
   Works in the panel (window.wcCaptions) and in node (module.exports) for the release tests. */
(function (root) {
  "use strict";
  const DEF = { maxChars: 30, maxLines: 2, minDur: 1.0, maxDur: 6.0, maxCps: 17, pause: 0.6, caps: false, maxWords: 0, hold: 0.3, gap: 0.04 };
  // a line or caption should never END on one of these: they lean on the word after them
  const GLUE = new Set(("a an the to of in on at for with from by into onto over under about as than " +
    "and but or nor so yet if because that which who whose whom when where while " +
    "my your his her its our their this these those some any no every each " +
    "i i'm i'll i've i'd you're we're they're he's she's it's there's " +
    "is are was were be been am do does did can could will would should shall may might must " +
    "not very more most such").split(/\s+/));
  const SOFTGLUE = new Set("more most very such not".split(" "));
  // a caption that STARTS on these reads fine (good place to break before them)
  const LEAD = new Set("and but or so because which who when where while if then although though however".split(" "));
  const bare = w => String(w).toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
  const strongEnd = w => /[.?!…]["')\]]*$/.test(w), softEnd = w => /[,;:—–-]["')\]]*$/.test(w);

  // cost of breaking AFTER word i (lower = more natural)
  function breakCost(K, i){
    const w = K[i].w, n = K[i + 1];
    if (!n) return 0;
    if (strongEnd(w)) return 0;
    if (softEnd(w)) return n.s - K[i].e > 0.25 ? 0.5 : 2;   /* a comma the speaker also pauses on is as good as a full stop */
    let c = 8;
    const gap = n.s - K[i].e;   /* where the speaker actually pauses is the best place to break: the longer the pause, the cheaper */
    if (gap > 0.06) c -= 2; if (gap > 0.15) c -= 2; if (gap > 0.3) c -= 2; if (gap > 0.5) c -= 2;
    if (LEAD.has(bare(n.w))) c -= 3;
    if (GLUE.has(bare(w))) c += SOFTGLUE.has(bare(w)) ? 9 : 30;   /* "the most / beloved" is ugly but fine; "the / dwarf" never */
    if (/^(me|you|him|her|us|them|it)[,.!?]*$/i.test(n.w) && !softEnd(w) && !strongEnd(w)) c += 6;   /* "told / you", "carried / me" */
    if (/^\d/.test(n.w) && !/[.,!?;:]$/.test(w)) c += 12;
    if (/^(of|'s|n't)$/.test(bare(n.w))) c += 7;   /* "one of", "most of", "all of the": the "of" belongs to the word before */
    if (/^(up|out|off|down|in|on|over|back|away|around)$/.test(bare(n.w)) && /^[a-z]+(ed|ing|s)?$/.test(bare(w)) && !softEnd(w)) c += 3;   /* "carried me through", "pick up": phrasal verbs */   /* keep "tier 2", "turn 20" together */
    if (/^\d/.test(w) && /^[a-z]/i.test(n.w) && !/[.,!?;:]$/.test(w)) c += 6;   /* and "3 End times" */
    return Math.max(1, c);
  }
  const text = (K, a, b, caps) => { let s = ""; for (let k = a; k <= b; k++) s += (k > a ? " " : "") + (caps ? K[k].w.toUpperCase() : K[k].w); return s; };

  // best way to lay words a..b out in up to L lines of ≤ M chars; returns {cost, lines} or null if it can't fit
  function layout(K, a, b, o){
    const M = o.maxChars, L = o.maxLines, n = b - a + 1;
    const len = []; for (let k = a; k <= b; k++) len.push(K[k].w.length);
    const lineLen = (x, y) => { let s = y - x; for (let k = x; k <= y; k++) s += len[k - a]; return s; };   // x..y absolute
    if (o.maxWords && n > o.maxWords * L) return null;
    if (L === 1 || n === 1) { const t = lineLen(a, b); if (t > M && n > 1) return null; if (o.maxWords && n > o.maxWords) return null; return { cost: 0, lines: [[a, b]] }; }
    // 2 (or more) lines: DP over line breaks
    const best = new Array(n + 1).fill(null); best[0] = { cost: 0, lines: [] };
    for (let j = 1; j <= n; j++) for (let i = 0; i < j; i++) {
      if (!best[i] || best[i].lines.length >= L) continue;
      const x = a + i, y = a + j - 1, t = lineLen(x, y);
      if (t > M && y > x) continue; if (o.maxWords && y - x + 1 > o.maxWords) continue;
      const c = best[i].cost + (j < n ? breakCost(K, y) : 0);
      if (!best[j] || c < best[j].cost) best[j] = { cost: c, lines: best[i].lines.concat([[x, y]]) };
    }
    const r = best[n]; if (!r) return null;
    if (r.lines.length === 2) {           // prefer balanced lines (bottom line a bit longer reads best)
      const t1 = lineLen(r.lines[0][0], r.lines[0][1]), t2 = lineLen(r.lines[1][0], r.lines[1][1]);
      r.cost += Math.abs(t1 - t2) / 6 + (t1 > t2 + 6 ? 1 : 0);
    }
    return r;
  }

  function build(words, opt){
    const o = Object.assign({}, DEF, opt || {});
    o.maxChars = Math.max(8, +o.maxChars || 30); o.maxLines = Math.max(1, Math.min(3, +o.maxLines || 2));
    const K = (words || []).filter(w => w && String(w.w || "").trim()).map(w => ({ w: String(w.w).trim(), s: +w.s, e: Math.max(+w.e, +w.s), c: w.c }));
    const out = [];
    // hard sections: a long pause or a different clip always ends a caption
    let st = 0;
    for (let i = 0; i < K.length; i++) {
      const n = K[i + 1];
      const gap = n ? n.s - K[i].e : 0, w = K[i].w;
      // a pause ends the caption, except a short one right after a word that needs the next one ("this is ... the ultimate")
      const leans = GLUE.has(bare(w)) && !strongEnd(w) && !softEnd(w) && gap < 2.0;
      if (!n || n.c !== K[i].c || (gap > o.pause && !leans)) { section(K, st, i, o, out); st = i + 1; }
    }
    // timing: hold a little after speech, at least minDur, and long enough to read when there is room
    for (let i = 0; i < out.length; i++) {
      const c = out[i], nx = out[i + 1], lim = nx ? nx.s - o.gap : Infinity;
      const chars = c.t.replace(/\n/g, " ").length, want = Math.max(c.e + o.hold, c.s + o.minDur, c.s + chars / o.maxCps);
      c.e = Math.min(Math.max(c.e, Math.min(want, c.s + Math.max(o.maxDur, c.e - c.s))), lim);   // never runs into the next caption
      if (c.e <= c.s) c.e = Math.min(c.s + 0.05, nx ? nx.s : c.s + 0.05);
    }
    return out;
  }

  /* Punchy style (how Ritch captions Enticity videos by hand): 1-3 word chunks split where the speaker pauses, grammar ignored,
     lowercase, captions back to back. Learned from 67 hand-made captions: gaps at his breaks median 0.22 s, inside a caption 0.06 s. */
  function punchy(words, opt){
    const o = Object.assign({ maxWords: 6, target: 3, pause: 0.14, slow: 1.4, slowW: 0, name: 6, inT: 0.12, inB: 4, inK: 5, brMax: 3, brK: 10, noK: 30, cjG: 0.2, cjB: 3, loneG: 0.3, loneB: 4, caps: false, lower: true, hold: 0.35, link: 1.0 }, opt || {});
    const K = (words || []).filter(w => w && String(w.w || "").trim()).map(w => ({ w: String(w.w).trim(), s: +w.s, e: Math.max(+w.e, +w.s), c: w.c }));
    const out = [], n = K.length; if (!n) return out;
    const gap = i => i + 1 < n ? K[i + 1].s - K[i].e : 9, hard = i => i + 1 >= n || K[i + 1].c !== K[i].c || gap(i) > 1.2;
    const best = new Array(n + 1).fill(null); best[0] = { cost: 0, cut: -1 };
    for (let j = 1; j <= n; j++) for (let i = Math.max(0, j - o.maxWords); i < j; i++) { if (!best[i]) continue;
      let bad = false; for (let k = i; k < j - 1; k++) if (hard(k)) { bad = true; break; } if (bad) continue;
      const len = j - i, g = gap(j - 1); let c = best[i].cost + 3;                     // each caption
      c += Math.abs(len - o.target) * 0.9;                                                 // 2-3 words reads best
      c += g >= o.pause ? -Math.min(o.brMax, (g - o.pause) * o.brK) : (o.pause - g) * o.noK;           // break where the voice breaks
      for (let k = i; k < j - 1; k++) { const gi = gap(k); if (gi > o.inT) c += o.inB + (gi - o.inT) * o.inK; }   // never hold a caption across a pause
      { const L = K[j - 1], ltr = bare(L.w).length || 1, dur = L.e - L.s, stretch = dur / (0.08 + 0.05 * ltr);   /* speakers stretch the last word of a phrase */
        if (stretch > o.slow) c -= Math.min(o.slowW, (stretch - o.slow) * o.slowW * 2); }
      if (j < n) { const A = K[j - 1].w, B = K[j].w;
        if (/^[A-Z0-9]/.test(A) && /^[A-Z]/.test(B) && !/[.,!?]$/.test(A) && j - 1 > 0 && !/[.!?]$/.test(K[j - 2].w)) c += o.name;   /* "Iron Man", "End Times", "Every Faction": names stay together */
        if (/^\d/.test(A) && !/[.,!?]$/.test(A)) c += o.name; }   /* "3 End Times" */
      if (/[.!?]$/.test(K[j - 1].w)) c -= 2; if (/,$/.test(K[j - 1].w)) c -= 1;
      if (len === 1 && /^(is|are|was|were|a|an|the|of|to|in|on|at|i|it|my)$/i.test(bare(K[i].w)) && g < o.loneG) c += o.loneB;   /* "is" / "the" alone reads like a glitch unless the voice really stops there */
      if (/^(and|but|so|because|or|then|when|if)[,.]?$/i.test(K[j - 1].w)) c += g > o.cjG ? (len === 1 ? -o.cjB : 0) : 2;   /* "but" / "or" on its own when the speaker pauses after it */             // "and" starts the next chunk rather than ending this one
      if (!best[j] || c < best[j].cost) best[j] = { cost: c, cut: i }; }
    const cuts = []; for (let j = n; j > 0; j = best[j].cut) cuts.unshift([best[j].cut, j - 1]);
    for (const [x, y] of cuts) { let t = K.slice(x, y + 1).map(w => w.w).join(" ");
      t = t.replace(/[.,;:?]+(?=\s|$)/g, "");   /* like the hand-made ones: no punctuation but "!" */
      if (o.lower) t = t.toLowerCase(); if (o.caps) t = t.toUpperCase(); out.push({ s: K[x].s, e: K[y].e, t }); }
    for (let i = 0; i < out.length; i++) { const nx = out[i + 1];   /* back to back: each one stays until the next starts (unless there's a long silence) */
      out[i].e = nx && nx.s - out[i].e < o.link ? nx.s : out[i].e + o.hold; }
    return out; }

  // split one section (words a..b) into captions with DP: each caption fits the layout and maxDur, total break cost minimal
  function section(K, a, b, o, out){
    const n = b - a + 1, best = new Array(n + 1).fill(null); best[0] = { cost: 0, cuts: [] };
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        const x = a + i, y = a + j - 1;
        const dur = K[y].e - K[x].s; if (dur > o.maxDur && y > x) break;
        const lay = layout(K, x, y, o); if (!lay) { if (y > x) break; else continue; }
        if (!best[i]) continue;
        const chars = text(K, x, y).length, rd = chars / Math.max(0.5, dur);
        let c = best[i].cost + (j < n ? breakCost(K, y) * 1.5 : 0) + lay.cost + 4;            // +4 per caption: fewer, fuller captions
        if (rd > o.maxCps) c += (rd - o.maxCps) * 0.6;                                          // too much text for the time it is spoken
        if (y - x === 0 && n > 1) c += 6;                                                       // avoid lonely one-word captions
        for (let k = x; k < y; k++) { const g = K[k + 1].s - K[k].e; if (g > 0.3) c += Math.min(12, (g - 0.15) * 30); }   // a caption shouldn't sit on screen across a pause: split there instead
        for (let k = x; k < y; k++) if (strongEnd(K[k].w) && y - k >= 2) {   /* two sentences in one caption read as two thoughts glued together */
          const whole = x === a || strongEnd(K[x - 1].w);   /* a complete short sentence ("Yeah." "Oh my.") may share; the tail of a sentence may not */
          if (!(whole && k - x <= 2)) c += 14; }   // two real sentences in one caption read as two thoughts glued together (a short "Yeah." or "Oh my." may share)
        if (y - x === 1 && n > 3 && !strongEnd(K[y].w) && !(y < b && K[y + 1].s - K[y].e > 0.3)) c += 3;   /* fine when the speaker pauses after it */                                      // two-word scraps only where the sentence really ends
        if (!best[j] || c < best[j].cost) best[j] = { cost: c, cuts: best[i].cuts.concat([[x, y, lay.lines]]) };
      }
      if (!best[j]) best[j] = { cost: (best[j - 1] ? best[j - 1].cost : 0) + 50, cuts: (best[j - 1] ? best[j - 1].cuts : []).concat([[a + j - 1, a + j - 1, [[a + j - 1, a + j - 1]]]]) };   // a word longer than a line: alone
    }
    for (const [x, y, lines] of best[n].cuts) {
      let t = lines.map(([p, q]) => text(K, p, q, o.caps)).join("\n");
      if (o.caps) t = t.replace(/[.,!?;:]+(?=\n|$)/g, "");
      out.push({ s: K[x].s, e: K[y].e, t });
    }
  }

  function check(caps, opt){   // problems a human reader would hit (used by tests and by the quality check)
    const o = Object.assign({}, DEF, opt || {}), P = [];
    caps.forEach((c, i) => {
      const ls = c.t.split("\n");
      if (ls.length > o.maxLines) P.push(i + ": " + ls.length + " lines");
      ls.forEach(l => { if (l.length > o.maxChars && /\s/.test(l)) P.push(i + ": line " + l.length + " chars"); const lw = l.split(" ").pop(), last = bare(lw); if (GLUE.has(last) && !strongEnd(lw) && !softEnd(lw) && i !== caps.length - 1) P.push(i + ": line ends on '" + last + "'"); });
      if (c.e <= c.s) P.push(i + ": zero length");
      if (caps[i + 1] && c.e > caps[i + 1].s + 1e-6) P.push(i + ": overlaps next");
    });
    return P;
  }
  const api = { build, punchy, check, DEF, GLUE };
  if (root) root.wcCaptions = api;                                     // the panel (CEP also defines `module`, so always set the global)
  if (typeof module !== "undefined" && module && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
