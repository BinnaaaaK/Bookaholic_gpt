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

function showToast(message, type = "success", duration = 3500) {
  const toast = document.getElementById("globalToast");

  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("hidden", "success", "error");
  toast.classList.add(type);

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

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
  await saveData({backup:false, cloud:false});
  await maybeAutoBackup();
  showMbo();
}
async function saveData(opts={}){
  try{
    data=normalizeData(data);
    localStorage.setItem(currentStorageKey, JSON.stringify(data));
    if(opts.cloud !== false) await syncDataToSupabase();
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
  document.getElementById("bookmarkText").textContent = tr(`${earned}개`);
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
  bh += early.map(e => `<div class="badge on early"><div class="badge-icon">⚡</div><b>${e.days}일 앞당김</b><span data-i18n-ignore="true">${escapeHtml(e.title||"")}</span></div>`).join("");
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

  const range =
    `${shortMonthDay(monday)}~${shortMonthDay(sunday)}`;

  if(offset === 0) {
    return `${tr("이번 주")} · ${range}`;
  }

  if(offset === 1) {
    return `${tr("지난주")} · ${range}`;
  }

  if(offset === 2) {
    return `${tr("지지난주")} · ${range}`;
  }

  return `${tr(weekMonthLabel(monday))} · ${range}`;
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
    
    const currentUiLang =
      window.I18N?.getLanguage?.() || "ko";
    
    const weekOptionsKey =
      `16-weeks-v2-${currentUiLang}`;
    
    if(weekSelect.dataset.filled !== weekOptionsKey){
      weekSelect.innerHTML = optionHtml.join("");
      weekSelect.dataset.filled = weekOptionsKey;
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
      return {
      label: `${y.slice(2)}'  ${tr(`${parseInt(bestM[0])}월`)}↑`,
      value: yearCount[y]
    };
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


function validatePasswordStrength(password){
  if(typeof password !== "string" || password.length < 8){
    return "비밀번호는 8자 이상이어야 합니다.";
  }
  if(!/[A-Z]/.test(password)){
    return "비밀번호에 대문자를 1자 이상 포함해 주세요.";
  }
  if(!/[a-z]/.test(password)){
    return "비밀번호에 소문자를 1자 이상 포함해 주세요.";
  }
  if(!/\d/.test(password)){
    return "비밀번호에 숫자를 1자 이상 포함해 주세요.";
  }
  if(!/[^A-Za-z0-9]/.test(password)){
    return "비밀번호에 특수문자를 1자 이상 포함해 주세요.";
  }
  return "";
}

function signUpLooksLikeExistingAccount(data){
  const identities = data?.user?.identities;
  return Array.isArray(identities) && identities.length === 0;
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
  const setPasswordBtn = document.getElementById("setPasswordBtn");

  if (!loginBtn || !logoutBtn || !cloudBackupBtn || !setPasswordBtn || !authStatus) return;

  if (session && session.user) {
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    cloudBackupBtn.classList.remove("hidden");
    setPasswordBtn.classList.remove("hidden");

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
    setPasswordBtn.classList.add("hidden");
    authStatus.textContent = "";
  }
}

document.getElementById("githubLoginBtn")?.addEventListener("click", signInWithGitHub);
document.getElementById("logoutBtn")?.addEventListener("click", signOutFromSupabase);

document.getElementById("authGateGithubBtn")?.addEventListener("click", signInWithGitHub);

document.getElementById("authGateEmailBtn")?.addEventListener("click", () => {
  document.getElementById("emailAuthBtn")?.click();
});

document.getElementById("emailAuthBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("emailAuthModal");
  const message = document.getElementById("emailAuthMessage");
  const confirmGroup = document.getElementById("emailPasswordConfirmGroup");
  const signUpBtn = document.getElementById("emailSignUpBtn");
  const passwordConfirm = document.getElementById("emailAuthPasswordConfirm");

  // 로그인 창을 열 때 항상 기본 로그인 상태로 초기화
  if (confirmGroup) {
    confirmGroup.classList.add("hidden");
  }

  if (signUpBtn) {
    signUpBtn.textContent = "회원가입";
  }

  if (passwordConfirm) {
    passwordConfirm.value = "";
  }

  if (message) {
    message.textContent = "";
  }

  if (modal) {
    modal.classList.remove("hidden");
  }
});

document.getElementById("emailAuthCancelBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("emailAuthModal");
  const confirmGroup = document.getElementById("emailPasswordConfirmGroup");
  const signUpBtn = document.getElementById("emailSignUpBtn");
  const passwordConfirm = document.getElementById("emailAuthPasswordConfirm");
  const message = document.getElementById("emailAuthMessage");

  // 비밀번호 확인칸 다시 숨기기
  if (confirmGroup) {
    confirmGroup.classList.add("hidden");
  }

  // 버튼 이름 원래대로
  if (signUpBtn) {
    signUpBtn.textContent = "회원가입";
  }

  // 비밀번호 확인값 지우기
  if (passwordConfirm) {
    passwordConfirm.value = "";
  }

  // 안내문 지우기
  if (message) {
    message.textContent = "";
  }

  // 로그인 창 닫기
  if (modal) {
    modal.classList.add("hidden");
  }
});

document.getElementById("forgotPasswordBtn")?.addEventListener("click", async () => {
  const email =
    document.getElementById("emailAuthEmail")?.value.trim();

  const message =
    document.getElementById("emailAuthMessage");

  if (!email) {
    if (message) {
      message.textContent =
        "비밀번호를 재설정할 이메일을 먼저 입력해 주세요.";
    }
    return;
  }

  if (message) {
    message.textContent =
      "비밀번호 재설정 메일을 보내는 중...";
  }

  const { error } =
    await supabaseClient.auth.resetPasswordForEmail(
      email,
      {
        redirectTo:
          "https://binnaaaak.github.io/Bookaholic_gpt/"
      }
    );

  if (error) {
  console.error(
    "비밀번호 재설정 메일 전송 실패:",
    error
  );

  if (message) {
    message.textContent = "";
  }

  if (error.message?.includes("rate limit")) {
    showToast(
      "재설정 메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.",
      "error"
    );
  } else {
    showToast(
      "비밀번호 재설정 메일 전송에 실패했습니다.",
      "error"
    );
  }

  return;
}

if (message) {
  message.textContent = "";
}
  
showToast(
  "비밀번호 재설정 메일을 보냈습니다. 이메일을 확인해 주세요.",
  "success"
);
});

document.getElementById("setPasswordBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("setPasswordModal");
  const message = document.getElementById("setPasswordMessage");

  if (message) {
    message.textContent = "";
  }

  if (modal) {
    modal.classList.remove("hidden");
  }
});

document.getElementById("setPasswordCancelBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("setPasswordModal");

  if (modal) {
    modal.classList.add("hidden");
  }
});

document.getElementById("setPasswordSaveBtn")?.addEventListener("click", async () => {
  const password =
    document.getElementById("newAccountPassword")?.value;

  const passwordConfirm =
    document.getElementById("newAccountPasswordConfirm")?.value;

  const message =
    document.getElementById("setPasswordMessage");

  if (!password || !passwordConfirm) {
    if (message) {
      message.textContent = "새 비밀번호를 두 번 입력해 주세요.";
    }
    return;
  }

  if (password !== passwordConfirm) {
    if (message) {
      message.textContent = "비밀번호가 서로 일치하지 않습니다.";
    }
    return;
  }

  const passwordIssue = validatePasswordStrength(password);
  if (passwordIssue) {
    if (message) {
      message.textContent = passwordIssue;
    }
    return;
  }

  if (message) {
    message.textContent = "비밀번호 설정 중...";
  }

  const { data, error } = await supabaseClient.auth.updateUser({
    password: password
  });

  if (error) {
    console.error("비밀번호 설정 실패:", error);

    if (message) {
      message.textContent =
        "비밀번호 설정에 실패했습니다: " + error.message;
    }

    return;
  }

  if (message) {
    message.textContent =
      "비밀번호가 설정되었습니다. 이제 이메일과 비밀번호로도 로그인할 수 있습니다.";
  }

  document.getElementById("newAccountPassword").value = "";
  document.getElementById("newAccountPasswordConfirm").value = "";
});

document.getElementById("emailSignUpBtn")?.addEventListener("click", async () => {
  const confirmGroup = document.getElementById("emailPasswordConfirmGroup");
  const signUpBtn = document.getElementById("emailSignUpBtn");
  const message = document.getElementById("emailAuthMessage");

  // 첫 번째 클릭: 회원가입 입력 화면으로 전환
  if (confirmGroup?.classList.contains("hidden")) {
    confirmGroup.classList.remove("hidden");

    if (signUpBtn) {
      signUpBtn.textContent = "회원가입 완료";
    }

    if (message) {
      message.textContent =
        "비밀번호를 한 번 더 입력한 뒤 회원가입 완료를 눌러 주세요.";
    }

    return;
  }

  // 두 번째 클릭: 실제 회원가입 진행
  const email = document.getElementById("emailAuthEmail")?.value.trim();
  const password = document.getElementById("emailAuthPassword")?.value;
  const passwordConfirm =
    document.getElementById("emailAuthPasswordConfirm")?.value;

  if (!email || !password || !passwordConfirm) {
    if (message) {
      message.textContent =
        "이메일과 비밀번호를 모두 입력해 주세요.";
    }
    return;
  }

  if (password !== passwordConfirm) {
    if (message) {
      message.textContent =
        "비밀번호가 서로 일치하지 않습니다.";
    }
    return;
  }

  const passwordIssue = validatePasswordStrength(password);
  if (passwordIssue) {
    if (message) {
      message.textContent = passwordIssue;
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

  if (signUpLooksLikeExistingAccount(data)) {
    if (message) {
      message.textContent =
        "이미 가입된 이메일일 수 있습니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.";
    }
    return;
  }

  if (message) {
    message.textContent =
      "회원가입 요청이 완료됐습니다. 이메일로 받은 인증 링크를 확인해 주세요.";
  }
});

document.getElementById("emailLoginBtn")?.addEventListener("click", async () => {
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
    message.textContent = "로그인 중...";
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    console.error(error);

    if (message) {
      message.textContent = "로그인에 실패했습니다: " + error.message;
    }

    return;
  }

  if (message) {
    message.textContent = "로그인되었습니다.";
  }

  document.getElementById("emailAuthModal")?.classList.add("hidden");

  window.location.reload();
});

supabaseClient.auth.onAuthStateChange((event, session) => {
  updateAuthUI(session);

  // 비밀번호 재설정 이메일의 링크를 통해 들어온 경우
  if (event === "PASSWORD_RECOVERY") {
    const modal = document.getElementById("setPasswordModal");
    const message = document.getElementById("setPasswordMessage");

    if (message) {
      message.textContent = "새로운 비밀번호를 설정해 주세요.";
    }

    if (modal) {
      modal.classList.remove("hidden");
    }
  }
});

supabaseClient.auth.getSession().then(async ({ data: sessionData }) => {
  const session = sessionData.session;

  updateAuthUI(session);

  if (session?.user) {
    document.body.classList.remove("auth-locked");
    
    // 로그인 상태: 로그인 전용 화면 숨기기
    document.getElementById("authGate")?.classList.add("hidden");

    // 이 사용자 전용 저장공간 선택
    currentStorageKey = getUserStorageKey(session.user.id);

// 로그인하면 Supabase의 최신 데이터를 우선 확인
const restored = await restoreCloudDataToCurrentUser();

if (restored) {
  // 클라우드 데이터가 있으면 그것을 최신 데이터로 사용
  await loadData();
} else {
  // 클라우드 데이터가 없는 신규 사용자는
  // 현재 사용자 전용 로컬 데이터가 있으면 사용
  const hasLocalData = !!localStorage.getItem(currentStorageKey);

  if (hasLocalData) {
    await loadData();
  } else {
    // 정말 처음 가입한 사용자는 빈 MBO로 시작
    data = normalizeData({
      schemaVersion: SCHEMA_VERSION,
      books: [],
      baselineBooks: 0,
      routines: []
    });

    await saveData({
      backup: false,
      cloud: false
    });

    applyMbo();
  }
}

  } else {
    document.body.classList.add("auth-locked");
    
    // 로그아웃 상태: 개인 화면 전부 숨기기
    currentStorageKey = getUserStorageKey(null);

    data = normalizeData({
      schemaVersion: SCHEMA_VERSION,
      books: [],
      baselineBooks: 0,
      routines: []
    });

    // MBO, 서재 등 기존 화면 숨기기
    hideAllScreens();

    // 로그인 / 회원가입 시작 화면만 표시
    document.getElementById("authGate")?.classList.remove("hidden");
  }
});


// ---------- Supabase Cloud Load ----------
async function loadDataFromSupabase() {
  try {
    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.log("로그인된 사용자가 없습니다.");
      return null;
    }

    const { data: row, error: loadError } = await supabaseClient
      .from("user_data")
      .select("data, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadError) {
      console.error("클라우드 데이터 불러오기 실패:", loadError);
      return null;
    }

    if (!row || !row.data) {
      console.log("이 사용자에게 저장된 클라우드 데이터가 없습니다.");
      return null;
    }

    return {
      data: row.data,
      updatedAt: row.updated_at
    };

  } catch (err) {
    console.error("클라우드 데이터 불러오기 중 오류:", err);
    return null;
  }
}

async function restoreCloudDataToCurrentUser() {
  const cloud = await loadDataFromSupabase();

  if (!cloud || !cloud.data) {
    console.log("복원할 클라우드 데이터가 없습니다.");
    return false;
  }

  try {
    const restoredData = normalizeData(cloud.data);

    localStorage.setItem(
      currentStorageKey,
      JSON.stringify(restoredData)
    );

    data = restoredData;

    console.log(
      "클라우드 데이터를 현재 사용자 저장공간에 복원했습니다.",
      cloud.updatedAt
    );

    return true;

  } catch (error) {
    console.error("클라우드 데이터 복원 실패:", error);
    return false;
  }
}

// ---------- Supabase Auto Sync ----------
async function syncDataToSupabase() {
  try {
    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();

    // 로그인하지 않은 상태에서는 클라우드 저장 안 함
    if (userError || !user) {
      return false;
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
      console.error("자동 클라우드 저장 실패:", saveError);
      return false;
    }

    console.log("Supabase 자동 저장 완료");
    return true;

  } catch (error) {
    console.error("자동 클라우드 저장 중 오류:", error);
    return false;
  }
}

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
/* ==========================================================================
   Bookaholic UX Suite 2–14
   - Account menu / settings / save-state / reading-goal analytics
   - Wake-up trend explorer / guided onboarding / integrated insights
   - Extra badges / accessibility / diagnostics
   ========================================================================== */
(() => {
  const UX_PREFS_KEY = "bookaholic-ux-prefs-v1";
  const ONBOARDING_KEY = "bookaholic-onboarding-v1";
  const LOCAL_SAVE_META_PREFIX = "bookaholic-local-save-at:";
  const CLOUD_SAVE_META_PREFIX = "bookaholic-cloud-save-at:";
  const state = {
    readingView: localStorage.getItem("bookaholic-reading-goal-view") || "week",
    wakeView: localStorage.getItem("bookaholic-wake-view") || "month",
    qtView: localStorage.getItem("bookaholic-qt-goal-view") || "week",
    wakeYear: null,
    wakePeriod: null,
    onboardingIndex: 0,
    onboardingSteps: [],
    activeGuideKey: null,
    saveTimer: null
  };

  const uxTr = (text) => {
    try { return tr(text); } catch(_) { return String(text); }
  };

  function getPrefs(){
    try{
      return {
        fontScale: 100,
        compact: false,
        reduceMotion: false,
        ...JSON.parse(localStorage.getItem(UX_PREFS_KEY) || "{}")
      };
    }catch(_){
      return { fontScale:100, compact:false, reduceMotion:false };
    }
  }

  function savePrefs(next){
    const prefs={...getPrefs(),...next};
    localStorage.setItem(UX_PREFS_KEY,JSON.stringify(prefs));
    applyPrefs(prefs);
    return prefs;
  }

  function applyPrefs(prefs=getPrefs()){
    document.documentElement.style.setProperty("--ux-font-scale", String((prefs.fontScale||100)/100));
    document.body.classList.toggle("ux-compact", !!prefs.compact);
    document.body.classList.toggle("ux-reduce-motion", !!prefs.reduceMotion);
  }

  function currentSessionEmail(session){
    return session?.user?.email ||
      session?.user?.user_metadata?.user_name ||
      session?.user?.user_metadata?.preferred_username ||
      "";
  }

  function ensureSaveIndicator(){
    let el=document.getElementById("saveStateIndicator");
    if(el) return el;
    el=document.createElement("div");
    el.id="saveStateIndicator";
    el.className="save-state-indicator sans";
    el.setAttribute("role","status");
    el.setAttribute("aria-live","polite");
    el.innerHTML=`<span class="save-state-dot"></span><span class="save-state-text">${uxTr("저장됨")}</span>`;
    document.body.appendChild(el);
    return el;
  }

  function setSaveState(kind, customText=""){
    const el=ensureSaveIndicator();
    clearTimeout(state.saveTimer);
    el.dataset.state=kind;
    const textEl=el.querySelector(".save-state-text");
    const labels={
      saving:"저장 중…",
      saved:"저장됨",
      syncing:"클라우드 동기화 중…",
      offline:"오프라인 · 기기에 저장됨",
      error:"저장 실패"
    };
    textEl.textContent=customText || uxTr(labels[kind] || labels.saved);
    el.classList.add("visible");
    if(kind==="saved"){
      state.saveTimer=setTimeout(()=>el.classList.remove("visible"),2200);
    }
  }

  function ensureSettingsModal(){
    if(document.getElementById("uxSettingsModal")) return;
    const modal=document.createElement("div");
    modal.id="uxSettingsModal";
    modal.className="modal hidden ux-settings-modal";
    modal.innerHTML=`
      <div class="modal-box ux-settings-box" role="dialog" aria-modal="true" aria-labelledby="uxSettingsTitle">
        <div class="ux-settings-head">
          <div>
            <p class="home-eyebrow">${uxTr("설정")}</p>
            <h3 id="uxSettingsTitle">${uxTr("사용 환경")}</h3>
          </div>
          <button type="button" class="secondary ux-icon-only" id="uxSettingsClose" aria-label="${uxTr("닫기")}">×</button>
        </div>

        <div class="ux-setting-group">
          <label for="uxLanguageSelect">${uxTr("언어")}</label>
          <select id="uxLanguageSelect" class="ux-setting-select"></select>
        </div>

        <div class="ux-setting-group">
          <div class="ux-setting-row">
            <label for="uxFontScale">${uxTr("글자 크기")}</label>
            <span id="uxFontScaleValue" class="rc-sub"></span>
          </div>
          <input id="uxFontScale" type="range" min="90" max="120" step="5" />
        </div>

        <label class="ux-setting-toggle">
          <input id="uxCompactMode" type="checkbox" />
          <span><b>${uxTr("컴팩트 모드")}</b><small>${uxTr("작은 화면에서 더 많은 내용을 보여줘요.")}</small></span>
        </label>

        <label class="ux-setting-toggle">
          <input id="uxReduceMotion" type="checkbox" />
          <span><b>${uxTr("애니메이션 줄이기")}</b><small>${uxTr("화면 전환 움직임을 최소화해요.")}</small></span>
        </label>

        <div class="ux-settings-actions">
          <button type="button" class="secondary" id="uxRestartTour">${uxTr("사용 가이드 다시 보기")}</button>
          <button type="button" class="secondary" id="uxRunQa">${uxTr("화면 자가 점검")}</button>
          <button type="button" id="uxSaveNow">${uxTr("지금 저장")}</button>
        </div>
        <p class="rc-note">${uxTr("화면은 휴대폰·태블릿·PC 크기에 맞춰 자동으로 조정됩니다.")}</p>
      </div>`;
    document.body.appendChild(modal);

    const lang=modal.querySelector("#uxLanguageSelect");
    const languages=window.I18N?.LANGUAGES || [];
    lang.innerHTML=languages.map(x=>`<option value="${escapeAttr(x.code)}">${escapeHtml(x.label)}</option>`).join("");
    lang.value=window.I18N?.getLanguage?.() || "ko";

    const prefs=getPrefs();
    const range=modal.querySelector("#uxFontScale");
    const rangeVal=modal.querySelector("#uxFontScaleValue");
    range.value=String(prefs.fontScale||100);
    rangeVal.textContent=`${range.value}%`;
    modal.querySelector("#uxCompactMode").checked=!!prefs.compact;
    modal.querySelector("#uxReduceMotion").checked=!!prefs.reduceMotion;

    modal.querySelector("#uxSettingsClose").onclick=()=>modal.classList.add("hidden");
    modal.addEventListener("click",(e)=>{ if(e.target===modal) modal.classList.add("hidden"); });
    lang.onchange=()=>window.I18N?.setLanguage?.(lang.value);
    range.oninput=()=>{ rangeVal.textContent=`${range.value}%`; savePrefs({fontScale:Number(range.value)}); };
    modal.querySelector("#uxCompactMode").onchange=(e)=>savePrefs({compact:e.target.checked});
    modal.querySelector("#uxReduceMotion").onchange=(e)=>savePrefs({reduceMotion:e.target.checked});
    modal.querySelector("#uxRestartTour").onclick=()=>{ modal.classList.add("hidden"); startOnboarding(true); };
    modal.querySelector("#uxRunQa").onclick=()=>{
      const result=window.runBookaholicQA?.() || [];
      const failed=result.filter(x=>!x.pass).length;
      showToast(failed?`${failed}${uxTr("개 점검 항목을 확인해 주세요.")}`:uxTr("자가 점검을 통과했습니다."),failed?"error":"success");
    };
    modal.querySelector("#uxSaveNow").onclick=async()=>{
      setSaveState("saving");
      const ok=await saveData();
      showToast(ok?uxTr("저장되었습니다."):uxTr("저장에 실패했습니다."),ok?"success":"error");
    };
  }

  function openSettings(){
    ensureSettingsModal();
    const modal=document.getElementById("uxSettingsModal");
    const lang=modal.querySelector("#uxLanguageSelect");
    if(lang) lang.value=window.I18N?.getLanguage?.() || "ko";
    modal.classList.remove("hidden");
  }

  function ensureAccountDock(){
    if(document.getElementById("accountDock")) return;
    const dock=document.createElement("div");
    dock.id="accountDock";
    dock.className="account-dock sans hidden";
    dock.innerHTML=`
      <button type="button" id="accountDockToggle" class="account-dock-toggle" aria-haspopup="menu" aria-expanded="false">
        <span class="account-avatar">●</span>
        <span class="account-dock-label">${uxTr("계정")}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <div id="accountDockMenu" class="account-dock-menu hidden" role="menu">
        <div class="account-dock-user">
          <span>${uxTr("로그인 계정")}</span>
          <strong id="accountDockEmail">—</strong>
        </div>
        <button type="button" id="accountCloudAction" role="menuitem">☁️ ${uxTr("클라우드 백업")}</button>
        <button type="button" id="accountPasswordAction" role="menuitem">🔐 ${uxTr("비밀번호 설정")}</button>
        <button type="button" id="accountSettingsAction" role="menuitem">⚙️ ${uxTr("설정")}</button>
        <button type="button" id="accountTourAction" role="menuitem">🧭 ${uxTr("사용 가이드")}</button>
        <div class="account-dock-sep"></div>
        <button type="button" id="accountLogoutAction" class="danger-link" role="menuitem">${uxTr("로그아웃")}</button>
      </div>`;
    document.body.appendChild(dock);

    const toggle=dock.querySelector("#accountDockToggle");
    const menu=dock.querySelector("#accountDockMenu");
    toggle.onclick=()=>{
      const open=menu.classList.toggle("hidden")===false;
      toggle.setAttribute("aria-expanded",String(open));
    };
    document.addEventListener("click",(e)=>{
      if(!dock.contains(e.target)){
        menu.classList.add("hidden");
        toggle.setAttribute("aria-expanded","false");
      }
    });
    dock.querySelector("#accountCloudAction").onclick=()=>document.getElementById("cloudBackupBtn")?.click();
    dock.querySelector("#accountPasswordAction").onclick=()=>document.getElementById("setPasswordBtn")?.click();
    dock.querySelector("#accountSettingsAction").onclick=openSettings;
    dock.querySelector("#accountTourAction").onclick=()=>startOnboarding(true);
    dock.querySelector("#accountLogoutAction").onclick=()=>document.getElementById("logoutBtn")?.click();

    document.querySelector(".global-auth-box")?.classList.add("ux-legacy-auth");
  }

  function updateAccountDock(session){
    ensureAccountDock();
    const dock=document.getElementById("accountDock");
    if(session?.user && !document.body.classList.contains("auth-locked")){
      dock.classList.remove("hidden");
      dock.querySelector("#accountDockEmail").textContent=currentSessionEmail(session)||uxTr("로그인됨");
    }else{
      dock.classList.add("hidden");
      dock.querySelector("#accountDockMenu")?.classList.add("hidden");
    }
  }

  function completedBooksBetween(start,end){
    return data.books.filter(b=>{
      if(b.status!=="done" || !b.endDate) return false;
      const d=parseD(b.endDate);
      return d>=start && d<=end;
    }).length;
  }

  function readingGoalSeries(view){
    const goal=Math.max(1,Number(data.weeklyGoal)||2);
    const now=new Date(); now.setHours(0,0,0,0);
    if(view==="week"){
      const base=startOfWeekMonday(now);
      const items=[];
      for(let offset=7; offset>=0; offset--){
        const s=new Date(base); s.setDate(s.getDate()-offset*7);
        const e=new Date(s); e.setDate(e.getDate()+6);
        items.push({
          label:`${s.getMonth()+1}/${s.getDate()}`,
          value:completedBooksBetween(s,e),
          target:goal
        });
      }
      return {items,target:goal,targetLabel:`${goal}${uxTr("권")}/${uxTr("주")}`};
    }
    if(view==="month"){
      const year=statsMonthYear || now.getFullYear();
      const target=Math.max(1,Math.round(goal*52/12));
      const items=Array.from({length:12},(_,m)=>({
        label:String(m+1),
        value:completedBooksBetween(new Date(year,m,1),new Date(year,m+1,0)),
        target
      }));
      return {items,target,targetLabel:`${target}${uxTr("권")}/${uxTr("월")}`};
    }
    const years=yearsWithData().map(Number).sort((a,b)=>a-b);
    const target=goal*52;
    const items=years.map(y=>({
      label:String(y),
      value:completedBooksBetween(new Date(y,0,1),new Date(y,11,31)),
      target
    }));
    return {items,target,targetLabel:`${target}${uxTr("권")}/${uxTr("년")}`};
  }

  function goalBarsHtml(items){
    const max=Math.max(1,...items.flatMap(x=>[x.value,x.target]));
    return items.map(item=>{
      const valuePct=Math.max(0,Math.min(100,item.value/max*100));
      const targetPct=Math.max(0,Math.min(100,item.target/max*100));
      const achieved=item.value>=item.target;
      return `<div class="goal-viz-col ${achieved?"achieved":""}">
        <div class="goal-viz-value">${item.value}</div>
        <div class="goal-viz-track">
          <div class="goal-viz-fill" style="height:${valuePct}%"></div>
          <span class="goal-viz-target" style="bottom:${targetPct}%"></span>
        </div>
        <div class="goal-viz-label">${escapeHtml(item.label)}</div>
      </div>`;
    }).join("");
  }

  function renderReadingGoalAnalytics(){
    const host=document.querySelector("#library .stats-wrap") || document.querySelector(".stats-wrap");
    if(!host) return;
    let panel=document.getElementById("readingGoalAnalytics");
    if(!panel){
      panel=document.createElement("section");
      panel.id="readingGoalAnalytics";
      panel.className="goal-analytics-panel";
      host.insertAdjacentElement("afterend",panel);
    }
    const view=state.readingView;
    const series=readingGoalSeries(view);
    const achieved=series.items.filter(x=>x.value>=x.target).length;
    const avg=series.items.length?Math.round(series.items.reduce((a,b)=>a+b.value,0)/series.items.length*10)/10:0;
    panel.innerHTML=`
      <div class="analytics-head">
        <div>
          <h3>${uxTr("독서 목표 추이")}</h3>
          <p>${uxTr("설정한 주간 독서 목표를 주·월·연 단위로 비교해요.")}</p>
        </div>
        <div class="segmented-control" role="tablist">
          <button type="button" data-reading-view="week" class="${view==="week"?"active":""}">${uxTr("주별")}</button>
          <button type="button" data-reading-view="month" class="${view==="month"?"active":""}">${uxTr("월별")}</button>
          <button type="button" data-reading-view="year" class="${view==="year"?"active":""}">${uxTr("연도별")}</button>
        </div>
      </div>
      <div class="analytics-kpis">
        <div><span>${uxTr("목표")}</span><b>${series.targetLabel}</b></div>
        <div><span>${uxTr("평균")}</span><b>${avg}</b></div>
        <div><span>${uxTr("달성률")}</span><b>${series.items.length?Math.round(achieved/series.items.length*100):0}%</b></div>
      </div>
      <div class="goal-viz-chart" aria-label="${uxTr("독서 목표 추이")}">${goalBarsHtml(series.items)}</div>
      <div class="goal-viz-legend"><span><i class="goal-viz-legend-fill"></i>${uxTr("실적")}</span><span><i class="goal-viz-legend-target"></i>${uxTr("목표선")}</span></div>`;
    panel.querySelectorAll("[data-reading-view]").forEach(btn=>btn.onclick=()=>{
      state.readingView=btn.dataset.readingView;
      localStorage.setItem("bookaholic-reading-goal-view",state.readingView);
      renderReadingGoalAnalytics();
    });
  }

  function routineGoalSeries(r, view){
    const goal=Math.max(1,ensureRoutineGoalShape(r).weeklyTarget||1);
    const now=new Date(); now.setHours(0,0,0,0);

    if(view==="week"){
      const items=[];
      const base=startOfWeekMonday(now);
      for(let offset=7;offset>=0;offset--){
        const start=new Date(base); start.setDate(start.getDate()-offset*7);
        const end=new Date(start); end.setDate(end.getDate()+6);
        items.push({
          label:`${start.getMonth()+1}/${start.getDate()}`,
          value:routineSuccessCountBetween(r,start,end),
          target:goal
        });
      }
      return {items,target:goal,targetLabel:`${goal}${uxTr("회")}/${uxTr("주")}`};
    }

    if(view==="month"){
      const year=now.getFullYear();
      const target=Math.max(1,Math.round(goal*52/12));
      const items=Array.from({length:12},(_,m)=>({
        label:String(m+1),
        value:routineSuccessCountBetween(r,new Date(year,m,1),new Date(year,m+1,0)),
        target
      }));
      return {items,target,targetLabel:`${target}${uxTr("회")}/${uxTr("월")}`};
    }

    const years=routineYearsWithData(r).slice().sort((a,b)=>a-b);
    const target=goal*52;
    const items=years.map(y=>({
      label:String(y),
      value:routineSuccessCountBetween(r,new Date(y,0,1),new Date(y,11,31)),
      target
    }));
    return {items,target,targetLabel:`${target}${uxTr("회")}/${uxTr("년")}`};
  }

  function renderRoutineGoalTrend(r){
    if(r.id!=="qt") return;
    let panel=document.getElementById("bridgeRoutineGoalTrendPanel");
    const screen=document.getElementById("bridgeScreen");
    if(!screen || screen.classList.contains("hidden")) return;

    if(!panel){
      panel=document.createElement("section");
      panel.id="bridgeRoutineGoalTrendPanel";
      panel.className="goal-analytics-panel routine-goal-trend-panel bridge-trend-panel";
      const anchor=document.getElementById("bridgeProgressStats");
      if(anchor) anchor.insertAdjacentElement("afterend",panel);
      else screen.querySelector(".home-wrap")?.appendChild(panel);
    }

    const view=state.qtView||"week";
    const series=routineGoalSeries(r,view);
    const achieved=series.items.filter(x=>x.value>=x.target).length;
    const avg=series.items.length?Math.round(series.items.reduce((a,b)=>a+b.value,0)/series.items.length*10)/10:0;

    panel.innerHTML=`
      <div class="analytics-head">
        <div>
          <h3>🙏 ${uxTr("큐티")} · ${uxTr("목표")}</h3>
          <p>${uxTr("주별")} · ${uxTr("월별")} · ${uxTr("연도별")}</p>
        </div>
        <div class="segmented-control" role="tablist">
          <button type="button" data-qt-view="week" class="${view==="week"?"active":""}">${uxTr("주별")}</button>
          <button type="button" data-qt-view="month" class="${view==="month"?"active":""}">${uxTr("월별")}</button>
          <button type="button" data-qt-view="year" class="${view==="year"?"active":""}">${uxTr("연도별")}</button>
        </div>
      </div>
      <div class="analytics-kpis">
        <div><span>${uxTr("목표")}</span><b>${series.targetLabel}</b></div>
        <div><span>${uxTr("평균")}</span><b>${avg}</b></div>
        <div><span>${uxTr("달성률")}</span><b>${series.items.length?Math.round(achieved/series.items.length*100):0}%</b></div>
      </div>
      <div class="goal-viz-chart" aria-label="${uxTr("큐티")}">${goalBarsHtml(series.items)}</div>
      <div class="goal-viz-legend"><span><i class="goal-viz-legend-fill"></i>${uxTr("실적")}</span><span><i class="goal-viz-legend-target"></i>${uxTr("목표선")}</span></div>`;

    panel.querySelectorAll("[data-qt-view]").forEach(btn=>btn.onclick=()=>{
      state.qtView=btn.dataset.qtView;
      localStorage.setItem("bookaholic-qt-goal-view",state.qtView);
      renderRoutineGoalTrend(r);
    });
  }

  function isoWeekNumber(date){
    const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
    const day=d.getUTCDay()||7;
    d.setUTCDate(d.getUTCDate()+4-day);
    const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d-yearStart)/86400000)+1)/7);
  }

  function wakeYears(r){
    const ys=new Set([new Date().getFullYear()]);
    (r.entries||[]).forEach(e=>{ if(e.date) ys.add(Number(e.date.slice(0,4))); });
    return [...ys].filter(Boolean).sort((a,b)=>b-a);
  }

  function dateRangeForWake(view,year,period){
    if(view==="year") return [new Date(year,0,1),new Date(year,11,31)];
    if(view==="quarter"){
      const q=Math.max(1,Math.min(4,Number(period)||1));
      return [new Date(year,(q-1)*3,1),new Date(year,q*3,0)];
    }
    if(view==="month"){
      const m=Math.max(1,Math.min(12,Number(period)||1));
      return [new Date(year,m-1,1),new Date(year,m,0)];
    }
    const wanted=Math.max(1,Math.min(53,Number(period)||1));
    const jan4=new Date(year,0,4);
    const monday=startOfWeekMonday(jan4);
    monday.setDate(monday.getDate()+(wanted-1)*7);
    const end=new Date(monday); end.setDate(end.getDate()+6);
    return [monday,end];
  }

  function wakePeriodOptions(view,year){
    if(view==="quarter"){
      return [1,2,3,4].map(q=>`<option value="${q}">${q}Q · ${(q-1)*3+1}–${q*3}${uxTr("월")}</option>`).join("");
    }
    if(view==="month"){
      return Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}${uxTr("월")}</option>`).join("");
    }
    if(view==="week"){
      return Array.from({length:53},(_,i)=>`<option value="${i+1}">W${i+1}</option>`).join("");
    }
    return `<option value="all">${year}</option>`;
  }

  function wakeSvg(entries,target,start,end){
    const width=720,height=250,pad={l:54,r:20,t:20,b:34};
    const values=entries.map(e=>timeToMinutes(e.time)).filter(v=>v!=null);
    const targetMin=timeToMinutes(target);
    const basis=[...values, ...(targetMin==null?[]:[targetMin])];
    if(!basis.length) return `<div class="analytics-empty">${uxTr("기록이 쌓이면 추이가 표시돼요.")}</div>`;
    let min=Math.min(...basis)-45,max=Math.max(...basis)+45;
    min=Math.max(180,Math.floor(min/30)*30);
    max=Math.min(840,Math.ceil(max/30)*30);
    if(max-min<120){ min=Math.max(180,min-60); max=Math.min(840,max+60); }
    const span=Math.max(1,end-start);
    const x=d=>pad.l+((parseD(d)-start)/span)*(width-pad.l-pad.r);
    const y=v=>pad.t+(max-v)/(max-min)*(height-pad.t-pad.b);
    const points=entries.map(e=>({e,v:timeToMinutes(e.time)})).filter(o=>o.v!=null)
      .map(o=>`${x(o.e.date).toFixed(1)},${y(o.v).toFixed(1)}`).join(" ");
    const ticks=4;
    let grid="";
    for(let i=0;i<=ticks;i++){
      const v=min+(max-min)*(i/ticks), yy=y(v);
      grid+=`<line x1="${pad.l}" y1="${yy}" x2="${width-pad.r}" y2="${yy}" class="wake-grid-line"></line>
             <text x="${pad.l-8}" y="${yy+4}" text-anchor="end" class="wake-axis-label">${minutesToTime(v)}</text>`;
    }
    const goalLine=targetMin==null?"":`<line x1="${pad.l}" y1="${y(targetMin)}" x2="${width-pad.r}" y2="${y(targetMin)}" class="wake-goal-line"></line>`;
    const circles=entries.map(o=>({e:o,v:timeToMinutes(o.time)})).filter(o=>o.v!=null).map(o=>
      `<circle cx="${x(o.e.date)}" cy="${y(o.v)}" r="4" class="wake-point"><title>${o.e.date} · ${o.e.time}</title></circle>`).join("");
    return `<svg class="wake-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${uxTr("기상시간 추이")}">
      ${grid}${goalLine}
      ${points?`<polyline points="${points}" class="wake-line"></polyline>`:""}
      ${circles}
      <text x="${pad.l}" y="${height-8}" class="wake-axis-label">${start.getMonth()+1}/${start.getDate()}</text>
      <text x="${width-pad.r}" y="${height-8}" text-anchor="end" class="wake-axis-label">${end.getMonth()+1}/${end.getDate()}</text>
    </svg>`;
  }

  function renderWakeTrend(r){
    if(r.id!=="wake_early") return;
    let panel=document.getElementById("bridgeWakeTrendPanel");
    const screen=document.getElementById("bridgeScreen");
    if(!screen || screen.classList.contains("hidden")) return;

    if(!panel){
      panel=document.createElement("section");
      panel.id="bridgeWakeTrendPanel";
      panel.className="reward-card wake-trend-panel bridge-trend-panel";
      const anchor=document.getElementById("bridgeProgressStats");
      if(anchor) anchor.insertAdjacentElement("afterend",panel);
      else screen.querySelector(".home-wrap")?.appendChild(panel);
    }

    const years=wakeYears(r);
    const currentYear=new Date().getFullYear();
    if(!state.wakeYear || !years.includes(Number(state.wakeYear))) state.wakeYear=years.includes(currentYear)?currentYear:years[0];
    if(state.wakePeriod==null){
      if(state.wakeView==="quarter") state.wakePeriod=Math.floor(new Date().getMonth()/3)+1;
      else if(state.wakeView==="month") state.wakePeriod=new Date().getMonth()+1;
      else if(state.wakeView==="week") state.wakePeriod=isoWeekNumber(new Date());
      else state.wakePeriod="all";
    }

    const [start,end]=dateRangeForWake(state.wakeView,Number(state.wakeYear),state.wakePeriod);
    const entries=(r.entries||[]).filter(e=>e.date&&e.time&&parseD(e.date)>=start&&parseD(e.date)<=end).sort((a,b)=>a.date.localeCompare(b.date));
    const vals=entries.map(e=>timeToMinutes(e.time)).filter(v=>v!=null);
    const avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    const target=timeToMinutes(r.goalTime);
    const success=vals.length&&target!=null?Math.round(vals.filter(v=>v<=target).length/vals.length*100):0;
    const earliest=vals.length?Math.min(...vals):null;

    panel.innerHTML=`
      <div class="analytics-head">
        <div>
          <h3>🌅 ${uxTr("기상시간 추이")}</h3>
          <p>${uxTr("기상 기록을 주·월·분기·연도별로 비교해요.")}</p>
        </div>
      </div>
      <div class="wake-controls">
        <select id="wakeViewSelect">
          <option value="week">${uxTr("주별")}</option>
          <option value="month">${uxTr("월별")}</option>
          <option value="quarter">${uxTr("분기별")}</option>
          <option value="year">${uxTr("연도별")}</option>
        </select>
        <select id="wakeYearSelect">${years.map(y=>`<option value="${y}">${y}</option>`).join("")}</select>
        <select id="wakePeriodSelect">${wakePeriodOptions(state.wakeView,state.wakeYear)}</select>
      </div>
      <div class="analytics-kpis">
        <div><span>${uxTr("평균 기상")}</span><b>${minutesToTime(avg)}</b></div>
        <div><span>${uxTr("목표 시간")}</span><b>${r.goalTime||"—"}</b></div>
        <div><span>${uxTr("성공률")}</span><b>${success}%</b></div>
        <div><span>${uxTr("가장 이른 기상")}</span><b>${minutesToTime(earliest)}</b></div>
      </div>
      <div class="wake-chart-wrap">${wakeSvg(entries,r.goalTime,start,end)}</div>`;

    panel.querySelector("#wakeViewSelect").value=state.wakeView;
    panel.querySelector("#wakeYearSelect").value=String(state.wakeYear);
    const psel=panel.querySelector("#wakePeriodSelect");
    if([...psel.options].some(o=>String(o.value)===String(state.wakePeriod))) psel.value=String(state.wakePeriod);

    panel.querySelector("#wakeViewSelect").onchange=(e)=>{
      state.wakeView=e.target.value;
      localStorage.setItem("bookaholic-wake-view",state.wakeView);
      state.wakePeriod=null;
      renderWakeTrend(r);
    };
    panel.querySelector("#wakeYearSelect").onchange=(e)=>{state.wakeYear=Number(e.target.value);state.wakePeriod=null;renderWakeTrend(r);};
    psel.onchange=(e)=>{state.wakePeriod=e.target.value;renderWakeTrend(r);};
  }

  function insightsData(){
    const now=new Date(); now.setHours(0,0,0,0);
    const thisMonthStart=new Date(now.getFullYear(),now.getMonth(),1);
    const prevMonthStart=new Date(now.getFullYear(),now.getMonth()-1,1);
    const prevMonthEnd=new Date(now.getFullYear(),now.getMonth(),0);
    const sumMinutes=(start,end)=>data.books.reduce((sum,b)=>sum+(b.sessions||[]).filter(s=>parseD(s.date)>=start&&parseD(s.date)<=end).reduce((a,s)=>a+(s.minutes||0),0),0);
    const thisMin=sumMinutes(thisMonthStart,now),prevMin=sumMinutes(prevMonthStart,prevMonthEnd);
    const delta=prevMin?Math.round((thisMin-prevMin)/prevMin*100):null;
    const routines=(data.routines||[]).filter(r=>routineGoalConfigured(r));
    const ranked=routines.map(r=>({r,rate:routineLastNDaysRate(r,30)})).sort((a,b)=>b.rate-a.rate);
    const top=ranked[0];
    const weekGoal=Math.max(1,data.weeklyGoal||2);
    const wk=startOfWeekMonday(now),we=new Date(wk);we.setDate(we.getDate()+6);
    const wkDone=completedBooksBetween(wk,we);
    return {thisMin,prevMin,delta,top,weekGoal,wkDone};
  }

  function renderInsights(){
    const grid=document.getElementById("mboGrid");
    if(!grid) return;
    let panel=document.getElementById("integratedInsights");
    if(!panel){
      panel=document.createElement("section");
      panel.id="integratedInsights";
      panel.className="insight-panel";
      grid.insertAdjacentElement("afterend",panel);
    }
    const x=insightsData();
    const deltaText=x.delta==null?uxTr("비교할 지난달 기록 없음"):`${x.delta>=0?"+":""}${x.delta}%`;
    panel.innerHTML=`
      <div class="analytics-head">
        <div><h3>✨ ${uxTr("나의 인사이트")}</h3><p>${uxTr("최근 기록을 짧게 요약해요.")}</p></div>
      </div>
      <div class="insight-grid">
        <div class="insight-card"><span>${uxTr("이번 달 독서")}</span><b>${Math.round(x.thisMin/60*10)/10}${uxTr("시간")}</b><small>${uxTr("지난달 대비")} ${deltaText}</small></div>
        <div class="insight-card"><span>${uxTr("이번 주 독서 목표")}</span><b>${x.wkDone}/${x.weekGoal}${uxTr("권")}</b><small>${x.wkDone>=x.weekGoal?uxTr("목표 달성") : uxTr("진행 중")}</small></div>
        <div class="insight-card"><span>${uxTr("가장 꾸준한 목표")}</span><b class="user-content" data-i18n-ignore="true">${x.top?`${escapeHtml(x.top.r.icon)} ${escapeHtml(x.top.r.name)}`:"—"}</b><small>${x.top?`${x.top.rate}% · ${uxTr("최근 30일")}`:uxTr("목표 기록을 시작해 보세요.")}</small></div>
      </div>`;
  }

  function appendAdvancedBadges(){
    const row=document.getElementById("badgeRow");
    if(!row) return;
    row.querySelectorAll(".ux-extra-badge").forEach(x=>x.remove());
    const readingDays=readingDaySet().size;
    const streak=calcStreak().n;
    const wake=getRoutine("wake_early");
    const wakeStreak=wake?routineStreak(wake):0;
    const extra=[];
    if(streak>=7) extra.push({icon:"🔥",title:`${streak}${uxTr("일 연속")}`,sub:uxTr("독서 스트릭")});
    if(readingDays>=30) extra.push({icon:"📚",title:`${readingDays}${uxTr("일")}`,sub:uxTr("누적 독서일")});
    if(wakeStreak>=7) extra.push({icon:"🌅",title:`${wakeStreak}${uxTr("일 연속")}`,sub:uxTr("기상 목표")});
    extra.forEach(b=>row.insertAdjacentHTML("beforeend",`<div class="badge on ux-extra-badge"><div class="badge-icon">${b.icon}</div><b>${b.title}</b><span>${b.sub}</span></div>`));
  }

  const onboardingSteps = () => [
    {target:"#mboScreen .mbo-title",title:"처음 오셨나요?",body:"이 화면은 독서와 생활 목표를 한곳에서 기록하는 메인 화면입니다. 가이드는 실제 버튼을 하나씩 짚어가며 설명합니다."},
    {target:"#mboOverviewYearSelect",title:"연도 선택",body:"생활 그리드에서 보고 싶은 연도를 선택합니다. 진한 칸일수록 그날 설정한 목표를 더 많이 달성했다는 뜻입니다."},
    {target:".mbo-overview-card",title:"생활 그리드",body:"하루의 독서와 목표 달성률을 한눈에 보는 영역입니다. 각 칸에 마우스를 올리거나 터치하면 상세 기록을 확인할 수 있습니다."},
    {target:"#mboGrid",title:"목표 카드",body:"각 카드는 독서 또는 생활 목표 하나를 의미합니다. 카드를 누르면 오늘 기록, 목표 설정, 전체 추이를 볼 수 있습니다."},
    {target:'[data-mbo="reading"]',title:"독서",body:"독서 카드는 서재·독서시간·주간 목표·월별/연도별 독서 추이로 이어집니다."},
    {target:"#openLifeRetroBtn",title:"생활 회고",body:"생활 회고에서는 여러 목표를 한 번에 비교하고 한 해의 흐름을 되돌아볼 수 있습니다."},
    {target:"#globalLanguageSelect",title:"언어",body:"언어를 바꾸면 고정 UI는 선택한 언어로 다시 렌더링됩니다. 책 제목과 메모처럼 직접 입력한 내용은 원문을 유지합니다."},
    {target:"#accountDock",title:"계정과 백업",body:"계정 메뉴에서 클라우드 백업, 비밀번호 설정, 로그아웃, 설정, 사용 가이드를 한곳에서 관리할 수 있습니다."},
    {target:"#saveStateIndicator",title:"자동 저장 상태",body:"저장 중·클라우드 동기화·오프라인 저장 상태를 여기에서 확인할 수 있습니다."}
  ];

  const CONTEXT_GUIDE_PREFIX = "bookaholic-context-guide-v1:";

  function guideLang(){
    try { return window.I18N?.getLanguage?.() || "ko"; }
    catch(_) { return "ko"; }
  }

  const GUIDE_TEXT = {
    ko:{
      replay:"이 화면 가이드",
      readIntroTitle:"독서 프로젝트 화면",
      readIntroBody:"현재 독서 프로젝트의 진행 상황을 한눈에 보는 화면입니다. 완독 권수, 읽는 중인 책, 누적 독서시간과 100권 진행도를 함께 확인할 수 있습니다.",
      readRingTitle:"프로젝트 진행률",
      readRingBody:"원형 그래프는 현재 100권 구간에서의 진행률입니다. 오른쪽에는 완독 권수, 읽는 중인 책, 총 독서시간이 표시됩니다.",
      readBaselineTitle:"이전 독서 기록",
      readBaselineBody:"이 서비스를 쓰기 전에 이미 읽은 책이 있다면 여기에 숫자로 입력할 수 있습니다. 전체 프로젝트 권수에 함께 반영됩니다.",
      readShelfTitle:"100권 진행 보드",
      readShelfBody:"작은 칸 100개가 한 구간의 100권을 뜻합니다. 채워진 칸을 통해 현재 위치를 빠르게 확인할 수 있습니다.",
      readLibraryTitle:"나의 서재",
      readLibraryBody:"이 버튼으로 책 목록, 연간 독서 그리드, 독서시간과 완독 통계, 목표 추이 화면으로 이동합니다.",
      readWeeklyTitle:"주간 독서 목표",
      readWeeklyBody:"이번 주 완독 목표와 실제 달성 상황을 비교하는 영역입니다. 목표 권수는 직접 조정할 수 있습니다.",
      goalIntroTitle:"이 목표 화면",
      goalIntroBody:"이 화면은 오늘의 기록을 남기기 전에 목표의 현재 흐름을 확인하는 곳입니다. 최근 달성률과 목표 설정, 추이를 한 화면에서 볼 수 있습니다.",
      goalStatsTitle:"현재 흐름",
      goalStatsBody:"연속 달성일, 이번 주 달성 횟수, 최근 30일 달성률을 요약합니다.",
      goalCardTitle:"나의 목표",
      goalCardBody:"왜 이 목표를 하는지와 주간 목표 횟수, 시간 기준 같은 현재 설정을 확인하거나 수정할 수 있습니다.",
      qtTrendTitle:"큐티 목표 추이",
      qtTrendBody:"큐티 실천 횟수를 주별, 월별, 연도별로 비교합니다. 막대는 실제 기록이고 선은 설정한 목표입니다.",
      wakeTrendTitle:"기상시간 추이",
      wakeTrendBody:"실제 기상시간을 주별, 월별, 분기별, 연도별로 비교합니다. 목표시간과 평균, 성공률도 함께 확인할 수 있습니다.",
      motivationTitle:"오늘의 한마디",
      motivationBody:"최근 기록과 이번 주 목표 상황을 바탕으로 지금 이어가기 좋은 방향을 짧게 보여줍니다.",
      todayRecordTitle:"오늘 기록",
      todayRecordBody:"오늘의 목표 수행 내용을 입력하고 저장하는 곳입니다. 저장하면 메인 화면과 통계에 바로 반영됩니다.",
      detailTitle:"기록 모아보기",
      detailBody:"연간 그리드, 월별 평균, 날짜별 전체 기록처럼 더 자세한 기록을 보고 싶을 때 들어가는 화면입니다.",
      libraryIntroTitle:"나의 서재",
      libraryIntroBody:"책 목록과 독서 통계를 한곳에서 관리하는 화면입니다. 위에서부터 연간 독서 그리드, 통계, 목표 추이, 검색·정렬, 책 목록 순서로 살펴봅니다.",
      libraryGridTitle:"연간 독서 그리드",
      libraryGridBody:"타이머로 독서한 날짜와 시간을 연간 단위로 보여줍니다. 색이 진할수록 그날 더 오래 읽었다는 뜻입니다.",
      libraryStatsTitle:"독서 통계",
      libraryStatsBody:"주간 독서시간, 월별 완독 권수, 연도별 완독, 장르별 기록을 비교합니다.",
      libraryGoalTitle:"독서 목표 추이",
      libraryGoalBody:"설정한 주간 독서 목표와 실제 완독 기록을 주·월·연 단위로 비교합니다.",
      libraryFilterTitle:"책 찾기와 보기 방식",
      libraryFilterBody:"제목·저자 검색, 독서 상태 필터, 정렬 방식, 그리드·보드 보기를 선택할 수 있습니다.",
      libraryShareTitle:"공개와 공유",
      libraryShareBody:"책마다 공개 여부를 정하고, 공개한 책만 담은 공유 링크를 만들 수 있습니다.",
      libraryBooksTitle:"책 목록",
      libraryBooksBody:"등록한 책들이 표시되는 영역입니다. 책을 누르면 진행률, 독서시간, 문구와 회고를 자세히 기록할 수 있습니다.",
      detailIntroTitle:"전체 기록 화면",
      detailIntroBody:"이 목표의 누적 기록을 자세히 보는 화면입니다. 위에서 아래로 요약, 기간 통계, 연간 그리드, 월별 추이, 기록 입력, 전체 기록 순서로 확인합니다.",
      detailSummaryTitle:"누적 요약",
      detailSummaryBody:"연속일, 총 달성일, 기록 중 달성률 등 지금까지의 핵심 기록을 보여줍니다.",
      detailPeriodTitle:"기간별 통계",
      detailPeriodBody:"이번 주, 지난주, 최근 4주, 이번 달 등 가까운 기간의 목표 달성 흐름을 비교합니다.",
      detailYearTitle:"연간 기록",
      detailYearBody:"한 해 동안 목표를 달성한 날짜를 그리드로 보여줍니다. 연도를 바꿔 과거 기록도 확인할 수 있습니다.",
      detailMonthTitle:"월별 추이",
      detailMonthBody:"월별 평균 또는 달성률을 비교해서 계절별·월별 변화가 있었는지 확인합니다.",
      detailEditTitle:"과거 날짜 기록",
      detailEditBody:"오늘이 아닌 날짜의 기록을 추가하거나 수정할 때 사용하는 영역입니다.",
      detailListTitle:"전체 기록 목록",
      detailListBody:"저장된 기록을 월별·날짜별로 확인하고 필요하면 개별 기록을 삭제할 수 있습니다."
    },
    en:{
      replay:"Guide for this screen",
      readIntroTitle:"Reading project",
      readIntroBody:"This page summarizes your reading project: completed books, books in progress, total reading time, and progress toward the current 100-book block.",
      readRingTitle:"Project progress",
      readRingBody:"The ring shows progress within the current 100-book block. The figures beside it show completed books, books in progress, and total reading time.",
      readBaselineTitle:"Earlier reading",
      readBaselineBody:"If you read books before using this site, enter that number here. It is included in the overall project count.",
      readShelfTitle:"100-book board",
      readShelfBody:"These 100 squares represent one 100-book block. Filled squares show your current position at a glance.",
      readLibraryTitle:"My Library",
      readLibraryBody:"Open your library to see books, the yearly reading grid, reading-time statistics, completion statistics, and goal trends.",
      readWeeklyTitle:"Weekly reading goal",
      readWeeklyBody:"Compare this week's completion goal with your actual result. You can change the weekly target yourself.",
      goalIntroTitle:"Goal page",
      goalIntroBody:"This page shows the current flow of this goal before you enter today's record: recent performance, goal settings, and trends.",
      goalStatsTitle:"Current progress",
      goalStatsBody:"A summary of your streak, this week's completions, and your success rate over the last 30 days.",
      goalCardTitle:"My goal",
      goalCardBody:"Review or edit why this goal matters, its weekly target, and any time-based target.",
      qtTrendTitle:"Devotional trend",
      qtTrendBody:"Compare devotional practice by week, month, or year. Bars show actual records and the line shows your target.",
      wakeTrendTitle:"Wake-up trend",
      wakeTrendBody:"Compare wake-up times by week, month, quarter, or year, together with your target time, average, and success rate.",
      motivationTitle:"Today's note",
      motivationBody:"A short suggestion based on your recent records and this week's target progress.",
      todayRecordTitle:"Today's record",
      todayRecordBody:"Enter today's result here. Saving it updates the main dashboard and statistics immediately.",
      detailTitle:"All records",
      detailBody:"Open this page when you want the yearly grid, monthly averages, and detailed date-by-date records.",
      libraryIntroTitle:"My Library",
      libraryIntroBody:"Manage books and reading statistics in one place. The guide moves from the yearly reading grid down through statistics, goal trends, filters, and your books.",
      libraryGridTitle:"Yearly reading grid",
      libraryGridBody:"See which days you read with the timer during the year. Darker squares mean more reading time that day.",
      libraryStatsTitle:"Reading statistics",
      libraryStatsBody:"Compare weekly reading time, monthly completions, yearly completions, and genres.",
      libraryGoalTitle:"Reading goal trend",
      libraryGoalBody:"Compare your weekly reading target with actual completions by week, month, or year.",
      libraryFilterTitle:"Find and view books",
      libraryFilterBody:"Search titles and authors, filter by status, change sorting, and switch between grid and board views.",
      libraryShareTitle:"Privacy and sharing",
      libraryShareBody:"Choose which books are public and create a sharing link containing only public books.",
      libraryBooksTitle:"Book list",
      libraryBooksBody:"Your books appear here. Open a book to record progress, reading time, quotes, and reflections.",
      detailIntroTitle:"All records",
      detailIntroBody:"This page shows the full history of this goal. The guide moves downward through summary, period statistics, yearly grid, monthly trend, record entry, and the full list.",
      detailSummaryTitle:"History summary",
      detailSummaryBody:"See your streak, total successful days, and overall success rate for recorded days.",
      detailPeriodTitle:"Period statistics",
      detailPeriodBody:"Compare recent performance such as this week, last week, the last four weeks, and this month.",
      detailYearTitle:"Yearly records",
      detailYearBody:"The yearly grid shows the dates when you achieved this goal. Change the year to review earlier records.",
      detailMonthTitle:"Monthly trend",
      detailMonthBody:"Compare monthly averages or success rates to see how the goal changes over time.",
      detailEditTitle:"Record another date",
      detailEditBody:"Use this area to add or update a record for a date other than today.",
      detailListTitle:"Complete record list",
      detailListBody:"Review saved records by month and date and delete an individual record when needed."
    },
    ja:{
      replay:"この画面のガイド",
      readIntroTitle:"読書プロジェクト画面",
      readIntroBody:"完読冊数、読書中の本、累計読書時間、100冊区間の進捗をまとめて確認する画面です。",
      readRingTitle:"プロジェクト進捗",
      readRingBody:"円グラフは現在の100冊区間での進捗です。右側に完読、読書中、総読書時間を表示します。",
      readBaselineTitle:"以前の読書記録",
      readBaselineBody:"このサービスを使う前に読んだ本があれば冊数を入力できます。全体の冊数に反映されます。",
      readShelfTitle:"100冊進捗ボード",
      readShelfBody:"100個のマスが100冊の1区間を表します。塗られたマスで現在位置を確認できます。",
      readLibraryTitle:"私の本棚",
      readLibraryBody:"本棚、年間読書グリッド、読書時間、完読統計、目標推移へ移動します。",
      readWeeklyTitle:"週間読書目標",
      readWeeklyBody:"今週の完読目標と実績を比較します。目標冊数は変更できます。",
      goalIntroTitle:"目標画面",
      goalIntroBody:"今日の記録を入力する前に、最近の達成状況、目標設定、推移を確認する画面です。",
      goalStatsTitle:"現在の流れ",
      goalStatsBody:"連続達成日数、今週の達成回数、直近30日の達成率をまとめます。",
      goalCardTitle:"私の目標",
      goalCardBody:"目標の理由、週間回数、時間基準などを確認・修正できます。",
      qtTrendTitle:"デボーション目標推移",
      qtTrendBody:"週・月・年ごとの実践回数を比較します。棒が実績、線が目標です。",
      wakeTrendTitle:"起床時間推移",
      wakeTrendBody:"週・月・四半期・年ごとに起床時間を比較し、目標時刻、平均、達成率も確認できます。",
      motivationTitle:"今日のひとこと",
      motivationBody:"最近の記録と今週の目標状況から、続けやすい方向を短く表示します。",
      todayRecordTitle:"今日の記録",
      todayRecordBody:"今日の実績を入力して保存します。メイン画面と統計にすぐ反映されます。",
      detailTitle:"記録をまとめて見る",
      detailBody:"年間グリッド、月別平均、日付別の詳細記録を見る画面です。",
      libraryIntroTitle:"私の本棚",
      libraryIntroBody:"本と読書統計をまとめて管理する画面です。年間グリッドから統計、目標推移、検索・並び替え、本一覧へ上から順に案内します。",
      libraryGridTitle:"年間読書グリッド",
      libraryGridBody:"タイマーで読書した日を一年単位で表示します。色が濃いほどその日の読書時間が長いことを表します。",
      libraryStatsTitle:"読書統計",
      libraryStatsBody:"週間読書時間、月別完読冊数、年別完読、ジャンル別記録を比較します。",
      libraryGoalTitle:"読書目標の推移",
      libraryGoalBody:"週間読書目標と実際の完読数を週・月・年単位で比較します。",
      libraryFilterTitle:"本を探す・表示する",
      libraryFilterBody:"タイトル・著者検索、状態フィルター、並び替え、グリッド・ボード表示を選べます。",
      libraryShareTitle:"公開と共有",
      libraryShareBody:"本ごとに公開範囲を設定し、公開した本だけを含む共有リンクを作成できます。",
      libraryBooksTitle:"本の一覧",
      libraryBooksBody:"登録した本が表示されます。本を開くと進捗、読書時間、引用、振り返りを詳しく記録できます。",
      detailIntroTitle:"全記録画面",
      detailIntroBody:"この目標の累積記録を詳しく確認する画面です。概要、期間統計、年間グリッド、月別推移、記録入力、全記録の順に上から案内します。",
      detailSummaryTitle:"累積概要",
      detailSummaryBody:"連続日数、総達成日数、記録日の達成率など主要な記録を表示します。",
      detailPeriodTitle:"期間別統計",
      detailPeriodBody:"今週、先週、直近4週間、今月など最近の達成状況を比較します。",
      detailYearTitle:"年間記録",
      detailYearBody:"一年の達成日をグリッドで表示します。年を変更して過去の記録も確認できます。",
      detailMonthTitle:"月別推移",
      detailMonthBody:"月別平均または達成率を比較し、時期による変化を確認します。",
      detailEditTitle:"過去日の記録",
      detailEditBody:"今日以外の日付の記録を追加・修正するための領域です。",
      detailListTitle:"全記録一覧",
      detailListBody:"保存済みの記録を月・日付別に確認し、必要なら個別に削除できます。"
    },
    "zh-CN":{
      replay:"本页指南",
      readIntroTitle:"阅读计划页面",
      readIntroBody:"这里汇总已读完、正在读、累计阅读时间以及当前100本阶段的进度。",
      readRingTitle:"计划进度",
      readRingBody:"圆环表示当前100本阶段的进度，右侧显示已读完、正在读和累计阅读时间。",
      readBaselineTitle:"以前的阅读记录",
      readBaselineBody:"如果使用本站前已经读过一些书，可以在这里输入数量，并计入总进度。",
      readShelfTitle:"100本进度板",
      readShelfBody:"100个小格代表一个100本阶段，填充的小格显示你当前的位置。",
      readLibraryTitle:"我的书房",
      readLibraryBody:"进入书房查看书籍、年度阅读网格、阅读时间、完读统计和目标趋势。",
      readWeeklyTitle:"每周阅读目标",
      readWeeklyBody:"比较本周完读目标和实际结果，目标本数可以自行调整。",
      goalIntroTitle:"目标页面",
      goalIntroBody:"在记录今天之前，这里先展示该目标的近期状态、目标设置和趋势。",
      goalStatsTitle:"当前进度",
      goalStatsBody:"汇总连续达成天数、本周完成次数和最近30天达成率。",
      goalCardTitle:"我的目标",
      goalCardBody:"查看或修改目标理由、每周次数以及时间标准等设置。",
      qtTrendTitle:"灵修目标趋势",
      qtTrendBody:"按周、月、年比较灵修次数。柱状图是实际记录，线条是目标。",
      wakeTrendTitle:"起床时间趋势",
      wakeTrendBody:"按周、月、季度、年比较起床时间，并显示目标时间、平均值和成功率。",
      motivationTitle:"今日提示",
      motivationBody:"根据近期记录和本周目标进度给出简短提示。",
      todayRecordTitle:"今日记录",
      todayRecordBody:"在这里输入并保存今天的结果，主页面和统计会立即更新。",
      detailTitle:"查看全部记录",
      detailBody:"查看年度网格、月平均和按日期整理的详细记录。",
      libraryIntroTitle:"我的书房",
      libraryIntroBody:"在一个页面管理书籍和阅读统计。指南会从年度阅读网格开始，依次介绍统计、目标趋势、筛选和书籍列表。",
      libraryGridTitle:"年度阅读网格",
      libraryGridBody:"按全年显示使用计时器阅读的日期。颜色越深表示当天阅读时间越长。",
      libraryStatsTitle:"阅读统计",
      libraryStatsBody:"比较每周阅读时间、每月完读、年度完读和类型统计。",
      libraryGoalTitle:"阅读目标趋势",
      libraryGoalBody:"按周、月、年比较每周阅读目标和实际完读记录。",
      libraryFilterTitle:"查找和查看书籍",
      libraryFilterBody:"可以搜索标题和作者、按状态筛选、调整排序，并切换网格或看板视图。",
      libraryShareTitle:"公开与分享",
      libraryShareBody:"设置每本书的公开状态，并创建只包含公开书籍的分享链接。",
      libraryBooksTitle:"书籍列表",
      libraryBooksBody:"这里显示已登记的书籍。打开书籍后可以详细记录进度、阅读时间、摘录和回顾。",
      detailIntroTitle:"全部记录",
      detailIntroBody:"这里查看该目标的累计记录。指南会从上到下依次介绍摘要、期间统计、年度网格、月度趋势、记录输入和全部记录。",
      detailSummaryTitle:"累计摘要",
      detailSummaryBody:"显示连续天数、总达成天数和记录日的整体达成率。",
      detailPeriodTitle:"期间统计",
      detailPeriodBody:"比较本周、上周、最近4周和本月等近期目标表现。",
      detailYearTitle:"年度记录",
      detailYearBody:"年度网格显示达成目标的日期，也可以切换年份查看历史记录。",
      detailMonthTitle:"月度趋势",
      detailMonthBody:"比较每月平均值或达成率，观察目标随时间的变化。",
      detailEditTitle:"补记日期",
      detailEditBody:"用于添加或修改非今天日期的记录。",
      detailListTitle:"完整记录列表",
      detailListBody:"按月份和日期查看已保存记录，并可删除单条记录。"
    },
    "zh-TW":{
      replay:"本頁指南",
      readIntroTitle:"閱讀計畫頁面",
      readIntroBody:"這裡彙整已讀完、閱讀中、累計閱讀時間以及目前100本階段的進度。",
      readRingTitle:"計畫進度",
      readRingBody:"圓環表示目前100本階段的進度，右側顯示已讀完、閱讀中與累計閱讀時間。",
      readBaselineTitle:"以前的閱讀記錄",
      readBaselineBody:"如果使用本站前已讀過一些書，可以在這裡輸入數量並計入總進度。",
      readShelfTitle:"100本進度板",
      readShelfBody:"100個小格代表一個100本階段，填滿的小格顯示目前位置。",
      readLibraryTitle:"我的書房",
      readLibraryBody:"進入書房查看書籍、年度閱讀網格、閱讀時間、完讀統計與目標趨勢。",
      readWeeklyTitle:"每週閱讀目標",
      readWeeklyBody:"比較本週完讀目標與實際結果，目標本數可以自行調整。",
      goalIntroTitle:"目標頁面",
      goalIntroBody:"在記錄今天之前，這裡先呈現此目標的近期狀態、目標設定與趨勢。",
      goalStatsTitle:"目前進度",
      goalStatsBody:"彙整連續達成天數、本週完成次數與最近30天達成率。",
      goalCardTitle:"我的目標",
      goalCardBody:"查看或修改目標理由、每週次數與時間標準等設定。",
      qtTrendTitle:"靈修目標趨勢",
      qtTrendBody:"按週、月、年比較靈修次數。柱狀圖是實際記錄，線條是目標。",
      wakeTrendTitle:"起床時間趨勢",
      wakeTrendBody:"按週、月、季、年比較起床時間，並顯示目標時間、平均值與成功率。",
      motivationTitle:"今日提示",
      motivationBody:"依近期記錄與本週目標進度顯示簡短提示。",
      todayRecordTitle:"今日記錄",
      todayRecordBody:"在這裡輸入並儲存今天的結果，主頁與統計會立即更新。",
      detailTitle:"查看全部記錄",
      detailBody:"查看年度網格、月平均與按日期整理的詳細記錄。",
      libraryIntroTitle:"我的書房",
      libraryIntroBody:"在同一頁管理書籍與閱讀統計。指南會從年度閱讀網格開始，依序介紹統計、目標趨勢、篩選與書籍列表。",
      libraryGridTitle:"年度閱讀網格",
      libraryGridBody:"以全年顯示使用計時器閱讀的日期。顏色越深代表當天閱讀時間越長。",
      libraryStatsTitle:"閱讀統計",
      libraryStatsBody:"比較每週閱讀時間、每月完讀、年度完讀與類型統計。",
      libraryGoalTitle:"閱讀目標趨勢",
      libraryGoalBody:"按週、月、年比較每週閱讀目標與實際完讀記錄。",
      libraryFilterTitle:"尋找與查看書籍",
      libraryFilterBody:"可搜尋書名與作者、依狀態篩選、調整排序，並切換網格或看板檢視。",
      libraryShareTitle:"公開與分享",
      libraryShareBody:"設定每本書的公開狀態，並建立只包含公開書籍的分享連結。",
      libraryBooksTitle:"書籍列表",
      libraryBooksBody:"這裡顯示已登記的書籍。開啟書籍後可詳細記錄進度、閱讀時間、摘錄與回顧。",
      detailIntroTitle:"全部記錄",
      detailIntroBody:"這裡查看此目標的累積記錄。指南會由上到下依序介紹摘要、期間統計、年度網格、月度趨勢、記錄輸入與全部記錄。",
      detailSummaryTitle:"累積摘要",
      detailSummaryBody:"顯示連續天數、總達成天數與記錄日的整體達成率。",
      detailPeriodTitle:"期間統計",
      detailPeriodBody:"比較本週、上週、最近4週與本月等近期目標表現。",
      detailYearTitle:"年度記錄",
      detailYearBody:"年度網格顯示達成目標的日期，也可切換年份查看歷史記錄。",
      detailMonthTitle:"月度趨勢",
      detailMonthBody:"比較每月平均值或達成率，觀察目標隨時間的變化。",
      detailEditTitle:"補記日期",
      detailEditBody:"用於新增或修改非今天日期的記錄。",
      detailListTitle:"完整記錄列表",
      detailListBody:"按月份與日期查看已儲存記錄，並可刪除單筆記錄。"
    }
  };

  function guideT(key){
    const lang=guideLang();
    const pack=GUIDE_TEXT[lang] || GUIDE_TEXT.en;
    return pack[key] || GUIDE_TEXT.en[key] || key;
  }

  function readingGuideSteps(){
    return [
      {target:"#homeScreen .home-hero",title:guideT("readIntroTitle"),body:guideT("readIntroBody"),raw:true},
      {target:"#homeScreen .home-ring-row",title:guideT("readRingTitle"),body:guideT("readRingBody"),raw:true},
      {target:"#homeScreen .home-baseline",title:guideT("readBaselineTitle"),body:guideT("readBaselineBody"),raw:true},
      {target:"#homeScreen .home-shelf",title:guideT("readShelfTitle"),body:guideT("readShelfBody"),raw:true},
      {target:"#enterLibraryBtn",title:guideT("readLibraryTitle"),body:guideT("readLibraryBody"),raw:true},
      {target:"#homeScreen .reward-section .reward-card:first-child",title:guideT("readWeeklyTitle"),body:guideT("readWeeklyBody"),raw:true}
    ];
  }

  function routineGuideSteps(r){
    const steps=[
      {target:"#bridgeTitle",title:guideT("goalIntroTitle"),body:guideT("goalIntroBody"),raw:true},
      {target:"#bridgeProgressStats",title:guideT("goalStatsTitle"),body:guideT("goalStatsBody"),raw:true},
      {target:"#bridgeGoalCard",title:guideT("goalCardTitle"),body:guideT("goalCardBody"),raw:true}
    ];
    if(r?.id==="qt"){
      steps.push({target:"#bridgeRoutineGoalTrendPanel",title:guideT("qtTrendTitle"),body:guideT("qtTrendBody"),raw:true});
    }
    if(r?.id==="wake_early"){
      steps.push({target:"#bridgeWakeTrendPanel",title:guideT("wakeTrendTitle"),body:guideT("wakeTrendBody"),raw:true});
    }
    steps.push(
      {target:"#bridgeMotivation",title:guideT("motivationTitle"),body:guideT("motivationBody"),raw:true},
      {target:"#bridgeWidgetCard",title:guideT("todayRecordTitle"),body:guideT("todayRecordBody"),raw:true},
      {target:"#goRoutineDetailBtn",title:guideT("detailTitle"),body:guideT("detailBody"),raw:true}
    );
    return steps;
  }

  function libraryGuideSteps(){
    return [
      {target:"#library .lib-header",title:guideT("libraryIntroTitle"),body:guideT("libraryIntroBody"),raw:true},
      {target:"#library .contrib-wrap",title:guideT("libraryGridTitle"),body:guideT("libraryGridBody"),raw:true},
      {target:"#library .stats-wrap",title:guideT("libraryStatsTitle"),body:guideT("libraryStatsBody"),raw:true},
      {target:"#readingGoalAnalytics",title:guideT("libraryGoalTitle"),body:guideT("libraryGoalBody"),raw:true},
      {target:"#library .toolbar:not(.share-toolbar)",title:guideT("libraryFilterTitle"),body:guideT("libraryFilterBody"),raw:true},
      {target:"#library .share-toolbar",title:guideT("libraryShareTitle"),body:guideT("libraryShareBody"),raw:true},
      {target:"#library #grid:not(.hidden), #library #board:not(.hidden)",title:guideT("libraryBooksTitle"),body:guideT("libraryBooksBody"),raw:true}
    ];
  }

  function routineDetailGuideSteps(r){
    return [
      {target:"#routineDetailTitle",title:guideT("detailIntroTitle"),body:guideT("detailIntroBody"),raw:true},
      {target:"#routineDetailStats",title:guideT("detailSummaryTitle"),body:guideT("detailSummaryBody"),raw:true},
      {target:"#routinePeriodStats",title:guideT("detailPeriodTitle"),body:guideT("detailPeriodBody"),raw:true},
      {target:"#routineDetailScreen .routine-year-card",title:guideT("detailYearTitle"),body:guideT("detailYearBody"),raw:true},
      {target:"#routineMonthChart",title:guideT("detailMonthTitle"),body:guideT("detailMonthBody"),raw:true},
      {target:"#routineDetailScreen .routine-edit-row",title:guideT("detailEditTitle"),body:guideT("detailEditBody"),raw:true},
      {target:"#routineEntryList",title:guideT("detailListTitle"),body:guideT("detailListBody"),raw:true}
    ];
  }

  function absoluteTop(el){
    const r=el.getBoundingClientRect();
    return r.top + window.scrollY;
  }

  function sortGuideStepsTopDown(steps){
    return steps
      .map((step,index)=>({step,index,el:document.querySelector(step.target)}))
      .filter(x=>x.el && x.el.offsetParent!==null)
      .sort((a,b)=>{
        const dy=absoluteTop(a.el)-absoluteTop(b.el);
        return Math.abs(dy)>2 ? dy : a.index-b.index;
      })
      .map(x=>x.step);
  }

  function startLibraryGuide(force=false){
    startGuide(libraryGuideSteps(),`${CONTEXT_GUIDE_PREFIX}library`,force);
  }

  function startRoutineDetailGuide(r,force=false){
    if(!r) return;
    startGuide(routineDetailGuideSteps(r),`${CONTEXT_GUIDE_PREFIX}detail:${r.id}`,force);
  }

  function startGuide(steps,key,force=false){
    if(!force && localStorage.getItem(key)==="done") return;
    if(document.body.classList.contains("auth-locked")) return;
    ensureOnboardingUi();
    state.activeGuideKey=key;

    // Always begin at the top of the current page, then sort only visible
    // targets by their real document position. This prevents a guide from
    // jumping down, back up, and down again when dynamic panels are inserted.
    window.scrollTo({top:0,left:0,behavior:"auto"});
    setTimeout(()=>{
      state.onboardingSteps=sortGuideStepsTopDown(steps);
      state.onboardingIndex=0;
      showOnboardingStep(0);
    },80);
  }

  function startReadingGuide(force=false){
    startGuide(readingGuideSteps(),`${CONTEXT_GUIDE_PREFIX}reading`,force);
  }

  function startRoutineGuide(r,force=false){
    if(!r) return;
    startGuide(routineGuideSteps(r),`${CONTEXT_GUIDE_PREFIX}${r.id}`,force);
  }

  function ensureContextGuideButton(screenId,onClick){
    const screen=document.getElementById(screenId);
    const wrap=screen?.querySelector(".home-wrap") || screen;
    if(!wrap) return;

    // Library has its own action row, so place the replay button there instead of
    // floating over the existing Export / Import controls.
    if(screenId==="library"){
      const actions=screen.querySelector(".lib-header .data-actions");
      if(!actions) return;
      let btn=actions.querySelector(".context-guide-btn");
      if(!btn){
        btn=document.createElement("button");
        btn.type="button";
        btn.className="icon-btn context-guide-btn";
        btn.style.position="static";
        actions.appendChild(btn);
      }
      btn.innerHTML=`<span aria-hidden="true">?</span><span>${guideT("replay")}</span>`;
      btn.onclick=onClick;
      return;
    }

    if(getComputedStyle(wrap).position==="static") wrap.style.position="relative";
    let btn=wrap.querySelector(":scope > .context-guide-btn");
    if(!btn){
      btn=document.createElement("button");
      btn.type="button";
      btn.className="context-guide-btn";
      wrap.appendChild(btn);
    }
    btn.innerHTML=`<span aria-hidden="true">?</span><span>${guideT("replay")}</span>`;
    btn.onclick=onClick;
  }

  function ensureOnboardingUi(){
    if(document.getElementById("uxOnboardingOverlay")) return;
    const overlay=document.createElement("div");
    overlay.id="uxOnboardingOverlay";
    overlay.className="ux-onboarding hidden";
    overlay.innerHTML=`
      <div class="ux-tour-card" role="dialog" aria-modal="true">
        <div class="ux-tour-progress" id="uxTourProgress"></div>
        <h3 id="uxTourTitle"></h3>
        <p id="uxTourBody"></p>
        <div class="ux-tour-actions">
          <button type="button" class="secondary" id="uxTourSkip">${uxTr("건너뛰기")}</button>
          <div>
            <button type="button" class="secondary" id="uxTourPrev">${uxTr("이전")}</button>
            <button type="button" id="uxTourNext">${uxTr("다음")}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#uxTourSkip").onclick=endOnboarding;
    overlay.querySelector("#uxTourPrev").onclick=()=>showOnboardingStep(state.onboardingIndex-1);
    overlay.querySelector("#uxTourNext").onclick=()=>showOnboardingStep(state.onboardingIndex+1);
    window.addEventListener("resize",()=>positionTourCard());
  }

  function clearTourTarget(){
    document.querySelectorAll(".ux-tour-target").forEach(el=>el.classList.remove("ux-tour-target"));
  }

  function positionTourCard(){
    const overlay=document.getElementById("uxOnboardingOverlay");
    const card=overlay?.querySelector(".ux-tour-card");
    const target=document.querySelector(".ux-tour-target");
    if(!overlay || !card || !target) return;
    const r=target.getBoundingClientRect();
    const gap=14;
    const cardW=Math.min(380,window.innerWidth-32);
    card.style.width=`${cardW}px`;
    const cardH=Math.min(card.offsetHeight || 260, window.innerHeight-32);
    let top=r.bottom+gap;
    if(top+cardH>window.innerHeight-16) top=Math.max(16,r.top-cardH-gap);
    let left=Math.min(window.innerWidth-cardW-16,Math.max(16,r.left+r.width/2-cardW/2));
    card.style.top=`${top}px`;
    card.style.left=`${left}px`;
  }

  function showOnboardingStep(index){
    ensureOnboardingUi();
    clearTourTarget();
    const steps=state.onboardingSteps;
    if(index>=steps.length){ endOnboarding(); return; }
    if(index<0) index=0;
    let step=steps[index];
    let target=document.querySelector(step.target);
    while((!target || target.offsetParent===null) && index<steps.length-1){
      index++;
      step=steps[index];
      target=document.querySelector(step.target);
    }
    if(!target){ endOnboarding(); return; }
    state.onboardingIndex=index;
    const overlay=document.getElementById("uxOnboardingOverlay");
    overlay.classList.remove("hidden");
    target.classList.add("ux-tour-target");
    target.scrollIntoView({behavior:getPrefs().reduceMotion?"auto":"smooth",block:"center",inline:"nearest"});
    overlay.querySelector("#uxTourTitle").textContent=step.raw?String(step.title):uxTr(step.title);
    overlay.querySelector("#uxTourBody").textContent=step.raw?String(step.body):uxTr(step.body);
    overlay.querySelector("#uxTourProgress").textContent=`${index+1} / ${steps.length}`;
    overlay.querySelector("#uxTourPrev").disabled=index===0;
    overlay.querySelector("#uxTourNext").textContent=index===steps.length-1?uxTr("가이드 종료"):uxTr("다음");
    setTimeout(positionTourCard,getPrefs().reduceMotion?0:280);
  }

  function startOnboarding(force=false){
    if(!force && localStorage.getItem(ONBOARDING_KEY)==="done") return;
    if(document.body.classList.contains("auth-locked")) return;
    if(typeof applyMbo==="function") applyMbo();
    state.activeGuideKey=ONBOARDING_KEY;
    state.onboardingSteps=onboardingSteps();
    state.onboardingIndex=0;
    setTimeout(()=>showOnboardingStep(0),80);
  }

  function endOnboarding(){
    clearTourTarget();
    document.getElementById("uxOnboardingOverlay")?.classList.add("hidden");
    if(state.activeGuideKey) localStorage.setItem(state.activeGuideKey,"done");
    state.activeGuideKey=null;
  }

  function enhanceAccessibility(root=document){
    root.querySelectorAll?.("button").forEach(btn=>{
      if(!btn.getAttribute("aria-label") && !btn.textContent.trim()){
        const title=btn.getAttribute("title");
        if(title) btn.setAttribute("aria-label",title);
      }
    });
    root.querySelectorAll?.(".op-bar-fill,.week-goal-fill,[class*='bar-fill']").forEach(el=>{
      if(!el.hasAttribute("role")) el.setAttribute("role","progressbar");
    });
    const toast=document.getElementById("globalToast");
    if(toast){ toast.setAttribute("role","status"); toast.setAttribute("aria-live","polite"); }
  }

  function ensureSkipLink(){
    if(document.getElementById("uxSkipLink")) return;
    const a=document.createElement("a");
    a.id="uxSkipLink";
    a.className="ux-skip-link";
    a.href="#mboScreen";
    a.textContent=uxTr("본문으로 건너뛰기");
    document.body.prepend(a);
  }

  function runBookaholicQA(){
    const ids=[...document.querySelectorAll("[id]")].map(x=>x.id);
    const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
    const emptyButtons=[...document.querySelectorAll("button")].filter(b=>!b.textContent.trim()&&!b.getAttribute("aria-label"));
    const overflow=document.documentElement.scrollWidth>document.documentElement.clientWidth+2;
    const checks=[
      {check:"중복 ID",pass:duplicates.length===0,detail:duplicates.join(", ")||"0"},
      {check:"빈 버튼 접근성",pass:emptyButtons.length===0,detail:String(emptyButtons.length)},
      {check:"가로 화면 넘침",pass:!overflow,detail:overflow?`${document.documentElement.scrollWidth}px`:"없음"},
      {check:"저장 상태 UI",pass:!!document.getElementById("saveStateIndicator"),detail:""},
      {check:"계정 메뉴",pass:!!document.getElementById("accountDock"),detail:""},
      {check:"설정 화면",pass:!!document.getElementById("uxSettingsModal"),detail:""},
      {check:"다국어 엔진",pass:!!window.I18N,detail:window.I18N?.getLanguage?.()||""}
    ];
    if(window.I18N?.getLanguage?.()!=="ko" && typeof window.auditUntranslatedKoreanUI==="function"){
      const left=window.auditUntranslatedKoreanUI();
      checks.push({check:"현재 화면 한국어 잔존",pass:left.length===0,detail:String(left.length)});
    }
    console.table(checks);
    return checks;
  }
  window.runBookaholicQA=runBookaholicQA;

  function installRuntimeWrappers(){
    if(window.__bookaholicUxWrapped) return;
    window.__bookaholicUxWrapped=true;

    if(typeof syncDataToSupabase==="function"){
      const baseSync=syncDataToSupabase;
      syncDataToSupabase=async function(...args){
        if(!navigator.onLine){ setSaveState("offline"); return false; }
        setSaveState("syncing");
        const ok=await baseSync(...args);
        if(ok){
          try{ localStorage.setItem(CLOUD_SAVE_META_PREFIX+currentStorageKey,String(Date.now())); }catch(_){}
        }
        return ok;
      };
    }

    if(typeof saveData==="function"){
      const baseSave=saveData;
      saveData=async function(opts={}){
        setSaveState("saving");
        const ok=await baseSave(opts);
        if(ok){
          try{ localStorage.setItem(LOCAL_SAVE_META_PREFIX+currentStorageKey,String(Date.now())); }catch(_){}
        }
        if(!ok) setSaveState("error");
        else if(!navigator.onLine) setSaveState("offline");
        else setSaveState("saved");
        return ok;
      };
    }

    if(typeof renderStats==="function"){
      const baseRenderStats=renderStats;
      renderStats=function(...args){
        const out=baseRenderStats(...args);
        requestAnimationFrame(renderReadingGoalAnalytics);
        return out;
      };
    }

    if(typeof renderLibrary==="function"){
      const baseRenderLibrary=renderLibrary;
      renderLibrary=function(...args){
        const out=baseRenderLibrary(...args);
        requestAnimationFrame(()=>{
          // renderStats may add the reading-goal analytics on the next frame.
          setTimeout(()=>{
            ensureContextGuideButton("library",()=>startLibraryGuide(true));
            startLibraryGuide(false);
            enhanceAccessibility(document);
          },120);
        });
        return out;
      };
    }

    if(typeof renderHome==="function"){
      const baseRenderHome=renderHome;
      renderHome=function(...args){
        const out=baseRenderHome(...args);
        requestAnimationFrame(()=>{
          const svg=document.querySelector("#homeScreen .home-ring svg");
          if(svg){
            svg.setAttribute("viewBox","0 0 180 180");
            svg.setAttribute("preserveAspectRatio","xMidYMid meet");
          }
          ensureContextGuideButton("homeScreen",()=>startReadingGuide(true));
          setTimeout(()=>startReadingGuide(false),180);
          enhanceAccessibility(document);
        });
        return out;
      };
    }

    if(typeof renderBridge==="function"){
      const baseRenderBridge=renderBridge;
      renderBridge=function(routineId,...args){
        const out=baseRenderBridge(routineId,...args);
        const r=getRoutine(routineId);
        requestAnimationFrame(()=>{
          document.getElementById("bridgeWakeTrendPanel")?.remove();
          document.getElementById("bridgeRoutineGoalTrendPanel")?.remove();

          if(r?.id==="wake_early") renderWakeTrend(r);
          if(r?.id==="qt") renderRoutineGoalTrend(r);

          ensureContextGuideButton("bridgeScreen",()=>startRoutineGuide(r,true));
          setTimeout(()=>startRoutineGuide(r,false),220);
          enhanceAccessibility(document);
        });
        return out;
      };
    }

    if(typeof renderRoutineDetail==="function"){
      const baseRenderRoutineDetail=renderRoutineDetail;
      renderRoutineDetail=function(routineId,...args){
        const out=baseRenderRoutineDetail(routineId,...args);
        const r=getRoutine(routineId);
        requestAnimationFrame(()=>{
          document.getElementById("wakeTrendPanel")?.remove();
          document.getElementById("routineGoalTrendPanel")?.remove();
          ensureContextGuideButton("routineDetailScreen",()=>startRoutineDetailGuide(r,true));
          setTimeout(()=>startRoutineDetailGuide(r,false),160);
          enhanceAccessibility(document);
        });
        return out;
      };
    }

    if(typeof renderMboMain==="function"){
      const baseRenderMboMain=renderMboMain;
      renderMboMain=function(...args){
        const out=baseRenderMboMain(...args);
        requestAnimationFrame(()=>{ renderInsights(); enhanceAccessibility(document); });
        return out;
      };
    }

    if(typeof renderRewards==="function"){
      const baseRenderRewards=renderRewards;
      renderRewards=function(...args){
        const out=baseRenderRewards(...args);
        requestAnimationFrame(appendAdvancedBadges);
        return out;
      };
    }
  }

  function initUxSuite(){
    applyPrefs();
    ensureSaveIndicator();
    ensureSettingsModal();
    ensureAccountDock();
    ensureOnboardingUi();
    ensureSkipLink();
    installRuntimeWrappers();
    enhanceAccessibility(document);

    supabaseClient.auth.getSession().then(({data})=>updateAccountDock(data.session));
    supabaseClient.auth.onAuthStateChange((_event,session)=>updateAccountDock(session));

    window.addEventListener("online",async()=>{
      setSaveState("syncing");
      const ok=await syncDataToSupabase();
      setSaveState(ok?"saved":"error");
    });
    window.addEventListener("offline",()=>setSaveState("offline"));

    window.addEventListener("mbo-language-change",()=>{
      setTimeout(()=>{
        ensureSettingsModal();
        renderReadingGoalAnalytics();
        if(currentBridgeId && !document.getElementById("bridgeScreen")?.classList.contains("hidden")){
          const r=getRoutine(currentBridgeId);
          document.getElementById("bridgeWakeTrendPanel")?.remove();
          document.getElementById("bridgeRoutineGoalTrendPanel")?.remove();
          if(r?.id==="wake_early") renderWakeTrend(r);
          if(r?.id==="qt") renderRoutineGoalTrend(r);
        }
        renderInsights();
      },30);
    });

    const observer=new MutationObserver((mutations)=>{
      mutations.forEach(m=>m.addedNodes.forEach(n=>{ if(n.nodeType===Node.ELEMENT_NODE) enhanceAccessibility(n); }));
    });
    observer.observe(document.body,{childList:true,subtree:true});

    setTimeout(()=>startOnboarding(false),700);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initUxSuite,{once:true});
  else initUxSuite();
})();
