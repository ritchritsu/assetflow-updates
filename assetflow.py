#!/usr/bin/env python3
_t='medium'
_s='segments'
_r='srt_path'
_q='No speech detected in the file.'
_p='beam_size'
_o='duration'
_n='format'
_m='-show_format'
_l='-print_format'
_k='ffprobe'
_j='float16'
_i='version'
_h='Bossa Nova'
_g='electronic'
_f='device'
_e='text'
_d='end'
_c='start'
_b='utf-8'
_a='theme_top'
_Z=False
_Y='unknown'
_X='embeddings'
_W='genre_buckets'
_V='score'
_U='mood_theme'
_T='language'
_S='danceability'
_R='mood_electronic'
_Q='mood_aggressive'
_P='mood_party'
_O='mood_relaxed'
_N='mood_sad'
_M='mood_happy'
_L='path'
_K='genre'
_J='mood_acoustic'
_I='status'
_H='progress'
_G='voice_instrumental'
_F='bpm'
_E='url'
_D='file'
_C='error'
_B=None
_A=True
import os,sys,json,time,argparse,urllib.request,hashlib,concurrent.futures,contextlib,shutil,tempfile,threading
_AF_THREADS=str(max(1,(os.cpu_count() or 4)//3))
for _af_v in('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','NUMEXPR_NUM_THREADS','TF_NUM_INTEROP_THREADS','TF_NUM_INTRAOP_THREADS'):
	os.environ.setdefault(_af_v,_AF_THREADS)
from pathlib import Path
AUDIO_EXTS={'.mp3','.wav','.flac','.ogg','.aiff','.aif','.m4a','.aac','.opus','.wma'}
SIDECAR_EXT='.af.json'
MODELS_DIR=Path(__file__).parent/'af_models'
MODEL_BASE='https://essentia.upf.edu/models'
MODELS={_F:{_E:f"{MODEL_BASE}/tempo/tempocnn/deepsquare-k16-3.pb",_D:'tempocnn-deepsquare-k16.pb'},_X:{_E:f"{MODEL_BASE}/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb",_D:'discogs-effnet-bs64.pb'},_M:{_E:f"{MODEL_BASE}/classifiers/mood_happy/mood_happy-discogs-effnet-1.pb",_D:'mood_happy.pb'},_N:{_E:f"{MODEL_BASE}/classifiers/mood_sad/mood_sad-discogs-effnet-1.pb",_D:'mood_sad.pb'},_O:{_E:f"{MODEL_BASE}/classifiers/mood_relaxed/mood_relaxed-discogs-effnet-1.pb",_D:'mood_relaxed.pb'},_P:{_E:f"{MODEL_BASE}/classifiers/mood_party/mood_party-discogs-effnet-1.pb",_D:'mood_party.pb'},_Q:{_E:f"{MODEL_BASE}/classifiers/mood_aggressive/mood_aggressive-discogs-effnet-1.pb",_D:'mood_aggressive.pb'},_U:{_E:f"{MODEL_BASE}/classifiers/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1.pb",_D:'mtg_jamendo_moodtheme.pb'},_K:{_E:f"{MODEL_BASE}/classifiers/genre_discogs400/genre_discogs400-discogs-effnet-1.pb",_D:'genre_discogs400.pb'},_G:{_E:f"{MODEL_BASE}/classifiers/voice_instrumental/voice_instrumental-discogs-effnet-1.pb",_D:'voice_instrumental.pb'},_J:{_E:f"{MODEL_BASE}/classifiers/mood_acoustic/mood_acoustic-discogs-effnet-1.pb",_D:'mood_acoustic.pb'},_R:{_E:f"{MODEL_BASE}/classifiers/mood_electronic/mood_electronic-discogs-effnet-1.pb",_D:'mood_electronic.pb'},_S:{_E:f"{MODEL_BASE}/classifiers/danceability/danceability-discogs-effnet-1.pb",_D:'danceability.pb'}}
JAMENDO_TAGS=['action','adventure','advertising','background','ballad','calm','children','christmas','commercial','cool','corporate','dark','deep','documentary','drama','dramatic','dream','emotional','energetic','epic','film','fun','funny','game','happy','heavy','holiday','hopeful','inspiring','love','meditative','melancholic','melodic','motivational','nature','party','positive','powerful','relaxing','retro','romantic','sad','sexy','slow','soft','solemn','soothing','space','sport','summer','trailer','travel','upbeat','uplifting','war','winter']
GENRE_BUCKETS={'orchestral':['Classical','Contemporary Classical','Orchestral','Baroque','Romantic','Impressionist','Neo-Classical','Neoclassical','Modern Classical','Chamber Music','Opera'],_g:['Electronic','IDM','Electroacoustic','Noise','Industrial','Techno','House','Trance','Drum n Bass','Jungle','Breakbeat','Electro','Synth-pop','EBM','Glitch','Dubstep','Future Bass','Chillwave','Vaporwave','Lo-fi'],'ambient':['Ambient','Dark Ambient','New Age','Drone','Space Music','Meditation','Atmospheric'],'chiptune':['Chiptune','Video Game Music','8-Bit','Game Boy'],'hip-hop':['Hip Hop','Hip-Hop','Rap','Trap','R&B','RnB','Soul','Funk','Boom Bap','Drill'],'jazz':['Jazz','Nu Jazz','Smooth Jazz','Acid Jazz',_h,'Swing','Big Band','Bebop','Fusion'],'rock':['Rock','Metal','Heavy Metal','Alternative Rock','Prog Rock','Post Rock','Shoegaze','Punk','Grunge','Indie Rock','Hard Rock','Classic Rock','Psych Rock'],'folk':['Folk','World','Celtic','Traditional','Country','Bluegrass','Singer-Songwriter'],'pop':['Pop','Indie Pop','Dream Pop','Art Pop','Synth Pop','K-Pop','J-Pop'],'cinematic':['Score','Soundtrack','Film','Trailer','Epic','Action','Adventure','Documentary'],'latin':['Latin','Salsa','Cumbia','Reggaeton','Flamenco',_h,'Samba','Tango'],'reggae':['Reggae','Dub','Ska','Dancehall'],'blues':['Blues','Delta Blues','Chicago Blues','Soul Blues']}
def _gpu_setup():
	"""Use an NVIDIA GPU when the CUDA 11 libraries (pip nvidia-*-cu11) are installed next to essentia; silently stay on CPU otherwise.
	Libraries are preloaded by full path so TensorFlow finds them without LD_LIBRARY_PATH tricks."""
	os.environ.setdefault('TF_FORCE_GPU_ALLOW_GROWTH','true')   # several workers share one GPU: never grab all VRAM
	os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','3')
	if os.environ.get('AF_GPU','1')=='0':os.environ['CUDA_VISIBLE_DEVICES']='';return _Z
	try:
		import ctypes,glob,site
		roots=[]
		for d in site.getsitepackages()+[site.getusersitepackages()]:
			if os.path.isdir(os.path.join(d,'nvidia')):roots.append(os.path.join(d,'nvidia'))
		if not roots:return _Z
		order=['cuda_runtime','cublas','cufft','curand','cusolver','cusparse','cuda_nvrtc','cudnn']
		n=0
		for R in roots:
			for o in order:
				for lib in sorted(glob.glob(os.path.join(R,o,'lib','lib*.so*'))):
					try:ctypes.CDLL(lib,mode=ctypes.RTLD_GLOBAL);n+=1
					except OSError:pass
		return n>0
	except Exception as E:print(f"    gpu setup skipped: {E}",file=sys.stderr);return _Z
def warm_models():
	"""Load every model once, right when the worker starts (in parallel with waiting for the first file)."""
	try:
		for k in MODELS:
			if(MODELS_DIR/MODELS[k][_D]).exists():load_model(k)
	except Exception as E:print(f"    warmup: {E}",file=sys.stderr)
def download_models(which=_B):
	B=which;MODELS_DIR.mkdir(exist_ok=_A);C={A:C for(A,C)in MODELS.items()if B is _B or A in B};D=len(C)
	for(E,(F,G))in enumerate(C.items(),1):
		A=MODELS_DIR/G[_D]
		if A.exists():print(f"  [{E}/{D}] ✓ {F} already downloaded");continue
		print(f"  [{E}/{D}] ↓ {F} …",end='',flush=_A)
		try:urllib.request.urlretrieve(G[_E],A);H=A.stat().st_size/1000000;print(f" {H:.1f} MB")
		except Exception as I:
			print(f" FAILED: {I}")
			if A.exists():A.unlink()
def model_path(key):return str(MODELS_DIR/MODELS[key][_D])
_models_ready_cache={}
def models_ready(keys):
	A=tuple(keys)
	if A not in _models_ready_cache:_models_ready_cache[A]=all((MODELS_DIR/MODELS[A][_D]).exists()for A in keys)
	return _models_ready_cache[A]
def invalidate_models_cache():_models_ready_cache.clear()
_loaded={}
_has_classifiers={}
def _get_has():
	global _has_classifiers
	if not _has_classifiers:_has_classifiers={A:models_ready([A])for A in[_M,_N,_O,_P,_Q,_J,_R,_S,_U,_K,_G]}
	return _has_classifiers
_load_lock=threading.RLock()
def load_model(key):
	with _load_lock:return _load_model(key)
def _load_model(key):
	E='CUDA_VISIBLE_DEVICES';A=key
	if A in _loaded:return _loaded[A]
	import essentia.standard as D;B=model_path(A)
	if not Path(B).exists():return
	if A==_F:C=D.TempoCNN(graphFilename=B)   # (hiding the GPU here used to switch the GPU off for the whole worker)
	elif A==_X:C=D.TensorflowPredictEffnetDiscogs(graphFilename=B,output='PartitionedCall:1',patchHopSize=128)
	else:
		try:C=D.TensorflowPredict2D(graphFilename=B,input='serving_default_model_Placeholder',output='PartitionedCall')
		except Exception:
			try:C=D.TensorflowPredict2D(graphFilename=B,output='model/Softmax')
			except Exception:C=D.TensorflowPredict2D(graphFilename=B,output='model/Sigmoid')
	_loaded[A]=C;return C
def analyze_bpm(audio_16k):
	try:
		B=load_model(_F)
		if B is _B:return _B,[]
		C,D,F=B(audio_16k);A=round(float(C))
		if A and A<60:A=A*2
		elif A and A>185:A=A//2
		if A<40 or A>220:A=_B
		return A,[round(float(A))for A in D]
	except Exception as E:print(f"    bpm error: {E}",file=sys.stderr);return _B,[]
def get_embeddings(audio_16k):
	try:
		A=load_model(_X)
		if A is _B:return
		return A(audio_16k)
	except Exception as B:print(f"    embeddings error: {B}",file=sys.stderr);return
def run_classifier(key,embeddings):
	A=embeddings
	try:
		B=load_model(key)
		if B is _B or A is _B:return
		import numpy as C;D=B(A);E=C.array(D);return C.median(E,axis=0).tolist()
	except Exception as F:print(f"    {key} error: {F}",file=sys.stderr);return
def analyze_mood_theme(embeddings,threshold=.06):
	B=run_classifier(_U,embeddings)
	if not B:return[]
	A=[]
	for(C,D)in enumerate(B):
		if C<len(JAMENDO_TAGS)and D>=threshold:A.append({'tag':JAMENDO_TAGS[C],_V:round(float(D),3)})
	A.sort(key=lambda x:-x[_V]);return A
_genre_labels=_B
def _load_genre_labels():
	global _genre_labels
	if _genre_labels is not _B:return _genre_labels
	A=MODELS_DIR/'genre_discogs400_labels.json'
	if not A.exists():
		B=f"{MODEL_BASE}/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json"
		try:urllib.request.urlretrieve(B,A)
		except Exception:pass
	if A.exists():
		try:
			with open(A)as C:D=json.load(C);_genre_labels=D.get('classes',[]);return _genre_labels
		except Exception:pass
	_genre_labels=[];return _genre_labels
def analyze_genre(embeddings,top_n=12,threshold=.08):
	C=run_classifier(_K,embeddings)
	if not C:return[],[]
	D=_load_genre_labels();A=[]
	for(B,E)in enumerate(C):
		if E>=threshold:I=D[B]if B<len(D)else f"genre_{B}";A.append({_K:I,_V:round(float(E),3)})
	A.sort(key=lambda x:-x[_V]);F=A[:top_n];G=set()
	for H in F:
		if H[_V]<.12:continue
		J=H[_K]
		for(K,L)in GENRE_BUCKETS.items():
			if any(A.lower()in J.lower()for A in L):G.add(K)
	return F,list(G)
def analyze_energy(audio):
	try:import essentia.standard as A;B=float(A.RMS()(audio));C=round(min(1.,B/.3),3);return{'energy_norm':C}
	except Exception as D:print(f"    energy error: {D}",file=sys.stderr);return{}
def analyze_key(audio_16k):
	try:
		import essentia.standard as D;A,B,C=D.KeyExtractor()(audio_16k)
		if A and B and C>.1:return{'key':A,'scale':B,'key_full':f"{A} {B}",'key_strength':round(float(C),3)}
		return{}
	except Exception as E:print(f"    key error: {E}",file=sys.stderr);return{}
@contextlib.contextmanager
def _MaybeLocalCopy(audio_path):
	A=Path(str(audio_path))
	if str(A).startswith('/mnt/'):
		C=A.suffix;B=tempfile.NamedTemporaryFile(suffix=C,prefix='af_',delete=_Z);B.close()
		try:shutil.copy2(str(A),B.name);yield Path(B.name)
		finally:
			try:os.unlink(B.name)
			except Exception:pass
	else:yield A
WIN_S=60.0   # seconds of audio analysed per file: a representative minute from the body of the track
def _ffmpeg():
	"""Native ffmpeg first; inside WSL fall back to the Windows ffmpeg.exe AssetFlow installs (WSL can run .exe files)."""
	for A in(shutil.which('ffmpeg'),os.environ.get('AF_FFMPEG'),shutil.which('ffmpeg.exe')):
		if A and os.path.exists(A):return A
LAST_WHY=['']
def _why(m):
	LAST_WHY[0]=m;print('    '+m,file=sys.stderr)
def _ff_duration(F,P):
	"""Duration via ffmpeg (works for files the Linux side can't see, e.g. Google Drive G:)."""
	try:
		import subprocess as sp,re
		r=sp.run([F,'-hide_banner','-nostdin','-i',_for_exe(F,P)],stdout=sp.PIPE,stderr=sp.PIPE,timeout=60,creationflags=0x08000000 if os.name=='nt' else 0)
		m=re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)',r.stderr.decode('utf-8','replace'))
		if m:return int(m.group(1))*3600+int(m.group(2))*60+float(m.group(3))
	except Exception:pass
def _for_exe(F,P):
	"""A Windows ffmpeg.exe needs a Windows path (C:\\...) instead of /mnt/c/... ; it then reads the file natively (much faster than WSL's file bridge)."""
	if F.lower().endswith('.exe')and P.startswith('/mnt/')and len(P)>6 and P[6]=='/':return P[5].upper()+':\\'+P[7:].replace('/','\\')
	return P
def _win_start(dur):
	"""Start of the analysis window: skip intros (30-35% in) but stay inside the file; short files use everything."""
	if not dur or dur<=WIN_S+5:return 0.
	return max(0.,min(dur*.33,dur-WIN_S-2))
def _load_window(path,d,q):
	"""Decode ONLY the minute we analyse. Old code decoded the whole file (hours for long soundtrack mixes) just to use 60 s."""
	P=str(path);dur=_B
	try:dur=float(d.MetadataReader(filename=P,failOnError=_A)()[8])
	except Exception:dur=_B
	F=_ffmpeg()
	if not dur and F:dur=_ff_duration(F,P)
	st=_win_start(dur)
	if F:
		import subprocess as sp
		for ss in((st,0.)if st>0 else(0.,)):   # try the middle window, then the start of the file
			try:
				r=sp.run([F,'-v','error','-nostdin','-ss',str(ss),'-t',str(WIN_S),'-i',_for_exe(F,P),'-vn','-ac','1','-ar','16000','-f','f32le','-'],stdout=sp.PIPE,stderr=sp.PIPE,timeout=180,creationflags=0x08000000 if os.name=='nt' else 0)
				if r.returncode==0 and len(r.stdout)>=64000:return q.frombuffer(r.stdout,dtype=q.float32).copy()
				_why('ffmpeg: '+(r.stderr.decode('utf-8','replace').strip().splitlines() or ['no audio decoded (%d bytes)'%len(r.stdout)])[-1][:160])
			except Exception as E:_why('ffmpeg: '+str(E)[:160])
	if not os.path.exists(P):_why((LAST_WHY[0]+' | ' if LAST_WHY[0] else '')+'file not visible to the analyzer (Google Drive / network drive?) and ffmpeg could not read it');return
	try:
		with _MaybeLocalCopy(path)as e:
			if dur and dur>900:   # long file and no ffmpeg: decoding to the middle would take ages, use the start
				return d.EasyLoader(filename=str(e),sampleRate=16000,startTime=0,endTime=min(dur,WIN_S+30))()[int(30*16000):] if dur>WIN_S+40 else d.EasyLoader(filename=str(e),sampleRate=16000)()
			G=d.MonoLoader(filename=str(e),sampleRate=16000,resampleQuality=1)()
		a=int(_win_start(len(G)/16000.)*16000);return G[a:a+int(WIN_S*16000)]
	except Exception as E:_why('load error: '+str(E)[:160]);return
def analyze_file(audio_path,args):
	T=audio_path;S='mood_mirex';R='__len__';J=args
	try:import essentia.standard as d,numpy as q
	except ImportError:print('ERROR: essentia not installed.');print('  Run:  /root/af_venv/bin/pip install essentia numpy');sys.exit(1)
	LAST_WHY[0]='';B={_i:5,'analyzed':int(time.time()),_L:str(T)}
	try:
		G=_load_window(T,d,q)
	except Exception as E:print(f"    load error: {E}",file=sys.stderr);return
	if G is _B:return
	if len(G)<16000:_why('too short (under 1 s of audio)');return
	K=G;g=not J.no_bpm and models_ready([_F]);V=not J.bpm_only and models_ready([_X]);h=getattr(J,'theme_threshold',.06);C=_get_has();A={};W=_B,[];L={};M={};N=_B
	try:L=analyze_energy(K)or{}
	except Exception as E:print(f"    energy error: {E}",file=sys.stderr)
	try:M=analyze_key(K)or{}
	except Exception as E:print(f"    key error: {E}",file=sys.stderr)
	if g:W=analyze_bpm(G)
	if V:
		try:N=get_embeddings(K)
		except Exception as E:print(f"    embeddings error: {E}",file=sys.stderr)
	if V and N is not _B:
		i=[(_M,lambda e:run_classifier(_M,e),C[_M]),(_N,lambda e:run_classifier(_N,e),C[_N]),(_O,lambda e:run_classifier(_O,e),C[_O]),(_P,lambda e:run_classifier(_P,e),C[_P]),(_Q,lambda e:run_classifier(_Q,e),C[_Q]),(_J,lambda e:run_classifier(_J,e),C[_J]),(_R,lambda e:run_classifier(_R,e),C[_R]),(_S,lambda e:run_classifier(_S,e),C[_S]),(_U,lambda e:analyze_mood_theme(e,threshold=h),C[_U]),(_K,lambda e:analyze_genre(e),C[_K]),(_G,lambda e:run_classifier(_G,e),C[_G])]
		for(O,j,k)in i:
			if not k:continue
			try:A[O]=j(N)
			except Exception as E:print(f"    {O} error: {E}",file=sys.stderr);A[O]=_B
	def l(key,idx=1):
		B=A.get(key)
		if B is not _B and hasattr(B,R)and len(B)>idx:return round(float(B[idx]),3)
	for(F,m)in[(_M,1),(_N,1),(_O,1),(_P,1),(_Q,1),(_R,1),(_S,1)]:
		if F in A:A[F]=l(F,m)
	if _J in A:D=A[_J];A[_J]=round(float(D[0]),3)if D is not _B and hasattr(D,R)and len(D)>0 else _B
	if _G in A:
		D=A[_G]
		if D is not _B and hasattr(D,R)and len(D)>=2:A[_G]={'vocal':round(float(D[1]),3),'instrumental':round(float(D[0]),3)}
		else:A[_G]=_B
	X,P=W
	if X:
		B[_F]=X
		if P:
			Y,Z=min(P),max(P)
			if Z-Y>10:B['bpm_variable']=_A;B['bpm_range']=[Y,Z]
	H={}
	for F in(_M,_N,_O,_P,_Q):
		I=A.get(F)
		if I is not _B:H[F.replace('mood_','')]=I
	for(n,o)in[('acoustic',_J),(_g,_R),('danceable',_S)]:
		I=A.get(o)
		if I is not _B:H[n]=I
	if S in A and A[S]:H['mirex']=A[S]
	if H:B['mood']=H
	Q=A.get(_U)
	if Q:B['theme_tags']=Q;B[_a]=[A['tag']for A in Q[:15]]
	a=A.get(_K)
	if a:
		b,p=a
		if b:B['genre_top']=b[:8];B[_W]=p
	c=A.get(_G)
	if c:B['instrumentation']=c
	if L:B['energy']=L
	if M:B['key']=M
	return B
def sidecar_path(audio_path):return Path(str(audio_path)+SIDECAR_EXT)
def needs_analysis(audio_path,force=_Z):
	C=audio_path;A=sidecar_path(C)
	if force or not A.exists():return _A
	try:
		with open(A)as D:B=json.load(D)
		if B.get(_i,0)<5:return _A
		if not B.get('mood'):return _A
		if not B.get(_F):return _A
		E=C.stat().st_mtime;F=A.stat().st_mtime;return E>F
	except Exception:return _A
def write_sidecar(audio_path,data):
	A=sidecar_path(audio_path)
	try:
		with open(A,'w',encoding=_b)as B:json.dump(data,B,separators=(',',':'))
	except Exception as C:print(f"    write error: {C}")
_worker_args=_B
def _worker_init(args):global _worker_args;_worker_args=args
def _process_one(fp):
	A=fp
	try:
		B=analyze_file(A,_worker_args)
		if B:write_sidecar(A,B);return str(A),B,_B
		return str(A),_B,_B
	except Exception as C:return str(A),_B,str(C)
def main():
	a=' | ';Z='skip';Y='no_bpm';J='store_true';D=argparse.ArgumentParser(description='AssetFlow offline audio analyzer — writes .af.json sidecars');D.add_argument('root',nargs='?',help='Root folder to scan (e.g. "D:/EDITING STUFF/ASSETS/MUSIC")');D.add_argument('--download-models',action=J,help='Download all models then exit');D.add_argument('--force',action=J,help='Re-analyze all files even if sidecar exists');D.add_argument('--bpm-only',action=J,help='Only run BPM detection (re-uses existing sidecars for all other tags)');D.add_argument('--bpm',dest=Y,action='store_false',default=_A,help='Enable BPM analysis (TempoCNN, adds 3–8s/file; off by default)');D.add_argument('--no-bpm',dest=Y,action=J,help='Skip BPM detection (default — run a --bpm-only pass separately)');D.add_argument('--theme-threshold',type=float,default=.06,help='Min score for MTG-Jamendo theme tags (default 0.06)');D.add_argument('--workers',type=int,default=2,help='Parallel workers (default 2; models are loaded per-process)');D.add_argument('--json-stdout',action=J,help='Output each result as a JSON line to stdout (no sidecar write; JS side writes it)');D.add_argument('--stdin-paths',action=J,help='Read file paths from stdin (one per line) instead of scanning a folder');D.add_argument('--models-dir',help='Override af_models directory path');B=D.parse_args()
	if B.models_dir:global MODELS_DIR;MODELS_DIR=Path(B.models_dir)
	if B.stdin_paths:
		import sys as T;U=[A for(A,B)in MODELS.items()if A in(_F,_X)and not(MODELS_DIR/B[_D]).exists()]   # only BPM + embeddings are required; missing classifiers are just skipped
		if U:
			print(json.dumps({_L:'__init__',_C:'Missing models: '+', '.join(U)}),flush=_A)
			for L in T.stdin:
				M=L.strip()
				if M:print(json.dumps({_L:M,_C:'models not ready'}),flush=_A)
			return
		_gpu_setup();_wt=threading.Thread(target=warm_models,daemon=_A);_wt.start()
		V=180
		class W(Exception):0
		def b(fp,args):
			C=[_B];A=[_B]
			def D():
				try:C[0]=analyze_file(fp,args)
				except Exception as B:A[0]=B
			B=threading.Thread(target=D,daemon=_A);B.start();B.join(V)
			if B.is_alive():raise W('analysis timed out after {}s'.format(V))
			if A[0]is not _B:raise A[0]
			return C[0]
		for L in T.stdin:
			A=Path(L.strip())
			if A.suffix.lower()not in AUDIO_EXTS or not(A.exists()or(_ffmpeg()and str(A).startswith('/mnt/'))):
				if L.strip():print(json.dumps({_L:str(A),_C:Z+': '+('not an audio file type' if A.suffix.lower()not in AUDIO_EXTS else 'file not found by the analyzer')}),flush=_A)
				continue
			try:
				C=b(A,B)
				if C:
					if B.json_stdout:print(json.dumps(C,separators=(',',':')),flush=_A)
					else:write_sidecar(A,C)
				else:print(json.dumps({_L:str(A),_C:Z+(': '+LAST_WHY[0] if LAST_WHY[0] else '')}),flush=_A)
			except W as F:print(f"    TIMEOUT on {A.name}: {F}",file=sys.stderr);G={_L:str(A),_C:str(F)};print(json.dumps(G),flush=_A)
			except Exception as F:G={_L:str(A),_C:str(F)};print(json.dumps(G),flush=_A)
		return
	if B.json_stdout and B.root and Path(B.root).is_file():
		A=Path(B.root)
		try:
			C=analyze_file(A,B)
			if C:print(json.dumps(C,separators=(',',':')),flush=_A)
		except Exception as F:G={_L:str(A),_C:str(F)};print(json.dumps(G),flush=_A)
		return
	if B.download_models:print('Downloading models to:',MODELS_DIR);MODELS_DIR.mkdir(exist_ok=_A);download_models();print('\nAll models ready. Run the analyzer with your music folder path.');return
	if not B.root:D.print_help();return
	H=Path(B.root)
	if not H.exists():print(f"ERROR: folder not found: {H}");sys.exit(1)
	R=[A for(A,B)in MODELS.items()if not(MODELS_DIR/B[_D]).exists()]
	if R:
		print(f"Missing models: {R}");print('Run:  python analyze_library.py --download-models')
		if B.bpm_only and _F not in R:0
		elif not B.bpm_only:print('Or run with --bpm-only to use only the BPM model.');sys.exit(1)
	N=[]
	for(c,l,d)in os.walk(H):
		for e in d:
			A=Path(c)/e
			if A.suffix.lower()in AUDIO_EXTS:N.append(A)
	E=[A for A in N if needs_analysis(A,B.force)];f=len(N)-len(E);print(f"\nAssetFlow Library Analyzer");print(f"  Root:      {H}");print(f"  Found:     {len(N)} audio files");print(f"  Skipped:   {f} (already analyzed)");print(f"  To analyze:{len(E)}");print(f"  Models:    {MODELS_DIR}");print()
	if not E:print('Nothing to do — all files already analyzed.');return
	g=time.time();O=0;S=0;P=len(str(len(E)))
	if B.workers>1 and len(E)>4:
		import multiprocessing as h;i=h.get_context('spawn');print(f"  Running {B.workers} parallel workers...")
		with i.Pool(processes=B.workers,initializer=_worker_init,initargs=(B,))as j:
			for(K,(M,C,G))in enumerate(j.imap_unordered(_process_one,E),1):
				A=Path(M);X=A.relative_to(H)if A.is_relative_to(H)else A
				if G:print(f"  [{K:{P}d}/{len(E)}] ERROR {A.name}: {G}");S+=1
				elif C:
					I=[]
					if _F in C:I.append(f"BPM={C[_F]}")
					if _W in C:I.append('/'.join(C[_W][:2]))
					print(f"  [{K:{P}d}/{len(E)}] ✓ {A.name}  {a.join(I)}");O+=1
				else:print(f"  [{K:{P}d}/{len(E)}] skip {A.name}")
	else:
		for(K,A)in enumerate(E,1):
			X=A.relative_to(H)if A.is_relative_to(H)else A;print(f"  [{K:{P}d}/{len(E)}] {X}",end='  ',flush=_A);k=time.time()
			try:
				C=analyze_file(A,B)
				if C:
					write_sidecar(A,C);Q=time.time()-k;I=[]
					if _F in C:I.append(f"BPM={C[_F]}")
					if _a in C:I.append(', '.join(C[_a][:3]))
					if _W in C:I.append('/'.join(C[_W][:2]))
					print(f"✓ {a.join(I)} ({Q:.1f}s)");O+=1
				else:print('skip (too short or load failed)')
			except Exception as F:print(f"ERROR: {F}");S+=1
	Q=time.time()-g;print();print(f"Done. {O} analyzed, {S} errors, {Q:.0f}s total");print(f"Avg:  {Q/max(O,1):.1f}s per file");print();print('Re-scan your library in AssetFlow to pick up the new tags.')
if __name__=='__main__':main()