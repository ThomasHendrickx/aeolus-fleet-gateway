"""List every network edge and run-A hop whose curve crosses a person, plate, app tile, agent or label that is on stage at that time (computers are not obstacles).
Usage: check_paths.py <workdir>. Fix a hit by changing that edge's or hop's bend; 'own:' hits (an edge passing its own endpoint's label) are usually fine."""
import asyncio, os, sys
from playwright.async_api import async_playwright

JS = r"""(() => {
 const obs=t=>{const o=[];
  for(const [k,p] of Object.entries(P)){if(showAmt(k,t)<=0)continue;o.push({k,c:1,x:p.x,y:p.y,r:p.r+3});
    if(p.small){const w=tw(p.label,12,600)+16;o.push({k:k+".label",x:p.x-w/2,y:p.y-p.r-26,w,h:22})}
    else{const w=Math.max(tw(p.name,16,700),tw(p.role,12.5,500))+18;o.push({k:k+".plate",x:p.x-w/2,y:p.y+p.r+6,w,h:42})}}
  for(const [k,a] of Object.entries(A)){if(showAmt(k,t)<=0)continue;const w=a.w||AW,h=a.h||AH;o.push({k,x:a.x-w/2-2,y:a.y-h/2-2,w:w+4,h:h+4})}
  for(const [k,g] of Object.entries(G)){if(SHOW[k]?showAmt(k,t)<=0:t<g.from)continue;o.push({k,c:1,x:g.x,y:g.y,r:g.r+3});const L=agentLabelRect(g);o.push({k:k+".label",x:L.x,y:L.y,w:L.w,h:L.h})}
  return o};
 const hit=(o,q)=>o.c?Math.hypot(q.x-o.x,q.y-o.y)<o.r:(q.x>o.x&&q.x<o.x+o.w&&q.y>o.y&&q.y<o.y+o.h);
 const res=[];
 const test=(a,b,bend,t,name)=>{const l=link(a,b,bend),hits={};for(let i=1;i<80;i++){const q=qpt(l.a,l.c,l.b,i/80);
   for(const o of obs(t)){const base=o.k.split(".")[0],own=base===a||base===b;if(own&&!o.k.includes("."))continue;if(hit(o,q)){const n=(own?"own:":"")+o.k;hits[n]=(hits[n]||0)+1}}}
   if(Object.keys(hits).length)res.push(name+"  "+JSON.stringify(hits))};
 EDGES.forEach(e=>test(e[0],e[1],bendOf(e[0],e[1]),e.lit+0.5,"edge "+e[0]+">"+e[1]+" bend "+bendOf(e[0],e[1])));
 HOPS.forEach(h=>{if(h[2]<A1)test(h[0],h[1],hopBend(h),h[2],"hop "+h[0]+">"+h[1]+" @"+h[2]+" bend "+hopBend(h))});
 (SCENARIO.lines||[]).forEach(L=>test(L.a,L.b,L.bend||0,L.from,"line "+L.a+">"+L.b));
 return res})()"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1280, "height": 900})
        await pg.goto("file://" + os.path.abspath(os.path.join(sys.argv[1], "page.html")), wait_until="domcontentloaded")
        await pg.evaluate("Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,20000))])")
        res = await pg.evaluate(JS)
        print("\n".join(res) if res else "no collisions")
        await b.close()

asyncio.run(main())
