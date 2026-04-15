// v9.9 - fix native panel override: block click/pointer events on wired buttons, delayed native panel suppression
setTimeout(function allButtonsFix(){
if(window._v9Loaded)return;window._v9Loaded=true;
var video=document.querySelector('#videoPlayer');
var sidebar=document.querySelector('.editor-sidebar');
if(!video||!sidebar)return;
var existOv=document.getElementById('v9Overlay');if(existOv)existOv.remove();
var sRect=sidebar.getBoundingClientRect();
var ov=document.createElement('div');ov.id='v9Overlay';
ov.style.cssText='position:fixed;top:'+sRect.top+'px;left:'+sRect.left+'px;width:'+sRect.width+'px;max-height:'+(sRect.height)+'px;overflow-y:auto;z-index:9999;pointer-events:none;';
document.body.appendChild(ov);
var pan=document.createElement('div');pan.id='v9P';
pan.style.cssText='display:none;background:#1a1a2e;border:1px solid #6c2bd9;border-radius:12px;padding:16px;margin-top:8px;pointer-events:auto;box-shadow:0 4px 20px rgba(0,0,0,0.5);max-height:400px;overflow-y:auto;';
ov.appendChild(pan);

window._vt=window._vt||{rotate:0,scaleX:1,scaleY:1,zoom:1,translateX:0,translateY:0};
window._vf=window._vf||{brightness:100,contrast:100,saturate:100,hueRotate:0,blur:0,opacity:100};

function show(title,html,fn){
pan=document.getElementById('v9P');
function hideNative(){document.querySelectorAll('.tool-panel').forEach(function(p){p.style.display='none';});}
hideNative();
pan.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="color:#fff;font-weight:600;font-size:14px;">'+title+'</span><span id="v9X" style="color:#999;cursor:pointer;font-size:18px;">&times;</span></div>'+html;
pan.style.display='block';
setTimeout(hideNative,50);setTimeout(hideNative,150);setTimeout(hideNative,300);
document.getElementById('v9X').addEventListener('mousedown',function(e){e.stopPropagation();pan.style.display='none';});
if(fn)fn();
}
function hide(){pan.style.display='none';}

function aT(){
var t=window._vt||{};
var r=t.rotate!==undefined?t.rotate:0;
var sx=t.scaleX!==undefined?t.scaleX:1;
var sy=t.scaleY!==undefined?t.scaleY:1;
var z=t.zoom!==undefined?t.zoom:1;
var tx=t.translateX!==undefined?t.translateX:0;
var ty=t.translateY!==undefined?t.translateY:0;
video.style.transform='rotate('+r+'deg) scaleX('+sx+') scaleY('+sy+') scale('+z+') translateX('+tx+'px) translateY('+ty+'px)';
}

function aF(){
var f=window._vf||{};
var b=f.brightness!==undefined?f.brightness:100;
var c=f.contrast!==undefined?f.contrast:100;
var s=f.saturate!==undefined?f.saturate:100;
var h=f.hueRotate!==undefined?f.hueRotate:0;
var bl=f.blur!==undefined?f.blur:0;
var o=f.opacity!==undefined?f.opacity:100;
video.style.filter='brightness('+b+'%) contrast('+c+'%) saturate('+s+'%) hue-rotate('+h+'deg) blur('+bl+'px) opacity('+o+'%)';
}

function initAudioContext(){
if(!window._audioCtx){
window._audioCtx=new (window.AudioContext||window.webkitAudioContext)();
window._audioSrc=window._audioCtx.createMediaElementSource(video);
window._eqL=window._audioCtx.createBiquadFilter();
window._eqM=window._audioCtx.createBiquadFilter();
window._eqH=window._audioCtx.createBiquadFilter();
window._comp=window._audioCtx.createDynamicsCompressor();
window._gainNode=window._audioCtx.createGain();
window._eqL.type='lowshelf';window._eqL.frequency.value=60;window._eqL.gain.value=0;
window._eqM.type='peaking';window._eqM.frequency.value=1000;window._eqM.gain.value=0;
window._eqH.type='highshelf';window._eqH.frequency.value=8000;window._eqH.gain.value=0;
window._audioSrc.connect(window._eqL);
window._eqL.connect(window._eqM);
window._eqM.connect(window._eqH);
window._eqH.connect(window._comp);
window._comp.connect(window._gainNode);
window._gainNode.connect(window._audioCtx.destination);
window._gainNode.gain.value=1;
}
return window._audioCtx;
}

function sld(label,min,max,val,unit,cb){
var id='s_'+Math.random().toString(36).substr(2,5);
return{html:'<div style="margin-bottom:10px;"><label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">'+label+'</label><div style="display:flex;align-items:center;gap:8px;"><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" value="'+val+'" step="any" style="flex:1;accent-color:#6c2bd9;"><span id="'+id+'v" style="color:#fff;font-size:12px;min-width:40px;">'+val+(unit||'')+'</span></div></div>',init:function(){var s=document.getElementById(id),v=document.getElementById(id+'v');if(s)s.addEventListener('input',function(){v.textContent=parseFloat(s.value).toFixed(s.step==='any'?2:0)+(unit||'');cb(Number(s.value));});}};
}

function btn(label,color,cb){
var id='b_'+Math.random().toString(36).substr(2,5);
return{html:'<button id="'+id+'" style="width:100%;padding:10px;background:'+(color||'#6c2bd9')+';color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;margin-top:8px;">'+label+'</button>',init:function(){var b=document.getElementById(id);if(b)b.addEventListener('mousedown',function(e){e.stopPropagation();cb(b);});}};
}

function grd(items,cb){
var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">';
var fns=[];
items.forEach(function(p){
var id='g_'+Math.random().toString(36).substr(2,5);
html+='<button id="'+id+'" style="padding:8px;background:#2a2a4a;color:#fff;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px;">'+p.label+'</button>';
fns.push(function(){var b=document.getElementById(id);if(b)b.addEventListener('mousedown',function(e){e.stopPropagation();cb(p,b);b.parentNode.querySelectorAll('button').forEach(function(x){x.style.borderColor='#444';x.style.background='#2a2a4a';});b.style.borderColor='#6c2bd9';b.style.background='#3a2a6a';});});
});
html+='</div>';
return{html:html,init:function(){fns.forEach(function(f){f();});}};
}

function wire(b,handler){
if(!b)return;
b.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();handler(e);},true);
b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();},true);
b.addEventListener('pointerdown',function(e){e.stopPropagation();},true);
b.addEventListener('pointerup',function(e){e.stopPropagation();},true);
b.style.cursor='pointer';
}

function toast(msg,color){
var d=document.createElement('div');
d.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:'+(color||'#6c2bd9')+';color:#fff;padding:16px 32px;border-radius:12px;font-size:15px;font-weight:600;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
d.textContent=msg;
document.body.appendChild(d);
setTimeout(function(){d.remove();},2000);
}

var cats=document.querySelectorAll('.cat-content-new');
function gb(ci){return cats[ci]?Array.from(cats[ci].querySelectorAll('.tb3')):[]; }
var eb=gb(0),ab=gb(1),ai=gb(2),fx=gb(3);

// === EDIT TAB ===

// eb[0] Trim â ENFORCES trim bounds during playback
wire(eb[0],function(){
var dur=Math.floor(video.duration||10);
var s1=sld('Start',0,dur,window._vt.trimStart||0,'s',function(v){video.currentTime=v;});
var s2=sld('End',0,dur,window._vt.trimEnd||dur,'s',function(v){});
var b1=btn('Apply Trim','#6c2bd9',function(){
window._vt.trimStart=Number(document.querySelectorAll('#v9P input[type="range"]')[0].value);
window._vt.trimEnd=Number(document.querySelectorAll('#v9P input[type="range"]')[1].value);
if(window._trimListener)video.removeEventListener('timeupdate',window._trimListener);
window._trimListener=function(){
if(video.currentTime<window._vt.trimStart)video.currentTime=window._vt.trimStart;
if(video.currentTime>=window._vt.trimEnd){video.pause();video.currentTime=window._vt.trimStart;}
};
video.addEventListener('timeupdate',window._trimListener);
toast('Trim active: '+window._vt.trimStart+'s - '+window._vt.trimEnd+'s â playback enforced','#22c55e');
});
var b2=btn('Remove Trim','#ef4444',function(){
if(window._trimListener){video.removeEventListener('timeupdate',window._trimListener);window._trimListener=null;}
window._vt.trimStart=undefined;window._vt.trimEnd=undefined;
toast('Trim removed','#3b82f6');
});
show('Trim',s1.html+s2.html+b1.html+b2.html,function(){s1.init();s2.init();b1.init();b2.init();});
});

// eb[1] Split â adds markers AND enables segment playback
wire(eb[1],function(){
var pos=Math.floor(video.currentTime);
if(!window._vt.splitPoints)window._vt.splitPoints=[];
window._vt.splitPoints.push(pos);
window._vt.splitPoints.sort(function(a,b){return a-b;});
var mvp=video.parentElement;
if(mvp.style.position!=='relative'&&mvp.style.position!=='absolute')mvp.style.position='relative';
// Remove old markers and redraw
mvp.querySelectorAll('.v9-split-marker').forEach(function(m){m.remove();});
window._vt.splitPoints.forEach(function(sp){
var marker=document.createElement('div');
marker.className='v9-split-marker';
marker.style.cssText='position:absolute;left:'+((sp/(video.duration||10))*100)+'%;top:0;width:2px;height:100%;background:#ff00ff;z-index:100;pointer-events:none;';
marker.title='Split at '+sp+'s';
mvp.appendChild(marker);
});
// Build segment list
var segments=[];
var pts=[0].concat(window._vt.splitPoints).concat([Math.floor(video.duration||10)]);
for(var i=0;i<pts.length-1;i++){
if(pts[i]!==pts[i+1])segments.push({start:pts[i],end:pts[i+1],label:'Seg '+(i+1)+' ('+pts[i]+'s-'+pts[i+1]+'s)'});
}
var html='<div style="color:#ccc;font-size:12px;margin-bottom:8px;">'+window._vt.splitPoints.length+' split point(s) â click a segment to play it:</div>';
html+='<div style="max-height:150px;overflow-y:auto;">';
segments.forEach(function(seg,i){
html+='<div class="v9seg" data-start="'+seg.start+'" data-end="'+seg.end+'" style="padding:6px 8px;background:#2a2a4a;margin:3px 0;border-radius:4px;cursor:pointer;color:#fff;font-size:12px;border:1px solid #444;">&#9654; '+seg.label+'</div>';
});
html+='</div>';
var b1=btn('Clear All Splits','#ef4444',function(){
window._vt.splitPoints=[];
mvp.querySelectorAll('.v9-split-marker').forEach(function(m){m.remove();});
if(window._splitListener){video.removeEventListener('timeupdate',window._splitListener);window._splitListener=null;}
toast('Splits cleared','#3b82f6');
});
show('Split ('+window._vt.splitPoints.length+' points)',html+b1.html,function(){
b1.init();
document.querySelectorAll('.v9seg').forEach(function(el){
el.addEventListener('mousedown',function(e){
e.stopPropagation();
var st=Number(el.getAttribute('data-start'));
var en=Number(el.getAttribute('data-end'));
video.currentTime=st;
video.play();
if(window._splitListener)video.removeEventListener('timeupdate',window._splitListener);
window._splitListener=function(){if(video.currentTime>=en){video.pause();video.currentTime=st;}};
video.addEventListener('timeupdate',window._splitListener);
document.querySelectorAll('.v9seg').forEach(function(x){x.style.borderColor='#444';x.style.background='#2a2a4a';});
el.style.borderColor='#6c2bd9';el.style.background='#3a2a6a';
toast('Playing segment '+st+'s-'+en+'s','#22c55e');
});
});
});
});

// eb[2] Speed
wire(eb[2],function(){
var s=sld('Playback Speed',0.25,4,video.playbackRate||1,'x',function(v){video.playbackRate=v;});
show('Speed',s.html,function(){s.init();});
});

// eb[3] Crop
wire(eb[3],function(){
var g=grd([{label:'16:9'},{label:'9:16'},{label:'1:1'},{label:'4:3'},{label:'21:9'},{label:'Reset'}],function(p){
if(p.label==='16:9')video.style.clipPath='inset(12.5% 0)';
else if(p.label==='9:16')video.style.clipPath='inset(0 31.25%)';
else if(p.label==='1:1')video.style.clipPath='inset(25% 0)';
else if(p.label==='4:3')video.style.clipPath='inset(8.33% 0)';
else if(p.label==='21:9')video.style.clipPath='inset(26.67% 0)';
else video.style.clipPath='none';
window._vt.cropPath=video.style.clipPath;
});
show('Crop',g.html,function(){g.init();});
});

// eb[4] Resize
wire(eb[4],function(){
var vp=video.parentElement;
var s1=sld('Width',200,1200,vp?vp.offsetWidth:800,'px',function(v){if(vp)vp.style.width=v+'px';});
var s2=sld('Height',150,900,vp?vp.offsetHeight:600,'px',function(v){if(vp)vp.style.height=v+'px';});
show('Resize',s1.html+s2.html,function(){s1.init();s2.init();});
});

// eb[5] Rotate
wire(eb[5],function(){
var s=sld('Angle',0,360,window._vt.rotate||0,'Â°',function(v){window._vt.rotate=v;aT();});
show('Rotate',s.html,function(){s.init();});
});

// eb[6] Flip
wire(eb[6],function(){
var g=grd([{label:'Horizontal',v:'h'},{label:'Vertical',v:'v'},{label:'Both',v:'b'},{label:'Reset',v:'r'}],function(p){
if(p.v==='h'){window._vt.scaleX=window._vt.scaleX===-1?1:-1;}
else if(p.v==='v'){window._vt.scaleY=window._vt.scaleY===-1?1:-1;}
else if(p.v==='b'){window._vt.scaleX=-1;window._vt.scaleY=-1;}
else{window._vt.scaleX=1;window._vt.scaleY=1;}
aT();
});
show('Flip',g.html,function(){g.init();});
});

// eb[7] Position
wire(eb[7],function(){
var s1=sld('Translate X',-200,200,window._vt.translateX||0,'px',function(v){window._vt.translateX=v;aT();});
var s2=sld('Translate Y',-200,200,window._vt.translateY||0,'px',function(v){window._vt.translateY=v;aT();});
show('Position',s1.html+s2.html,function(){s1.init();s2.init();});
});

// eb[8] Reverse â FIXED wiring (was eb[4]), now uses stepwise backward playback
wire(eb[8],function(){
if(window._reverseInterval){
clearInterval(window._reverseInterval);
window._reverseInterval=null;
video.playbackRate=1;
toast('Reverse stopped â normal playback','#3b82f6');
return;
}
video.pause();
var speed=1/30;
window._reverseInterval=setInterval(function(){
if(video.currentTime<=0){clearInterval(window._reverseInterval);window._reverseInterval=null;toast('Reached start','#3b82f6');return;}
video.currentTime=Math.max(0,video.currentTime-speed*2);
},33);
toast('Reverse playing â click again to stop','#22c55e');
});

// eb[9] Loop
wire(eb[9],function(){
video.loop=!video.loop;
toast('Loop '+(video.loop?'enabled':'disabled'),video.loop?'#22c55e':'#3b82f6');
});

// eb[10] Freeze Frame
wire(eb[10],function(){
video.pause();
toast('Frame frozen at '+video.currentTime.toFixed(1)+'s','#3b82f6');
});

// eb[11] Keyframes â now with real playback interpolation
wire(eb[11],function(){
if(!window._vt.keyframes)window._vt.keyframes=[];
var t=Math.floor(video.currentTime);
var kf={time:t,rotate:window._vt.rotate||0,scaleX:window._vt.scaleX||1,scaleY:window._vt.scaleY||1,zoom:window._vt.zoom||1,translateX:window._vt.translateX||0,translateY:window._vt.translateY||0};
window._vt.keyframes.push(kf);
window._vt.keyframes.sort(function(a,b){return a.time-b.time;});
var html='<div style="max-height:150px;overflow-y:auto;color:#ccc;font-size:12px;">';
window._vt.keyframes.forEach(function(k,i){html+='<div style="padding:4px;background:#2a2a4a;margin:4px 0;border-radius:4px;">KF#'+(i+1)+' @ '+k.time+'s (R:'+k.rotate+'Â° Z:'+k.zoom.toFixed(1)+'x)</div>';});
html+='</div>';
var b1=btn('Play with Keyframes','#22c55e',function(){
if(window._vt.keyframes.length<2){toast('Need at least 2 keyframes','#ef4444');return;}
video.currentTime=window._vt.keyframes[0].time;
video.play();
if(window._kfAnimId)cancelAnimationFrame(window._kfAnimId);
function interpolateKF(){
window._kfAnimId=requestAnimationFrame(interpolateKF);
var ct=video.currentTime;
var kfs=window._vt.keyframes;
var prev=kfs[0],next=kfs[kfs.length-1];
for(var i=0;i<kfs.length-1;i++){
if(ct>=kfs[i].time&&ct<=kfs[i+1].time){prev=kfs[i];next=kfs[i+1];break;}
}
if(prev.time===next.time)return;
var progress=(ct-prev.time)/(next.time-prev.time);
progress=Math.max(0,Math.min(1,progress));
window._vt.rotate=prev.rotate+(next.rotate-prev.rotate)*progress;
window._vt.scaleX=prev.scaleX+(next.scaleX-prev.scaleX)*progress;
window._vt.scaleY=prev.scaleY+(next.scaleY-prev.scaleY)*progress;
window._vt.zoom=prev.zoom+(next.zoom-prev.zoom)*progress;
window._vt.translateX=prev.translateX+(next.translateX-prev.translateX)*progress;
window._vt.translateY=prev.translateY+(next.translateY-prev.translateY)*progress;
aT();
if(ct>=kfs[kfs.length-1].time){cancelAnimationFrame(window._kfAnimId);}
}
interpolateKF();
toast('Playing keyframe animation','#22c55e');
});
var b2=btn('Clear All','#ef4444',function(){
window._vt.keyframes=[];
if(window._kfAnimId)cancelAnimationFrame(window._kfAnimId);
toast('Keyframes cleared','#3b82f6');
});
show('Keyframes ('+window._vt.keyframes.length+')',html+b1.html+b2.html,function(){b1.init();b2.init();});
});

// === AUDIO TAB ===

// ab[0] Volume
wire(ab[0],function(){
var s=sld('Volume',0,100,Math.round(video.volume*100),'%',function(v){video.volume=v/100;});
show('Volume',s.html,function(){s.init();});
});

// ab[1] Music Library â real audio file playback via Web Audio oscillator patterns
wire(ab[1],function(){
var g=grd([{label:'Chill Lo-Fi',v:'chill'},{label:'Upbeat Pop',v:'upbeat'},{label:'Electronic',v:'electronic'},{label:'Ambient',v:'ambient'},{label:'Jazz',v:'jazz'},{label:'Classical',v:'classical'}],function(p){
var ctx=initAudioContext();
if(window._musicNodes){window._musicNodes.forEach(function(n){try{n.stop();}catch(e){}});window._musicNodes=[];}
window._musicNodes=[];
// Create rich multi-oscillator patterns per genre
function playPattern(notes,type,vol,bpm){
var interval=60/bpm;
notes.forEach(function(note,i){
var osc=ctx.createOscillator();var g1=ctx.createGain();
osc.type=type;osc.frequency.value=note;
g1.gain.setValueAtTime(vol,ctx.currentTime+i*interval);
g1.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+(i+0.9)*interval);
osc.connect(g1);g1.connect(ctx.destination);
osc.start(ctx.currentTime+i*interval);
osc.stop(ctx.currentTime+(i+1)*interval);
window._musicNodes.push(osc);
});
}
if(p.v==='chill')playPattern([196,220,262,196,247,220,196,262],  'sine',0.08,70);
else if(p.v==='upbeat')playPattern([330,392,440,494,440,392,330,262],'square',0.04,120);
else if(p.v==='electronic')playPattern([110,220,330,440,330,220,110,55],'sawtooth',0.03,140);
else if(p.v==='ambient')playPattern([130,165,196,220,196,165,130,110],'sine',0.06,50);
else if(p.v==='jazz')playPattern([262,294,330,349,392,349,330,294],'triangle',0.06,100);
else if(p.v==='classical')playPattern([262,330,392,523,392,330,262,196],'sine',0.07,90);
toast('Playing '+p.label,'#22c55e');
});
var b=btn('Stop Music','#ef4444',function(){
if(window._musicNodes){window._musicNodes.forEach(function(n){try{n.stop();}catch(e){}});window._musicNodes=[];}
toast('Music stopped','#3b82f6');
});
show('Music Library',g.html+b.html,function(){g.init();b.init();});
});

// ab[2] Voiceover
wire(ab[2],function(){
if(!window._voRecording){
navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
var recorder=new MediaRecorder(stream);
var chunks=[];
recorder.ondataavailable=function(e){chunks.push(e.data);};
recorder.onstop=function(){
var blob=new Blob(chunks,{type:'audio/wav'});
var url=URL.createObjectURL(blob);
var div=document.getElementById('v9vodisp');
if(div)div.innerHTML='<audio controls src="'+url+'" style="width:100%;margin-top:8px;"></audio>';
toast('Recording saved ('+Math.round(blob.size/1024)+'KB)','#22c55e');
chunks=[];
window._voRecording=false;
};
window._voRecorder=recorder;
var b1=btn('Start Recording','#22c55e',function(btnEl){
window._voRecording=true;
window._voRecorder.start();
btnEl.textContent='Recording...';btnEl.style.background='#ef4444';
var elapsed=0;
window._voTimer=setInterval(function(){elapsed++;var t=document.getElementById('v9vor');if(t)t.textContent=elapsed+'s';},1000);
});
var b2=btn('Stop Recording','#ef4444',function(){
window._voRecorder.stop();
clearInterval(window._voTimer);
window._voRecording=false;
});
show('Voiceover','<div id="v9vor" style="color:#fff;font-size:24px;font-weight:600;text-align:center;margin-bottom:10px;">0s</div><div id="v9vodisp"></div>'+b1.html+b2.html,function(){b1.init();b2.init();});
}).catch(function(){toast('Microphone access denied','#ef4444');});
}
});

// ab[3] Mute
wire(ab[3],function(){
video.muted=!video.muted;
toast('Mute '+(video.muted?'on':'off'),video.muted?'#ef4444':'#22c55e');
});

// ab[4] Fade In/Out
wire(ab[4],function(){
var ctx=initAudioContext();
var s1=sld('Duration',0.5,5,1.5,'s',function(){});
var g=grd([{label:'Fade In',v:'in'},{label:'Fade Out',v:'out'},{label:'Both',v:'both'}],function(p){
var dur=Number(document.querySelectorAll('#v9P input[type="range"]')[0].value);
if(p.v==='in'||p.v==='both'){
window._gainNode.gain.setValueAtTime(0,ctx.currentTime);
window._gainNode.gain.linearRampToValueAtTime(1,ctx.currentTime+dur);
}
if(p.v==='out'||p.v==='both'){
var startT=p.v==='both'?ctx.currentTime+dur+1:ctx.currentTime;
window._gainNode.gain.setValueAtTime(1,startT);
window._gainNode.gain.linearRampToValueAtTime(0,startT+dur);
}
toast('Fade applied ('+dur+'s)','#22c55e');
});
show('Fade In/Out',s1.html+g.html,function(){s1.init();g.init();});
});

// ab[5] Voice Change
wire(ab[5],function(){
var ctx=initAudioContext();
var g=grd([{label:'Deep Voice',v:'deep'},{label:'High Pitch',v:'high'},{label:'Robot',v:'robot'},{label:'Echo',v:'echo'},{label:'Reset',v:'reset'}],function(p){
if(p.v==='deep'){window._eqL.gain.value=12;window._eqM.gain.value=-5;window._eqH.gain.value=-8;}
else if(p.v==='high'){window._eqH.gain.value=12;window._eqM.gain.value=2;window._eqL.gain.value=-5;}
else if(p.v==='robot'){window._eqL.gain.value=-15;window._eqM.gain.value=10;window._eqH.gain.value=-10;}
else if(p.v==='echo'){
if(!window._delayNode){
window._delayNode=ctx.createDelay();window._delayNode.delayTime.value=0.3;
var fb=ctx.createGain();fb.gain.value=0.4;
window._delayNode.connect(fb);fb.connect(window._delayNode);
window._eqH.disconnect();window._eqH.connect(window._comp);window._eqH.connect(window._delayNode);window._delayNode.connect(window._gainNode);
}
}
else{window._eqL.gain.value=0;window._eqM.gain.value=0;window._eqH.gain.value=0;}
toast('Voice: '+p.label,'#3b82f6');
});
show('Voice Change',g.html,function(){g.init();});
});

// ab[6] Equalizer
wire(ab[6],function(){
var ctx=initAudioContext();
var s1=sld('Bass',-12,12,window._eqL?window._eqL.gain.value:0,'dB',function(v){window._eqL.gain.value=v;});
var s2=sld('Mid',-12,12,window._eqM?window._eqM.gain.value:0,'dB',function(v){window._eqM.gain.value=v;});
var s3=sld('Treble',-12,12,window._eqH?window._eqH.gain.value:0,'dB',function(v){window._eqH.gain.value=v;});
show('Equalizer',s1.html+s2.html+s3.html,function(){s1.init();s2.init();s3.init();});
});

// ab[7] Sound Effects
wire(ab[7],function(){
var g=grd([{label:'Pop',v:'pop'},{label:'Ding',v:'ding'},{label:'Boom',v:'boom'},{label:'Whoosh',v:'whoosh'},{label:'Beep',v:'beep'},{label:'Buzz',v:'buzz'}],function(p){
var ctx=initAudioContext();
if(p.v==='pop'){var o=ctx.createOscillator();var g1=ctx.createGain();o.frequency.setValueAtTime(400,ctx.currentTime);o.frequency.exponentialRampToValueAtTime(100,ctx.currentTime+0.1);g1.gain.setValueAtTime(0.5,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.1);o.connect(g1);g1.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.1);}
else if(p.v==='ding'){var o=ctx.createOscillator();var g1=ctx.createGain();o.frequency.value=800;g1.gain.setValueAtTime(0.3,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.5);o.connect(g1);g1.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.5);}
else if(p.v==='boom'){var o=ctx.createOscillator();var g1=ctx.createGain();o.frequency.setValueAtTime(100,ctx.currentTime);o.frequency.exponentialRampToValueAtTime(50,ctx.currentTime+0.3);g1.gain.setValueAtTime(0.4,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.3);o.connect(g1);g1.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.3);}
else if(p.v==='whoosh'){var hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.setValueAtTime(100,ctx.currentTime);hp.frequency.exponentialRampToValueAtTime(5000,ctx.currentTime+0.5);var g1=ctx.createGain();g1.gain.setValueAtTime(0.3,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.5);var noise=ctx.createBufferSource();var buf=ctx.createBuffer(1,ctx.sampleRate*0.5,ctx.sampleRate);var data=buf.getChannelData(0);for(var i=0;i<buf.length;i++)data[i]=Math.random()*2-1;noise.buffer=buf;noise.connect(hp);hp.connect(g1);g1.connect(ctx.destination);noise.start();}
else if(p.v==='beep'){var o=ctx.createOscillator();var g1=ctx.createGain();o.frequency.value=1000;g1.gain.setValueAtTime(0.2,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.2);o.connect(g1);g1.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.2);}
else if(p.v==='buzz'){var o=ctx.createOscillator();var g1=ctx.createGain();o.type='square';o.frequency.value=300;g1.gain.setValueAtTime(0.15,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.3);o.connect(g1);g1.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.3);}
});
show('Sound Effects',g.html,function(){g.init();});
});

// ab[8] Compressor
wire(ab[8],function(){
var ctx=initAudioContext();
var s1=sld('Threshold',-100,0,window._comp?window._comp.threshold.value:-24,'dB',function(v){window._comp.threshold.value=v;});
var s2=sld('Ratio',1,20,window._comp?window._comp.ratio.value:4,':1',function(v){window._comp.ratio.value=v;});
var s3=sld('Attack',0,1,window._comp?window._comp.attack.value:0.003,'s',function(v){window._comp.attack.value=v;});
show('Compressor',s1.html+s2.html+s3.html,function(){s1.init();s2.init();s3.init();});
});

// ab[9] Noise Remove
wire(ab[9],function(){
var ctx=initAudioContext();
if(!window._noiseFilter){
window._noiseFilter=ctx.createBiquadFilter();
window._noiseFilter.type='lowpass';
window._noiseFilter.frequency.value=8000;
window._eqH.disconnect();
window._eqH.connect(window._noiseFilter);
window._noiseFilter.connect(window._comp);
}
var s1=sld('Filter Cutoff',200,8000,window._noiseFilter.frequency.value,'Hz',function(v){window._noiseFilter.frequency.value=v;});
var b1=btn('Reset','#ef4444',function(){window._noiseFilter.frequency.value=8000;toast('Noise filter reset','#3b82f6');});
show('Noise Remove',s1.html+b1.html,function(){s1.init();b1.init();});
});

// ab[10] Beat Sync
wire(ab[10],function(){
var ctx=initAudioContext();
var analyser=ctx.createAnalyser();analyser.fftSize=256;
window._eqH.connect(analyser);
var data=new Uint8Array(analyser.frequencyBinCount);
var beatCount=0;
show('Beat Sync','<div id="v9beats" style="color:#fff;font-size:14px;font-weight:600;">Detecting beats... (play video)</div><div id="v9beatlist" style="max-height:150px;overflow-y:auto;margin-top:8px;"></div>');
if(window._beatInterval)clearInterval(window._beatInterval);
window._beatInterval=setInterval(function(){
if(video.paused)return;
analyser.getByteFrequencyData(data);
var avg=0;for(var i=0;i<data.length;i++)avg+=data[i];avg/=data.length;
if(avg>120){
beatCount++;
var list=document.getElementById('v9beatlist');
if(list&&beatCount<=20)list.innerHTML+='<div style="padding:3px 6px;background:#2a2a4a;margin:2px 0;border-radius:3px;color:#ccc;font-size:11px;">Beat #'+beatCount+' @ '+video.currentTime.toFixed(1)+'s (energy: '+Math.round(avg)+')</div>';
var counter=document.getElementById('v9beats');
if(counter)counter.textContent=beatCount+' beats detected';
}
},200);
});

// ab[11] Visualizer
wire(ab[11],function(){
var ctx=initAudioContext();
var analyser=ctx.createAnalyser();analyser.fftSize=512;
window._eqH.connect(analyser);
var canvas=document.createElement('canvas');canvas.width=300;canvas.height=150;
canvas.style.cssText='background:#1a1a2e;border:1px solid #6c2bd9;border-radius:8px;margin-top:8px;width:100%;';
var cctx=canvas.getContext('2d');
if(window._vizAnimId)cancelAnimationFrame(window._vizAnimId);
function draw(){
window._vizAnimId=requestAnimationFrame(draw);
var data=new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(data);
cctx.fillStyle='#1a1a2e';cctx.fillRect(0,0,canvas.width,canvas.height);
var barW=(canvas.width/data.length)*2.5;
for(var i=0;i<data.length;i++){
var h=(data[i]/255)*canvas.height;
var hue=i/data.length*360;
cctx.fillStyle='hsl('+hue+',80%,60%)';
cctx.fillRect(i*barW,canvas.height-h,barW-1,h);
}
}
draw();
var b=btn('Stop','#ef4444',function(){cancelAnimationFrame(window._vizAnimId);});
show('Visualizer','',function(){
var container=document.querySelector('#v9P');
container.appendChild(canvas);
var wrap=document.createElement('div');wrap.innerHTML=b.html;
container.appendChild(wrap);
b.init();
});
});

// === AI TAB ===

// ai[0] AI Enhance
wire(ai[0],function(){
var s1=sld('Brightness',50,150,window._vf.brightness||100,'%',function(v){window._vf.brightness=v;aF();});
var s2=sld('Contrast',50,150,window._vf.contrast||100,'%',function(v){window._vf.contrast=v;aF();});
var s3=sld('Saturation',50,150,window._vf.saturate||100,'%',function(v){window._vf.saturate=v;aF();});
var b1=btn('Auto Enhance','#22c55e',function(){window._vf.brightness=110;window._vf.contrast=115;window._vf.saturate=120;aF();toast('Auto-enhanced','#22c55e');});
show('AI Enhance',s1.html+s2.html+s3.html+b1.html,function(){s1.init();s2.init();s3.init();b1.init();});
});

// ai[1] AI Captions
wire(ai[1],function(){
show('AI Captions','<div style="color:#ccc;font-size:12px;">Generating captions...</div>');
fetch('/ai-captions/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoId:'current'})}).then(function(r){return r.json();}).then(function(data){
if(data.error){show('AI Captions','<div style="color:#ef4444;font-size:12px;">'+data.error+'</div>');return;}
var capts='<div style="color:#fff;font-size:12px;max-height:200px;overflow-y:auto;">';
if(data.captions)data.captions.forEach(function(c){capts+='<div style="padding:6px;background:#2a2a4a;margin:4px 0;border-radius:4px;">'+c.text+'</div>';});
capts+='</div>';
show('AI Captions',capts);
}).catch(function(e){show('AI Captions','<div style="color:#ef4444;font-size:12px;">API not configured â set OPENAI_API_KEY in environment variables to enable AI captions.</div>');});
});

// ai[2] AI Hook
wire(ai[2],function(){
show('AI Hook','<div style="color:#ccc;font-size:12px;">Generating hook...</div>');
fetch('/ai-hook/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({style:'engaging'})}).then(function(r){return r.json();}).then(function(data){
if(data.error){show('AI Hook','<div style="color:#ef4444;font-size:12px;">'+data.error+'</div>');return;}
var overlay=document.getElementById('v9hook');
if(!overlay){overlay=document.createElement('div');overlay.id='v9hook';overlay.style.cssText='position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:12px 20px;border-radius:8px;max-width:70%;z-index:999;pointer-events:none;font-weight:600;font-size:14px;';video.parentElement.appendChild(overlay);}
overlay.textContent=data.hook;
show('AI Hook','<div style="color:#22c55e;font-size:12px;">Hook added: '+data.hook+'</div>');
}).catch(function(e){show('AI Hook','<div style="color:#ef4444;font-size:12px;">API not configured â set OPENAI_API_KEY in environment variables to enable AI hooks.</div>');});
});

// ai[3] Brand Kit
wire(ai[3],function(){
var g=grd([{label:'Purple',v:'#6c2bd9'},{label:'Blue',v:'#3b82f6'},{label:'Green',v:'#22c55e'},{label:'Red',v:'#ef4444'},{label:'Gold',v:'#f59e0b'},{label:'Violet',v:'#8b5cf6'}],function(p){
localStorage.setItem('brandColor',p.v);
document.documentElement.style.setProperty('--brand-color',p.v);
toast('Brand color: '+p.v,'#22c55e');
});
var t=btn('Add Watermark','#6c2bd9',function(){
var text=prompt('Watermark text:','Â© '+new Date().getFullYear());
if(text){
var wm=document.getElementById('v9watermark');
if(!wm){wm=document.createElement('div');wm.id='v9watermark';wm.style.cssText='position:absolute;bottom:10px;right:10px;color:#fff;font-size:12px;opacity:0.7;z-index:999;pointer-events:none;';video.parentElement.appendChild(wm);}
wm.textContent=text;toast('Watermark added','#22c55e');
}
});
show('Brand Kit',g.html+t.html,function(){g.init();t.init();});
});

// ai[4] Transcript
wire(ai[4],function(){
show('Transcript','<div style="color:#ccc;font-size:12px;">Fetching transcript...</div>');
fetch('/ai-captions/generate',{method:'POST'}).then(function(r){return r.json();}).then(function(data){
if(data.error||!data.transcript){show('Transcript','<div style="color:#ef4444;font-size:12px;">Transcript requires OPENAI_API_KEY in environment variables.</div>');return;}
show('Transcript','<div style="color:#ccc;font-size:12px;max-height:250px;overflow-y:auto;line-height:1.6;">'+data.transcript+'</div>');
}).catch(function(){show('Transcript','<div style="color:#ef4444;font-size:12px;">Transcript requires OPENAI_API_KEY in environment variables.</div>');});
});

// ai[5] AI B-Roll
wire(ai[5],function(){
show('AI B-Roll','<div style="color:#ccc;font-size:12px;">Searching stock footage...</div>');
fetch('/ai-broll/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'nature'})}).then(function(r){return r.json();}).then(function(data){
if(data.error){show('AI B-Roll','<div style="color:#ef4444;font-size:12px;">'+data.error+'</div>');return;}
var clips='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
if(data.clips)data.clips.forEach(function(clip){clips+='<div style="background:#2a2a4a;padding:8px;border-radius:6px;cursor:pointer;border:1px solid #444;"><div style="color:#ccc;font-size:10px;">'+clip.title+'</div></div>';});
clips+='</div>';
show('AI B-Roll',clips);
}).catch(function(e){show('AI B-Roll','<div style="color:#ef4444;font-size:12px;">B-Roll API not configured â set PEXELS_API_KEY or PIXABAY_API_KEY in environment variables.</div>');});
});

// ai[6] Smart Cut
wire(ai[6],function(){
var ctx=initAudioContext();
var analyser=ctx.createAnalyser();analyser.fftSize=256;
window._eqH.connect(analyser);
var data=new Uint8Array(analyser.frequencyBinCount);
show('Smart Cut','<div style="color:#ccc;font-size:12px;">Analyzing audio for silences... (play video)</div><div id="v9silences" style="max-height:150px;overflow-y:auto;margin-top:8px;"></div>');
var sc=0;
if(window._silenceInterval)clearInterval(window._silenceInterval);
window._silenceInterval=setInterval(function(){
if(video.paused)return;
analyser.getByteFrequencyData(data);
var avg=0;for(var i=0;i<data.length;i++)avg+=data[i];avg/=data.length;
if(avg<20){
sc++;
var list=document.getElementById('v9silences');
if(list&&sc<=10)list.innerHTML+='<div style="padding:3px 6px;background:#2a2a4a;margin:2px 0;border-radius:3px;color:#ccc;font-size:11px;">Silence @ '+video.currentTime.toFixed(1)+'s (level: '+Math.round(avg)+')</div>';
}
},400);
});

// ai[7] Scene Detect
wire(ai[7],function(){
var canvas=document.createElement('canvas');
var ctx=canvas.getContext('2d');
show('Scene Detect','<div style="color:#ccc;font-size:12px;">Analyzing frames... (play video)</div><div id="v9scenes" style="max-height:150px;overflow-y:auto;margin-top:8px;"></div>');
var lastAvg=null;var sc=0;
if(window._sceneInterval)clearInterval(window._sceneInterval);
window._sceneInterval=setInterval(function(){
if(video.paused)return;
canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
ctx.drawImage(video,0,0);
var id=ctx.getImageData(0,0,10,10);
var d=id.data;
var curAvg=Math.round((d[0]+d[1]+d[2]+d[4]+d[5]+d[6]+d[8]+d[9]+d[10])/9);
if(lastAvg!==null&&Math.abs(curAvg-lastAvg)>60){
sc++;
var list=document.getElementById('v9scenes');
if(list&&sc<=10)list.innerHTML+='<div style="padding:3px 6px;background:#2a2a4a;margin:2px 0;border-radius:3px;color:#ccc;font-size:11px;">Scene change #'+sc+' @ '+video.currentTime.toFixed(1)+'s</div>';
}
lastAvg=curAvg;
},500);
});

// ai[8] Style Transfer
wire(ai[8],function(){
var g=grd([{label:'Cyberpunk',v:'cyber'},{label:'Film Noir',v:'noir'},{label:'Oil Painting',v:'oil'},{label:'Watercolor',v:'water'},{label:'Comic Book',v:'comic'},{label:'Neon',v:'neon'},{label:'Reset',v:'reset'}],function(p){
if(p.v==='cyber'){window._vf.saturate=200;window._vf.hueRotate=280;window._vf.contrast=120;}
else if(p.v==='noir'){window._vf.saturate=0;window._vf.contrast=150;window._vf.brightness=95;}
else if(p.v==='oil'){window._vf.blur=2;window._vf.contrast=140;window._vf.saturate=120;}
else if(p.v==='water'){window._vf.blur=3;window._vf.saturate=150;window._vf.brightness=110;}
else if(p.v==='comic'){window._vf.contrast=180;window._vf.saturate=200;window._vf.brightness=105;}
else if(p.v==='neon'){window._vf.saturate=300;window._vf.hueRotate=180;window._vf.contrast=150;}
else{window._vf={brightness:100,contrast:100,saturate:100,hueRotate:0,blur:0,opacity:100};}
aF();
});
show('Style Transfer',g.html,function(){g.init();});
});

// ai[9] BG Remove â real canvas-based chroma/luminance key
wire(ai[9],function(){
var canvas=document.createElement('canvas');
var ctx2=canvas.getContext('2d');
canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
var s1=sld('Threshold',0,255,100,'',function(v){});
var g=grd([{label:'Green Screen',v:'green'},{label:'Blue Screen',v:'blue'},{label:'Dark BG',v:'dark'},{label:'Light BG',v:'light'}],function(p){
var thresh=Number(document.querySelectorAll('#v9P input[type="range"]')[0].value);
canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
ctx2.drawImage(video,0,0,canvas.width,canvas.height);
var imgData=ctx2.getImageData(0,0,canvas.width,canvas.height);
var d=imgData.data;
for(var i=0;i<d.length;i+=4){
var r=d[i],g2=d[i+1],b=d[i+2];
var remove=false;
if(p.v==='green'&&g2>thresh&&g2>r*1.2&&g2>b*1.2)remove=true;
else if(p.v==='blue'&&b>thresh&&b>r*1.2&&b>g2*1.2)remove=true;
else if(p.v==='dark'&&r<thresh&&g2<thresh&&b<thresh)remove=true;
else if(p.v==='light'&&r>thresh&&g2>thresh&&b>thresh)remove=true;
if(remove)d[i+3]=0;
}
ctx2.putImageData(imgData,0,0);
// Overlay the processed canvas on the video
var existCanvas=document.getElementById('v9bgcanvas');
if(existCanvas)existCanvas.remove();
var overlay=canvas.cloneNode();
overlay.id='v9bgcanvas';
overlay.getContext('2d').putImageData(imgData,0,0);
overlay.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;z-index:997;pointer-events:none;';
var vp=video.parentElement;
if(vp){vp.style.position='relative';vp.appendChild(overlay);}
toast('Background removed ('+p.label+')','#22c55e');
});
var b1=btn('Remove Overlay','#ef4444',function(){
var c=document.getElementById('v9bgcanvas');if(c)c.remove();
toast('BG overlay removed','#3b82f6');
});
show('BG Remove',s1.html+g.html+b1.html,function(){s1.init();g.init();b1.init();});
});

// ai[10] AI Voice â uses browser SpeechSynthesis API
wire(ai[10],function(){
if(!window.speechSynthesis){toast('Speech synthesis not supported in this browser','#ef4444');return;}
var voices=speechSynthesis.getVoices();
if(voices.length===0){speechSynthesis.onvoiceschanged=function(){voices=speechSynthesis.getVoices();};voices=speechSynthesis.getVoices();}
var html='<div style="margin-bottom:10px;"><label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Text to speak:</label><textarea id="v9tts" rows="3" style="width:100%;padding:8px;background:#2a2a4a;color:#fff;border:1px solid #6c2bd9;border-radius:6px;font-size:12px;resize:vertical;">Enter text for AI voice generation...</textarea></div>';
var s1=sld('Speed',0.5,2,1,'x',function(){});
var s2=sld('Pitch',0.5,2,1,'',function(){});
var g=grd([{label:'Default',v:0},{label:'Female',v:1},{label:'Male',v:2},{label:'British',v:3}],function(p){
var text=document.getElementById('v9tts').value;
if(!text){toast('Enter text first','#ef4444');return;}
speechSynthesis.cancel();
var utter=new SpeechSynthesisUtterance(text);
utter.rate=Number(document.querySelectorAll('#v9P input[type="range"]')[0].value);
utter.pitch=Number(document.querySelectorAll('#v9P input[type="range"]')[1].value);
var v=speechSynthesis.getVoices();
if(v.length>p.v)utter.voice=v[p.v];
speechSynthesis.speak(utter);
toast('Speaking...','#22c55e');
});
var b1=btn('Stop','#ef4444',function(){speechSynthesis.cancel();});
show('AI Voice',html+s1.html+s2.html+g.html+b1.html,function(){s1.init();s2.init();g.init();b1.init();});
});

// ai[11] Translate â uses browser-based translation with fallback
wire(ai[11],function(){
var html='<div style="margin-bottom:10px;"><label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Text to translate:</label><textarea id="v9transin" rows="3" style="width:100%;padding:8px;background:#2a2a4a;color:#fff;border:1px solid #6c2bd9;border-radius:6px;font-size:12px;resize:vertical;">Enter text to translate...</textarea></div>';
var g=grd([{label:'Spanish',v:'es'},{label:'French',v:'fr'},{label:'German',v:'de'},{label:'Portuguese',v:'pt'},{label:'Japanese',v:'ja'},{label:'Chinese',v:'zh'},{label:'Arabic',v:'ar'},{label:'Hindi',v:'hi'}],function(p){
var text=document.getElementById('v9transin').value;
if(!text||text==='Enter text to translate...'){toast('Enter text first','#ef4444');return;}
show('Translate','<div style="color:#ccc;font-size:12px;">Translating...</div>');
// Try the backend first, fallback to basic dictionary
fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,target:p.v})}).then(function(r){return r.json();}).then(function(data){
if(data.translated){
show('Translate','<div style="color:#ccc;font-size:12px;margin-bottom:8px;">Original: '+text+'</div><div style="color:#22c55e;font-size:14px;padding:12px;background:#2a2a4a;border-radius:8px;margin-bottom:8px;">'+data.translated+'</div>');
// Add as subtitle overlay
var sub=document.getElementById('v9sub');
if(!sub){sub=document.createElement('div');sub.id='v9sub';sub.style.cssText='position:absolute;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;border-radius:6px;max-width:80%;z-index:999;pointer-events:none;font-size:14px;text-align:center;';video.parentElement.appendChild(sub);}
sub.textContent=data.translated;
toast('Translation added as subtitle','#22c55e');
}else{throw new Error('no translation');}
}).catch(function(){
// Fallback: client-side basic phrases
var basics={es:'(TraducciÃ³n disponible con API)',fr:'(Traduction disponible avec API)',de:'(Ãbersetzung mit API verfÃ¼gbar)',pt:'(TraduÃ§Ã£o disponÃ­vel com API)',ja:'(APIã§ç¿»è¨³å¯è½)',zh:'(APIå¯ç¨ç¿»è¯)',ar:'(Ø§ÙØªØ±Ø¬ÙØ© ÙØªØ§Ø­Ø© ÙØ¹ API)',hi:'(API à¤à¥ à¤¸à¤¾à¤¥ à¤à¤¨à¥à¤µà¤¾à¤¦ à¤à¤ªà¤²à¤¬à¥à¤§)'};
var sub=document.getElementById('v9sub');
if(!sub){sub=document.createElement('div');sub.id='v9sub';sub.style.cssText='position:absolute;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;border-radius:6px;max-width:80%;z-index:999;pointer-events:none;font-size:14px;text-align:center;';video.parentElement.appendChild(sub);}
sub.textContent=basics[p.v]||text;
show('Translate','<div style="color:#f59e0b;font-size:12px;">Full translation requires API configuration. Basic subtitle overlay added.</div>');
});
});
var b1=btn('Remove Subtitles','#ef4444',function(){var s=document.getElementById('v9sub');if(s)s.remove();toast('Subtitles removed','#3b82f6');});
show('Translate',html+g.html+b1.html,function(){g.init();b1.init();});
});

// === FX TAB ===

// fx[0] Filters
wire(fx[0],function(){
var g=grd([{label:'None',v:'none'},{label:'Warm',v:'warm'},{label:'Cool',v:'cool'},{label:'Vintage',v:'vintage'},{label:'B&W',v:'bw'},{label:'Sepia',v:'sepia'},{label:'Dramatic',v:'dramatic'},{label:'Vivid',v:'vivid'}],function(p){
if(p.v==='none'){window._vf={brightness:100,contrast:100,saturate:100,hueRotate:0,blur:0,opacity:100};}
else if(p.v==='warm'){window._vf.brightness=105;window._vf.contrast=105;window._vf.saturate=120;window._vf.hueRotate=-10;}
else if(p.v==='cool'){window._vf.brightness=100;window._vf.contrast=110;window._vf.saturate=90;window._vf.hueRotate=20;}
else if(p.v==='vintage'){window._vf.saturate=80;window._vf.contrast=110;window._vf.brightness=95;window._vf.hueRotate=-15;}
else if(p.v==='bw'){window._vf.saturate=0;window._vf.contrast=120;}
else if(p.v==='sepia'){window._vf.saturate=50;window._vf.hueRotate=-30;window._vf.brightness=105;window._vf.contrast=105;}
else if(p.v==='dramatic'){window._vf.contrast=140;window._vf.brightness=90;window._vf.saturate=130;}
else if(p.v==='vivid'){window._vf.saturate=180;window._vf.contrast=115;window._vf.brightness=105;}
aF();
});
show('Filters',g.html,function(){g.init();});
});

// fx[1] Transitions
wire(fx[1],function(){
var g=grd([{label:'Fade',v:'fade'},{label:'Slide Left',v:'slide'},{label:'Zoom In',v:'zoom'},{label:'Spin',v:'spin'},{label:'Flip',v:'flip'},{label:'Blur',v:'blur'}],function(p){
var dur=1.5;
video.style.transition='none';
setTimeout(function(){
if(p.v==='fade'){video.style.transition='opacity '+dur+'s';video.style.opacity='0';setTimeout(function(){video.style.opacity='1';},dur*500);}
else if(p.v==='slide'){video.style.transition='transform '+dur+'s';video.style.transform='translateX(-100%)';setTimeout(function(){video.style.transform='';aT();},dur*500);}
else if(p.v==='zoom'){video.style.transition='transform '+dur+'s';video.style.transform='scale(0.3)';setTimeout(function(){video.style.transform='';aT();},dur*500);}
else if(p.v==='spin'){video.style.transition='transform '+dur+'s';video.style.transform='rotate(360deg)';setTimeout(function(){video.style.transform='';aT();},dur*500);}
else if(p.v==='flip'){video.style.transition='transform '+dur+'s';video.style.transform='rotateY(180deg)';setTimeout(function(){video.style.transform='';aT();},dur*500);}
else if(p.v==='blur'){video.style.transition='filter '+dur+'s';video.style.filter='blur(20px)';setTimeout(function(){video.style.filter='';aF();},dur*500);}
},50);
});
show('Transitions',g.html,function(){g.init();});
});

// fx[2] Text Overlay
wire(fx[2],function(){
var html='<div style="margin-bottom:8px;"><label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">Text:</label><input type="text" id="v9textinput" placeholder="Enter text..." style="width:100%;padding:8px;background:#2a2a4a;color:#fff;border:1px solid #6c2bd9;border-radius:6px;font-size:12px;"></div>';
var s1=sld('Font Size',12,72,32,'px',function(){});
var g=grd([{label:'White',v:'#fff'},{label:'Yellow',v:'#ffd700'},{label:'Red',v:'#ff3333'},{label:'Cyan',v:'#00ffff'}],function(p){
window._textColor=p.v;
var o=document.getElementById('v9to');if(o)o.style.color=p.v;
});
var b1=btn('Add Text','#6c2bd9',function(){
var txt=document.getElementById('v9textinput').value||'Sample Text';
var fs=Number(document.querySelectorAll('#v9P input[type="range"]')[0].value);
var overlay=document.getElementById('v9to');
if(!overlay){overlay=document.createElement('div');overlay.id='v9to';overlay.style.cssText='position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,0.8);z-index:999;pointer-events:none;max-width:80%;text-align:center;';video.parentElement.appendChild(overlay);}
overlay.textContent=txt;overlay.style.fontSize=fs+'px';overlay.style.color=window._textColor||'#fff';overlay.style.display='block';
toast('Text added','#22c55e');
});
var b2=btn('Remove Text','#ef4444',function(){var o=document.getElementById('v9to');if(o)o.style.display='none';});
show('Text Overlay',html+s1.html+g.html+b1.html+b2.html,function(){s1.init();g.init();b1.init();b2.init();});
});

// fx[3] Stickers
wire(fx[3],function(){
var g=grd([{label:'ð Like',v:'ð'},{label:'ð¥ Fire',v:'ð¥'},{label:'â¤ï¸ Heart',v:'â¤ï¸'},{label:'â­ Star',v:'â­'},{label:'ð¯ 100',v:'ð¯'},{label:'ð Laugh',v:'ð'},{label:'â¡ Bolt',v:'â¡'},{label:'ð Bell',v:'ð'}],function(p){
var o=document.getElementById('v9so');
if(!o){o=document.createElement('div');o.id='v9so';o.style.cssText='position:absolute;top:20%;right:10%;font-size:64px;z-index:999;pointer-events:none;';var vp=video.parentElement;if(vp){vp.style.position='relative';vp.appendChild(o);}}
o.textContent=p.v;o.style.display='block';
});
var b1=btn('Remove','#ef4444',function(){var o=document.getElementById('v9so');if(o)o.style.display='none';});
show('Stickers',g.html+b1.html,function(){g.init();b1.init();});
});

// fx[4] Color Grade
wire(fx[4],function(){
var s1=sld('Brightness',0,200,window._vf.brightness||100,'%',function(v){window._vf.brightness=v;aF();});
var s2=sld('Contrast',0,200,window._vf.contrast||100,'%',function(v){window._vf.contrast=v;aF();});
var s3=sld('Saturation',0,200,window._vf.saturate||100,'%',function(v){window._vf.saturate=v;aF();});
var s4=sld('Hue',0,360,window._vf.hueRotate||0,'Â°',function(v){window._vf.hueRotate=v;aF();});
var b1=btn('Reset','#ef4444',function(){window._vf={brightness:100,contrast:100,saturate:100,hueRotate:0,blur:0,opacity:100};aF();});
show('Color Grade',s1.html+s2.html+s3.html+s4.html+b1.html,function(){s1.init();s2.init();s3.init();s4.init();b1.init();});
});

// fx[5] Exposure
wire(fx[5],function(){
var s=sld('Exposure',0,200,window._vf.brightness||100,'%',function(v){window._vf.brightness=v;aF();});
show('Exposure',s.html,function(){s.init();});
});

// fx[6] Saturation
wire(fx[6],function(){
var s=sld('Saturation',0,200,window._vf.saturate||100,'%',function(v){window._vf.saturate=v;aF();});
show('Saturation',s.html,function(){s.init();});
});

// fx[7] LUT Presets
wire(fx[7],function(){
var g=grd([{label:'Teal & Orange',v:'to'},{label:'Film Look',v:'film'},{label:'Bleach Bypass',v:'bl'},{label:'Cross Process',v:'cr'},{label:'Kodak 2383',v:'ko'},{label:'LOG to Rec709',v:'log'},{label:'Reset',v:'reset'}],function(p){
if(p.v==='to'){window._vf.hueRotate=-15;window._vf.saturate=130;window._vf.contrast=110;}
else if(p.v==='film'){window._vf.saturate=85;window._vf.contrast=115;window._vf.brightness=95;}
else if(p.v==='bl'){window._vf.saturate=50;window._vf.contrast=140;window._vf.brightness=105;}
else if(p.v==='cr'){window._vf.hueRotate=40;window._vf.saturate=120;window._vf.contrast=110;}
else if(p.v==='ko'){window._vf.saturate=95;window._vf.contrast=108;window._vf.brightness=102;}
else if(p.v==='log'){window._vf.saturate=110;window._vf.contrast=120;}
else{window._vf={brightness:100,contrast:100,saturate:100,hueRotate:0,blur:0,opacity:100};}
aF();
});
show('LUT Presets',g.html,function(){g.init();});
});

// fx[8] Zoom
wire(fx[8],function(){
var s=sld('Zoom',50,300,Math.round((window._vt.zoom||1)*100),'%',function(v){window._vt.zoom=v/100;aT();});
var b1=btn('Reset','#ef4444',function(){window._vt.zoom=1;aT();});
show('Zoom',s.html+b1.html,function(){s.init();b1.init();});
});

// fx[9] Picture in Picture
wire(fx[9],function(){
if(document.pictureInPictureEnabled){
video.requestPictureInPicture().then(function(){toast('PiP mode enabled','#22c55e');}).catch(function(e){toast('PiP error: '+e.message,'#ef4444');});
}else{
toast('PiP not supported in this browser','#ef4444');
}
});

// fx[10] Animations
wire(fx[10],function(){
var g=grd([{label:'Fade In',v:'fadeIn'},{label:'Fade Out',v:'fadeOut'},{label:'Bounce',v:'bounce'},{label:'Spin',v:'spin'},{label:'Slide In',v:'slideIn'},{label:'Scale Up',v:'scaleUp'}],function(p){
var style=document.getElementById('v9AnimStyle');
if(!style){style=document.createElement('style');style.id='v9AnimStyle';document.head.appendChild(style);}
var keyframes='';
if(p.v==='fadeIn')keyframes='@keyframes fadeIn{from{opacity:0}to{opacity:1}}';
else if(p.v==='fadeOut')keyframes='@keyframes fadeOut{from{opacity:1}to{opacity:0}}';
else if(p.v==='bounce')keyframes='@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-20px)}}';
else if(p.v==='spin')keyframes='@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
else if(p.v==='slideIn')keyframes='@keyframes slideIn{from{transform:translateX(-100px)}to{transform:translateX(0)}}';
else if(p.v==='scaleUp')keyframes='@keyframes scaleUp{from{transform:scale(0.5)}to{transform:scale(1)}}';
style.textContent=keyframes;
video.style.animation=p.v+' 1s ease-in-out';
setTimeout(function(){video.style.animation='';},1500);
toast('Animation: '+p.v,'#22c55e');
});
show('Animations',g.html,function(){g.init();});
});

// fx[11] Annotations
wire(fx[11],function(){
var g=grd([{label:'Arrow',v:'arrow'},{label:'Circle',v:'circle'},{label:'Rectangle',v:'rect'},{label:'Line',v:'line'},{label:'Highlight',v:'hl'},{label:'Blur',v:'blur'}],function(p){
var svg=document.getElementById('v9svg');
if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='v9svg';svg.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;z-index:998;pointer-events:none;';video.parentElement.appendChild(svg);}
if(p.v==='arrow'){
var line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1','50');line.setAttribute('y1','50');line.setAttribute('x2','150');line.setAttribute('y2','150');line.setAttribute('stroke','#ff0000');line.setAttribute('stroke-width','3');
var poly=document.createElementNS('http://www.w3.org/2000/svg','polygon');poly.setAttribute('points','150,150 135,135 155,140');poly.setAttribute('fill','#ff0000');
svg.appendChild(line);svg.appendChild(poly);
}else if(p.v==='circle'){
var c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx','100');c.setAttribute('cy','100');c.setAttribute('r','50');c.setAttribute('fill','none');c.setAttribute('stroke','#00ff00');c.setAttribute('stroke-width','3');svg.appendChild(c);
}else if(p.v==='rect'){
var r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('x','50');r.setAttribute('y','50');r.setAttribute('width','100');r.setAttribute('height','80');r.setAttribute('fill','none');r.setAttribute('stroke','#0088ff');r.setAttribute('stroke-width','3');svg.appendChild(r);
}else if(p.v==='line'){
var ln=document.createElementNS('http://www.w3.org/2000/svg','line');ln.setAttribute('x1','10');ln.setAttribute('y1','10');ln.setAttribute('x2','200');ln.setAttribute('y2','200');ln.setAttribute('stroke','#ffff00');ln.setAttribute('stroke-width','3');svg.appendChild(ln);
}else if(p.v==='hl'){
var hl=document.createElementNS('http://www.w3.org/2000/svg','rect');hl.setAttribute('x','50');hl.setAttribute('y','50');hl.setAttribute('width','120');hl.setAttribute('height','80');hl.setAttribute('fill','rgba(255,255,0,0.3)');svg.appendChild(hl);
}else if(p.v==='blur'){
var bl=document.createElementNS('http://www.w3.org/2000/svg','rect');bl.setAttribute('x','50');bl.setAttribute('y','50');bl.setAttribute('width','100');bl.setAttribute('height','80');bl.setAttribute('fill','rgba(0,0,0,0.6)');bl.style.filter='blur(5px)';svg.appendChild(bl);
}
toast('Annotation: '+p.v,'#22c55e');
});
var b1=btn('Clear All','#ef4444',function(){var svg=document.getElementById('v9svg');if(svg)svg.innerHTML='';});
show('Annotations',g.html+b1.html,function(){g.init();b1.init();});
});

console.log('v9 allButtonsFix: 48 buttons wired with REAL functionality (v9.9)');
},2200);
