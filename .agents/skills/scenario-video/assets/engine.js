/* scenario-video engine: plays SCENARIO (see references/scenario.md). Run A, the switch, run B, the proof card, an optional closing card, the end card. */
const SC=SCENARIO,TL=SC.timeline,DUR=TL.dur;
const A0=TL.a0,A1=TL.a1,JOIN0=TL.join,B0=TL.b0,PROOF0=TL.proof,END0=TL.end;
const MARK_ON=TL.mark!==false,MARK0=typeof TL.mark==="number"?TL.mark:A1+0.8,FLY0=TL.fly??JOIN0+0.8,CHIPB=TL.chipB??FLY0+0.75;
const NET0=TL.netFrom??JOIN0,WAVE=TL.wave!==false;
const P=SC.people,A=SC.apps,G=SC.agents,JC=TL.center,F=SC.frames||{};
const FR=Object.fromEntries(Object.entries(F).map(([k,f])=>[k,{x:f.x+f.w/2,y:f.y+f.h/2,w:f.w,h:f.h}]));
Object.values(P).forEach(p=>{if(!p.r)p.r=AV});
const SHOW=SC.show||{};
const showAmt=(k,t)=>{const w=SHOW[k];if(!w)return 1;let m=0;w.forEach(([a,b])=>{m=Math.max(m,Math.min(win(t,a,0.45),1-win(t,b,0.4)))});return m};
const pt=k=>P[k]||A[k]||G[k]||FR[k];
const aw=k=>(A[k]||FR[k]).w||AW,ah=k=>(A[k]||FR[k]).h||AH;
const isOut=k=>!!((P[k]&&P[k].outside)||(A[k]&&A[k].outside));
function edge(k,toward){const n=pt(k);const dx=toward.x-n.x,dy=toward.y-n.y,d=Math.hypot(dx,dy)||1;
  if(A[k]||FR[k]){const hx=aw(k)/2+3,hy=ah(k)/2+3,s=Math.min(hx/Math.abs(dx||1e-6),hy/Math.abs(dy||1e-6));return{x:n.x+dx*s,y:n.y+dy*s}}
  const r=P[k]?n.r+5:n.r+3;return{x:n.x+dx/d*r,y:n.y+dy/d*r}}
const joinT=k=>{const n=pt(k);return JOIN0+Math.hypot(n.x-JC.x,n.y-JC.y)/700};
/* the same decisions, by the same people, in both runs */
const DEC=SC.decisions||{who:[],a:[],b:[],tags:[]},NDEC=DEC.who.length;
/* hops: [from,to,start,end,kind,bend,handoff]; a hand-off is a step a person carried */
const HOPS=SC.hops;
const HO_T=[...(SC.notes||[]).filter(n=>n.handoff).map(n=>n.handoff),...HOPS.filter(h=>h[6]).map(h=>h[3])].sort((a,b)=>a-b);
/* the network: one arc per connection ("a>b": bend, or {bend, from, to} for one that exists only then); work on the network travels along it */
const EB=SC.edges,ebend=k=>{const v=EB[k];return v==null?null:typeof v==="object"?v.bend:v};
const bendOf=(a,b)=>ebend(a+">"+b)??(ebend(b+">"+a)!=null?-ebend(b+">"+a):null);
const vis=(k,t)=>G[k]?(SHOW[k]?showAmt(k,t):win(t,G[k].from,0.55)):showAmt(k,t);
const hopBend=h=>(h[2]>=NET0?bendOf(h[0],h[1]):null)??h[5]??0;
const EDGES=Object.keys(EB).map(k=>{const [a,b]=k.split(">"),v=EB[k],e=[a,b];e.out=isOut(a)||isOut(b);e.from=(typeof v==="object"&&v.from)||-1;e.to=(typeof v==="object"&&v.to)||1e9;e.label=typeof v==="object"?v.label:null;
  e.uses=HOPS.filter(h=>h[2]>=Math.max(NET0,e.from)&&h[2]<=e.to&&((h[0]===a&&h[1]===b)||(h[0]===b&&h[1]===a))).map(h=>[h[2],h[3]]);e.lit=e.uses.length?e.uses[0][0]-0.2:99;return e});
const heat=(e,t)=>{let m=0;e.uses.forEach(([a,b])=>{m=Math.max(m,band(t,a-0.25,b+1.3,0.3))});return m};
/* story clocks */
const CLK_A=SC.clockA,KEYS=SC.clockB.keys;
const dayB=t=>{let d=SC.clockB.day;KEYS.forEach(k=>{if(k[2]&&t>=k[0])d=k[2]});return d};
function storyMin(t){for(let i=0;i<KEYS.length-1;i++){const[a,va]=KEYS[i],[b,vb]=KEYS[i+1];if(t<=b)return Math.round(lerp(va,vb,clamp((t-a)/(b-a))))}return KEYS[KEYS.length-1][1]}
const hm=m=>String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
/* where a tag sits: right/left/above/below of a person or agent, on an app, above an agent, or at x,y */
function anchor(g){const n=g.of?pt(g.of):null,dx=g.dx||0,dy=g.dy||0,r=n?(P[g.of]?n.r:G[g.of]?n.r:ah(g.of)/2):0,w=pillW(g.text,g);
  switch(g.at){
    case "right":return{x:n.x+r+14+w/2+dx,y:n.y+dy};
    case "left":return{x:n.x-r-14-w/2+dx,y:n.y+dy};
    case "above":return{x:n.x+dx,y:n.y-r-28+dy};
    case "below":return{x:n.x+dx,y:n.y+r+(g.dy??22)};
    case "app":return{x:n.x+dx,y:n.y-ah(g.of)/2-24+dy};
    case "agent":return{x:n.x+dx,y:n.y-46+dy};
    default:return{x:g.x,y:g.y}}}
const TAGS=[...SC.tags,...[DEC.a,DEC.b].flatMap(D=>D.map((d,j)=>({from:d,to:d+1.8,x:DEC.tags[j].x,y:DEC.tags[j].y,text:`Decision ${j+1} of ${NDEC}`,icon:"dot",col:"gate"})))];

/* ---------- the world at time t ---------- */
function drawWorld(t){
  const net=t>=NET0;
  /* computers, under everything else */
  Object.entries(F).forEach(([k,f])=>{const a=showAmt(k,t);if(a>0)alphaDo(a,()=>frameBox(f))});
  /* run A: amber traces of every step a person carried, until the run ends */
  const tangle=1-win(t,A1,0.8);
  if(tangle>0)HOPS.forEach(h=>{if(h[2]<A1&&h[6]&&t>h[3])alphaDo(0.34*tangle*win(t,h[3],0.4),()=>stroke(link(h[0],h[1],hopBend(h)),{col:K.amber,w:1.5,dash:[3,6]}))});
  /* people on the phone with each other */
  (SC.lines||[]).forEach(L=>{const v=band(t,L.from,L.to,0.4);if(v>0)alphaDo(v,()=>{const l=link(L.a,L.b,L.bend||0);stroke(l,{col:K.amber,w:1.8,dash:[5,5]});const m=qpt(l.a,l.c,l.b,0.5);callIcon(m.x,m.y,0.12*Math.sin(t*12),K.amber)})});
  /* run B: the network fills as work moves; a connection appears the first time work crosses it and glows while it carries work */
  if(net)EDGES.forEach(e=>{const g=easeOut(win(t,e.lit,0.45));if(g<=0)return;const ea=Math.min(vis(e[0],t),vis(e[1],t))*(1-win(t,e.to,0.4));if(ea<=0)return;
    ctx.save();ctx.globalAlpha*=ea;const l=link(e[0],e[1],bendOf(e[0],e[1])),h=heat(e,t);
    if(e.out){stroke(l,{col:"rgba(93,104,120,.5)",w:1.8,dash:[4,5],frac:g});if(h>0)alphaDo(h,()=>stroke(l,{col:K.slate,w:2.4,dash:[4,5],frac:g}))}
    else{stroke(l,{col:"rgba(74,106,158,.42)",w:2,frac:g});if(h>0)alphaDo(h,()=>stroke(l,{col:K.slate,w:3,frac:g,glow:true}))}
    if(e.label&&g>0.6)alphaDo((g-0.6)/0.4,()=>{const mx=.25*l.a.x+.5*l.c.x+.25*l.b.x,my=.25*l.a.y+.5*l.c.y+.25*l.b.y,w=tw(e.label,10.5,700)+14;
      ctx.save();ctx.fillStyle=K.card;rrect(mx-w/2,my-9,w,18,9);ctx.fill();ctx.strokeStyle=K.line;ctx.lineWidth=1;ctx.stroke();ctx.restore();text(mx,my+3.8,e.label,{size:10.5,w:700,col:K.slate})});ctx.restore()});
  Object.entries(G).forEach(([k,g])=>{if(!g.own)return;const amt=easeOut(win(t,g.from,0.5)),on=SHOW[k]?showAmt(k,t):1;if(amt>0&&on>0)alphaDo(on,()=>stroke(link(g.own,k,0),{col:"rgba(91,82,214,.6)",w:2,frac:amt}))});
  /* the wave */
  if(WAVE&&t>JOIN0&&t<JOIN0+2.1)for(let r=0;r<2;r++){const tt=t-JOIN0-r*0.28,p=tt/1.7;if(tt<=0||p>=1)continue;ctx.save();ctx.globalAlpha*=(r?0.2:0.42)*(1-p);ctx.strokeStyle=K.slate;ctx.lineWidth=r?2:3.2;ctx.beginPath();ctx.arc(JC.x,JC.y,tt*700,0,7);ctx.stroke();ctx.restore()}
  /* apps */
  Object.entries(A).forEach(([k,a])=>{const amt=showAmt(k,t);if(amt<=0)return;const q=pop(amt);
    alphaDo(q.a,()=>scaled(a.x,a.y,q.s,()=>appTile(a,a.outside?0:WAVE?win(t,joinT(k),0.5):1)))});
  /* people */
  Object.entries(P).forEach(([k,p])=>{const amt=showAmt(k,t);if(amt<=0)return;const q=pop(amt);
    let ring=0;DEC.who.forEach((w,j)=>{if(w===k)ring=Math.max(ring,band(t,DEC.a[j]-0.15,DEC.a[j]+1.9,0.3),band(t,DEC.b[j]-0.15,DEC.b[j]+1.9,0.3))});
    alphaDo(q.a,()=>{scaled(p.x,p.y,q.s,()=>avatar(p.x,p.y,p.r,p.spec,{ring,pulse:ring?2*Math.sin(t*5):0}));
      if(p.small){const w=tw(p.label,12,600)+16;plate(p.x,p.y-p.r-26,w,22);text(p.x,p.y-p.r-11,p.label,{size:12,w:600,col:K.muted})}
      else{const w=Math.max(tw(p.name,16,700),tw(p.role,12.5,500))+18;plate(p.x,p.y+p.r+6,w,42);text(p.x,p.y+p.r+24,p.name,{size:16,w:700});text(p.x,p.y+p.r+41,p.role,{size:12.5,w:500,col:K.muted})}
      if(!p.outside){const pj=WAVE?win(t,joinT(k),0.5):1;if(pj>0)port(p.x-p.r*0.72,p.y+p.r*0.72,back(pj))}})});
  /* join pulses as the wave passes */
  if(WAVE&&t>JOIN0&&t<JOIN0+2.4)[...Object.keys(P).filter(k=>!P[k].outside),...Object.keys(A).filter(k=>!A[k].outside)].forEach(k=>{const p=win(t,joinT(k),0.7);if(p<=0||p>=1||showAmt(k,t)<=0)return;const n=pt(k);
    ctx.save();ctx.globalAlpha*=0.55*(1-p);ctx.strokeStyle=K.slate;ctx.lineWidth=2;
    if(A[k])rrect(n.x-aw(k)/2-4-14*p,n.y-ah(k)/2-4-14*p,aw(k)+8+28*p,ah(k)+8+28*p,12+8*p);else{ctx.beginPath();ctx.arc(n.x,n.y,n.r+4+22*p,0,7)}ctx.stroke();ctx.restore()});
  /* agents */
  Object.entries(G).forEach(([k,g],i)=>{const amt=SHOW[k]?showAmt(k,t):win(t,g.from,0.55);if(amt<=0)return;const s=back(amt);
    if(g.kind==="private"){alphaDo(Math.min(1,amt*2),()=>{scaled(g.x,g.y,s,()=>agentBadge(g,g.r,K.agent,0.4));agentLabel(g)});return}
    ctx.save();ctx.globalAlpha*=Math.min(1,amt*2);ctx.translate(g.x,g.y);ctx.scale(s,s);ctx.translate(-g.x,-g.y);
    ctx.save();ctx.globalAlpha*=0.18;ctx.fillStyle=K.agent;ctx.beginPath();ctx.arc(g.x,g.y,g.r+10+3*Math.sin(t*2+i),0,7);ctx.fill();ctx.restore();
    agentBadge(g,g.r,K.agent,0.7);ctx.restore();alphaDo(Math.min(1,amt*2),()=>agentLabel(g))});
  /* notes people write to remember */
  (SC.notes||[]).forEach(n=>{const v=band(t,n.from,n.to,0.3);if(v>0)alphaDo(v,()=>sticky(n.x,n.y+6*(1-v),n.rot||-0.1,n.l1,n.l2))});
  /* moving work */
  HOPS.forEach(h=>{const tail=h[4]==="busy"?0.9:0.15;if(t<h[2]||t>h[3]+tail)return;const l=link(h[0],h[1],hopBend(h));
    if(h[4]==="busy"){/* the call does not get through */
      const f=easeOut(clamp((t-h[2])/(h[3]-h[2])))*0.55,p=qpt(l.a,l.c,l.b,f),o=1-win(t,h[3]+0.5,0.4),wob=t>h[3]?0.35*Math.sin((t-h[3])*30)*(1-win(t,h[3],0.5)):0.15*Math.sin(t*16);
      alphaDo(o,()=>{alphaDo(0.45,()=>stroke(l,{col:K.app,w:1.6,dash:[3,5],frac:f}));callIcon(p.x,p.y,wob);
        if(t>h[3]){ctx.save();ctx.globalAlpha*=win(t,h[3],0.15);ctx.strokeStyle=K.gate;ctx.lineWidth=2.4;ctx.beginPath();ctx.arc(p.x,p.y,18,0,7);ctx.stroke();ctx.restore()}});return}
    const f=easeOut(clamp((t-h[2])/(h[3]-h[2]))),p=qpt(l.a,l.c,l.b,f),o=1-win(t,h[3],0.15);
    const early=h[2]<A1,trail=c=>alphaDo(0.45,()=>stroke(l,{col:c,w:1.6,dash:[3,5],frac:f}));
    if(h[4]==="mail")alphaDo(o,()=>{trail(early?K.amber:K.slate);mailIcon(p.x,p.y-5*Math.sin(f*Math.PI),early?K.amber:K.slate)});
    else if(h[4]==="doc")alphaDo(o,()=>{trail(K.amber);docIcon(p.x,p.y)});
    else if(h[4]==="chat")alphaDo(o,()=>{trail(K.amber);chatIcon(p.x,p.y)});
    else if(h[4]==="phone")alphaDo(o,()=>{trail(K.amber);callIcon(p.x,p.y,0.15*Math.sin(t*16),K.amber)});
    else if(h[4]==="msg")alphaDo(o,()=>chatIcon(p.x,p.y,K.slate));
    else if(h[4]==="call")alphaDo(o,()=>callIcon(p.x,p.y,0.15*Math.sin(t*16)));
    else alphaDo(o,()=>{const c=K.agent;
      for(let k=8;k>=1;k--){const q=qpt(l.a,l.c,l.b,Math.max(0,f-k*0.022));ctx.save();ctx.globalAlpha*=(1-k/9)*0.8;ctx.fillStyle=c;ctx.beginPath();ctx.arc(q.x,q.y,6*(1-k/11),0,7);ctx.fill();ctx.restore()}
      ctx.save();ctx.shadowColor=c;ctx.shadowBlur=16;ctx.fillStyle=c;ctx.beginPath();ctx.arc(p.x,p.y,7.5,0,7);ctx.fill();ctx.restore();sparkle(p.x,p.y,4.4)})});
  /* tags */
  TAGS.forEach(g=>{const v=band(t,g.from,g.to,0.3);if(v<=0)return;const q=anchor(g);alphaDo(v,()=>pill(q.x,q.y-6*(1-v),g.text,g))});
  /* vignettes: the screens people decide on */
  (SC.vignettes||[]).forEach(v=>{const a=band(t,v.from,v.to,0.3);if(a>0)alphaDo(a,()=>VIGNETTES[v.type](v.x,v.y+(v.slide??8)*(1-a),t,v))});
}

/* ---------- frame: the world, then the proof and the end card over it ---------- */
function draw(t){
  const sx=cv.width/W,sy=cv.height/H;
  ctx.setTransform(sx,0,0,sy,0,0);ctx.fillStyle=K.paper;ctx.fillRect(0,0,W,H);
  const worldA=1-0.68*win(t,PROOF0,0.6)-0.24*win(t,END0,0.8);
  ctx.save();ctx.globalAlpha=worldA;ctx.fillStyle="rgba(74,106,158,.08)";for(let gx=0;gx<=W;gx+=40)for(let gy=0;gy<=H;gy+=40){ctx.beginPath();ctx.arc(gx,gy,1.2,0,7);ctx.fill()}
  drawWorld(Math.min(t,PROOF0-0.6));ctx.restore();
  alphaDo(win(t,A0+0.2,0.4)*(1-win(t,A1-0.2,0.4)),()=>plainChip(SC.labels.chipA));
  alphaDo(win(t,CHIPB,0.3)*(1-win(t,PROOF0-0.2,0.5)),()=>aeolusChip(SC.labels.chipB));
  /* Aeolus is named the moment the network appears, then it moves to the corner */
  if(MARK_ON&&t>MARK0&&t<CHIPB+0.45){const tc={x:chipGeom(SC.labels.chipB).cx,y:CHIP.y};const fl=ease(win(t,FLY0,0.75)),s=back(win(t,MARK0,0.6))*lerp(1,0.4,fl);
    alphaDo(Math.min(1,win(t,MARK0,0.3)*2)*(1-win(t,CHIPB,0.3)),()=>aeolusMark(lerp(JC.x,tc.x,fl),lerp(JC.y,tc.y,fl),s))}
}

/* ---------- captions, clocks, counters, proof, end card, playback ---------- */
const $=id=>document.getElementById(id);
const capEl=$("cap"),capH=$("capH"),capS=$("capS"),endEl=$("end"),clockEl=$("clock"),clockK=$("clockK"),clockV=$("clockV"),cH=$("cH"),cS=$("cS"),cntEl=$("cnt"),proofEl=$("proof");
const S=SC.captions;
const fill=(id,s)=>{const el=$(id);if(el)el.textContent=s};
/* counters: two rows, each counting its times in run A (a) and run B (b); by default hand-offs and decisions */
const CNT=SC.counters||[{label:SC.labels.handoffs,a:HO_T,b:[]},{label:SC.labels.decisions,a:DEC.a,b:DEC.b,of:NDEC}];
fill("lblH",CNT[0].label);fill("lblD",CNT[1].label);fill("of",CNT[1].of!=null?"of "+CNT[1].of:"");
/* proof rows: by default decisions (N and N) and hand-offs (counted, then 0); ca and cb pick the colours g, h, a or "" */
const PR=SC.proof.rows||[{label:SC.labels.decisions,a:NDEC,b:NDEC},{label:SC.labels.handoffs,a:HO_T.length,b:0}];
fill("pT",SC.proof.title);fill("pA",SC.proof.colA);fill("pB",SC.proof.colB);fill("pD",PR[0].label);fill("pH",PR[1].label);
fill("pDA",PR[0].a);fill("pDB",PR[0].b);fill("pHA",PR[1].a);fill("pHB",PR[1].b);
[["pDA",PR[0].ca,1],["pDB",PR[0].cb,1],["pHA",PR[1].ca,2],["pHB",PR[1].cb,2]].forEach(([id,c,r])=>{if(c!=null)$(id).className=`pv ${c} pr${r}`});
$("pF").innerHTML="";SC.proof.footer.forEach((l,i)=>{if(i)$("pF").append(document.createElement("br"));$("pF").append(l)});
/* closing card: what to use it for and what not, from closing.from until the end card */
const CL=SC.closing,closingEl=$("closing"),closingRows=[0,1,2,3].map(i=>document.querySelectorAll(".cr"+i));
if(CL){fill("cT",CL.title);fill("cUT",CL.use.title);fill("cST",CL.skip.title);fill("cN",CL.note||"");
  [["cU",CL.use.items],["cS2",CL.skip.items]].forEach(([id,items])=>items.forEach(s=>{const li=document.createElement("li");li.textContent=s;$(id).append(li)}))}
fill("eW",SC.end.word);fill("eT",SC.end.tagline);fill("eU",SC.end.url);fill("eL",SC.end.label);
const proofRows=[0,1,2,3].map(i=>document.querySelectorAll(".pr"+i));
const chapEl=$("chapters");
let T=0,playing=true,last=null,dirty=true;
const GROUPS=[...new Set(S.map(s=>s.g))];
const chapBtns=GROUPS.map(g=>{const s0=S.find(s=>s.g===g);const b=document.createElement("button");b.type="button";b.textContent=g;b.onclick=()=>{T=s0.a+0.01;last=null;dirty=true;syncAudio(true)};chapEl.append(b);return b});
let lastScene=-1;
const lastLE=(arr,t)=>{let r=-9;arr.forEach(x=>{if(x<=t)r=x});return r};
function bump(el,t,at){const d=t-at;el.style.transform=d>=0&&d<0.45?`scale(${1+0.45*(1-d/0.45)})`:"none"}
function captions(t){
  const i=S.findIndex(s=>t>=s.a&&t<s.b),idx=i<0?S.length-1:i,s=S[idx];
  if(idx!==lastScene){capH.textContent=s.h||"";capS.textContent=s.s||"";capS.style.display=s.s?"":"none";chapBtns.forEach((b,j)=>b.classList.toggle("on",GROUPS[j]===s.g));lastScene=idx}
  capEl.style.opacity=s.h?Math.min(s.a===0?1:win(t,s.a+0.15,0.6),1-win(t,s.b-0.45,0.4)):0;
  const runA=t<A1+0.5;
  if(runA){let c=CLK_A[0];CLK_A.forEach(k=>{if(t>=k[0])c=k});clockK.textContent=c[1];clockV.textContent=c[2]}
  else{clockK.textContent=dayB(t);clockV.textContent=hm(storyMin(t))}
  clockEl.style.opacity=Math.max(1-win(t,A1-0.3,0.4),Math.min(win(t,B0-0.2,0.4),1-win(t,PROOF0-0.2,0.4)));
  cntEl.style.opacity=Math.max(Math.min(win(t,A0,0.4),1-win(t,A1-0.3,0.4)),Math.min(win(t,B0-0.2,0.4),1-win(t,PROOF0-0.2,0.4)));
  const c0=runA?CNT[0].a:CNT[0].b,c1=runA?CNT[1].a:CNT[1].b;
  cH.textContent=c0.filter(x=>x<=t).length;cS.textContent=c1.filter(x=>x<=t).length;bump(cH,t,lastLE(c0,t));bump(cS,t,lastLE(c1,t));
  proofEl.style.opacity=win(t,PROOF0+0.2,0.6)*(1-win(t,(CL?CL.from:END0)-0.4,0.45));
  if(CL){closingEl.style.opacity=win(t,CL.from+0.2,0.6)*(1-win(t,END0-0.4,0.45));CL.times.forEach((a,j)=>closingRows[j].forEach(el=>el.style.opacity=win(t,a,0.5)))}
  SC.proof.times.forEach((a,j)=>proofRows[j].forEach(el=>el.style.opacity=win(t,a,0.5)));
  endEl.style.opacity=win(t,END0+0.2,1.0);
}
function fmt(t){const s=Math.floor(t);return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
const scrub=$("scrub"),timeEl=$("time"),playB=$("play"),aud=$("aud"),sndB=$("snd");
scrub.max=DUR;
let soundOn=false;
function syncAudio(force){if(!aud)return;if(!soundOn||!playing||T>=DUR){if(!aud.paused)aud.pause();return}
  if(force||Math.abs(aud.currentTime-T)>0.3){try{aud.currentTime=T}catch(e){}}
  if(aud.paused){const p=aud.play();if(p&&p.catch)p.catch(()=>{})}}
sndB.onclick=()=>{soundOn=!soundOn;sndB.textContent=soundOn?"Sound off":"Sound on";sndB.setAttribute("aria-pressed",String(soundOn));if(soundOn&&!playing){if(T>=DUR)T=0;playing=true;playB.textContent="Pause";last=null}dirty=true;syncAudio(true)};
function size(){const r=cv.getBoundingClientRect(),d=Math.min(2,window.devicePixelRatio||1);cv.width=Math.max(1,Math.round(r.width*d));cv.height=Math.max(1,Math.round(r.height*d))}
function render(){draw(T);captions(T);scrub.value=T;timeEl.textContent=fmt(T)+" / "+fmt(DUR)}
function loop(now){if(playing){if(soundOn&&aud&&!aud.paused&&aud.readyState>=2)T=aud.currentTime;else if(last!=null)T+=(now-last)/1000;if(T>=DUR){T=DUR;playing=false;playB.textContent="Play"}dirty=true}last=now;if(dirty){render();dirty=false}syncAudio(false);requestAnimationFrame(loop)}
playB.onclick=()=>{if(T>=DUR)T=0;playing=!playing;playB.textContent=playing?"Pause":"Play";last=null;dirty=true;syncAudio(true)};
$("again").onclick=()=>{T=0;playing=true;playB.textContent="Pause";last=null;dirty=true;syncAudio(true)};
scrub.oninput=()=>{T=+scrub.value;last=null;dirty=true;syncAudio(true)};
window.addEventListener("resize",()=>{size();render()});
window.__seek=t=>{T=t;playing=false;render()};
if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){playing=false;T=SC.proof.times[3]+1;playB.textContent="Play"}
size();render();requestAnimationFrame(loop);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{dirty=true});
