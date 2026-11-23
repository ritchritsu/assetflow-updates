"""Download + extract the Orukeet sherpa-onnx INT8 model into %LOCALAPPDATA%\\WordCut\\models\\orukeet (one time, ~490 MB)."""
import os, sys, tarfile, hashlib, urllib.request
dst = os.path.join(os.environ["LOCALAPPDATA"], "WordCut", "models"); os.makedirs(dst, exist_ok=True)
final = os.path.join(dst, "orukeet")
if os.path.exists(os.path.join(final, "encoder.int8.onnx")): print("ORUKEET_READY", final); sys.exit(0)
url = "https://huggingface.co/oruk/orukeet/resolve/main/onnx/sherpa-onnx-orukeet-v0.1.0-int8.tar.bz2"
arc = os.path.join(dst, "orukeet.tar.bz2")
if not os.path.exists(arc) or os.path.getsize(arc) != 486807585:
    print("Downloading Orukeet (~487 MB)...", flush=True)
    def hook(b, bs, t):
        if b % 400 == 0: print("  %d%%" % min(100, b * bs * 100 // max(t, 1)), flush=True)
    urllib.request.urlretrieve(url, arc, hook)
h = hashlib.sha256(open(arc, "rb").read()).hexdigest()
if h != "f9191f30178cc9122ce2f023bf9fefafc822028307b0efa4caff645ba3fe8d0a": print("CHECKSUM_FAILED", h); sys.exit(1)
print("Extracting...", flush=True)
with tarfile.open(arc, "r:bz2") as t: t.extractall(dst, filter="data")
src = os.path.join(dst, "sherpa-onnx-orukeet-v0.1.0-int8")
if os.path.exists(final): import shutil; shutil.rmtree(final)
os.rename(src, final); os.remove(arc); print("ORUKEET_READY", final)
