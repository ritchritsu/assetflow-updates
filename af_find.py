"""AssetFlow Find: search hours of footage by describing what's on screen (SigLIP image-text AI, on the graphics card).

Server: one JSON command per line on stdin, JSON lines out. The AI stays loaded.
  {"cmd":"index", "id", "ffmpeg", "files":[path,...], "cache"}  -> {"ev":"prog"...} ... {"ev":"indexed", "frames"}
      Reads only the keyframes of each video (very fast, ~1 every 1-2 s of footage), one picture each -> AI fingerprint, cached on disk.
  {"cmd":"search", "id", "files":[...], "cache", "q", "top", "ffmpeg", "thumbs"} -> {"ev":"hits", "hits":[{file, t, score, thumb}]}
"""
import sys, os, json, time, hashlib, subprocess, re, traceback
import numpy as np

NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
MODELS = [os.environ.get("AF_FIND_MODEL", "google/siglip2-base-patch16-224"), "google/siglip-base-patch16-224"]
M = {}
def say(**k): sys.stdout.write(json.dumps(k) + "\n"); sys.stdout.flush()

def model():
    if "m" in M: return M
    import torch
    from transformers import AutoModel, AutoProcessor
    gpu = torch.cuda.is_available(); dev = "cuda" if gpu else "cpu"; dt = torch.float16 if gpu else torch.float32
    say(ev="stage", msg="Loading the search AI" + (" on your graphics card" if gpu else " (no graphics card found, this will be slow)") + "…")
    err = None
    for mid in MODELS:
        try:
            try: m = AutoModel.from_pretrained(mid, dtype=dt)
            except TypeError: m = AutoModel.from_pretrained(mid, torch_dtype=dt)
            M.update(m=m.to(dev).eval(), p=AutoProcessor.from_pretrained(mid), dev=dev, dt=dt, torch=torch, mid=mid); return M
        except Exception as e: err = e
    raise RuntimeError("Couldn't load the search AI: %s" % err)

def key(path):
    st = os.stat(path); return hashlib.sha1(("%s|%d|%d|%s" % (os.path.abspath(path).lower(), st.st_size, int(st.st_mtime), "v2")).encode()).hexdigest()[:24]

def keyframes(ff, path, w=256, h=256):
    """(time, rgb) for every keyframe of the video, decoding nothing else (fast even on 5-hour streams)"""
    cmd = [ff, "-hide_banner", "-nostats", "-v", "info", "-hwaccel", "auto", "-skip_frame", "nokey", "-i", path, "-an", "-sn", "-vsync", "0", "-vf", "scale=%d:%d,showinfo" % (w, h),
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=NOWIN, bufsize=w * h * 3 * 8)
    times = []
    import threading
    def rd():
        for line in iter(p.stderr.readline, b""):
            m = re.search(rb"pts_time:\s*([\d.]+)", line)
            if m: times.append(float(m.group(1)))
    th = threading.Thread(target=rd, daemon=True); th.start()
    n = w * h * 3; i = 0
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n: break
        while len(times) <= i and th.is_alive(): time.sleep(0.002)
        t = times[i] if i < len(times) else (times[-1] + 2.0 if times else 0.0)
        yield t, np.frombuffer(buf, np.uint8).reshape(h, w, 3); i += 1
    p.wait()

def duration(ff, path):
    r = subprocess.run([ff, "-hide_banner", "-i", path], capture_output=True, creationflags=NOWIN)
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", r.stderr.decode(errors="ignore"))
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0

def _vec(f):
    # newer transformers return an output object instead of a tensor
    if hasattr(f, 'float'): return f
    for k in ('image_embeds', 'text_embeds', 'pooler_output'):
        v = getattr(f, k, None)
        if v is not None: return v
    return f[0]

def embed_images(imgs):
    D = model(); torch = D["torch"]
    with torch.inference_mode():
        x = D["p"](images=list(imgs), return_tensors="pt")
        x = {k: (v.to(D["dev"], dtype=D["dt"]) if v.is_floating_point() else v.to(D["dev"])) for k, v in x.items()}
        f = D["m"].get_image_features(**x)
        f = torch.nn.functional.normalize(_vec(f).float(), dim=-1)
    return f.cpu().numpy().astype(np.float16)

def embed_text(q):
    D = model(); torch = D["torch"]
    with torch.inference_mode():
        x = D["p"](text=[q], padding="max_length", max_length=64, truncation=True, return_tensors="pt")
        f = D["m"].get_text_features(**{k: v.to(D["dev"]) for k, v in x.items() if k in ("input_ids", "attention_mask")})
        f = torch.nn.functional.normalize(_vec(f).float(), dim=-1)
    return f.cpu().numpy()[0]

def crop(img):
    """the middle of the frame, without the edges where the facecam, minimap and HUD usually sit"""
    h, w = img.shape[:2]; return np.ascontiguousarray(img[int(h * .14):int(h * .86), int(w * .14):int(w * .86)])

TEMPLATES = ["{}", "a screenshot of {}", "a video game scene showing {}", "a gameplay frame of {}"]
def query_vec(q):
    """the search words averaged over a few phrasings (more reliable); words after a minus are pushed away"""
    words = q.split(); neg = [w[1:] for w in words if w.startswith("-") and len(w) > 1]; pos = " ".join(w for w in words if not w.startswith("-")) or q
    v = np.mean([embed_text(t.format(pos)) for t in TEMPLATES], 0); v /= np.linalg.norm(v) + 1e-9
    n = np.mean([embed_text(t.format(" ".join(neg))) for t in TEMPLATES[:2]], 0) if neg else None
    if n is not None: n /= np.linalg.norm(n) + 1e-9
    return v, n

def cmd_index(J):
    ff, cache = J["ffmpeg"], J["cache"]; os.makedirs(cache, exist_ok=True)
    files = [f for f in J["files"] if os.path.exists(f)]
    todo = [f for f in files if not os.path.exists(os.path.join(cache, key(f) + ".npz"))]
    if not todo: say(ev="indexed", id=J.get("id"), files=len(files), new=0); return
    model(); total = sum(max(1.0, duration(ff, f)) for f in todo); done = 0.0; t0 = time.time()
    for fi, f in enumerate(todo):
        T, E, C, batch, bt = [], [], [], [], []; last = 0.0
        for t, img in keyframes(ff, f):
            batch.append(img); bt.append(t)
            if len(batch) == 64:
                E.append(embed_images(batch)); C.append(embed_images([crop(b) for b in batch])); T += bt; batch, bt = [], []
                if time.time() - last > 0.5:
                    last = time.time(); say(ev="prog", id=J.get("id"), f=min(0.999, (done + T[-1]) / total), file=os.path.basename(f), n=fi + 1, of=len(todo))
        if batch: E.append(embed_images(batch)); C.append(embed_images([crop(b) for b in batch])); T += bt
        if E: np.savez(os.path.join(cache, key(f) + ".npz"), t=np.array(T, np.float32), e=np.concatenate(E), c=np.concatenate(C), path=f)
        done += max(1.0, duration(ff, f))
    say(ev="indexed", id=J.get("id"), files=len(files), new=len(todo), secs=round(time.time() - t0, 1))

def thumb(ff, path, t, out):
    subprocess.run([ff, "-v", "error", "-y", "-ss", "%.3f" % max(0, t), "-i", path, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4", out],
                   capture_output=True, creationflags=NOWIN)
    return out if os.path.exists(out) else None

def cmd_search(J):
    q = J["q"].strip(); cache = J["cache"]; top = int(J.get("top", 24))
    qe, qn = query_vec(q); hits = []
    for f in J["files"]:
        p = os.path.join(cache, key(f) + ".npz") if os.path.exists(f) else None
        if not p or not os.path.exists(p): continue
        Z = np.load(p); s = Z["e"].astype(np.float32) @ qe; t = Z["t"]
        if "c" in Z.files: s = np.maximum(s, Z["c"].astype(np.float32) @ qe)      # also the middle of the frame, past facecam / HUD
        if qn is not None: s = s - 0.5 * np.maximum(0, Z["e"].astype(np.float32) @ qn - 0.05)
        for i in np.argsort(-s)[:top * 3]: hits.append((float(s[i]), f, float(t[i])))
    hits.sort(key=lambda h: -h[0])
    out = []                                   # one hit per moment: skip near-duplicates within 8 s of a better one
    for sc, f, t in hits:
        if any(o["file"] == f and abs(o["t"] - t) < 8 for o in out): continue
        out.append({"file": f, "t": t, "score": sc})
        if len(out) >= top: break
    if out:                                    # relative scores: best = 100
        hi, lo = out[0]["score"], min(o["score"] for o in out)
        for o in out: o["match"] = int(round(100 * (o["score"] - lo) / max(1e-6, hi - lo))) if len(out) > 1 else 100
    if J.get("thumbs"):
        td = J["thumbs"]; os.makedirs(td, exist_ok=True)
        for k, o in enumerate(out):
            o["thumb"] = thumb(J["ffmpeg"], o["file"], o["t"], os.path.join(td, "hit_%d_%d.jpg" % (int(time.time() * 1000) % 100000000, k)))
    say(ev="hits", id=J.get("id"), hits=out, q=q)

def main():
    say(ev="ready")
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try: J = json.loads(line)
        except Exception: continue
        if J.get("cmd") == "quit": break
        try: {"index": cmd_index, "search": cmd_search}[J["cmd"]](J)
        except Exception as e: say(ev="error", id=J.get("id"), msg=str(e), tb=traceback.format_exc()[-1200:])

if __name__ == "__main__":
    main()
