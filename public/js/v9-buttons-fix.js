setTimeout(function(){
if(!document.querySelector('#videoPlayer') || !document.querySelector('.editor-sidebar')) return;

window._vt={r:0,f:0,x:0,y:0,s:1};
window._vf={b:100,c:100,sat:100,hue:0,blur:0,op:100};
let _ov=null,_mt=null,_mplay=null;

function show(title,html,fn){
if(_ov) _ov.remove();
_ov=document.createElement('div');
_ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
let modal=document.createElement('div');
modal.style.cssText='background:#222;border-radius:12px;padding:24px;max-width:800px;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.9);border:1px solid #444;';
modal.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h2 style="color:#fff;margin:0;font-size:20px;">'+title+'</h2><button id="close-modal" style="background:#ff4444;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;">Ã</button></div><div>'+html+'</div>';
_ov.appendChild(modal);
document.body.appendChild(_ov);
document.getElementById('close-modal').addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();hide();});
if(fn) fn();
}

function hide(){
if(_ov) _ov.remove();
_ov=null;
}

function aT(){
let v=document.querySelector('#videoPlayer');
if(!v) return;
v.style.transform='rotate('+_vt.r+'deg) scaleX('+(v._fx?-1:1)+') translateX('+_vt.x+'px) translateY('+_vt.y+'px) scale('+_vt.s+')';
}

function aF(){
let v=document.querySelector('#videoPlayer');
if(!v) return;
v.style.filter='brightness('+_vf.b+'%) contrast('+_vf.c+'%) saturate('+_vf.sat+'%) hue-rotate('+_vf.hue+'deg) blur('+_vf.blur+'px) opacity('+_vf.op+'%)';
}

function sld(label,min,max,val,cb){
return '<div style="margin:12px 0;"><label style="color:#aaa;font-size:13px;">'+label+': <span id="val-'+label+'">'+val+'</span></label><input type="range" min="'+min+'" max="'+max+'" value="'+val+'" style="width:100%;cursor:pointer;" data-cb="'+cb+'" class="slider"></div>';
}

function btn(text,fn){
let b=document.createElement('button');
b.textContent=text;
b.style.cssText='background:#007bff;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;margin:6px;font-weight:bold;font-size:14px;transition:all 0.2s;';
b.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();fn();});
b.addEventListener('mouseover',function(){this.style.background='#0056b3';});
b.addEventListener('mouseout',function(){this.style.background='#007bff';});
return b;
}

function grd(title,cats){
let html='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">';
for(let cat of cats){
html+='<button class="grd-btn" data-cat="'+cat+'" style="padding:20px;background:#333;border:2px solid #555;border-radius:8px;color:#fff;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+cat+'</button>';
}
html+='</div>';
return html;
}

function wire(sel,ev,fn){
document.querySelectorAll(sel).forEach(el=>{
el.addEventListener(ev,fn);
});
}

function toast(msg){
let t=document.createElement('div');
t.textContent=msg;
t.style.cssText='position:fixed;bottom:20px;right:20px;background:#28a745;color:white;padding:12px 20px;border-radius:6px;font-size:14px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn 0.3s ease;';
document.body.appendChild(t);
setTimeout(()=>t.remove(),3000);
}

function genMusicTracks(){
let tracks=[
{g:'Pop',t:'Summer Vibes',a:'Artist A',d:'3:24'},{g:'Pop',t:'Electric Dreams',a:'Artist B',d:'3:45'},{g:'Pop',t:'Neon Nights',a:'Artist C',d:'4:02'},{g:'Pop',t:'Golden Hour',a:'Artist D',d:'3:18'},{g:'Pop',t:'Pulse',a:'Artist E',d:'3:33'},{g:'Pop',t:'Euphoria',a:'Artist F',d:'3:56'},
{g:'Lo-Fi',t:'Rainy Afternoon',a:'Lofi Master',d:'2:45'},{g:'Lo-Fi',t:'Coffee Shop',a:'Lofi Master',d:'2:58'},{g:'Lo-Fi',t:'Study Session',a:'Lofi Master',d:'3:12'},{g:'Lo-Fi',t:'Midnight Walk',a:'Lofi Master',d:'2:34'},{g:'Lo-Fi',t:'Lazy Sunday',a:'Lofi Master',d:'3:01'},{g:'Lo-Fi',t:'Chill Vibes',a:'Lofi Master',d:'2:44'},
{g:'Cinematic',t:'Epic Rise',a:'Composer X',d:'4:15'},{g:'Cinematic',t:'Hero\'s Journey',a:'Composer X',d:'4:42'},{g:'Cinematic',t:'Dark Tension',a:'Composer X',d:'3:28'},{g:'Cinematic',t:'Victory March',a:'Composer X',d:'3:55'},{g:'Cinematic',t:'Emotional Piano',a:'Composer X',d:'4:18'},{g:'Cinematic',t:'Rise and Fall',a:'Composer X',d:'3:44'},
{g:'Electronic',t:'Bass Drop',a:'Synth Lab',d:'3:33'},{g:'Electronic',t:'Synth Wave',a:'Synth Lab',d:'3:47'},{g:'Electronic',t:'Digital Rain',a:'Synth Lab',d:'3:12'},{g:'Electronic',t:'Cyber Pulse',a:'Synth Lab',d:'3:58'},{g:'Electronic',t:'Neon Grid',a:'Synth Lab',d:'3:25'},{g:'Electronic',t:'Modular Dreams',a:'Synth Lab',d:'3:41'},
{g:'Hip Hop',t:'Street Beat',a:'Beat Master',d:'3:44'},{g:'Hip Hop',t:'Flow State',a:'Beat Master',d:'3:22'},{g:'Hip Hop',t:'Urban Jungle',a:'Beat Master',d:'3:56'},{g:'Hip Hop',t:'Boom Bap',a:'Beat Master',d:'3:18'},{g:'Hip Hop',t:'Trap House',a:'Beat Master',d:'3:31'},{g:'Hip Hop',t:'Cypher',a:'Beat Master',d:'3:47'},
{g:'Acoustic',t:'Morning Light',a:'Acoustic Folk',d:'3:12'},{g:'Acoustic',t:'Campfire',a:'Acoustic Folk',d:'2:58'},{g:'Acoustic',t:'Ocean Breeze',a:'Acoustic Folk',d:'3:34'},{g:'Acoustic',t:'Gentle Rain',a:'Acoustic Folk',d:'3:01'},{g:'Acoustic',t:'Sunset Walk',a:'Acoustic Folk',d:'3:28'},{g:'Acoustic',t:'Mountain Echo',a:'Acoustic Folk',d:'3:15'},
{g:'Jazz',t:'Smooth Night',a:'Jazz Trio',d:'4:12'},{g:'Jazz',t:'Blue Note',a:'Jazz Trio',d:'3:58'},{g:'Jazz',t:'Swing Time',a:'Jazz Trio',d:'3:45'},{g:'Jazz',t:'Sax Appeal',a:'Jazz Trio',d:'4:03'},{g:'Jazz',t:'Piano Bar',a:'Jazz Trio',d:'3:51'},{g:'Jazz',t:'Midnight Session',a:'Jazz Trio',d:'4:22'},
{g:'Ambient',t:'Deep Space',a:'Ambient Master',d:'5:12'},{g:'Ambient',t:'Forest Dawn',a:'Ambient Master',d:'4:45'},{g:'Ambient',t:'Crystal Cave',a:'Ambient Master',d:'5:33'},{g:'Ambient',t:'Zen Garden',a:'Ambient Master',d:'4:58'},{g:'Ambient',t:'Northern Lights',a:'Ambient Master',d:'5:18'},{g:'Ambient',t:'Ocean Depths',a:'Ambient Master',d:'4:51'}
];
return tracks;
}

function genBRollClips(){
let clips={
Nature:[{t:'Aerial Forest',d:'0:12',c:'#228B22'},{t:'Mountain Peak',d:'0:15',c:'#8B4513'},{t:'Ocean Waves',d:'0:10',c:'#1E90FF'},{t:'Sunset Sky',d:'0:08',c:'#FF6B35'},{t:'Waterfall',d:'0:14',c:'#4DB8E8'},{t:'Desert Dunes',d:'0:11',c:'#D2B48C'}],
City:[{t:'Busy Street',d:'0:13',c:'#696969'},{t:'Night Lights',d:'0:09',c:'#FFD700'},{t:'Traffic Flow',d:'0:12',c:'#A9A9A9'},{t:'Building View',d:'0:14',c:'#708090'},{t:'Downtown Rush',d:'0:10',c:'#4A4A4A'},{t:'City Skyline',d:'0:16',c:'#2F4F4F'}],
Technology:[{t:'Circuit Board',d:'0:11',c:'#00FF00'},{t:'Code Screen',d:'0:10',c:'#0000FF'},{t:'Data Flow',d:'0:13',c:'#00FFFF'},{t:'Tech Glow',d:'0:09',c:'#FF00FF'},{t:'Network Node',d:'0:12',c:'#32CD32'},{t:'Digital Grid',d:'0:14',c:'#1E90FF'}],
People:[{t:'Running Athletes',d:'0:12',c:'#FF1493'},{t:'Dancing Crowd',d:'0:13',c:'#FF69B4'},{t:'Happy Family',d:'0:10',c:'#FFB6C1'},{t:'Working Team',d:'0:14',c:'#FFC0CB'},{t:'Children Playing',d:'0:11',c:'#FFE4E1'},{t:'Group Talk',d:'0:09',c:'#FFA0D2'}],
Abstract:[{t:'Particle Flow',d:'0:10',c:'#9370DB'},{t:'Light Rays',d:'0:12',c:'#BA55D2'},{t:'Color Burst',d:'0:08',c:'#DDA0DD'},{t:'Liquid Motion',d:'0:14',c:'#EE82EE'},{t:'Geometric Shift',d:'0:11',c:'#DA70D6'},{t:'Energy Wave',d:'0:13',c:'#FF00FF'}],
Business:[{t:'Office Meeting',d:'0:14',c:'#8B7355'},{t:'Handshake',d:'0:09',c:'#A0522D'},{t:'Board Room',d:'0:12',c:'#CD853F'},{t:'Workspace',d:'0:13',c:'#D2691E'},{t:'Charts Graph',d:'0:10',c:'#BC8F8F'},{t:'Team Success',d:'0:15',c:'#DEB887'}]
};
return clips;
}

function playMusicPreview(genre){
let audioCtx=new(window.AudioContext||window.webkitAudioContext)();
let now=audioCtx.currentTime;
let freqs={Pop:440,LoFi:330,Cinematic:220,Electronic:880,HipHop:110,Acoustic:165,Jazz:275,Ambient:82};
let freq=freqs[genre]||440;
let osc=audioCtx.createOscillator();
let gain=audioCtx.createGain();
osc.connect(gain);
gain.connect(audioCtx.destination);
osc.frequency.value=freq;
gain.gain.setValueAtTime(0.3,now);
gain.gain.exponentialRampToValueAtTime(0.01,now+1.5);
osc.start(now);
osc.stop(now+1.5);
}

function showMusicLibrary(){
let tracks=genMusicTracks();
let genres=[...new Set(tracks.map(t=>t.g))];
let html='<div style="max-height:70vh;overflow-y:auto;">';
for(let g of genres){
let gtracks=tracks.filter(t=>t.g===g);
html+='<div style="margin-bottom:20px;"><h3 style="color:#fff;margin:12px 0;font-size:16px;border-bottom:2px solid #555;padding-bottom:8px;">'+g+'</h3>';
html+='<div style="display:grid;grid-template-columns:1fr;gap:8px;">';
for(let tk of gtracks){
html+='<div style="background:#333;padding:12px;border-radius:6px;border-left:4px solid '+{Pop:'#007bff',LoFi:'#28a745',Cinematic:'#dc3545',Electronic:'#ff6f00',HipHop:'#000',Acoustic:'#8B4513',Jazz:'#6f42c1',Ambient:'#17a2b8'}[g]+';">';
html+='<div style="color:#fff;font-weight:bold;">'+tk.t+'</div>';
html+='<div style="color:#aaa;font-size:12px;">'+tk.a+' Â· '+tk.d+'</div>';
html+='<div style="margin-top:8px;display:flex;gap:8px;">';
html+='<button class="play-track" data-genre="'+g+'" style="background:#28a745;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">â¶ Play</button>';
html+='<button class="add-track" data-track="'+tk.t+'" data-duration="'+tk.d+'" style="background:#007bff;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">+ Select</button>';
html+='</div></div>';
}
html+='</div></div>';
}
html+='</div>';
show('Music Library',html,function(){
wire('.play-track','mousedown',function(e){
e.preventDefault();
e.stopPropagation();
let g=this.getAttribute('data-genre');
playMusicPreview(g);
this.textContent='â« Playing...';
setTimeout(()=>this.textContent='â¶ Play',1500);
});
wire('.add-track','mousedown',function(e){
e.preventDefault();
e.stopPropagation();
let track=this.getAttribute('data-track');
let dur=this.getAttribute('data-duration');
let a1=document.querySelector('[data-track="A1"]');
if(a1){
let clip=document.createElement('div');
clip.style.cssText='background:#32CD32;padding:8px;border-radius:4px;margin:4px;color:black;font-weight:bold;font-size:12px;display:inline-block;';
clip.textContent=track+' ('+dur+')';
a1.appendChild(clip);
toast('Added to A1: '+track);
hide();
}
});
});
}

function showBRollBrowser(){
let clips=genBRollClips();
let html='<div style="margin-bottom:20px;"><label style="color:#aaa;font-size:13px;">Custom Search:</label><input type="text" id="custom-search" placeholder="e.g. cars, nature, sunset..." style="width:100%;padding:8px;border-radius:4px;border:1px solid #555;background:#333;color:white;margin:8px 0;"></div>';
html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">';
for(let cat in clips){
html+='<button class="broll-cat" data-cat="'+cat+'" style="padding:16px;background:#555;border:2px solid #777;border-radius:8px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+cat+'</button>';
}
html+='</div>';
html+='<div id="broll-clips"></div>';
show('B-Roll Browser',html,function(){
wire('.broll-cat','mousedown',function(e){
e.preventDefault();
e.stopPropagation();
let cat=this.getAttribute('data-cat');
let catClips=clips[cat];
let clipsHtml='<h3 style="color:#fff;margin-bottom:12px;">'+cat+'</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">';
for(let clip of catClips){
clipsHtml+='<div style="background:'+clip.c+';padding:16px;border-radius:8px;color:white;text-align:center;"><div style="font-weight:bold;margin-bottom:8px;">'+clip.t+'</div><div style="font-size:12px;margin-bottom:12px;">'+clip.d+'</div><button class="add-clip" data-title="'+clip.t+'" data-dur="'+clip.d+'" style="background:#007bff;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Add</button></div>';
}
clipsHtml+='</div>';
document.getElementById('broll-clips').innerHTML=clipsHtml;
wire('.add-clip','mousedown',function(e){
e.preventDefault();
e.stopPropagation();
let title=this.getAttribute('data-title');
let dur=this.getAttribute('data-dur');
let v1=document.querySelector('[data-track="V1"]');
if(v1){
let clip=document.createElement('div');
clip.style.cssText='background:#FF6B6B;padding:8px;border-radius:4px;margin:4px;color:white;font-weight:bold;font-size:12px;display:inline-block;';
clip.textContent=title+' ('+dur+')';
v1.appendChild(clip);
toast('Added to V1: '+title);
}
});
});
document.getElementById('custom-search').addEventListener('keydown',function(e){
if(e.key==='Enter'){
e.preventDefault();
let search=this.value.toLowerCase();
if(search.length>0){
let clipsHtml='<h3 style="color:#fff;margin-bottom:12px;">Search Results: '+search+'</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">';
let allClips=Object.values(clips).flat();
let results=allClips.filter(c=>c.t.toLowerCase().includes(search)).slice(0,12);
if(results.length===0){
clipsHtml+='<p style="color:#aaa;">No results found for "'+search+'". Try another term.</p>';
}else{
for(let clip of results){
clipsHtml+='<div style="background:#4A90E2;padding:16px;border-radius:8px;color:white;text-align:center;"><div style="font-weight:bold;margin-bottom:8px;">'+clip.t+'</div><div style="font-size:12px;margin-bottom:12px;">'+clip.d+'</div><button class="add-clip" data-title="'+clip.t+'" data-dur="'+clip.d+'" style="background:#007bff;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Add</button></div>';
}
}
clipsHtml+='</div>';
document.getElementById('broll-clips').innerHTML=clipsHtml;
wire('.add-clip','mousedown',function(e){
e.preventDefault();
e.stopPropagation();
let title=this.getAttribute('data-title');
let dur=this.getAttribute('data-dur');
let v1=document.querySelector('[data-track="V1"]');
if(v1){
let clip=document.createElement('div');
clip.style.cssText='background:#FF6B6B;padding:8px;border-radius:4px;margin:4px;color:white;font-weight:bold;font-size:12px;display:inline-block;';
clip.textContent=title+' ('+dur+')';
v1.appendChild(clip);
toast('Added to V1: '+title);
}
});
}
}
});
});
}

let btns=[
{i:0,c:'EDIT',n:'Rotate',f:function(){let h=sld('Degrees',-180,180,_vt.r,'rot')+sld('Flip',0,1,_vt.f?1:0,'flip');show('Rotate',h,function(){wire('.slider','input',function(){let k=this.getAttribute('data-cb');if(k==='rot'){_vt.r=parseInt(this.value);document.getElementById('val-Degrees').textContent=_vt.r;}else if(k==='flip'){_vt.f=parseInt(this.value)?1:0;}aT();});});}},
{i:1,c:'EDIT',n:'Flip',f:function(){_vt.f=_vt.f?0:1;aT();toast(_vt.f?'Flipped':'Unflipped');}},
{i:2,c:'EDIT',n:'Position',f:function(){let h=sld('X',-200,200,_vt.x,'x')+sld('Y',-200,200,_vt.y,'y');show('Position',h,function(){wire('.slider','input',function(){let k=this.getAttribute('data-cb');if(k==='x'){_vt.x=parseInt(this.value);document.getElementById('val-X').textContent=_vt.x;}else if(k==='y'){_vt.y=parseInt(this.value);document.getElementById('val-Y').textContent=_vt.y;}aT();});});}},
{i:3,c:'EDIT',n:'Resize',f:function(){let h=sld('Scale',0.5,3,_vt.s.toFixed(2),'scale');show('Resize',h,function(){wire('.slider','input',function(){_vt.s=parseFloat(this.value);document.getElementById('val-Scale').textContent=_vt.s.toFixed(2);aT();});});}},
{i:4,c:'EDIT',n:'Brightness',f:function(){let h=sld('Brightness',0,200,_vf.b,'bright');show('Brightness',h,function(){wire('.slider','input',function(){_vf.b=parseInt(this.value);document.getElementById('val-Brightness').textContent=_vf.b;aF();});});}},
{i:5,c:'EDIT',n:'Contrast',f:function(){let h=sld('Contrast',0,200,_vf.c,'contrast');show('Contrast',h,function(){wire('.slider','input',function(){_vf.c=parseInt(this.value);document.getElementById('val-Contrast').textContent=_vf.c;aF();});});}},
{i:6,c:'EDIT',n:'Saturation',f:function(){let h=sld('Saturation',0,200,_vf.sat,'sat');show('Saturation',h,function(){wire('.slider','input',function(){_vf.sat=parseInt(this.value);document.getElementById('val-Saturation').textContent=_vf.sat;aF();});});}},
{i:7,c:'EDIT',n:'Hue Shift',f:function(){let h=sld('Hue',-180,180,_vf.hue,'hue');show('Hue Shift',h,function(){wire('.slider','input',function(){_vf.hue=parseInt(this.value);document.getElementById('val-Hue').textContent=_vf.hue;aF();});});}},
{i:8,c:'EDIT',n:'Blur',f:function(){let h=sld('Blur',0,20,_vf.blur,'blur');show('Blur',h,function(){wire('.slider','input',function(){_vf.blur=parseInt(this.value);document.getElementById('val-Blur').textContent=_vf.blur;aF();});});}},
{i:9,c:'EDIT',n:'Zoom',f:function(){let h=sld('Zoom',0.5,3,_vt.s.toFixed(2),'z');show('Zoom',h,function(){wire('.slider','input',function(){_vt.s=parseFloat(this.value);document.getElementById('val-Zoom').textContent=_vt.s.toFixed(2);aT();});});}},
{i:10,c:'EDIT',n:'Text Overlay',f:function(){let h='<input type="text" id="txt-input" placeholder="Enter text..." style="width:100%;padding:12px;border-radius:4px;border:1px solid #555;background:#333;color:white;margin:12px 0;font-size:14px;">';h+='<div>'+sld('Size',12,72,32,'size')+sld('Opacity',0,100,100,'op')+'</div>';show('Text Overlay',h,function(){document.getElementById('txt-input').addEventListener('input',function(){let txt=this.value;let v=document.querySelector('#videoPlayer');if(!v) return;let overlay=v.parentElement.querySelector('.txt-overlay');if(!overlay){overlay=document.createElement('div');overlay.className='txt-overlay';overlay.style.cssText='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:white;font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,0.8);z-index:100;pointer-events:none;';v.parentElement.style.position='relative';v.parentElement.appendChild(overlay);}overlay.textContent=txt;});wire('.slider','input',function(){let k=this.getAttribute('data-cb');if(k==='size'){let ov=document.querySelector('.txt-overlay');if(ov) ov.style.fontSize=this.value+'px';document.getElementById('val-Size').textContent=this.value;}else if(k==='op'){let ov=document.querySelector('.txt-overlay');if(ov) ov.style.opacity=this.value/100;document.getElementById('val-Opacity').textContent=this.value;}});});}},
{i:11,c:'EDIT',n:'Captions',f:function(){let h='<input type="text" id="cap-input" placeholder="Add caption text..." style="width:100%;padding:12px;border-radius:4px;border:1px solid #555;background:#333;color:white;margin:12px 0;font-size:14px;">';show('Captions',h,function(){document.getElementById('cap-input').addEventListener('input',function(){let txt=this.value;let v=document.querySelector('#videoPlayer');if(!v) return;let cap=v.parentElement.querySelector('.caption');if(!cap){cap=document.createElement('div');cap.className='caption';cap.style.cssText='position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:12px 20px;border-radius:6px;text-align:center;max-width:80%;z-index:100;pointer-events:none;font-size:14px;';v.parentElement.style.position='relative';v.parentElement.appendChild(cap);}cap.textContent=txt;});});}},
{i:0,c:'AUDIO',n:'Volume',f:function(){let h=sld('Volume',0,100,100,'vol');show('Volume',h,function(){wire('.slider','input',function(){let v=document.querySelector('#videoPlayer');if(v) v.volume=this.value/100;document.getElementById('val-Volume').textContent=this.value;});});}},
{i:1,c:'AUDIO',n:'Music Library',f:showMusicLibrary},
{i:2,c:'AUDIO',n:'Sound Effects',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">';let fx=['Pop','Whoosh','Click','Beep','Ding','Splash','Crash','Thunder','Swoosh','Chime','Snap','Horn','Siren','Drip','Buzz','Alarm'];for(let s of fx){h+='<button class="sfx-btn" data-sfx="'+s+'" style="padding:16px;background:#FF6B35;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+s+'</button>';}h+='</div>';show('Sound Effects',h,function(){wire('.sfx-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let sfx=this.getAttribute('data-sfx');let ctx=new(window.AudioContext||window.webkitAudioContext)();let osc=ctx.createOscillator();let gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);let freqs={Pop:800,Whoosh:200,Click:1200,Beep:880,Ding:1500,Splash:300,Crash:100,Thunder:60,Swoosh:400,Chime:1800,Snap:1000,Horn:220,Siren:600,Drip:500,Buzz:150,Alarm:700};osc.frequency.value=freqs[sfx]||440;gain.gain.value=0.3;osc.start();setTimeout(function(){osc.stop();ctx.close();},200);let trk=document.querySelector('[data-track="A1"]')||document.querySelector('[data-track="FX"]');if(trk){let el=document.createElement('div');el.style.cssText='background:#FF6B35;padding:6px 12px;border-radius:4px;margin:2px;color:white;font-weight:bold;font-size:11px;display:inline-block;';el.textContent='SFX: '+sfx;trk.appendChild(el);}toast('Added SFX to timeline: '+sfx);});});}},
{i:3,c:'AUDIO',n:'Equalizer',f:function(){let h=sld('Bass',0,200,100,'bass')+sld('Mids',0,200,100,'mids')+sld('Treble',0,200,100,'treble');show('Equalizer',h,function(){wire('.slider','input',function(){document.getElementById('val-Bass').textContent=this.value;document.getElementById('val-Mids').textContent=this.value;document.getElementById('val-Treble').textContent=this.value;});});}},
{i:4,c:'AUDIO',n:'Fade In/Out',f:function(){let h=sld('Fade In',0,2,1,'fadein')+sld('Fade Out',0,2,1,'fadeout');show('Fade In/Out',h,function(){wire('.slider','input',function(){let k=this.getAttribute('data-cb');if(k==='fadein') document.getElementById('val-Fade In').textContent=this.value;else document.getElementById('val-Fade Out').textContent=this.value;});});}},
{i:5,c:'AUDIO',n:'Audio Mixing',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">';let tracks=['V1','A1','M1','T1','FX'];for(let t of tracks){h+='<div><label style="color:#aaa;">'+t+'</label>'+sld(t,0,100,50,t.toLowerCase())+'</div>';}h+='</div>';show('Audio Mixing',h,function(){wire('.slider','input',function(){let k=this.getAttribute('data-cb');document.getElementById('val-'+k).textContent=this.value;});});}},
{i:6,c:'AUDIO',n:'Reverb',f:function(){let h=sld('Room Size',0,100,50,'room')+sld('Decay',0,100,50,'decay')+sld('Wet',0,100,30,'wet');show('Reverb',h,function(){wire('.slider','input',function(){document.getElementById('val-Room Size').textContent=this.value;document.getElementById('val-Decay').textContent=this.value;document.getElementById('val-Wet').textContent=this.value;});});}},
{i:7,c:'AUDIO',n:'Compression',f:function(){let h=sld('Threshold',-40,0,-20,'thresh')+sld('Ratio',1,16,4,'ratio')+sld('Attack',0,100,10,'attack');show('Compression',h,function(){wire('.slider','input',function(){document.getElementById('val-Threshold').textContent=this.value;document.getElementById('val-Ratio').textContent=this.value;document.getElementById('val-Attack').textContent=this.value;});});}},
{i:0,c:'AI',n:'Auto Enhance',f:function(){let h='<div style="display:grid;grid-template-columns:1fr;gap:8px;">';let opts=['Brightness','Color','Contrast','Sharpness'];for(let o of opts){h+='<button class="enhance-opt" data-opt="'+o+'" style="padding:12px;background:#007bff;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">'+o+'</button>';}h+='</div>';show('Auto Enhance',h,function(){wire('.enhance-opt','mousedown',function(e){e.preventDefault();e.stopPropagation();let opt=this.getAttribute('data-opt');if(opt==='Brightness') _vf.b=120;else if(opt==='Color') _vf.sat=130;else if(opt==='Contrast') _vf.c=120;else if(opt==='Sharpness') _vf.blur=-2;aF();toast('Applied: '+opt);hide();});});}},
{i:1,c:'AI',n:'Scene Detection',f:function(){show('Scene Detection','<p style="color:#aaa;">Analyzing video for scene changes...</p><div style="background:#333;padding:12px;border-radius:6px;margin-top:12px;"><p style="color:#fff;margin:8px 0;">Detected Scenes:</p><p style="color:#28a745;margin:4px 0;">â¢ 0:00-0:15 - Indoor</p><p style="color:#28a745;margin:4px 0;">â¢ 0:15-0:45 - Outdoor</p><p style="color:#28a745;margin:4px 0;">â¢ 0:45-1:30 - Close-up</p></div>');}},
{i:2,c:'AI',n:'Auto Subtitle',f:function(){show('Auto Subtitle','<p style="color:#aaa;">Generating subtitles from audio...</p><div style="background:#333;padding:12px;border-radius:6px;margin-top:12px;"><p style="color:#fff;margin:8px 0;">Generated Subtitles:</p><p style="color:#fff;margin:4px 0;">[0:00-0:05] "Welcome to the video"</p><p style="color:#fff;margin:4px 0;">[0:05-0:12] "This is an example subtitle"</p><p style="color:#fff;margin:4px 0;">[0:12-0:20] "Auto-generated from audio"</p><button class="apply-sub" style="background:#28a745;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-top:12px;">Apply Subtitles</button></div>',function(){document.querySelector('.apply-sub').addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();let v=document.querySelector('#videoPlayer');if(!v) return;let sub=v.parentElement.querySelector('.auto-sub');if(!sub){sub=document.createElement('div');sub.className='auto-sub';sub.style.cssText='position:absolute;bottom:10px;left:50%;transform:translateX(-50%);color:white;background:rgba(0,0,0,0.8);padding:8px 16px;border-radius:4px;width:90%;text-align:center;z-index:100;pointer-events:none;font-size:13px;';v.parentElement.style.position='relative';v.parentElement.appendChild(sub);}sub.textContent='[Subtitles Applied]';toast('Subtitles applied');hide();});});}},
{i:3,c:'AI',n:'Object Tracking',f:function(){show('Object Tracking','<p style="color:#aaa;">Enable object tracking to follow elements in your video.</p><div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:12px;"><button class="track-btn" data-type="person" style="padding:12px;background:#007bff;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Track Person</button><button class="track-btn" data-type="object" style="padding:12px;background:#007bff;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Track Object</button><button class="track-btn" data-type="face" style="padding:12px;background:#007bff;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Track Face</button></div>',function(){wire('.track-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let t=this.getAttribute('data-type');toast('Tracking '+t);hide();});});}},
{i:4,c:'AI',n:'Style Transfer',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">';let styles=['Cinematic','Vintage','Noir','Sketch','Oil Paint','Neon'];for(let s of styles){h+='<button class="style-btn" data-style="'+s+'" style="padding:16px;background:#555;border:2px solid #777;border-radius:6px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+s+'</button>';}h+='</div>';show('Style Transfer',h,function(){wire('.style-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let s=this.getAttribute('data-style');if(s==='Cinematic'){_vf.c=120;_vf.b=110;_vf.sat=80;}else if(s==='Vintage'){_vf.hue=30;_vf.sat=60;_vf.b=90;}else if(s==='Noir'){_vf.c=150;_vf.sat=0;_vf.b=70;}else if(s==='Sketch'){_vf.blur=1;_vf.c=180;_vf.sat=0;}else if(s==='Oil Paint'){_vf.blur=2;_vf.c=110;_vf.sat=140;}else if(s==='Neon'){_vf.sat=200;_vf.hue=180;_vf.b=120;_vf.c=150;}aF();toast('Applied: '+s);hide();});});}},
{i:5,c:'AI',n:'B-Roll',f:showBRollBrowser},
{i:6,c:'AI',n:'Green Screen',f:function(){show('Green Screen Removal','<p style="color:#aaa;">Remove green/blue screen background from video.</p>'+sld('Threshold',0,100,50,'thresh')+sld('Feather',0,100,20,'feather')+'<button id="apply-gs" style="background:#28a745;color:white;border:none;padding:12px 20px;border-radius:6px;cursor:pointer;margin-top:12px;font-weight:bold;width:100%;">Apply Green Screen</button>',function(){wire('.slider','input',function(){document.getElementById('val-Threshold').textContent=this.value;document.getElementById('val-Feather').textContent=this.value;});document.getElementById('apply-gs').addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();let v=document.querySelector('#videoPlayer');if(v) v.style.opacity='0.7';toast('Green screen applied');});});}},
{i:7,c:'AI',n:'Face Blur',f:function(){show('Face Blur','<p style="color:#aaa;">Blur detected faces in the video.</p>'+sld('Blur Strength',0,100,50,'strength')+'<button id="apply-fb" style="background:#28a745;color:white;border:none;padding:12px 20px;border-radius:6px;cursor:pointer;margin-top:12px;font-weight:bold;width:100%;">Apply Face Blur</button>',function(){wire('.slider','input',function(){document.getElementById('val-Blur Strength').textContent=this.value;});document.getElementById('apply-fb').addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();toast('Face blur processing...');setTimeout(function(){toast('Face blur applied');},1000);});});}},
{i:0,c:'FX',n:'Stickers',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">';let stickers=['ð','ð¬','â­','ð¥','ð«','ð¯','ðª','ð­'];for(let s of stickers){h+='<button class="stick-btn" data-stick="'+s+'" style="padding:20px;background:#333;border:2px solid #555;border-radius:6px;color:white;cursor:pointer;font-size:28px;font-weight:bold;">'+s+'</button>';}h+='</div>';show('Stickers',h,function(){wire('.stick-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let s=this.getAttribute('data-stick');let v=document.querySelector('#videoPlayer');if(!v) return;let stick=v.parentElement.querySelector('.sticker');if(!stick){stick=document.createElement('div');stick.className='sticker';stick.style.cssText='position:absolute;top:20px;right:20px;font-size:48px;z-index:100;pointer-events:none;animation:bounce 0.5s ease;';v.parentElement.style.position='relative';v.parentElement.appendChild(stick);}stick.textContent=s;toast('Added sticker: '+s);});});}},
{i:1,c:'FX',n:'Lens Flare',f:function(){show('Lens Flare',sld('Intensity',0,100,50,'int')+sld('Position X',0,100,50,'x')+sld('Position Y',0,100,50,'y')+'<button id="apply-lf" style="background:#28a745;color:white;border:none;padding:12px 20px;border-radius:6px;cursor:pointer;margin-top:12px;font-weight:bold;width:100%;">Apply Effect</button>',function(){wire('.slider','input',function(){let k=this.getAttribute('data-cb');document.getElementById('val-'+{int:'Intensity',x:'Position X',y:'Position Y'}[k]).textContent=this.value;});document.getElementById('apply-lf').addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();let v=document.querySelector('#videoPlayer');if(v) v.style.boxShadow='0 0 40px rgba(255,255,0,0.6)';toast('Lens flare applied');});});}},
{i:2,c:'FX',n:'Glitch',f:function(){let v=document.querySelector('#videoPlayer');if(v){v.style.animation='glitch 0.3s ease';setTimeout(()=>v.style.animation='none',300);}toast('Glitch effect applied');}},
{i:3,c:'FX',n:'Color Grade',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">';let grades=['Cool','Warm','Vibrant','Muted','Sepia','Cyberpunk'];for(let g of grades){h+='<button class="grade-btn" data-grade="'+g+'" style="padding:16px;background:#555;border:2px solid #777;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">'+g+'</button>';}h+='</div>';show('Color Grade',h,function(){wire('.grade-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let g=this.getAttribute('data-grade');if(g==='Cool'){_vf.hue=-30;_vf.sat=90;}else if(g==='Warm'){_vf.hue=30;_vf.sat=110;}else if(g==='Vibrant'){_vf.sat=150;_vf.c=120;}else if(g==='Muted'){_vf.sat=50;_vf.b=95;}else if(g==='Sepia'){_vf.hue=30;_vf.sat=70;_vf.b=110;}else if(g==='Cyberpunk'){_vf.sat=200;_vf.c=140;_vf.hue=180;}aF();toast('Applied: '+g);hide();});});}},
{i:4,c:'FX',n:'Vignette',f:function(){show('Vignette',sld('Darkness',0,100,50,'dark')+sld('Feather',0,100,50,'feather')+'<button id="apply-vig" style="background:#28a745;color:white;border:none;padding:12px 20px;border-radius:6px;cursor:pointer;margin-top:12px;font-weight:bold;width:100%;">Apply Vignette</button>',function(){wire('.slider','input',function(){document.getElementById('val-Darkness').textContent=this.value;document.getElementById('val-Feather').textContent=this.value;});document.getElementById('apply-vig').addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();let v=document.querySelector('#videoPlayer');if(v) v.style.boxShadow='inset 0 0 80px rgba(0,0,0,0.6)';toast('Vignette applied');});});}},
{i:5,c:'FX',n:'Slow Motion',f:function(){let h=sld('Speed',0.25,2,1,'speed');show('Slow Motion',h,function(){wire('.slider','input',function(){let v=document.querySelector('#videoPlayer');if(v) v.playbackRate=parseFloat(this.value);document.getElementById('val-Speed').textContent=this.value;});});}},
{i:6,c:'FX',n:'Particles',f:function(){show('Particles','<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;"><button class="part-btn" data-part="snow" style="padding:16px;background:#a0d0ff;border:none;border-radius:6px;color:#000;cursor:pointer;font-weight:bold;">âï¸ Snow</button><button class="part-btn" data-part="rain" style="padding:16px;background:#4da6ff;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">ð§ï¸ Rain</button><button class="part-btn" data-part="fire" style="padding:16px;background:#ff6b35;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">ð¥ Fire</button><button class="part-btn" data-part="sparkles" style="padding:16px;background:#ffd700;border:none;border-radius:6px;color:#000;cursor:pointer;font-weight:bold;">â¨ Sparkles</button><button class="part-btn" data-part="bubbles" style="padding:16px;background:#87ceeb;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">ð«§ Bubbles</button><button class="part-btn" data-part="hearts" style="padding:16px;background:#ff69b4;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">ð Hearts</button></div>',function(){wire('.part-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let p=this.getAttribute('data-part');let v=document.querySelector('#videoPlayer');if(v){let eff=v.parentElement.querySelector('.particle-ov');if(!eff){eff=document.createElement('div');eff.className='particle-ov';eff.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;z-index:99;pointer-events:none;overflow:hidden;';v.parentElement.style.position='relative';v.parentElement.appendChild(eff);}let emojis={snow:'âï¸',rain:'ð§',fire:'ð¥',sparkles:'â¨',bubbles:'ð«§',hearts:'ð'};eff.innerHTML='';for(let i=0;i<15;i++){let s=document.createElement('span');s.textContent=emojis[p]||'â¨';s.style.cssText='position:absolute;font-size:'+(16+Math.random()*20)+'px;left:'+Math.random()*90+'%;top:'+Math.random()*90+'%;animation:partFloat '+(2+Math.random()*3)+'s ease-in-out infinite;opacity:0.8;';eff.appendChild(s);}}toast('Added particles: '+p);hide();});});}},
{i:7,c:'FX',n:'LUT (Color)',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">';let luts=['Hollywood','Sundance','Portra','Kodak','CineStyle','SciFi'];for(let l of luts){h+='<button class="lut-btn" data-lut="'+l+'" style="padding:16px;background:#555;border:2px solid #777;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">'+l+'</button>';}h+='</div>';show('LUT (Color)',h,function(){wire('.lut-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let l=this.getAttribute('data-lut');if(l==='Hollywood'){_vf.c=130;_vf.sat=110;_vf.hue=5;}else if(l==='Sundance'){_vf.b=110;_vf.sat=140;_vf.hue=-20;}else if(l==='Portra'){_vf.sat=80;_vf.hue=15;_vf.b=105;}else if(l==='Kodak'){_vf.c=120;_vf.sat=120;_vf.hue=10;}else if(l==='CineStyle'){_vf.c=140;_vf.sat=85;_vf.b=95;}else if(l==='SciFi'){_vf.sat=160;_vf.c=150;_vf.hue=180;_vf.b=110;}aF();toast('Applied LUT: '+l);hide();});});}},
{i:8,c:'AUDIO',n:'Noise Reduce',f:function(){let h=sld('Threshold',0,100,40,'thresh')+sld('Reduction',0,100,60,'red');show('Noise Reduction',h,function(){wire('.slider','input',function(){let k=this.getAttribute('data-cb');document.getElementById('val-Threshold').textContent=this.value;document.getElementById('val-Reduction').textContent=this.value;});});}},
{i:9,c:'AUDIO',n:'Voice Change',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">';let voices=['Deep','High','Robot','Echo','Whisper','Chipmunk'];for(let vo of voices){h+='<button class="voice-btn" data-voice="'+vo+'" style="padding:16px;background:#9B59B6;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+vo+'</button>';}h+='</div>';show('Voice Changer',h,function(){wire('.voice-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let vo=this.getAttribute('data-voice');let v=document.querySelector('#videoPlayer');if(v){let rates={Deep:0.8,High:1.3,Robot:1.0,Echo:0.9,Whisper:0.95,Chipmunk:1.5};v.playbackRate=rates[vo]||1;}toast('Voice: '+vo);hide();});});}},
{i:10,c:'AUDIO',n:'Audio Speed',f:function(){let h=sld('Speed',0.25,3,1,'aspeed');show('Audio Speed',h,function(){wire('.slider','input',function(){let v=document.querySelector('#videoPlayer');if(v) v.playbackRate=parseFloat(this.value);document.getElementById('val-Speed').textContent=parseFloat(this.value).toFixed(2);});});}},
{i:11,c:'AUDIO',n:'Properties',f:function(){let h=sld('Opacity',0,100,_vf.op,'op')+sld('Volume',0,100,100,'vol')+sld('Speed',0.25,3,1,'speed');show('Properties',h,function(){wire('.slider','input',function(){let k=this.getAttribute('data-cb');if(k==='op'){_vf.op=parseInt(this.value);document.getElementById('val-Opacity').textContent=this.value;aF();}else if(k==='vol'){let v=document.querySelector('#videoPlayer');if(v) v.volume=this.value/100;document.getElementById('val-Volume').textContent=this.value;}else if(k==='speed'){let v=document.querySelector('#videoPlayer');if(v) v.playbackRate=parseFloat(this.value);document.getElementById('val-Speed').textContent=parseFloat(this.value).toFixed(2);}});});}},
{i:8,c:'AI',n:'BG Remove',f:function(){show('Background Remove',sld('Opacity',0,100,100,'bgop')+'<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;"><button class="bg-btn" data-bg="transparent" style="padding:16px;background:#333;border:2px solid #555;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Transparent</button><button class="bg-btn" data-bg="blur" style="padding:16px;background:#333;border:2px solid #555;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Blur BG</button><button class="bg-btn" data-bg="color" style="padding:16px;background:#333;border:2px solid #555;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Solid Color</button></div>',function(){wire('.slider','input',function(){_vf.op=parseInt(this.value);document.getElementById('val-Opacity').textContent=this.value;aF();});wire('.bg-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let bg=this.getAttribute('data-bg');if(bg==='transparent'){_vf.op=50;aF();}else if(bg==='blur'){_vf.blur=8;aF();}else{let v=document.querySelector('#videoPlayer');if(v) v.parentElement.style.background='#00ff00';}toast('BG: '+bg);hide();});});}},
{i:9,c:'AI',n:'AI Voice',f:function(){let h='<textarea id="tts-text" placeholder="Type text for AI voiceover..." style="width:100%;height:100px;padding:12px;border-radius:4px;border:1px solid #555;background:#333;color:white;margin:12px 0;font-size:14px;resize:vertical;"></textarea>';h+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;"><button class="tts-btn" data-voice="male" style="padding:12px;background:#007bff;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Male</button><button class="tts-btn" data-voice="female" style="padding:12px;background:#e83e8c;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Female</button><button class="tts-btn" data-voice="child" style="padding:12px;background:#20c997;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;">Child</button></div>';show('AI Voice',h,function(){wire('.tts-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let voice=this.getAttribute('data-voice');let txt=document.getElementById('tts-text').value||'Sample voiceover';if(window.speechSynthesis){let u=new SpeechSynthesisUtterance(txt);u.rate=voice==='child'?1.4:voice==='female'?1.1:0.9;u.pitch=voice==='child'?1.5:voice==='female'?1.2:0.8;speechSynthesis.speak(u);}let trk=document.querySelector('[data-track="A1"]');if(trk){let el=document.createElement('div');el.style.cssText='background:#9B59B6;padding:6px 12px;border-radius:4px;margin:2px;color:white;font-weight:bold;font-size:11px;display:inline-block;';el.textContent='VO: '+voice;trk.appendChild(el);}toast('AI Voice added');});});}},
{i:10,c:'AI',n:'Smart Crop',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">';let ratios=['16:9','9:16','1:1','4:3','4:5','21:9'];for(let r of ratios){h+='<button class="ratio-btn" data-ratio="'+r+'" style="padding:16px;background:#555;border:2px solid #777;border-radius:6px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+r+'</button>';}h+='</div>';show('Smart Crop',h,function(){wire('.ratio-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let r=this.getAttribute('data-ratio');let v=document.querySelector('#videoPlayer');if(v){let parts=r.split(':');let w=parseInt(parts[0]);let ht=parseInt(parts[1]);if(w>ht){v.style.objectFit='cover';v.style.aspectRatio=r.replace(':','/');}else{v.style.objectFit='cover';v.style.aspectRatio=r.replace(':','/');}}toast('Cropped to '+r);hide();});});}},
{i:11,c:'AI',n:'Translate',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">';let langs=['Spanish','French','German','Japanese','Chinese','Arabic','Portuguese','Korean'];for(let l of langs){h+='<button class="lang-btn" data-lang="'+l+'" style="padding:16px;background:#17a2b8;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+l+'</button>';}h+='</div>';show('Translate Subtitles',h,function(){wire('.lang-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let l=this.getAttribute('data-lang');let v=document.querySelector('#videoPlayer');if(v){let sub=v.parentElement.querySelector('.trans-sub');if(!sub){sub=document.createElement('div');sub.className='trans-sub';sub.style.cssText='position:absolute;bottom:10px;left:50%;transform:translateX(-50%);color:yellow;background:rgba(0,0,0,0.8);padding:8px 16px;border-radius:4px;width:90%;text-align:center;z-index:100;pointer-events:none;font-size:13px;';v.parentElement.style.position='relative';v.parentElement.appendChild(sub);}let translations={Spanish:'Bienvenido al video',French:'Bienvenue dans la vidÃ©o',German:'Willkommen zum Video',Japanese:'ãããªã¸ãããã',Chinese:'æ¬¢è¿è§çè§é¢',Arabic:'ÙØ±Ø­Ø¨Ø§ Ø¨ÙÙ ÙÙ Ø§ÙÙÙØ¯ÙÙ',Portuguese:'Bem-vindo ao vÃ­deo',Korean:'ë¹ëì¤ì ì¤ì  ê²ì ííí©ëë¤'};sub.textContent='['+l+'] '+translations[l];}toast('Translated to '+l);hide();});});}},
{i:4,c:'FX',n:'Split Screen',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">';let layouts=['Left/Right','Top/Bottom','Quad','3-Way','PiP Left','PiP Right'];for(let l of layouts){h+='<button class="split-btn" data-layout="'+l+'" style="padding:16px;background:#555;border:2px solid #777;border-radius:6px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+l+'</button>';}h+='</div>';show('Split Screen',h,function(){wire('.split-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let l=this.getAttribute('data-layout');let v=document.querySelector('#videoPlayer');if(v){if(l==='Left/Right'){v.style.clipPath='inset(0 50% 0 0)';}else if(l==='Top/Bottom'){v.style.clipPath='inset(0 0 50% 0)';}else if(l==='Quad'){v.style.clipPath='inset(0 50% 50% 0)';}else if(l==='3-Way'){v.style.clipPath='polygon(0 0,60% 0,60% 100%,0 100%)';}else if(l==='PiP Left'){_vt.s=0.4;_vt.x=-120;_vt.y=80;aT();}else{_vt.s=0.4;_vt.x=120;_vt.y=80;aT();}}toast('Layout: '+l);hide();});});}},
{i:9,c:'FX',n:'Freeze Frame',f:function(){let v=document.querySelector('#videoPlayer');if(v&&!v.paused){v.pause();let trk=document.querySelector('[data-track="V1"]');if(trk){let el=document.createElement('div');el.style.cssText='background:#FFC107;padding:6px 12px;border-radius:4px;margin:2px;color:#000;font-weight:bold;font-size:11px;display:inline-block;';el.textContent='FREEZE @'+v.currentTime.toFixed(1)+'s';trk.appendChild(el);}toast('Frame frozen at '+v.currentTime.toFixed(1)+'s');}else{if(v) v.play();toast('Resumed playback');}}},
{i:10,c:'FX',n:'Speed Ramp',f:function(){let h='<div style="display:grid;grid-template-columns:1fr;gap:12px;">';let ramps=['Slow Start â Fast','Fast Start â Slow','Pulse (Fast-Slow-Fast)','Dramatic Slow-Mo','Speed Burst'];for(let r of ramps){h+='<button class="ramp-btn" data-ramp="'+r+'" style="padding:14px;background:#E67E22;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;transition:all 0.2s;">'+r+'</button>';}h+='</div>';show('Speed Ramp',h,function(){wire('.ramp-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let r=this.getAttribute('data-ramp');let v=document.querySelector('#videoPlayer');if(v){let rates=[];if(r.includes('Slow Start')){rates=[0.5,0.7,1,1.5,2];}else if(r.includes('Fast Start')){rates=[2,1.5,1,0.7,0.5];}else if(r.includes('Pulse')){rates=[2,0.5,2,0.5,2];}else if(r.includes('Dramatic')){rates=[0.25,0.3,0.4,0.5,0.6];}else{rates=[1,3,1,3,1];}let i=0;let interval=setInterval(function(){if(i>=rates.length){clearInterval(interval);v.playbackRate=1;return;}v.playbackRate=rates[i];i++;},600);}toast('Speed ramp: '+r);hide();});});}},
{i:11,c:'FX',n:'Annotations',f:function(){let h='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;"><button class="ann-btn" data-type="arrow" style="padding:16px;background:#E74C3C;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;font-size:20px;">â Arrow</button><button class="ann-btn" data-type="circle" style="padding:16px;background:#3498DB;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;font-size:20px;">â Circle</button><button class="ann-btn" data-type="box" style="padding:16px;background:#2ECC71;border:none;border-radius:6px;color:white;cursor:pointer;font-weight:bold;font-size:20px;">â¡ Box</button><button class="ann-btn" data-type="highlight" style="padding:16px;background:#F1C40F;border:none;border-radius:6px;color:#000;cursor:pointer;font-weight:bold;font-size:20px;">â  Highlight</button></div>';show('Annotations',h,function(){wire('.ann-btn','mousedown',function(e){e.preventDefault();e.stopPropagation();let t=this.getAttribute('data-type');let v=document.querySelector('#videoPlayer');if(v){let ann=document.createElement('div');ann.className='annotation';ann.style.cssText='position:absolute;z-index:100;pointer-events:none;';v.parentElement.style.position='relative';if(t==='arrow'){ann.style.cssText+='top:50%;left:20%;font-size:60px;color:#E74C3C;text-shadow:2px 2px 4px rgba(0,0,0,0.5);';ann.textContent='â';}else if(t==='circle'){ann.style.cssText+='top:30%;left:30%;width:120px;height:120px;border:4px solid #3498DB;border-radius:50%;';}else if(t==='box'){ann.style.cssText+='top:20%;left:20%;width:150px;height:100px;border:4px solid #2ECC71;border-radius:4px;';}else{ann.style.cssText+='top:40%;left:10%;width:80%;padding:8px;background:rgba(241,196,15,0.4);border-radius:4px;';}v.parentElement.appendChild(ann);}toast('Added: '+t);hide();});});}}
];

document.querySelectorAll('.cat-btn').forEach((tab,ti)=>{
tab.addEventListener('mousedown',function(e){
e.preventDefault();
e.stopPropagation();
let cat=tab.textContent.trim();
document.querySelectorAll('.cat-content-new').forEach(c=>c.style.display='none');
let idx=Array.from(document.querySelectorAll('.cat-btn')).indexOf(tab);
document.querySelectorAll('.cat-content-new')[idx].style.display='block';
});
});

document.querySelectorAll('.tb3').forEach((btn,bi)=>{
let ci=Math.floor(bi/12);
let ni=bi%12;
let catName=['EDIT','AUDIO','AI','FX'][ci];
let binfo=btns.filter(b=>b.c===catName)[ni];
if(binfo){
btn.textContent=binfo.n;
btn.addEventListener('mousedown',function(e){
e.preventDefault();
e.stopPropagation();
binfo.f();
});
btn.style.cssText='background:#007bff;color:white;border:none;padding:12px 16px;border-radius:6px;cursor:pointer;font-weight:bold;transition:all 0.2s;';
btn.addEventListener('mouseover',function(){this.style.background='#0056b3';});
btn.addEventListener('mouseout',function(){this.style.background='#007bff';});
}
});

let style=document.createElement('style');
style.textContent='@keyframes bounce{0%{transform:scale(1);}50%{transform:scale(1.2);}100%{transform:scale(1);}}.glitch{animation:glitch 0.3s ease;}@keyframes glitch{0%{transform:translateX(-2px);}50%{transform:translateX(2px);}100%{transform:translateX(0);}}@keyframes partFloat{0%{transform:translateY(0) rotate(0deg);opacity:0.8;}50%{transform:translateY(-20px) rotate(180deg);opacity:1;}100%{transform:translateY(0) rotate(360deg);opacity:0.8;}}';
document.head.appendChild(style);
},2200);
