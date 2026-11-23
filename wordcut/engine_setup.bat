@echo off
title WordCut AI engine setup
setlocal EnableDelayedExpansion
set LOG=%LOCALAPPDATA%\WordCut\install_log.txt
if not exist "%LOCALAPPDATA%\WordCut" mkdir "%LOCALAPPDATA%\WordCut"
echo === WordCut engine setup %date% %time% === >> "%LOG%"
echo.
echo  WordCut AI engine setup (one time, about 2.5 GB download)
echo  Keep this window open. If your internet drops, it retries by itself.
echo  ---------------------------------------------------------
set UV=%USERPROFILE%\.local\bin\uv.exe

echo  [1/5] Python manager...
for /L %%i in (1,1,3) do (
  if not exist "%UV%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex" >> "%LOG%" 2>&1
  )
  if not exist "%UV%" (
    rem PowerShell blocked on company PCs or by antivirus - download the uv zip with Windows built-in curl and tar
    mkdir "%USERPROFILE%\.local\bin" 2>nul
    curl.exe -L --retry 3 -o "%TEMP%\wc_uv.zip" https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip >> "%LOG%" 2>&1
    tar -xf "%TEMP%\wc_uv.zip" -C "%USERPROFILE%\.local\bin" >> "%LOG%" 2>&1
  )
  if not exist "%UV%" timeout /t 5 >nul
)
if not exist "%UV%" (echo  ERROR: could not download the Python manager - check internet / antivirus & echo SETUP_FAILED_UV >> "%LOG%" & goto :fail)

set VENV=%LOCALAPPDATA%\WordCut\venv
rem Keep uv's Python inside our own folder: the default Roaming\uv\python uses a junction link that
rem OneDrive, roaming profiles and some security tools block - os error 448 untrusted mount point.
set UV_PYTHON_INSTALL_DIR=%LOCALAPPDATA%\WordCut\python
set UV_CACHE_DIR=%LOCALAPPDATA%\WordCut\uv-cache
set UV_PYTHON_PREFERENCE=only-managed
set PY=%VENV%\Scripts\python.exe
echo  [2/5] Python 3.11 runtime...
rem a broken runtime from an earlier attempt is thrown away and rebuilt
if exist "%PY%" "%PY%" -c "import sys" >nul 2>&1 || if exist "%VENV%" rmdir /s /q "%VENV%"
for /L %%i in (1,1,3) do if not exist "%PY%" (
  "%UV%" python install 3.11 >> "%LOG%" 2>&1
  set REALPY=
  for /d %%d in ("%UV_PYTHON_INSTALL_DIR%\cpython-3.11.*-windows-x86_64-none") do if exist "%%d\python.exe" set "REALPY=%%d\python.exe"
  rem Python's own venv, NOT uv venv: uv points the venv at a version-link folder that some PCs block - os error 448
  if defined REALPY ("!REALPY!" -m venv "%VENV%" >> "%LOG%" 2>&1) else ("%UV%" venv --python 3.11 "%VENV%" >> "%LOG%" 2>&1)
  if exist "%PY%" ("%PY%" -c "print(1)" >nul 2>&1 || (echo venv python does not start - recreating >> "%LOG%" & rmdir /s /q "%VENV%"))
  if not exist "%PY%" timeout /t 5 >nul
)
if not exist "%PY%" (echo  ERROR: could not create the Python runtime & echo SETUP_FAILED_VENV >> "%LOG%" & goto :fail)

echo  [3/5] Speech engine (~2 GB, the longest step - download bars show below)...
set UV_HTTP_TIMEOUT=300
set OK=
for /L %%i in (1,1,4) do if not defined OK (
  "%UV%" pip install --python "%PY%" "onnx-asr[hub]" "onnxruntime-gpu[cuda,cudnn]>=1.21" numpy && set OK=1
  if not defined OK echo pip attempt %%i failed >> "%LOG%"
  if not defined OK (echo    download interrupted - retrying [%%i/4]... & timeout /t 10 >nul)
)
"%PY%" -c "import onnx_asr, onnxruntime" >> "%LOG%" 2>&1 || (echo  ERROR: speech engine did not install & echo SETUP_FAILED_PIP >> "%LOG%" & goto :fail)

echo  [4/5] Parakeet speech model (~650 MB)...
set OK=
for /L %%i in (1,1,4) do if not defined OK (
  "%PY%" -c "import onnx_asr; onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v3'); print('MODEL_OK')" > "%TEMP%\wc_model_ok.txt"
  findstr /C:"MODEL_OK" "%TEMP%\wc_model_ok.txt" >nul && set OK=1
  if not defined OK (echo    download interrupted - retrying [%%i/4]... & timeout /t 10 >nul)
)
if not defined OK (echo  ERROR: speech model did not download & echo SETUP_FAILED_MODEL >> "%LOG%" & goto :fail)

echo  [5/5] Voice detector...
"%PY%" -c "import onnx_asr; onnx_asr.load_vad('silero', providers=['CPUExecutionProvider']); print('VAD_OK')" > "%TEMP%\wc_vad_ok.txt" 2>> "%LOG%"
findstr /C:"VAD_OK" "%TEMP%\wc_vad_ok.txt" >nul || echo  (voice detector will download on first use instead)
echo INSTALL_OK >> "%LOG%"
echo.
echo  Done! Open Premiere Pro, then Window ^> Extensions ^> WordCut.
timeout /t 4 >nul
exit /b 0
:fail
echo.
echo  Setup could not finish. Details: %LOG%
timeout /t 8 >nul
exit /b 1
