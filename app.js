// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, onSnapshot, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyCBTp6Mcg_dSgmlJXmQOddYVgBZTeiFxJc",
  authDomain: "meal-tracker-1485f.firebaseapp.com",
  projectId: "meal-tracker-1485f",
  storageBucket: "meal-tracker-1485f.firebasestorage.app",
  messagingSenderId: "224736246706",
  appId: "1:224736246706:web:b3355480fb58fecb8d02ab",
  measurementId: "G-XNH01HJJK6"
};

// Init Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// STATE
let state = {
  user: null, 
  currentDate: new Date(),
  log: [],          
  library: [], 
  days: {}, // Map of dateStr -> { weight, steps }
  targets: { calories: 1800, protein: 180, carbs: 200, fat: 65, timezone: "local" },
  unsubscribeLog: null,
  unsubscribeLib: null,
  unsubscribeDays: null
};

// DOM Elements
const $ = (id) => document.getElementById(id);
const num = (v) => parseFloat(v) || 0;
const fmt = (v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;

// HELPER: Get Date String based on User Timezone Setting
const getLocalDate = (d) => {
  const tz = state.targets.timezone || "local";
  if (tz === "local") {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  } else {
    const hourOffset = parseFloat(tz);
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000); 
    const targetTime = new Date(utc + (3600000 * hourOffset));
    return targetTime.toISOString().split('T')[0];
  }
};

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}

// ---- AUTHENTICATION ----

function updateAuthUI(user) {
  state.user = user;
  if (user) {
    $("authOverlay").classList.add("hidden");
    $("appContainer").classList.add("active");
    initUserData(user.uid);
  } else {
    $("authOverlay").classList.remove("hidden");
    $("appContainer").classList.remove("active");
    state.log = [];
    state.library = [];
    state.days = {};
    if (state.unsubscribeLog) state.unsubscribeLog();
    if (state.unsubscribeLib) state.unsubscribeLib();
    if (state.unsubscribeDays) state.unsubscribeDays();
  }
}

$("btnLogin").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("authEmail").value;
  const pass = $("authPass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    $("authError").textContent = "Login failed: " + err.message;
  }
});

$("btnSignup").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("authEmail").value;
  const pass = $("authPass").value;
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
    toast("Account created!");
  } catch (err) {
    $("authError").textContent = err.message;
  }
});

$("btnLogout").addEventListener("click", () => signOut(auth));

// ---- DATABASE SYNC ----

async function initUserData(uid) {
  const settingsRef = doc(db, "users", uid, "data", "settings");
  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      state.targets = { ...state.targets, ...snap.data() };
    }
    updateTargetInputs();
  } catch(e) { console.error(e); }

  const libRef = collection(db, "users", uid, "meals");
  const qLib = query(libRef, orderBy("name"));
  state.unsubscribeLib = onSnapshot(qLib, (snapshot) => {
    state.library = [];
    snapshot.forEach((doc) => state.library.push({ id: doc.id, ...doc.data() }));
    buildDropdown($("mealSearch").value);
    renderSettingsLibrary(); 
  });

  const logRef = collection(db, "users", uid, "logs");
  const qLog = query(logRef, orderBy("createdAt", "desc"));
  $("logLoader").style.display = "block";
  state.unsubscribeLog = onSnapshot(qLog, (snapshot) => {
    state.log = [];
    snapshot.forEach((doc) => state.log.push({ id: doc.id, ...doc.data() }));
    $("logLoader").style.display = "none";
    render(); 
  });

  const daysRef = collection(db, "users", uid, "days");
  state.unsubscribeDays = onSnapshot(daysRef, (snapshot) => {
    state.days = {};
    snapshot.forEach((doc) => {
      state.days[doc.id] = doc.data();
    });
    renderMetrics(); 
  });
}

// ---- LOGIC ----

async function saveTargets() {
  if (!state.user) return;
  state.targets = {
    calories: num($("targetCalories").value),
    protein: num($("targetProtein").value),
    carbs: num($("targetCarbs").value),
    fat: num($("targetFat").value),
    timezone: $("tzSelect").value 
  };
  const ref = doc(db, "users", state.user.uid, "data", "settings");
  await setDoc(ref, state.targets, { merge: true });
  toast("Settings updated!");
  render(); 
}

async function saveDayMetrics() {
  if (!state.user) return;
  const dateStr = getLocalDate(state.currentDate);
  const data = {
    weight: num($("dayWeight").value),
    steps: num($("daySteps").value)
  };
  const ref = doc(db, "users", state.user.uid, "days", dateStr);
  await setDoc(ref, data, { merge: true });
  toast("Metrics saved");
}

async function addEntry(name, macros, source, servings = 1) {
  if (!state.user) return;
  const s = num(servings);
  const entry = {
    date: getLocalDate(state.currentDate),
    createdAt: Date.now(),
    name: name,
    source: source,
    servings: s,
    calories: num(macros.calories) * s,
    protein: num(macros.protein) * s,
    carbs: num(macros.carbs) * s,
    fat: num(macros.fat) * s,
    base: { ...macros } 
  };
  try {
    await addDoc(collection(db, "users", state.user.uid, "logs"), entry);
    toast(`Added: ${name}`);
    $("mealSearch").value = "";
    $("mealServings").value = "1";
    buildDropdown(""); 
  } catch (e) {
    toast("Error adding entry");
  }
}

async function saveToLibrary(name, macros) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, "users", state.user.uid, "meals"), { name, ...macros });
    toast(`Saved to Library: ${name}`);
  } catch (e) { toast("Error saving to library"); }
}

async function updateLibraryMeal(id, data) {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "meals", id);
  await updateDoc(ref, data);
  toast("Meal updated in Library");
}

async function deleteLibraryMeal(id) {
  if (!state.user) return;
  if(!confirm("Permanently delete this food from your database?")) return;
  const ref = doc(db, "users", state.user.uid, "meals", id);
  await deleteDoc(ref);
  toast("Meal deleted");
}

async function deleteEntry(id) {
  if (!state.user) return;
  if(!confirm("Remove this item?")) return;
  await deleteDoc(doc(db, "users", state.user.uid, "logs", id));
}

async function importDefaults() {
  if (!state.user) return;
  const btn = $("btnImportDefaults");
  const status = $("importStatus");
  btn.disabled = true;
  status.textContent = "Loading JSON...";
  try {
    const res = await fetch("meals.json");
    const defaults = await res.json();
    status.textContent = "Uploading to Database...";
    const batch = writeBatch(db);
    const collectionRef = collection(db, "users", state.user.uid, "meals");
    Object.entries(defaults).forEach(([name, macros]) => {
      const newDoc = doc(collectionRef); 
      batch.set(newDoc, {
        name: name,
        calories: num(macros.calories),
        protein: num(macros.protein),
        carbs: num(macros.carbs),
        fat: num(macros.fat),
        source: "default"
      });
    });
    await batch.commit();
    status.textContent = "Success!";
    toast(`Imported ${Object.keys(defaults).length} meals`);
  } catch (e) { status.textContent = "Error: " + e.message; } 
  finally { btn.disabled = false; }
}

// ---- UI RENDERING ----

function getDayLog() {
  const dateStr = getLocalDate(state.currentDate);
  return state.log.filter(i => i.date === dateStr);
}

function updateDateDisplay() {
  const now = new Date();
  const d = state.currentDate;
  const dStr = getLocalDate(d);
  const todayStr = getLocalDate(now);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const yestStr = getLocalDate(yesterday);
  $("dateLabel").textContent = (dStr === todayStr) ? "Today" : (dStr === yestStr ? "Yesterday" : d.toLocaleDateString());
  $("dateSub").textContent = dStr;
}

function renderRecents() {
  const host = $("recentList");
  host.innerHTML = "";
  const map = new Map();
  state.log.forEach(item => {
    if (!map.has(item.name) && item.base) map.set(item.name, item.base);
  });
  const recents = Array.from(map.entries()).slice(0, 12);
  if (recents.length === 0) {
    $("noRecents").classList.remove("hidden");
    return;
  }
  $("noRecents").classList.add("hidden");
  recents.forEach(([name, macros]) => {
    const el = document.createElement("div");
    el.className = "recent-item";
    el.textContent = name;
    el.onclick = () => addEntry(name, macros, "recent", 1);
    host.appendChild(el);
  });
}

function renderLog() {
  const list = $("selectedMeals");
  list.innerHTML = "";
  const dayLog = getDayLog();
  $("emptyLog").style.display = dayLog.length ? "none" : "block";
  dayLog.forEach(item => {
    const el = document.createElement("div");
    el.className = "log-item";
    const cal = num(item.calories);
    const pro = num(item.protein);
    let ppc = cal > 0 ? (pro / cal).toFixed(2) : "0";
    if (ppc.endsWith('0')) ppc = ppc.slice(0, -1);
    if (ppc.endsWith('.')) ppc = ppc.slice(0, -1);
    el.innerHTML = `
      <div class="log-info">
        <h4>${item.name}</h4>
        <div class="log-sub">${fmt(item.servings)} srv • ${Math.round(cal)} kcal</div>
        <div class="log-macros">
          <span class="macro-p">P: ${fmt(pro)}</span>
          <span class="macro-c">C: ${fmt(item.carbs)}</span>
          <span class="macro-f">F: ${fmt(item.fat)}</span>
          <span class="macro-ppc">PPC: ${ppc}</span>
        </div>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn-ghost delete-trigger" style="color:var(--danger);">✕</button>
      </div>
    `;
    el.querySelector(".delete-trigger").onclick = (e) => {
      e.stopPropagation(); deleteEntry(item.id);
    };
    list.appendChild(el);
  });
  updateStats(dayLog);
  renderMetrics(); 
}

function renderMetrics() {
  const dateStr = getLocalDate(state.currentDate);
  const data = state.days[dateStr] || {};
  $("dayWeight").value = data.weight || "";
  $("daySteps").value = data.steps || "";
}

function updateStats(dayLog) {
  const totals = dayLog.reduce((acc, x) => ({
    cal: acc.cal + x.calories,
    p: acc.p + x.protein,
    c: acc.c + x.carbs,
    f: acc.f + x.fat
  }), { cal: 0, p: 0, c: 0, f: 0 });
  const totalGrams = totals.p + totals.c + totals.f;
  const pPct = totalGrams ? (totals.p / totalGrams) * 100 : 0;
  const cPct = totalGrams ? (totals.c / totalGrams) * 100 : 0;
  const chart = $("macroDonut");
  if (totalGrams > 0) {
    chart.style.background = `conic-gradient(var(--accent-p) 0% ${pPct}%, var(--accent-c) ${pPct}% ${pPct + cPct}%, var(--accent-f) ${pPct + cPct}% 100%)`;
  } else {
    chart.style.background = "var(--border)";
  }
  $("calDisplay").textContent = Math.round(totals.cal);
  $("dispP").textContent = `${Math.round(totals.p)}g`;
  $("dispC").textContent = `${Math.round(totals.c)}g`;
  $("dispF").textContent = `${Math.round(totals.f)}g`;
  const setBar = (id, remId, val, target, unit="") => {
    const pct = Math.min((val / target) * 100, 100);
    const rem = target - val;
    $(id).style.width = `${pct}%`;
    $(remId).textContent = rem >= 0 ? `${Math.round(rem)}${unit} left` : `${Math.round(Math.abs(rem))}${unit} over`;
    $(remId).style.color = rem < 0 ? "var(--danger)" : "var(--text-muted)";
  };
  setBar("barCal", "remCal", totals.cal, state.targets.calories);
  setBar("barPro", "remPro", totals.p, state.targets.protein, "g");
  setBar("barCarb", "remCarb", totals.c, state.targets.carbs, "g");
  setBar("barFat", "remFat", totals.f, state.targets.fat, "g");
}

function buildDropdown(filter = "") {
  const sel = $("mealDropdown");
  sel.innerHTML = "";
  const term = filter.toLowerCase();
  const matches = state.library.filter(m => m.name.toLowerCase().includes(term));
  matches.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.id; 
    opt.textContent = item.name;
    sel.appendChild(opt);
  });
  if (!matches.length) {
    const opt = document.createElement("option");
    opt.textContent = "No matches found";
    opt.disabled = true;
    sel.appendChild(opt);
  } else sel.selectedIndex = 0;
}

function updateTargetInputs() {
  $("targetCalories").value = state.targets.calories;
  $("targetProtein").value = state.targets.protein;
  $("targetCarbs").value = state.targets.carbs;
  $("targetFat").value = state.targets.fat;
  $("tzSelect").value = state.targets.timezone || "local";
}

function renderSettingsLibrary() {
  const list = $("libraryList");
  list.innerHTML = "";
  const filter = ($("libSearch").value || "").toLowerCase();
  const items = state.library
    .filter(i => i.name.toLowerCase().includes(filter))
    .sort((a,b) => a.name.localeCompare(b.name));
  if (items.length === 0) {
    list.innerHTML = '<div style="padding:10px; color:var(--text-muted); text-align:center;">No foods found.</div>';
    return;
  }
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "lib-item";
    div.innerHTML = `
      <div>
        <div class="lib-info">${item.name}</div>
        <div class="lib-meta">${Math.round(item.calories)} cal • P:${item.protein} C:${item.carbs} F:${item.fat}</div>
      </div>
      <div style="font-size:1.2rem; color:var(--text-muted);">›</div>
    `;
    div.onclick = () => openEditLibModal(item);
    list.appendChild(div);
  });
}

// ---- ANALYTICS LOGIC ----

function renderStats() {
  // Helper to format numbers with commas
  const fNum = (n) => n ? Math.round(n).toLocaleString() : "-";

  // 1. Weekly Stats (Last 7 Days)
  const weeklyTbody = $("weeklyTable").querySelector("tbody");
  weeklyTbody.innerHTML = "";
  const today = new Date();
  let weeklyTotals = { cal:0, pro:0, carb:0, fat:0, wt:0, steps:0, days:0 };
  
  for(let i=6; i>=0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    
    const logs = state.log.filter(l => l.date === dateStr);
    const dayTotals = logs.reduce((acc, x) => ({
      cal: acc.cal + x.calories, pro: acc.pro + x.protein, 
      carb: acc.carb + x.carbs, fat: acc.fat + x.fat
    }), { cal:0, pro:0, carb:0, fat:0 });

    const metrics = state.days[dateStr] || {};
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.toLocaleDateString(undefined, {weekday:'short', day:'numeric'})}</td>
      <td>${fNum(dayTotals.cal)}</td>
      <td>${fNum(dayTotals.pro)}</td>
      <td>${fNum(dayTotals.carb)}</td>
      <td>${fNum(dayTotals.fat)}</td>
      <td>${metrics.weight || "-"}</td>
      <td>${fNum(metrics.steps)}</td>
    `;
    weeklyTbody.appendChild(tr);

    weeklyTotals.cal += dayTotals.cal;
    weeklyTotals.pro += dayTotals.pro;
    weeklyTotals.carb += dayTotals.carb;
    weeklyTotals.fat += dayTotals.fat;
    if(metrics.weight) { weeklyTotals.wt += metrics.weight; weeklyTotals.wtCount = (weeklyTotals.wtCount||0)+1; }
    if(metrics.steps) weeklyTotals.steps += metrics.steps;
    weeklyTotals.days++;
  }

  const avgRow = $("weeklyAvgRow");
  avgRow.innerHTML = `
    <td>Avg/Tot</td>
    <td>${fNum(weeklyTotals.cal / 7)}</td>
    <td>${fNum(weeklyTotals.pro / 7)}</td>
    <td>${fNum(weeklyTotals.carb / 7)}</td>
    <td>${fNum(weeklyTotals.fat / 7)}</td>
    <td>${weeklyTotals.wtCount ? (weeklyTotals.wt / weeklyTotals.wtCount).toFixed(1) : "-"}</td>
    <td>${fNum(weeklyTotals.steps)}</td>
  `;

  // 2. Monthly Overview (By Week)
  const monthlyTbody = $("monthlyTable").querySelector("tbody");
  monthlyTbody.innerHTML = "";
  
  for(let w=0; w<4; w++) {
    let weekCal=0, weekPro=0, weekWt=0, weekWtCnt=0, weekSteps=0;
    let startDate;

    for(let d=0; d<7; d++) {
      const dayOffset = (w * 7) + d;
      const dateObj = new Date(today); dateObj.setDate(today.getDate() - dayOffset);
      if(d===6) startDate = dateObj; 
      
      const dateStr = getLocalDate(dateObj);
      const logs = state.log.filter(l => l.date === dateStr);
      weekCal += logs.reduce((sum, x) => sum + x.calories, 0);
      weekPro += logs.reduce((sum, x) => sum + x.protein, 0);
      
      const met = state.days[dateStr] || {};
      if(met.weight) { weekWt += met.weight; weekWtCnt++; }
      if(met.steps) weekSteps += met.steps;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${startDate ? startDate.toLocaleDateString() : 'Current'}</td>
      <td>${fNum(weekCal / 7)}</td>
      <td>${fNum(weekPro / 7)}</td>
      <td>${weekWtCnt ? (weekWt / weekWtCnt).toFixed(1) : "-"}</td>
      <td>${fNum(weekSteps)}</td>
    `;
    monthlyTbody.appendChild(tr);
  }
}

// ---- MODAL HANDLERS ----

let editingLibId = null;
function openEditLibModal(item) {
  if (!item) {
    editingLibId = null;
    $("libModalTitle").textContent = "Add New Food";
    $("libName").value = ""; $("libCal").value = ""; $("libPro").value = ""; $("libCarb").value = ""; $("libFat").value = "";
    $("deleteLibBtn").style.display = "none";
  } else {
    editingLibId = item.id;
    $("libModalTitle").textContent = "Edit Saved Meal";
    $("libName").value = item.name; $("libCal").value = item.calories; $("libPro").value = item.protein; $("libCarb").value = item.carbs; $("libFat").value = item.fat;
    $("deleteLibBtn").style.display = "inline-block";
  }
  $("editLibModal").showModal();
}

$("saveLibBtn").onclick = async () => {
  const name = $("libName").value.trim();
  if (!name) return toast("Name required");
  const macros = { calories: num($("libCal").value), protein: num($("libPro").value), carbs: num($("libCarb").value), fat: num($("libFat").value) };
  if(editingLibId) await updateLibraryMeal(editingLibId, { name, ...macros });
  else await saveToLibrary(name, macros);
  $("editLibModal").close();
};
$("deleteLibBtn").onclick = async () => { if(editingLibId) await deleteLibraryMeal(editingLibId); $("editLibModal").close(); };
$("closeLibBtn").onclick = () => $("editLibModal").close();
$("btnAddLibItem").onclick = () => openEditLibModal(null);


// ---- INIT ----

async function init() {
  const savedTheme = localStorage.getItem("mt_theme"); 
  if(savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

  onAuthStateChanged(auth, (user) => updateAuthUI(user));

  $("mealSearch").addEventListener("input", (e) => buildDropdown(e.target.value));
  
  $("addMealBtn").onclick = () => {
    const id = $("mealDropdown").value;
    const item = state.library.find(x => x.id === id);
    if (item) addEntry(item.name, item, "db", $("mealServings").value);
  };
  
  $("addManualBtn").onclick = () => {
    const macros = { calories: $("manualCalories").value, protein: $("manualProtein").value, carbs: $("manualCarbs").value, fat: $("manualFat").value };
    addEntry($("manualName").value || "Manual", macros, "manual", $("manualServings").value);
  };

  $("addSaveManualBtn").onclick = async () => {
    const name = $("manualName").value.trim();
    if (!name) return toast("Name required");
    const macros = { calories: num($("manualCalories").value), protein: num($("manualProtein").value), carbs: num($("manualCarbs").value), fat: num($("manualFat").value) };
    await saveToLibrary(name, macros);
    await addEntry(name, macros, "manual", $("manualServings").value);
  };

  $("saveMetricsBtn").onclick = saveDayMetrics;

  $("btnImportDefaults").onclick = importDefaults;

  $("prevDateBtn").onclick = () => { state.currentDate.setDate(state.currentDate.getDate() - 1); render(); };
  $("nextDateBtn").onclick = () => { state.currentDate.setDate(state.currentDate.getDate() + 1); render(); };

  $("themeToggle").onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mt_theme", next);
  };
  
  $("btnStats").onclick = () => { renderStats(); $("trackerLayout").classList.add("hidden"); $("statsView").classList.remove("hidden"); };
  $("closeStatsBtn").onclick = () => { $("statsView").classList.add("hidden"); $("trackerLayout").classList.remove("hidden"); };
  
  $("btnSettings").onclick = () => { renderSettingsLibrary(); updateTargetInputs(); $("settingsModal").showModal(); };
  $("closeSettingsBtn").onclick = () => $("settingsModal").close();
  $("saveTargetsBtn").onclick = saveTargets;
  $("libSearch").addEventListener("input", renderSettingsLibrary);

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    };
  });

  render();
}

function render() {
  updateDateDisplay();
  buildDropdown($("mealSearch").value);
  renderLog();
  if(!$("tab-recent").classList.contains("hidden")) renderRecents();
}

document.addEventListener("DOMContentLoaded", init);
