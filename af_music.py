"""AssetFlow auto-fit music: make a song end exactly when the video ends by skipping (or repeating) a stretch of it
at a point where the music sounds the same on both sides of the jump, so the cut is invisible. numpy only.
stdin: {"path", "ffmpeg", "in": media start (s), "len": wanted length on the timeline (s), "keep_end": true}
stdout: {"ev":"music","pieces":[[mediaIn, mediaOut], ...] (play in order, back to back), "end": where the song really ends, "score"}"""
import sys, json, subprocess, os
import numpy as np
NOWIN = 0x08000000 if os.name == "nt" else 0
SR = 22050; HOP = 256; NF = 1024
def say(**k): sys.stdout.write(json.dumps(k) + "\n"); sys.stdout.flush()

def load(ff, path):
    r = subprocess.run([ff, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, creationflags=NOWIN)
    x = np.frombuffer(r.stdout, np.float32)
    if not len(x): raise RuntimeError("Couldn't read the music file: " + r.stderr.decode(errors="ignore")[-200:])
    return x

def features(x):
    n = 1 + (len(x) - NF) // HOP
    idx = np.arange(NF)[None, :] + HOP * np.arange(n)[:, None]
    S = np.abs(np.fft.rfft(x[idx] * np.hanning(NF), axis=1)).astype(np.float32)
    edges = np.unique(np.round(np.geomspace(2, S.shape[1] - 1, 49)).astype(int))   # ~48 log-spaced bands
    B = np.add.reduceat(S, edges, axis=1)[:, :-1]
    L = np.log1p(B * 10)
    flux = np.maximum(0, np.diff(L, axis=0, prepend=L[:1])).sum(1)
    rms = 20 * np.log10(np.sqrt((x[idx] ** 2).mean(1)) + 1e-9)
    F = L - L.mean(1, keepdims=True); F /= np.linalg.norm(F, axis=1, keepdims=True) + 1e-9
    return F, flux / (flux.max() + 1e-9), rms

def best_jump(F, flux, D, lo, hi, W):
    """frame t (cut point) maximizing how alike the music is around t and t+D (window W frames each side)."""
    T = len(F); a0 = max(lo, W, -D + W); a1 = min(hi, T - W - 1, T - D - W - 1)
    if a1 <= a0: return None, -1
    t = np.arange(a0 - W, a1 + W + 1)
    p = (F[t] * F[t + D]).sum(1)                       # per-frame likeness
    c = np.concatenate([[0], np.cumsum(p)])
    win = (c[2 * W + 1:] - c[:-2 * W - 1]) / (2 * W + 1)  # mean over the window centred on each candidate
    cand = np.arange(a0, a1 + 1)
    score = win[:len(cand)] + 0.08 * flux[cand] + 0.08 * flux[np.clip(cand + D, 0, T - 1)]   # cutting on a beat hides the cut
    i = int(np.argmax(score)); return int(cand[i]), float(score[i])

def main():
    J = json.loads(sys.stdin.buffer.readline().decode("utf-8"))
    x = load(J.get("ffmpeg") or "ffmpeg", J["path"]); F, flux, rms = features(x); T = len(F); fps = SR / HOP
    loud = np.where(rms > rms.max() - 45)[0]; end_f = int(loud[-1]) + 1 if len(loud) else T   # where the music really ends (not trailing silence)
    song_end = min(len(x) / SR, end_f / fps + 0.15)
    a_in = float(J.get("in", 0)); want = float(J["len"]); have = song_end - a_in
    if abs(have - want) < 1 / fps: return say(ev="music", pieces=[[a_in, a_in + want]], end=song_end, score=1.0)
    # the jump is a whole number of beats, so the rhythm never stumbles; the leftover (< half a beat) comes off the start
    ac = np.correlate(flux - flux.mean(), flux - flux.mean(), "full")[T - 1:]; lo_, hi_ = int(0.3 * fps), int(1.2 * fps)
    beat = lo_ + int(np.argmax(ac[lo_:hi_])) if T > hi_ + 1 else 1
    if J.get("bar", 1): bar = beat * 4 if ac[min(beat * 4, len(ac) - 1)] > 0.5 * ac[beat] else beat
    else: bar = beat
    D = int(np.floor((have - want) * fps / bar)) * bar   # >0 skip, <0 play again; never more than needed, the rest comes off the start
    keep_head = int((a_in + 4) * fps); keep_tail = end_f - int(6 * fps)
    pieces = []; cur = a_in; jumps = []; left = D; guard = 0
    while left != 0 and guard < 8:
        guard += 1; step = left
        if step < 0: step = max(step, -(keep_tail - keep_head - int(4 * fps)))   # one repeat can't be longer than the song itself
        best = (None, -9, step, 0)
        for k in range(0, 9 if (not jumps and step > 0) else 1):   # shortening: also try jumping k bars less and starting the song a little later (up to ~4 s)
            sk = step - k * bar
            if k and (k * bar > min(4 * fps, 0.3 * (keep_tail - keep_head)) or (step > 0 and sk <= 0)): break
            t_, sc_ = best_jump(F, flux, sk, max(keep_head + k * bar, int(cur * fps) + int(2 * fps) + k * bar), keep_tail - max(sk, 0), int(2 * fps))
            if t_ is not None and sc_ - 0.03 * k > best[1]: best = (t_, sc_ - 0.03 * k, sk, k)
        t, sc, step, kk = best
        if kk: cur += kk * bar / fps; left -= kk * bar
        if t is None: break
        jumps.append((t, t + step, sc)); pieces.append([cur, t / fps]); cur = (t + step) / fps; left -= step
    if left != 0:   # couldn't place it all (very short music / very short target): trim the start instead
        cur_len = sum(b - a for a, b in pieces) + (song_end - cur)
        pieces = pieces or []; extra = cur_len - want
        if pieces: pieces[0][0] = min(pieces[0][1] - 1, pieces[0][0] + extra)
        else: cur = min(song_end - 1, cur + extra)
    pieces.append([cur, song_end])
    tot = sum(b - a for a, b in pieces)
    if tot > want + 1e-3: pieces[-1][1] -= 0  # the real ending is kept; any rounding is absorbed at the start
    if abs(tot - want) > 1e-3: pieces[0][0] = max(0.0, pieces[0][0] + tot - want)
    say(ev="music", pieces=[[round(a, 4), round(b, 4)] for a, b in pieces], end=round(song_end, 3), score=round(min(s for *_, s in jumps), 3) if jumps else 1.0, jumps=len(jumps), beat=round(beat / fps, 3))

try: main()
except Exception as e: say(ev="error", msg=str(e))
