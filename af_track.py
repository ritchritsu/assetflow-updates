"""AssetFlow Track: follows an object through a clip with SAM 2 (AI, on the graphics card) + point tracking inside it.

Runs as a small server: one JSON command per line on stdin, JSON lines on stdout. The AI model stays loaded between commands.
  {"cmd":"frame",   "id", "ffmpeg", "file", "t", "out"}                       -> {"ev":"frame", "w","h","W","H"}   (W,H = video size)
  {"cmd":"preview", "id", "ffmpeg", "file", "t", "pts":[[u,v,label]], "out"}   -> {"ev":"preview", "box":[u0,v0,u1,v1], "area"}
  {"cmd":"track",   "id", "ffmpeg", "file", "a", "b", "ref", "fps", "pts"}     -> {"ev":"prog"} ... {"ev":"track", "fr":[[x,y,s,r,ok],...]}
u,v / x,y are 0..1 of the video frame; s = size relative to the clicked frame; r = rotation in degrees relative to it.
"""
import sys, os, json, math, re, subprocess, time, traceback
import numpy as np

NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
PW = 1024                       # the AI works on frames this wide (fast, and plenty for following an object)
MID = os.environ.get("AF_TRACK_MODEL", "facebook/sam2.1-hiera-small")
M = {}
BOX0 = [0.0] * 6   # object's box + centre (0..1) on the clicked frame, from the last track

def say(**k): sys.stdout.write(json.dumps(k) + "\n"); sys.stdout.flush()

def probe(ff, file):
    r = subprocess.run([ff, "-hide_banner", "-i", file], capture_output=True, creationflags=NOWIN)
    m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", r.stderr.decode(errors="ignore"))
    if not m: raise RuntimeError("Couldn't read the video size of " + os.path.basename(file))
    return int(m.group(1)), int(m.group(2))

def native_fps(ff, file):
    r = subprocess.run([ff, "-hide_banner", "-i", file], capture_output=True, creationflags=NOWIN)
    m = re.search(r"Video:.*?([\d.]+) fps", r.stderr.decode(errors="ignore")) or re.search(r"Video:.*?([\d.]+) tbr", r.stderr.decode(errors="ignore"))
    return float(m.group(1)) if m else 0.0

def cmd_probe(J):
    W, H = probe(J["ffmpeg"], J["file"]); say(ev="probe", id=J.get("id"), W=W, H=H, fps=native_fps(J["ffmpeg"], J["file"]))

def cmd_calib(J):
    """finds which moment of the video file each exported timeline frame shows, then fits time_in_file = a + b * timeline_time"""
    import cv2
    ff, file = J["ffmpeg"], J["file"]; fps = native_fps(ff, file) or 60.0; sw, sh = 192, 108
    lo = max(0.0, float(J["lo"])); hi = float(J["hi"])
    F = np.array([cv2.resize(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (sw, sh)).astype(np.float32) for f in frames(ff, file, lo, hi, fps, 384, 216)])
    if not len(F): raise RuntimeError("Couldn't read the video to line up the timing.")
    F -= F.mean(axis=(1, 2), keepdims=True); F /= (F.std(axis=(1, 2), keepdims=True) + 1e-6)
    pts = []
    for q in J["shots"]:
        im = cv2.imread(q["png"], cv2.IMREAD_GRAYSCALE)
        if im is None: continue
        x0, y0, x1, y1 = q.get("crop") or [0, 0, 1, 1]; H_, W_ = im.shape
        im = im[int(y0 * H_):max(int(y0 * H_) + 2, int(y1 * H_)), int(x0 * W_):max(int(x0 * W_) + 2, int(x1 * W_))]
        g = cv2.resize(im, (sw, sh)).astype(np.float32); g = (g - g.mean()) / (g.std() + 1e-6)
        sc = (F * g).mean(axis=(1, 2)); k = int(sc.argmax())
        if 0 < k < len(sc) - 1:                                   # sub-frame peak
            d = sc[k - 1] - 2 * sc[k] + sc[k + 1]; k = k + (0.5 * (sc[k - 1] - sc[k + 1]) / d if d < 0 else 0)
        pts.append((float(q["t"]), float(lo + k / fps), float(sc.max())))
    if len(pts) < 2: raise RuntimeError("Couldn't line up the timing (Premiere didn't export the frames).")
    T = np.array([p[0] for p in pts]); Mf = np.array([p[1] for p in pts]); b, a = np.polyfit(T, Mf, 1)
    res = float(np.abs(a + b * T - Mf).max())
    say(ev="calib", id=J.get("id"), a=float(a), b=float(b), res=res, score=min(p[2] for p in pts), pts=pts, fps=fps)

def cmd_diffbox(J):
    """where a graphic really is: compare a frame with it and one without it -> centre of what changed (0..1 of the frame)"""
    import cv2
    A = cv2.imread(J["a"]); B = cv2.imread(J["b"])
    if A is None or B is None or A.shape != B.shape: return say(ev="diffbox", id=J.get("id"), box=None)
    d = cv2.absdiff(A, B).max(axis=2); d = cv2.medianBlur(d, 3); m = d > 25
    if m.sum() < 30: return say(ev="diffbox", id=J.get("id"), box=None)
    ys, xs = np.nonzero(m); H_, W_ = m.shape
    x0, x1, y0, y1 = np.percentile(xs, 1), np.percentile(xs, 99), np.percentile(ys, 1), np.percentile(ys, 99)
    say(ev="diffbox", id=J.get("id"), box=[x0 / W_, y0 / H_, x1 / W_, y1 / H_], c=[(x0 + x1) / 2 / W_, (y0 + y1) / 2 / H_])

def cmd_blur(J):
    """renders a see-through video: only the tracked area, blurred (or pixelated), everything else transparent.
    One frame per timeline frame, from exactly the video moment Premiere shows there. ProRes 4444 with alpha."""
    import cv2
    ff, file = J["ffmpeg"], J["file"]; W, H = probe(ff, file); nf = native_fps(ff, file) or 60.0
    a, rate, fps, n = float(J["a"]), float(J["rate"]), float(J["fps"]), int(J["n"]); boxes = J["boxes"]; strength = float(J.get("strength", 0.6))
    pix = J.get("style") == "pixelate"; ell = J.get("shape") == "ellipse"; feather = float(J.get("feather", 0.15))
    m0 = int(math.floor(a * nf)); m1 = int(math.ceil((a + rate * n / fps) * nf)) + 2
    src = frames(ff, file, m0 / nf, m1 / nf, nf, W, H); cur = None; ci = -1
    out = J["out"]; tmp = out + ".part.mov"
    enc = subprocess.Popen([ff, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", "%dx%d" % (W, H), "-r", "%.6f" % fps, "-i", "-",
                            "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", tmp],
                           stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=NOWIN)
    t0 = time.time(); blank = np.zeros((H, W, 4), np.uint8)
    for k in range(n):
        want = int(round((a + rate * k / fps) * nf)) - m0
        while ci < want:
            nxt = next(src, None)
            if nxt is None: break
            cur, ci = nxt, ci + 1
        o = blank.copy()
        if cur is not None and k < len(boxes) and boxes[k]:
            x0, y0, x1, y1 = boxes[k]; X0, Y0, X1, Y1 = int(max(0, x0 * W)), int(max(0, y0 * H)), int(min(W, x1 * W)), int(min(H, y1 * H))
            if X1 - X0 > 2 and Y1 - Y0 > 2:
                bw, bh = X1 - X0, Y1 - Y0; pad = int(max(bw, bh) * 0.6) + 8
                ax0, ay0, ax1, ay1 = max(0, X0 - pad), max(0, Y0 - pad), min(W, X1 + pad), min(H, Y1 + pad)
                reg = cv2.cvtColor(np.ascontiguousarray(cur[ay0:ay1, ax0:ax1]), cv2.COLOR_RGB2BGR)
                if pix:
                    blk = max(4, int(max(bw, bh) * (0.04 + 0.16 * strength)))
                    sm = cv2.resize(reg, (max(1, reg.shape[1] // blk), max(1, reg.shape[0] // blk)), interpolation=cv2.INTER_AREA)
                    reg = cv2.resize(sm, (reg.shape[1], reg.shape[0]), interpolation=cv2.INTER_NEAREST)
                else:
                    sig = max(2.0, max(bw, bh) * (0.03 + 0.17 * strength)); reg = cv2.GaussianBlur(reg, (0, 0), sig)
                mk = np.zeros((ay1 - ay0, ax1 - ax0), np.float32); cx, cy = (X0 + X1) / 2 - ax0, (Y0 + Y1) / 2 - ay0
                if ell: cv2.ellipse(mk, (int(cx), int(cy)), (max(1, bw // 2), max(1, bh // 2)), 0, 0, 360, 1.0, -1)
                else: cv2.rectangle(mk, (X0 - ax0, Y0 - ay0), (X1 - ax0, Y1 - ay0), 1.0, -1)
                fs_ = max(1.0, min(bw, bh) * feather * 0.5)
                if feather > 0: mk = cv2.GaussianBlur(mk, (0, 0), fs_)
                o[ay0:ay1, ax0:ax1, :3] = reg; o[ay0:ay1, ax0:ax1, 3] = np.clip(mk * 255, 0, 255).astype(np.uint8)
        try: enc.stdin.write(o.tobytes())
        except Exception: break
        if k % 10 == 0: say(ev="prog", id=J.get("id"), f=min(0.999, (k + 1) / n), fps=round((k + 1) / max(0.01, time.time() - t0), 1))
    enc.stdin.close(); enc.wait()
    if enc.returncode != 0 or not os.path.exists(tmp): raise RuntimeError("Couldn't write the blur video: " + enc.stderr.read().decode(errors="ignore")[-200:])
    os.replace(tmp, out); say(ev="blur", id=J.get("id"), out=out, W=W, H=H, secs=round(time.time() - t0, 1))

def cmd_captions(J):
    """renders animated word-by-word captions as a see-through video the length of the sequence (QuickTime Animation, alpha):
    the words of each caption on screen, the word being said highlighted (and popping in). Empty frames cost almost nothing."""
    from PIL import Image, ImageDraw, ImageFont
    W, H, fps, dur = int(J["W"]), int(J["H"]), float(J["fps"]), float(J["dur"]); G = J["groups"]; st = J.get("style", {})
    size = int(st.get("size", 0) or min(H * 0.075, W * 0.07)); upper = st.get("upper", True); col = tuple(st.get("color", [255, 255, 255])); hi = tuple(st.get("hi", [255, 214, 0]))
    sw = int(st.get("stroke", max(2, size // 12))); sc = tuple(st.get("strokeColor", [0, 0, 0])); yc = float(st.get("y", 0.78)); pop = st.get("pop", True)
    font = None
    for f in [st.get("font")] + [os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts", x) for x in ("ariblk.ttf", "impact.ttf", "seguibl.ttf", "arialbd.ttf")] + ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        try:
            if f: font = ImageFont.truetype(f, size); break
        except Exception: pass
    if font is None: font = ImageFont.load_default()
    big = ImageFont.truetype(font.path, int(size * 1.12)) if hasattr(font, "path") else font
    n = int(math.ceil(dur * fps)); out = J["out"]; tmp = out + ".part.mov"
    lh = int(size * 1.18); BH = (lh * 2 + size // 2 + sw * 2 + 1) // 2 * 2    # only a strip the height of two lines is rendered: ~4x faster and smaller; Premiere places it at y
    blank = bytes(W * BH * 4); cache = {}; gi = 0; t0 = time.time()
    def lines_of(words):
        L, cur = [], []
        for k, w in enumerate(words):
            test = " ".join(x for _, x in cur + [(k, w)])
            if cur and font.getlength(test) > W * 0.86: L.append(cur); cur = []
            cur.append((k, w))
        if cur: L.append(cur)
        return L
    base = {}
    def layout(g):
        words = [(w["w"].upper() if upper else w["w"]) for w in g["words"]]; L = lines_of(words)
        if len(L) > 2: return None
        y = int(BH / 2 - lh * len(L) / 2 - size * 0.08); sp = font.getlength(" "); P = []
        for line in L:
            widths = [font.getlength(w) for _, w in line]; x = (W - (sum(widths) + sp * (len(line) - 1))) / 2
            for (k, w), wd in zip(line, widths): P.append((k, w, x, y, wd)); x += wd + sp
            y += lh
        return P
    def render(g, act, popf):
        key = (id(g), size)
        if key not in base:                                   # the whole caption in white, drawn once
            P = layout(g)
            if P is None: return render_small(g, act, popf, [(w["w"].upper() if upper else w["w"]) for w in g["words"]])
            im = Image.new("RGBA", (W, BH), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
            for k, w, x, y, wd in P: d.text((x, y), w, font=font, fill=col + (255,), stroke_width=sw, stroke_fill=sc + (255,))
            if len(base) > 64: base.clear()
            base[key] = (im, P)
        im0, P = base[key]
        if act < 0: return im0.tobytes()
        im = im0.copy(); d = ImageDraw.Draw(im)
        for k, w, x, y, wd in P:                              # only the spoken word is redrawn, highlighted
            if k != act: continue
            f, dx, dy = font, 0, 0
            if popf > 0: f = big; dx = -(f.getlength(w) - wd) / 2; dy = -(size * 0.12) / 2
            pad = sw + 2; d.rectangle([int(x - pad), int(y - size * 0.25), int(x + wd + pad), int(y + lh)], fill=(0, 0, 0, 0))
            d.text((x + dx, y + dy), w, font=f, fill=hi + (255,), stroke_width=sw, stroke_fill=sc + (255,))
        return im.tobytes()
    small = {}
    def render_small(g, act, popf, words):
        nonlocal font, big, size, lh
        keep = (font, big, size, lh); s2 = size
        try:
            while s2 > 12:
                s2 = int(s2 * 0.85)
                if s2 not in small: small[s2] = (ImageFont.truetype(font.path, s2), ImageFont.truetype(font.path, int(s2 * 1.12))) if hasattr(font, "path") else (font, font)
                font, big = small[s2]; size = s2; lh = int(s2 * 1.18)
                if len(lines_of(words)) <= 2: return render(g, act, popf)
            return render(g, act, popf)
        finally: font, big, size, lh = keep
    # each distinct picture is drawn once (uncompressed TGA keeps the see-through edges); ffmpeg holds it for as many frames
    # as it's on screen, so nothing is copied frame by frame. Long videos are split into parts encoded side by side.
    fr = lambda t: max(0, min(n, int(round(t * fps))))
    segs = []
    def seg(a_, b_, key):
        if b_ > a_: segs.append((a_, b_, key))
    cur = 0
    for gi_, g in enumerate(G):
        gs, ge = fr(g["s"]), fr(g["e"])
        if ge <= cur: continue
        gs = max(gs, cur); seg(cur, gs, None)
        Wd = g["words"]; starts = [min(max(gs, fr(w["s"])), ge) for w in Wd] + [ge]
        for k in range(1, len(starts)): starts[k] = max(starts[k], starts[k - 1])
        seg(gs, starts[0], (gi_, -1, 0))
        for k in range(len(Wd)):
            a_, b_ = starts[k], starts[k + 1]
            if pop: pe = min(b_, a_ + max(1, fr(0.08))); seg(a_, pe, (gi_, k, 1)); seg(pe, b_, (gi_, k, 0))
            else: seg(a_, b_, (gi_, k, 0))
        cur = ge
    seg(cur, n, None)
    tmpd = os.path.abspath(out + ".parts"); os.makedirs(tmpd, exist_ok=True); files = {}
    def pic(key):
        f = files.get(key)
        if f: return f
        f = os.path.join(tmpd, "c%d.tga" % len(files))
        (Image.new("RGBA", (W, BH), (0, 0, 0, 0)) if key is None else Image.frombytes("RGBA", (W, BH), render(G[key[0]], key[1], key[2]))).save(f)
        files[key] = f; return f
    K = max(1, min(12, (os.cpu_count() or 4) - 1, n // 900 or 1)); per = n / K; chunks = [[] for _ in range(K)]
    for a_, b_, key in segs:                               # cut the timeline into K parts on frame boundaries
        while a_ < b_:
            ci = min(K - 1, int(a_ // per)); end = min(b_, int(round((ci + 1) * per)) if ci < K - 1 else b_)
            if end <= a_: end = b_
            chunks[ci].append((a_, end, key)); a_ = end
    lists = []; done_ = 0
    for ci, C in enumerate(chunks):
        if not C: continue
        lst = os.path.join(tmpd, "l%d.txt" % ci)
        with open(lst, "w", encoding="utf-8") as L:
            for a_, b_, key in C:
                f = pic(key).replace("\\", "/"); L.write("file '%s'\nduration %.6f\n" % (f.replace("'", "'\\''"), (b_ - a_) / fps))
            L.write("file '%s'\n" % f.replace("'", "'\\''"))
        lists.append((lst, os.path.join(tmpd, "p%d.mov" % ci), sum(b_ - a_ for a_, b_, _ in C)))
        done_ += lists[-1][2]; say(ev="prog", id=J.get("id"), f=min(0.5, 0.5 * done_ / max(1, n)), fps=0)
    procs = [subprocess.Popen([J["ffmpeg"], "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", l, "-r", "%.6f" % fps, "-frames:v", str(nf), "-c:v", "qtrle", "-pix_fmt", "argb", o],
                              stderr=subprocess.PIPE, creationflags=NOWIN) for l, o, nf in lists]
    errs = []
    for k_, pr in enumerate(procs):
        e_ = pr.communicate()[1]; say(ev="prog", id=J.get("id"), f=0.5 + 0.45 * (k_ + 1) / len(procs), fps=0)
        if pr.returncode != 0: errs.append(e_.decode(errors="ignore")[-200:])
    try:
        if errs: raise RuntimeError("Couldn't write the captions: " + errs[0])
        if len(lists) == 1: os.replace(lists[0][1], tmp)
        else:
            cl = os.path.join(tmpd, "all.txt")
            with open(cl, "w", encoding="utf-8") as f: f.write("".join("file '%s'\n" % o.replace("\\", "/").replace("'", "'\\''") for _, o, _ in lists))
            r = subprocess.run([J["ffmpeg"], "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", cl, "-c", "copy", tmp], stderr=subprocess.PIPE, creationflags=NOWIN)
            if r.returncode != 0: raise RuntimeError("Couldn't join the captions: " + r.stderr.decode(errors="ignore")[-200:])
    finally:
        import shutil; shutil.rmtree(tmpd, ignore_errors=True)
    os.replace(tmp, out); say(ev="captions", id=J.get("id"), out=out, y=yc, bh=BH, secs=round(time.time() - t0, 1), frames=n)

def size(W, H, pw=PW):
    w = min(pw, W); h = int(round(w * H / W / 2)) * 2; return w, h

def frames(ff, file, a, b, fps, w, h):
    """yields RGB frames (h, w, 3) of file from a to b seconds, at fps"""
    cmd = [ff, "-v", "error", "-ss", "%.4f" % max(0.0, a), "-i", file, "-t", "%.4f" % max(1.0 / fps, b - a), "-an", "-sn",
           "-vf", "fps=%.6f,scale=%d:%d:flags=bilinear" % (fps, w, h), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=NOWIN, bufsize=w * h * 3 * 4)
    n = w * h * 3
    try:
        while True:
            buf = p.stdout.read(n)
            if len(buf) < n: break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        try: p.kill()
        except Exception: pass

def model():
    if "m" in M: return M
    import torch
    from transformers import Sam2VideoModel, Sam2VideoProcessor
    gpu = torch.cuda.is_available(); dev = "cuda" if gpu else "cpu"
    dt = torch.bfloat16 if gpu and torch.cuda.is_bf16_supported() else (torch.float16 if gpu else torch.float32)
    say(ev="stage", msg="Loading the tracking AI" + (" on your graphics card" if gpu else " (no graphics card found, this will be slow)") + "…")
    try: m = Sam2VideoModel.from_pretrained(MID, dtype=dt)
    except TypeError: m = Sam2VideoModel.from_pretrained(MID, torch_dtype=dt)
    M.update(m=m.to(dev).eval(), p=Sam2VideoProcessor.from_pretrained(MID), dev=dev, dt=dt, torch=torch, gpu=gpu)
    return M

class Seg:
    """one object, followed frame by frame (streaming: frames are fed in the order they should be tracked)"""
    def __init__(self, pts, w, h):
        D = model(); self.D = D; self.w, self.h = w, h; self.first = True
        self.pts = [[[[float(u) * w, float(v) * h] for u, v, l in pts]]]; self.lab = [[[int(l) for u, v, l in pts]]]
        self.s = D["p"].init_video_session(inference_device=D["dev"], dtype=D["dt"])
    def __call__(self, rgb):
        D = self.D; torch = D["torch"]
        with torch.inference_mode():
            inp = D["p"](images=rgb, device=D["dev"], return_tensors="pt")
            if self.first:
                D["p"].add_inputs_to_inference_session(inference_session=self.s, frame_idx=0, obj_ids=1, input_points=self.pts,
                                                       input_labels=self.lab, original_size=inp.original_sizes[0])
                self.first = False
            out = D["m"](inference_session=self.s, frame=inp.pixel_values[0].to(D["dev"], dtype=D["dt"]))
            m = D["p"].post_process_masks([out.pred_masks], original_sizes=inp.original_sizes, binarize=False)[0]
        return (m[0, 0].float().cpu().numpy() > 0)

def center(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) < 4: return None
    return float(xs.mean()), float(ys.mean()), float(len(xs))

def flow_step(cv2, prev_g, g, mask, n_min, corners, dist):
    """how the points inside `mask` (or the whole frame) moved between two frames: (A 2x3 similarity, scale, n_points) or None.
    Points must track forward AND back to where they started (drops points that slipped), RANSAC drops outliers,
    scale = median change of distances between point pairs (much steadier than the fitted scale on small objects)."""
    p0 = cv2.goodFeaturesToTrack(prev_g, maxCorners=corners, qualityLevel=0.005, minDistance=dist, mask=mask, blockSize=5)
    if p0 is None or len(p0) < n_min: return None
    p1, st, _ = cv2.calcOpticalFlowPyrLK(prev_g, g, p0, None, winSize=(25, 25), maxLevel=4, criteria=(3, 40, 0.005))
    pb, st2, _ = cv2.calcOpticalFlowPyrLK(g, prev_g, p1, None, winSize=(25, 25), maxLevel=4, criteria=(3, 40, 0.005))
    fb = np.linalg.norm((p0 - pb).reshape(-1, 2), axis=1)
    good = (st.reshape(-1) == 1) & (st2.reshape(-1) == 1) & (fb < 0.7)
    if good.sum() < n_min: return None
    a, b = p0[good].reshape(-1, 2), p1[good].reshape(-1, 2)
    A, inl = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=1.0, maxIters=4000, confidence=0.999)
    if A is None or inl is None or inl.sum() < max(6, n_min - 2): return None
    keep = inl.reshape(-1) == 1; a, b = a[keep], b[keep]
    sc = 1.0
    if len(a) >= 10:
        rng = np.random.default_rng(0); I = rng.integers(0, len(a), (min(400, len(a) * 4), 2)); I = I[I[:, 0] != I[:, 1]]
        da = np.linalg.norm(a[I[:, 0]] - a[I[:, 1]], axis=1); db = np.linalg.norm(b[I[:, 0]] - b[I[:, 1]], axis=1); ok = da > 8
        if ok.sum() >= 10: sc = float(np.clip(np.median(db[ok] / da[ok]), 0.9, 1.1))
    return A, sc, int(len(a))

def ground_step(cv2, prev_g, g, px, py, k_near=80, skip=None):
    """how the map/ground NEAR the point moved between two frames (local affine from the closest well-tracked points,
    so hills and depth don't bend it; when the point is off screen, the nearest visible points are used). 3x3 or None"""
    p0 = cv2.goodFeaturesToTrack(prev_g, maxCorners=1500, qualityLevel=0.004, minDistance=8, blockSize=5, mask=skip)
    if p0 is None or len(p0) < 30: return None
    p1, st, _ = cv2.calcOpticalFlowPyrLK(prev_g, g, p0, None, winSize=(25, 25), maxLevel=4, criteria=(3, 40, 0.005))
    pb, st2, _ = cv2.calcOpticalFlowPyrLK(g, prev_g, p1, None, winSize=(25, 25), maxLevel=4, criteria=(3, 40, 0.005))
    fb = np.linalg.norm((p0 - pb).reshape(-1, 2), axis=1)
    good = (st.reshape(-1) == 1) & (st2.reshape(-1) == 1) & (fb < 0.8)
    a, b = p0[good].reshape(-1, 2), p1[good].reshape(-1, 2)
    if len(a) < 30: return None
    d = np.hypot(a[:, 0] - px, a[:, 1] - py); o = np.argsort(d)[:k_near]
    A, inl = cv2.estimateAffine2D(a[o], b[o], method=cv2.RANSAC, ransacReprojThreshold=1.2, maxIters=4000, confidence=0.999)
    if A is None or inl is None or inl.sum() < 15: return None
    return np.vstack([A, [0, 0, 1]])

def hmap(H, x, y):
    v = H @ np.array([x, y, 1.0]); return v[0] / v[2], v[1] / v[2]

def hjac(H, x, y, e=2.0):
    """local scale and turn of a perspective transform at a point"""
    ax, ay = hmap(H, x, y); bx, by = hmap(H, x + e, y); cx, cy = hmap(H, x, y + e)
    J = np.array([[bx - ax, cx - ax], [by - ay, cy - ay]]) / e
    return math.sqrt(abs(np.linalg.det(J))), math.degrees(math.atan2(J[1, 0], J[0, 0])), J

def run_dir(seq_frames, pts, w, h, prog, every=8, follow=0.12, pin="ground"):
    """tracks through frames in the given order (first = the clicked frame). Returns per-frame [x, y, s, r, ok].
    The point is pinned to the GROUND under the object (perspective-correct, from the whole picture: steady, and it keeps
    working when the object leaves the frame), plus an offset that slowly follows the object's own movement (a unit walking).
    Waving banners / animated sprites don't shake it, because the object only steers that slow offset."""
    import cv2
    seg = Seg(pts, w, h); res = []; prev_g = prev_m = None; s = 1.0; r = 0.0
    k5 = np.ones((5, 5), np.uint8); gx = gy = 0.0; dx = dy = 0.0; vx = vy = 0.0; Jc = np.eye(2)
    for i, rgb in enumerate(seq_frames):
        g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        if i == 0:
            m = seg(rgb); c = center(m)
            if c is None: raise RuntimeError("The AI couldn't find the object on the frame you clicked. Click on it again.")
            ys0, xs0 = np.nonzero(m); BOX0[:] = [float(xs0.min()) / w, float(ys0.min()) / h, float(xs0.max() + 1) / w, float(ys0.max() + 1) / h, c[0] / w, c[1] / h]
            ys, xs = np.nonzero(m); fy = float(np.percentile(ys, 97)); fx = float(np.median(xs[ys >= fy - 3]))
            if pin == "object": fx, fy = c[0], c[1]                 # follow the clicked thing itself (flags, banners, a group)
            gx, gy = fx, fy; vx, vy = c[0] - fx, c[1] - fy          # ground mode: pinned at the FEET (where it stands on the map); the body sits above that
            res.append([c[0], c[1], 1.0, 0.0, 1, 1.0, 0.0, 0.0, 1.0, fx, fy]); prev_g, prev_m = g, m; seg.prev = m; continue
        if np.array_equal(g, prev_g):                                  # repeated frame (slowed-down clip): nothing moved
            res.append(list(res[-1])); continue
        px, py = gx + dx, gy + dy
        skip = None
        if prev_m is not None and prev_m.any(): skip = np.where(cv2.dilate(prev_m.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0, 0, 255).astype(np.uint8)
        H = ground_step(cv2, prev_g, g, px, py, skip=skip)     # the MAP around it (not the object itself)
        st = None
        if prev_m is not None and prev_m.sum() > 30:
            k = cv2.dilate(prev_m.astype(np.uint8) * 255, k5)
            st = flow_step(cv2, prev_g, g, k, 10, 400, 3)
        if pin == "object" and st is not None:                       # the clicked thing's own motion, measured on every frame
            A, sc, n = st; nx, ny = A[0, 0] * px + A[0, 1] * py + A[0, 2], A[1, 0] * px + A[1, 1] * py + A[1, 2]
            gx, gy = gx + (nx - px), gy + (ny - py); s *= sc; r += math.degrees(math.atan2(A[1, 0], A[0, 0])); Jc = A[:, :2] @ Jc
        elif H is not None:
            sc, ro, J = hjac(H, px, py)
            gx, gy = hmap(H, gx, gy); dx, dy = J @ np.array([dx, dy]); s *= sc; r += ro; Jc = J @ Jc
        elif st is not None:                                           # no usable ground (e.g. full-screen effect): follow the object
            A, sc, n = st; nx, ny = A[0, 0] * px + A[0, 1] * py + A[0, 2], A[1, 0] * px + A[1, 1] * py + A[1, 2]
            gx, gy = gx + (nx - px), gy + (ny - py); s *= sc; r += math.degrees(math.atan2(A[1, 0], A[0, 0])); Jc = A[:, :2] @ Jc
        ai = (i % every == 0) or prev_m is None
        if ai: m = seg(rgb)
        elif st is not None: m = cv2.warpAffine(prev_m.astype(np.uint8), st[0], (w, h), flags=cv2.INTER_NEAREST) > 0
        elif H is not None: m = cv2.warpPerspective(prev_m.astype(np.uint8), H, (w, h), flags=cv2.INTER_NEAREST) > 0
        else: m = prev_m
        c = center(m)
        cut = c is not None and (m[:, :3].any() or m[:, -3:].any() or m[:3].any() or m[-3:].any())
        if pin != "object" and st is not None and H is not None and not cut:   # the object's own movement on the ground (slowly, so waving cloth doesn't shake it)
            A = st[0]; ox, oy = A[0, 0] * px + A[0, 1] * py + A[0, 2], A[1, 0] * px + A[1, 1] * py + A[1, 2]
            qx, qy = gx + dx, gy + dy
            dx += follow * (ox - qx); dy += follow * (oy - qy)
        res.append([gx + dx + vx * s, gy + dy + vy * s, s, r, 1 if (c is not None and not cut) else 0, Jc[0, 0], Jc[0, 1], Jc[1, 0], Jc[1, 1], gx + dx, gy + dy])
        prev_g, prev_m = g, m; seg.prev = m
        if i % 3 == 0: prog(i + 1)
    return res

def cmd_frame(J):
    W, H = probe(J["ffmpeg"], J["file"]); w, h = size(W, H, 1920)   # sharp still for zooming in
    f = next(frames(J["ffmpeg"], J["file"], J["t"], J["t"] + 0.2, 30, w, h), None)
    if f is None: raise RuntimeError("Couldn't read that frame of the video.")
    import cv2; cv2.imwrite(J["out"], cv2.cvtColor(f, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
    say(ev="frame", id=J.get("id"), w=w, h=h, W=W, H=H)

def cmd_preview(J):
    import cv2
    W, H = probe(J["ffmpeg"], J["file"]); w, h = size(W, H, 1920)   # sharp still for zooming in
    f = next(frames(J["ffmpeg"], J["file"], J["t"], J["t"] + 0.2, 30, w, h), None)
    if f is None: raise RuntimeError("Couldn't read that frame of the video.")
    m = Seg(J["pts"], w, h)(f); img = cv2.cvtColor(f, cv2.COLOR_RGB2BGR).astype(np.float32)
    tint = np.zeros_like(img); tint[..., 0] = 255; tint[..., 1] = 140      # blue-ish highlight
    img[m] = img[m] * 0.45 + tint[m] * 0.55
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); img = img.astype(np.uint8)
    cv2.drawContours(img, cs, -1, (255, 200, 60), 2)
    for u, v, l in J["pts"]: cv2.circle(img, (int(u * w), int(v * h)), 6, (80, 220, 80) if l else (60, 60, 230), -1); cv2.circle(img, (int(u * w), int(v * h)), 6, (255, 255, 255), 1)
    cv2.imwrite(J["out"], img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    ys, xs = np.nonzero(m)
    say(ev="preview", id=J.get("id"), area=float(m.mean()), box=[float(xs.min() / w), float(ys.min() / h), float(xs.max() / w), float(ys.max() / h)] if len(xs) else None)

def cmd_track(J):
    """tracks the video's OWN frames (no repeated frames), then works out the exact position at every timeline frame time.
    Slowed-down clips play smoothly in Premiere (frame blending), so the graphic has to glide the same way."""
    ff, file, fps = J["ffmpeg"], J["file"], float(J["fps"]); a, b, ref = float(J["a"]), float(J["b"]), float(J["ref"])
    W, H = probe(ff, file); w, h = size(W, H); model(); nf = native_fps(ff, file) or fps
    n_tot = max(1, int(round((b - a) * fps))); k_ref = min(n_tot - 1, max(0, int(round((ref - a) * fps)))); t0 = time.time()
    tref = a + k_ref / fps                                          # the clicked moment, in video seconds
    m_ref = int(round(tref * nf)); m_a = int(math.floor(a * nf)); m_b = int(math.ceil(b * nf)) + 1   # video frame numbers
    n_src = max(1, m_b - m_a); done = [0]
    def prog(_): done[0] += 3; say(ev="prog", id=J.get("id"), f=min(0.999, done[0] / n_src), fps=round(done[0] / max(0.01, time.time() - t0), 1))
    say(ev="stage", id=J.get("id"), msg="Tracking…")
    pin = J.get("pin", "ground")
    fwd = run_dir(frames(ff, file, m_ref / nf, m_b / nf, nf, w, h), J["pts"], w, h, prog, pin=pin)
    back = []
    if m_ref > m_a:
        B = list(frames(ff, file, m_a / nf, (m_ref + 1) / nf, nf, w, h))[: m_ref - m_a + 1]
        back = run_dir(B[::-1], J["pts"], w, h, prog, pin=pin)[1:][::-1]
    S = np.array(back + fwd, dtype=np.float64)                      # one row per video frame, from m_a
    tS = (m_a + (m_ref - m_a - len(back))) / nf + np.arange(len(S)) / nf
    tq = a + np.arange(n_tot) / fps                                 # every timeline frame, in video seconds
    out = []
    for q in tq:
        k = (q - tS[0]) * nf; k0 = int(np.clip(math.floor(k), 0, len(S) - 1)); k1 = min(len(S) - 1, k0 + 1); f = float(np.clip(k - k0, 0, 1))
        r = S[k0] * (1 - f) + S[k1] * f; ok = int(min(S[k0][4], S[k1][4]))
        # J maps an offset next to the object (in pixels) from the clicked frame to this frame; converted to 0..1 units of the video
        Jn = np.array([[r[5], r[6] * h / w], [r[7] * w / h, r[8]]])
        out.append([round(r[0] / w, 6), round(r[1] / h, 6), round(r[2], 5), round(r[3], 4), ok] + [round(float(v), 6) for v in Jn.reshape(-1)] + [round(r[9] / w, 6), round(r[10] / h, 6)])   # + where it stands (feet)
    say(ev="track", id=J.get("id"), fr=out, k_ref=k_ref, W=W, H=H, secs=round(time.time() - t0, 1), nf=nf, box0=BOX0[:])

def main():
    say(ev="ready")
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try: J = json.loads(line)
        except Exception: continue
        if J.get("cmd") == "quit": break
        try: {"frame": cmd_frame, "preview": cmd_preview, "track": cmd_track, "probe": cmd_probe, "calib": cmd_calib, "diffbox": cmd_diffbox, "blur": cmd_blur, "captions": cmd_captions}[J["cmd"]](J)
        except Exception as e: say(ev="error", id=J.get("id"), msg=str(e), tb=traceback.format_exc()[-1200:])

if __name__ == "__main__":
    main()
