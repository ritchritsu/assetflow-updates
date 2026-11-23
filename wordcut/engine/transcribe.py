"""WordCut engine: audio file -> word timestamps (JSON on stdout). Parakeet TDT 0.6B v3 via onnx-asr."""
import sys, json, wave, subprocess, os, tempfile, time
import numpy as np

def log(m): print(m, file=sys.stderr, flush=True)
PARTIAL = {"on": False}   # serve mode: stream words as they are recognised ('@@PART [...]')

def load_model():
    import onnx_asr
    try:
        import onnxruntime as ort
        try: ort.set_default_logger_severity(3)
        except Exception: pass
        try: ort.preload_dlls()
        except Exception: pass
        if "CUDAExecutionProvider" in ort.get_available_providers():
            log("Using GPU (CUDA)")
            # HEURISTIC: don't re-benchmark GPU kernels for every new chunk length (chunks vary in size)
            cuda = ("CUDAExecutionProvider", {"cudnn_conv_algo_search": os.environ.get("WC_CUDNN", "HEURISTIC")})
            return onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", providers=[cuda, "CPUExecutionProvider"])
    except Exception as e:
        log("GPU unavailable: %s" % e)
    log("Using CPU")
    MODEL["gpu"] = False
    return onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3")

def to_words(tokens, stamps, offset, chunk_end):
    words = []
    for i, (tok, t) in enumerate(zip(tokens, stamps)):
        nxt = stamps[i + 1] if i + 1 < len(stamps) else chunk_end - offset
        new = tok.startswith((" ", "▁")) or not words
        tok = tok.replace("▁", " ")
        if new:
            words.append({"w": tok.strip(), "s": offset + float(t), "e": offset + float(nxt)})
        else:
            words[-1]["w"] += tok
            words[-1]["e"] = offset + float(nxt)
    for w in words:  # a word never lasts longer than ~1.2 s (avoids swallowing pauses)
        w["e"] = min(w["e"], w["s"] + 1.2)
    return [w for w in words if w["w"]]

LEAD, TAIL = 8000, 4800   # 0.5 s of silence before, 0.3 s after every chunk (16 kHz)
def fix_lead(ws, a, b):
    """words stamped inside the added silence belong at the chunk edges"""
    for w in ws:
        w["s"] = min(max(w["s"], a), b); w["e"] = min(max(w["e"], w["s"] + 0.04), b + 0.3)
    return ws

CACHE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "WordCut", "audiocache")
CACHE_MAX = 12 * 1024 ** 3   # keep at most ~12 GB of cached audio (oldest removed first)
_cache_mem = {}
def _cache_key(src, stream):
    import hashlib
    st = os.stat(src); return hashlib.sha1(("%s|%d|%d|%d" % (os.path.abspath(src).lower(), st.st_size, int(st.st_mtime), stream)).encode()).hexdigest()[:20]
def cached_audio(ffmpeg, src, stream=0):
    """Whole-file 16 kHz mono PCM, read ONCE per source file (long OBS recordings take seconds just to open)."""
    key = _cache_key(src, stream)
    if key in _cache_mem: return _cache_mem[key]
    os.makedirs(CACHE_DIR, exist_ok=True); raw = os.path.join(CACHE_DIR, key + ".pcm")
    if not os.path.exists(raw):
        log("Reading audio of %s once (cached for next time)..." % os.path.basename(src))
        tmp = raw + ".part"
        p = subprocess.Popen([ffmpeg, "-y", "-v", "error", "-progress", "pipe:1", "-nostats", "-i", src, "-vn", "-map", "0:a:%d" % stream,
                              "-ac", "1", "-ar", "16000", "-f", "s16le", tmp], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                             creationflags=0x08000000 if os.name == "nt" else 0)
        last = 0
        for line in p.stdout:
            if line.startswith("out_time_ms=") and time.time() - last > 2:
                try: log("Reading audio... %d min done" % (int(line.split("=")[1]) // 60000000)); last = time.time()
                except Exception: pass
        p.wait()
        if p.returncode != 0 or not os.path.exists(tmp):
            try: os.remove(tmp)
            except Exception: pass
            if stream: return cached_audio(ffmpeg, src, 0)   # chosen track doesn't exist in this file -> first track
            raise RuntimeError("could not read audio from " + os.path.basename(src))
        os.replace(tmp, raw); _trim_cache()
    try: os.utime(raw, None)
    except Exception: pass
    m = np.memmap(raw, dtype=np.int16, mode="r") if os.path.getsize(raw) else np.zeros(0, np.int16); _cache_mem[key] = m; return m
def _trim_cache():
    try:
        fs_ = sorted((os.path.join(CACHE_DIR, f) for f in os.listdir(CACHE_DIR) if f.endswith(".pcm")), key=os.path.getatime, reverse=True)
        tot = 0
        for f in fs_:
            tot += os.path.getsize(f)
            if tot > CACHE_MAX: os.remove(f)
    except Exception: pass
def slice_audio(m, start, dur):
    a = int(max(0, start) * 16000); b = int((max(0, start) + dur) * 16000)
    return np.asarray(m[a:b], dtype=np.float32) / 32768.0

def extract(ffmpeg, src, start, dur, tmp, stream=0):
    r = subprocess.run([ffmpeg, "-y", "-v", "error", "-ss", str(start), "-t", str(dur), "-i", src,
                    "-vn", "-map", "0:a:%d" % stream, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", tmp],
                   creationflags=0x08000000 if os.name == "nt" else 0)
    if r.returncode != 0:
        if stream: return extract(ffmpeg, src, start, dur, tmp, 0)
        raise RuntimeError("ffmpeg could not read " + os.path.basename(src))
    with wave.open(tmp) as f:
        return np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

def split_points(db, sr_frames, n_samples, sr, hop, ch_s=60, look_s=12):
    """Chunk boundaries (in samples) placed at the quietest 20 ms frame in the last `look_s` seconds of each ~60 s window."""
    pts, start, total = [0], 0, n_samples
    while total - start > ch_s * sr:
        a = int((start + (ch_s - look_s) * sr) // hop); b = int((start + ch_s * sr) // hop)
        seg = db[a:b] if b > a else None
        cut = (a + int(np.argmin(seg))) * hop if seg is not None and len(seg) else start + ch_s * sr
        pts.append(cut); start = cut
    pts.append(total); return pts

def recheck_gaps(state, audio, vp, loc, sr=16000, stretch=1.3):
    """Fast talkers: where the voice detector hears speech but no word was recognised, listen again to just that stretch slowed down.
    Returns extra words (clip-local seconds). Never raises: a failure here must not lose the transcript."""
    try:
        vh = 512 / sr; need = int(0.4 / vh); runs, i, n = [], 0, len(vp)
        while i < n:
            if vp[i] >= 70:
                j = i
                while j < n and vp[j] >= 50: j += 1
                if j - i >= need: runs.append((i * vh, j * vh))
                i = j
            else: i += 1
        extra, dur = [], len(audio) / sr
        for a, b in runs:
            cov = sorted((max(a, w[0]), min(b, w[1])) for w in loc if w[1] > a and w[0] < b)
            gaps, cur = [], a
            for x, y in cov:
                if x - cur >= 0.45: gaps.append((cur, x))
                cur = max(cur, y)
            if b - cur >= 0.45: gaps.append((cur, b))
            for g0, g1 in gaps:
                a0, a1 = max(0.0, g0 - 0.5), min(dur, g1 + 0.5)
                seg = audio[int(a0 * sr):int(a1 * sr)]
                if len(seg) < 1600: continue
                xs = np.linspace(0, len(seg) - 1, int(len(seg) * stretch)); seg2 = np.interp(xs, np.arange(len(seg)), seg).astype(np.float32)
                r = _recognize_many(state["model"], [seg2], sr, state)[0]
                for w in to_words(list(r.tokens or []), list(r.timestamps or []), 0.0, len(seg2) / sr):
                    ws, we = a0 + w["s"] / stretch, a0 + w["e"] / stretch; mid = (ws + we) / 2
                    if g0 - 0.05 <= mid <= g1 + 0.05: extra.append({"w": w["w"], "s": ws, "e": we})
        if extra: log("Fast-speech recheck recovered %d word(s)" % len(extra))
        return extra
    except Exception as e:
        log("Fast-speech recheck skipped (%s)" % str(e)[:100]); return []
MODEL = {"m": None, "gpu": True, "name": None}
class _SherpaTDT:
    """Orukeet (fine-tuned Parakeet TDT 0.6B v3) via sherpa-onnx; same recognize() shape as onnx-asr."""
    def __init__(self, d):
        import sherpa_onnx
        self.r = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=os.path.join(d, "encoder.int8.onnx"), decoder=os.path.join(d, "decoder.int8.onnx"),
            joiner=os.path.join(d, "joiner.int8.onnx"), tokens=os.path.join(d, "tokens.txt"), model_type="nemo_transducer", sample_rate=16000,
            feature_dim=128, decoding_method="greedy_search", provider="cpu", num_threads=max(2, (os.cpu_count() or 4) - 2))
    def with_timestamps(self): return self
    def recognize(self, seg, sample_rate=16000):
        st = self.r.create_stream(); st.accept_waveform(sample_rate, seg.astype(np.float32)); self.r.decode_stream(st); res = st.result
        class R: pass
        o = R(); o.text = res.text; o.tokens = list(res.tokens); o.timestamps = [float(x) for x in res.timestamps]; return o
def model_choice():
    want = os.environ.get("WC_MODEL", "parakeet")
    d = os.path.join(os.environ.get("LOCALAPPDATA", ""), "WordCut", "models", "orukeet")
    if want == "orukeet" and os.path.exists(os.path.join(d, "encoder.int8.onnx")):
        try:
            import sherpa_onnx  # noqa
            return "orukeet", d
        except Exception as e: log("Orukeet unavailable (%s) - using Parakeet" % e)
    return "parakeet", None
VAD = {"v": None, "ok": True}
def vad_probs(audio):
    """Silero voice-activity probability (0-100) for every 32 ms frame; None if unavailable."""
    if not VAD["ok"]: return None
    try:
        if VAD["v"] is None:
            import onnx_asr
            log("Loading voice detector...")
            VAD["v"] = onnx_asr.load_vad("silero", providers=["CPUExecutionProvider"])
        ps = [float(p[0]) for p in VAD["v"]._encode(audio[None, :].astype(np.float32), 16000, 512, 64)]
        return (np.clip(np.array(ps), 0, 1) * 100).round().astype(int).tolist()
    except Exception as e:
        log("Voice detector unavailable (%s) - using audio level" % str(e)[:120]); VAD["ok"] = False; return None
def get_model():
    name, d = model_choice()
    if MODEL["m"] is not None and MODEL["name"] != name: MODEL["m"] = None
    if MODEL["m"] is None:
        MODEL["name"] = name
        if name == "orukeet":
            log("Loading Orukeet..."); MODEL["m"] = _SherpaTDT(d); MODEL["gpu"] = False; log("Using CPU (Orukeet)")
        else:
            log("Loading Parakeet..."); MODEL["gpu"] = True; MODEL["m"] = load_model().with_timestamps()
    else:
        log("Using GPU (CUDA)" if MODEL["gpu"] else "Using CPU")
    return MODEL["m"]

def main():
    # usage: transcribe.py jobs.json ffmpeg
    # jobs = [{path, in, dur, off, mdur?, spd?}]  in/mdur = media seconds, off/dur = sequence seconds, spd = media sec per sequence sec
    print(json.dumps(run_jobs(sys.argv[1], sys.argv[2])), flush=True)

def _recognize_many(model, segs, sr, state):
    """Recognize several chunks; batched on GPU (keeps it busy), shrinking the batch on out-of-memory, then CPU fallback."""
    out = []
    i = 0
    while i < len(segs):
        bs = state["bs"]
        part = segs[i:i + bs]
        try:
            if bs > 1 and state["can_batch"]:
                rs = model.recognize(part, sample_rate=sr)
            else:
                rs = [model.recognize(s, sample_rate=sr) for s in part]
            out += list(rs); i += len(part)
        except Exception as e:
            msg = str(e)
            if bs > 1:
                state["bs"] = 1; log("Batch too large for free GPU memory - using 1 chunk at a time"); continue
            if not state["gpu"]: raise
            log("GPU error (%s) - switching to CPU" % msg[:120])
            import onnx_asr
            model = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3").with_timestamps()
            MODEL["m"] = model; MODEL["gpu"] = False; state["gpu"] = False; state["model"] = model
    return out

def run_jobs(job_file, ffmpeg):
    from concurrent.futures import ThreadPoolExecutor
    jobs = json.load(open(job_file, encoding="utf-8"))
    model = get_model()
    state = {"bs": 2 if (MODEL["gpu"] and MODEL["name"] != "orukeet") else 1, "can_batch": MODEL["name"] != "orukeet", "gpu": MODEL["gpu"], "model": model}
    sr, hop = 16000, 320
    total = sum(j.get("mdur", j["dur"]) for j in jobs) or 1; done = 0.0; words = []; env = []
    pool = ThreadPoolExecutor(max_workers=2)
    prof = {"extract": 0.0, "asr": 0.0, "vad_wait": 0.0}
    from collections import Counter
    uses = Counter(j["path"] for j in jobs)
    def use_cache(j):
        if uses[j["path"]] >= 3: return True
        try: return os.path.exists(os.path.join(CACHE_DIR, _cache_key(j["path"], int(j.get("stream", 0))) + ".pcm"))
        except Exception: return False
    def load(j, n):
        t0 = time.time()
        spd = float(j.get("spd") or 1.0); mdur = float(j.get("mdur") or j["dur"] * spd); stream = int(j.get("stream", 0))
        tmp = os.path.join(tempfile.gettempdir(), "wordcut_audio_%d_%d.wav" % (os.getpid(), n))
        try:
            if use_cache(j):
                a = slice_audio(cached_audio(ffmpeg, j["path"], stream), j["in"], mdur)
                prof["extract"] += time.time() - t0
                return a, mdur, spd, None
            a = extract(ffmpeg, j["path"], j["in"], mdur, tmp, stream)
        except Exception as e: return None, mdur, spd, str(e)
        finally:
            try: os.remove(tmp)
            except Exception: pass
        prof["extract"] += time.time() - t0
        return a, mdur, spd, None
    nxt = pool.submit(load, jobs[0], 1) if jobs else None
    for n, j in enumerate(jobs, 1):
        audio, mdur, spd, err = nxt.result()
        nxt = pool.submit(load, jobs[n], n + 1) if n < len(jobs) else None   # prefetch next clip while the GPU works
        if audio is None: log("Skipped clip %d (no audio): %s" % (n, err)); done += mdur; continue
        nf = len(audio) // hop
        if not nf: done += mdur; continue
        fr = audio[:nf * hop].reshape(nf, hop)
        db = np.clip(20 * np.log10(np.sqrt((fr * fr).mean(axis=1)) + 1e-9), -90, 0)
        E = {"c": n - 1, "off": j["off"], "hop": hop / sr / spd, "db": db.round().astype(int).tolist()}
        vad_f = pool.submit(vad_probs, audio)                     # voice detector on CPU, in parallel with the GPU
        pts = split_points(db, nf, len(audio), sr, hop)
        segs, offs = [], []
        for k in range(len(pts) - 1):
            i0, i1 = pts[k], pts[k + 1]
            # a short lead-in of silence: the recogniser tends to drop the first word when audio starts right on speech
            if i1 - i0 >= 1600: segs.append(np.concatenate([np.zeros(LEAD, dtype=audio.dtype), audio[i0:i1], np.zeros(TAIL, dtype=audio.dtype)])); offs.append((i0, i1))
        if j.get("skip_asr"): segs, offs = [], []          # words for this clip come from the source-transcript cache: only loudness + voice data are needed
        log("Transcribing clip %d/%d - %d%%" % (n, len(jobs), int(100 * done / total)))
        res = []; ta = time.time()
        for b0 in range(0, len(segs), 4):
            got = _recognize_many(state["model"], segs[b0:b0 + 4], sr, state); res += got
            if PARTIAL["on"]:
                try:
                    pw = []
                    for r, (i0, i1) in zip(got, offs[b0:b0 + 4]):
                        for w in fix_lead(to_words(list(r.tokens or []), list(r.timestamps or []), (i0 - LEAD) / sr, i1 / sr), i0 / sr, i1 / sr):
                            pw.append({"w": w["w"], "s": round(j["off"] + w["s"] / spd, 3), "c": n - 1})
                    if pw: print("@@PART " + json.dumps(pw), flush=True)
                except Exception: pass
            log("Transcribing clip %d/%d - %d%%" % (n, len(jobs), int(100 * (done + offs[min(b0 + 3, len(offs) - 1)][1] / sr) / total)))
        prof["asr"] += time.time() - ta
        loc = []
        cw = []
        for r, (i0, i1) in zip(res, offs):
            ws = fix_lead(to_words(list(r.tokens or []), list(r.timestamps or []), (i0 - LEAD) / sr, i1 / sr), i0 / sr, i1 / sr)
            loc += [(w["s"], w["e"]) for w in ws]; cw += ws
        tv = time.time(); vp = vad_f.result(); prof["vad_wait"] += time.time() - tv
        if vp and segs and os.environ.get("WC_RECHECK", "1") != "0": cw += recheck_gaps(state, audio, vp, loc)
        if cw and os.environ.get("WC_ALIGN", "1") != "0":   # precise word timing: snap each word to where it's really spoken
            try:
                import align as _al; t_al = time.time(); _al.refine(audio, cw); prof["align"] = prof.get("align", 0.0) + time.time() - t_al
            except Exception as e: log("Precise timing skipped: %s" % e)
        for w in cw:
            w["s"] = j["off"] + w["s"] / spd; w["e"] = min(j["off"] + w["e"] / spd, j["off"] + j["dur"]); w["c"] = n - 1
        words += cw
        if vp: E["vp"] = vp; E["vhop"] = 512 / sr / spd
        env.append(E)
        done += mdur
    pool.shutdown(wait=False)
    log("PROF " + " ".join("%s=%.1fs" % kv for kv in prof.items()))
    words.sort(key=lambda w: w["s"])
    return {"words": words, "env": env}

def serve(ffmpeg, idle=600):
    """Keep the model loaded: read one jobs-file path per line from stdin, answer with '@@RESULT <json>'. Exits after `idle` s unused."""
    import threading
    last = [time.time()]; busy = [False]
    def watchdog():
        while True:
            time.sleep(15)
            if not busy[0] and time.time() - last[0] > idle: os._exit(0)   # never quit in the middle of a job (long streams take far more than 10 minutes)
    threading.Thread(target=watchdog, daemon=True).start()
    PARTIAL["on"] = True
    log("@@READY")
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        if line == "warm": get_model(); log("@@WARM"); last[0] = time.time(); continue
        if line.startswith("model:"): os.environ["WC_MODEL"] = line[6:].strip(); continue
        busy[0] = True
        try: res = run_jobs(line, ffmpeg)
        except Exception as e: res = {"error": str(e)}
        finally: busy[0] = False; last[0] = time.time()
        print("@@RESULT " + json.dumps(res), flush=True); last[0] = time.time()

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--serve":
        serve(sys.argv[2]); sys.exit(0)
    try: main()
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True); sys.exit(1)
