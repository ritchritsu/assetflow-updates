// host.jsx v7 — AssetFlow ExtendScript bridge
// Runs inside Premiere Pro / After Effects (Windows + Mac)
//
// v7: File-copy installs moved entirely to Node.js in index.html.
//     JSX now only handles things that need Adobe host APIs.
//     Removed: installMogrt, installPPROPreset, installKeyboardShortcuts,
//              _getAEPresetDir, _getMogrtDir, _getKYSDir, importLUT, LUT helpers.
//     installAEPreset: now ONLY applies preset to selected layer (applyPreset).
//       Returns no_selection error → Node falls back to copying to User Presets.
//
// v6 (carried forward):
//   - Path separator bug fixed (single backslash, not double)
//   - AE folder support on import (Images, Music, etc.)
//   - revealInExplorer() works on Mac (selects file in Finder)
//   - importToTimeline() uses importedItem lookup by path, not array position

// ── JSON polyfill (some Adobe hosts lack native JSON) ────────────
if (typeof JSON === 'undefined') {
    JSON = {
        stringify: function(value) {
            function esc(str) {
                return String(str)
                    .replace(/\\/g, '\\\\')
                    .replace(/"/g, '\\"')
                    .replace(/\r/g, '\\r')
                    .replace(/\n/g, '\\n')
                    .replace(/\t/g, '\\t');
            }
            function ser(v) {
                var t = typeof v;
                if (v === null) return 'null';
                if (t === 'string') return '"' + esc(v) + '"';
                if (t === 'number') return isFinite(v) ? String(v) : 'null';
                if (t === 'boolean') return v ? 'true' : 'false';
                if (t === 'undefined' || t === 'function') return 'null';
                if (v instanceof Array) {
                    var a = [];
                    for (var i = 0; i < v.length; i++) a.push(ser(v[i]));
                    return '[' + a.join(',') + ']';
                }
                var parts = [];
                for (var k in v) {
                    if (v.hasOwnProperty(k) && typeof v[k] !== 'function' && typeof v[k] !== 'undefined') {
                        parts.push('"' + esc(k) + '":' + ser(v[k]));
                    }
                }
                return '{' + parts.join(',') + '}';
            }
            return ser(value);
        },
        parse: function(text) {
            return eval('(' + text + ')');
        }
    };
}

var AssetFlowHost = {

    // ── Platform detection ─────────────────────────────────────
    isMac: function() {
        try {
            return $.os.indexOf('Mac') !== -1 || $.os.indexOf('darwin') !== -1;
        } catch(e) { return false; }
    },

    // ── App detection ──────────────────────────────────────────
    getHostApp: function() {
        try {
            if (typeof app !== 'undefined') {
                var appName = '';
                try { appName = (app.name || '').toString().toLowerCase(); } catch (_e1) {}

                if (appName.indexOf('premiere') !== -1) return 'PPRO';
                if (appName.indexOf('after effects') !== -1) return 'AEFT';
                if (appName.indexOf('aftereffects') !== -1) return 'AEFT';

                // Capability-based fallback (works when app.name is localized)
                if (app.project && typeof app.project.importFiles === 'function') return 'PPRO';
                if (typeof ImportOptions !== 'undefined' && app.project && typeof app.project.importFile === 'function') return 'AEFT';
            }
        } catch(e) {}
        return 'UNKNOWN';
    },

    getAppName: function() { return this.getHostApp(); },

    debugHostInfo: function() {
        try {
            var appName = '', appVersion = '';
            var hasProject = false, hasImportFiles = false, hasImportFile = false, hasImportOptions = false;
            if (typeof app !== 'undefined') {
                try { appName    = (app.name    || '').toString(); } catch (_e1) {}
                try { appVersion = (app.version || '').toString(); } catch (_e2) {}
                try { hasProject     = !!app.project; } catch (_e3) {}
                try { hasImportFiles = !!(app.project && typeof app.project.importFiles === 'function'); } catch (_e4) {}
                try { hasImportFile  = !!(app.project && typeof app.project.importFile  === 'function'); } catch (_e5) {}
            }
            try { hasImportOptions = (typeof ImportOptions !== 'undefined'); } catch (_e6) {}
            return JSON.stringify({
                ok: true,
                detectedHost: this.getHostApp(),
                platform: this.isMac() ? 'mac' : 'win',
                appName: appName,
                appVersion: appVersion,
                hasProject: hasProject,
                hasImportFiles: hasImportFiles,
                hasImportFile: hasImportFile,
                hasImportOptions: hasImportOptions
            });
        } catch (e) {
            return JSON.stringify({ ok: false, error: e.toString() });
        }
    },

    // ── Path helpers ───────────────────────────────────────────
    // FIX: was replace(/\//g, '\\\\') which produced literal double-backslash strings
    _toNative: function(p) {
        if (this.isMac()) return p.replace(/\\/g, '/');
        return p.replace(/\//g, '\\');
    },

    _sep: function() {
        return this.isMac() ? '/' : '\\';
    },

    _join: function(a, b) {
        var sep = this._sep();
        return a.replace(/[\/\\]+$/, '') + sep + b;
    },

    // ── Recursive directory read ───────────────────────────────
    readDirectoryRecursive: function(dirPath) {
        try {
            var result = [];
            this._walkDir(new Folder(dirPath), result);
            return JSON.stringify({ success: true, files: result });
        } catch(e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    _walkDir: function(folder, result) {
        if (!folder.exists) return;
        var entries = folder.getFiles();
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry instanceof Folder) {
                this._walkDir(entry, result);
            } else if (entry instanceof File) {
                var modified = 0;
                try { modified = entry.modified && typeof entry.modified.getTime === 'function' ? entry.modified.getTime() : 0; } catch(_e) {}
                result.push({ name: entry.name, path: entry.fsName, size: entry.length, mtime: modified });
            }
        }
    },

    // ── Bin name by category ───────────────────────────────────
    _binNameForCategory: function(category) {
        // Emoji written as \uXXXX escapes (UTF-16 surrogate pairs where needed)
        // so this is safe regardless of the .jsx file's saved encoding.
        var map = {
            'MUSIC': '\uD83C\uDFB5 Music', 'SFX': '\uD83D\uDD0A Sound FX', 'AUDIO': '\uD83C\uDFA7 Audio',
            'VIDEO': '\uD83C\uDFA5 Video', 'IMAGE': '\uD83D\uDDBC\uFE0F Images',
            'PPRO_PRESET': '\u2699\uFE0F Presets', 'AE_PRESET': '\u2699\uFE0F Presets',
            'MOGRT': '\uD83C\uDF9E Motion Graphics',
            'LUT': '\uD83C\uDFA8 LUTs', 'KEYBOARD': '\u2699\uFE0F Presets', 'FONT': '\uD83D\uDD24 Fonts', 'OTHER': '\uD83D\uDCC1 Other'
        };
        return map[category] || '\uD83D\uDCC1 Assets';
    },

    // ── Find or create a named bin under a given parent ────────
    _getOrCreateBin: function(binName, parentBin) {
        if (this.getHostApp() === 'AEFT') { return null; }
        try {
            var project = app.project;
            if (!project) return null;
            var parent = parentBin || project.rootItem;
            for (var i = 0; i < parent.children.numItems; i++) {
                var child = parent.children[i];
                if (child.name === binName && child.type === ProjectItemType.BIN) {
                    return child;
                }
            }
            return parent.createBin(binName);
        } catch(e) {
            return null;
        }
    },

    // AE-specific: find or create a folder in the project items
    _getOrCreateAEFolder: function(folderName) {
        try {
            var project = app.project;
            if (!project) return null;

            // Search existing folders
            for (var i = 1; i <= project.numItems; i++) {
                var item = project.items[i];
                if (item instanceof FolderItem && item.name === folderName) {
                    return item;
                }
            }

            // Create new folder
            return project.items.addFolder(folderName);
        } catch(e) {
            return null;
        }
    },

    // ── Import asset to project (main entry point) ─────────────
    importAssetToBin: function(filePath, category) {
        filePath = this._toNative(filePath);
        var host = this.getHostApp();

        if (host === 'PPRO') return this._importPremiereToBin(filePath, category || '');
        if (host === 'AEFT') return this._importAEToBin(filePath, category || '');
        return JSON.stringify({ success: false, error: 'Unsupported host: ' + host });
    },

    _importPremiereToBin: function(filePath, category) {
        try {
            var project = app.project;
            if (!project) return JSON.stringify({ success: false, error: 'No project open' });

            var binName   = category ? this._binNameForCategory(category) : '';
            var targetBin = binName ? this._getOrCreateBin(binName) : null;
            if (!targetBin) targetBin = project.rootItem;

            // already in this bin? reuse it instead of importing again (instant, no duplicates)
            var want = String(filePath).replace(/\//g, '\\').toLowerCase();
            try {
                for (var i = 0; i < targetBin.children.numItems; i++) {
                    var ch = targetBin.children[i], mp = '';
                    try { mp = ch.getMediaPath ? String(ch.getMediaPath()) : ''; } catch(_m) {}
                    if (mp && mp.replace(/\//g, '\\').toLowerCase() === want) {
                        try { ch.select(); } catch(_s) {}
                        return JSON.stringify({ success: true, bin: binName || 'Project', already: true });
                    }
                }
            } catch(_l) {}
            if (!new File(filePath).exists) return JSON.stringify({ success: false, error: 'File not found (moved or deleted?): ' + filePath });
            var ok = project.importFiles([filePath], true, targetBin, false);
            if (ok === false) return JSON.stringify({ success: false, error: 'Premiere could not import this file (unsupported or damaged?)' });
            return JSON.stringify({ success: true, bin: binName || 'All' });
        } catch(e) {
            return JSON.stringify({ success: false, error: 'Premiere import failed: ' + e.toString(), path: filePath, category: category || '' });
        }
    },

    // FIX: AE now imports into named folders (was always dumping to root)
    _importAEToBin: function(filePath, category) {
        try {
            var project = app.project;
            if (!project) return JSON.stringify({ success: false, error: 'No project open' });

            var importOptions = new ImportOptions(File(filePath));

            // Empty category = caller wants root placement, skip folder lookup entirely
            var targetFolder = null;
            var folderName   = '';
            if (category) {
                folderName   = this._binNameForCategory(category);
                targetFolder = folderName ? this._getOrCreateAEFolder(folderName) : null;
            }

            var item = project.importFile(importOptions);

            if (item && targetFolder) {
                try { item.parentFolder = targetFolder; } catch(_e) {}
            }

            return JSON.stringify({ success: true, bin: folderName || 'Project' });
        } catch(e) {
            return JSON.stringify({ success: false, error: 'After Effects import failed: ' + e.toString(), path: filePath, category: category || '' });
        }
    },

    // ── Import and insert into active Premiere timeline ────────
    importToTimeline: function(filePath) {
        filePath = this._toNative(filePath);
        // This function uses Premiere-only sequence/videoTracks/insertClip API
        if (this.getHostApp() === 'AEFT') {
            return JSON.stringify({ success: false, error: 'Add to Timeline is not available in After Effects. Use Import to Project instead.' });
        }
        try {
            var project = app.project;
            if (!project) return JSON.stringify({ success: false, error: 'No project open' });

            project.importFiles([filePath], true, project.rootItem, false);

            var sequence = project.activeSequence;
            if (!sequence) return JSON.stringify({ success: false, error: 'No active sequence. Open a sequence and try again.' });

            // FIX: find imported item by path match instead of assuming last index
            var importedItem = null;
            var rootItem = project.rootItem;
            for (var i = 0; i < rootItem.children.numItems; i++) {
                var child = rootItem.children[i];
                try {
                    if (child.getMediaPath && child.getMediaPath().replace(/\\/g,'/') === filePath.replace(/\\/g,'/')) {
                        importedItem = child;
                        break;
                    }
                } catch(_e) {}
            }
            // Fallback to last item if path match failed
            if (!importedItem) importedItem = rootItem.children[rootItem.children.numItems - 1];

            var playheadTime = sequence.getPlayerPosition();
            var ext = filePath.split('.').pop().toLowerCase();
            var audioExts = ['wav','mp3','aif','aiff','flac','m4a','aac','ogg'];

            if (audioExts.indexOf(ext) !== -1) {
                var audioTrack = sequence.audioTracks[0];
                if (audioTrack) audioTrack.insertClip(importedItem, playheadTime.seconds);
                else return JSON.stringify({ success: false, error: 'No audio track available in the active sequence.' });
            } else {
                var videoTrack = sequence.videoTracks[0];
                if (videoTrack) videoTrack.insertClip(importedItem, playheadTime.seconds);
                else return JSON.stringify({ success: false, error: 'No video track available in the active sequence.' });
            }

            return JSON.stringify({ success: true, note: 'Imported and inserted at playhead' });
        } catch(e) {
            return JSON.stringify({ success: false, error: 'Import to timeline failed: ' + e.toString(), path: filePath });
        }
    },

    // ── Apply font to selected text clip(s) — Premiere ────────
    applyFontInPremiere: function(fontPostScript) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return JSON.stringify({ success: false, error: 'No active sequence' });

            var applied = 0;
            var anySelected = false;
            var debugInfo = [];

            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var track = seq.videoTracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var clip = track.clips[c];
                    if (!clip.isSelected()) continue;
                    anySelected = true;

                    var isMGT = false;
                    try { isMGT = (typeof clip.isMGT === 'function' && clip.isMGT()); } catch(_e) {}
                    debugInfo.push('track=' + t + ' clip=' + c + ' isMGT=' + isMGT + ' name=' + clip.name);

                    // ── Path 1: Try getMGTComponent() on ALL clips ─────────
                    // Text tool clips in Premiere also have an MGT component
                    // but isMGT() returns false — call it unconditionally.
                    var mgtDone = false;
                    try {
                        var comp = clip.getMGTComponent();
                        if (comp && comp.properties && comp.properties.numItems > 0) {
                            var props = comp.properties;
                            for (var p = 0; p < props.numItems; p++) {
                                try {
                                    var param = props[p];
                                    var rawVal = param.getValue(1);
                                    if (typeof rawVal !== 'string' || rawVal === '') continue;
                                    var existingText = rawVal;
                                    try {
                                        var parsed = JSON.parse(rawVal);
                                        if (parsed && parsed.textEditValue !== undefined) existingText = parsed.textEditValue;
                                    } catch(_pe) {}
                                    var payload = JSON.stringify({
                                        fonteditinfo: {
                                            capPropFontEdit: true,
                                            capPropFontFauxStyleEdit: true,
                                            fontEditValue: fontPostScript
                                        },
                                        textEditValue: existingText
                                    });
                                    param.setValue(payload, 1);
                                    applied++;
                                    mgtDone = true;
                                } catch(_pe2) {}
                            }
                        }
                    } catch(_mgt) {
                        debugInfo.push('getMGTComponent err: ' + _mgt.toString());
                    }
                    if (mgtDone) continue;

                    // ── Path 2: projectItem video components ───────────────
                    try {
                        var pi = clip.projectItem;
                        if (pi && typeof pi.getVideoComponents === 'function') {
                            var vcs = pi.getVideoComponents();
                            if (vcs) {
                                for (var vi = 0; vi < vcs.numItems; vi++) {
                                    try {
                                        var vc = vcs[vi];
                                        if (vc && vc.properties) {
                                            for (var vp = 0; vp < vc.properties.numItems; vp++) {
                                                try {
                                                    var vprop = vc.properties[vp];
                                                    if (vprop && typeof vprop.setValue === 'function') {
                                                        vprop.setValue(fontPostScript, 1);
                                                        applied++;
                                                    }
                                                } catch(_vpe) {}
                                            }
                                        }
                                    } catch(_vce) {}
                                }
                            }
                        }
                    } catch(_pi) {}
                }
            }

            if (!anySelected) return JSON.stringify({ success: false, error: 'Nothing selected. Click a text clip in the timeline first.' });
            if (applied === 0) {
                return JSON.stringify({ success: false, error: 'Font could not be applied to this clip type. Make sure the font "' + fontPostScript + '" is installed on your system, then try selecting the clip and double-clicking the font.', debug: debugInfo.join(' | ') });
            }
            return JSON.stringify({ success: true, applied: applied, font: fontPostScript });
        } catch(e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    // ── Apply font to selected text layers — After Effects ────
    applyFontInAE: function(fontPostScript) {
        try {
            var comp = app.project && app.project.activeItem;
            if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ success: false, error: 'No active composition' });
            var applied = 0;
            for (var i = 1; i <= comp.numLayers; i++) {
                var layer = comp.layer(i);
                if (!layer.selected) continue;
                if (!(layer instanceof TextLayer)) continue;
                try {
                    var textProp = layer.property('Source Text');
                    var doc = textProp.value;
                    doc.font = fontPostScript;
                    textProp.setValue(doc);
                    applied++;
                } catch(_e) {}
            }
            if (applied === 0) return JSON.stringify({ success: false, error: 'No text layers selected. Select a text layer in After Effects first.' });
            return JSON.stringify({ success: true, applied: applied, font: fontPostScript });
        } catch(e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    // ── Install After Effects preset (.ffx) ───────────────────
    // Applies preset directly to the selected layer(s) in AE.
    // Falls back to { success: false } so Node.js can copy to User Presets instead.
    installAEPreset: function(filePath) {
        filePath = this._toNative(filePath);
        try {
            var host = this.getHostApp();
            if (host === 'AEFT') {
                var project = app.project;
                var comp = project && project.activeItem;
                if (comp && (comp instanceof CompItem) && comp.selectedLayers && comp.selectedLayers.length > 0) {
                    comp.selectedLayers[0].applyPreset(new File(filePath));
                    return JSON.stringify({ success: true, message: 'AE preset applied to selected layer(s)' });
                }
                return JSON.stringify({ success: false, error: 'no_selection' });
            }
            return JSON.stringify({ success: false, error: 'Not in After Effects' });
        } catch(e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    // ── Reveal in Explorer / Finder ────────────────────────────
    revealInExplorer: function(filePath) {
        filePath = this._toNative(filePath);
        try {
            if (this.isMac()) {
                // FIX: use osascript to select the file in Finder (not just open folder)
                var f = new File(filePath);
                var script = 'tell application "Finder" to reveal POSIX file "' + f.fsName + '"' +
                             '\ntell application "Finder" to activate';
                app.system('osascript -e \'' + script + '\'');
            } else {
                // Windows: explorer /select highlights the file.
                var f2 = new File(filePath);
                var cmd = 'explorer /select,"' + f2.fsName + '"';
                app.system(cmd);
            }
            return JSON.stringify({ success: true });
        } catch(e) {
            // Final fallback: just open the parent folder
            try {
                var parent = new File(filePath).parent;
                parent.execute();
                return JSON.stringify({ success: true, fallback: 'parent-folder' });
            } catch(_e) {}
            return JSON.stringify({ success: false, error: 'Reveal failed: ' + e.toString(), path: filePath });
        }
    },

    // ── Get audio file info ────────────────────────────────────
    getAudioInfo: function(filePath) {
        filePath = this._toNative(filePath);
        try {
            var f = new File(filePath);
            if (!f.exists) return JSON.stringify({ success: false, error: 'File not found' });
            return JSON.stringify({ success: true, name: f.name, size: f.length, path: f.fsName });
        } catch(e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    // ── Seconds → HH:MM:SS:FF (non-drop-frame) ──────────────────
    // NOTE: this is a simple non-drop-frame formatter. It does not
    // implement drop-frame timecode math for 29.97/59.94 fps sequences,
    // so exported timecodes on NTSC-rate sequences will be slightly off
    // from Premiere's own drop-frame display over long durations.
    _secondsToTimecode: function(seconds, fps) {
        fps = fps || 25;
        var rFps = Math.round(fps);
        var totalFrames = Math.round(seconds * fps);
        var ff = totalFrames % rFps;
        var totalSeconds = Math.floor(totalFrames / rFps);
        var ss = totalSeconds % 60;
        var totalMinutes = Math.floor(totalSeconds / 60);
        var mm = totalMinutes % 60;
        var hh = Math.floor(totalMinutes / 60);
        function pad(n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; }
        return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + ':' + pad(ff);
    },

    // ── Read markers from the active sequence — Premiere ────────
    // Returns [{ seconds, timecode, name, comments, type, color }, ...]
    // sorted by position. `color` is the marker color index when this
    // Premiere version exposes Marker.getColorByIndex() (added in
    // recent versions) — older versions will return null for color.
    getSequenceMarkers: function() {
        if (this.getHostApp() !== 'PPRO') {
            return JSON.stringify({ success: false, error: 'Marker export is only available in Premiere Pro.' });
        }
        try {
            var seq = app.project.activeSequence;
            if (!seq) return JSON.stringify({ success: false, error: 'No active sequence. Open a sequence and try again.' });

            var fps = 25;
            try {
                var settings = seq.getSettings();
                if (settings && settings.videoFrameRate && settings.videoFrameRate.seconds > 0) {
                    fps = 1 / settings.videoFrameRate.seconds;
                }
            } catch (_fe) {}

            var list = [];
            var markers = seq.markers;
            if (markers && markers.numMarkers > 0) {
                var m = markers.getFirstMarker();
                while (m) {
                    var colorIndex = null;
                    try {
                        if (typeof m.getColorByIndex === 'function') colorIndex = m.getColorByIndex();
                    } catch (_ce) {}
                    list.push({
                        seconds: m.start.seconds,
                        timecode: this._secondsToTimecode(m.start.seconds, fps),
                        name: m.name || '',
                        comments: m.comments || '',
                        type: m.type || 'Comment',
                        color: colorIndex
                    });
                    m = markers.getNextMarker(m);
                }
            }

            list.sort(function(a, b) { return a.seconds - b.seconds; });

            var projectPath = '';
            try { projectPath = app.project.path || ''; } catch (_pe) {}

            return JSON.stringify({
                success: true,
                seqName: seq.name,
                fps: fps,
                projectPath: projectPath,
                markers: list
            });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    // ── Apply a LUT to the active sequence — Premiere ────────────
    // Premiere's documented ExtendScript DOM has no public API to create
    // a new Adjustment Layer or to add a brand-new effect to a clip, so
    // this uses the QE (Quality Engineering) DOM — it ships with every
    // Premiere install but is undocumented/unsupported by Adobe and its
    // exact surface can shift between versions. Test against your target
    // Premiere build. Once the Lumetri Color component exists on the
    // clip, the "Input LUT" parameter is set through the standard,
    // documented component/property API (the same pattern this file
    // already uses in applyFontInPremiere).
    applyLUT: function(lutPath) {
        lutPath = this._toNative(lutPath);
        if (this.getHostApp() !== 'PPRO') {
            return JSON.stringify({ success: false, error: 'LUT quick-apply is only available in Premiere Pro.' });
        }
        var debugInfo = [];
        try {
            var seq = app.project.activeSequence;
            if (!seq) return JSON.stringify({ success: false, error: 'No active sequence. Open a sequence and try again.' });

            if (typeof app.enableQE === 'function') app.enableQE();
            if (typeof qe === 'undefined') {
                return JSON.stringify({ success: false, error: 'QE DOM unavailable in this Premiere version — cannot create an adjustment layer.' });
            }

            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return JSON.stringify({ success: false, error: 'QE could not find the active sequence.' });

            var trackIndex = qeSeq.numVideoTracks - 1;
            if (trackIndex < 0) return JSON.stringify({ success: false, error: 'Active sequence has no video tracks.' });

            var playheadSec = seq.getPlayerPosition().seconds;
            var qeTrack = qeSeq.getVideoTrackAt(trackIndex);

            if (typeof qeTrack.addAdjustmentLayer !== 'function') {
                return JSON.stringify({ success: false, error: 'QE addAdjustmentLayer() not available on this Premiere version.' });
            }
            qeTrack.addAdjustmentLayer(String(playheadSec));
            debugInfo.push('adjustment layer added on track ' + trackIndex + ' @ ' + playheadSec);

            // Locate the clip we just added via the standard DOM (last/newest
            // clip on that track, since the adjustment layer was just inserted).
            var track = seq.videoTracks[trackIndex];
            var clip = track.clips[track.clips.numItems - 1];
            if (!clip) return JSON.stringify({ success: false, error: 'Adjustment layer was created but could not be located on the timeline.', debug: debugInfo.join(' | ') });

            // Add Lumetri Color via QE, then set "Input LUT" via the standard DOM.
            var qeClip = null;
            try {
                var qeClipTrack = qeSeq.getVideoTrackAt(trackIndex);
                qeClip = qeClipTrack.getItemAt(qeClipTrack.numItems - 1);
            } catch (_qce) { debugInfo.push('qeClip lookup failed: ' + _qce.toString()); }

            var lumetriAdded = false;
            try {
                if (qeClip && typeof qeClip.addVideoEffect === 'function') {
                    var qeEffect = qe.project.getVideoEffectByName ? qe.project.getVideoEffectByName('Lumetri Color') : null;
                    if (qeEffect) { qeClip.addVideoEffect(qeEffect); lumetriAdded = true; }
                    else debugInfo.push('getVideoEffectByName("Lumetri Color") returned nothing');
                } else {
                    debugInfo.push('qeClip.addVideoEffect not available');
                }
            } catch (_lae) { debugInfo.push('addVideoEffect failed: ' + _lae.toString()); }

            if (!lumetriAdded) {
                return JSON.stringify({ success: false, error: 'Could not add Lumetri Color to the new adjustment layer — your Premiere version\'s QE effect API may differ.', debug: debugInfo.join(' | ') });
            }

            // Find the Lumetri Color component on the clip and set Input LUT.
            var applied = false;
            try {
                var comps = clip.components;
                for (var ci = 0; ci < comps.numItems; ci++) {
                    var comp = comps[ci];
                    if (!comp || !/lumetri/i.test(comp.displayName || '')) continue;
                    for (var pi = 0; pi < comp.properties.numItems; pi++) {
                        var prop = comp.properties[pi];
                        if (prop && /input\s*lut/i.test(prop.displayName || '')) {
                            prop.setValue(lutPath, true);
                            applied = true;
                            break;
                        }
                    }
                    if (applied) break;
                }
            } catch (_pe2) { debugInfo.push('property scan failed: ' + _pe2.toString()); }

            if (!applied) {
                return JSON.stringify({ success: false, error: 'Lumetri Color was added but the "Input LUT" parameter could not be set. The parameter\'s display name may differ in your Premiere version.', debug: debugInfo.join(' | ') });
            }

            return JSON.stringify({ success: true, message: 'LUT applied via new adjustment layer', debug: debugInfo.join(' | ') });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.toString(), debug: debugInfo.join(' | ') });
        }
    },

    // ── Duplicate active sequence as a labeled version — Premiere ──
    // Sequence duplication also has no documented ExtendScript API, so
    // this uses QE's Sequence.duplicate() (community-known, undocumented).
    // To stay robust regardless of what name QE assigns the copy, this
    // snapshots project item names before/after and renames whichever
    // item is new, instead of guessing QE's default naming convention.
    duplicateSequenceVersioned: function(n, label) {
        if (this.getHostApp() !== 'PPRO') {
            return JSON.stringify({ success: false, error: 'Versioned duplicate is only available in Premiere Pro.' });
        }
        try {
            var seq = app.project.activeSequence;
            if (!seq) return JSON.stringify({ success: false, error: 'No active sequence. Open a sequence and try again.' });

            var originalName = seq.name;
            var root = app.project.rootItem;

            function snapshotNames() {
                var names = {};
                for (var i = 0; i < root.children.numItems; i++) {
                    names[root.children[i].name] = true;
                }
                return names;
            }
            var before = snapshotNames();

            if (typeof app.enableQE === 'function') app.enableQE();
            if (typeof qe === 'undefined') {
                return JSON.stringify({ success: false, error: 'QE DOM unavailable in this Premiere version — cannot duplicate the sequence.' });
            }
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq || typeof qeSeq.duplicate !== 'function') {
                return JSON.stringify({ success: false, error: 'QE Sequence.duplicate() not available on this Premiere version.' });
            }
            qeSeq.duplicate();

            // Find the newly-created project item by diffing names.
            var newItem = null;
            for (var i = 0; i < root.children.numItems; i++) {
                var child = root.children[i];
                if (!before[child.name]) { newItem = child; break; }
            }
            if (!newItem) {
                return JSON.stringify({ success: false, error: 'Sequence was duplicated but the new copy could not be located to rename it.' });
            }

            // Build the target name and auto-increment on collision.
            var baseName = originalName + ' V' + n + (label ? ' \u2013 ' + label : '');
            var finalName = baseName;
            var counter = 2;
            var after = snapshotNames();
            delete after[newItem.name];
            while (after[finalName]) {
                finalName = baseName + ' (' + counter + ')';
                counter++;
            }

            newItem.name = finalName;

            return JSON.stringify({ success: true, name: finalName });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    // ── Auto-create all standard category bins ─────────────────
    // Call once on panel open. Creates any missing bins so the
    // project always has Items, Sequences, Music, etc.
    // ── Return the open project's file path — Premiere only ─────
    // Deliberately does not require an active sequence (unlike
    // getSequenceMarkers), since callers may need the project identity
    // before any sequence is open.
    getProjectPath: function() {
        if (this.getHostApp() !== 'PPRO') {
            return JSON.stringify({ success: false, error: 'Not in Premiere Pro' });
        }
        try {
            var project = app.project;
            if (!project) return JSON.stringify({ success: false, error: 'No project open' });
            var projectPath = '';
            try { projectPath = project.path || ''; } catch (_pe) {}
            return JSON.stringify({ success: true, projectPath: projectPath, projectName: project.name || '' });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    ensureProjectBins: function() {
        if (this.getHostApp() !== 'PPRO') {
            return JSON.stringify({ success: false, error: 'Not in Premiere Pro' });
        }
        try {
            var project = app.project;
            if (!project) return JSON.stringify({ success: false, error: 'No project open' });

            var binNames = [
                '\uD83D\uDCE6 All',
                '\uD83D\uDCCB Items',
                '\uD83C\uDFAC Sequences',
                '\uD83C\uDFB5 Music',
                '\uD83D\uDD0A Sound FX',
                '\uD83C\uDFA5 Video',
                '\uD83D\uDDBC\uFE0F Images',
                '\uD83C\uDFA8 LUTs',
                '\uD83D\uDD24 Fonts',
                '\u2699\uFE0F Presets',
                '\uD83C\uDF9E Motion Graphics',
                '\uD83D\uDCC1 Other'
            ];

            var created = [];
            for (var i = 0; i < binNames.length; i++) {
                var existing = false;
                var root = project.rootItem;
                for (var j = 0; j < root.children.numItems; j++) {
                    if (root.children[j].name === binNames[i] &&
                        root.children[j].type === ProjectItemType.BIN) {
                        existing = true;
                        break;
                    }
                }
                if (!existing) {
                    try {
                        root.createBin(binNames[i]);
                        created.push(binNames[i]);
                    } catch (ce) {}
                }
            }
            return JSON.stringify({ success: true, created: created });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    },

    // ── File copy utility ──────────────────────────────────────
    _copyFile: function(srcPath, destDir) {
        try {
            var src = new File(srcPath);
            if (!src.exists) return JSON.stringify({ success: false, error: 'Source file not found: ' + srcPath });

            var destFolder = new Folder(destDir);
            if (!destFolder.exists) destFolder.create();

            var dst = new File(this._join(destDir, src.name));
            var ok  = src.copy(dst.fsName);

            if (ok) return JSON.stringify({ success: true, dest: dst.fsName });
            return JSON.stringify({ success: false, error: 'Copy failed (check permissions)' });
        } catch(e) {
            return JSON.stringify({ success: false, error: e.toString() });
        }
    }

};
