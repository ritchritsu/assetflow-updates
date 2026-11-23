"""AssetFlow speech edges: where words are, around clip edges, using WordCut's speech model (wav2vec2 CTC, ONNX).
stdin: {"model": dir, "ffmpeg": exe, "jobs": [{"id", "path", "a", "b"}], "cache": dir}
stdout (JSON lines): {"ev":"prog","f"} ... {"ev":"res","id","sp":[[s,e],...] (media seconds),"len": seconds of audio read} ... {"ev":"done"}
Speech = frames where the model hears a letter, joined across tiny gaps, then widened by the sound's own decay (consonant tails)."""
import sys, os, json, subprocess, threading, queue, hashlib, time
import numpy as np
NOWIN = 0x08000000 if os.name == "nt" else 0
def say(**k): sys.stdout.write(json.dumps(k) + "\n"); sys.stdout.flush()
J = json.loads(sys.stdin.buffer.readline().decode("utf-8"))   # UTF-8 always (file names with special characters)
import onnxruntime as ort
try: ort.preload_dlls()
except Exception: pass
M = J["model"]; FF = J.get("ffmpeg") or "ffmpeg"; CD = J.get("cache")
prov = [p for p in ("CUDAExecutionProvider", "DmlExecutionProvider") if p in ort.get_available_providers()] + ["CPUExecutionProvider"]
try: S = ort.InferenceSession(os.path.join(M, "model.onnx"), providers=prov)
except Exception: S = ort.InferenceSession(os.path.join(M, "model.onnx"), providers=["CPUExecutionProvider"])
IN = S.get_inputs()[0].name; SR = 16000; HOP = 320   # 20 ms per model frame

def read(path, a, b):
    r = subprocess.run([FF, "-v", "error", "-ss", "%.3f" % max(0, a), "-t", "%.3f" % (b - max(0, a)), "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, creationflags=NOWIN)
    return np.frombuffer(r.stdout, np.float32).copy()

def speech(x, a0):
    if len(x) < SR * 0.2: return [], []
    z = (x - x.mean()) / (x.std() + 1e-7)
    o = S.run(None, {IN: z[None]})[0][0]; o = o - o.max(1, keepdims=True); p = np.exp(o); p /= p.sum(1, keepdims=True)
    am = p.argmax(1); n = len(am)
    let = (am != 0) & (am != 4)        # 0 = blank (<pad>), 4 = word separator "|"
    if not let.any(): return [], []
    fr = np.array([np.sqrt((x[i * HOP:(i + 1) * HOP] ** 2).mean() + 1e-12) for i in range(n)]); db = 20 * np.log10(fr + 1e-9)
    floor = np.percentile(db, 15); top = db.max()
    # words: letters between word separators (a pause of 0.3 s also ends a word); faint "letters" in quiet game sound are ignored
    W = []; cur = None; lastL = -99
    for i in range(n):
        if am[i] == 4 or (cur and i - lastL > 15):
            if cur: W.append(cur); cur = None
        if let[i]:
            if cur is None: cur = [i, i + 1]
            else: cur[1] = i + 1
            lastL = i
    if cur: W.append(cur)
    W = [w for w in W if db[w[0]:w[1]].max() > max(top - 30, -50, floor + 6)]
    # speech: words joined across tiny gaps, widened by the sound's own onset / decay
    out = []
    for s0, e0 in W:
        s, e = s0, e0; lo = out[-1][1] if out else 0; k = 0
        while s - 1 >= lo and k < 3 and db[s - 1] > floor + 10: s -= 1; k += 1
        k = 0
        while e < n and k < 6 and db[e] > floor + 8: e += 1; k += 1
        if out and s - out[-1][1] <= 2: out[-1][1] = max(out[-1][1], e)
        else: out.append([s, e])
    f = lambda L: [[round(a0 + s * HOP / SR, 3), round(a0 + e * HOP / SR, 3)] for s, e in L]
    return f(out), f(W)

def key(j):
    try: st = os.stat(j["path"]); return hashlib.sha1(("%s|%d|%d|%.3f|%.3f|v2" % (j["path"].lower(), st.st_size, int(st.st_mtime), j["a"], j["b"])).encode()).hexdigest()[:24]
    except Exception: return None
jobs = J["jobs"]; n = len(jobs); done = 0; t0 = time.time()
q = queue.Queue(maxsize=32)
def reader(lst):
    for j in lst:
        k = key(j) if CD else None
        if k and os.path.exists(os.path.join(CD, k + ".json")):
            try: q.put((j, None, json.load(open(os.path.join(CD, k + ".json"))))); continue
            except Exception: pass
        q.put((j, read(j["path"], j["a"], j["b"]), k))
NT = max(2, min(8, (os.cpu_count() or 4) // 2)); parts = [jobs[i::NT] for i in range(NT)]
TH = [threading.Thread(target=reader, args=(p,), daemon=True) for p in parts]
for t in TH: t.start()
if CD: os.makedirs(CD, exist_ok=True)
while done < n:
    j, x, k = q.get()
    if x is None and isinstance(k, dict): r = k
    else:
        a0 = max(0, j["a"]); sp, wd = speech(x, a0); r = {"sp": sp, "w": wd, "len": round(len(x) / SR, 3), "a": a0}
        if k:
            try: json.dump(r, open(os.path.join(CD, k + ".json"), "w"))
            except Exception: pass
    done += 1
    say(ev="res", id=j["id"], **r)
    if done % 20 == 0 or done == n: say(ev="prog", f=done / n, secs=round(time.time() - t0, 1))
say(ev="done", secs=round(time.time() - t0, 1), prov=S.get_providers()[0])
