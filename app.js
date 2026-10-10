const SUPABASE_URL = "https://pywwlrfxqrljriumxmwf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DDpOhpK3oex7Fi85jTQ0rQ_8y2bdngi";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const STORAGE_KEY = "book-library-v1";
const LEGACY_STORAGE_KEY = STORAGE_KEY;

function getUserStorageKey(userId) {
  return userId
    ? `book-library-v1-${userId}`
    : "book-library-v1-guest";
}
let currentStorageKey = getUserStorageKey(null);

async function copyLegacyDataToCurrentUser() {
  try {
    const {
      data: { user },
      error
    } = await supabaseClient.auth.getUser();

    if (error || !user) return;

    const oldData = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!oldData) return;

    const userKey = getUserStorageKey(user.id);

    // 이미 사용자 전용 데이터가 있으면 덮어쓰지 않음
    if (localStorage.getItem(userKey)) return;

    // 기존 데이터를 복사만 함
    localStorage.setItem(userKey, oldData);

    console.log("기존 데이터를 사용자 전용 저장공간으로 안전하게 복사했습니다.");
  } catch (err) {
    console.error("사용자 데이터 복사 실패:", err);
  }
}
const tr = (text)=> (window.I18N && window.I18N.translateText) ? window.I18N.translateText(String(text)) : String(text);
const trHtml = (html)=> (window.I18N && window.I18N.translateHtmlString) ? window.I18N.translateHtmlString(html) : html;
const TIMER_KEY = "book-library-active-timer-v1";
const BACKUP_META_KEY = "book-library-last-auto-backup-v1";
const BACKUP_DB_NAME = "mbo-library-backups";
const BACKUP_STORE = "snapshots";
const SCHEMA_VERSION = 5;
const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간
const MAX_AUTO_BACKUPS = 8;
let data = { schemaVersion: SCHEMA_VERSION, books: [], baselineBooks: 0 };
let currentBookId = null;
let cardRectCache = null;
let lastFetchedCover = null;

// view/filter state
let viewMode = "grid";      // grid | board
let filterStatus = "all";   // all | not_started | in_progress | done
let sortBy = "updated";     // updated | progress | title
let searchQuery = "";

// timer state (persisted while running, so refresh/browser restart can recover it)
let timer = { running:false, startTs:null, elapsed:0, bookId:null, sessionDate:null };
let timerInterval = null;

const COVER_PALETTE = ["#213D31","#1B2E45","#4A2A1F","#332349","#3D2C10","#173B3B","#3B1B2C"];
const STATUS_COLORS = {
  wishlist: "#5C4F7A",
  not_started: "#4A5560",
  in_progress: "#2C5A82",
  done: "#2F6B4D",
  dropped: "#6B4B47"
};

function hashColor(str){
  let h = 0;
  for(let i=0;i<str.length;i++) h = str.charCodeAt(i) + ((h<<5)-h);
  return COVER_PALETTE[Math.abs(h) % COVER_PALETTE.length];
}

function ringSvg(pct, size, stroke, trackColor, fgColor, textColor){
  const r = (size/2) - (stroke/2) - 1;
  const c = 2*Math.PI*r;
  const dash = c * (pct/100);
  const center = size/2;
  const fontSize = Math.round(size*0.26);
  return `
    <svg width="${size}" height="${size}" class="mini-ring" viewBox="0 0 ${size} ${size}">
      <circle cx="${center}" cy="${center}" r="${r}" stroke="${trackColor}" stroke-width="${stroke}" fill="none"/>
      <circle cx="${center}" cy="${center}" r="${r}" stroke="${fgColor}" stroke-width="${stroke}" fill="none"
        stroke-dasharray="${c}" stroke-dashoffset="${c-dash}" stroke-linecap="round"
        transform="rotate(-90 ${center} ${center})"/>
      <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central"
        font-size="${fontSize}" font-weight="700" fill="${textColor}" font-family="Avenir Next, sans-serif">${pct}%</text>
    </svg>
  `;
}
function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function fmtDate(d){
  if(!d) return "";
  const dt = new Date(d+"T00:00:00");
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,"0")}.${String(dt.getDate()).padStart(2,"0")}`;
}
function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
function escapeAttr(str){ return escapeHtml(String(str ?? "")); }
function timeToMinutes(v){ if(typeof v!=="string"||!/^\d{2}:\d{2}$/.test(v)) return null; const [h,m]=v.split(":").map(Number); return h*60+m; }
function minutesToTime(v){ if(v==null||!Number.isFinite(Number(v))) return "—"; let n=Math.round(Number(v)); n=((n%1440)+1440)%1440; return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0"); }
function statusLabel(s){
  return ({ wishlist:"읽고 싶음", not_started:"시작 전", in_progress:"읽는 중", done:"완료", dropped:"중단" })[s] || "시작 전";
}
function pctOf(book){
  if(!book.totalPages || book.totalPages<=0) return 0;
  return Math.max(0, Math.min(100, Math.round((book.currentPage/book.totalPages)*100)));
}

const ROUTINE_DEFS = [
  { id:"qt", name:"큐티", icon:"🙏", kind:"check" },
  { id:"diary", name:"일기", icon:"📔", kind:"note" },
  { id:"thoughts", name:"오늘의 생각", icon:"💭", kind:"note" },
  { id:"exercise_am", name:"아침운동", icon:"🚴", kind:"check" },
  { id:"exercise_pm", name:"저녁운동", icon:"🏋️", kind:"check" },
  { id:"wake_early", name:"일찍 일어나기", icon:"🌅", kind:"time", goalTime:"07:00" },
  { id:"sleep_early", name:"일찍 자기", icon:"🌙", kind:"time", goalTime:"23:30" }
];

function safeText(v, max=5000){
  return typeof v === "string" ? v.slice(0,max) : "";
}
function safeDate(v){
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function safeCoverUrl(v){
  if(typeof v !== "string" || !v) return null;
  try{
    const u = new URL(v, location.href);
    return u.protocol === "https:" ? u.href : null;
  }catch(e){ return null; }
}
function normalizeBook(raw){
  const b = raw && typeof raw === "object" ? raw : {};
  const allowedStatus = new Set(["wishlist","not_started","in_progress","done","dropped"]);
  const totalPages = Math.max(0, Number.parseInt(b.totalPages) || 0);
  const currentPage = Math.max(0, Math.min(totalPages || Number.MAX_SAFE_INTEGER, Number.parseInt(b.currentPage) || 0));
  return {
    ...b,
    id: safeText(b.id,120) || ("book_"+Date.now()+"_"+Math.random().toString(36).slice(2,8)),
    title: safeText(b.title,500), author: safeText(b.author,500), publisher: safeText(b.publisher,500), translator: safeText(b.translator,500),
    totalPages, currentPage,
    status: allowedStatus.has(b.status) ? b.status : "not_started",
    startDate: safeDate(b.startDate), endDate: safeDate(b.endDate), plannedEnd: safeDate(b.plannedEnd),
    takeaway: safeText(b.takeaway,10000), review: safeText(b.review,50000),
    isPublic: b.isPublic === true,
    sessions: Array.isArray(b.sessions) ? b.sessions.map(x=>({ date:safeDate(x&&x.date), minutes:Math.max(0,Math.min(1440,Number.parseInt(x&&x.minutes)||0)) })).filter(x=>x.date&&x.minutes>0) : [],
    quotes: Array.isArray(b.quotes) ? b.quotes.slice(0,500).map(q=>({ id:safeText(q&&q.id,120)||("q_"+Date.now()), text:safeText(q&&q.text,10000), page:Math.max(0,Number.parseInt(q&&q.page)||0)||null })) : [],
    coverColor: safeText(b.coverColor,30) || COVER_PALETTE[0],
    coverImage: safeCoverUrl(b.coverImage),
    rating: Math.max(0,Math.min(5,Number.parseInt(b.rating)||0)),
    genres: Array.isArray(b.genres) ? [...new Set(b.genres.map(g=>safeText(g,80)).filter(Boolean))].slice(0,30) : [],
    updatedAt: Number.isFinite(Number(b.updatedAt)) ? Number(b.updatedAt) : Date.now()
  };
}
function normalizeRoutine(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const def = ROUTINE_DEFS.find(x=>x.id===source.id) || null;
  const isCustom = !def && source.isCustom === true;
  if(!def && !isCustom) return null;
  const allowedKinds=new Set(["check","note","time","number"]);
  const kind=def ? def.kind : (allowedKinds.has(source.kind)?source.kind:"check");
  const r={...source,id:def?def.id:(safeText(source.id,120)||("custom_"+Date.now()+"_"+Math.random().toString(36).slice(2,7))),name:def?def.name:(safeText(source.name,120)||"새 목표"),icon:def?(safeText(source.icon,32)||def.icon):(safeText(source.icon,32)||"🎯"),kind,isCustom:!!isCustom,goalTime:safeText(source.goalTime||(def&&def.goalTime)||"",5),targetValue:Number.isFinite(Number(source.targetValue))?Number(source.targetValue):null,targetMode:source.targetMode==="max"?"max":"min",unit:safeText(source.unit,30),goalTitle:safeText(source.goalTitle,300),goalWhy:safeText(source.goalWhy,1000),weeklyTarget:Math.max(1,Math.min(7,Number.parseInt(source.weeklyTarget)||0))||null,goalStartedAt:safeDate(source.goalStartedAt),entries:Array.isArray(source.entries)?source.entries.slice(-5000).map(e=>({...e,date:safeDate(e&&e.date),done:!!(e&&e.done),note:safeText(e&&e.note,10000),time:safeText(e&&e.time,5),value:Number.isFinite(Number(e&&e.value))?Number(e.value):null})).filter(e=>e.date):[]};
  ensureRoutineGoalShape(r); return r;
}
function legacyRoutineHasUserData(r){
  if(!r || typeof r!=="object") return false;
  const hasEntries=Array.isArray(r.entries) && r.entries.some(e=>e && e.date);
  const g=r.goal && typeof r.goal==="object" ? r.goal : {};
  const hasConfiguredGoal=g.configured===true || !!safeText(g.statement,300) || !!safeText(g.reason,1000) || !!safeDate(g.startedAt);
  const hasLegacyGoal=!!safeText(r.goalTitle,300) || !!safeText(r.goalWhy,1000) || !!safeDate(r.goalStartedAt);
  return hasEntries || hasConfiguredGoal || hasLegacyGoal;
}
function normalizeData(raw){
  const src=raw&&typeof raw==="object"?raw:{};
  const rawRoutines=Array.isArray(src.routines)?src.routines:[];
  const legacyIds=new Set(ROUTINE_DEFS.map(x=>x.id));
  const routines=[];
  rawRoutines.forEach(source=>{
    if(!source || typeof source!=="object") return;
    const isLegacy=legacyIds.has(source.id);
    if(isLegacy && !legacyRoutineHasUserData(source)) return; // untouched presets disappear, no data is deleted
    if(!isLegacy && source.isCustom!==true) return;
    const normalized=normalizeRoutine({...source,isCustom:true});
    if(normalized){ normalized.isCustom=true; routines.push(normalized); }
  });
  return {...src,schemaVersion:SCHEMA_VERSION,baselineBooks:Math.max(0,Number.parseInt(src.baselineBooks)||0),weeklyGoal:Math.max(1,Number.parseInt(src.weeklyGoal)||2),ownerName:safeText(src.ownerName,200),books:Array.isArray(src.books)?src.books.slice(0,5000).map(normalizeBook):[],routines,updatedAt:Date.now()};
}
function plausibleData(obj){ return !!obj && typeof obj === "object" && Array.isArray(obj.books); }

function openBackupDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const req=indexedDB.open(BACKUP_DB_NAME,1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(BACKUP_STORE)) db.createObjectStore(BACKUP_STORE,{keyPath:"createdAt"}); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function writeBackup(snapshot, reason="auto"){
  try{
    const db=await openBackupDb();
    await new Promise((resolve,reject)=>{ const tx=db.transaction(BACKUP_STORE,"readwrite"); tx.objectStore(BACKUP_STORE).put({createdAt:Date.now(),reason,data:snapshot}); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
    const all=await new Promise((resolve,reject)=>{ const tx=db.transaction(BACKUP_STORE,"readonly"); const req=tx.objectStore(BACKUP_STORE).getAllKeys(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error); });
    const old=all.sort((a,b)=>a-b).slice(0,Math.max(0,all.length-MAX_AUTO_BACKUPS));
    if(old.length) await new Promise((resolve,reject)=>{ const tx=db.transaction(BACKUP_STORE,"readwrite"); old.forEach(k=>tx.objectStore(BACKUP_STORE).delete(k)); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
    db.close();
  }catch(e){ console.warn("backup skipped",e); }
}
async function latestBackup(){
  try{
    const db=await openBackupDb();
    const item=await new Promise((resolve,reject)=>{ const tx=db.transaction(BACKUP_STORE,"readonly"); const req=tx.objectStore(BACKUP_STORE).openCursor(null,"prev"); req.onsuccess=()=>resolve(req.result?req.result.value:null); req.onerror=()=>reject(req.error); });
    db.close(); return item;
  }catch(e){ return null; }
}
async function maybeAutoBackup(){
  const last=Number(localStorage.getItem(BACKUP_META_KEY)||0);
  if(Date.now()-last < AUTO_BACKUP_INTERVAL_MS) return;
  await writeBackup(JSON.parse(JSON.stringify(data)),"auto");
  try{ localStorage.setItem(BACKUP_META_KEY,String(Date.now())); }catch(e){}
}

function persistTimer(){
  try{
    if(timer.running && timer.bookId) localStorage.setItem(TIMER_KEY,JSON.stringify({bookId:timer.bookId,startTs:timer.startTs,elapsed:timer.elapsed,sessionDate:timer.sessionDate||todayStr()}));
    else localStorage.removeItem(TIMER_KEY);
  }catch(e){}
}
function restoreTimerForBook(bookId){
  try{
    const raw=localStorage.getItem(TIMER_KEY); if(!raw) return null;
    const t=JSON.parse(raw); if(!t || t.bookId!==bookId || !Number.isFinite(Number(t.startTs))) return null;
    return {running:true,startTs:Number(t.startTs),elapsed:Math.max(0,Math.floor((Date.now()-Number(t.startTs))/1000)),bookId,sessionDate:safeDate(t.sessionDate)||todayStr()};
  }catch(e){ return null; }
}
function clearPersistedTimer(){ try{ localStorage.removeItem(TIMER_KEY); }catch(e){} }

async function loadData(){
  if(tryRenderSharedFromHash()) return;
  let loaded=null, corrupt=false;
  try{
    const raw=localStorage.getItem(currentStorageKey);
    if(raw){ loaded=JSON.parse(raw); if(!plausibleData(loaded)) corrupt=true; }
  }catch(e){ corrupt=true; }
  if(corrupt){
    const backup=await latestBackup();
    if(backup && plausibleData(backup.data)){
      loaded=backup.data;
      alert("저장 데이터에 문제가 있어 가장 최근 자동 백업으로 복구했어요.");
    }
  }
  if(loaded && Number(loaded.schemaVersion||0) < SCHEMA_VERSION){
    await writeBackup(JSON.parse(JSON.stringify(loaded)),"before-v5-custom-goals-migration");
  }
  data=normalizeData(loaded || data);
  await saveData({backup:false});
  await maybeAutoBackup();
  showMbo();
}
async function saveData(opts={}){
  try{
    data=normalizeData(data);
    localStorage.setItem(currentStorageKey, JSON.stringify(data));
    if(opts.backup!==false) maybeAutoBackup();
    return true;
  }catch(e){
    console.error("save failed", e);
    if(e && (e.name==="QuotaExceededError" || e.name==="NS_ERROR_DOM_QUOTA_REACHED")) alert("브라우저 저장공간이 부족해 저장하지 못했어요. JSON 백업을 내려받은 뒤 오래된 브라우저 데이터를 정리해 주세요.");
    return false;
  }
}
window.addEventListener("pagehide", persistTimer);

function starsHtml(rating, mini){
  rating = rating || 0;
  let s = "";
  for(let i=1;i<=5;i++) s += i<=rating ? "★" : "☆";
  return s;
}

function getFilteredSortedBooks(){
  let list = data.books.slice();
  if(filterStatus !== "all") list = list.filter(b=>b.status===filterStatus);
  if(searchQuery){
    const q = searchQuery.toLowerCase();
    list = list.filter(b => (b.title||"").toLowerCase().includes(q) || (b.author||"").toLowerCase().includes(q));
  }
  if(sortBy === "updated") list.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  else if(sortBy === "progress") list.sort((a,b)=>pctOf(b)-pctOf(a));
  else if(sortBy === "title") list.sort((a,b)=>(a.title||"").localeCompare(b.title||"", "ko"));
  return list;
}

function dkey(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function parseD(s){ return new Date(s+"T00:00:00"); }
function daysDiff(a, b){ return Math.round((parseD(b) - parseD(a)) / 86400000); }

// ---------- Generic life-MBO routines (큐티, 일기, 운동, 일찍 자고 일어나기 등) ----------
function getRoutine(id){ return (data.routines||[]).find(r=>r.id===id); }
function routineEntry(r, dateKey){ return (r.entries||[]).find(e=>e.date===dateKey); }
function routineSuccess(r, entry){
  if(!entry) return false;
  if(r.kind === "check") return !!entry.done;
  if(r.kind === "note") return !!(entry.note && entry.note.trim());
  if(r.kind === "time"){
    if(!entry.time || !r.goalTime) return false; const value=timeToMinutes(entry.time), target=timeToMinutes(r.goalTime); if(value==null||target==null) return false;
    if(r.id === "sleep_early" && value < 12*60) return false;
    return value <= target;
  }
  if(r.kind === "number"){
    if(!Number.isFinite(Number(entry.value))||!Number.isFinite(Number(r.targetValue))) return false;
    return r.targetMode === "max" ? Number(entry.value)<=Number(r.targetValue) : Number(entry.value)>=Number(r.targetValue);
  }
  return false;
}
function routineStreak(r){
  let n = 0;
  const d = new Date(); d.setHours(0,0,0,0);
  while(routineSuccess(r, routineEntry(r, dkey(d)))){ n++; d.setDate(d.getDate()-1); }
  return n;
}
function upsertRoutineEntry(routineId, dateKey, payload){
  const r = getRoutine(routineId);
  if(!r) return;
  r.entries = r.entries || [];
  let e = r.entries.find(x=>x.date===dateKey);
  if(!e){ e = { date: dateKey }; r.entries.push(e); }
  Object.assign(e, payload);
}
function deleteRoutineEntry(routineId, dateKey){
  const r = getRoutine(routineId);
  if(!r) return;
  r.entries = (r.entries||[]).filter(e=>e.date!==dateKey);
}
function routineValueLabel(r, entry){
  if(!entry) return "—";
  if(r.kind === "check") return entry.done ? "완료" : "미완료";
  if(r.kind === "note") return entry.note || "—";
  if(r.kind === "time") return entry.time || "—";
  if(r.kind === "number") return Number.isFinite(Number(entry.value)) ? `${entry.value}${r.unit?" "+r.unit:""}` : "—";
  return "—";
}

function ensureRoutineGoalShape(r){
  if(!r.goal || typeof r.goal !== "object") r.goal = {};
  if(typeof r.goal.configured !== "boolean") r.goal.configured = false;
  if(typeof r.goal.statement !== "string") r.goal.statement = "";
  if(typeof r.goal.reason !== "string") r.goal.reason = "";
  if(!Number.isFinite(Number(r.goal.weeklyTarget))) r.goal.weeklyTarget = 3;
  r.goal.weeklyTarget = Math.max(1, Math.min(7, parseInt(r.goal.weeklyTarget)||3));
  if(typeof r.goal.startedAt !== "string") r.goal.startedAt = "";
  return r.goal;
}
function routineGoalConfigured(r){ return !!ensureRoutineGoalShape(r).configured; }
function startOfWeek(d){
  const x = new Date(d); x.setHours(0,0,0,0);
  x.setDate(x.getDate() - ((x.getDay()+6)%7));
  return x;
}
function routineWeekSuccessCount(r, refDate=new Date()){
  const start = startOfWeek(refDate);
  let n = 0;
  for(let i=0;i<7;i++){
    const d = new Date(start); d.setDate(d.getDate()+i);
    if(routineSuccess(r, routineEntry(r,dkey(d)))) n++;
  }
  return n;
}
function routineLastNDaysRate(r, days=30){
  let success=0, eligible=0;
  const today=new Date(); today.setHours(0,0,0,0);
  for(let i=0;i<days;i++){
    const d=new Date(today); d.setDate(d.getDate()-i);
    if(r.goal && r.goal.startedAt && dkey(d) < r.goal.startedAt) continue;
    eligible++;
    if(routineSuccess(r,routineEntry(r,dkey(d)))) success++;
  }
  return eligible ? Math.round(success/eligible*100) : 0;
}
function routineTargetPerformanceBetween(r,start,end){
  const g=ensureRoutineGoalShape(r); let eligible=0,success=0; const today=new Date(); today.setHours(0,0,0,0); const last=end>today?today:end;
  for(let d=new Date(start);d<=last;d.setDate(d.getDate()+1)){const key=dkey(d);if(g.startedAt&&key<g.startedAt)continue;eligible++;if(routineSuccess(r,routineEntry(r,key)))success++;}
  const expected=eligible*(Math.max(1,g.weeklyTarget||1)/7); return {eligible,success,expected,rate:expected>0?Math.min(100,Math.round(success/expected*100)):0};
}
function routineMonthPerformance(r,year,month){return routineTargetPerformanceBetween(r,new Date(year,month,1),new Date(year,month+1,0));}
function routineAverageTimeBetween(r,start,end){const vals=[];(r.entries||[]).forEach(e=>{if(!e.date)return;const d=parseD(e.date);if(d<start||d>end)return;const v=timeToMinutes(e.time);if(v!=null)vals.push(v);});return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;}
function routineAverageNumberBetween(r,start,end){const vals=(r.entries||[]).filter(e=>e.date&&parseD(e.date)>=start&&parseD(e.date)<=end&&Number.isFinite(Number(e.value))).map(e=>Number(e.value));return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*10)/10:null;}
function readingMinutesOn(dateKey){return data.books.reduce((sum,b)=>sum+(b.sessions||[]).filter(s=>s.date===dateKey).reduce((a,s)=>a+(s.minutes||0),0),0);}
function mboTooltipText(dateKey){const sc=mboDayScore(dateKey),lines=[dateKey,`${tr("달성")} ${sc.success}/${sc.total} · ${sc.rate}%`];const rm=readingMinutesOn(dateKey);lines.push(`${rm>0?"✓":"○"} ${tr("독서")}${rm>0?` · ${rm}${tr("분")}`:""}`);(data.routines||[]).forEach(r=>{const g=ensureRoutineGoalShape(r);if(!g.configured||(g.startedAt&&dateKey<g.startedAt))return;const e=routineEntry(r,dateKey),ok=routineSuccess(r,e),detail=e?routineValueLabel(r,e):"";lines.push(`${ok?"✓":"○"} ${tr(r.name)}${detail&&detail!=="—"?` · ${detail}`:""}`);});return lines.join("\n");}
function routineTooltipText(r,dateKey){const e=routineEntry(r,dateKey),ok=routineSuccess(r,e);return [dateKey,ok?tr("달성"):tr("미달성"),e?routineValueLabel(r,e):tr("기록 없음")].filter(Boolean).join("\n");}

function readingSuccessOn(dateKey){
  return data.books.some(b => (b.sessions||[]).some(s => s.date===dateKey && s.minutes>0));
}
function mboDayScore(dateKey){
  let total=1; // 독서는 항상 하나의 MBO로 포함
  let success=readingSuccessOn(dateKey) ? 1 : 0;
  (data.routines||[]).forEach(r=>{
    if(!routineGoalConfigured(r)) return;
    const g=ensureRoutineGoalShape(r);
    if(g.startedAt && dateKey < g.startedAt) return;
    total++;
    if(routineSuccess(r,routineEntry(r,dateKey))) success++;
  });
  return { total, success, rate: total ? Math.round(success/total*100) : 0 };
}
function heatLevelFromRate(rate){
  if(rate<=0) return "";
  if(rate<=25) return "l1";
  if(rate<=50) return "l2";
  if(rate<=75) return "l3";
  return "l4";
}
function mboHeatmapHtml(days){
  const today=new Date(); today.setHours(0,0,0,0);
  let html="";
  for(let i=days-1;i>=0;i--){
    const d=new Date(today); d.setDate(d.getDate()-i);
    const key=dkey(d), score=mboDayScore(key);
    html += `<div class="heatmap-cell ${heatLevelFromRate(score.rate)}" data-tooltip="${escapeAttr(mboTooltipText(key))}"></div>`;
  }
  return html;
}

let mboOverviewYear = new Date().getFullYear();

function mboYearsWithData(){
  const years = new Set([new Date().getFullYear()]);
  data.books.forEach(b => (b.sessions||[]).forEach(s => { if(s.date) years.add(parseInt(s.date.slice(0,4))); }));
  (data.routines||[]).forEach(r => {
    const g = ensureRoutineGoalShape(r);
    if(g.startedAt) years.add(parseInt(g.startedAt.slice(0,4)));
    (r.entries||[]).forEach(e => { if(e.date) years.add(parseInt(e.date.slice(0,4))); });
  });
  return [...years].filter(Boolean).sort((a,b)=>b-a);
}

function mboFirstEligibleDate(year){
  const candidates=[];
  const y=String(year);
  data.books.forEach(b => (b.sessions||[]).forEach(s=>{ if(s.date && s.date.startsWith(y)) candidates.push(s.date); }));
  (data.routines||[]).forEach(r=>{
    const g=ensureRoutineGoalShape(r);
    if(g.configured && g.startedAt){
      if(g.startedAt.slice(0,4) < y) candidates.push(`${year}-01-01`);
      else if(g.startedAt.startsWith(y)) candidates.push(g.startedAt);
    }
    (r.entries||[]).forEach(e=>{ if(e.date && e.date.startsWith(y)) candidates.push(e.date); });
  });
  return candidates.length ? candidates.sort()[0] : null;
}

function mboYearStats(year){
  const today=new Date(); today.setHours(0,0,0,0);
  const startKey=mboFirstEligibleDate(year);
  if(!startKey) return {year, days:0, avg:0, median:0, perfect:0, activeDays:0, startKey:null};
  const start=parseD(startKey);
  const yearEnd=new Date(year,11,31);
  const last=yearEnd>today?today:yearEnd;
  if(start>last) return {year, days:0, avg:0, median:0, perfect:0, activeDays:0, startKey};
  const rates=[]; let perfect=0, activeDays=0;
  for(let d=new Date(start); d<=last; d.setDate(d.getDate()+1)){
    const sc=mboDayScore(dkey(d));
    rates.push(sc.rate);
    if(sc.rate===100) perfect++;
    if(sc.success>0) activeDays++;
  }
  const sorted=rates.slice().sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  const median=sorted.length ? (sorted.length%2 ? sorted[mid] : Math.round((sorted[mid-1]+sorted[mid])/2)) : 0;
  const avg=rates.length ? Math.round(rates.reduce((a,b)=>a+b,0)/rates.length) : 0;
  return {year, days:rates.length, avg, median, perfect, activeDays, startKey};
}

function renderMboOverview(){
  const years=mboYearsWithData();
  const sel=document.getElementById("mboOverviewYearSelect");
  if(!years.includes(mboOverviewYear)) mboOverviewYear=years[0];
  const signature=years.join(",");
  if(sel.dataset.filled!==signature){
    sel.innerHTML=years.map(y=>`<option value="${y}">${y}년</option>`).join("");
    sel.dataset.filled=signature;
  }
  sel.value=String(mboOverviewYear);

  const year=mboOverviewYear;
  const jan1=new Date(year,0,1);
  const start=new Date(jan1); start.setDate(start.getDate()-jan1.getDay());
  const dec31=new Date(year,11,31);
  const today=new Date(); today.setHours(0,0,0,0);
  const firstEligible=mboFirstEligibleDate(year);
  let cells="", i=0; const monthAt={};
  for(const d=new Date(start); d<=dec31; d.setDate(d.getDate()+1),i++){
    if(d<jan1){ cells += `<div class="heatmap-cell empty"></div>`; continue; }
    if(d.getDate()===1) monthAt[Math.floor(i/7)]=(d.getMonth()+1)+"월";
    const key=dkey(d);
    const isFuture=d>today;
    const isBeforeData=firstEligible && key<firstEligible;
    const noDataYet=!firstEligible;
    if(isFuture || isBeforeData || noDataYet){
      const why=isFuture?"미래 날짜":(noDataYet?"아직 기록 없음":"기록 시작 전");
      cells += `<div class="heatmap-cell mbo-unavailable" data-tooltip="${escapeAttr(key+" · "+tr(why))}"></div>`;
    }else{
      const sc=mboDayScore(key);
      cells += `<div class="heatmap-cell ${heatLevelFromRate(sc.rate)}" data-tooltip="${escapeAttr(mboTooltipText(key))}"></div>`;
    }
  }
  const cols=Math.ceil(i/7); let months="";
  for(let c=0;c<cols;c++) months += `<span>${monthAt[c]||""}</span>`;
  document.getElementById("mboOverviewHeatmap").innerHTML=cells;
  document.getElementById("mboOverviewMonths").innerHTML=months;

  const st=mboYearStats(year);
  document.getElementById("mboOverviewTitle").textContent=`${year}년 나의 생활 그리드`;
  document.getElementById("mboYearSummary").innerHTML=st.days ? `
    <div><b>${st.avg}%</b><span>연평균 달성률</span></div>
    <div><b>${st.median}%</b><span>일별 중앙값</span></div>
    <div><b>${st.activeDays}</b><span>한 칸 이상 채운 날</span></div>
    <div><b>${st.perfect}</b><span>모두 채운 날</span></div>` : `
    <div class="mbo-no-year-data">${year}년에는 아직 계산할 기록이 없어요.</div>`;

  const all=years.map(mboYearStats).filter(x=>x.days>0);
  const avgs=all.map(x=>x.avg).sort((a,b)=>a-b);
  const overallAvg=avgs.length ? Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length) : 0;
  const mid=Math.floor(avgs.length/2);
  const overallMedian=avgs.length ? (avgs.length%2?avgs[mid]:Math.round((avgs[mid-1]+avgs[mid])/2)) : 0;
  document.getElementById("mboAllYearStats").innerHTML=`
    <div><b>${overallAvg}%</b><span>연도별 평균의 평균</span></div>
    <div><b>${overallMedian}%</b><span>연도별 평균의 중앙값</span></div>
    <div><b>${all.length}</b><span>기록된 연도</span></div>`;
  document.getElementById("mboYearList").innerHTML=all.length
    ? all.map(x=>`<button type="button" class="mbo-year-chip ${x.year===year?"active":""}" data-mbo-year="${x.year}"><b>${x.year}</b><span>평균 ${x.avg}% · 중앙값 ${x.median}%</span></button>`).join("")
    : `<span class="rc-note">기록이 쌓이면 연도별 비교가 여기에 표시돼요.</span>`;
  document.querySelectorAll("[data-mbo-year]").forEach(btn=>btn.onclick=()=>{
    mboOverviewYear=parseInt(btn.dataset.mboYear);
    renderMboOverview();
  });
}
function motivationText(r){
  const g=ensureRoutineGoalShape(r);
  if(!g.configured) return "큰 계획보다 먼저, 내가 계속할 수 있는 작은 기준 하나를 정해보세요.";
  const week=routineWeekSuccessCount(r);
  const left=Math.max(0,g.weeklyTarget-week);
  if(week>=g.weeklyTarget) return `이번 주 목표 ${g.weeklyTarget}회를 달성했어요. 이제는 더 하지 않아도 이미 약속을 지킨 주예요.`;
  if(routineStreak(r)>=3) return `${routineStreak(r)}일째 흐름이 이어지고 있어요. 이번 주 목표까지 ${left}번 남았어요.`;
  if(week>0) return `이번 주 ${week}번 해냈어요. 목표까지 ${left}번만 더 하면 돼요.`;
  return `이번 주 목표는 ${g.weeklyTarget}번이에요. 오늘 한 번이 이번 주의 첫 칸을 채웁니다.`;
}

function estimateFinish(b){
  if(!b.startDate || !b.totalPages || !(b.currentPage > 0) || b.currentPage >= b.totalPages) return null;
  const elapsed = Math.max(1, daysDiff(b.startDate, todayStr()) + 1);
  const pace = b.currentPage / elapsed;
  const daysLeft = Math.ceil((b.totalPages - b.currentPage) / pace);
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + daysLeft);
  return { date: dkey(d), pace: Math.round(pace*10)/10 };
}
function ensurePlanned(b){
  if(b.plannedEnd || b.status !== "in_progress" || !b.startDate) return;
  if(daysDiff(b.startDate, todayStr()) < 1) return;
  const est = estimateFinish(b);
  if(est) b.plannedEnd = est.date;
}
function earlyBadges(){
  return data.books
    .filter(b => b.status === "done" && b.endDate && b.plannedEnd && b.endDate < b.plannedEnd)
    .map(b => ({ bookId:b.id, title:b.title, days: daysDiff(b.endDate, b.plannedEnd) }));
}
function readingDaySet(){
  const s = new Set();
  data.books.forEach(b => (b.sessions||[]).forEach(x => { if(x.minutes > 0) s.add(x.date); }));
  return s;
}
function calcStreak(){
  const days = readingDaySet();
  const d = new Date(); d.setHours(0,0,0,0);
  const readToday = days.has(dkey(d));
  if(!readToday) d.setDate(d.getDate()-1);
  let n = 0;
  while(days.has(dkey(d))){ n++; d.setDate(d.getDate()-1); }
  return { n, readToday };
}

function renderRewards(){
  const days = readingDaySet();
  const today = new Date(); today.setHours(0,0,0,0);
  const todayKey = dkey(today);

  // weekly goal (Mon-Sun)
  const goal = Math.max(1, data.weeklyGoal || 2);
  const wkStart = new Date(today); wkStart.setDate(wkStart.getDate() - ((wkStart.getDay()+6)%7));
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkEnd.getDate()+6);
  const doneThisWeek = data.books.filter(b => b.status === "done" && b.endDate && b.endDate >= dkey(wkStart) && b.endDate <= dkey(wkEnd)).length;
  document.getElementById("weekGoalText").textContent = doneThisWeek >= goal ? `${doneThisWeek} / ${goal}권 · 달성! 🎉` : `${doneThisWeek} / ${goal}권`;
  document.getElementById("weekGoalFill").style.width = Math.min(100, doneThisWeek/goal*100) + "%";
  const gi = document.getElementById("weeklyGoalInput");
  if(document.activeElement !== gi) gi.value = goal;

  // streak + stickers (last 14 days)
  const st = calcStreak();
  document.getElementById("streakText").textContent = st.n > 0
    ? `${st.n}일 연속${st.readToday ? "" : " · 오늘 읽으면 +1"}`
    : "오늘 첫 독서를 시작해 보세요";
  let sh = "";
  for(let i=13;i>=0;i--){
    const d = new Date(today); d.setDate(d.getDate()-i);
    const on = days.has(dkey(d));
    const readMin=readingMinutesOn(dkey(d));
    sh += `<div class="sticker-cell"><div class="sticker ${on ? "on c"+(d.getDate()%5) : ""} ${i===0 ? "today" : ""}" data-tooltip="${escapeAttr(`${dkey(d)}\n${on?readMin+tr("분")+" · "+tr("독서"):tr("기록 없음")}`)}">${on ? "★" : ""}</div><span>${i===0 ? "오늘" : d.getDate()}</span></div>`;
  }
  document.getElementById("stickerRow").innerHTML = sh;

  // bookmarks: 1 per 3 reading days; fade (never deleted) after skipping days
  const readDays = days.size;
  const earned = Math.floor(readDays / 3);
  let missed = 0;
  if(readDays > 0){
    const last = [...days].sort().pop();
    missed = Math.max(0, daysDiff(last, todayKey) - 1);  // 하루는 쉬어도 OK
  }
  const colors = ["#C9974B","#5E9179","#6FB2F2","#E08575","#A58BD6","#D9B86A","#7FB7A4"];
  const showN = Math.min(earned, 30);
  let bm = earned > showN ? `<span class="bm-more">+${earned-showN}</span>` : "";
  let dormant = 0;
  for(let k = earned-showN; k < earned; k++){
    const j = earned-1-k;
    const p = Math.min(1, Math.max(0, (missed - 2*j) / 3));
    if(p >= 1) dormant++;
    const asleep = p >= 1;
    bm += `<svg class="bm" width="18" height="34" viewBox="0 0 18 34" style="opacity:${asleep ? 0.6 : 1 - 0.75*p}"><path d="M2 1h14v32l-7-6-7 6z" fill="${asleep ? "none" : colors[k%colors.length]}" stroke="${asleep ? "var(--line-strong)" : "none"}" stroke-width="1.5" stroke-dasharray="${asleep ? "3 2" : "0"}"/></svg>`;
  }
  document.getElementById("bookmarkRow").innerHTML = bm || `<span class="rc-sub">아직 없어요</span>`;
  document.getElementById("bookmarkText").textContent = `${earned}개`;
  document.getElementById("bookmarkNote").textContent =
    earned === 0 ? `독서한 날(타이머 기록) 3일마다 책갈피 1개를 받아요. 다음 책갈피까지 ${3 - (readDays % 3)}일.`
    : missed === 0 ? "책갈피가 모두 선명해요. 이대로 이어가 봐요!"
    : `${missed}일째 쉬는 중이라 책갈피가 흐려지고 있어요${dormant ? ` (잠든 책갈피 ${dormant}개)` : ""}. 사라지진 않아요 — 오늘 읽으면 모두 선명하게 돌아와요.`;

  // badges
  const total = totalReadCount();
  const goalNow = getGoal(total);
  const milestones = [1,5,10,25,50];
  for(let m=100; m<=goalNow; m+=50) milestones.push(m);
  const early = earlyBadges();
  const sumDays = early.reduce((a,e)=>a+e.days, 0);
  let bh = milestones.map(m => `<div class="badge ${total>=m ? "on" : "locked"}"><div class="badge-icon">${total>=m ? "🏅" : "🔒"}</div><b>${m}권</b><span>${m===1 ? "첫 완독" : "달성"}</span></div>`).join("");
  bh += early.map(e => `<div class="badge on early"><div class="badge-icon">⚡</div><b>${e.days}일 앞당김</b><span>${escapeHtml(e.title||"")}</span></div>`).join("");
  document.getElementById("badgeRow").innerHTML = bh;
  document.getElementById("badgeText").textContent = early.length ? `목표에 총 ${sumDays}일 가까워졌어요` : `${milestones.filter(m=>total>=m).length}개 획득`;
}

function openRetro(){
  const years = new Set([String(new Date().getFullYear())]);
  data.books.forEach(b => { if(b.status === "done" && b.endDate) years.add(b.endDate.slice(0,4)); });
  const sel = document.getElementById("retroYear");
  sel.innerHTML = [...years].sort().reverse().map(y => `<option value="${y}">${y}년</option>`).join("");
  renderRetro(sel.value);
  document.getElementById("retroModal").classList.remove("hidden");
}
function renderRetro(year){
  document.getElementById("retroTitle").textContent = `${year} 독서 회고`;
  const body = document.getElementById("retroBody");
  const done = data.books.filter(b => b.status === "done" && b.endDate && b.endDate.startsWith(year));
  if(done.length === 0){
    body.innerHTML = `<p class="empty-hint sans">${year}년에 완독한 책이 아직 없어요.</p>`;
    return;
  }
  const minutes = data.books.flatMap(b=>b.sessions||[]).filter(s=>s.date.startsWith(year)).reduce((a,s)=>a+s.minutes, 0);
  const pages = done.reduce((a,b)=>a+(b.totalPages||0), 0);
  const maxRating = Math.max(0, ...done.map(b=>b.rating||0));
  const best = maxRating > 0 ? done.filter(b=>(b.rating||0) === maxRating).slice(0,3) : [];
  const gc = {}; done.forEach(b => (b.genres||[]).forEach(g => { gc[g] = (gc[g]||0)+1; }));
  const topG = Object.entries(gc).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const quotes = done.flatMap(b => (b.quotes||[]).map(q => ({q,b}))).sort((x,y)=>(y.b.rating||0)-(x.b.rating||0)).slice(0,5);
  const takeaways = done.filter(b => b.takeaway);
  const monthNames = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  const monthCounts = monthlyDoneCounts(year);
  const bestIdx = monthCounts.indexOf(Math.max(...monthCounts));
  body.innerHTML = `
    <div class="retro-grid">
      <div class="retro-stat"><b>${done.length}</b><span>완독</span></div>
      <div class="retro-stat"><b>${Math.round(minutes/60*10)/10}</b><span>독서 시간</span></div>
      <div class="retro-stat"><b>${pages.toLocaleString()}</b><span>읽은 쪽수</span></div>
    </div>
    <div class="retro-sec"><h4>월별 완독 · 가장 많이 읽은 달 ${monthNames[bestIdx]} (${monthCounts[bestIdx]}권)</h4>
      <div class="bar-chart retro-month-chart">${barChartHtml(monthNames.map((m,i)=>({label:m.replace("월",""), value:monthCounts[i]})))}</div>
    </div>
    <div class="retro-sec"><h4>최고 평점</h4>${best.length
      ? best.map(b=>`<div class="retro-line"><span class="rl-title">${escapeHtml(b.title)}</span><span class="stars-mini">${starsHtml(b.rating)}</span></div>`).join("")
      : `<p class="rc-note">별점을 남기면 여기에 보여요.</p>`}</div>
    <div class="retro-sec"><h4>가장 많이 읽은 장르</h4>${topG.length
      ? topG.map(([g,c])=>`<span class="tag-chip">${escapeHtml(g)} · ${c}권</span>`).join(" ")
      : `<p class="rc-note">장르 태그를 달면 여기에 보여요.</p>`}</div>
    <div class="retro-sec"><h4>인상 깊은 문구</h4>${quotes.length
      ? quotes.map(({q,b})=>`<div class="quote-item">“${escapeHtml(q.text)}”<div class="qpage-tag">${escapeHtml(b.title)}${q.page ? " · p."+q.page : ""}</div></div>`).join("")
      : `<p class="rc-note">문구를 기록하면 여기에 모여요.</p>`}</div>
    <div class="retro-sec"><h4>이 책들에서 얻은 것</h4>${takeaways.length
      ? takeaways.map(b=>`<div class="retro-line"><span class="rl-title">${escapeHtml(b.title)}</span><span>${escapeHtml(b.takeaway)}</span></div>`).join("")
      : `<p class="rc-note">책 상세 화면에서 "이 책에서 얻은 것"을 적으면 여기에 모여요.</p>`}</div>
  `;
}

function totalReadCount(){
  return (data.baselineBooks||0) + data.books.filter(b=>b.status==="done").length;
}
function getGoal(total){
  // 100 -> 200 -> 300 ... escalates once the previous block is fully reached
  let g = 100;
  while(total >= g) g += 100;
  return g;
}
function encodeShare(obj){
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function decodeShare(str){
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}
function normalizeSharedSnapshot(raw){
  const src=raw && typeof raw==="object" ? raw : {};
  return {
    ownerName:safeText(src.ownerName,200)||"이름 없는 서재",
    totalCount:Math.max(0,Number.parseInt(src.totalCount)||0),
    goal:Math.max(1,Number.parseInt(src.goal)||100),
    books:Array.isArray(src.books) ? src.books.slice(0,1000).map(normalizeBook) : []
  };
}
function buildShareSnapshot(){
  const publicBooks = data.books.filter(b => b.isPublic).map(b => ({
    title:b.title, author:b.author, publisher:b.publisher, translator:b.translator,
    status:b.status, currentPage:b.currentPage, totalPages:b.totalPages,
    startDate:b.startDate, endDate:b.endDate, rating:b.rating||0, genres:b.genres||[],
    quotes:b.quotes||[], review:b.review||"", takeaway:b.takeaway||"", coverImage:b.coverImage||null,
    sessions:(b.sessions||[]).reduce((a,s)=>a+s.minutes,0)
  }));
  return {
    ownerName: data.ownerName || "이름 없는 서재",
    totalCount: totalReadCount(),
    goal: getGoal(totalReadCount()),
    books: publicBooks
  };
}
function refreshShareLink(){
  data.ownerName = document.getElementById("ownerNameInput").value.trim() || data.ownerName || "";
  const snap = buildShareSnapshot();
  const code = encodeShare(snap);
  const url = location.origin + location.pathname + "#shared=" + code;
  document.getElementById("shareLinkArea").value = url;
  const lengthNote = url.length > 8000 ? " · ⚠ 링크가 길어요. 메신저/QR 공유가 불안정할 수 있어요." : "";
  document.getElementById("shareCopyStatus").textContent = `공개된 책 ${snap.books.length}권 포함${lengthNote}`;
}
function openShareModal(){
  document.getElementById("ownerNameInput").value = data.ownerName || "";
  refreshShareLink();
  document.getElementById("shareModal").classList.remove("hidden");
}

function renderSharedCard(b, idx){
  const pct = b.totalPages ? Math.max(0,Math.min(100,Math.round(b.currentPage/b.totalPages*100))) : 0;
  const statusColor = STATUS_COLORS[b.status] || STATUS_COLORS.not_started;
  const coverInner = b.coverImage
    ? `<img class="cover-img" src="${b.coverImage}" alt="" /><span class="ring-badge">${ringSvg(pct,40,4,"rgba(255,255,255,0.35)","#ffffff","#ffffff")}</span>`
    : ringSvg(pct, 64, 6, "rgba(255,255,255,0.25)", "#ffffff", "#ffffff");
  return `
    <div class="card" data-shared-idx="${idx}">
      <div class="card-cover" style="background:${statusColor}">${coverInner}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(b.title||"제목 없음")}</div>
        ${b.author ? `<div class="card-author sans">${escapeHtml(b.author)}</div>` : ""}
        <div class="card-props">
          <span class="pill pill-${b.status}">${statusLabel(b.status)}</span>
          ${b.rating ? `<span class="stars-mini">${starsHtml(b.rating)}</span>` : ""}
        </div>
        ${(b.genres&&b.genres.length) ? `<div class="genre-tags">${b.genres.slice(0,3).map(g=>`<span class="genre-tag">${escapeHtml(g)}</span>`).join("")}</div>` : ""}
      </div>
    </div>`;
}

function renderSharedBookDetail(b){
  const overlay = document.getElementById("sharedBookOverlay");
  const quotes = (b.quotes||[]).length
    ? b.quotes.map(q=>`<div class="quote-item">“${escapeHtml(q.text)}”${q.page?`<div class="qpage-tag">p.${q.page}</div>`:""}</div>`).join("")
    : `<p class="empty-hint sans">기록된 문구가 없어요.</p>`;
  overlay.innerHTML = `
    <div class="shared-detail-box">
      <button class="back-btn sans" id="sharedBackBtn">← 서재로</button>
      <h1 class="shared-detail-title">${escapeHtml(b.title||"제목 없음")}</h1>
      <div class="book-meta-edit" style="pointer-events:none;">
        ${b.author ? `<div class="meta-row"><span class="meta-label sans">작가</span><span>${escapeHtml(b.author)}</span></div>` : ""}
        ${b.publisher ? `<div class="meta-row"><span class="meta-label sans">출판사</span><span>${escapeHtml(b.publisher)}</span></div>` : ""}
        ${b.translator ? `<div class="meta-row"><span class="meta-label sans">옮긴이</span><span>${escapeHtml(b.translator)}</span></div>` : ""}
      </div>
      <p class="rc-note">${statusLabel(b.status)} · ${b.totalPages?Math.round(b.currentPage/b.totalPages*100):0}% ${b.startDate?(" · "+fmtDate(b.startDate)):""}${b.endDate?(" → "+fmtDate(b.endDate)):""} · 누적 ${b.sessions||0}분</p>
      ${b.takeaway ? `<div class="detail-section"><h3 class="sans">이 책에서 얻은 것</h3><p>${escapeHtml(b.takeaway)}</p></div>` : ""}
      <div class="detail-section"><h3 class="sans">좋았던 문구</h3>${quotes}</div>
      <div class="detail-section"><h3 class="sans">독후감</h3><p class="r-review">${b.review ? escapeHtml(b.review).replace(/\n/g,"<br>") : `<span class="empty-hint">작성된 독후감이 없어요.</span>`}</p></div>
    </div>`;
  overlay.classList.remove("hidden");
  document.getElementById("sharedBackBtn").addEventListener("click", ()=> overlay.classList.add("hidden"));
}

function tryRenderSharedFromHash(){
  const hash = location.hash;
  if(!hash.startsWith("#shared=")) return false;
  try{
    const snap = normalizeSharedSnapshot(decodeShare(hash.slice(8)));
    document.getElementById("sharedOwnerName").textContent = snap.ownerName + "님의 서재";
    document.getElementById("sharedTotalText").textContent = `전체 ${snap.totalCount}권 읽음 · 목표 ${snap.goal}권 · 그중 공개된 책 ${snap.books.length}권`;
    const grid = document.getElementById("sharedGrid");
    grid.innerHTML = snap.books.length
      ? snap.books.map((b,i)=>renderSharedCard(b,i)).join("")
      : `<p class="empty-hint sans">아직 공개된 책이 없어요.</p>`;
    grid.querySelectorAll("[data-shared-idx]").forEach(el=>{
      el.addEventListener("click", ()=> renderSharedBookDetail(snap.books[parseInt(el.dataset.sharedIdx)]));
    });
    document.getElementById("homeScreen").classList.add("hidden");
    document.getElementById("library").classList.add("hidden");
    document.getElementById("sharedScreen").classList.remove("hidden");
    return true;
  }catch(e){
    console.error("공유 링크를 읽지 못했어요", e);
    return false;
  }
}

function renderTodayDashboard(){
  const key=todayStr(),score=mboDayScore(key);document.getElementById("todayDashboardDate").textContent=fmtDate(key);document.getElementById("todayDashboardScore").textContent=score.rate+"%";document.getElementById("todayDashboardFill").style.width=score.rate+"%";
  const left=Math.max(0,score.total-score.success);document.getElementById("todayDashboardMessage").textContent=score.total>0&&left===0?tr("오늘 모든 목표를 채웠어요! 🎉"):left===1?tr("오늘 한 가지 남았어요."):`${tr("오늘 남은 목표")} ${left}${tr("개")}`;
  const items=[],rm=readingMinutesOn(key);items.push({id:"reading",icon:"📚",name:tr("독서"),done:rm>0,detail:rm>0?`${rm}${tr("분")}`:tr("아직 기록 없음")});
  (data.routines||[]).forEach(r=>{const g=ensureRoutineGoalShape(r);if(!g.configured||(g.startedAt&&key<g.startedAt))return;const e=routineEntry(r,key);items.push({id:r.id,icon:r.icon,name:tr(r.name),done:routineSuccess(r,e),detail:e?routineValueLabel(r,e):tr("아직 기록 없음")});});
  const box=document.getElementById("todayDashboardItems");box.dataset.count=String(Math.min(items.length,7));box.innerHTML=items.map(x=>`<button class="today-dashboard-item ${x.done?"done":""}" data-today-goal="${escapeAttr(x.id)}" type="button"><span class="tdi-main"><span>${x.icon}</span><span><span class="tdi-name">${escapeHtml(x.name)}</span><span class="tdi-detail">${escapeHtml(x.detail)}</span></span></span><span class="tdi-state">${x.done?"✓":"○"}</span></button>`).join("");box.querySelectorAll("[data-today-goal]").forEach(btn=>btn.onclick=()=>btn.dataset.todayGoal==="reading"?showHome():showBridge(btn.dataset.todayGoal));
}
function renderMboMain(){
  const grid=document.getElementById("mboGrid"),totalBooks=totalReadCount(),todayKey=dkey(new Date()),todayScore=mboDayScore(todayKey);document.getElementById("mboTodayScore").textContent=`${tr("오늘")} ${todayScore.success}/${todayScore.total} · ${todayScore.rate}%`;renderTodayDashboard();renderMboOverview();
  let html=`<div class="mbo-card" data-mbo="reading"><div class="mbo-icon">📚</div><div class="mbo-name">${tr("독서")}</div><div class="mbo-sub">${tr("총")} ${totalBooks}${tr("권")} · ${readingSuccessOn(todayKey)?tr("오늘 기록 ✓"):tr("오늘은 아직")}</div></div>`;
  (data.routines||[]).forEach(r=>{const streak=routineStreak(r),todayOk=routineSuccess(r,routineEntry(r,todayKey)),g=ensureRoutineGoalShape(r);const sub=g.configured?`${routineWeekSuccessCount(r)}/${g.weeklyTarget}${tr("회")} · ${todayOk?tr("오늘 ✓"):(streak?`${streak}${tr("일 연속")}`:tr("오늘은 아직"))}`:tr("목표를 아직 정하지 않았어요 →");html+=`<div class="mbo-card ${g.configured?"":"needs-goal"}" data-mbo="${escapeAttr(r.id)}"><div class="mbo-icon">${r.icon}</div><div class="mbo-name">${escapeHtml(tr(r.name))}</div><div class="mbo-sub">${sub}</div></div>`;});
  grid.dataset.count=String(Math.min(1+(data.routines||[]).length,7));grid.innerHTML=html;grid.querySelectorAll("[data-mbo]").forEach(el=>el.addEventListener("click",()=>{const id=el.dataset.mbo;if(id==="reading")showHome();else showBridge(id);}));
  if(window.I18N && window.I18N.getLanguage && window.I18N.getLanguage()!=="ko") requestAnimationFrame(()=>window.I18N.refresh && window.I18N.refresh());
}

function routineMiniHeatmapHtml(r, days){
  const today = new Date(); today.setHours(0,0,0,0);
  let cells = "";
  for(let i=days-1;i>=0;i--){
    const d = new Date(today); d.setDate(d.getDate()-i);
    const ok = routineSuccess(r, routineEntry(r, dkey(d)));
    cells += `<div class="heatmap-cell ${ok?"l3":""}" data-tooltip="${escapeAttr(routineTooltipText(r,dkey(d)))}"></div>`;
  }
  return cells;
}

function renderBridge(routineId){
  const r = getRoutine(routineId);
  if(!r) return;
  const g=ensureRoutineGoalShape(r);
  const streak = routineStreak(r);
  const weekCount=routineWeekSuccessCount(r);
  const rate30=routineLastNDaysRate(r,30);
  document.getElementById("bridgeEyebrow").textContent = "나의 생활 MBO";
  document.getElementById("bridgeTitle").textContent = `${r.icon} ${r.name}`;
  document.getElementById("bridgeStreak").textContent = g.configured
    ? (streak > 0 ? `${streak}일 연속 이어가는 중` : `이번 주 ${weekCount}/${g.weeklyTarget}회 달성`)
    : "아직 구체적인 목표가 없어도 괜찮아요. 여기서 하나씩 정할 수 있어요.";
  document.getElementById("bridgeHeatmap").innerHTML = routineMiniHeatmapHtml(r, 84);
  document.getElementById("bridgeProgressStats").innerHTML = `
    <div class="bridge-stat"><b>${streak}</b><span>연속일</span></div>
    <div class="bridge-stat"><b>${g.configured?`${weekCount}/${g.weeklyTarget}`:"—"}</b><span>이번 주</span></div>
    <div class="bridge-stat"><b>${g.configured?rate30+"%":"—"}</b><span>최근 30일</span></div>`;

  document.getElementById("bridgeGoalStatus").textContent = g.configured ? "설정됨" : "아직 없음";
  document.getElementById("bridgeGoalBody").innerHTML = g.configured ? `
    <div class="goal-summary-main">${escapeHtml(g.statement || `${r.name}을(를) 꾸준히 하기`)}</div>
    ${g.reason?`<p class="goal-reason">“${escapeHtml(g.reason)}”</p>`:""}
    <div class="goal-meta-row"><span>주 ${g.weeklyTarget}회</span>${r.kind==="time"?`<span>기준 ${r.goalTime}</span>`:""}<span>${g.startedAt?fmtDate(g.startedAt)+"부터":""}</span></div>
    <button class="secondary goal-edit-btn" id="openGoalSetupBtn" type="button">목표 수정</button>${r.isCustom?`<div class="custom-delete-row"><button class="ghost" id="deleteCustomGoalBtn" type="button">이 목표 삭제</button></div>`:""}` : `
    <p class="goal-empty-title">이 목표를 내 생활에 맞게 구체화해 볼까요?</p>
    <p class="rc-note">세 가지만 정하면 돼요. 무엇을 만들고 싶은지 → 왜 중요한지 → 일주일에 몇 번 할지.</p>
    <button class="home-cta" id="openGoalSetupBtn" type="button">3단계로 목표 만들기 →</button>`;
  document.getElementById("openGoalSetupBtn").onclick = ()=> openGoalSetup(routineId,1);
  const deleteCustom=document.getElementById("deleteCustomGoalBtn"); if(deleteCustom) deleteCustom.onclick=async()=>{if(!confirm("이 목표와 기록을 모두 삭제할까요? 되돌릴 수 없어요."))return;data.routines=(data.routines||[]).filter(x=>x.id!==r.id);await saveData();showMbo();};
  document.getElementById("goalSetupCloseBtn").onclick = ()=> document.getElementById("goalSetupCard").classList.add("hidden");

  document.getElementById("bridgeMotivation").innerHTML = `<span class="motivation-kicker">오늘의 한마디</span><strong>${escapeHtml(motivationText(r))}</strong>`;

  const todayKey = dkey(new Date());
  const entry = routineEntry(r, todayKey);
  document.getElementById("bridgeTodayLabel").textContent = todayKey;
  const widget = document.getElementById("bridgeWidget");

  if(r.kind === "check"){
    const done = !!(entry && entry.done);
    widget.innerHTML = `<button class="home-cta" id="routineActionBtn" style="${done?"background:var(--cloth);border-color:var(--cloth);":""}">${done ? "오늘 완료함 ✓" : "오늘 완료로 표시"}</button>`;
    document.getElementById("routineActionBtn").addEventListener("click", async ()=>{
      upsertRoutineEntry(routineId, todayKey, { done: !done });
      await saveData(); renderBridge(routineId);
    });
  }else if(r.kind === "note"){
    widget.innerHTML = `
      <textarea id="routineNoteInput" class="review-area" style="min-height:90px;" placeholder="오늘 기록을 남겨보세요">${escapeHtml((entry&&entry.note)||"")}</textarea>
      <div class="btn-row" style="justify-content:flex-end; margin-top:10px;"><button id="routineActionBtn">저장</button></div>`;
    document.getElementById("routineActionBtn").addEventListener("click", async ()=>{
      const val = document.getElementById("routineNoteInput").value.trim();
      upsertRoutineEntry(routineId, todayKey, { note: val });
      await saveData(); renderBridge(routineId);
    });
  }else if(r.kind === "time"){
    widget.innerHTML = `
      <div class="fetch-row" style="align-items:center;">
        <input type="time" id="routineTimeInput" value="${(entry&&entry.time)||""}" style="width:auto;" />
        <span class="rc-sub">${g.configured?`내 기준 ${r.goalTime}`:`추천 기준 ${r.goalTime}`}</span>
      </div>
      <div class="btn-row" style="justify-content:flex-end; margin-top:10px;"><button id="routineActionBtn">저장</button></div>
      ${entry && entry.time ? `<p class="rc-note">${routineSuccess(r,entry) ? "🎉 오늘 기준을 지켰어요!" : "오늘은 기준보다 늦었어요. 기록한 것만으로도 흐름을 이어갈 수 있어요."}</p>` : ""}`;
    document.getElementById("routineActionBtn").addEventListener("click", async ()=>{
      const val = document.getElementById("routineTimeInput").value;
      if(!val) return;
      upsertRoutineEntry(routineId, todayKey, { time: val });
      await saveData(); renderBridge(routineId);
    });
  }else if(r.kind === "number"){
    widget.innerHTML=`<div class="fetch-row" style="align-items:center;"><input type="number" step="any" id="routineNumberInput" value="${entry&&Number.isFinite(Number(entry.value))?entry.value:""}" style="width:160px;" /><span class="rc-sub">${tr("목표")} ${r.targetMode==="max"?"≤":"≥"} ${r.targetValue??"—"}${r.unit?" "+escapeHtml(r.unit):""}</span></div><div class="btn-row" style="justify-content:flex-end;margin-top:10px;"><button id="routineActionBtn">${tr("저장")}</button></div>`;
    document.getElementById("routineActionBtn").addEventListener("click",async()=>{const val=Number(document.getElementById("routineNumberInput").value);if(!Number.isFinite(val))return;upsertRoutineEntry(routineId,todayKey,{value:val});await saveData();renderBridge(routineId);});
  }
}

let goalSetupDraft = null;
function openGoalSetup(routineId, step=1){
  const r=getRoutine(routineId); if(!r) return;
  const g=ensureRoutineGoalShape(r);
  if(!goalSetupDraft || goalSetupDraft.routineId!==routineId){
    goalSetupDraft={routineId, statement:g.statement||"", reason:g.reason||"", weeklyTarget:g.weeklyTarget||3, goalTime:r.goalTime||"", targetValue:r.targetValue};
  }
  document.getElementById("goalSetupCard").classList.remove("hidden");
  renderGoalSetupStep(step);
}
function renderGoalSetupStep(step){
  const d=goalSetupDraft, r=getRoutine(d.routineId); if(!r) return;
  document.getElementById("goalStepLabel").textContent=`${step} / 3`;
  const box=document.getElementById("goalSetupBody");
  if(step===1){
    box.innerHTML=`<h3>무엇을 만들고 싶나요?</h3><p class="rc-note">거창한 성과보다, 반복하고 싶은 생활의 모습을 한 문장으로 적어보세요.</p><input class="goal-setup-input" id="goalStatementInput" value="${escapeHtml(d.statement)}" placeholder="예: 아침 운동을 생활의 기본으로 만들기"><div class="goal-step-actions"><span></span><button id="goalNextBtn">다음 →</button></div>`;
    document.getElementById("goalNextBtn").onclick=()=>{ d.statement=document.getElementById("goalStatementInput").value.trim(); renderGoalSetupStep(2); };
  }else if(step===2){
    box.innerHTML=`<h3>왜 이걸 하고 싶나요?</h3><p class="rc-note">흔들릴 때 다시 볼 수 있는 이유를 짧게 남겨두면 좋아요.</p><textarea class="review-area" id="goalReasonInput" style="min-height:100px;" placeholder="예: 하루를 덜 급하게 시작하고 싶어서">${escapeHtml(d.reason)}</textarea><div class="goal-step-actions"><button class="secondary" id="goalPrevBtn">← 이전</button><button id="goalNextBtn">다음 →</button></div>`;
    document.getElementById("goalPrevBtn").onclick=()=>renderGoalSetupStep(1);
    document.getElementById("goalNextBtn").onclick=()=>{ d.reason=document.getElementById("goalReasonInput").value.trim(); renderGoalSetupStep(3); };
  }else{
    box.innerHTML=`<h3>현실적으로 얼마나 자주 할까요?</h3><p class="rc-note">처음에는 조금 쉬운 기준이 좋습니다. 달성한 경험을 쌓은 뒤 언제든 높일 수 있어요.</p><div class="goal-frequency-row"><span>일주일에</span><input type="number" id="goalWeeklyInput" min="1" max="7" value="${d.weeklyTarget}"><span>번</span></div>${r.kind==="time"?`<div class="goal-frequency-row"><span>${r.id==="wake_early"?"기상":r.id==="sleep_early"?"취침":"시간"} 기준</span><input type="time" id="goalTimeSetupInput" value="${d.goalTime||r.goalTime}"></div>`:""}${r.kind==="number"?`<div class="goal-frequency-row"><span>숫자 목표</span><input type="number" step="any" id="goalNumberTargetInput" value="${d.targetValue??r.targetValue??""}"><span>${escapeHtml(r.unit||"")}</span></div>`:""}<div class="goal-step-actions"><button class="secondary" id="goalPrevBtn">← 이전</button><button id="goalSaveBtn">이 목표로 시작하기</button></div>`;
    document.getElementById("goalPrevBtn").onclick=()=>renderGoalSetupStep(2);
    document.getElementById("goalSaveBtn").onclick=async()=>{
      d.weeklyTarget=Math.max(1,Math.min(7,parseInt(document.getElementById("goalWeeklyInput").value)||3));
      if(r.kind==="time"){ const t=document.getElementById("goalTimeSetupInput").value; if(t) r.goalTime=t; }
      if(r.kind==="number"){ const v=Number(document.getElementById("goalNumberTargetInput").value); if(Number.isFinite(v)){r.targetValue=v; d.targetValue=v;} }
      r.goal={configured:true, statement:d.statement||`${r.name}을(를) 꾸준히 하기`, reason:d.reason, weeklyTarget:d.weeklyTarget, startedAt:r.goal&&r.goal.startedAt?r.goal.startedAt:todayStr()};
      goalSetupDraft=null; await saveData(); document.getElementById("goalSetupCard").classList.add("hidden"); renderBridge(r.id);
    };
  }
}

function routineYearsWithData(r){
  const years=new Set([new Date().getFullYear()]);
  const g=ensureRoutineGoalShape(r);
  if(g.startedAt) years.add(parseInt(g.startedAt.slice(0,4)));
  (r.entries||[]).forEach(e=>{ if(e.date) years.add(parseInt(e.date.slice(0,4))); });
  return [...years].filter(Boolean).sort((a,b)=>b-a);
}
function routineSuccessCountBetween(r,start,end){
  let n=0;
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
    if(routineSuccess(r,routineEntry(r,dkey(d)))) n++;
  }
  return n;
}
function routineWeekStat(r,refDate){
  const g=ensureRoutineGoalShape(r);
  const start=startOfWeek(refDate), end=new Date(start); end.setDate(end.getDate()+6);
  const count=routineSuccessCountBetween(r,start,end);
  const target=Math.max(1,g.weeklyTarget||1);
  return {start,end,count,target,rate:Math.min(100,Math.round(count/target*100))};
}
function routineMonthWeekAverage(r,year,month){
  const g=ensureRoutineGoalShape(r);
  const first=new Date(year,month,1), last=new Date(year,month+1,0);
  const today=new Date(); today.setHours(0,0,0,0);
  const effectiveLast=last>today?today:last;
  if(first>effectiveLast) return {avg:0, weeks:0, success:0, target:g.weeklyTarget||1, rate:0};
  let weekStart=startOfWeek(first), totalSuccess=0, weekCount=0;
  while(weekStart<=effectiveLast){
    const weekEnd=new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
    const segStart=weekStart<first?first:weekStart;
    const segEnd=weekEnd>effectiveLast?effectiveLast:weekEnd;
    totalSuccess+=routineSuccessCountBetween(r,segStart,segEnd);
    weekCount++;
    weekStart=new Date(weekStart); weekStart.setDate(weekStart.getDate()+7);
  }
  const avg=weekCount?Math.round((totalSuccess/weekCount)*10)/10:0;
  const target=Math.max(1,g.weeklyTarget||1);
  return {avg,weeks:weekCount,success:totalSuccess,target,rate:Math.min(100,Math.round(avg/target*100))};
}
function renderRoutineYearGrid(r,year){
  const jan1=new Date(year,0,1),start=new Date(jan1);start.setDate(start.getDate()-jan1.getDay());const dec31=new Date(year,11,31),today=new Date();today.setHours(0,0,0,0);const g=ensureRoutineGoalShape(r);let cells='',i=0;const monthAt={};
  for(const d=new Date(start);d<=dec31;d.setDate(d.getDate()+1),i++){if(d<jan1){cells+=`<div class="heatmap-cell empty"></div>`;continue;}if(d.getDate()===1)monthAt[Math.floor(i/7)]=(d.getMonth()+1)+'월';const key=dkey(d),future=d>today,before=g.startedAt&&key<g.startedAt;if(future||before){cells+=`<div class="heatmap-cell mbo-unavailable" data-tooltip="${escapeAttr(key+" · "+tr(future?"미래 날짜":"목표 시작 전"))}"></div>`;}else{const e=routineEntry(r,key),ok=routineSuccess(r,e);cells+=`<div class="heatmap-cell ${ok?'l3':''}" data-tooltip="${escapeAttr(routineTooltipText(r,key))}"></div>`;}}
  const cols=Math.ceil(i/7);let months='';for(let c=0;c<cols;c++)months+=`<span>${monthAt[c]||''}</span>`;document.getElementById('routineDetailHeatmap').innerHTML=cells;document.getElementById('routineYearMonths').innerHTML=months;document.getElementById('routineYearGridTitle').textContent=`${year}년 전체 기록`;
}
function renderRoutineMonthChart(r,year){
  const box=document.getElementById('routineMonthChart'),sub=document.getElementById('routineMonthChartSub');let vals=[],max=1;
  if(r.kind==="time"){vals=Array.from({length:12},(_,m)=>({value:routineMonthPerformance(r,year,m).rate,label:(m+1)+tr("월")}));max=100;if(sub)sub.textContent=tr("목표 시각 달성률");}
  else if(r.kind==="number"){vals=Array.from({length:12},(_,m)=>{const v=routineAverageNumberBetween(r,new Date(year,m,1),new Date(year,m+1,0));return {value:v??0,label:(m+1)+tr("월")};});max=Math.max(1,...vals.map(v=>v.value),Number(r.targetValue)||0);if(sub)sub.textContent=tr("월 평균 기록값");}
  else{vals=Array.from({length:12},(_,m)=>({value:routineMonthWeekAverage(r,year,m).avg,label:(m+1)+tr("월")}));max=Math.max(1,...vals.map(v=>v.value),ensureRoutineGoalShape(r).weeklyTarget||1);if(sub)sub.textContent=tr("주당 평균 달성 횟수");}
  box.innerHTML=vals.map((v,m)=>{const h=Math.max(v.value>0?5:2,Math.round(v.value/max*100));const display=r.kind==="time"?`${v.value}%`:r.kind==="number"?`${v.value}${r.unit?" "+escapeHtml(r.unit):""}`:v.value;return `<div class="routine-month-col" data-tooltip="${escapeAttr(`${year}${tr("년")} ${m+1}${tr("월")} · ${display}`)}"><div class="routine-month-val">${display}</div><div class="routine-month-track"><div class="routine-month-bar" style="height:${h}%"></div></div><div class="routine-month-label">${v.label}</div></div>`;}).join('');
}

let routineDetailYear=null;
function routinePeriodCardsHtml(r){
  const now=new Date();now.setHours(0,0,0,0);const thisStart=startOfWeek(now),thisEnd=new Date(thisStart);thisEnd.setDate(thisEnd.getDate()+6);const prevEnd=new Date(thisStart);prevEnd.setDate(prevEnd.getDate()-1);const prevStart=new Date(prevEnd);prevStart.setDate(prevStart.getDate()-6);const monthStart=new Date(now.getFullYear(),now.getMonth(),1),monthEnd=new Date(now.getFullYear(),now.getMonth()+1,0);const g=ensureRoutineGoalShape(r),perf=routineTargetPerformanceBetween(r,monthStart,monthEnd);
  if(r.kind==="time"){const a1=routineAverageTimeBetween(r,thisStart,thisEnd),a0=routineAverageTimeBetween(r,prevStart,prevEnd),w=routineTargetPerformanceBetween(r,thisStart,thisEnd);return `<div class="period-stat-card"><span>${tr("이번 주 평균")}</span><b>${minutesToTime(a1)}</b><em>${tr("목표")} ${r.goalTime||"—"}</em></div><div class="period-stat-card"><span>${tr("지난주 평균")}</span><b>${minutesToTime(a0)}</b><em></em></div><div class="period-stat-card"><span>${tr("이번 주 달성률")}</span><b>${w.rate}%</b><em>${w.success}${tr("일 달성")}</em></div><div class="period-stat-card"><span>${tr("이번 달 달성률")}</span><b>${perf.rate}%</b><em>${perf.success}${tr("일 달성")}</em></div>`;}
  if(r.kind==="number"){const a1=routineAverageNumberBetween(r,thisStart,thisEnd),a0=routineAverageNumberBetween(r,prevStart,prevEnd),am=routineAverageNumberBetween(r,monthStart,monthEnd),unit=r.unit?` ${escapeHtml(r.unit)}`:"";return `<div class="period-stat-card"><span>${tr("이번 주 평균")}</span><b>${a1==null?"—":a1+unit}</b><em>${tr("목표")} ${r.targetMode==="max"?"≤":"≥"} ${r.targetValue??"—"}${unit}</em></div><div class="period-stat-card"><span>${tr("지난주 평균")}</span><b>${a0==null?"—":a0+unit}</b><em></em></div><div class="period-stat-card"><span>${tr("이번 달 평균")}</span><b>${am==null?"—":am+unit}</b><em>${perf.success}${tr("일 달성")}</em></div><div class="period-stat-card"><span>${tr("이번 달 달성률")}</span><b>${perf.rate}%</b><em>${tr("목표 기준")}</em></div>`;}
  const thisWeek=routineWeekStat(r,now),prevRef=new Date(now);prevRef.setDate(prevRef.getDate()-7);const lastWeek=routineWeekStat(r,prevRef);let fourSum=0;for(let i=0;i<4;i++){const d=new Date(now);d.setDate(d.getDate()-7*i);fourSum+=routineWeekStat(r,d).count;}const fourAvg=Math.round((fourSum/4)*10)/10,monthStat=routineMonthWeekAverage(r,now.getFullYear(),now.getMonth());
  return `<div class="period-stat-card"><span>${tr("이번 주")}</span><b>${thisWeek.count}/${thisWeek.target}${tr("회")}</b><em>${thisWeek.rate}%</em></div><div class="period-stat-card"><span>${tr("지난주")}</span><b>${lastWeek.count}/${lastWeek.target}${tr("회")}</b><em>${lastWeek.rate}%</em></div><div class="period-stat-card"><span>${tr("최근 4주 평균")}</span><b>${fourAvg}${tr("회/주")}</b><em>${r.kind==="note"?tr("작성"):tr("달성")}</em></div><div class="period-stat-card"><span>${tr("이번 달 평균")}</span><b>${monthStat.avg}${tr("회/주")}</b><em>${tr("목표 대비")} ${monthStat.rate}%</em></div>`;
}

function renderRoutineDetail(routineId){
  const r=getRoutine(routineId);if(!r)return;document.getElementById("routineDetailTitle").textContent=`${r.icon} ${r.name} 전체 기록`;const entries=(r.entries||[]).slice().sort((a,b)=>b.date.localeCompare(a.date)),successCount=entries.filter(e=>routineSuccess(r,e)).length,rate=entries.length?Math.round(successCount/entries.length*100):0,g=ensureRoutineGoalShape(r);
  document.getElementById("routineDetailStats").innerHTML=`<div class="retro-stat"><b>${routineStreak(r)}</b><span>연속일</span></div><div class="retro-stat"><b>${successCount}</b><span>총 달성일</span></div><div class="retro-stat"><b>${rate}%</b><span>기록 중 달성률</span></div>`;document.getElementById("routineDetailMotivation").textContent=motivationText(r);document.getElementById("routineDetailGoalSummary").textContent=g.configured?`주 ${g.weeklyTarget}회 목표`:"목표 미설정";document.getElementById('routinePeriodStats').innerHTML=routinePeriodCardsHtml(r);
  const years=routineYearsWithData(r);if(!routineDetailYear||!years.includes(routineDetailYear))routineDetailYear=years[0];const ysel=document.getElementById('routineYearSelect');ysel.innerHTML=years.map(y=>`<option value="${y}">${y}년</option>`).join('');ysel.value=String(routineDetailYear);ysel.onchange=()=>{routineDetailYear=parseInt(ysel.value);renderRoutineYearGrid(r,routineDetailYear);renderRoutineMonthChart(r,routineDetailYear);};renderRoutineYearGrid(r,routineDetailYear);renderRoutineMonthChart(r,routineDetailYear);
  const editDate=document.getElementById("routineEditDate");editDate.value=dkey(new Date());function renderEditValueInput(){const existing=routineEntry(r,editDate.value),box=document.getElementById("routineEditValue");if(r.kind==="check")box.innerHTML=`<select id="routineEditVal"><option value="1" ${existing&&existing.done?"selected":""}>완료</option><option value="0" ${!(existing&&existing.done)?"selected":""}>미완료</option></select>`;else if(r.kind==="note")box.innerHTML=`<input type="text" id="routineEditVal" placeholder="내용" value="${escapeHtml((existing&&existing.note)||"")}" />`;else if(r.kind==="time")box.innerHTML=`<input type="time" id="routineEditVal" value="${(existing&&existing.time)||""}" />`;else box.innerHTML=`<input type="number" step="any" id="routineEditVal" placeholder="${escapeAttr(r.unit||tr("숫자"))}" value="${existing&&Number.isFinite(Number(existing.value))?existing.value:""}" />`;}
  renderEditValueInput();editDate.onchange=renderEditValueInput;document.getElementById("routineEditSaveBtn").onclick=async()=>{const val=document.getElementById("routineEditVal").value,payload=r.kind==="check"?{done:val==="1"}:r.kind==="note"?{note:val}:r.kind==="time"?{time:val}:{value:Number(val)};if(r.kind==="number"&&!Number.isFinite(payload.value))return;upsertRoutineEntry(routineId,editDate.value,payload);await saveData();renderRoutineDetail(routineId);};
  const list=document.getElementById("routineEntryList");if(!entries.length)list.innerHTML=`<p class="empty-hint sans">아직 기록이 없어요.</p>`;else{const groups={};entries.forEach(e=>{const k=e.date.slice(0,7);(groups[k]||=[]).push(e);});list.innerHTML=Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(month=>{const [yy,mm]=month.split('-');return `<div class="routine-month-group"><div class="routine-month-heading">${yy}년 ${parseInt(mm)}월</div>${groups[month].map(e=>`<div class="retro-line routine-entry-row"><span class="routine-entry-dot ${routineSuccess(r,e)?'done':''}"></span><span class="rl-title">${fmtDate(e.date)}${routineSuccess(r,e)?' <span class="pill pill-done">달성</span>':''}</span><span>${escapeHtml(routineValueLabel(r,e))}</span><button class="del" data-del-date="${e.date}">삭제</button></div>`).join('')}</div>`;}).join('');}
  list.querySelectorAll("[data-del-date]").forEach(btn=>btn.addEventListener("click",async()=>{deleteRoutineEntry(routineId,btn.dataset.delDate);await saveData();renderRoutineDetail(routineId);}));
}

function lifeRetroYears(){
  const ys=new Set([new Date().getFullYear()]);
  data.books.forEach(b=>(b.sessions||[]).forEach(x=>ys.add(parseInt(x.date.slice(0,4)))));
  (data.routines||[]).forEach(r=>(r.entries||[]).forEach(x=>ys.add(parseInt(x.date.slice(0,4)))));
  return [...ys].filter(Boolean).sort((a,b)=>b-a);
}
function monthMboAverage(year,month){const start=new Date(year,month,1),end=new Date(year,month+1,0),today=new Date();today.setHours(0,0,0,0);const last=end>today?today:end;if(start>last)return 0;let sum=0,n=0;for(let d=new Date(start);d<=last;d.setDate(d.getDate()+1)){sum+=mboDayScore(dkey(d)).rate;n++;}return n?Math.round(sum/n):0;}
function renderLifeAutoReview(year){const now=new Date(),month=year===now.getFullYear()?now.getMonth():11,prevMonth=month===0?11:month-1,prevYear=month===0?year-1:year,routines=(data.routines||[]).filter(r=>routineGoalConfigured(r)),perf=routines.map(r=>({r,rate:routineTargetPerformanceBetween(r,new Date(year,0,1),new Date(year,11,31)).rate})),best=perf.slice().sort((a,b)=>b.rate-a.rate)[0]||null,weak=perf.slice().sort((a,b)=>a.rate-b.rate)[0]||null,improvements=routines.map(r=>({r,cur:routineMonthPerformance(r,year,month).rate,prev:routineMonthPerformance(r,prevYear,prevMonth).rate})).map(x=>({...x,delta:x.cur-x.prev})).sort((a,b)=>b.delta-a.delta),improved=improvements[0]||null,curOverall=monthMboAverage(year,month),prevOverall=monthMboAverage(prevYear,prevMonth),delta=curOverall-prevOverall;document.getElementById("lifeAutoReviewPeriod").textContent=`${year}${tr("년")} ${month+1}${tr("월")}`;document.getElementById("lifeAutoReviewSummary").textContent=delta>0?`${tr("지난달보다 생활 달성률이")} ${delta}%p ${tr("올랐어요.")}`:delta<0?`${tr("지난달보다 생활 달성률이")} ${Math.abs(delta)}%p ${tr("낮아졌어요. 무리하지 말고 한 가지부터 다시 이어가 보세요.")}`:tr("지난달과 비슷한 흐름이에요. 꾸준함을 유지해 보세요.");const item=(label,obj,value)=>`<div class="auto-review-item"><span>${tr(label)}</span><b>${obj?`${obj.r.icon} ${escapeHtml(tr(obj.r.name))}`:"—"}</b><em>${value}</em></div>`;document.getElementById("lifeAutoReviewGrid").innerHTML=item("가장 잘 지킨 목표",best,best?best.rate+"%":"—")+item("가장 많이 좋아진 목표",improved,improved?(improved.delta>=0?"+":"")+improved.delta+"%p":"—")+item("조금 더 챙겨볼 목표",weak,weak?weak.rate+"%":"—")+`<div class="auto-review-item"><span>${tr("이번 달 생활 달성률")}</span><b>${curOverall}%</b><em>${delta===0?"±0":(delta>0?"+":"")+delta}%p</em></div>`;}

function renderLifeRetro(){
  const sel=document.getElementById("lifeRetroYear");
  const years=lifeRetroYears();
  if(!sel.dataset.filled || sel.dataset.filled!==years.join(",")){
    sel.innerHTML=years.map(y=>`<option value="${y}">${y}년</option>`).join(""); sel.dataset.filled=years.join(",");
  }
  const year=parseInt(sel.value)||new Date().getFullYear(); sel.value=String(year); renderLifeAutoReview(year);
  const start=new Date(year,0,1), end=new Date(year,11,31); const today=new Date(); today.setHours(0,0,0,0);
  const last=end>today?today:end;
  let days=0, scoreSum=0, perfect=0, cells="";
  for(let d=new Date(start); d<=last; d.setDate(d.getDate()+1)){
    const key=dkey(d), sc=mboDayScore(key); days++; scoreSum+=sc.rate; if(sc.rate===100) perfect++;
    cells += `<div class="heatmap-cell ${heatLevelFromRate(sc.rate)}" data-tooltip="${escapeAttr(mboTooltipText(key))}"></div>`;
  }
  const avg=days?Math.round(scoreSum/days):0;
  const configured=(data.routines||[]).filter(r=>routineGoalConfigured(r));
  const readDays=new Set(); data.books.forEach(b=>(b.sessions||[]).forEach(x=>{if(x.date.startsWith(String(year))&&x.minutes>0) readDays.add(x.date);}));
  document.getElementById("lifeRetroStats").innerHTML=`<div class="retro-stat"><b>${configured.length+1}</b><span>활성 MBO</span></div><div class="retro-stat"><b>${avg}%</b><span>평균 달성률</span></div><div class="retro-stat"><b>${perfect}</b><span>모두 채운 날</span></div><div class="retro-stat"><b>${readDays.size}</b><span>독서한 날</span></div>`;
  document.getElementById("lifeRetroRate").textContent=`평균 ${avg}%`;
  document.getElementById("lifeRetroHeatmap").innerHTML=cells;
  let rows=`<div class="life-goal-row"><div><b>📚 독서</b><span>${readDays.size}일 기록 · ${data.books.filter(b=>b.status==="done"&&b.endDate&&b.endDate.startsWith(String(year))).length}권 완독</span></div></div>`;
  (data.routines||[]).forEach(r=>{
    const es=(r.entries||[]).filter(e=>e.date.startsWith(String(year)));
    const suc=es.filter(e=>routineSuccess(r,e)).length;
    const g=ensureRoutineGoalShape(r);
    rows += `<div class="life-goal-row ${g.configured?"":"muted"}"><div><b>${r.icon} ${escapeHtml(r.name)}</b><span>${g.configured?`${suc}일 달성 · 최근 30일 ${routineLastNDaysRate(r,30)}%`:`목표를 아직 설정하지 않았어요`}</span></div><button class="secondary" data-retro-goal="${r.id}" type="button">${g.configured?"기록 보기":"목표 만들기"}</button></div>`;
  });
  const box=document.getElementById("lifeRetroGoals"); box.innerHTML=rows;
  box.querySelectorAll("[data-retro-goal]").forEach(btn=>btn.onclick=()=>showBridge(btn.dataset.retroGoal));
}

function renderHome(){
  data.baselineBooks = data.baselineBooks || 0;
  const doneCount = data.books.filter(b=>b.status==="done").length;
  const inProgressCount = data.books.filter(b=>b.status==="in_progress").length;
  const totalMinutes = data.books.flatMap(b=>b.sessions||[]).reduce((a,s)=>a+s.minutes,0);
  const totalHours = Math.round(totalMinutes/60*10)/10;
  const total = data.baselineBooks + doneCount;
  const goal = getGoal(total);
  const blockStart = goal - 100;
  const within = total - blockStart;
  const remaining = Math.max(0, goal - total);

  document.getElementById("homeEyebrow").textContent = `${goal}권 읽기 프로젝트`;
  document.getElementById("homeCount").textContent = total;
  document.getElementById("homeSub").textContent =
    `목표까지 ${remaining}권 남았어요 (목표 ${goal}권)`;
  document.getElementById("homeDone").textContent = doneCount;
  document.getElementById("homeProgress").textContent = inProgressCount;
  document.getElementById("homeHours").textContent = totalHours;

  const circumference = 2*Math.PI*78;
  const dash = circumference * (within/100);
  const ringFg = document.getElementById("homeRingFg");
  ringFg.setAttribute("stroke-dasharray", circumference);
  ringFg.setAttribute("stroke-dashoffset", circumference-dash);
  document.getElementById("homeRingPct").textContent = within + "%";

  const bi = document.getElementById("baselineInput");
  if(document.activeElement !== bi) bi.value = data.baselineBooks;

  const shelf = document.getElementById("homeShelf");
  let shelfHtml = "";
  for(let i=0;i<100;i++){
    shelfHtml += `<div class="shelf-mark ${i<within ? "filled":""}"></div>`;
  }
  shelf.innerHTML = shelfHtml;
  renderRewards();
}

// ---------- Browser back/forward support ----------
// Every screen change is recorded as a history entry via pushHistory().
// The popstate listener (below) replays the matching screen WITHOUT
// pushing again, so the back button moves within the app first and only
// leaves the site once there's nothing app-internal left to go back to.
let historyInit = false;
function pushHistory(state){
  if(!historyInit){ history.replaceState(state, ""); historyInit = true; }
  else{ history.pushState(state, ""); }
}

const ALL_SCREENS = ["mboScreen","homeScreen","library","bridgeScreen","routineDetailScreen","lifeRetroScreen"];
function hideAllScreens(){
  ALL_SCREENS.forEach(id => document.getElementById(id).classList.add("hidden"));
}

function applyMbo(){
  hideAllScreens();
  document.getElementById("mboScreen").classList.remove("hidden");
  renderMboMain();
}
function applyLifeRetro(){
  hideAllScreens();
  document.getElementById("lifeRetroScreen").classList.remove("hidden");
  renderLifeRetro();
}
function applyHome(){
  hideAllScreens();
  document.getElementById("homeScreen").classList.remove("hidden");
  renderHome();
}
function applyLibrary(){
  hideAllScreens();
  document.getElementById("library").classList.remove("hidden");
  renderLibrary();
}
function applyDetailDirect(id){
  currentBookId = id;
  hideAllScreens();
  document.getElementById("library").classList.remove("hidden");
  const overlay = document.getElementById("overlay");
  overlay.removeAttribute("style");
  overlay.classList.add("open", "expanded");
  renderDetail();
}
function applyCloseDetailDirect(){
  const overlay = document.getElementById("overlay");
  overlay.classList.remove("open", "expanded");
  overlay.removeAttribute("style");
  currentBookId = null;
  applyLibrary();
}
let currentBridgeId = null;
let currentRoutineDetailId = null;
function applyBridge(routineId){
  currentBridgeId = routineId;
  hideAllScreens();
  document.getElementById("bridgeScreen").classList.remove("hidden");
  renderBridge(routineId);
}
function applyRoutineDetail(routineId){
  currentRoutineDetailId = routineId;
  hideAllScreens();
  document.getElementById("routineDetailScreen").classList.remove("hidden");
  renderRoutineDetail(routineId);
}

window.addEventListener("popstate", (e)=>{
  const state = e.state || { view:"mbo" };
  if(state.view === "detail") applyDetailDirect(state.id);
  else if(state.view === "library"){
    if(document.getElementById("overlay").classList.contains("open")) applyCloseDetailDirect();
    else applyLibrary();
  }
  else if(state.view === "home") applyHome();
  else if(state.view === "lifeRetro") applyLifeRetro();
  else if(state.view === "bridge") applyBridge(state.id);
  else if(state.view === "routineDetail") applyRoutineDetail(state.id);
  else applyMbo();
});

function showMbo(){
  applyMbo();
  pushHistory({ view:"mbo" });
}
function showHome(){
  applyHome();
  pushHistory({ view:"home" });
}
function showLifeRetro(){
  applyLifeRetro();
  pushHistory({ view:"lifeRetro" });
}
function showLibrary(){
  applyLibrary();
  pushHistory({ view:"library" });
}
function showBridge(routineId){
  applyBridge(routineId);
  pushHistory({ view:"bridge", id:routineId });
}
function showRoutineDetail(routineId){
  applyRoutineDetail(routineId);
  pushHistory({ view:"routineDetail", id:routineId });
}

function barChartHtml(items){
  const max = Math.max(1, ...items.map(i=>i.value));
  return items.map(i=>`
    <div class="bar-col">
      <div class="bar-val">${i.value}</div>
      <div class="bar-track"><div class="bar" style="height:${Math.round(i.value/max*100)}%"></div></div>
      <div class="bar-label">${i.label}</div>
    </div>`).join("");
}

let statsMonthYear = new Date().getFullYear();
let statsWeekOffset = 0; // 0=이번 주, 1=지난주, 2=지지난주 ...

function startOfWeekMonday(baseDate){
  const d = new Date(baseDate);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay()+6)%7));
  return d;
}

function shortMonthDay(d){
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function weekMonthLabel(monday){
  // 목요일이 속한 달을 해당 주의 대표 월로 사용함.
  // 예: 8/31~9/6 → 9월 1주, 9/28~10/4 → 10월 1주
  const anchor = new Date(monday);
  anchor.setDate(anchor.getDate()+3);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const first = new Date(year, month, 1);
  first.setHours(0,0,0,0);
  const firstWeekMonday = startOfWeekMonday(first);
  const weekNo = Math.floor((monday - firstWeekMonday) / 604800000) + 1;
  return `${month+1}월 ${weekNo}주`;
}

function buildWeekOptionLabel(offset, monday){
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate()+6);
  const range = `${shortMonthDay(monday)}~${shortMonthDay(sunday)}`;
  if(offset === 0) return `이번 주 · ${range}`;
  if(offset === 1) return `지난주 · ${range}`;
  if(offset === 2) return `지지난주 · ${range}`;
  return `${weekMonthLabel(monday)} · ${range}`;
}

function renderStats(){
  const dayNames = ["일","월","화","수","목","금","토"];
  const byDate = {};
  data.books.flatMap(b=>b.sessions||[]).forEach(s=>{ byDate[s.date] = (byDate[s.date]||0) + s.minutes; });

  // 주간 선택: 이번 주부터 과거 16주까지
  const weekSelect = document.getElementById("statsWeekSelect");
  if(weekSelect){
    const thisMonday = startOfWeekMonday(new Date());
    const optionHtml = [];
    for(let offset=0; offset<16; offset++){
      const monday = new Date(thisMonday);
      monday.setDate(monday.getDate() - offset*7);
      optionHtml.push(`<option value="${offset}">${buildWeekOptionLabel(offset, monday)}</option>`);
    }
    if(weekSelect.dataset.filled !== "16-weeks-v1"){
      weekSelect.innerHTML = optionHtml.join("");
      weekSelect.dataset.filled = "16-weeks-v1";
    }
    weekSelect.value = String(statsWeekOffset);

    const selectedMonday = new Date(thisMonday);
    selectedMonday.setDate(selectedMonday.getDate() - statsWeekOffset*7);
    const week = [];
    for(let i=0;i<7;i++){
      const d = new Date(selectedMonday);
      d.setDate(d.getDate()+i);
      const key = dkey(d);
      const isToday = key === todayStr();
      week.push({
        label: isToday ? "오늘" : `${dayNames[d.getDay()]} ${d.getDate()}`,
        value: byDate[key]||0
      });
    }
    document.getElementById("statsWeek").innerHTML = barChartHtml(week);
  }

  const myEl = document.getElementById("statsMonthYearSelect");
  const myYears = yearsWithData();
  if(myEl.dataset.filled !== myYears.join(",")){
    myEl.innerHTML = myYears.map(y=>`<option value="${y}">${y}년</option>`).join("");
    myEl.dataset.filled = myYears.join(",");
  }
  myEl.value = String(statsMonthYear);
  const monthLabels = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  const monthVals = monthlyDoneCounts(String(statsMonthYear));
  document.getElementById("statsMonth").innerHTML = barChartHtml(monthLabels.map((m,i)=>({label:m.replace("월",""), value:monthVals[i]})));

  const yearCount = {};
  const yearBestMonth = {};
  data.books.filter(b=>b.status==="done" && b.endDate).forEach(b=>{
    const y = b.endDate.slice(0,4), m = b.endDate.slice(5,7);
    yearCount[y] = (yearCount[y]||0) + 1;
    yearBestMonth[y] = yearBestMonth[y] || {};
    yearBestMonth[y][m] = (yearBestMonth[y][m]||0) + 1;
  });
  const years = Object.keys(yearCount).sort();
  if(years.length === 0){
    document.getElementById("statsYear").innerHTML = `<div class="empty-hint sans" style="padding:6px 0;">완독한 책의 완료일이 쌓이면 연도별 그래프가 보여요.</div>`;
  }else{
    document.getElementById("statsYear").innerHTML = barChartHtml(years.map(y=>{
      const months = yearBestMonth[y];
      const bestM = Object.entries(months).sort((a,b)=>b[1]-a[1])[0];
      return { label:`${y.slice(2)}'  ${parseInt(bestM[0])}월↑`, value: yearCount[y] };
    }));
  }

  const genreCount = {};
  data.books.forEach(b=>(b.genres||[]).forEach(g=>{ genreCount[g] = (genreCount[g]||0)+1; }));
  const genres = Object.entries(genreCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const gEl = document.getElementById("statsGenre");
  if(genres.length === 0){
    gEl.innerHTML = `<div class="empty-hint sans" style="padding:6px 0;">책 상세 화면에서 장르 태그를 달면, 어떤 분야를 많이 읽는지 여기에 보여요.</div>`;
  }else{
    const gmax = genres[0][1];
    gEl.innerHTML = genres.map(([name,cnt])=>`
      <div class="hbar-row">
        <span class="hbar-label sans">${escapeHtml(name)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(cnt/gmax*100)}%"></div></div>
        <span class="hbar-num sans">${cnt}</span>
      </div>`).join("");
  }
}

function yearsWithData(){
  const ys = new Set([String(new Date().getFullYear()), String(new Date().getFullYear()+1)]);
  data.books.forEach(b=>{
    if(b.endDate) ys.add(b.endDate.slice(0,4));
    if(b.startDate) ys.add(b.startDate.slice(0,4));
    (b.sessions||[]).forEach(s=> ys.add(s.date.slice(0,4)));
  });
  return [...ys].sort();
}
function monthlyDoneCounts(year){
  const counts = new Array(12).fill(0);
  data.books.forEach(b=>{
    if(b.status==="done" && b.endDate && b.endDate.startsWith(year)) counts[parseInt(b.endDate.slice(5,7))-1]++;
  });
  return counts;
}

let contribYear = new Date().getFullYear();
function renderContrib(){
  const sel = document.getElementById("contribYearSelect");
  const years = yearsWithData();
  if(sel.dataset.filled !== years.join(",")){
    sel.innerHTML = years.map(y=>`<option value="${y}">${y}년</option>`).join("");
    sel.dataset.filled = years.join(",");
  }
  sel.value = String(contribYear);
  const year = contribYear;
  const byDate = {};
  data.books.flatMap(b=>b.sessions||[]).forEach(s=>{ byDate[s.date] = (byDate[s.date]||0) + s.minutes; });
  const keyOf = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const jan1 = new Date(year,0,1);
  const start = new Date(jan1); start.setDate(start.getDate() - jan1.getDay());
  const dec31 = new Date(year,11,31);

  let cells = "", i = 0, activeDays = 0, totalMin = 0;
  const monthAt = {};
  for(const d = new Date(start); d <= dec31; d.setDate(d.getDate()+1), i++){
    if(d < jan1){ cells += `<div class="heatmap-cell empty"></div>`; continue; }
    if(d.getDate() === 1) monthAt[Math.floor(i/7)] = (d.getMonth()+1)+"월";
    const min = byDate[keyOf(d)] || 0;
    let level = "";
    if(min > 0){ activeDays++; totalMin += min; level = min<=15 ? "l1" : min<=30 ? "l2" : min<=60 ? "l3" : "l4"; }
    cells += `<div class="heatmap-cell ${level}" data-tooltip="${escapeAttr(`${keyOf(d)}\n${min?min+tr("분")+" · "+tr("독서"):tr("기록 없음")}`)}"></div>`;
  }
  const cols = Math.ceil(i/7);
  let months = "";
  for(let c=0;c<cols;c++) months += `<span>${monthAt[c]||""}</span>`;

  document.getElementById("contribGrid").innerHTML = cells;
  document.getElementById("contribMonths").innerHTML = months;
  document.getElementById("contribTitle").textContent =
    `${year}년 · ${activeDays}일 독서 (총 ${Math.round(totalMin/60*10)/10}시간)`;
}

function renderLibrary(){
  renderStats();
  renderContrib();

  const list = getFilteredSortedBooks();
  const count = data.books.length;
  document.getElementById("libCount").textContent = count > 0 ? `${count}권 기록 중` : "";

  const grid = document.getElementById("grid");
  const board = document.getElementById("board");

  if(viewMode === "grid"){
    grid.classList.remove("hidden"); board.classList.add("hidden");
    let html = "";
    list.forEach(b=>{
      const pct = pctOf(b);
      const totalMinutes = (b.sessions||[]).reduce((a,s)=>a+s.minutes,0);
      const timeStr = totalMinutes >= 60 ? `${Math.floor(totalMinutes/60)}시간 ${totalMinutes%60}분` : `${totalMinutes}분`;
      const bottomLine = b.status === "done"
        ? `완료 · 총 ${timeStr}`
        : `${b.startDate ? fmtDate(b.startDate) : "시작 전"}${b.endDate ? " → "+fmtDate(b.endDate) : ""}`;
      const statusColor = STATUS_COLORS[b.status] || STATUS_COLORS.not_started;
      const coverInner = b.coverImage
        ? `<img class="cover-img" src="${b.coverImage}" alt="" />
           <span class="ring-badge">${ringSvg(pct, 40, 4, "rgba(255,255,255,0.35)", "#ffffff", "#ffffff")}</span>`
        : ringSvg(pct, 64, 6, "rgba(255,255,255,0.25)", "#ffffff", "#ffffff");
      html += `
        <div class="card" data-id="${b.id}">
          <div class="card-cover" style="background:${statusColor}">
            <button class="visibility-toggle ${b.isPublic?"is-public":""}" data-toggle-id="${b.id}" title="${b.isPublic?"공개 중 · 눌러서 비공개로":"비공개 · 눌러서 공개로"}" type="button">${b.isPublic ? "🌐" : "🔒"}</button>
            ${coverInner}
          </div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(b.title || "제목 없음")}</div>
            ${b.author ? `<div class="card-author sans">${escapeHtml(b.author)}</div>` : ""}
            <div class="card-props">
              <span class="pill pill-${b.status}">${statusLabel(b.status)}</span>
              ${b.rating ? `<span class="stars-mini">${starsHtml(b.rating)}</span>` : ""}
            </div>
            ${(b.genres&&b.genres.length) ? `<div class="genre-tags">${b.genres.slice(0,3).map(g=>`<span class="genre-tag">${escapeHtml(g)}</span>`).join("")}</div>` : ""}
            <div class="card-bottom sans">${bottomLine}</div>
          </div>
        </div>
      `;
    });
    html += `
      <div class="card new" id="newBookCard">
        <div class="plus">+</div>
        <span class="label sans">새 책 추가</span>
      </div>
    `;
    grid.innerHTML = html;
    grid.querySelectorAll(".card[data-id]").forEach(el=>{
      el.addEventListener("click", ()=> openBook(el.dataset.id, el));
    });
    grid.querySelectorAll(".visibility-toggle").forEach(el=>{
      el.addEventListener("click", async (e)=>{
        e.stopPropagation();
        const bk = data.books.find(x=>x.id===el.dataset.toggleId);
        if(!bk) return;
        bk.isPublic = !bk.isPublic;
        bk.updatedAt = Date.now();
        await saveData();
        renderLibrary();
      });
    });
    document.getElementById("newBookCard").addEventListener("click", openAddModal);
  }else{
    grid.classList.add("hidden"); board.classList.remove("hidden");
    const cols = [
      {key:"wishlist", label:"읽고 싶음"},
      {key:"not_started", label:"시작 전"},
      {key:"in_progress", label:"읽는 중"},
      {key:"done", label:"완료"},
      {key:"dropped", label:"중단"}
    ];
    let html = "";
    cols.forEach(col=>{
      const items = list.filter(b=>b.status===col.key);
      html += `<div class="board-col"><h4>${col.label} · ${items.length}</h4>`;
      items.forEach(b=>{
        html += `<div class="board-card" data-id="${b.id}">
          <div class="bc-title">${escapeHtml(b.title||"제목 없음")}</div>
          <div class="bc-pct">${pctOf(b)}%</div>
        </div>`;
      });
      html += `</div>`;
    });
    board.innerHTML = html;
    board.querySelectorAll(".board-card").forEach(el=>{
      el.addEventListener("click", ()=> openBook(el.dataset.id, el));
    });
  }
}

function exportData(){
  const snapshot = normalizeData(data);
  snapshot.exportedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `book-library-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function generateReport(){  // PDF (opens print dialog -> save as PDF)
  const doneCount = data.books.filter(b=>b.status==="done").length;
  const total = (data.baselineBooks||0) + doneCount;
  const goalNow = getGoal(total);
  const totalMinutes = data.books.flatMap(b=>b.sessions||[]).reduce((a,s)=>a+s.minutes,0);

  const bookPages = data.books.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).map(b=>{
    const pct = pctOf(b);
    const tMin = (b.sessions||[]).reduce((a,s)=>a+s.minutes,0);
    const tStr = tMin>=60 ? `${Math.floor(tMin/60)}시간 ${tMin%60}분` : `${tMin}분`;
    const quotes = (b.quotes||[]).length
      ? b.quotes.map(q=>`<div class="r-quote">“${escapeHtml(q.text)}”${q.page?` <span class="r-qpage">p.${q.page}</span>`:""}</div>`).join("")
      : `<p class="r-empty">기록된 문구가 없어요.</p>`;
    return `
      <section class="r-book">
        <h2>${escapeHtml(b.title||"제목 없음")}</h2>
        <div class="r-meta">
          ${b.author ? `<div><b>작가</b> ${escapeHtml(b.author)}</div>` : ""}
          ${b.publisher ? `<div><b>출판사</b> ${escapeHtml(b.publisher)}</div>` : ""}
          ${b.translator ? `<div><b>옮긴이</b> ${escapeHtml(b.translator)}</div>` : ""}
          <div><b>상태</b> ${statusLabel(b.status)} · ${pct}%</div>
          ${b.startDate ? `<div><b>시작일</b> ${fmtDate(b.startDate)}</div>` : ""}
          ${b.endDate ? `<div><b>완료일</b> ${fmtDate(b.endDate)}</div>` : ""}
          <div><b>누적 독서 시간</b> ${tStr}</div>
          ${b.rating ? `<div><b>별점</b> ${starsHtml(b.rating)}</div>` : ""}
          ${(b.genres&&b.genres.length) ? `<div><b>장르</b> ${b.genres.map(escapeHtml).join(", ")}</div>` : ""}
        </div>
        ${b.takeaway ? `<h3>이 책에서 얻은 것</h3><p class="r-review">${escapeHtml(b.takeaway)}</p>` : ""}
        <h3>좋았던 문구</h3>
        ${quotes}
        <h3>독후감</h3>
        <p class="r-review">${b.review ? escapeHtml(b.review).replace(/\n/g,"<br>") : `<span class="r-empty">작성된 독후감이 없어요.</span>`}</p>
      </section>
    `;
  }).join("");

  const libraryRows = data.books.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).map(b=>
    `<tr><td>${escapeHtml(b.title||"제목 없음")}</td><td>${escapeHtml(b.author||"—")}</td><td>${statusLabel(b.status)}</td><td>${pctOf(b)}%</td></tr>`
  ).join("");

  const html = `
    <!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>나의 서재 리포트</title>
    <style>
      body{font-family:"Iowan Old Style",Georgia,serif; color:#23303C; max-width:720px; margin:40px auto; padding:0 20px; line-height:1.6;}
      h1{font-size:30px; margin-bottom:4px;}
      .r-cover-sub{color:#6b7280; font-size:14px; margin-bottom:40px;}
      .r-stats{display:flex; gap:30px; margin-bottom:40px; font-size:14px;}
      .r-stats b{display:block; font-size:22px;}
      table{width:100%; border-collapse:collapse; margin-bottom:50px; font-size:13.5px;}
      th,td{border-bottom:1px solid #ddd; padding:8px 6px; text-align:left;}
      .r-book{ page-break-before:always; padding-top:20px; }
      .r-book h2{font-size:22px; border-bottom:2px solid #23303C; padding-bottom:8px;}
      .r-meta{font-size:13.5px; color:#444; margin:14px 0 20px; display:flex; flex-direction:column; gap:3px;}
      .r-meta b{display:inline-block; width:90px; color:#888; font-weight:600;}
      h3{font-size:13px; color:#888; text-transform:uppercase; letter-spacing:.5px; margin:22px 0 10px;}
      .r-quote{background:#FAEBDD; border-left:3px solid #D9730D; padding:10px 14px; margin-bottom:8px; border-radius:4px; font-size:14px;}
      .r-qpage{color:#888; font-size:11px;}
      .r-review{font-size:14.5px;}
      .r-empty{color:#999; font-style:normal; font-size:13px;}
      @media print{ .r-book{ page-break-before:always; } }
    </style></head><body>
      <h1>📚 나의 서재 리포트</h1>
      <p class="r-cover-sub">${todayStr()} 기준 · ${goalNow}권 프로젝트</p>
      <div class="r-stats">
        <div><b>${total}</b>/${goalNow}권</div>
        <div><b>${doneCount}</b>완독</div>
        <div><b>${Math.round(totalMinutes/60*10)/10}</b>시간</div>
      </div>
      <h3>서재 목록</h3>
      <table><tr><th>제목</th><th>작가</th><th>상태</th><th>진행률</th></tr>${libraryRows}</table>
      ${bookPages}
      <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
    </body></html>
  `;
  const localizedHtml = trHtml(html);
  const blob = new Blob([localizedHtml], { type:"text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}


function downloadBlob(content, filename, type){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function bookMinutes(b){ return (b.sessions||[]).reduce((a,s)=>a+s.minutes,0); }
function booksRows(){
  return data.books.map(b=>({
    [tr("제목")]: b.title||"", [tr("작가")]: b.author||"", [tr("출판사")]: b.publisher||"", [tr("옮긴이")]: b.translator||"",
    [tr("상태")]: tr(statusLabel(b.status)), [tr("진행률(%)")]: pctOf(b), [tr("현재 페이지")]: b.currentPage||0, [tr("총 페이지")]: b.totalPages||0,
    [tr("시작일")]: b.startDate||"", [tr("완료일")]: b.endDate||"", [tr("누적 독서시간(분)")]: bookMinutes(b),
    [tr("별점")]: b.rating||"", [tr("장르")]: (b.genres||[]).join(", "), [tr("이 책에서 얻은 것")]: b.takeaway||"", [tr("독후감")]: b.review||""
  }));
}
function exportXlsx(){
  if(typeof XLSX === "undefined"){ alert("Excel 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인하거나 CSV로 내보내 주세요."); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(booksRows()), tr("책 목록"));
  const quotes = data.books.flatMap(b=>(b.quotes||[]).map(q=>({ [tr("책")]: b.title, [tr("문구")]: q.text, [tr("페이지")]: q.page||"" })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quotes.length?quotes:[{ [tr("책")]:"", [tr("문구")]:"", [tr("페이지")]:"" }]), tr("문구"));
  const sessions = data.books.flatMap(b=>(b.sessions||[]).map(s=>({ [tr("책")]: b.title, [tr("날짜")]: s.date, [tr("독서시간(분)")]: s.minutes })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessions.length?sessions:[{ [tr("책")]:"", [tr("날짜")]:"", [tr("독서시간(분)")]:"" }]), tr("독서 기록"));
  XLSX.writeFile(wb, `mbo-library-${todayStr()}.xlsx`);
}
function exportCsv(){
  const rows = booksRows();
  const keys = Object.keys(rows[0] || {"제목":""});
  const esc = v => `"${String(v).replace(/"/g,'""')}"`;
  const csv = [keys.map(esc).join(",")].concat(rows.map(r=>keys.map(k=>esc(r[k])).join(","))).join("\r\n");
  downloadBlob("\uFEFF"+csv, `mbo-library-${todayStr()}.csv`, "text/csv;charset=utf-8");
}
function exportMarkdown(){
  const doneCount = data.books.filter(b=>b.status==="done").length;
  const total = (data.baselineBooks||0) + doneCount;
  const goalNow = getGoal(total);
  const projectLine = tr(`${goalNow}권 읽기 프로젝트`);
  let md = `# ${tr("나의 서재")}\n\n${projectLine} · ${total}/${goalNow} ${tr("권")} (${todayStr()})\n\n`;
  data.books.forEach(b=>{
    md += `## ${b.title||tr("제목 없음")}\n\n`;
    if(b.author) md += `- ${tr("작가")}: ${b.author}\n`;
    if(b.publisher) md += `- ${tr("출판사")}: ${b.publisher}\n`;
    if(b.translator) md += `- ${tr("옮긴이")}: ${b.translator}\n`;
    md += `- ${tr("상태")}: ${tr(statusLabel(b.status))} (${pctOf(b)}%)\n`;
    if(b.startDate) md += `- ${tr("시작일")}: ${b.startDate}\n`;
    if(b.endDate) md += `- ${tr("완료일")}: ${b.endDate}\n`;
    md += `- ${tr("누적 독서 시간")}: ${tr(`${bookMinutes(b)}분`)}\n`;
    if(b.rating) md += `- ${tr("별점")}: ${starsHtml(b.rating)}\n`;
    if((b.genres||[]).length) md += `- ${tr("장르")}: ${b.genres.join(", ")}\n`;
    if(b.takeaway) md += `- ${tr("이 책에서 얻은 것")}: ${b.takeaway}\n`;
    md += `\n### ${tr("좋았던 문구")}\n\n`;
    md += (b.quotes||[]).length ? b.quotes.map(q=>`> ${q.text}${q.page?` (p.${q.page})`:""}\n`).join("\n") : `_${tr("기록 없음")}_\n`;
    md += `\n### ${tr("독후감")}\n\n${b.review||`_${tr("작성된 독후감이 없어요.")}_`}\n\n---\n\n`;
  });
  downloadBlob(md, `mbo-library-${todayStr()}.md`, "text/markdown;charset=utf-8");
}
function handleExport(fmt){
  if(fmt==="pdf") generateReport();
  else if(fmt==="xlsx") exportXlsx();
  else if(fmt==="md") exportMarkdown();
  else if(fmt==="csv") exportCsv();
  else if(fmt==="json") exportData();
  document.getElementById("exportModal").classList.add("hidden");
}

function importData(file){
  if(!file) return;
  if(file.size > 10*1024*1024){ alert("백업 파일이 너무 큽니다(10MB 초과). 파일을 확인해 주세요."); return; }
  const reader = new FileReader();
  reader.onload = async (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!plausibleData(parsed)) throw new Error("invalid");
      const normalized=normalizeData(parsed);
      if(!confirm(`백업 파일의 책 ${normalized.books.length}권과 생활 기록을 현재 데이터에 덮어쓸까요?\n현재 데이터는 자동 백업한 뒤 복원합니다.`)) return;
      await writeBackup(JSON.parse(JSON.stringify(data)),"before-import");
      data = normalized;
      await saveData({backup:false});
      await writeBackup(JSON.parse(JSON.stringify(data)),"after-import");
      renderHome(); renderLibrary(); renderMboMain();
      alert("복원됐어요. 기존 데이터도 브라우저 자동 백업에 보관했습니다.");
    }catch(err){
      console.error(err);
      alert("파일을 읽지 못했어요. 올바른 이 앱의 JSON 백업 파일인지 확인해 주세요.");
    }
  };
  reader.readAsText(file);
}

function renderCustomGoalKindOptions(){const kind=document.getElementById("customGoalKind").value,box=document.getElementById("customGoalKindOptions");if(kind==="time")box.innerHTML=`<div class="custom-kind-options"><label>${tr("목표 시각")}</label><input id="customGoalTime" type="time" value="07:00" /></div>`;else if(kind==="number")box.innerHTML=`<div class="custom-kind-options"><div class="goal-frequency-row"><span>${tr("목표값")}</span><input id="customGoalTargetValue" type="number" step="any" value="1"></div><div class="goal-frequency-row"><span>${tr("단위")}</span><input id="customGoalUnit" placeholder="예: km, ml, 분" style="max-width:120px"></div><div class="goal-frequency-row"><span>${tr("달성 기준")}</span><select id="customGoalTargetMode" class="modal-select"><option value="min">${tr("목표값 이상")}</option><option value="max">${tr("목표값 이하")}</option></select></div></div>`;else box.innerHTML="";}
function openCustomGoalModal(){document.getElementById("customGoalIcon").value="🎯";document.getElementById("customGoalName").value="";document.getElementById("customGoalKind").value="check";document.getElementById("customGoalWeeklyTarget").value="3";document.getElementById("customGoalReason").value="";document.getElementById("customGoalEmojiPanel")?.classList.add("hidden");renderCustomGoalKindOptions();document.getElementById("customGoalModal").classList.remove("hidden");}
async function saveCustomGoal(){const name=document.getElementById("customGoalName").value.trim();if(!name){alert("목표 이름을 입력해 주세요.");return;}const kind=document.getElementById("customGoalKind").value,weeklyTarget=Math.max(1,Math.min(7,parseInt(document.getElementById("customGoalWeeklyTarget").value)||3)),r={id:"custom_"+Date.now(),name,icon:document.getElementById("customGoalIcon").value.trim()||"🎯",kind,isCustom:true,entries:[],goalTime:"",targetValue:null,targetMode:"min",unit:"",goal:{configured:true,statement:name,reason:document.getElementById("customGoalReason").value.trim(),weeklyTarget,startedAt:todayStr()}};if(kind==="time")r.goalTime=document.getElementById("customGoalTime").value||"07:00";if(kind==="number"){const v=Number(document.getElementById("customGoalTargetValue").value);if(!Number.isFinite(v)){alert("숫자 목표값을 입력해 주세요.");return;}r.targetValue=v;r.unit=document.getElementById("customGoalUnit").value.trim();r.targetMode=document.getElementById("customGoalTargetMode").value;}data.routines.push(r);await saveData();document.getElementById("customGoalModal").classList.add("hidden");renderMboMain();}
function initEmojiPicker(){
  const btn=document.getElementById("customGoalEmojiBtn");
  const panel=document.getElementById("customGoalEmojiPanel");
  const picker=document.getElementById("customGoalEmojiPicker");
  const input=document.getElementById("customGoalIcon");
  if(!btn||!panel||!picker||!input) return;
  btn.addEventListener("click",(e)=>{e.stopPropagation();panel.classList.toggle("hidden");});
  picker.addEventListener("emoji-click",(e)=>{const emoji=e.detail&&e.detail.unicode;if(emoji){input.value=emoji;panel.classList.add("hidden");}});
  document.addEventListener("click",(e)=>{if(!panel.classList.contains("hidden")&&!panel.contains(e.target)&&e.target!==btn)panel.classList.add("hidden");});
}
let tooltipPinned=false;function showGlobalTooltip(target,x,y,pin=false){const tip=document.getElementById("globalTooltip"),text=target&&target.dataset?target.dataset.tooltip:"";if(!tip||!text)return;tip.textContent=text;tip.classList.remove("hidden");tip.classList.toggle("pinned",!!pin);tooltipPinned=!!pin;let left=(x||0)+14,top=(y||0)+14;tip.style.left=left+"px";tip.style.top=top+"px";const rect=tip.getBoundingClientRect(),margin=12;if(rect.right>window.innerWidth-margin)left=Math.max(margin,window.innerWidth-rect.width-margin);if(rect.bottom>window.innerHeight-margin)top=Math.max(margin,(y||0)-rect.height-14);tip.style.left=left+"px";tip.style.top=top+"px";}
function hideGlobalTooltip(){const tip=document.getElementById("globalTooltip");if(tip){tip.classList.add("hidden");tip.classList.remove("pinned");}tooltipPinned=false;}
function initGlobalTooltips(){document.addEventListener("mouseover",e=>{const t=e.target.closest&&e.target.closest("[data-tooltip]");if(t&&!tooltipPinned)showGlobalTooltip(t,e.clientX,e.clientY,false);});document.addEventListener("mousemove",e=>{if(tooltipPinned)return;const t=e.target.closest&&e.target.closest("[data-tooltip]");if(t)showGlobalTooltip(t,e.clientX,e.clientY,false);});document.addEventListener("mouseout",e=>{if(tooltipPinned)return;const t=e.target.closest&&e.target.closest("[data-tooltip]");if(t)hideGlobalTooltip();});document.addEventListener("click",e=>{const t=e.target.closest&&e.target.closest("[data-tooltip]");if(t){const r=t.getBoundingClientRect();showGlobalTooltip(t,r.left+r.width/2,r.bottom,true);return;}if(tooltipPinned)hideGlobalTooltip();});window.addEventListener("scroll",()=>{if(tooltipPinned)hideGlobalTooltip();},{passive:true});}
function rerenderVisibleForLanguage(){try{if(!document.getElementById("mboScreen").classList.contains("hidden"))renderMboMain();if(!document.getElementById("bridgeScreen").classList.contains("hidden")&&currentBridgeId)renderBridge(currentBridgeId);if(!document.getElementById("routineDetailScreen").classList.contains("hidden")&&currentRoutineDetailId)renderRoutineDetail(currentRoutineDetailId);if(!document.getElementById("lifeRetroScreen").classList.contains("hidden"))renderLifeRetro();if(!document.getElementById("homeScreen").classList.contains("hidden"))renderHome();if(!document.getElementById("library").classList.contains("hidden"))renderLibrary();}catch(e){console.warn("language rerender skipped",e);}}
window.addEventListener("mbo-language-change",()=>setTimeout(rerenderVisibleForLanguage,0));document.getElementById("openCustomGoalBtn").addEventListener("click",openCustomGoalModal);document.getElementById("cancelCustomGoalBtn").addEventListener("click",()=>document.getElementById("customGoalModal").classList.add("hidden"));document.getElementById("customGoalKind").addEventListener("change",renderCustomGoalKindOptions);document.getElementById("saveCustomGoalBtn").addEventListener("click",saveCustomGoal);initGlobalTooltips();initEmojiPicker();

document.getElementById("baselineInput").addEventListener("change", async (e)=>{
  data.baselineBooks = Math.max(0, parseInt(e.target.value)||0);
  await saveData();
  renderHome();
});
document.getElementById("enterLibraryBtn").addEventListener("click", showLibrary);
document.getElementById("backToMboBtn").addEventListener("click", showMbo);
document.getElementById("openLifeRetroBtn").addEventListener("click", showLifeRetro);
document.getElementById("lifeRetroBackBtn").addEventListener("click", showMbo);
document.getElementById("lifeRetroYear").addEventListener("change", renderLifeRetro);
document.getElementById("bridgeBackBtn").addEventListener("click", showMbo);
document.getElementById("routineDetailBackBtn").addEventListener("click", ()=> showBridge(currentRoutineDetailId));
document.getElementById("goRoutineDetailBtn").addEventListener("click", ()=> showRoutineDetail(currentBridgeId));
document.getElementById("openShareBtn").addEventListener("click", openShareModal);
document.getElementById("closeShareBtn").addEventListener("click", ()=> document.getElementById("shareModal").classList.add("hidden"));
document.getElementById("regenShareBtn").addEventListener("click", refreshShareLink);
document.getElementById("ownerNameInput").addEventListener("input", refreshShareLink);
document.getElementById("ownerNameInput").addEventListener("change", ()=>saveData());
document.getElementById("copyShareBtn").addEventListener("click", async ()=>{
  const area = document.getElementById("shareLinkArea");
  area.select();
  try{ await navigator.clipboard.writeText(area.value); document.getElementById("shareCopyStatus").textContent = "복사했어요!"; }
  catch(e){ document.getElementById("shareCopyStatus").textContent = "복사 실패 — 직접 선택해서 복사해 주세요."; }
});
document.getElementById("contribYearSelect").addEventListener("change", (e)=>{
  contribYear = parseInt(e.target.value);
  renderContrib();
});
document.getElementById("mboOverviewYearSelect").addEventListener("change", (e)=>{
  mboOverviewYear = parseInt(e.target.value);
  renderMboOverview();
});
document.getElementById("statsWeekSelect").addEventListener("change", (e)=>{
  statsWeekOffset = Math.max(0, parseInt(e.target.value)||0);
  renderStats();
});
document.getElementById("statsMonthYearSelect").addEventListener("change", (e)=>{
  statsMonthYear = parseInt(e.target.value);
  renderStats();
});
document.getElementById("markAllPublicBtn").addEventListener("click", async ()=>{
  if(!confirm("서재의 모든 책을 공개로 바꿀까요?")) return;
  data.books.forEach(b=> b.isPublic = true);
  await saveData(); renderLibrary();
});
document.getElementById("markAllPrivateBtn").addEventListener("click", async ()=>{
  data.books.forEach(b=> b.isPublic = false);
  await saveData(); renderLibrary();
});
document.getElementById("weeklyGoalInput").addEventListener("change", async (e)=>{
  data.weeklyGoal = Math.max(1, parseInt(e.target.value) || 2);
  await saveData();
  renderRewards();
});
document.getElementById("openRetroBtn").addEventListener("click", openRetro);
document.getElementById("openRetroBtn2").addEventListener("click", openRetro);
document.getElementById("closeRetroBtn").addEventListener("click", ()=> document.getElementById("retroModal").classList.add("hidden"));
document.getElementById("retroYear").addEventListener("change", (e)=> renderRetro(e.target.value));
document.getElementById("backHomeBtn").addEventListener("click", showHome);
document.getElementById("searchInput").addEventListener("input", (e)=>{
  searchQuery = e.target.value.trim();
  renderLibrary();
});
document.getElementById("statusChips").addEventListener("click", (e)=>{
  const btn = e.target.closest(".chip");
  if(!btn) return;
  filterStatus = btn.dataset.status;
  document.querySelectorAll("#statusChips .chip").forEach(c=>c.classList.remove("active"));
  btn.classList.add("active");
  renderLibrary();
});
document.getElementById("sortSelect").addEventListener("change", (e)=>{
  sortBy = e.target.value;
  renderLibrary();
});
document.getElementById("viewGridBtn").addEventListener("click", ()=>{
  viewMode = "grid";
  document.getElementById("viewGridBtn").classList.add("active");
  document.getElementById("viewBoardBtn").classList.remove("active");
  renderLibrary();
});
document.getElementById("viewBoardBtn").addEventListener("click", ()=>{
  viewMode = "board";
  document.getElementById("viewBoardBtn").classList.add("active");
  document.getElementById("viewGridBtn").classList.remove("active");
  renderLibrary();
});
document.getElementById("openExportBtn").addEventListener("click", ()=> document.getElementById("exportModal").classList.remove("hidden"));
document.getElementById("closeExportBtn").addEventListener("click", ()=> document.getElementById("exportModal").classList.add("hidden"));
document.querySelectorAll(".export-item").forEach(btn=> btn.addEventListener("click", ()=> handleExport(btn.dataset.fmt)));
document.getElementById("importBtn").addEventListener("click", ()=> document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", (e)=>{
  if(e.target.files[0]) importData(e.target.files[0]);
  e.target.value = "";
});

function openAddModal(){
  document.getElementById("fSearchQuery").value = "";
  document.getElementById("fTitle").value = "";
  document.getElementById("fAuthor").value = "";
  document.getElementById("fPublisher").value = "";
  document.getElementById("fTranslator").value = "";
  document.getElementById("fPages").value = "";
  document.getElementById("fetchStatus").textContent = "";
  lastFetchedCover = null;
  document.getElementById("fStatus").value = "not_started";
  document.getElementById("addModal").classList.remove("hidden");
}
function closeAddModal(){
  document.getElementById("addModal").classList.add("hidden");
}

async function fetchBookInfo(){
  const q = document.getElementById("fSearchQuery").value.trim() || document.getElementById("fTitle").value.trim();
  const statusEl = document.getElementById("fetchStatus");
  if(!q){ statusEl.textContent = "검색어를 입력해 주세요."; return; }
  statusEl.textContent = "검색 중…";
  try{
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    const item = json.items && json.items[0];
    if(!item){ statusEl.textContent = "검색 결과가 없어요. 직접 입력해 주세요."; return; }
    const info = item.volumeInfo || {};
    document.getElementById("fTitle").value = info.title || q;
    document.getElementById("fAuthor").value = (info.authors || []).join(", ");
    document.getElementById("fPublisher").value = info.publisher || "";
    if(info.pageCount) document.getElementById("fPages").value = info.pageCount;
    lastFetchedCover = info.imageLinks ? (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || null) : null;
    if(lastFetchedCover) lastFetchedCover = lastFetchedCover.replace("http://","https://");
    statusEl.textContent = lastFetchedCover
      ? "정보와 표지를 가져왔어요. 옮긴이나 페이지 수는 확인 후 필요하면 수정해 주세요."
      : "정보를 가져왔어요 (표지 이미지는 없었어요). 옮긴이나 페이지 수는 확인해 주세요.";
  }catch(e){
    statusEl.textContent = "정보를 가져오지 못했어요. 직접 입력해 주세요.";
  }
}

async function confirmAddBook(){
  const title = document.getElementById("fTitle").value.trim();
  if(!title){ document.getElementById("fetchStatus").textContent = "제목은 꼭 입력해 주세요."; return; }
  const book = {
    id: "book_"+Date.now(),
    title,
    author: document.getElementById("fAuthor").value.trim(),
    publisher: document.getElementById("fPublisher").value.trim(),
    translator: document.getElementById("fTranslator").value.trim(),
    totalPages: Math.max(0, parseInt(document.getElementById("fPages").value)||0),
    currentPage: 0,
    status: document.getElementById("fStatus").value,
    startDate: document.getElementById("fStatus").value === "in_progress" ? todayStr() : null,
    takeaway: "",
    isPublic: false,
    plannedEnd: null,
    endDate: null,
    sessions: [],
    quotes: [],
    review: "",
    coverColor: COVER_PALETTE[data.books.length % COVER_PALETTE.length],
    coverImage: lastFetchedCover,
    rating: 0,
    genres: [],
    updatedAt: Date.now()
  };
  data.books.push(book);
  await saveData();
  closeAddModal();
  renderLibrary();
}

document.getElementById("fetchInfoBtn").addEventListener("click", fetchBookInfo);
document.getElementById("cancelAddBtn").addEventListener("click", closeAddModal);
document.getElementById("confirmAddBtn").addEventListener("click", confirmAddBook);

function openBook(id, cardEl){
  currentBookId = id;
  timer = restoreTimerForBook(id) || { running:false, startTs:null, elapsed:0, bookId:id, sessionDate:todayStr() };
  if(timer.running){ clearInterval(timerInterval); timerInterval=setInterval(updateTimerDisplay,1000); }

  const rect = cardEl.getBoundingClientRect();
  const overlay = document.getElementById("overlay");
  overlay.style.top = rect.top+"px";
  overlay.style.left = rect.left+"px";
  overlay.style.width = rect.width+"px";
  overlay.style.height = rect.height+"px";
  overlay.style.borderRadius = "6px";
  overlay.classList.add("open");
  cardRectCache = rect;

  renderDetail();

  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      overlay.style.top = "0px";
      overlay.style.left = "0px";
      overlay.style.width = "100vw";
      overlay.style.height = "100vh";
      overlay.style.borderRadius = "0px";
      overlay.classList.add("expanded");
    });
  });
  pushHistory({ view:"detail", id });
}

function closeBook(){
  if(timer.running){ stopAndSaveSession(false); }
  const overlay = document.getElementById("overlay");
  overlay.classList.remove("expanded");
  if(cardRectCache){
    overlay.style.top = cardRectCache.top+"px";
    overlay.style.left = cardRectCache.left+"px";
    overlay.style.width = cardRectCache.width+"px";
    overlay.style.height = cardRectCache.height+"px";
    overlay.style.borderRadius = "6px";
  }
  setTimeout(()=>{
    overlay.classList.remove("open");
    overlay.removeAttribute("style");
    currentBookId = null;
    renderLibrary();
  }, 380);
  pushHistory({ view:"library" });
}

function getBook(){
  return data.books.find(b=>b.id === currentBookId);
}

async function updateBook(patch){
  const b = getBook();
  if(!b) return;
  Object.assign(b, patch, { updatedAt: Date.now() });
  if(!("plannedEnd" in patch)) ensurePlanned(b);
  await saveData();
}

function renderDetail(){
  const b = getBook();
  if(!b) return;
  const pct = pctOf(b);
  const circumference = 2*Math.PI*30;
  const dash = circumference * (pct/100);

  const totalMinutes = b.sessions.reduce((a,s)=>a+s.minutes,0);
  const totalMinutesStr = totalMinutes >= 60 ? `${Math.floor(totalMinutes/60)}시간 ${totalMinutes%60}분` : `${totalMinutes}분`;

  const quotesHtml = b.quotes.length === 0
    ? `<div class="empty-hint">아직 기록한 문구가 없어요.</div>`
    : b.quotes.slice().reverse().map(q=>`
      <div class="quote-item">
        <button class="del" data-qid="${q.id}">삭제</button>
        “${escapeHtml(q.text)}”
        ${q.page ? `<div class="qpage-tag">p.${q.page}</div>` : ""}
      </div>
    `).join("");

  const est = b.status === "in_progress" ? estimateFinish(b) : null;
  const earlyDays = (b.status === "done" && b.endDate && b.plannedEnd && b.endDate < b.plannedEnd) ? daysDiff(b.endDate, b.plannedEnd) : 0;
  const inner = document.getElementById("overlay-inner");
  inner.innerHTML = `
    <div class="detail-top">
      <button class="back-btn sans" id="backBtn">← 서재로</button>
      <select class="status-select" id="statusSelect">
        <option value="wishlist" ${b.status==="wishlist"?"selected":""}>읽고 싶음</option>
        <option value="not_started" ${b.status==="not_started"?"selected":""}>시작 전</option>
        <option value="in_progress" ${b.status==="in_progress"?"selected":""}>읽는 중</option>
        <option value="done" ${b.status==="done"?"selected":""}>완료</option>
        <option value="dropped" ${b.status==="dropped"?"selected":""}>중단</option>
      </select>
    </div>

    <label class="visibility-switch">
      <input type="checkbox" id="visibilityCheckbox" ${b.isPublic?"checked":""} />
      <span class="vs-track"><span class="vs-thumb"></span></span>
      <span class="vs-label sans">${b.isPublic ? "🌐 공개 중 — 친구가 공유 링크에서 볼 수 있어요" : "🔒 비공개 — 나만 볼 수 있어요"}</span>
    </label>

    <input class="book-title-input" id="titleInput" value="${escapeHtml(b.title)}" />
    <div class="book-meta-edit">
      <div class="meta-row"><span class="meta-label sans">작가</span><input id="authorInput" value="${escapeHtml(b.author||"")}" placeholder="입력해 주세요" /></div>
      <div class="meta-row"><span class="meta-label sans">출판사</span><input id="publisherInput" value="${escapeHtml(b.publisher||"")}" placeholder="입력해 주세요" /></div>
      <div class="meta-row"><span class="meta-label sans">옮긴이</span><input id="translatorInput" value="${escapeHtml(b.translator||"")}" placeholder="있다면 입력" /></div>
    </div>
    <div class="meta-dates">
      <div class="meta-date-chip ${b.startDate?"filled":""}">
        <span class="mdc-label sans">시작일 (눌러서 변경)</span>
        <input type="date" class="mdc-input" id="startDateInput" value="${b.startDate||""}" />
      </div>
      <div class="meta-date-chip ${b.endDate?"filled":""}">
        <span class="mdc-label sans">완료일 (눌러서 변경)</span>
        <input type="date" class="mdc-input" id="endDateInput" value="${b.endDate||""}" />
      </div>
    </div>

    <div class="detail-section">
      <h3 class="sans">진행률</h3>
      <div class="progress-row">
        <div class="ring-wrap">
          <svg width="74" height="74">
            <circle cx="37" cy="37" r="30" stroke="var(--paper-dim)" stroke-width="7" fill="none"/>
            <circle cx="37" cy="37" r="30" stroke="var(--cloth)" stroke-width="7" fill="none"
              stroke-dasharray="${circumference}" stroke-dashoffset="${circumference-dash}" stroke-linecap="round"/>
          </svg>
          <div class="ring-pct">${pct}%</div>
        </div>
        <div class="page-inputs">
          <input type="number" id="currentPageInput" value="${b.currentPage}" min="0" /> /
          <input type="number" id="totalPageInput" value="${b.totalPages}" min="0" /> 페이지
        </div>
      </div>
      <div class="finish-row sans">
        <div class="fr-item">
          <span class="fr-label">완독 예상일</span>
          <b>${est ? fmtDate(est.date) : "—"}</b>
          <span class="fr-note">${est ? `하루 평균 ${est.pace}쪽 기준` : "읽는 중 + 페이지를 기록하면 계산돼요"}</span>
        </div>
        <div class="fr-item">
          <span class="fr-label">목표 완독일 (눌러서 변경)</span>
          <input type="date" class="mdc-input" id="plannedEndInput" value="${b.plannedEnd||""}" />
          <span class="fr-note">시작 2일째부터 예상일로 자동 설정돼요</span>
        </div>
      </div>
      ${earlyDays > 0 ? `<div class="early-chip">⚡ 목표보다 ${earlyDays}일 일찍 완독했어요!</div>` : ""}
    </div>

    <div class="detail-section">
      <h3 class="sans">별점</h3>
      <div class="stars-edit" id="ratingStars">
        ${[1,2,3,4,5].map(i=>`<span class="star ${i<=(b.rating||0)?"filled":""}" data-val="${i}">★</span>`).join("")}
      </div>
    </div>

    <div class="detail-section">
      <h3 class="sans">장르 / 태그</h3>
      <div class="tag-input-row">
        <input id="genreInput" placeholder="예: 에세이, 소설, 자기계발" />
        <button class="secondary" id="addGenreBtn" type="button">추가</button>
      </div>
      <div class="tag-list">
        ${(b.genres||[]).map(g=>`<span class="tag-chip">${escapeHtml(g)}<span class="x" data-genre="${escapeHtml(g)}">✕</span></span>`).join("")}
      </div>
    </div>

    <div class="detail-section">
      <h3 class="sans">독서 타이머 · 누적 ${totalMinutesStr}</h3>
      <div class="timer-box">
        <div class="timer-display" id="timerDisplay">00:00:00</div>
        <div class="btn-row">
          <button id="timerToggle">${timer.running ? "읽기 종료" : "읽기 시작"}</button>
        </div>
        <div class="timer-note sans">읽기 시작을 누르고, 오늘 그만 읽을 때 읽기 종료를 누르면 이번 세션이 누적 시간에 더해져요. 다 읽을 때까지 여러 날에 걸쳐 반복하면 돼요.</div>
      </div>
    </div>

    <div class="detail-section">
      <h3 class="sans">좋았던 문구</h3>
      <div class="quote-form">
        <textarea id="quoteText" placeholder="마음에 남은 문구를 적어보세요"></textarea>
        <input class="qpage" id="quotePage" type="number" placeholder="p." />
      </div>
      <div class="btn-row" style="justify-content:flex-end; margin-bottom:16px;">
        <button class="secondary" id="addQuoteBtn">문구 추가</button>
      </div>
      ${quotesHtml}
    </div>

    <div class="detail-section">
      <h3 class="sans">이 책에서 얻은 것 (한 줄)</h3>
      <input class="takeaway-input" id="takeawayInput" value="${escapeHtml(b.takeaway||"")}" placeholder="배운 점이나 써먹고 싶은 점을 한 줄로 적어보세요" />
    </div>

    <div class="detail-section">
      <h3 class="sans">독후감</h3>
      <textarea class="review-area" id="reviewArea" placeholder="다 읽고 나서, 혹은 읽는 중간에도 생각을 남겨보세요.">${escapeHtml(b.review)}</textarea>
      <div class="review-save-row">
        <span class="save-hint sans" id="reviewSaveHint"></span>
        <button id="saveReviewBtn">독후감 저장</button>
      </div>
    </div>

    <div class="detail-section danger-zone">
      <button class="ghost" id="deleteBookBtn">이 책 삭제</button>
    </div>
  `;

  document.getElementById("backBtn").addEventListener("click", closeBook);

  document.getElementById("statusSelect").addEventListener("change", async (e)=>{
    const newStatus = e.target.value;
    const patch = { status:newStatus };
    if(newStatus === "in_progress"){
      if(!b.startDate) patch.startDate = todayStr();
      patch.endDate = null;
    }
    if(newStatus === "done"){
      if(!b.endDate) patch.endDate = todayStr();
      if(!b.startDate) patch.startDate = todayStr();
      if(b.totalPages) patch.currentPage = b.totalPages;
    }
    if(newStatus === "not_started" || newStatus === "wishlist"){ patch.startDate = null; patch.endDate = null; patch.plannedEnd = null; }
    await updateBook(patch);
    renderDetail();
  });

  document.getElementById("titleInput").addEventListener("blur", async (e)=>{
    await updateBook({ title: e.target.value.trim() || "제목 없음" });
  });
  ["startDate","endDate"].forEach(field=>{
    const input = document.getElementById(field+"Input");
    const chip = input.closest(".meta-date-chip");
    chip.addEventListener("click", ()=>{ try{ input.showPicker(); }catch(_){} });
    input.addEventListener("change", async (e)=>{
      await updateBook({ [field]: e.target.value || null });
      renderDetail();
    });
  });
  document.getElementById("visibilityCheckbox").addEventListener("change", async (e)=>{
    await updateBook({ isPublic: e.target.checked });
    renderDetail();
  });
  document.getElementById("takeawayInput").addEventListener("blur", async (e)=>{
    await updateBook({ takeaway: e.target.value.trim() });
  });
  document.getElementById("takeawayInput").addEventListener("keydown", (e)=>{ if(e.key === "Enter") e.target.blur(); });
  const plannedInput = document.getElementById("plannedEndInput");
  plannedInput.addEventListener("click", ()=>{ try{ plannedInput.showPicker(); }catch(_){} });
  plannedInput.addEventListener("change", async (e)=>{
    await updateBook({ plannedEnd: e.target.value || null });
    renderDetail();
  });
  document.getElementById("authorInput").addEventListener("blur", async (e)=>{
    await updateBook({ author: e.target.value.trim() });
  });
  document.getElementById("publisherInput").addEventListener("blur", async (e)=>{
    await updateBook({ publisher: e.target.value.trim() });
  });
  document.getElementById("translatorInput").addEventListener("blur", async (e)=>{
    await updateBook({ translator: e.target.value.trim() });
  });

  document.getElementById("currentPageInput").addEventListener("change", async (e)=>{
    const cp = Math.max(0, Math.min(b.totalPages || Number.MAX_SAFE_INTEGER, parseInt(e.target.value)||0));
    const patch = { currentPage: cp };
    if(cp > 0 && (b.status === "not_started" || b.status === "wishlist")){
      patch.status = "in_progress";
      if(!b.startDate) patch.startDate = todayStr();
    }
    await updateBook(patch);
    renderDetail();
  });
  document.getElementById("totalPageInput").addEventListener("change", async (e)=>{
    const totalPages=Math.max(0, parseInt(e.target.value)||0);
    await updateBook({ totalPages, currentPage: totalPages>0 ? Math.min(b.currentPage||0,totalPages) : (b.currentPage||0) });
    renderDetail();
  });

  document.getElementById("ratingStars").addEventListener("click", async (e)=>{
    const star = e.target.closest(".star");
    if(!star) return;
    const val = parseInt(star.dataset.val);
    await updateBook({ rating: (b.rating===val) ? 0 : val });
    renderDetail();
  });

  document.getElementById("addGenreBtn").addEventListener("click", async ()=>{
    const input = document.getElementById("genreInput");
    const val = input.value.trim();
    if(!val) return;
    b.genres = b.genres || [];
    if(!b.genres.includes(val)) b.genres.push(val);
    await updateBook({});
    renderDetail();
  });
  document.querySelectorAll("#overlay-inner .tag-chip .x").forEach(x=>{
    x.addEventListener("click", async ()=>{
      b.genres = (b.genres||[]).filter(g=>g!==x.dataset.genre);
      await updateBook({});
      renderDetail();
    });
  });

  document.getElementById("timerToggle").addEventListener("click", ()=>{
    if(timer.running){
      stopAndSaveSession(true);
    }else{
      timer.startTs = Date.now() - timer.elapsed*1000;
      timer.running = true;
      timer.bookId = currentBookId;
      timer.sessionDate = timer.sessionDate || todayStr();
      persistTimer();
      clearInterval(timerInterval);
      timerInterval = setInterval(updateTimerDisplay, 1000);
      renderDetail();
    }
  });

  document.getElementById("addQuoteBtn").addEventListener("click", async ()=>{
    const text = document.getElementById("quoteText").value.trim();
    const page = document.getElementById("quotePage").value;
    if(!text) return;
    b.quotes.push({ id:"q_"+Date.now(), text, page: page ? parseInt(page) : null });
    await updateBook({});
    renderDetail();
  });

  inner.querySelectorAll(".quote-item .del").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      b.quotes = b.quotes.filter(q=>q.id !== btn.dataset.qid);
      await updateBook({});
      renderDetail();
    });
  });

  document.getElementById("saveReviewBtn").addEventListener("click", async ()=>{
    await updateBook({ review: document.getElementById("reviewArea").value });
    document.getElementById("reviewSaveHint").textContent = "저장됨";
    setTimeout(()=>{ const h=document.getElementById("reviewSaveHint"); if(h) h.textContent=""; }, 1800);
  });

  document.getElementById("deleteBookBtn").addEventListener("click", async ()=>{
    if(!confirm("이 책 기록을 정말 삭제할까요? 되돌릴 수 없어요.")) return;
    data.books = data.books.filter(x=>x.id !== b.id);
    await saveData();
    closeBook();
  });

  updateTimerDisplay();
}

async function stopAndSaveSession(showFeedback){
  const b = getBook();
  if(timer.running){
    timer.elapsed = Math.floor((Date.now()-timer.startTs)/1000);
    clearInterval(timerInterval);
  }
  const minutes = Math.round(timer.elapsed/60);
  if(minutes > 0 && b){
    b.sessions.push({ date: timer.sessionDate || todayStr(), minutes });
    if(b.status === "not_started" || b.status === "wishlist"){
      b.status = "in_progress";
      if(!b.startDate) b.startDate = todayStr();
    }
    await updateBook({});
  }
  timer = { running:false, startTs:null, elapsed:0, bookId:null, sessionDate:null };
  clearPersistedTimer();
  if(showFeedback) renderDetail();
}

function updateTimerDisplay(){
  if(timer.running){
    timer.elapsed = Math.floor((Date.now()-timer.startTs)/1000);
    if(timer.elapsed % 30 === 0) persistTimer();
  }
  const h = String(Math.floor(timer.elapsed/3600)).padStart(2,"0");
  const m = String(Math.floor((timer.elapsed%3600)/60)).padStart(2,"0");
  const s = String(timer.elapsed%60).padStart(2,"0");
  const el = document.getElementById("timerDisplay");
  if(el) el.textContent = `${h}:${m}:${s}`;
}

// ---------- Supabase GitHub Login ----------
async function signInWithGitHub() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: "https://binnaaaak.github.io/Bookaholic_gpt/"
    }
  });

  if (error) {
    alert("GitHub 로그인 중 오류가 발생했습니다.");
    console.error(error);
  }
}

async function signOutFromSupabase() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
    console.error(error);
    return;
  }

  // 로그아웃 후에는 게스트 저장공간 사용
  currentStorageKey = getUserStorageKey(null);

  // 현재 메모리에 남아 있는 개인 데이터 비우기
  data = normalizeData({
    schemaVersion: SCHEMA_VERSION,
    books: [],
    baselineBooks: 0,
    routines: []
  });

  // 로그아웃 상태로 사이트를 자동 새로고침
  window.location.reload();
}

function updateAuthUI(session) {
  const loginBtn = document.getElementById("githubLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const authStatus = document.getElementById("authStatus");
  const cloudBackupBtn = document.getElementById("cloudBackupBtn");

  if (!loginBtn || !logoutBtn || !cloudBackupBtn || !authStatus) return;

  if (session && session.user) {
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    cloudBackupBtn.classList.remove("hidden");

    const username =
      session.user.user_metadata?.user_name ||
      session.user.user_metadata?.preferred_username ||
      session.user.email ||
      "로그인됨";

    authStatus.textContent = username;
  } else {
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    cloudBackupBtn.classList.add("hidden");
    authStatus.textContent = "";
  }
}

document.getElementById("githubLoginBtn")?.addEventListener("click", signInWithGitHub);
document.getElementById("logoutBtn")?.addEventListener("click", signOutFromSupabase);

document.getElementById("emailAuthBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("emailAuthModal");
  const message = document.getElementById("emailAuthMessage");

  if (message) {
    message.textContent = "";
  }

  if (modal) {
    modal.classList.remove("hidden");
  }
});

document.getElementById("emailAuthCancelBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("emailAuthModal");

  if (modal) {
    modal.classList.add("hidden");
  }
});

document.getElementById("emailSignUpBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("emailAuthEmail")?.value.trim();
  const password = document.getElementById("emailAuthPassword")?.value;
  const message = document.getElementById("emailAuthMessage");

  if (!email || !password) {
    if (message) {
      message.textContent = "이메일과 비밀번호를 모두 입력해 주세요.";
    }
    return;
  }

  if (message) {
    message.textContent = "회원가입 처리 중...";
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: {
      emailRedirectTo: "https://binnaaaak.github.io/Bookaholic_gpt/"
    }
  });

  if (error) {
    console.error(error);

    if (message) {
      message.textContent = "회원가입에 실패했습니다: " + error.message;
    }

    return;
  }

  if (message) {
    message.textContent =
      "회원가입 요청이 완료됐습니다. 이메일로 받은 인증 링크를 확인해 주세요.";
  }
});

supabaseClient.auth.onAuthStateChange((event, session) => {
  updateAuthUI(session);
});

supabaseClient.auth.getSession().then(async ({ data: sessionData }) => {
  const session = sessionData.session;

  updateAuthUI(session);

  if (session?.user) {
    // 로그인한 사용자는 자기 전용 데이터만 불러옴
    currentStorageKey = getUserStorageKey(session.user.id);

    await copyLegacyDataToCurrentUser();
    await loadData();

  } else {
    // 로그아웃 상태에서는 어떤 로컬 데이터도 불러오지 않음
    currentStorageKey = getUserStorageKey(null);

    data = normalizeData({
      schemaVersion: SCHEMA_VERSION,
      books: [],
      baselineBooks: 0,
      routines: []
    });

    applyMbo();
  }
});

// ---------- Supabase Cloud Backup ----------
async function backupDataToSupabase() {
  try {
    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      alert("먼저 GitHub로 로그인해 주세요.");
      return;
    }

    // 기존 클라우드 데이터가 있는지 확인
    const { data: existing, error: readError } = await supabaseClient
      .from("user_data")
      .select("user_id, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (readError) {
      console.error(readError);
      alert("클라우드 데이터를 확인하지 못했습니다.");
      return;
    }

    // 이미 백업이 있다면 실수로 덮어쓰지 않도록 확인
    if (existing) {
      const lastBackup = existing.updated_at
        ? new Date(existing.updated_at).toLocaleString()
        : "알 수 없음";

      const ok = confirm(
        `이미 클라우드 백업이 있습니다.\n\n마지막 백업: ${lastBackup}\n\n현재 브라우저 데이터로 덮어쓸까요?`
      );

      if (!ok) return;
    }

    const { error: saveError } = await supabaseClient
      .from("user_data")
      .upsert(
        {
          user_id: user.id,
          data: data,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "user_id"
        }
      );

    if (saveError) {
      console.error(saveError);
      alert("클라우드 백업에 실패했습니다.");
      return;
    }

    alert("클라우드 백업이 완료됐습니다.");
  } catch (err) {
    console.error(err);
    alert("백업 중 오류가 발생했습니다.");
  }
}

document
  .getElementById("cloudBackupBtn")
  ?.addEventListener("click", backupDataToSupabase);
