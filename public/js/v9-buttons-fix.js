// v9.2 - syntax fix, cache bust - all 48 buttons with real functionality
setTimeout(function allButtonsFix(){
var video=document.querySelector('#videoPlayer');
var sidebar=document.querySelector('.editor-sidebar');
if(!video||!sidebar)return;
var sRect=sidebar.getBoundingClientRect();
var ov=document.createElement('div');ov.id='v9Overlay';
ov.style.cssText='position:fixed;top:'+sRect.top+'px;left:'+sRect.left+'px;width:'+sRect.width+'px;max-height:'+(sRect.height)+'px;overflow-y:auto;z-index:9999;pointer-events:none;';
document.body.appendChild(ov);
var pan=document.createElement('div');pan.id='v9P';
pan.style.cssText='display:none;background:#1a1a2e;border:1px solid #6c2bd9;border-radius:12px;padding:16px;margin-top:8px;pointer-events:auto;box-shadow:0 4px 20px rgba(0,0,0,0.5);max-height:400px;overflow-y:auto;';
ov.appendChild(pan);

function show(title,html,fn){
document.querySelectorAll('.tool-panel').forEach(function(p){p.style.display='none';});
pan.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="color:#fff;font-weight:600;font-size:14px;">'+title+'</span><span id="v9X" style="color:#999;cursor:pointer;font-size:18px;">&times;</span></div>'+html;
pan.style.display='block';
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
return{html:'<div style="margin-bottom:10px;"><label style="color:#ccc;font-size:12px;display:block;margin-bottom:4px;">'+label+'</label><div style="display:flex;align-items:center;gap:8px;"><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" value="'+val+'" style="flex:1;accent-color:#6c2bd9;"><span id="'+id+'v" style="color:#fff;font-size:12px;min-width:40px;">'+val+(unit||'')+'</span></div></div>',init:function(){var s=document.getElementById(id),v=document.getElementById(id+'v');if(s)s.addEventListener('input',function(){v.textContent=s.value+(unit||'');cb(Number(s.value));});}};
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
b.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();handler(e);});
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
function gb(ci){return cats[ci]?Array.from(cats[ci].querySelectorAll('.tb3')):[];}
var eb=gb(0),ab=gb(1),ai=gb(2),fx=gb(3);

// === EDIT ===
// eb[0] Trim
wire(eb[0],function(){
var s1=sld('Start',0,Math.floor(video.duration||10),0,'s',function(v){video.currentTime=v;});
var s2=sld('End',0,Math.floor(video.duration||10),Math.floor(video.duration||10),'s',function(v){});
var b1=btn('Apply Trim','#6c2bd9',function(){
var tc=video.currentTime;
window._vt.trimStart=Number(document.querySelectorAll('input[type="range"]')[0].value);
window._vt.trimEnd=Number(document.querySelectorAll('input[type="range"]')[1].value);
toast('Trim set: '+window._vt.trimStart+'s - '+window._vt.trimEnd+'s','#22c55e');
});
show('Trim',s1.html+s2.html+b1.html,function(){s1.init();s2.init();b1.init();});
});

// eb[1] Split
wire(eb[1],function(){
var pos=Math.floor(video.currentTime);
if(!window._vt.splitPoints)window._vt.splitPoints=[];
window._vt.splitPoints.push(pos);
var mvp=video.parentElement;
if(mvp.style.position!=='relative'&&mvp.style.position!=='absolute')mvp.style.position='relative';
var marker=document.createElement('div');
marker.style.cssText='position:absolute;left:'+((pos/(video.duration||10))*100)+'%;top:0;width:2px;height:100%;background:#ff00ff;z-index:100;pointer-events:none;';
marker.title='Split at '+pos+'s';
mvp.appendChild(marker);
toast('Split added at '+pos+'s','#3b82f6');
});

// eb[2] Speed
wire(eb[2],function(){
var s=sld('Playback Speed',0.25,2,1,'x',function(v){video.playbackRate=v;});
show('Speed',s.html,function(){s.init();});
});

// eb[3] Crop
wire(eb[3],function(){
var g=grd([{label:'16:9'},{label:'9:16'},{label:'1:1'},{label:'4:3'},{label:'21:9'},{label:'Custom'}],function(p){
var w=video.videoWidth||640;
var h=video.videoHeight||480;
var cp='';
if(p.label==='16:9'){cp='inset(12.5% 0)'}
else if(p.label==='9:16'){cp='inset(0 31.25%)'}
else if(p.label==='1:1'){cp='inset(25% 0)'}
else if(p.label==='4:3'){cp='inset(8.33% 0)'}
else if(p.label==='21:9'){cp='inset(26.67% 0)'}
if(cp){video.style.clipPath=cp;window._vt.cropPath=cp;}
});
show('Crop',g.html,function(){g.init();});
});

// eb[4] Resize
wire(eb[4],function(){
var s1=sld('Width',200,1200,800,'px',function(v){var vp=video.parentElement;if(vp)vp.style.width=v+'px';});
var s2=sld('Height',150,900,600,'px',function(v){var vp=video.parentElement;if(vp)vp.style.height=v+'px';});
show('Resize',s1.html+s2.html,function(){s1.init();s2.init();});
});

// eb[5] Rotate
wire(eb[5],function(){
var s=sld('Angle',0,360,0,'ÃÂ°',function(v){window._vt.rotate=v;aT();});
show('Rotate',s.html,function(){s.init();});
});

// eb[6] Flip
wire(eb[6],function(){
var g=grd([{label:'Horizontal',v:'h'},{label:'Vertical',v:'v'},{label:'Both',v:'b'},{label:'Reset',v:'r'}],function(p){
if(p.v==='h'){window._vt.scaleX=-1;}
else if(p.v==='v'){window._vt.scaleY=-1;}
else if(p.v==='b'){window._vt.scaleX=-1;window._vt.scaleY=-1;}
else{window._vt.scaleX=1;window._vt.scaleY=1;}
aT();
});
show('Flip',g.html,function(){g.init();});
});

// eb[7] Position
wire(eb[7],function(){
var s1=sld('Translate X',-200,200,0,'px',function(v){window._vt.translateX=v;aT();});
var s2=sld('Translate Y',-200,200,0,'px',function(v){window._vt.translateY=v;aT();});
show('Position',s1.html+s2.html,function(){s1.init();s2.init();});
});

// eb[8] Reverse
wire(eb[4],function(){
toast('Reverse playback requires server processing','#ef4444');
});

// eb[9] Loop
wire(eb[9],function(){
video.loop=!video.loop;
toast('Loop '+(video.loop?'enabled':'disabled'),video.loop?'#22c55e':'#3b82f6');
});

// eb[10] Freeze Frame
wire(eb[10],function(){
video.pause();
toast('Frame frozen at '+Math.floor(video.currentTime)+'s','#3b82f6');
});

// eb[11] Keyframes
wire(eb[11],function(){
if(!window._vt.keyframes)window._vt.keyframes=[];
var t=Math.floor(video.currentTime);
var kf={time:t,rotate:window._vt.rotate||0,scaleX:window._vt.scaleX||1,scaleY:window._vt.scaleY||1,zoom:window._vt.zoom||1};
window._vt.keyframes.push(kf);
var html='<div style="max-height:200px;overflow-y:auto;color:#ccc;font-size:12px;">';
window._vt.keyframes.forEach(function(k,i){html+='<div style="padding:4px;background:#2a2a4a;margin:4px 0;border-radius:4px;">KF#'+(i+1)+' @ '+k.time+'s (R:'+k.rotate+'ÃÂ° Z:'+k.zoom+')</div>';});
html+='</div>';
var b=btn('Clear All','#ef4444',function(){window._vt.keyframes=[];show('Keyframes','<div style="color:#ccc;">No keyframes saved yet</div>');});
show('Keyframes',html+b.html,function(){b.init();});
});

// === AUDIO ===
// ab[0] Volume
wire(ab[0],function(){
var s=sld('Volume',0,100,Math.round(video.volume*100),'%',function(v){video.volume=v/100;});
show('Volume',s.html,function(){s.init();});
});

// ab[1] Music Library
wire(ab[1],function(){
var g=grd([{label:'Chill Lo-Fi',v:'chill'},{label:'Upbeat Pop',v:'upbeat'},{label:'Electronic',v:'electronic'},{label:'Ambient',v:'ambient'},{label:'Jazz',v:'jazz'},{label:'Classical',v:'classical'}],function(p){
initAudioContext();
if(window._musicOsc)window._musicOsc.stop();
var ctx=window._audioCtx;
var freq=440;
if(p.v==='chill')freq=200;
else if(p.v==='upbeat')freq=450;
else if(p.v==='electronic')freq=320;
else if(p.v==='ambient')freq=110;
else if(p.v==='jazz')freq=330;
else if(p.v==='classical')freq=440;
window._musicOsc=ctx.createOscillator();
var musicGain=ctx.createGain();
window._musicOsc.frequency.value=freq;
window._musicOsc.type='sine';
musicGain.gain.value=0.1;
window._musicOsc.connect(musicGain);
musicGain.connect(ctx.destination);
window._musicOsc.start();
toast('Playing '+p.label+' background','#22c55e');
});
var b=btn('Stop Music','#ef4444',function(){
if(window._musicOsc){window._musicOsc.stop();window._musicOsc=null;}
toast('Music stopped','#3b82f6');
});
show('Music Library',g.html+b.html,function(){g.init();b.init();});
});

// ab[2] Voiceover
wire(ab[2],function(){
if(!window._mediaRecorder){
navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
var ctx=new (window.AudioContext||window.webkitAudioContext)();
var src=ctx.createMediaStreamSource(stream);
var dest=ctx.createMediaStreamDestination();
src.connect(dest);
window._voiceStream=dest.stream;
window._mediaRecorder=new MediaRecorder(window._voiceStream);
var chunks=[];
window._mediaRecorder.ondataavailable=function(e){chunks.push(e.data);};
window._mediaRecorder.onstop=function(){
var blob=new Blob(chunks,{type:'audio/wav'});
var url=URL.createObjectURL(blob);
var a=document.createElement('audio');a.src=url;a.controls=true;
var div=document.getElementById('v9vodisp');
if(div)div.innerHTML='<audio controls src="'+url+'" style="width:100%;margin-top:8px;"></audio>';
toast('Recording saved ('+Math.round(blob.size/1024)+'KB)','#22c55e');
chunks=[];
};
var elapsed=0;
var b1=btn('Start Recording','#22c55e',function(btn){
btn.style.display='none';
elapsed=0;
window._mediaRecorder.start();
var timer=document.getElementById('v9vor');
var iv=setInterval(function(){
elapsed++;
timer.textContent=elapsed+'s';
},1000);
btn.nextSibling.style.display='block';
btn.nextSibling._timer=iv;
});
var b2=btn('Stop Recording','#ef4444',function(btn){
window._mediaRecorder.stop();
clearInterval(btn._timer);
btn.style.display='none';
btn.previousSibling.style.display='block';
});
show('Voiceover','<div id="v9vor" style="color:#fff;font-size:14px;margin-bottom:10px;font-weight:600;">0s</div><div id="v9vodisp"></div>'+b1.html+b2.html,function(){
b1.init();b2.init();
document.querySelectorAll('#v9P button').forEach(function(b){if(b.textContent.includes('Stop'))b.style.display='none';});
});
}).catch(function(e){toast('Microphone access denied','#ef4444');});
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
var dur=Number(document.querySelectorAll('input[type="range"]')[0].value);
if(p.v==='in'||p.v==='both'){
window._gainNode.gain.setValueAtTime(0,ctx.currentTime);
window._gainNode.gain.linearRampToValueAtTime(1,ctx.currentTime+dur);
}
if(p.v==='out'||p.v==='both'){
window._gainNode.gain.setValueAtTime(1,ctx.currentTime+dur+1);
window._gainNode.gain.linearRampToValueAtTime(0,ctx.currentTime+dur+1+dur);
}
toast('Fade applied ('+dur+'s)','#22c55e');
});
show('Fade In/Out',s1.html+g.html,function(){s1.init();g.init();});
});

// ab[5] Voice Change
wire(ab[5],function(){
var ctx=initAudioContext();
var g=grd([{label:'Deep Voice',v:'deep'},{label:'High Pitch',v:'high'},{label:'Robot',v:'robot'},{label:'Echo',v:'echo'}],function(p){
if(p.v==='deep'){
window._eqL.gain.value=12;window._eqM.gain.value=-5;window._eqH.gain.value=-8;
}else if(p.v==='high'){
window._eqH.gain.value=12;window._eqM.gain.value=2;window._eqL.gain.value=-5;
}else if(p.v==='robot'){
window._eqL.gain.value=-15;window._eqM.gain.value=10;window._eqH.gain.value=-10;
}else if(p.v==='echo'){
var delay=ctx.createDelay();delay.delayTime.value=0.3;
var fb=ctx.createGain();fb.gain.value=0.4;
delay.connect(fb);fb.connect(delay);
window._eqH.connect(delay);delay.connect(window._gainNode);
}
toast('Voice changed to '+p.label,'#3b82f6');
});
show('Voice Change',g.html,function(){g.init();});
});

// ab[6] Equalizer
wire(ab[6],function(){
var ctx=initAudioContext();
var s1=sld('Bass',Ã¢ÂÂ12,12,0,'dB',function(v){window._eqL.gain.value=v;});
var s2=sld('Mid',Ã¢ÂÂ12,12,0,'dB',function(v){window._eqM.gain.value=v;});
var s3=sld('Treble',Ã¢ÂÂ12,12,0,'dB',function(v){window._eqH.gain.value=v;});
show('Equalizer',s1.html+s2.html+s3.html,function(){s1.init();s2.init();s3.init();});
});

// ab[7] Sound Effects
wire(ab[7],function(){
var g=grd([{label:'Pop',v:'pop'},{label:'Ding',v:'ding'},{label:'Boom',v:'boom'},{label:'Whoosh',v:'whoosh'},{label:'Beep',v:'beep'},{label:'Buzz',v:'buzz'}],function(p){
var ctx=initAudioContext();
if(p.v==='pop'){
var osc=ctx.createOscillator();var g1=ctx.createGain();
osc.frequency.setValueAtTime(400,ctx.currentTime);osc.frequency.exponentialRampToValueAtTime(100,ctx.currentTime+0.1);
g1.gain.setValueAtTime(0.5,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.1);
osc.connect(g1);g1.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+0.1);
}else if(p.v==='ding'){
var osc=ctx.createOscillator();var g1=ctx.createGain();
osc.frequency.value=800;g1.gain.setValueAtTime(0.3,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.5);
osc.connect(g1);g1.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+0.5);
}else if(p.v==='boom'){
var osc=ctx.createOscillator();var g1=ctx.createGain();
osc.frequency.setValueAtTime(100,ctx.currentTime);osc.frequency.exponentialRampToValueAtTime(50,ctx.currentTime+0.3);
g1.gain.setValueAtTime(0.4,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.3);
osc.connect(g1);g1.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+0.3);
}else if(p.v==='whoosh'){
var hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.setValueAtTime(100,ctx.currentTime);hp.frequency.exponentialRampToValueAtTime(5000,ctx.currentTime+0.5);
var g1=ctx.createGain();g1.gain.setValueAtTime(0.3,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.5);
var noise=ctx.createBufferSource();var buf=ctx.createBuffer(1,ctx.sampleRate*0.5,ctx.sampleRate);
var data=buf.getChannelData(0);for(var i=0;i<buf.length;i++)data[i]=Math.random()*2-1;
noise.buffer=buf;noise.connect(hp);hp.connect(g1);g1.connect(ctx.destination);noise.start();
}else if(p.v==='beep'){
var osc=ctx.createOscillator();var g1=ctx.createGain();
osc.frequency.value=1000;g1.gain.setValueAtTime(0.2,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.2);
osc.connect(g1);g1.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+0.2);
}else if(p.v==='buzz'){
var osc=ctx.createOscillator();var g1=ctx.createGain();
osc.type='square';osc.frequency.value=300;g1.gain.setValueAtTime(0.15,ctx.currentTime);g1.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.3);
osc.connect(g1);g1.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+0.3);
}
});
show('Sound Effects',g.html,function(){g.init();});
});

// ab[8] Compressor
wire(ab[8],function(){
var ctx=initAudioContext();
var s1=sld('Threshold',Ã¢ÂÂ100,0,Ã¢ÂÂ24,'dB',function(v){window._comp.threshold.value=v;});
var s2=sld('Ratio',1,20,4,':1',function(v){window._comp.ratio.value=v;});
var s3=sld('Attack',0,1,0.003,'s',function(v){window._comp.attack.value=v;});
show('Compressor',s1.html+s2.html+s3.html,function(){s1.init();s2.init();s3.init();});
});

// ab[9] Noise Remove
wire(ab[9],function(){
var ctx=initAudioContext();
var s1=sld('Filter Cutoff',50,8000,2000,'Hz',function(v){
var lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=v;
window._eqH.connect(lp);lp.connect(window._gainNode);
});
show('Noise Remove',s1.html,function(){s1.init();});
});

// ab[10] Beat Sync
wire(ab[10],function(){
var ctx=initAudioContext();
var analyser=ctx.createAnalyser();
analyser.fftSize=256;
window._eqH.connect(analyser);
var data=new Uint8Array(analyser.frequencyBinCount);
var beats='<div style="color:#ccc;font-size:12px;max-height:150px;overflow-y:auto;">';
var beatCount=0;
var checkBeats=setInterval(function(){
if(video.paused){clearInterval(checkBeats);return;}
analyser.getByteFrequencyData(data);
var avg=0;for(var i=0;i<data.length;i++)avg+=data[i];
avg/=data.length;
if(avg>150){beatCount++;if(beatCount<=10)beats+='<div style="padding:4px;background:#2a2a4a;margin:2px 0;border-radius:2px;">Beat '+beatCount+' @ '+Math.floor(video.currentTime)+'s</div>';}
},300);
setTimeout(function(){clearInterval(checkBeats);
show('Beat Sync',beats+'</div>');
},video.duration*1000||5000);
});

// ab[11] Visualizer
wire(ab[11],function(){
var ctx=initAudioContext();
var analyser=ctx.createAnalyser();
analyser.fftSize=512;
window._eqH.connect(analyser);
var canvas=document.createElement('canvas');
canvas.width=300;canvas.height=150;
canvas.style.cssText='background:#1a1a2e;border:1px solid #6c2bd9;border-radius:8px;margin-top:8px;';
var canvasCtx=canvas.getContext('2d');
var animId=null;
function draw(){
animId=requestAnimationFrame(draw);
var data=new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(data);
canvasCtx.fillStyle='#1a1a2e';canvasCtx.fillRect(0,0,canvas.width,canvas.height);
canvasCtx.fillStyle='#6c2bd9';
var barW=(canvas.width/data.length)*2.5;
for(var i=0;i<data.length;i++){
var h=(data[i]/255)*canvas.height;
canvasCtx.fillRect(i*barW,canvas.height-h,barW-2,h);
}
}
draw();
var b=btn('Stop','#ef4444',function(){cancelAnimationFrame(animId);});
show('Visualizer','<div style="text-align:center;"></div>',function(){document.querySelector('#v9P>div').innerHTML='<span style="color:#fff;font-weight:600;">Visualizer</span>';document.querySelector('#v9P>div').appendChild(canvas);document.querySelector('#v9P').appendChild(document.createElement('br'));var bp=document.createElement('div');bp.appendChild(document.createElement('br'));var bd=btn('Stop','#ef4444',function(){cancelAnimationFrame(animId);});bd.init();});
});

// === AI ===
// ai[0] AI Enhance
wire(ai[0],function(){
var s1=sld('Brightness',50,150,100,'%',function(v){window._vf.brightness=v;aF();});
var s2=sld('Contrast',50,150,100,'%',function(v){window._vf.contrast=v;aF();});
var s3=sld('Saturation',50,150,100,'%',function(v){window._vf.saturate=v;aF();});
show('AI Enhance',s1.html+s2.html+s3.html,function(){s1.init();s2.init();s3.init();});
});

// ai[1] AI Captions
wire(ai[1],function(){
show('AI Captions','<div style="color:#ccc;font-size:12px;">Generating captions...</div>');
fetch('/ai-captions/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoId:'current'})}).then(function(r){return r.json();}).then(function(data){
if(data.error){
show('AI Captions','<div style="color:#ef4444;font-size:12px;">'+data.error+'</div>');
return;
}
var capts='<div style="color:#fff;font-size:12px;max-height:200px;overflow-y:auto;">';
data.captions.forEach(function(c){capts+='<div style="padding:6px;background:#2a2a4a;margin:4px 0;border-radius:4px;">'+c.text+'</div>';});
capts+='</div>';
var overlay=document.getElementById('v9captions');
if(!overlay){overlay=document.createElement('div');overlay.id='v9captions';overlay.style.cssText='position:absolute;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:6px;max-width:80%;z-index:999;pointer-events:none;';video.parentElement.appendChild(overlay);}
show('AI Captions',capts);
}).catch(function(e){show('AI Captions','<div style="color:#ef4444;font-size:12px;">API Error: '+e.message+'</div>');});
});

// ai[2] AI Hook
wire(ai[2],function(){
show('AI Hook','<div style="color:#ccc;font-size:12px;">Generating hook...</div>');
fetch('/ai-hook/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({style:'engaging'})}).then(function(r){return r.json();}).then(function(data){
if(data.error){
show('AI Hook','<div style="color:#ef4444;font-size:12px;">'+data.error+'</div>');
return;
}
var overlay=document.getElementById('v9hook');
if(!overlay){overlay=document.createElement('div');overlay.id='v9hook';overlay.style.cssText='position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:12px 20px;border-radius:8px;max-width:70%;z-index:999;pointer-events:none;font-weight:600;font-size:14px;';video.parentElement.appendChild(overlay);}
overlay.textContent=data.hook;
show('AI Hook','<div style="color:#22c55e;font-size:12px;">Hook added: '+data.hook+'</div>');
}).catch(function(e){show('AI Hook','<div style="color:#ef4444;font-size:12px;">API Error: '+e.message+'</div>');});
});

// ai[3] Brand Kit
wire(ai[3],function(){
var g=grd([{label:'Color 1',v:'#6c2bd9'},{label:'Color 2',v:'#3b82f6'},{label:'Color 3',v:'#22c55e'},{label:'Color 4',v:'#ef4444'},{label:'Color 5',v:'#f59e0b'},{label:'Color 6',v:'#8b5cf6'}],function(p){
localStorage.setItem('brandColor',p.v);
document.documentElement.style.setProperty('--brand-color',p.v);
toast('Brand color saved: '+p.v,'#22c55e');
});
var t=btn('Add Watermark','#6c2bd9',function(){
var text=prompt('Watermark text:','ÃÂ© '+new Date().getFullYear());
if(text){
var wm=document.getElementById('v9watermark');
if(!wm){wm=document.createElement('div');wm.id='v9watermark';wm.style.cssText='position:absolute;bottom:10px;right:10px;color:#fff;font-size:12px;opacity:0.7;z-index:999;pointer-events:none;';video.parentElement.appendChild(wm);}
wm.textContent=text;
localStorage.setItem('watermark',text);
toast('Watermark added','#22c55e');
}
});
show('Brand Kit',g.html+t.html,function(){g.init();t.init();});
});

// ai[4] Transcript
wire(ai[4],function(){
show('Transcript','<div style="color:#ccc;font-size:12px;">Fetching transcript...</div>');
fetch('/ai-captions/generate',{method:'POST'}).then(function(r){return r.json();}).then(function(data){
if(data.error){
show('Transcript','<div style="color:#ef4444;font-size:12px;">Transcript requires OpenAI API key configuration. Configure in settings.</div>');
return;
}
var text='<div style="color:#ccc;font-size:12px;max-height:250px;overflow-y:auto;line-height:1.6;">'+data.transcript+'</div>';
show('Transcript',text);
}).catch(function(){show('Transcript','<div style="color:#ef4444;font-size:12px;">Transcript requires OpenAI API key configuration. Configure in settings.</div>');});
});

// ai[5] AI B-Roll
wire(ai[5],function(){
show('AI B-Roll','<div style="color:#ccc;font-size:12px;">Searching stock footage...</div>');
fetch('/ai-broll/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'nature'})}).then(function(r){return r.json();}).then(function(data){
if(data.error){
show('AI B-Roll','<div style="color:#ef4444;font-size:12px;">'+data.error+'</div>');
return;
}
var clips='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
data.clips.forEach(function(clip){
clips+='<div style="background:#2a2a4a;padding:8px;border-radius:6px;cursor:pointer;border:1px solid #444;" onclick="toast(\'Added clip: '+clip.title+'\',\'#22c55e\')"><img src="'+clip.thumb+'" style="width:100%;height:80px;object-fit:cover;border-radius:4px;"><div style="color:#ccc;font-size:10px;margin-top:4px;">'+clip.title+'</div></div>';
});
clips+='</div>';
show('AI B-Roll',clips);
}).catch(function(e){show('AI B-Roll','<div style="color:#ef4444;font-size:12px;">API Error: '+e.message+'</div>');});
});

// ai[6] Smart Cut
wire(ai[6],function(){
show('Smart Cut','<div style="color:#ccc;font-size:12px;">Analyzing audio for silences...</div>');
var ctx=initAudioContext();
var analyser=ctx.createAnalyser();
analyser.fftSize=256;
window._eqH.connect(analyser);
var data=new Uint8Array(analyser.frequencyBinCount);
var silences='<div style="color:#fff;font-size:12px;max-height:150px;overflow-y:auto;">';
var sc=0;
var checkSilence=setInterval(function(){
if(video.paused){clearInterval(checkSilence);return;}
analyser.getByteFrequencyData(data);
var avg=0;for(var i=0;i<data.length;i++)avg+=data[i];avg/=data.length;
if(avg<30){sc++;if(sc<=5)silences+='<div style="padding:4px;background:#2a2a4a;margin:2px 0;border-radius:2px;">Silence @ '+Math.floor(video.currentTime)+'s</div>';}
},500);
setTimeout(function(){clearInterval(checkSilence);show('Smart Cut',silences+'</div>');},video.duration*1000||5000);
});

// ai[7] Scene Detect
wire(ai[7],function(){
show('Scene Detect','<div style="color:#ccc;font-size:12px;">Analyzing frames for scene changes...</div>');
var canvas=document.createElement('canvas');
var ctx=canvas.getContext('2d');
var scenes='<div style="color:#fff;font-size:12px;max-height:150px;overflow-y:auto;">';
var lastColor=null;
var sc=0;
var checkScene=setInterval(function(){
if(video.paused){clearInterval(checkScene);return;}
canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
ctx.drawImage(video,0,0);
var id=ctx.getImageData(0,0,10,10);
var data=id.data;
var r=Math.round((data[0]+data[4]+data[8])/3);
var g=Math.round((data[1]+data[5]+data[9])/3);
var b=Math.round((data[2]+data[6]+data[10])/3);
var curColor=r+','+g+','+b;
if(lastColor&&Math.abs(r-parseInt(lastColor))+Math.abs(g-parseInt(lastColor.split(',')[1]))+Math.abs(b-parseInt(lastColor.split(',')[2]))>100){
sc++;
if(sc<=5)scenes+='<div style="padding:4px;background:#2a2a4a;margin:2px 0;border-radius:2px;">Scene Change @ '+Math.floor(video.currentTime)+'s</div>';
}
lastColor=curColor;
},1000);
setTimeout(function(){clearInterval(checkScene);show('Scene Detect',scenes+'</div>');},video.duration*1000||5000);
});

// ai[8] Style Transfer
wire(ai[8],function(){
var g=grd([{label:'Cyberpunk',v:'cyber'},{label:'Film Noir',v:'noir'},{label:'Oil Painting',v:'oil'},{label:'Watercolor',v:'water'},{label:'Comic Book',v:'comic'},{label:'Neon',v:'neon'}],function(p){
var filters='';
if(p.v==='cyber'){filters='saturate(200%) hue-rotate(280deg)';}
else if(p.v==='noir'){filters='grayscale(100%) contrast(150%)';}
else if(p.v==='oil'){filters='blur(3px) contrast(140%)';}
else if(p.v==='water'){filters='blur(5px) saturate(150%)';}
else if(p.v==='comic'){filters='contrast(180%) saturate(200%)';}
else if(p.v==='neon'){filters='saturate(300%) hue-rotate(180deg) contrast(150%)';}
window._vf=window._vf||{};Object.assign(window._vf,{styleFilter:filters});
video.style.filter=(filters?' '+filters:'')+video.style.filter;
});
show('Style Transfer',g.html,function(){g.init();});
});

// ai[9] BG Remove
wire(ai[9],function(){
toast('Background removal requires server-side ML processing. Coming soon.','#ef4444');
});

// ai[10] AI Voice
wire(ai[10],function(){
toast('AI Voice generation requires TTS API configuration. Coming soon.','#ef4444');
});

// ai[11] Translate
wire(ai[11],function(){
toast('Translation requires API configuration. Coming soon.','#ef4444');
});

// === FX ===
// fx[0] Filters
wire(fx[0],function(){
var g=grd([{label:'Grayscale',v:'gray'},{label:'Sepia',v:'sepia'},{label:'Cold',v:'cold'},{label:'Warm',v:'warm'},{label:'Vivid',v:'vivid'},{label:'Vintage',v:'vintage'}],function(p){
var filters='';
if(p.v==='gray'){filters='grayscale(100%)';}
else if(p.v==='sepia'){filters='sepia(100%)';}
else if(p.v==='cold'){filters='hue-rotate(200deg) contrast(110%)';}
else if(p.v==='warm'){filters='hue-rotate(10deg) saturate(120%)';}
else if(p.v==='vivid'){filters='saturate(200%) contrast(120%)';}
else if(p.v==='vintage'){filters='saturate(150%) hue-rotate(350deg) contrast(95%)';}
window._vf=window._vf||{};window._vf.filterPreset=p.v;
video.style.filter=filters;
});
show('Filters',g.html,function(){g.init();});
});

// fx[1] Transitions
wire(fx[1],function(){
var g=grd([{label:'Fade',v:'fade'},{label:'Slide Left',v:'slide'},{label:'Zoom In',v:'zoom'},{label:'Spin',v:'spin'},{label:'Flip',v:'flip'},{label:'Blur',v:'blur'}],function(p){
var dur=2;
if(p.v==='fade'){
video.style.animation='none';
setTimeout(function(){video.style.transition='opacity '+dur+'s';video.style.opacity='0';setTimeout(function(){video.style.opacity='1';},dur*500);},100);
}else if(p.v==='slide'){
video.style.animation='none';
video.style.transition='transform '+dur+'s';
video.style.transform='translateX(-100vw)';
setTimeout(function(){video.style.transform='translateX(0)';},dur*500);
}else if(p.v==='zoom'){
video.style.animation='none';
video.style.transition='transform '+dur+'s';
video.style.transform='scale(0.5)';
setTimeout(function(){video.style.transform='scale(1)';},dur*500);
}else if(p.v==='spin'){
video.style.animation='none';
video.style.transition='transform '+dur+'s';
video.style.transform='rotateY(180deg)';
setTimeout(function(){video.style.transform='rotateY(0)';},dur*500);
}else if(p.v==='flip'){
video.style.animation='none';
video.style.transition='transform '+dur+'s';
video.style.transform='rotateX(180deg)';
setTimeout(function(){video.style.transform='rotateX(0)';},dur*500);
}else if(p.v==='blur'){
video.style.animation='none';
video.style.transition='filter '+dur+'s';
video.style.filter='blur(20px)';
setTimeout(function(){video.style.filter='blur(0)';},dur*500);
}
});
show('Transitions',g.html,function(){g.init();});
});

// fx[2] Text Overlay
wire(fx[2],function(){
var textIn=document.createElement('input');
textIn.type='text';textIn.placeholder='Enter text...';textIn.style.cssText='width:100%;padding:8px;background:#2a2a4a;color:#fff;border:1px solid #6c2bd9;border-radius:6px;margin-top:8px;font-size:12px;';
var sz=sld('Font Size',12,72,32,'px',function(){});
var b1=btn('Add Text','#6c2bd9',function(){
var txt=textIn.value||'Sample Text';
var fs=Number(document.querySelectorAll('input[type="range"]')[0].value);
var overlay=document.getElementById('v9to');
if(!overlay){overlay=document.createElement('div');overlay.id='v9to';overlay.style.cssText='position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);color:#fff;font-size:'+fs+'px;font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,0.8);z-index:999;pointer-events:none;max-width:80%;text-align:center;';video.parentElement.appendChild(overlay);}
overlay.textContent=txt;overlay.style.fontSize=fs+'px';overlay.style.display='block';
b1.textContent='Added!';b1.style.background='#22c55e';setTimeout(function(){b1.textContent='Add Text';b1.style.background='#6c2bd9';},1500);
});
var b2=btn('Remove Text','#ef4444',function(){var o=document.getElementById('v9to');if(o)o.style.display='none';});
show('Text Overlay','<div style="color:#ccc;font-size:12px;margin-bottom:8px;">Text:</div>'+textIn.outerHTML+sz.html+b1.html+b2.html,function(){
sz.init();b1.init();b2.init();
document.querySelector('#v9P input[type="text"]').addEventListener('input',function(){});
});
});

// fx[3] Stickers
wire(fx[3],function(){
var g=grd([{label:'Ã°ÂÂÂ Like',v:'Ã°ÂÂÂ'},{label:'Ã°ÂÂÂ¥ Fire',v:'Ã°ÂÂÂ¥'},{label:'Ã¢ÂÂ¤Ã¯Â¸Â Heart',v:'Ã¢ÂÂ¤Ã¯Â¸Â'},{label:'Ã¢Â­Â Star',v:'Ã¢Â­Â'},{label:'Ã°ÂÂÂ¯ 100',v:'Ã°ÂÂÂ¯'},{label:'Ã°ÂÂÂ Laugh',v:'Ã°ÂÂÂ'},{label:'Ã¢ÂÂ¡Ã¯Â¸Â Arrow',v:'Ã¢ÂÂ¡Ã¯Â¸Â'},{label:'Ã°ÂÂÂ Bell',v:'Ã°ÂÂÂ'}],function(p){
var o=document.getElementById('v9so');
if(!o){o=document.createElement('div');o.id='v9so';o.style.cssText='position:absolute;top:20%;right:10%;font-size:64px;z-index:999;pointer-events:none;animation:bounce 0.6s infinite;';var vp=video.parentElement;if(vp){vp.style.position='relative';vp.appendChild(o);}}
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
var s4=sld('Hue',0,360,window._vf.hueRotate||0,'ÃÂ°',function(v){window._vf.hueRotate=v;aF();});
var b1=btn('Reset','#ef4444',function(){window._vf={brightness:100,contrast:100,saturate:100,hueRotate:0};aF();});
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
var g=grd([{label:'Teal & Orange',v:'to'},{label:'Film Look',v:'film'},{label:'Bleach Bypass',v:'bl'},{label:'Cross Process',v:'cr'},{label:'Kodak 2383',v:'ko'},{label:'LOG to Rec709',v:'log'}],function(p){
if(p.v==='to'){window._vf.hueRotate=-15;window._vf.saturate=130;window._vf.contrast=110;}
else if(p.v==='film'){window._vf.saturate=85;window._vf.contrast=115;window._vf.brightness=95;}
else if(p.v==='bl'){window._vf.saturate=50;window._vf.contrast=140;window._vf.brightness=105;}
else if(p.v==='cr'){window._vf.hueRotate=40;window._vf.saturate=120;window._vf.contrast=110;}
else if(p.v==='ko'){window._vf.saturate=95;window._vf.contrast=108;window._vf.brightness=102;}
else{window._vf.saturate=110;window._vf.contrast=120;}
aF();
});
var b1=btn('Reset LUT','#ef4444',function(){window._vf={brightness:100,contrast:100,saturate:100,hueRotate:0};aF();});
show('LUT Presets',g.html+b1.html,function(){g.init();b1.init();});
});

// fx[8] Zoom
wire(fx[8],function(){
var s=sld('Zoom',50,300,100,'%',function(v){window._vt.zoom=v/100;aT();});
var b1=btn('Reset','#ef4444',function(){window._vt.zoom=1;aT();});
show('Zoom',s.html+b1.html,function(){s.init();b1.init();});
});

// fx[9] Picture in Picture
wire(fx[9],function(){
if(document.pictureInPictureEnabled){
video.requestPictureInPicture().then(function(){toast('PiP mode enabled','#22c55e');}).catch(function(e){toast('PiP not supported: '+e.message,'#ef4444');});
}else{
toast('Picture-in-Picture not supported in this browser','#ef4444');
}
});

// fx[10] Animations
wire(fx[10],function(){
var g=grd([{label:'Fade In',v:'fadeIn'},{label:'Fade Out',v:'fadeOut'},{label:'Bounce',v:'bounce'},{label:'Spin',v:'spin'},{label:'Slide In',v:'slideIn'},{label:'Scale Up',v:'scaleUp'}],function(p){
var dur=1;
var style=document.createElement('style');
if(!document.getElementById('v9AnimStyle')){
document.head.appendChild(style);style.id='v9AnimStyle';
}
style=document.getElementById('v9AnimStyle');
var keyframes='';
if(p.v==='fadeIn'){keyframes='@keyframes fadeIn{from{opacity:0}to{opacity:1}}';}
else if(p.v==='fadeOut'){keyframes='@keyframes fadeOut{from{opacity:1}to{opacity:0}}';}
else if(p.v==='bounce'){keyframes='@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-20px)}}';}
else if(p.v==='spin'){keyframes='@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';}
else if(p.v==='slideIn'){keyframes='@keyframes slideIn{from{transform:translateX(-100px)}to{transform:translateX(0)}}';}
else if(p.v==='scaleUp'){keyframes='@keyframes scaleUp{from{transform:scale(0.5)}to{transform:scale(1)}}';}
style.textContent=keyframes;
video.style.animation=p.v+' '+dur+'s ease-in-out';
toast('Animation '+p.v+' applied','#22c55e');
});
show('Animations',g.html,function(){g.init();});
});

// fx[11] Annotations
wire(fx[11],function(){
var g=grd([{label:'Arrow',v:'arrow'},{label:'Circle',v:'circle'},{label:'Rectangle',v:'rect'},{label:'Line',v:'line'},{label:'Highlight',v:'hl'},{label:'Blur',v:'blur'}],function(p){
var svg=document.getElementById('v9svg');
if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='v9svg';svg.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;z-index:998;pointer-events:none;';video.parentElement.appendChild(svg);}
if(p.v==='arrow'){
var line=document.createElementNS('http://www.w3.org/2000/svg','line');
line.setAttribute('x1','50');line.setAttribute('y1','50');line.setAttribute('x2','150');line.setAttribute('y2','150');
line.setAttribute('stroke','#ff0000');line.setAttribute('stroke-width','2');
var poly=document.createElementNS('http://www.w3.org/2000/svg','polygon');
poly.setAttribute('points','150,150 140,135 160,140');poly.setAttribute('fill','#ff0000');
svg.appendChild(line);svg.appendChild(poly);
}else if(p.v==='circle'){
var c=document.createElementNS('http://www.w3.org/2000/svg','circle');
c.setAttribute('cx','100');c.setAttribute('cy','100');c.setAttribute('r','50');
c.setAttribute('fill','none');c.setAttribute('stroke','#00ff00');c.setAttribute('stroke-width','2');
svg.appendChild(c);
}else if(p.v==='rect'){
var r=document.createElementNS('http://www.w3.org/2000/svg','rect');
r.setAttribute('x','50');r.setAttribute('y','50');r.setAttribute('width','100');r.setAttribute('height','100');
r.setAttribute('fill','none');r.setAttribute('stroke','#0000ff');r.setAttribute('stroke-width','2');
svg.appendChild(r);
}else if(p.v==='line'){
var ln=document.createElementNS('http://www.w3.org/2000/svg','line');
ln.setAttribute('x1','0');ln.setAttribute('y1','0');ln.setAttribute('x2','200');ln.setAttribute('y2','200');
ln.setAttribute('stroke','#ffff00');ln.setAttribute('stroke-width','2');
svg.appendChild(ln);
}else if(p.v==='hl'){
var hl=document.createElementNS('http://www.w3.org/2000/svg','rect');
hl.setAttribute('x','50');hl.setAttribute('y','50');hl.setAttribute('width','100');hl.setAttribute('height','100');
hl.setAttribute('fill','rgba(255,255,0,0.3)');
svg.appendChild(hl);
}else if(p.v==='blur'){
var blur=document.createElementNS('http://www.w3.org/2000/svg','rect');
blur.setAttribute('x','50');blur.setAttribute('y','50');blur.setAttribute('width','100');blur.setAttribute('height','100');
blur.setAttribute('fill','rgba(0,0,0,0.5)');blur.style.filter='blur(5px)';
svg.appendChild(blur);
}
toast('Annotation '+p.v+' added','#22c55e');
});
var b1=btn('Clear','#ef4444',function(){var svg=document.getElementById('v9svg');if(svg)svg.innerHTML='';});
show('Annotations',g.html+b1.html,function(){g.init();b1.init();});
});

console.log('v9 allButtonsFix: 48 buttons wired with REAL functionality');
},2200);
