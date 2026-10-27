(function(){
const TZ="America/New_York";
const AX0=7*60, AX1=24*60; // timeline 7 AM to midnight
// ---------- helpers ----------
const toMin=s=>{const[h,m]=s.split(":").map(Number);return h*60+m};
const segs=s=>!s?[]:s.split(",").map(p=>p.split("-").map(toMin));
function fmt(m,short){m=m%1440;let h=Math.floor(m/60),mm=m%60,ap=h>=12?"PM":"AM";h=h%12||12;
  if(short)return h+(mm?":"+String(mm).padStart(2,"0"):"")+(ap==="AM"?"a":"p");
  return h+(mm?":"+String(mm).padStart(2,"0"):"")+" "+ap}
const range=([a,b])=>fmt(a)+" – "+(b>=1440?"midnight":fmt(b));
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function nyNow(){const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return{date:`${p.year}-${p.month}-${p.day}`,min:(+p.hour)*60+(+p.minute)}}
function addDays(ds,n){const[y,m,d]=ds.split("-").map(Number);const t=new Date(Date.UTC(y,m-1,d+n));return t.toISOString().slice(0,10)}
const dow=ds=>{const[y,m,d]=ds.split("-").map(Number);return new Date(Date.UTC(y,m-1,d)).getUTCDay()};
const pretty=ds=>{const[y,m,d]=ds.split("-").map(Number);return MON[m-1]+" "+d};
function miles(a,b,c,d){const R=3958.8,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b);
  const h=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function hoursOn(r,ds){if(!r.wk)return null;let s=r.wk[dow(ds)];
  if(r.over)for(const o of r.over)if(ds>=o.from&&ds<=o.to)s=Array.isArray(o.h)?o.h[dow(ds)]:o.h;return segs(s)}

// status for a rink on a date; nowMin only when date is today
function status(r,ds,nowMin,noun){noun=noun||"public skate";
  const h=hoursOn(r,ds);
  const notYet=r.start?ds<r.start:(!r.yearRound&&!r.inSeasonNow);
  if(r.end&&ds>r.end)return{k:"off",t:"Season over",h:[],ghost:false,skating:false};
  if(notYet)return{k:"plan",t:r.start?"Opens "+DOW[dow(r.start)]+", "+pretty(r.start):"Opens Nov · date TBA",h:h||[],ghost:true,skating:false};
  if(!h)return{k:"plan",t:r.actInfo?"Offered · times on rink calendar":"Times vary · check schedule",h:[],ghost:false,skating:null,vary:true};
  if(!h.length)return{k:"off",t:"No "+noun+" "+DOW[dow(ds)],h,ghost:false,skating:false};
  if(nowMin==null)return{k:"open",t:h.map(range).join(", "),h,ghost:false,skating:true,plain:true};
  const cur=h.find(([a,b])=>nowMin>=a&&nowMin<b);
  if(cur)return{k:"open",t:"Open now · until "+(cur[1]>=1440?"midnight":fmt(cur[1])),h,ghost:false,skating:true,now:true};
  const nx=h.find(([a])=>a>nowMin);
  if(nx)return{k:"soon",t:"Opens "+fmt(nx[0]),h,ghost:false,skating:true};
  return{k:"off",t:"Done for today",h,ghost:false,skating:true,done:true};
}

// ---------- state ----------
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const $=id=>document.getElementById(id);
let NOW=nyNow(), day=NOW.date;
const near=$("near"),sortSel=$("sort");
PLACES.forEach(([n],i)=>{const o=document.createElement("option");o.value=i;o.textContent=n;near.appendChild(o)});
let GPS=null;
try{GPS=JSON.parse(store.get("rinkGps")||"null")}catch(e){}
function addGpsOption(){if(near.querySelector('option[value="gps"]'))return;
  const o=document.createElement("option");o.value="gps";o.textContent="My location";near.insertBefore(o,near.firstChild)}
if(GPS)addGpsOption();
near.value=store.get("rinkNear")??"0"; if(near.value===""||(near.value!=="gps"&&!PLACES[near.value]))near.value="0";
function place(){return near.value==="gps"&&GPS?["your location",GPS[0],GPS[1]]:PLACES[near.value]}
const locBtn=$("locate");
if(!("geolocation" in navigator))locBtn.hidden=true;
locBtn.onclick=()=>{locBtn.disabled=true;locBtn.textContent="Finding you…";
  navigator.geolocation.getCurrentPosition(p=>{
    GPS=[p.coords.latitude,p.coords.longitude];store.set("rinkGps",JSON.stringify(GPS));
    addGpsOption();near.value="gps";store.set("rinkNear","gps");
    locBtn.disabled=false;locBtn.textContent="Update my location";render()},
  err=>{locBtn.disabled=false;
    locBtn.textContent=err.code===1?"Location blocked. Pick a neighborhood":"Couldn't find you. Try again"},
  {enableHighAccuracy:false,timeout:10000,maximumAge:300000})};
if(GPS)locBtn.textContent="Update my location";
sortSel.value=store.get("rinkSort")||"dist";
const openSet=new Set();
let act=store.get("rinkAct")||"public"; if(!ACTIVITIES.some(a=>a.id===act))act="public";
// a rink as seen through one activity: its own hours (or none) and season
function asAct(r,a){if(a==="public")return r;const x=(ACTS[r.id]||{})[a];if(!x)return null;
  return Object.assign({},r,{wk:x.wk||null,over:x.over||null,start:x.start!==undefined?x.start:r.start,end:x.end!==undefined?x.end:r.end,
    conf:x.wk?"confirmed":"info",actInfo:x})}
const offers=(r,a)=>a==="public"||!!(ACTS[r.id]||{})[a];
function buildActs(){const box=$("acts");box.innerHTML="";
  for(const a of ACTIVITIES){const n=RINKS.filter(r=>offers(r,a.id)).length,b=document.createElement("button");
    b.type="button";b.setAttribute("aria-pressed",a.id===act);b.innerHTML=`${a.label}<span>${n}</span>`;
    b.onclick=()=>{act=a.id;store.set("rinkAct",act);render()};box.appendChild(b)}}

function buildDays(){const box=$("days");box.innerHTML="";
  for(let i=0;i<7;i++){const ds=addDays(NOW.date,i),b=document.createElement("button");
    b.type="button";b.setAttribute("aria-pressed",ds===day);
    b.innerHTML=`<b>${i===0?"Today":i===1?"Tmrw":DOW[dow(ds)]}</b><span>${pretty(ds)}</span>`;
    b.onclick=()=>{day=ds;render()};box.appendChild(b)}}

function buildTicks(){const t=$("ticks");t.innerHTML="";
  for(let m=AX0+60;m<=AX1;m+=120){} // spacing
  [8,10,12,14,16,18,20,22,24].forEach(h=>{const s=document.createElement("span");
    s.style.left=((h*60-AX0)/(AX1-AX0)*100)+"%";s.textContent=fmt(h*60,true);t.appendChild(s)})}

const pct=m=>Math.max(0,Math.min(100,(m-AX0)/(AX1-AX0)*100));

function render(){
  NOW=nyNow();
  const isToday=day===NOW.date;
  const [pn,plat,plng]=place();
  const onlyOpen=$("onlyOpen").checked, onlyNow=$("onlyNow").checked&&isToday;
  $("nowWrap").hidden=!isToday;
  $("clock").textContent=(isToday?"Today, ":DOW[dow(day)]+", ")+pretty(day)+(isToday?" · "+fmt(NOW.min)+" in NYC":"")+" · distances from "+pn;
  buildDays();buildActs();
  const A=ACTIVITIES.find(a=>a.id===act);
  $("legendAct").textContent=A.label;

  let rows=RINKS.map(r=>asAct(r,act)).filter(Boolean).map(r=>({r,d:miles(plat,plng,r.lat,r.lng),s:status(r,day,isToday?NOW.min:null,A.noun)}));
  const total=rows.length;
  const skating=rows.filter(x=>x.s.skating).length, nowOpen=rows.filter(x=>x.s.now).length;
  const rank={open:0,soon:1,plan:2,off:3};
  rows.sort((a,b)=>sortSel.value==="open"?(rank[a.s.k]-rank[b.s.k]||a.d-b.d):a.d-b.d);
  if(onlyOpen)rows=rows.filter(x=>x.s.skating);
  if(onlyNow)rows=rows.filter(x=>x.s.now);

  const when=isToday?"today":"on "+DOW[dow(day)];
  const timed=rows.length&&rows.some(x=>x.r.wk);
  $("summary").innerHTML=act==="public"
    ?`<span><strong>${skating}</strong>of ${total} rinks have public skate ${when}</span>`+(isToday?`<span><strong>${nowOpen}</strong>open right now</span>`:"")
    :`<span><strong>${total}</strong>rink${total===1?" offers":"s offer"} ${A.noun}</span>`+(timed?`<span><strong>${skating}</strong>with posted times ${when}</span>`:"")+
     `<span>Most rinks book these through their own calendars, so tap a rink for details and the link.</span>`;

  const list=$("list");list.innerHTML="";
  if(!rows.length){list.innerHTML=`<div class="empty">No rinks match. Try another day or turn off a filter.</div>`;return}
  const gridLines=[8,10,12,14,16,18,20,22].map(h=>`<div class="grid" style="left:${pct(h*60)}%"></div>`).join("");
  for(const {r,d,s} of rows){
    const el=document.createElement("details");el.className="rink";el.open=openSet.has(r.id);
    el.addEventListener("toggle",()=>{el.open?openSet.add(r.id):openSet.delete(r.id)});
    const pillCls={open:"s-open",soon:"s-soon",off:"s-off",plan:"s-plan"}[s.k];
    let bars=gridLines;
    if(s.vary)bars+=`<div class="novary">${r.actInfo?"Times are on the rink's own calendar":"Session times vary, see the rink's schedule"}</div>`;
    for(const [a,b] of s.h){const past=isToday&&!s.ghost&&b<=NOW.min;
      bars+=`<div class="seg${s.ghost?" ghost":""}${past?" past":""}" style="left:${pct(a)}%;width:${pct(b)-pct(a)}%" title="${range([a,b])}">${(pct(b)-pct(a))>14?range([a,b]):""}</div>`}
    if(isToday&&NOW.min>=AX0)bars+=`<div class="now" style="left:${pct(NOW.min)}%"></div>`;
    const confTxt={confirmed:"2026–27 hours",posted:"Official hours",last:"Based on last season",vary:"Times vary",info:"Check rink calendar"}[r.conf];
    const season=r.yearRound?"Year-round":(r.start?pretty(r.start):(r.startLabel||"In season"))+(r.end?" – "+pretty(r.end)+", "+r.end.slice(0,4):"");
    const pillText=s.plain?(s.h.length>1?s.h.length+(act==="lessons"?" class times":" sessions"):A.label):s.t;
    const others=ACTIVITIES.filter(a=>a.id!=="public"&&a.id!==act&&offers(r,a.id)).map(a=>`<span class="tag">${a.label}</span>`).join("");
    const actName=act==="public"?"public skate":A.label.toLowerCase();
    // weekly table Mon..Sun
    let week="";
    if(r.wk){for(const i of [1,2,3,4,5,6,0]){
      // find the date in the next 7 days with this weekday so overrides apply
      let ds=NOW.date;for(let k=0;k<7;k++){const c=addDays(NOW.date,k);if(dow(c)===i){ds=c;break}}
      const h=hoursOn(r,ds);week+=`<tr class="${dow(day)===i?"sel":""}"><td>${DOW[i]}</td><td>${h.length?h.map(range).join("<br>"):"None"}</td></tr>`}}
    el.innerHTML=`<summary>
      <div class="head">
        <div class="name"><h2>${r.name}</h2><span class="where">${r.where}</span></div>
        <span class="dist">${d<0.1?"<0.1":d.toFixed(1)} mi</span>
      </div>
      <div class="track" aria-hidden="true">${bars}</div>
      <div class="meta"><span class="pill ${pillCls}">${pillText}</span>${s.plain&&s.h.length?`<span>${s.h.map(range).join(" · ")}</span>`:""}<span>${r.io}</span><span class="conf c-${r.conf}">${confTxt}</span></div>
      ${others?`<div class="tags" aria-label="Also offers">${others}</div>`:""}
    </summary>
    <div class="detail">
      <div><h3>Weekly ${actName}</h3>${r.wk?`<table class="week"><tbody>${week}</tbody></table>`:`<p class="note">${r.actInfo?"This rink doesn't publish fixed weekly times. Book through its calendar.":"Session times aren't fixed. Check the live schedule."}</p>`}
        ${r.actInfo?`<p style="margin-top:10px">${r.actInfo.info}</p><p><a href="${r.actInfo.url}" target="_blank" rel="noopener">${A.label} at ${r.name} ↗</a></p>`:""}</div>
      <div class="facts">
        <div><h3>Season</h3><p>${season}</p></div>
        <div><h3>${act==="public"?"Prices":"Public skate prices"}</h3><p>${r.price}</p></div>
        ${r.note?`<p class="note">${r.note}</p>`:""}
        ${r.phone?`<p>Phone: <span style="user-select:all">${r.phone}</span></p>`:""}
        <p><a href="${r.url}" target="_blank" rel="noopener">Official schedule & tickets ↗</a></p>
      </div>
    </div>`;
    list.appendChild(el)}
}

near.onchange=()=>{store.set("rinkNear",near.value);render()};
sortSel.onchange=()=>{store.set("rinkSort",sortSel.value);render()};
$("onlyOpen").onchange=render;$("onlyNow").onchange=render;
buildTicks();render();
{const [y,m,d]=UPDATED.split("-").map(Number);$("updated").textContent="Schedules last updated "+MON[m-1]+" "+d+", "+y+".";}
setInterval(()=>{const n=nyNow();if(n.date!==NOW.date&&day===NOW.date)day=n.date;render()},60000);
})();
