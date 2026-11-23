"""AssetFlow voice / music worker.

Modes (job["mode"]):
  "nomusic"  removes the MUSIC and keeps voice + game sounds, using a speech / music / effects model (BandIt Plus, DnR).
             The result is the original audio minus the music the model finds, so voice and sound effects stay untouched.
  "voice"    splits VOICE and EVERYTHING ELSE with a BS-RoFormer model (audio-separator), optional voice clean-up.
Inputs:
  job["items"]     stretches of source files: [{key, file, stream, a, b, out_voice?, out_rest, raw_voice?}]
  job["timeline"]  optional: {key, total, clips:[{file, stream, in, out, s}]} -> first renders those clips into ONE file
                   as long as the sequence (silence between clips), then processes that single file.
Progress goes to stdout as JSON lines: {"ev": "stage"|"prog"|"done"|"error"|"item", ...}
Usage: python af_voice.py job.json
"""
import json, os, sys, time, shutil, subprocess, traceback, re, types

def say(**k):
    sys.stdout.write(json.dumps(k) + "\n"); sys.stdout.flush()

VOICE_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
CLEAN_MODELS = ["denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt", "UVR-DeNoise.pth"]
SR = 44100
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# ---------------------------------------------------------------- reading audio with ffmpeg
def read_audio(ff, file, a, b, stream=0):
    """float32 array (2, n) at 44.1 kHz of file[a:b] (seconds)."""
    import numpy as np
    def go(st):
        cmd = [ff, "-hide_banner", "-loglevel", "error", "-ss", "%.4f" % max(0, a), "-t", "%.4f" % max(0.01, b - a), "-i", file,
               "-map", "0:a:%d" % st, "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
        return subprocess.run(cmd, capture_output=True, creationflags=NOWIN)
    r = go(stream)
    if (r.returncode != 0 or not r.stdout) and stream: r = go(0)
    if r.returncode != 0: raise RuntimeError("Couldn't read the audio of " + os.path.basename(file) + ": " + r.stderr.decode(errors="ignore").strip()[-200:])
    x = np.frombuffer(r.stdout, dtype=np.float32)
    return x[: len(x) // 2 * 2].reshape(-1, 2).T.copy()

def render_timeline(ff, tl, dst):
    """put every clip at its place in one long file (silence in the gaps); returns the length in seconds"""
    import numpy as np, soundfile as sf
    clips = sorted(tl["clips"], key=lambda c: c["s"])
    total = int(round(tl["total"] * SR)); cur = 0; n = len(clips)
    tmp = dst + ".part"
    with sf.SoundFile(tmp, "w", samplerate=SR, channels=2, subtype="PCM_16", format="RF64" if total > 3_000_000_000 // 4 else "WAV") as f:
        def silence(k):
            nonlocal cur
            z = np.zeros((min(k, SR * 30), 2), dtype=np.float32)
            while k > 0:
                m = min(k, len(z)); f.write(z[:m]); k -= m; cur += m
        for i, c in enumerate(clips):
            s0 = int(round(c["s"] * SR)); a, b = c["in"], c["out"]
            if s0 > cur: silence(s0 - cur)
            elif s0 < cur: a += (cur - s0) / SR          # overlaps the previous clip: keep the earlier one
            if b - a > 0.0005:
                x = read_audio(ff, c["file"], a, b, c.get("stream", 0))
                want = int(round((b - a) * SR)); x = x[:, :want]
                if x.shape[1] < want: x = np.pad(x, ((0, 0), (0, want - x.shape[1])))
                f.write(x.T); cur += x.shape[1]
            if i % 5 == 0: say(ev="prog", f=0.10 * (i + 1) / n, what="render")
        if total > cur: silence(total - cur)
    os.replace(tmp, dst)
    return cur / SR

# ---------------------------------------------------------------- music removal (BandIt Plus, speech / music / effects)
def load_dnr(job):
    import torch, yaml
    root = job["msst"]
    if root not in sys.path: sys.path.insert(0, root)
    # skip the training-only package __init__ files (they pull in heavy libraries we don't need for listening)
    for name in ["models", "models.bandit", "models.bandit.core"]:
        if name not in sys.modules:
            m = types.ModuleType(name); m.__path__ = [os.path.join(root, *name.split("."))]; sys.modules[name] = m
    from models.bandit.core.model import MultiMaskMultiSourceBandSplitRNNSimple
    with open(job["dnr_config"], encoding="utf-8") as f: txt = f.read()
    try: cfg = yaml.load(txt, Loader=yaml.FullLoader)
    except Exception: cfg = yaml.unsafe_load(txt)
    mcfg = dict(cfg["model"])
    model = MultiMaskMultiSourceBandSplitRNNSimple(**mcfg)
    sd = torch.load(job["dnr_weights"], map_location="cpu", weights_only=False)
    if isinstance(sd, dict) and "state_dict" in sd: sd = sd["state_dict"]
    try: model.load_state_dict(sd)
    except Exception:
        sd = {re.sub(r"^(model\.|module\.)", "", k): v for k, v in sd.items()}; model.load_state_dict(sd)
    stems = list(mcfg.get("stems") or (cfg.get("training") or {}).get("instruments") or ["speech", "music", "effects"])
    chunk = int((cfg.get("audio") or {}).get("chunk_size") or SR * 6)
    gpu = torch.cuda.is_available(); dev = torch.device("cuda" if gpu else "cpu")
    model.to(dev).eval()
    return dict(model=model, stems=stems, mi=stems.index("music") if "music" in stems else 1, chunk=chunk, dev=dev, gpu=gpu, torch=torch)

def music_of(D, x, overlap, batch, on_prog):
    """music estimate (2, n) for audio x (2, n), overlap-add of windowed chunks"""
    import numpy as np
    torch = D["torch"]; C = D["chunk"]; step = max(1, C // overlap); n = x.shape[1]
    pad = C - step
    xp = np.pad(x, ((0, 0), (pad, pad + C)))
    win = np.hanning(C).astype(np.float32) + 1e-3
    out = np.zeros((2, xp.shape[1]), dtype=np.float32); ws = np.zeros(xp.shape[1], dtype=np.float32)
    pos = list(range(0, n + pad, step)); done = 0
    for i in range(0, len(pos), batch):
        P = pos[i:i + batch]
        xb = torch.from_numpy(np.stack([xp[:, p:p + C] for p in P])).to(D["dev"])
        with torch.inference_mode():
            if D["gpu"]:
                with torch.autocast("cuda", dtype=torch.float16): y = D["model"](xb)
            else: y = D["model"](xb)
        y = y[:, D["mi"]].float().cpu().numpy()          # (b, 2, C)
        for j, p in enumerate(P):
            out[:, p:p + C] += y[j] * win; ws[p:p + C] += win
        done += len(P); on_prog(done / len(pos))
    return out[:, pad:pad + n] / ws[pad:pad + n]

def remove_music(ff, D, it, job, base_done, total, ov):
    """writes it["out_rest"] = original minus music, processing in 10-minute blocks so long streams fit in memory"""
    import numpy as np, soundfile as sf
    dur = it["b"] - it["a"]; BLOCK = float(job.get("block", 600.0)); ctx = D["chunk"] / SR
    os.makedirs(os.path.dirname(it["out_rest"]), exist_ok=True); tmp = it["out_rest"] + ".part"
    with sf.SoundFile(tmp, "w", samplerate=SR, channels=2, subtype="PCM_16", format="RF64" if dur > 6 * 3600 else "WAV") as f:
        t = 0.0
        while t < dur - 1e-6:
            e = min(dur, t + BLOCK); ra = max(0.0, t - ctx); rb = min(dur, e + ctx)
            if it.get("direct"):
                with sf.SoundFile(it["file"]) as g:
                    g.seek(int(round((it["a"] + ra) * SR))); x = g.read(int(round((rb - ra) * SR)), dtype="float32", always_2d=True).T
            else: x = read_audio(ff, it["file"], it["a"] + ra, it["a"] + rb, it.get("stream", 0))
            if x.shape[1] == 0: break
            def tick(fr, t0=t, e=e):
                if time.time() - prog_t[0] > 0.5:
                    prog_t[0] = time.time(); say(ev="prog", f=min(0.999, (base_done + t0 + fr * (e - t0)) / total))
            m = music_of(D, x, ov, job.get("batch", 4), tick)
            k0 = int(round((t - ra) * SR)); k1 = k0 + int(round((e - t) * SR))
            y = np.clip(x[:, k0:k1] - m[:, k0:k1], -1.0, 1.0)
            f.write(y.T); t = e
    os.replace(tmp, it["out_rest"])
prog_t = [0.0]

# ---------------------------------------------------------------- main
def run(job):
    ff = job["ffmpeg"]
    os.environ["PATH"] = os.path.dirname(ff) + os.pathsep + os.environ.get("PATH", "")   # audio-separator looks for ffmpeg on PATH
    work = job["work"]; os.makedirs(work, exist_ok=True)
    mode = job.get("mode", "voice"); clean = mode == "voice" and job.get("clean")
    items = job["items"]
    if job.get("timeline"):
        tl = job["timeline"]; src = os.path.join(work, "timeline_%s.wav" % tl["key"])
        outs_there = all(os.path.exists(it["out_rest"]) and (mode == "nomusic" or os.path.exists(it["out_voice"])) for it in items)
        if not outs_there and not os.path.exists(src):
            say(ev="stage", msg="Putting the sequence audio into one file…"); render_timeline(ff, tl, src)
        for it in items: it["file"] = src; it["direct"] = True; it["a"] = 0.0; it["b"] = tl["total"]
    def have(it): return os.path.exists(it["out_rest"]) and (mode == "nomusic" or os.path.exists(it["out_voice"]))
    todo = [it for it in items if not have(it)]
    for it in items:
        if it not in todo: say(ev="item", key=it["key"], cached=True)
    if not todo: say(ev="done"); return
    say(ev="stage", msg="Starting the AI…")
    import torch
    gpu = torch.cuda.is_available()
    if gpu: torch.backends.cudnn.benchmark = True
    total = sum(max(0.1, it["b"] - it["a"]) for it in todo) * (2 if clean else 1)

    if mode == "nomusic":
        say(ev="stage", msg="Loading the music model" + (" on your graphics card" if gpu else " (no graphics card found, this will be slow)") + "…", gpu=gpu)
        D = load_dnr(job); say(ev="stage", msg="Removing the music…")
        done = 0.0
        for it in todo:
            remove_music(ff, D, it, job, done, total, job.get("overlap", 2))
            done += max(0.1, it["b"] - it["a"]); say(ev="item", key=it["key"])
        if job.get("timeline"):
            try: os.remove(todo[0]["file"])
            except Exception: pass
        say(ev="done"); return

    # ---- voice / everything else (audio-separator)
    say(ev="stage", msg="Loading the voice model" + (" on your graphics card" if gpu else " (no graphics card found, this will be slow)") + "…", gpu=gpu)
    from audio_separator.separator import Separator
    models = job["models"]; os.makedirs(models, exist_ok=True)
    done_s = [0.0]; cur = {"len": 0.0}
    class Tee:   # tqdm writes "  37%|###..." to stderr while a model runs; turn it into overall progress
        def __init__(s, real): s.real = real; s.buf = ""; s.last = 0
        def write(s, x):
            s.buf += x; m = None
            for m in re.finditer(r"(\d{1,3})%\|", s.buf): pass
            if m and time.time() - s.last > 0.5:
                s.last = time.time(); f = int(m.group(1)) / 100.0
                say(ev="prog", f=min(0.999, (done_s[0] + f * cur["len"]) / total))
            if len(s.buf) > 4000: s.buf = s.buf[-400:]
            return len(x)
        def flush(s): pass
        def isatty(s): return False
        encoding = 'utf-8'
    sys.stderr = Tee(sys.stderr)
    def sep_for(model):
        p = {"segment_size": 256, "override_model_segment_size": False, "batch_size": job.get("batch", 4), "overlap": job.get("overlap", 2), "pitch_shift": 0}
        s = Separator(output_dir=work, output_format="WAV", model_file_dir=models, use_autocast=gpu, mdxc_params=p, log_level=40)
        s.load_model(model_filename=model); return s
    def outputs(res): return [r if os.path.isabs(r) else os.path.join(work, r) for r in (res or [])]
    sep = sep_for(VOICE_MODEL); say(ev="stage", msg="Separating the voice…")
    for it in todo:
        cur["len"] = max(0.1, it["b"] - it["a"])
        if it.get("direct"): src = it["file"]
        else:
            src = os.path.join(work, "in_%s.wav" % it["key"])
            cmd = [ff, "-hide_banner", "-loglevel", "error", "-y", "-ss", "%.3f" % it["a"], "-t", "%.3f" % (it["b"] - it["a"]), "-i", it["file"],
                   "-map", "0:a:%d" % it.get("stream", 0), "-vn", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", src]
            r = subprocess.run(cmd, capture_output=True, creationflags=NOWIN)
            if r.returncode != 0 and it.get("stream", 0):
                cmd[cmd.index("0:a:%d" % it["stream"])] = "0:a:0"; r = subprocess.run(cmd, capture_output=True, creationflags=NOWIN)
            if r.returncode != 0: raise RuntimeError("Couldn't read the audio of " + os.path.basename(it["file"]) + ": " + r.stderr.decode(errors="ignore").strip()[-200:])
        res = outputs(sep.separate(src))
        voc = [f for f in res if "(vocals)" in os.path.basename(f).lower()]; oth = [f for f in res if f not in voc]
        if not voc or not oth: raise RuntimeError("The voice model gave unexpected files: " + ", ".join(os.path.basename(f) for f in res))
        os.makedirs(os.path.dirname(it["out_voice"]), exist_ok=True)
        shutil.move(voc[0], it["raw_voice"] if clean else it["out_voice"]); shutil.move(oth[0], it["out_rest"])
        for f in res[2:]:
            try: os.remove(f)
            except Exception: pass
        try: os.remove(src)
        except Exception: pass
        done_s[0] += cur["len"]
        if not clean: say(ev="item", key=it["key"])
    del sep
    if clean:
        say(ev="stage", msg="Cleaning up the voice…"); sep2, err = None, None
        for m in CLEAN_MODELS:
            try: sep2 = sep_for(m); break
            except Exception as e: err = e
        if sep2 is None: raise RuntimeError("Couldn't load the voice clean-up model: %s" % err)
        for it in todo:
            cur["len"] = max(0.1, it["b"] - it["a"])
            res = outputs(sep2.separate(it["raw_voice"]))
            def score(f):
                b = os.path.basename(f).lower()
                if "no noise" in b or "(dry)" in b or "no_noise" in b: return 0
                if "noise" in b or "(other)" in b: return 2
                return 1
            res.sort(key=score)
            if not res: raise RuntimeError("The clean-up model gave no files")
            shutil.move(res[0], it["out_voice"])
            for f in res[1:]:
                try: os.remove(f)
                except Exception: pass
            try: os.remove(it["raw_voice"])
            except Exception: pass
            done_s[0] += cur["len"]; say(ev="item", key=it["key"])
    say(ev="done")

if __name__ == "__main__":
    try:
        run(json.load(open(sys.argv[1], encoding="utf-8")))
    except Exception as e:
        say(ev="error", msg=str(e), tb=traceback.format_exc()[-1500:]); sys.exit(1)
