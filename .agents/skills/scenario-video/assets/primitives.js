/* scenario-video: the fixed look. Palette, type, drawing primitives and the vignette types. Scenarios never change this file. */
const W=1280,H=720;
const K={paper:"#f6f8fb",card:"#ffffff",ink:"#18212d",muted:"#5d6878",line:"#d9dfe7",slate:"#4a6a9e",agent:"#5b52d6",light:"#8f88e6",app:"#1f9a6a",gate:"#e0613b",amber:"#c98a1a",grey:"#a3acb9"};
const FONT='"IBM Plex Sans","Helvetica Neue",Arial,sans-serif',DFONT='"Bricolage Grotesque","Helvetica Neue",Arial,sans-serif',MFONT='"IBM Plex Mono",ui-monospace,Menlo,monospace';
const AV=42,AW=142,AH=42;
const cv=document.getElementById("cv"),ctx=cv.getContext("2d");
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
const easeOut=x=>1-Math.pow(1-x,3);
const back=x=>{const c=1.7;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
const win=(t,a,d)=>clamp((t-a)/d);
const band=(t,a,b,f=0.4)=>Math.min(win(t,a,f),1-win(t,b-f,f));
const lerp=(a,b,m)=>a+(b-a)*m;
const col=c=>K[c]||c;

/* ---------- basics ---------- */
function alphaDo(a,fn){if(a<=0.001)return;ctx.save();ctx.globalAlpha*=a;fn();ctx.restore()}
function text(x,y,s,o={}){ctx.font=`${o.w||500} ${o.size||14}px ${o.font||FONT}`;ctx.fillStyle=o.col||K.ink;ctx.textAlign=o.align||"center";ctx.textBaseline="alphabetic";ctx.fillText(s,x,y)}
function tw(s,size,w,font){ctx.font=`${w||500} ${size}px ${font||FONT}`;return ctx.measureText(s).width}
function ctrl(a,b,bend){const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=b.x-a.x,dy=b.y-a.y;return{x:mx-dy*bend,y:my+dx*bend}}
function qpt(a,c,b,f){const u=1-f;return{x:u*u*a.x+2*u*f*c.x+f*f*b.x,y:u*u*a.y+2*u*f*c.y+f*f*b.y}}
function link(ka,kb,bend){const a0=pt(ka),b0=pt(kb),c0=ctrl(a0,b0,bend);const a=edge(ka,c0),b=edge(kb,c0);return{a,b,c:ctrl(a,b,bend)}}
function stroke(l,o={}){ctx.save();ctx.strokeStyle=o.col||K.slate;ctx.lineWidth=o.w||2;ctx.lineCap="round";if(o.dash)ctx.setLineDash(o.dash);
  if(o.glow){ctx.shadowColor="rgba(74,106,158,.35)";ctx.shadowBlur=8}
  const f=o.frac==null?1:o.frac;ctx.beginPath();ctx.moveTo(l.a.x,l.a.y);const n=32;for(let i=1;i<=n;i++){const p=qpt(l.a,l.c,l.b,f*i/n);ctx.lineTo(p.x,p.y)}ctx.stroke();ctx.restore()}
function rrect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function shadow(on,blur=18,y=6,c="rgba(24,33,45,.12)"){if(on){ctx.shadowColor=c;ctx.shadowBlur=blur;ctx.shadowOffsetY=y}else{ctx.shadowColor="transparent";ctx.shadowBlur=0;ctx.shadowOffsetY=0}}
function plate(x,y,w,h){ctx.save();ctx.fillStyle="rgba(246,248,251,.94)";rrect(x-w/2,y,w,h,7);ctx.fill();ctx.restore()}
const pop=amt=>({a:Math.min(1,amt*2),s:0.6+0.4*back(amt)});
function scaled(x,y,s,fn){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.translate(-x,-y);fn();ctx.restore()}

/* ---------- people: spec {skin, hair, style: short|bun|long|curly|fringe, beard, glasses, bg, shirt} ---------- */
function avatar(x,y,r,sp,o={}){
  ctx.save();
  if(o.ring){ctx.save();ctx.globalAlpha*=o.ring;ctx.beginPath();ctx.arc(x,y,r+8+(o.pulse||0),0,7);ctx.strokeStyle=K.gate;ctx.lineWidth=3.5;ctx.stroke();ctx.restore()}
  shadow(true,14,4);ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fillStyle="#fff";ctx.fill();shadow(false);
  ctx.beginPath();ctx.arc(x,y,r-3,0,7);ctx.save();ctx.clip();
  ctx.fillStyle=sp.bg;ctx.fillRect(x-r,y-r,2*r,2*r);
  const hx=x,hy=y-0.1*r,hr=0.34*r,hry=hr*1.12;
  ctx.fillStyle=sp.hair;
  if(sp.style==="curly"){ctx.beginPath();ctx.arc(hx,hy-0.18*hr,hr*1.38,0,7);ctx.fill();for(let i=0;i<11;i++){const a=Math.PI*(0.9+i*0.12);ctx.beginPath();ctx.arc(hx+Math.cos(a)*hr*1.3,hy-0.18*hr+Math.sin(a)*hr*1.3,hr*0.34,0,7);ctx.fill()}}
  if(sp.style==="long"){rrect(hx-hr*1.3,hy-hr*1.2,hr*2.6,hr*3.0,hr*1.15);ctx.fill()}
  if(sp.style==="short"||sp.style==="fringe"||sp.style==="bun"){ctx.beginPath();ctx.ellipse(hx,hy-hr*0.18,hr*1.12,hry*1.04,0,0,7);ctx.fill()}
  ctx.fillStyle=sp.shirt;ctx.beginPath();ctx.ellipse(x,y+0.88*r,0.72*r,0.5*r,0,0,7);ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.18)";ctx.beginPath();ctx.ellipse(x,y+0.42*r,0.16*r,0.07*r,0,0,7);ctx.fill();
  ctx.fillStyle=sp.skin;rrect(hx-0.14*r,hy+0.55*hr,0.28*r,0.42*r,5);ctx.fill();
  ctx.beginPath();ctx.ellipse(hx,hy,hr,hry,0,0,7);ctx.fill();
  ctx.save();ctx.beginPath();ctx.ellipse(hx,hy,hr,hry,0,0,7);ctx.clip();ctx.fillStyle=sp.hair;
  if(sp.style==="short"){ctx.beginPath();ctx.ellipse(hx,hy-hry*0.82,hr*1.15,hry*0.42,0,0,7);ctx.fill()}
  if(sp.style==="bun"){ctx.beginPath();ctx.ellipse(hx,hy-hry*0.78,hr*1.15,hry*0.45,0,0,7);ctx.fill()}
  if(sp.style==="fringe"){ctx.beginPath();ctx.moveTo(hx-hr*1.2,hy-hry*1.2);ctx.lineTo(hx+hr*1.2,hy-hry*1.2);ctx.lineTo(hx+hr*1.2,hy-hry*0.32);ctx.quadraticCurveTo(hx,hy-hry*0.42,hx-hr*1.2,hy-hry*0.28);ctx.fill()}
  if(sp.style==="long"){ctx.beginPath();ctx.moveTo(hx+hr*1.2,hy-hry*1.2);ctx.lineTo(hx+hr*1.2,hy-hry*0.2);ctx.quadraticCurveTo(hx+hr*0.1,hy-hry*0.55,hx-hr*0.3,hy-hry*1.2);ctx.fill();ctx.beginPath();ctx.ellipse(hx-hr*0.2,hy-hry*0.9,hr*1.1,hry*0.35,0,0,7);ctx.fill()}
  if(sp.style==="curly"){ctx.beginPath();ctx.ellipse(hx,hy-hry*0.88,hr*1.1,hry*0.4,0,0,7);ctx.fill()}
  if(sp.beard){ctx.beginPath();ctx.moveTo(hx-hr*1.1,hy+hry*0.05);ctx.quadraticCurveTo(hx,hy+hry*1.55,hx+hr*1.1,hy+hry*0.05);ctx.lineTo(hx+hr*1.1,hy+hry*1.3);ctx.lineTo(hx-hr*1.1,hy+hry*1.3);ctx.fill()}
  ctx.restore();
  if(sp.style==="bun"){ctx.fillStyle=sp.hair;ctx.beginPath();ctx.arc(hx,hy-hry*1.22,hr*0.46,0,7);ctx.fill()}
  ctx.fillStyle="#1f2329";ctx.beginPath();ctx.arc(hx-hr*0.36,hy+hry*0.04,hr*0.09,0,7);ctx.arc(hx+hr*0.36,hy+hry*0.04,hr*0.09,0,7);ctx.fill();
  ctx.strokeStyle=sp.beard?"#f3dccb":"#1f2329";ctx.lineWidth=Math.max(1.1,hr*0.075);ctx.lineCap="round";ctx.beginPath();ctx.arc(hx,hy+hry*0.3,hr*0.26,0.22*Math.PI,0.78*Math.PI);ctx.stroke();
  ctx.fillStyle="rgba(224,97,59,.18)";ctx.beginPath();ctx.arc(hx-hr*0.55,hy+hry*0.3,hr*0.16,0,7);ctx.arc(hx+hr*0.55,hy+hry*0.3,hr*0.16,0,7);ctx.fill();
  if(sp.glasses){ctx.strokeStyle="#1f2329";ctx.lineWidth=Math.max(1.1,hr*0.075);ctx.beginPath();ctx.arc(hx-hr*0.37,hy+hry*0.04,hr*0.26,0,7);ctx.moveTo(hx+hr*0.63,hy+hry*0.04);ctx.arc(hx+hr*0.37,hy+hry*0.04,hr*0.26,0,7);ctx.moveTo(hx-hr*0.11,hy+hry*0.02);ctx.lineTo(hx+hr*0.11,hy+hry*0.02);ctx.stroke()}
  ctx.restore();ctx.restore();
}

/* ---------- agents, apps (kind process: a plain process; kind fleet: the fleet), computers, the Aeolus port ---------- */
function sparkle(x,y,s,c="#fff"){ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(x,y-s);ctx.quadraticCurveTo(x,y,x+s,y);ctx.quadraticCurveTo(x,y,x,y+s);ctx.quadraticCurveTo(x,y,x-s,y);ctx.quadraticCurveTo(x,y,x,y-s);ctx.fill()}
function agentBadge(g,r,c,glow){ctx.save();if(glow){ctx.shadowColor=K.agent;ctx.shadowBlur=18*glow}else shadow(true,8,2);
  ctx.fillStyle=c;ctx.beginPath();ctx.arc(g.x,g.y,r,0,7);ctx.fill();shadow(false);ctx.strokeStyle="#fff";ctx.lineWidth=r>16?3:2.5;ctx.stroke();sparkle(g.x,g.y,r*0.56);ctx.restore()}
function agentLabelRect(g){
  if(g.kind==="private"){const w=tw(g.label,12,600)+14;return{x:g.x-w/2,y:g.y+g.r+5,w,h:20}}
  const w=tw(g.label,13,700)+20,h=24;
  if(g.lab==="right")return{x:g.x+g.r+8,y:g.y-h/2+4,w,h};
  if(g.lab==="left")return{x:g.x-g.r-8-w,y:g.y-h/2+4,w,h};
  if(g.lab==="above")return{x:g.x-w/2,y:g.y-g.r-8-h,w,h};
  return{x:g.x-w/2,y:g.y+g.r+8,w,h}}
function agentLabel(g){const r=agentLabelRect(g);
  ctx.save();shadow(true,g.kind==="private"?6:8,g.kind==="private"?1:2);ctx.fillStyle="#fff";rrect(r.x,r.y,r.w,r.h,r.h/2);ctx.fill();shadow(false);
  if(g.kind!=="private"){ctx.strokeStyle="rgba(91,82,214,.4)";ctx.lineWidth=1;ctx.stroke()}ctx.restore();
  if(g.kind==="private")text(r.x+r.w/2,r.y+14.3,g.label,{size:12,w:600,col:K.agent});else text(r.x+r.w/2,r.y+16.5,g.label,{size:13,w:700,col:K.agent})}
function port(x,y,s){if(s<=0)return;ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle=K.slate;ctx.beginPath();ctx.arc(0,0,7,0,7);ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2.5;ctx.stroke();ctx.fillStyle="#fff";ctx.fillRect(-3,-1.2,6,2.4);ctx.restore()}
function appTile(a,pj){const w=a.w||AW,h=a.h||AH;
  ctx.save();shadow(true,14,4);ctx.fillStyle=K.card;rrect(a.x-w/2,a.y-h/2,w,h,11);ctx.fill();shadow(false);ctx.strokeStyle=K.line;ctx.lineWidth=1;ctx.stroke();
  const slate=a.kind==="process"||a.kind==="fleet";
  ctx.fillStyle=a.outside?K.grey:slate?K.slate:K.app;rrect(a.x-w/2+12,a.y-9,18,18,5);ctx.fill();
  if(a.kind==="process")promptGlyph(a.x-w/2+21,a.y,"#fff");else if(a.kind==="fleet")sailGlyph(a.x-w/2+21,a.y,"#fff");
  else{ctx.fillStyle="#fff";ctx.fillRect(a.x-w/2+16,a.y-4,10,2.2);ctx.fillRect(a.x-w/2+16,a.y+1,7,2.2)}
  ctx.restore();if(pj>0)port(a.x+w/2,a.y,back(clamp(pj)));text(a.x-w/2+40,a.y+5,a.label,{size:14,w:600,col:K.ink,align:"left"})}

/* a computer: a frame with its name and what it runs; its trierarch and sessions are drawn inside by the scenario */
function frameBox(f){ctx.save();ctx.fillStyle="rgba(255,255,255,.62)";rrect(f.x,f.y,f.w,f.h,18);ctx.fill();ctx.strokeStyle=K.line;ctx.lineWidth=1.2;ctx.stroke();
  ctx.fillStyle=K.line;ctx.fillRect(f.x+1,f.y+46,f.w-2,1);ctx.restore();
  (f.glyph==="chat"?chatGlyph:f.glyph==="prompt"?promptGlyph:monitorGlyph)(f.x+26,f.y+23,K.muted);text(f.x+44,f.y+28.5,f.label,{size:15,w:700,align:"left"});
  if(f.sub)text(f.x+44+tw(f.label,15,700)+10,f.y+28.5,f.sub,{size:12.5,w:500,col:K.muted,align:"left"})}

/* ---------- what travels: icons ---------- */
function mailIcon(x,y,c=K.amber){ctx.save();ctx.translate(x,y);shadow(true,8,2);ctx.fillStyle="#fff";rrect(-14,-10,28,20,4);ctx.fill();shadow(false);ctx.strokeStyle=c;ctx.lineWidth=1.8;ctx.stroke();ctx.beginPath();ctx.moveTo(-13,-9);ctx.lineTo(0,1.5);ctx.lineTo(13,-9);ctx.stroke();ctx.restore()}
function docIcon(x,y){ctx.save();ctx.translate(x,y);shadow(true,8,2);ctx.fillStyle="#fff";rrect(-10,-13,20,26,3);ctx.fill();shadow(false);ctx.strokeStyle=K.muted;ctx.lineWidth=1.4;ctx.stroke();ctx.fillStyle=K.line;ctx.fillRect(-6,-7,12,2.2);ctx.fillRect(-6,-2,12,2.2);ctx.fillRect(-6,3,8,2.2);ctx.restore()}
function handset(x,y,s,c){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.rotate(-0.65);ctx.fillStyle=c;rrect(-7,-2.3,14,4.6,2.3);ctx.fill();rrect(-9,-5.5,5.5,8.5,2.4);ctx.fill();rrect(3.5,-5.5,5.5,8.5,2.4);ctx.fill();ctx.restore()}
function callIcon(x,y,wob=0,c=K.app){ctx.save();ctx.translate(x,y);ctx.rotate(wob);shadow(true,8,2);ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(0,0,14,0,7);ctx.fill();shadow(false);ctx.strokeStyle=c;ctx.lineWidth=1.6;ctx.stroke();handset(0,0,0.9,c);ctx.restore()}
function chatIcon(x,y,c=K.amber){ctx.save();ctx.translate(x,y);shadow(true,8,2);ctx.fillStyle="#fff";rrect(-15,-11,30,20,9);ctx.fill();ctx.beginPath();ctx.moveTo(-7,8);ctx.lineTo(-10,14);ctx.lineTo(0,8);ctx.fill();shadow(false);ctx.strokeStyle=c;ctx.lineWidth=1.5;rrect(-15,-11,30,20,9);ctx.stroke();ctx.fillStyle=c;for(let i=-1;i<=1;i++){ctx.beginPath();ctx.arc(i*6.5,-1,2.1,0,7);ctx.fill()}ctx.restore()}
function chatGlyph(x,y,c=K.slate){ctx.save();ctx.fillStyle=c;rrect(x-8,y-6.5,16,12,4);ctx.fill();ctx.beginPath();ctx.moveTo(x-4,y+4);ctx.lineTo(x-6,y+9);ctx.lineTo(x+1,y+4);ctx.fill();ctx.restore()}
function mailGlyph(x,y,c=K.amber){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=1.5;rrect(x-7,y-5,14,10,2);ctx.stroke();ctx.beginPath();ctx.moveTo(x-6.5,y-4.5);ctx.lineTo(x,y+0.8);ctx.lineTo(x+6.5,y-4.5);ctx.stroke();ctx.restore()}
function vanGlyph(x,y,s,c){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle=c;rrect(-9,-5,12,9,2);ctx.fill();ctx.beginPath();ctx.moveTo(3,-2);ctx.lineTo(7,-2);ctx.lineTo(9,1.5);ctx.lineTo(9,4);ctx.lineTo(3,4);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(-5,4.6,2.2,0,7);ctx.arc(5,4.6,2.2,0,7);ctx.fill();ctx.fillStyle=c;ctx.beginPath();ctx.arc(-5,4.6,1.3,0,7);ctx.arc(5,4.6,1.3,0,7);ctx.fill();ctx.restore()}
function ballGlyph(x,y,r){ctx.save();ctx.fillStyle="#fff";ctx.strokeStyle=K.ink;ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();ctx.stroke();ctx.fillStyle=K.ink;ctx.beginPath();
  for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5;ctx.lineTo(x+Math.cos(a)*r*0.42,y+Math.sin(a)*r*0.42)}ctx.fill();
  ctx.lineWidth=1;for(let i=0;i<5;i++){const a=-Math.PI/2+i*2*Math.PI/5;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*r*0.42,y+Math.sin(a)*r*0.42);ctx.lineTo(x+Math.cos(a)*r*0.95,y+Math.sin(a)*r*0.95);ctx.stroke()}ctx.restore()}
function folderGlyph(x,y,c){ctx.save();ctx.fillStyle=c;rrect(x-7,y-4,14,10,2);ctx.fill();rrect(x-7,y-6.5,6,4,1.5);ctx.fill();ctx.restore()}
function lockGlyph(x,y,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(x,y-2.5,3.6,Math.PI,0);ctx.stroke();ctx.fillStyle=c;rrect(x-5.5,y-2.5,11,8.5,2);ctx.fill();ctx.restore()}
function promptGlyph(x,y,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=2;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(x-5,y-4);ctx.lineTo(x-1,y);ctx.lineTo(x-5,y+4);ctx.moveTo(x+1,y+4.5);ctx.lineTo(x+5.5,y+4.5);ctx.stroke();ctx.restore()}
function sailGlyph(x,y,c){ctx.save();ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(x+0.5,y-6);ctx.lineTo(x+0.5,y+2);ctx.lineTo(x-5,y+2);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(x-6,y+3.5);ctx.lineTo(x+6,y+3.5);ctx.lineTo(x+4.5,y+6);ctx.lineTo(x-4.5,y+6);ctx.closePath();ctx.fill();ctx.restore()}
function monitorGlyph(x,y,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=1.6;rrect(x-8,y-6.5,16,11,2);ctx.stroke();ctx.beginPath();ctx.moveTo(x-4,y+8);ctx.lineTo(x+4,y+8);ctx.moveTo(x,y+4.5);ctx.lineTo(x,y+8);ctx.stroke();ctx.restore()}
function crossGlyph(x,y,s,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=2.4;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(x-s,y-s);ctx.lineTo(x+s,y+s);ctx.moveTo(x+s,y-s);ctx.lineTo(x-s,y+s);ctx.stroke();ctx.restore()}

/* ---------- tags: icon check|cross|clock|pencil|chat|spark|phone|dot|van|ball|msg|mail|folder|lock ---------- */
const pillW=(s,o)=>tw(s,o.size||13,600)+(o.icon?42:26);
function pill(x,y,s,o={}){const size=o.size||13,w=pillW(s,o),h=size+16,ic=o.ic?col(o.ic):null,oc=o.col?col(o.col):null,c=oc||K.ink;
  ctx.save();shadow(true,12,3);ctx.fillStyle=o.bg||K.card;rrect(x-w/2,y-h/2,w,h,h/2);ctx.fill();shadow(false);ctx.restore();
  const ix=x-w/2+17;
  if(o.icon==="check"){ctx.save();ctx.strokeStyle=ic||oc||K.app;ctx.lineWidth=2.4;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(ix-5,y);ctx.lineTo(ix-1,y+4);ctx.lineTo(ix+6,y-5);ctx.stroke();ctx.restore()}
  if(o.icon==="cross")crossGlyph(ix,y,4.5,ic||K.gate);
  if(o.icon==="clock"){ctx.save();ctx.strokeStyle=ic||oc||K.muted;ctx.lineWidth=1.8;ctx.lineCap="round";ctx.beginPath();ctx.arc(ix,y,6.5,0,7);ctx.stroke();ctx.beginPath();ctx.moveTo(ix,y-3.8);ctx.lineTo(ix,y);ctx.lineTo(ix+3,y+1.6);ctx.stroke();ctx.restore()}
  if(o.icon==="pencil"){ctx.save();ctx.translate(ix,y);ctx.rotate(-0.8);ctx.fillStyle=ic||oc||K.amber;ctx.fillRect(-6,-2.2,11,4.4);ctx.beginPath();ctx.moveTo(5,-2.2);ctx.lineTo(9.5,0);ctx.lineTo(5,2.2);ctx.fill();ctx.restore()}
  if(o.icon==="chat"){ctx.save();ctx.fillStyle=ic||oc||K.muted;rrect(x-w/2+10,y-6,15,11,3);ctx.fill();ctx.beginPath();ctx.moveTo(x-w/2+13,y+4);ctx.lineTo(x-w/2+13,y+9);ctx.lineTo(x-w/2+18,y+4);ctx.fill();ctx.restore()}
  if(o.icon==="spark"){ctx.save();ctx.fillStyle=ic||K.agent;ctx.beginPath();ctx.arc(ix,y,8,0,7);ctx.fill();sparkle(ix,y,4.5);ctx.restore()}
  if(o.icon==="phone")handset(ix,y,0.8,ic||K.app);
  if(o.icon==="dot"){ctx.save();ctx.fillStyle=ic||K.gate;ctx.beginPath();ctx.arc(ix,y,5,0,7);ctx.fill();ctx.restore()}
  if(o.icon==="van")vanGlyph(ix,y,0.95,ic||K.slate);
  if(o.icon==="ball")ballGlyph(ix,y,7);
  if(o.icon==="msg")chatGlyph(ix,y+0.5,ic||K.slate);
  if(o.icon==="mail")mailGlyph(ix,y,ic||K.amber);
  if(o.icon==="folder")folderGlyph(ix,y,ic||oc||K.slate);
  if(o.icon==="lock")lockGlyph(ix,y,ic||oc||K.slate);
  text(x+(o.icon?8:0),y+size*0.35+0.5,s,{size,w:600,col:c})}
function numBadge(x,y,n,s=1){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle=K.gate;ctx.beginPath();ctx.arc(0,0,12,0,7);ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2.5;ctx.stroke();ctx.restore();if(s>0.3)text(x,y+4.5,String(n),{size:13*s,w:700,col:"#fff"})}

/* ---------- a person's own note ---------- */
function sticky(x,y,rot,l1,l2){ctx.save();ctx.translate(x,y);ctx.rotate(rot);shadow(true,12,4);ctx.fillStyle="#fbe39a";ctx.fillRect(-64,-42,128,84);shadow(false);ctx.fillStyle="rgba(201,138,26,.22)";ctx.fillRect(-64,-42,128,11);
  ctx.font='italic 600 16px '+FONT;ctx.fillStyle="#5b4a1a";ctx.textAlign="center";ctx.textBaseline="alphabetic";ctx.fillText(l1,0,4);if(l2)ctx.fillText(l2,0,25);ctx.restore()}

/* ---------- vignettes: the screens people decide on ---------- */
function cardBox(x,y,w,h){ctx.save();shadow(true,26,10,"rgba(24,33,45,.18)");ctx.fillStyle=K.card;rrect(x,y,w,h,14);ctx.fill();shadow(false);ctx.strokeStyle=K.line;ctx.lineWidth=1;ctx.stroke();ctx.restore()}
function btn(x,y,w,label,primary,press){ctx.save();ctx.fillStyle=primary?(press>0?"#37557f":K.slate):"#fff";rrect(x,y,w,27,13.5);ctx.fill();if(!primary){ctx.strokeStyle=K.line;ctx.stroke()}ctx.restore();
  text(x+w/2,y+18,label,{size:13,w:600,col:primary?"#fff":K.muted});
  if(primary&&press>0&&press<1){ctx.save();ctx.globalAlpha*=1-press;ctx.fillStyle="rgba(255,255,255,.6)";ctx.beginPath();ctx.arc(x+w/2,y+13.5,6+press*28,0,7);ctx.fill();ctx.restore()}}
function donePill(rx,cy,label){pill(rx-tw(label,13,600)/2-21,cy,label,{icon:"check",col:"gate",size:13})}
function agentDot(x,y,r){ctx.save();ctx.fillStyle=K.agent;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();sparkle(x,y,r*0.56);ctx.restore()}
function phoneFrame(x,y,w,h){ctx.save();shadow(true,24,8,"rgba(24,33,45,.18)");ctx.fillStyle=K.ink;rrect(x,y,w,h,22);ctx.fill();shadow(false);
  ctx.fillStyle="#fff";rrect(x+6,y+6,w-12,h-12,17);ctx.fill();ctx.fillStyle=K.ink;rrect(x+w/2-20,y+11,40,6,3);ctx.fill();ctx.restore()}
/* team chat on a desktop: a message with up to two lines and two options; the right one is pressed at v.press */
function chatCard(x,y,t,v){const w=v.w||320,h=128;cardBox(x,y,w,h);
  chatGlyph(x+24,y+24);text(x+40,y+28.5,v.title,{size:12.5,w:600,col:K.muted,align:"left"});
  (v.lines||[]).forEach((l,i)=>text(x+16,y+56+i*20,l,{size:15,w:600,align:"left"}));
  const press=win(t,v.press,0.4),done=win(t,v.press+0.4,0.3),by=y+h-38,[o1,o2]=v.options;
  alphaDo(done,()=>donePill(x+w-16,by+13,v.done||"Decided"));
  alphaDo(1-done,()=>{const w2=tw(o2,13,600)+26,w1=tw(o1,13,600)+26,x2=x+w-16-w2;btn(x2,by,w2,o2,true,press);btn(x2-8-w1,by,w1,o1,false,0)})}
/* a phone with rows that fill in one by one: [label, value, colour?] */
function phoneCard(x,y,t,v){const w=170,h=236;phoneFrame(x,y,w,h);agentDot(x+24,y+36,8);
  text(x+38,y+40.5,v.title,{size:12.5,w:700,col:K.ink,align:"left"});
  (v.rows||[]).forEach((r,i)=>{const a=win(t,v.from+0.3+i*0.45,0.35);if(a<=0)return;alphaDo(a,()=>{const yy=y+56+i*44+6*(1-a);
    ctx.save();ctx.fillStyle="#f2f4f8";rrect(x+14,yy,w-28,38,9);ctx.fill();ctx.restore();
    text(x+24,yy+15,r[0],{size:10.5,w:500,col:K.muted,align:"left"});text(x+24,yy+31,r[1],{size:12.5,w:600,col:r[2]?col(r[2]):K.ink,align:"left"})})})}
/* a phone asking one person for one approval */
function approvalPhone(x,y,t,v){const w=150,h=212;phoneFrame(x,y,w,h);agentDot(x+22,y+36,7);
  text(x+34,y+40.5,v.title||"Approval",{size:12.5,w:700,align:"left"});
  ctx.save();ctx.fillStyle="#f2f4f8";rrect(x+12,y+54,w-24,56,9);ctx.fill();ctx.restore();
  text(x+22,y+71,v.label,{size:10.5,w:500,col:K.muted,align:"left"});text(x+22,y+97,v.amount,{size:20,w:700,font:DFONT,align:"left"});
  if(v.note){ctx.save();ctx.fillStyle=K.gate;ctx.beginPath();ctx.arc(x+20,y+126,3.5,0,7);ctx.fill();ctx.restore();text(x+29,y+130,v.note,{size:11.5,w:600,col:K.muted,align:"left"})}
  const press=win(t,v.press,0.4),done=win(t,v.press+0.4,0.3),by=y+h-44,[o1,o2]=v.options||["Later","Approve"];
  alphaDo(done,()=>donePill(x+w-12,by+13,v.done||"Approved"));
  alphaDo(1-done,()=>{const w2=tw(o2,13,600)+20,w1=w-24-8-w2;btn(x+w-12-w2,by,w2,o2,true,press);btn(x+12,by,w1,o1,false,0)})}
/* a voice note being recorded */
function voiceNote(x,y,t,v){
  ctx.save();shadow(true,12,3);ctx.fillStyle="#fff";rrect(x,y,140,38,19);ctx.fill();shadow(false);ctx.restore();
  ctx.save();ctx.fillStyle=K.gate;ctx.beginPath();ctx.arc(x+19,y+19,11,0,7);ctx.fill();ctx.fillStyle="#fff";rrect(x+16,y+11,6,11,3);ctx.fill();ctx.fillRect(x+18.2,y+23,1.6,4);ctx.restore();
  for(let i=0;i<16;i++){const hh=4+11*Math.abs(Math.sin(t*7+i*1.3))*(0.55+0.45*Math.sin(i*0.9+1));ctx.save();ctx.fillStyle=K.slate;rrect(x+38+i*4.2,y+19-hh/2,2.6,hh,1.3);ctx.fill();ctx.restore()}
  text(x+132,y+23.5,v.len||"0:20",{size:11.5,w:600,col:K.muted,align:"right"})}
/* a draft with line items; one line changes at v.change (old value struck through), then it is sent at v.press */
function quoteCard(x,y,t,v){const w=280,h=196,R=x+w-16;cardBox(x,y,w,h);
  chatGlyph(x+24,y+24);text(x+40,y+28.5,v.title,{size:12.5,w:600,col:K.muted,align:"left"});
  const ch=ease(win(t,v.change,0.45));
  (v.lines||[]).slice(0,2).forEach((l,i)=>{const yy=y+60+i*25;text(x+16,yy,l[0],{size:14,w:500,align:"left"});
    if(l.length<3)text(R,yy,l[1],{size:14,w:600,align:"right"});
    else{alphaDo(1-0.5*ch,()=>{const ox=R-56*ch;text(ox,yy,l[1],{size:14,w:600,col:ch>0?K.muted:K.ink,align:"right"});
        if(ch>0){const ww=tw(l[1],14,600);ctx.save();ctx.strokeStyle=K.gate;ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(ox-ww-2,yy-5);ctx.lineTo(ox-ww-2+(ww+4)*ch,yy-5);ctx.stroke();ctx.restore()}});
      alphaDo(ch,()=>text(R,yy,l[2],{size:14,w:700,col:K.app,align:"right"}))}});
  if(v.note)alphaDo(win(t,v.change-0.9,0.4),()=>text(x+16,y+104,v.note,{size:12,w:500,col:K.muted,align:"left"}));
  ctx.save();ctx.fillStyle=K.line;ctx.fillRect(x+16,y+116,w-32,1);ctx.restore();
  text(x+16,y+140,v.totalLabel||"Total",{size:15,w:700,align:"left"});
  alphaDo(1-ch,()=>text(R,y+140,v.total[0],{size:15,w:700,align:"right"}));alphaDo(ch,()=>text(R,y+140,v.total[1],{size:15,w:700,align:"right"}));
  const press=win(t,v.press,0.4),done=win(t,v.press+0.4,0.3),by=y+h-38,bl=v.button||"Send",bw=tw(bl,13,600)+30;
  alphaDo(done,()=>donePill(R,by+13,v.done||"Sent"));
  alphaDo(1-done,()=>btn(R-bw,by,bw,bl,true,press))}
/* a terminal with one line typed out from v.typeAt (default from + 0.3) over v.typeDur; v.hl [from,to] marks a part of it (a secret) in orange */
function terminalCard(x,y,t,v){const w=v.w||520,h=72,line=v.line||"",start=v.typeAt??v.from+0.3;
  ctx.save();shadow(true,24,8,"rgba(24,33,45,.22)");ctx.fillStyle="#1b2330";rrect(x,y,w,h,12);ctx.fill();shadow(false);ctx.restore();
  [K.gate,K.amber,K.app].forEach((c,i)=>{ctx.save();ctx.fillStyle=c;ctx.beginPath();ctx.arc(x+18+i*13,y+16,4,0,7);ctx.fill();ctx.restore()});
  if(v.title)text(x+w/2,y+20,v.title,{size:11.5,w:500,col:"#8f9bad"});
  const n=Math.floor(clamp((t-start)/(v.typeDur||1.6))*line.length),pr=(v.prompt||"$")+" ";
  ctx.save();ctx.font=`500 13px ${MFONT}`;ctx.textAlign="left";ctx.textBaseline="alphabetic";const cw=ctx.measureText("m").width,by=y+50;
  ctx.fillStyle=K.app;ctx.fillText(pr,x+16,by);const x0=x+16+ctx.measureText(pr).width,[a,b]=v.hl||[-1,-1];
  for(let i=0;i<n;i++){const hot=i>=a&&i<b;ctx.fillStyle=hot?"#ff8a5c":"#e6ebf2";ctx.fillText(line[i],x0+i*cw,by)}
  if(a>=0&&n>a){ctx.fillStyle="#ff8a5c";ctx.fillRect(x0+a*cw,by+4,(Math.min(n,b)-a)*cw,1.6)}
  if(n<line.length||Math.floor(t*2)%2===0){ctx.fillStyle="#e6ebf2";ctx.fillRect(x0+n*cw+1,by-11,7,14)}
  ctx.restore()}
/* a crew request: rows of settings, a status that changes at v.change, and an optional button pressed at v.press */
function requestCard(x,y,t,v){const rows=v.rows||[],w=v.w||270,h=64+rows.length*23+42,R=x+w-16;cardBox(x,y,w,h);
  sailGlyph(x+24,y+24,K.slate);text(x+38,y+28.5,v.title,{size:12.5,w:600,col:K.muted,align:"left"});
  rows.forEach((r,i)=>{const yy=y+58+i*23;text(x+16,yy,r[0],{size:12,w:500,col:K.muted,align:"left"});text(R,yy,r[1],{size:13.5,w:600,align:"right"})});
  ctx.save();ctx.fillStyle=K.line;ctx.fillRect(x+16,y+h-46,w-32,1);ctx.restore();
  const st=v.status||["Unassigned"],ch=ease(win(t,v.change??1e9,0.4)),sy=y+h-22;
  alphaDo(1-ch,()=>pill(x+16+pillW(st[0],{icon:"dot",size:12})/2,sy,st[0],{icon:"dot",size:12,ic:v.ic0||"muted",col:"ink"}));
  if(st[1])alphaDo(ch,()=>pill(x+16+pillW(st[1],{icon:"dot",size:12})/2,sy,st[1],{icon:"dot",size:12,ic:v.ic1||"app",col:"ink"}));
  if(v.button){const press=win(t,v.press,0.4),done=win(t,v.press+0.4,0.3),bw=tw(v.button,13,600)+30;
    alphaDo(done,()=>donePill(R,sy,v.done||"Done"));alphaDo(1-done,()=>btn(R-bw,sy-13.5,bw,v.button,true,press))}}
/* a file in git: its path, its version tag, and a few lines of it (YAML keys in slate) */
function fileCard(x,y,t,v){const lines=v.lines||[],w=v.w||400,h=56+lines.length*19+12;cardBox(x,y,w,h);
  ctx.save();ctx.strokeStyle=K.muted;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(x+18,y+16);ctx.lineTo(x+26,y+16);ctx.lineTo(x+30,y+20);ctx.lineTo(x+30,y+31);ctx.lineTo(x+18,y+31);ctx.closePath();ctx.stroke();ctx.restore();
  text(x+40,y+28.5,v.title,{size:12.5,w:600,col:K.muted,align:"left"});
  if(v.tag)pill(x+w-16-pillW(v.tag,{size:12})/2,y+24,v.tag,{size:12,col:"slate"});
  ctx.save();ctx.fillStyle=K.line;ctx.fillRect(x+16,y+44,w-32,1);ctx.font=`500 12.5px ${MFONT}`;ctx.textAlign="left";ctx.textBaseline="alphabetic";
  lines.forEach((l,i)=>{const yy=y+68+i*19,m=l.match(/^(\s*)([^:]+:)(.*)$/);
    if(m){ctx.fillStyle=K.slate;ctx.fillText(m[1]+m[2],x+18,yy);const kw=ctx.measureText(m[1]+m[2]).width;ctx.fillStyle=K.ink;ctx.fillText(m[3],x+18+kw,yy)}
    else{ctx.fillStyle=K.ink;ctx.fillText(l,x+18,yy)}});
  ctx.restore()}
/* a team chat thread: messages [{at, who, text (a string or two lines), col}] appear at their time; v.typing {who, from, to} shows "who is typing" in the next empty slot */
function chatThread(x,y,t,v){const msgs=v.msgs||[],w=v.w||380,rh=m=>(Array.isArray(m.text)?m.text.length:1)*18+28,slot=[];let acc=y+66;
  msgs.forEach(m=>{slot.push(acc);acc+=rh(m)});cardBox(x,y,w,acc-y+4);
  chatGlyph(x+24,y+24);text(x+40,y+28.5,v.title,{size:12.5,w:600,col:K.muted,align:"left"});
  ctx.save();ctx.fillStyle=K.line;ctx.fillRect(x+16,y+44,w-32,1);ctx.restore();
  msgs.forEach((m,i)=>{const a=win(t,m.at,0.3);if(a<=0)return;alphaDo(a,()=>{const yy=slot[i]+5*(1-a);
    text(x+16,yy,m.who,{size:12,w:700,col:m.col?col(m.col):K.ink,align:"left"});
    (Array.isArray(m.text)?m.text:[m.text]).forEach((l,j)=>text(x+16,yy+19+j*18,l,{size:13.5,w:500,align:"left"}))})});
  const ty=v.typing;if(!ty)return;const a=band(t,ty.from,ty.to,0.2);if(a<=0)return;let i=msgs.findIndex(m=>m.at>=ty.to-0.05);if(i<0)i=msgs.length-1;
  alphaDo(a,()=>{const yy=slot[i],s=ty.who+" is typing";text(x+16,yy,s,{size:12,w:600,col:K.muted,align:"left"});
    const dx=x+16+tw(s,12,600)+9;for(let d=0;d<3;d++){const p=0.5+0.5*Math.sin(t*9-d*0.9);ctx.save();ctx.globalAlpha*=0.35+0.65*p;ctx.fillStyle=K.muted;ctx.beginPath();ctx.arc(dx+d*8,yy-4,2.4,0,7);ctx.fill();ctx.restore()}})}
/* a card on the backlog: rows [label, value] or [label, old, new, colour] where new replaces old at v.change (an empty old just appears), and a status [before, after] that changes at v.statusAt (default v.change) */
function ticketGlyph(x,y,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=1.6;rrect(x-7.5,y-6.5,15,13,2.5);ctx.stroke();ctx.fillStyle=c;ctx.fillRect(x-4,y-2.6,8,1.8);ctx.fillRect(x-4,y+1.2,5,1.8);ctx.restore()}
function ticketCard(x,y,t,v){const rows=v.rows||[],w=v.w||330,h=64+rows.length*23+42,R=x+w-16;cardBox(x,y,w,h);
  ticketGlyph(x+24,y+24,K.slate);text(x+40,y+28.5,v.title,{size:12.5,w:600,col:K.muted,align:"left"});
  const ch=ease(win(t,v.change??1e9,0.45));
  rows.forEach((r,i)=>{const yy=y+58+i*23;text(x+16,yy,r[0],{size:12,w:500,col:K.muted,align:"left"});
    if(r.length<3){text(R,yy,r[1],{size:13.5,w:600,align:"right"});return}
    if(r[1])alphaDo(1-0.45*ch,()=>{const ox=R-(tw(r[2],13.5,700)+14)*ch;text(ox,yy,r[1],{size:13.5,w:600,col:ch>0?K.muted:K.ink,align:"right"});
      if(ch>0){const ww=tw(r[1],13.5,600);ctx.save();ctx.strokeStyle=K.gate;ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(ox-ww-2,yy-5);ctx.lineTo(ox-ww-2+(ww+4)*ch,yy-5);ctx.stroke();ctx.restore()}});
    alphaDo(ch,()=>text(R,yy,r[2],{size:13.5,w:700,col:col(r[3]||"ink"),align:"right"}))});
  ctx.save();ctx.fillStyle=K.line;ctx.fillRect(x+16,y+h-46,w-32,1);ctx.restore();
  const st=v.status||["To do"],sy=y+h-22,sc=ease(win(t,v.statusAt??v.change??1e9,0.4));
  alphaDo(1-sc,()=>pill(x+16+pillW(st[0],{icon:"dot",size:12})/2,sy,st[0],{icon:"dot",size:12,ic:v.ic0||"muted",col:"ink"}));
  if(st[1])alphaDo(sc,()=>pill(x+16+pillW(st[1],{icon:"dot",size:12})/2,sy,st[1],{icon:"dot",size:12,ic:v.ic1||"app",col:"ink"}))}
const VIGNETTES={chatCard,phoneCard,approvalPhone,voiceNote,quoteCard,terminalCard,requestCard,fileCard,chatThread,ticketCard};

/* ---------- the Aeolus mark and the corner chip ---------- */
function boat(x,y,s){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.translate(-32,-28);
  ctx.fillStyle=K.slate;ctx.beginPath();ctx.moveTo(32,4);ctx.lineTo(32,40);ctx.lineTo(12,40);ctx.closePath();ctx.fill();
  ctx.globalAlpha*=.55;ctx.beginPath();ctx.moveTo(35,10);ctx.lineTo(35,40);ctx.lineTo(52,40);ctx.closePath();ctx.fill();ctx.globalAlpha/=.55;
  ctx.fillStyle=K.ink;ctx.beginPath();ctx.moveTo(6,44);ctx.lineTo(58,44);ctx.lineTo(52,52);ctx.lineTo(12,52);ctx.closePath();ctx.fill();ctx.restore()}
function aeolusMark(x,y,s){const tw0=tw("Aeolus",46,700,DFONT),w=26+52+14+tw0+28,h=92;
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);
  shadow(true,30,10,"rgba(24,33,45,.16)");ctx.fillStyle="#fff";rrect(-w/2,-h/2,w,h,22);ctx.fill();shadow(false);ctx.strokeStyle="rgba(74,106,158,.35)";ctx.lineWidth=1.2;ctx.stroke();
  boat(-w/2+26+26,0,0.82);text(-w/2+26+52+14,16,"Aeolus",{size:46,w:700,font:DFONT,col:K.ink,align:"left"});ctx.restore()}
const CHIP={r:1231,y:190};
function chipGeom(label){const tx=tw(label,13,600),w=12+20+7+tx+14;return{w,x0:CHIP.r-w,cx:CHIP.r-w/2}}
function aeolusChip(label){const {w,x0}=chipGeom(label),h=28;
  ctx.save();shadow(true,10,3);ctx.fillStyle="#fff";rrect(x0,CHIP.y-h/2,w,h,h/2);ctx.fill();shadow(false);ctx.strokeStyle="rgba(74,106,158,.45)";ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
  boat(x0+12+10,CHIP.y,0.32);text(x0+12+20+7,CHIP.y+4.6,label,{size:13,w:600,col:K.slate,align:"left"})}
function plainChip(label){const w=tw(label,13,600)+28,h=28,x0=CHIP.r-w;
  ctx.save();ctx.fillStyle="#fff";rrect(x0,CHIP.y-h/2,w,h,h/2);ctx.fill();ctx.strokeStyle=K.line;ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
  text(x0+14,CHIP.y+4.6,label,{size:13,w:600,col:K.muted,align:"left"})}
