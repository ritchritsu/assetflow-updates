/* AssetFlow: modern folder picker.
   Windows: the real Explorer-style "Select Folder" dialog (IFileOpenDialog + FOS_PICKFOLDERS) via PowerShell,
   owned by the Premiere window so it opens on top. macOS: the native "choose folder" sheet.
   Falls back to CEP's built-in dialog if anything goes wrong, so a folder can always be picked.
   Usage: afPickFolder(title, startFolder, function (pathOrEmpty) { ... }) */
(function () {
  var CS = [
    'using System;using System.Runtime.InteropServices;',
    'public static class AFPick{',
    ' [ComImport,Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FOD{}',
    ' [ComImport,Guid("42f85136-db7e-439c-85f1-e4075d135fc8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    ' interface IFileOpenDialog{',
    '  [PreserveSig]int Show(IntPtr parent);',
    '  void SetFileTypes(uint c,IntPtr f);void SetFileTypeIndex(uint i);void GetFileTypeIndex(out uint i);',
    '  void Advise(IntPtr p,out uint c);void Unadvise(uint c);void SetOptions(uint fos);void GetOptions(out uint fos);',
    '  void SetDefaultFolder(IShellItem si);void SetFolder(IShellItem si);void GetFolder(out IShellItem si);void GetCurrentSelection(out IShellItem si);',
    '  void SetFileName([MarshalAs(UnmanagedType.LPWStr)]string n);void GetFileName([MarshalAs(UnmanagedType.LPWStr)]out string n);',
    '  void SetTitle([MarshalAs(UnmanagedType.LPWStr)]string t);void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)]string t);',
    '  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)]string t);void GetResult(out IShellItem si);void AddPlace(IShellItem si,int a);',
    '  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)]string e);void Close(int hr);void SetClientGuid(ref Guid g);void ClearClientData();',
    '  void SetFilter(IntPtr f);void GetResults(out IntPtr r);void GetSelectedItems(out IntPtr r);}',
    ' [ComImport,Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    ' interface IShellItem{void BindToHandler(IntPtr pbc,ref Guid bhid,ref Guid riid,out IntPtr ppv);void GetParent(out IShellItem si);',
    '  void GetDisplayName(uint sigdn,[MarshalAs(UnmanagedType.LPWStr)]out string name);void GetAttributes(uint m,out uint a);void Compare(IShellItem si,uint h,out int o);}',
    ' [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=false)]',
    ' static extern void SHCreateItemFromParsingName(string p,IntPtr pbc,[MarshalAs(UnmanagedType.LPStruct)]Guid riid,out IShellItem si);',
    ' [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();',
    ' public static string Pick(string title,string init){',
    '  IFileOpenDialog d=(IFileOpenDialog)new FOD();uint o;d.GetOptions(out o);d.SetOptions(o|0x20|0x40|0x800);',
    '  if(!String.IsNullOrEmpty(title))d.SetTitle(title);',
    '  d.SetOkButtonLabel("Select Folder");',
    '  if(!String.IsNullOrEmpty(init)&&System.IO.Directory.Exists(init)){try{IShellItem f;SHCreateItemFromParsingName(init,IntPtr.Zero,typeof(IShellItem).GUID,out f);d.SetFolder(f);}catch{}}',
    '  if(d.Show(GetForegroundWindow())!=0)return "";',
    '  IShellItem r;d.GetResult(out r);string p;r.GetDisplayName(0x80058000,out p);return p;}}'
  ].join('\n');

  function psEscape(s) { return String(s || '').replace(/'/g, "''"); }

  function windowsPick(title, start, cb) {
    var cp = require('child_process');
    // compiled once into %TEMP% so later pickers open instantly
    var ps = [
      '$ErrorActionPreference="Stop";[Console]::OutputEncoding=[Text.Encoding]::UTF8',
      "$cs=@'\n" + CS + "\n'@",
      '$dll=Join-Path $env:TEMP "af_pickfolder_v1.dll"',
      'try{ if(Test-Path $dll){ Add-Type -Path $dll } else { Add-Type -TypeDefinition $cs -OutputAssembly $dll; Add-Type -Path $dll } }',
      'catch{ try{ Remove-Item $dll -ErrorAction SilentlyContinue }catch{}; Add-Type -TypeDefinition $cs }',
      "try{ $p=[AFPick]::Pick('" + psEscape(title) + "','" + psEscape(start) + "'); Write-Output ('OK:'+$p) }catch{ Write-Output ('ERR:'+$_.Exception.Message); exit 2 }"
    ].join('\n');
    var enc = Buffer.from(ps, 'utf16le').toString('base64');
    cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, maxBuffer: 1 << 20 }, function (err, out) {
        var m = /OK:(.*)/.exec(String(out || ''));
        if (m) return cb(m[1].trim());          // '' = cancelled
        cb(null);                                // failed: caller falls back
      });
  }

  function macPick(title, cb) {
    require('child_process').execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "' + String(title || 'Choose a folder').replace(/"/g, '') + '")'],
      function (err, out) { cb(err ? '' : String(out || '').trim().replace(/\/$/, '')); });
  }

  function cepPick(title, start, cb) {
    try {
      var f = cep.fs.showOpenDialogEx || cep.fs.showOpenDialog;
      var r = f.call(cep.fs, false, true, title || 'Choose a folder', start || '', []);
      cb(r && !r.err && r.data && r.data[0] ? r.data[0] : '');
    } catch (e) { cb(''); }
  }

  var busy = false;
  window.afPickFolder = function (title, start, cb) {
    if (busy) return;                       // one dialog at a time (double-clicks)
    busy = true;
    var done = function (p) { busy = false; try { cb(p || ''); } catch (e) {} };
    try {
      if (typeof require === 'function') {
        var plat = require('process').platform;
        if (plat === 'win32') return windowsPick(title, start, function (p) { p === null ? cepPick(title, start, done) : done(p); });
        if (plat === 'darwin') return macPick(title, done);
      }
    } catch (e) {}
    cepPick(title, start, done);
  };
})();
