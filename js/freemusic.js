/* AssetFlow — Free Music browser (Openverse + Jamendo). Self-contained. */
(function(){
"use strict";
var LS={get:function(k,d){try{var v=localStorage.getItem(k);return v==null?d:v}catch(e){return d}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
var MOODS=["cinematic","chill","lofi","upbeat","happy","epic","ambient","corporate","hip hop","acoustic","piano","electronic","dramatic","sad","funk","jazz"];
var state={q:"",page:1,items:[],busy:false,audio:null,playing:null,mode:LS.get("af_fm_lic","credit")};
function el(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function fmt(s){s=Math.round(s||0);return Math.floor(s/60)+":"+("0"+s%60).slice(-2)}
function log(m){try{require("fs").appendFileSync(require("path").join(require("os").tmpdir(),"af_freemusic.log"),new Date().toISOString()+" "+m+"\n")}catch(e){}}
window.addEventListener("error",function(e){if(/freemusic/.test(e.filename||""))log("ERR "+e.message+" @"+e.lineno)});
function toast(m,t){try{showToast(m,t||"info")}catch(e){console.log(m)}}

var css=el("style",null,
"#fm-ov{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:2147483000;display:none}"+
"#fm{margin:auto;width:min(760px,96vw);height:min(640px,94vh);background:var(--bg2,#222);border:1px solid var(--border2,#444);border-radius:8px;display:flex;flex-direction:column;color:#ddd;font-size:12px}"+
"#fm header{display:flex;flex-wrap:wrap;gap:6px;padding:10px;border-bottom:1px solid var(--border,#333);align-items:center}"+
"#fm input,#fm select{background:var(--bg3,#2a2a2a);border:1px solid var(--border2,#444);color:#eee;border-radius:4px;padding:5px 7px;font-size:12px}"+
"#fm-q{flex:1 1 140px}#fm select{max-width:100%}#fm button{background:var(--bg4,#333);border:1px solid var(--border2,#444);color:#eee;border-radius:4px;padding:5px 9px;cursor:pointer;font-size:12px}"+
"#fm button:hover{background:var(--bg5,#3d3d3d)}#fm .pri{background:#2d6cdf;border-color:#2d6cdf}"+
"#fm-moods{display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px}#fm-moods span{background:var(--bg3,#2a2a2a);padding:3px 8px;border-radius:10px;cursor:pointer}#fm-moods span:hover{background:#2d6cdf}"+
"#fm-list{flex:1;overflow:auto;padding:4px 10px}.fm-r{display:flex;gap:8px;align-items:center;padding:6px;border-bottom:1px solid var(--border,#333)}"+
".fm-r .t{flex:1;min-width:0}.fm-r .t b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fm-r .t i{color:#999;font-style:normal;font-size:11px}"+
".fm-lic{font-size:10px;padding:1px 5px;border-radius:3px;background:#2f4a2f;color:#9e9}.fm-lic.by{background:#4a432a;color:#ec6}"+
"#fm footer{padding:8px 10px;border-top:1px solid var(--border,#333);display:flex;gap:8px;align-items:center;color:#999;font-size:11px}#fm footer span{flex:1}");
document.head.appendChild(css);

var ov=el("div",null,
'<div id="fm"><header><input id="fm-q" placeholder="Search free music (mood, genre, instrument)…">'+
'<select id="fm-src"><option value="ov">Openverse</option><option value="ja">Jamendo</option></select>'+
'<select id="fm-lic"><option value="credit">OK for monetized (credit may be needed)</option><option value="cc0">No credit needed only</option></select>'+
'<button class="pri" id="fm-go">Search</button><button id="fm-x">✕</button></header>'+
'<div id="fm-moods"></div><div id="fm-list"><div style="padding:20px;color:#888">Pick a mood or search. Downloads go into your library\'s Music folder and the Premiere bin.</div></div>'+
'<footer><span id="fm-st">Every download saves its license + a credits line (copied to clipboard).</span><button id="fm-more">More results</button><button id="fm-key">Jamendo key</button></footer></div>');
ov.id="fm-ov";document.body.appendChild(ov);
var $=function(id){return document.getElementById(id)};
MOODS.forEach(function(m){var s=el("span",null,esc(m));s.onclick=function(){$("fm-q").value=m;search(true)};$("fm-moods").appendChild(s)});
$("fm-lic").value=state.mode;
$("fm-lic").onchange=function(){state.mode=this.value;LS.set("af_fm_lic",state.mode);search(true)};
$("fm-src").value=LS.get("af_fm_src","ov");$("fm-src").onchange=function(){LS.set("af_fm_src",this.value);if($("fm-q").value)search(true)};
$("fm-go").onclick=function(){search(true)};$("fm-q").onkeydown=function(e){if(e.key==="Enter")search(true);e.stopPropagation()};
$("fm-more").onclick=function(){search(false)};
$("fm-x").onclick=close;ov.addEventListener("click",function(e){e.stopPropagation();if(e.target===ov)close()});["keydown","keyup","mousedown","dblclick","contextmenu"].forEach(function(t){ov.addEventListener(t,function(e){e.stopPropagation();if(t==="keydown"&&e.key==="Escape")close()})});
$("fm-key").onclick=function(){var k=prompt("Jamendo client ID (free at devportal.jamendo.com):",LS.get("af_jamendo_key",""));if(k!=null){LS.set("af_jamendo_key",k.trim());toast("Jamendo key saved","success")}};
function open(){log("open");ov.style.display="flex";setTimeout(function(){$("fm-q").focus()},50)}
function close(){ov.style.display="none";stop()}
function stop(){if(state.audio){state.audio.pause();state.audio=null}if(state.playing){state.playing.textContent="▶";state.playing=null}}
function st(m){$("fm-st").textContent=m}

/* header button */
function addBtn(){var dl=document.getElementById("cat-downloader");if(!dl)return false;if($("fm-btn"))return true;var b=el("div","cat-item",'<span class="cat-emoji" data-tip="Free Music (copyright-safe)">♫</span> <span class="cat-label">Free Music</span>');b.id="fm-btn";b.setAttribute("data-tooltip","Free Music (copyright-safe)");b.style.setProperty("--cat-color","var(--c-audio, #6c8)");b.addEventListener("click",function(e){e.stopPropagation();e.preventDefault();try{open()}catch(x){log("open err "+x.stack)}},true);dl.parentNode.insertBefore(b,dl);return true}
if(!addBtn()){var n=0,iv=setInterval(function(){if(addBtn()||++n>40)clearInterval(iv)},250)}

/* ---- sources ---- */
function getJSON(url){return fetch(url,{headers:{"Accept":"application/json"}}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json()})}
function licOK(code){code=String(code||"").toLowerCase();if(!/^(by|cc0|pdm)$/.test(code))return false;if(state.mode==="cc0")return code==="cc0"||code==="pdm";return true}
function fromOpenverse(q,page){
  var lt=state.mode==="cc0"?"&license=cc0,pdm":"&license=by,cc0,pdm";
  return getJSON("https://api.openverse.org/v1/audio/?q="+encodeURIComponent(q)+"&category=music&page_size=20&page="+page+lt).then(function(j){
    return (j.results||[]).filter(function(r){return r.url&&licOK(r.license)}).map(function(r){return{
      id:"ov_"+r.id,title:r.title||"Untitled",artist:r.creator||"Unknown",url:r.url,ext:(r.filetype||String(r.url).split("?")[0].split(".").pop()||"mp3").toLowerCase(),
      dur:(r.duration||0)/1000,license:(r.license||"").toUpperCase()+(r.license_version?" "+r.license_version:""),licCode:r.license,
      licUrl:r.license_url||"",page:r.foreign_landing_url||"",source:r.source||"openverse",
      credit:r.attribution||('"'+(r.title||"")+'" by '+(r.creator||"")+" ("+(r.license||"").toUpperCase()+")")}})})}
function fromJamendo(q,page){
  var key=LS.get("af_jamendo_key","");if(!key)return Promise.reject(new Error("Add your free Jamendo key first (button at the bottom)."));
  return getJSON("https://api.jamendo.com/v3.0/tracks/?client_id="+encodeURIComponent(key)+"&format=json&limit=20&offset="+((page-1)*20)+"&audiodownload_allowed=true&include=licenses+musicinfo&order=popularity_total&search="+encodeURIComponent(q)).then(function(j){
    if(j.headers&&j.headers.status!=="success")throw new Error(j.headers.error_message||"Jamendo error");
    return (j.results||[]).map(function(r){var lu=r.license_ccurl||"",code=(lu.match(/licenses\/([a-z-]+)/)||[])[1]||(/publicdomain/.test(lu)?"cc0":"");return{
      id:"ja_"+r.id,title:r.name,artist:r.artist_name,url:r.audiodownload||r.audio,ext:"mp3",dur:r.duration,
      license:("CC "+code).toUpperCase(),licCode:code==="cc0"?"cc0":code,licUrl:lu,page:r.shareurl||"",source:"jamendo",
      credit:'"'+r.name+'" by '+r.artist_name+" (Jamendo) — "+lu}}).filter(function(r){return r.url&&code_ok(r.licCode)})})
  function code_ok(c){return c&&licOK(c)}}

function search(reset){log("search "+$("fm-q").value);
  var q=$("fm-q").value.trim();if(!q||state.busy)return;
  if(reset){state.page=1;state.items=[];$("fm-list").innerHTML=""}else state.page++;
  state.busy=true;st("Searching…");
  var p=$("fm-src").value==="ja"?fromJamendo(q,state.page):fromOpenverse(q,state.page);
  p.then(function(items){state.items=state.items.concat(items);items.forEach(row);st(state.items.length+" tracks · click ▶ to preview, ⬇ to add to your library");if(!state.items.length)$("fm-list").innerHTML='<div style="padding:20px;color:#888">No results. Try another word.</div>'})
   .catch(function(e){log("search fail "+e.message);st("Search failed: "+e.message)}).then(function(){state.busy=false});
}
function row(it){
  var free=/^(cc0|pdm)$/.test(it.licCode);
  var r=el("div","fm-r",'<button class="pl">▶</button><div class="t"><b>'+esc(it.title)+'</b><i>'+esc(it.artist)+" · "+fmt(it.dur)+" · "+esc(it.source)+'</i></div>'+
    '<span class="fm-lic'+(free?"":" by")+'" title="'+(free?"No credit needed":"Credit the artist in your description")+'">'+esc(it.license)+(free?"":" · credit")+'</span><button class="dl">⬇</button>');
  r.querySelector(".pl").onclick=function(){var b=this;if(state.playing===b)return stop();stop();state.audio=new Audio(it.url);state.audio.volume=.8;state.audio.play().catch(function(){st("Can't preview this one")});state.audio.onended=stop;state.playing=b;b.textContent="■"};
  r.querySelector(".dl").onclick=function(){download(it,this)};
  $("fm-list").appendChild(r);
}

/* ---- download → library ---- */
function fetchTo(url,dest,onP,hops){
  var https=require("https"),http=require("http"),fs=require("fs");hops=hops||0;
  return new Promise(function(ok,bad){
    var mod=/^https:/.test(url)?https:http;
    var req=mod.get(url,{headers:{"User-Agent":"AssetFlow/1.0"}},function(res){
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location&&hops<6){res.resume();return ok(fetchTo(new URL(res.headers.location,url).href,dest,onP,hops+1))}
      if(res.statusCode!==200){res.resume();return bad(new Error("HTTP "+res.statusCode))}
      var tot=+res.headers["content-length"]||0,got=0,f=fs.createWriteStream(dest);
      res.on("data",function(c){got+=c.length;onP&&onP(tot?got/tot:0,got)});
      res.pipe(f);f.on("finish",function(){f.close(function(){got>1000?ok(dest):bad(new Error("empty file"))})});f.on("error",bad);res.on("error",bad)});
    req.setTimeout(30000,function(){req.destroy(new Error("timed out"))});req.on("error",bad)})}
function download(it,btn){
  if(typeof require==="undefined")return toast("Downloads need the Premiere panel","error");
  var fs=require("fs"),path=require("path"),os=require("os");
  var dir=path.join(os.tmpdir(),"AssetFlow_FreeMusic");try{fs.mkdirSync(dir,{recursive:true})}catch(e){}
  var ext=/^(mp3|wav|ogg|flac|m4a|aiff?)$/.test(it.ext)?it.ext:"mp3";
  var base=(it.artist+" - "+it.title).replace(/[<>:"/\\|?*\x00-\x1F]/g,"_").slice(0,120);
  var dest=path.join(dir,base+"."+ext);
  btn.disabled=true;btn.textContent="…";
  fetchTo(it.url,dest,function(p){btn.textContent=p?Math.round(p*100)+"%":"…"}).then(function(){
    /* license proof next to the file */
    var lic=["Title: "+it.title,"Artist: "+it.artist,"License: "+it.license+(it.licUrl?" ("+it.licUrl+")":""),"Source: "+(it.page||it.url),"Downloaded: "+new Date().toISOString(),"","Credit line:",it.credit].join("\r\n");
    try{fs.writeFileSync(dest.replace(/\.[^.]+$/,"")+".license.txt",lic)}catch(e){}
    try{require("child_process").spawn("clip",[],{windowsHide:true}).stdin.end(it.credit)}catch(e){}
    var root=typeof getPrimaryLibraryRoot==="function"&&getPrimaryLibraryRoot();
    if(root&&typeof _copyDroppedFilesToLibrary==="function"){
      _copyDroppedFilesToLibrary([dest]);
      try{var lf=path.join(root,typeof getLibraryFolderForCategory==="function"?getLibraryFolderForCategory(_inferDropCategory(dest)):"Music");fs.mkdirSync(lf,{recursive:true});fs.copyFileSync(dest.replace(/\.[^.]+$/,"")+".license.txt",path.join(lf,base+".license.txt"))}catch(e){}
    }else{toast("Set a library folder in Settings — file saved to "+dir,"warn");try{require("child_process").exec('explorer /select,"'+dest+'"')}catch(e){}}
    btn.textContent="✓";st("Added “"+it.title+"”. "+(/^(cc0|pdm)$/.test(it.licCode)?"No credit needed.":"Credit line copied — paste it in your video description."));
  }).catch(function(e){log("dl fail "+e.message);btn.disabled=false;btn.textContent="⬇";st("Download failed: "+e.message);try{fs.unlinkSync(dest)}catch(x){}});
}
window.AF_FreeMusic={open:open};
})();
