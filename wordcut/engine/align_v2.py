"""WordCut precise word timing: re-times words to where they are really spoken (forced alignment).

Keeps the transcript TEXT; only moves each word's start/end. Uses a wav2vec2 CTC model (ONNX, on the GPU when available)
and a Viterbi forced alignment. About 20 ms precision.

As a module:  align.refine(audio_16k_float32, words)   words = [{"w","s","e"}] in seconds from the start of `audio`
As a tool:    python align.py words.json parts.json out.json ffmpeg.exe
              words.json = [[start, end, text], ...] in global seconds; parts.json = [{"path", "off", "dur"}, ...]
"""
import os, sys, json, time, re, subprocess, urllib.request
import numpy as np

SR = 16000
HOP = 320                       # one model frame = 20 ms
REPO = "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/"
DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "WordCut", "models", "w2v")
_M = {}

def log(m): print(m, file=sys.stderr, flush=True)

def _get(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 100: return
    os.makedirs(os.path.dirname(dst), exist_ok=True); tmp = dst + ".part"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
                n = int(r.headers.get("Content-Length") or 0); got = 0; last = 0
                while True:
                    b = r.read(1 << 20)
                    if not b: break
                    f.write(b); got += len(b)
                    if n and time.time() - last > 2: last = time.time(); log("Downloading the timing model - %d%%" % (100 * got // n))
            os.replace(tmp, dst); return
        except Exception as e:
            log("Download retry (%s)" % e); time.sleep(3 * (attempt + 1))
    raise RuntimeError("Couldn't download the timing model: " + url)

def model():
    if "s" in _M: return _M
    import onnxruntime as ort
    try: ort.set_default_logger_severity(3)
    except Exception: pass
    try: ort.preload_dlls()          # loads the CUDA / cuDNN libraries that came with onnxruntime-gpu (same as WordCut's transcriber)
    except Exception: pass
    _get(REPO + "vocab.json", os.path.join(DIR, "vocab.json"))
    _get(REPO + "onnx/model.onnx", os.path.join(DIR, "model.onnx"))
    voc = json.load(open(os.path.join(DIR, "vocab.json"), encoding="utf-8"))
    prov = ["CPUExecutionProvider"]
    if "CUDAExecutionProvider" in ort.get_available_providers():
        prov = [("CUDAExecutionProvider", {"cudnn_conv_algo_search": "HEURISTIC"}), "CPUExecutionProvider"]
    so = ort.SessionOptions(); so.log_severity_level = 3
    s = ort.InferenceSession(os.path.join(DIR, "model.onnx"), so, providers=prov)
    _M.update(s=s, voc=voc, blank=voc.get("<pad>", 0), sep=voc.get("|", 4), gpu=prov[0] != "CPUExecutionProvider",
              inp=s.get_inputs()[0].name)
    log("Timing model ready (%s)" % ("GPU" if _M["gpu"] else "CPU"))
    return _M

def _cpu():
    import onnxruntime as ort
    so = ort.SessionOptions(); so.log_severity_level = 3
    _M["s"] = ort.InferenceSession(os.path.join(DIR, "model.onnx"), so, providers=["CPUExecutionProvider"]); _M["gpu"] = False

def logprobs(x):
    """(T, V) log-probabilities for audio x (float32, 16 kHz)"""
    M = model()
    x = x.astype(np.float32); x = (x - x.mean()) / (x.std() + 1e-7)
    try: lg = M["s"].run(None, {M["inp"]: x[None, :]})[0][0].astype(np.float32)
    except Exception as e:
        if not M["gpu"]: raise
        log("Graphics card unavailable for timing (%s) - using the CPU" % str(e)[-120:]); _cpu()
        lg = M["s"].run(None, {M["inp"]: x[None, :]})[0][0].astype(np.float32)
    lg -= lg.max(axis=1, keepdims=True); return lg - np.log(np.exp(lg).sum(axis=1, keepdims=True))

def viterbi(lp, tokens, blank):
    """CTC forced alignment. Returns, for each token, (first_frame, last_frame), or None if it can't fit."""
    T = lp.shape[0]; L = len(tokens); S = 2 * L + 1
    if L == 0 or T < L: return None
    ext = np.full(S, blank, dtype=np.int64); ext[1::2] = tokens
    skip = np.zeros(S, dtype=bool); skip[3::2] = ext[3::2] != ext[1:-2:2]
    NEG = -1e30
    alpha = np.full(S, NEG, dtype=np.float32); alpha[0] = lp[0, blank]; alpha[1] = lp[0, ext[1]]
    bp = np.zeros((T, S), dtype=np.int8)
    for t in range(1, T):
        a1 = np.empty(S, np.float32); a1[0] = NEG; a1[1:] = alpha[:-1]
        a2 = np.full(S, NEG, np.float32); a2[2:] = np.where(skip[2:], alpha[:-2], NEG)
        st = np.stack([alpha, a1, a2]); k = st.argmax(axis=0)
        alpha = st[k, np.arange(S)] + lp[t, ext]; bp[t] = k
    s = S - 1 if alpha[S - 1] >= alpha[S - 2] else S - 2
    if alpha[s] < NEG / 2: return None
    span = [[-1, -1] for _ in range(L)]
    for t in range(T - 1, -1, -1):
        if s % 2 == 1:
            i = s // 2
            if span[i][1] < 0: span[i][1] = t
            span[i][0] = t
        s -= int(bp[t, s])
    return span

def norm(w):
    return re.sub(r"[^A-Z']", "", w.upper().replace("’", "'"))

def refine(audio, words, sr=SR, gap=0.4, max_seg=20.0, pad_a=0.8, pad_b=1.0):
    """Moves each word's s/e (seconds from the start of `audio`) to where it is really spoken. In place. Returns stats."""
    M = model(); voc = M["voc"]; n = len(words); dur = len(audio) / sr
    stats = {"words": n, "aligned": 0, "segments": 0, "failed": 0}
    if not n: return stats
    order = sorted(range(n), key=lambda i: words[i]["s"])
    # segments: break at pauses >= gap s or when a segment gets long
    segs = []; cur = [order[0]]
    for i in order[1:]:
        p = words[cur[-1]]
        if words[i]["s"] - p["e"] >= gap or words[i]["e"] - words[cur[0]]["s"] > max_seg: segs.append(cur); cur = [i]
        else: cur.append(i)
    segs.append(cur)
    new = {}
    for seg in segs:
        a = max(0.0, words[seg[0]]["s"] - pad_a); b = min(dur, words[seg[-1]]["e"] + pad_b)
        if b - a < 0.2: continue
        toks, owner = [], []
        for i in seg:
            ch = [voc[c] for c in norm(words[i]["w"]) if c in voc]
            if not ch: continue
            if toks: toks.append(M["sep"]); owner.append(-1)
            toks += ch; owner += [i] * len(ch)
        if not toks: continue
        stats["segments"] += 1
        try:
            lp = logprobs(audio[int(a * sr):int(b * sr)])
            sp = viterbi(lp, toks, M["blank"])
        except Exception as e:
            log("Timing segment skipped: %s" % e); sp = None
        if sp is None: stats["failed"] += 1; continue
        fs = HOP / sr
        for k, i in enumerate(owner):
            if i < 0: continue
            f0, f1 = sp[k]
            if i not in new: new[i] = [a + f0 * fs, a + (f1 + 1) * fs]
            else: new[i][1] = a + (f1 + 1) * fs
    # apply; words without letters (numbers, symbols) or failed segments move with their neighbours
    shift = np.zeros(n); have = np.zeros(n, bool)
    for i, (s, e) in new.items():
        if abs(s - words[i]["s"]) <= 2.0: shift[i] = s - words[i]["s"]; have[i] = True
    idx = np.array(order); hv = have[idx]
    if hv.any():
        pos = np.arange(n); fill = np.interp(pos, pos[hv], shift[idx][hv])
        for r, i in enumerate(order):
            if have[i]:
                s, e = new[i]; words[i]["s"] = round(s, 3); words[i]["e"] = round(max(e, s + 0.04), 3); stats["aligned"] += 1
            else:
                d = fill[r]; words[i]["s"] = round(words[i]["s"] + d, 3); words[i]["e"] = round(words[i]["e"] + d, 3)
    return stats

def read_audio(ffmpeg, path):
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    r = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0: raise RuntimeError(r.stderr.decode(errors="ignore")[-300:])
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768.0

def main(words_f, parts_f, out_f, ffmpeg):
    W = json.load(open(words_f, encoding="utf-8")); parts = json.load(open(parts_f, encoding="utf-8"))
    out = [list(w) for w in W]; t0 = time.time()
    for pi, p in enumerate(parts):
        lo, hi = p["off"], p["off"] + p["dur"]
        ids = [i for i, w in enumerate(W) if lo <= w[0] < hi]
        log("Part %d/%d: reading audio (%d words)…" % (pi + 1, len(parts), len(ids)))
        audio = read_audio(ffmpeg, p["path"])
        ws = [{"w": W[i][2], "s": W[i][0] - lo, "e": W[i][1] - lo} for i in ids]
        log("Part %d/%d: aligning…" % (pi + 1, len(parts)))
        st = refine(audio, ws); log("Part %d/%d done: %s (%.0fs so far)" % (pi + 1, len(parts), st, time.time() - t0))
        for i, w in zip(ids, ws): out[i] = [round(w["s"] + lo, 3), round(w["e"] + lo, 3), W[i][2]]
        del audio
    json.dump(out, open(out_f, "w", encoding="utf-8"))
    log("DONE in %.0fs -> %s" % (time.time() - t0, out_f))

if __name__ == "__main__":
    main(*sys.argv[1:5])
