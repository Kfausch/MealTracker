// ============================================
// FITNESS TRACKER PRO - APP.JS
// Firebase-powered meal & workout tracking
// ============================================

// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, onSnapshot, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === CONFIGURATION ===
const firebaseConfig = {
  apiKey: "AIzaSyCBTp6Mcg_dSgmlJXmQOddYVgBZTeiFxJc",
  authDomain: "meal-tracker-1485f.firebaseapp.com",
  projectId: "meal-tracker-1485f",
  storageBucket: "meal-tracker-1485f.firebasestorage.app",
  messagingSenderId: "224736246706",
  appId: "1:224736246706:web:b3355480fb58fecb8d02ab",
  measurementId: "G-XNH01HJJK6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === APPLICATION STATE ===
let state = {
  user: null,
  currentDate: new Date(),
  log: [],
  library: [],
  days: {},
  targets: { 
    calories: 1800, protein: 180, carbs: 200, fat: 65, 
    timezone: "local", restTimer: 60
  },
  // Workout state
  workoutSchedule: {},    // { Monday: { title, focus, restDay, exercises: [] }, ... }
  workoutLogs: [],        // All workout log entries
  activeWorkout: null,    // { startTime, exerciseStates: {} }
  restTimerInterval: null,
  restTimeRemaining: 0,
  durationInterval: null,
  // Subscriptions
  unsubscribeLog: null,
  unsubscribeLib: null,
  unsubscribeDays: null,
  unsubscribeWoSchedule: null,
  unsubscribeWoLogs: null
};

// === UTILITY FUNCTIONS ===
const $ = (id) => document.getElementById(id);
const num = (v) => parseFloat(v) || 0;
const fmt = (v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;

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

const getDayName = (d) => {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
};

function toast(msg, duration = 2500) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

// ============================================
// AUTHENTICATION
// ============================================
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
    state.workoutSchedule = {};
    state.workoutLogs = [];
    if (state.unsubscribeLog) state.unsubscribeLog();
    if (state.unsubscribeLib) state.unsubscribeLib();
    if (state.unsubscribeDays) state.unsubscribeDays();
    if (state.unsubscribeWoSchedule) state.unsubscribeWoSchedule();
    if (state.unsubscribeWoLogs) state.unsubscribeWoLogs();
  }
}

$("btnLogin").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value;
  $("authError").textContent = "";
  if (!email || !pass) { $("authError").textContent = "Please enter email and password"; return; }
  try {
    $("btnLogin").disabled = true;
    $("btnLogin").innerHTML = '<span>Signing in...</span>';
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    $("authError").textContent = formatAuthError(err.code);
  } finally {
    $("btnLogin").disabled = false;
    $("btnLogin").innerHTML = '<span>Log In</span><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
});

$("btnSignup").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value;
  $("authError").textContent = "";
  if (!email || !pass) { $("authError").textContent = "Please enter email and password"; return; }
  if (pass.length < 6) { $("authError").textContent = "Password must be at least 6 characters"; return; }
  try {
    $("btnSignup").disabled = true;
    $("btnSignup").textContent = "Creating account...";
    await createUserWithEmailAndPassword(auth, email, pass);
    toast("Account created! Welcome to Fitness Tracker 🎉");
  } catch (err) {
    $("authError").textContent = formatAuthError(err.code);
  } finally {
    $("btnSignup").disabled = false;
    $("btnSignup").textContent = "Create Account";
  }
});

function formatAuthError(code) {
  const errors = {
    'auth/invalid-email': 'Invalid email address',
    'auth/user-disabled': 'This account has been disabled',
    'auth/user-not-found': 'No account found with this email',
    'auth/wrong-password': 'Incorrect password',
    'auth/email-already-in-use': 'An account already exists with this email',
    'auth/weak-password': 'Password is too weak',
    'auth/invalid-credential': 'Invalid email or password'
  };
  return errors[code] || 'Authentication failed. Please try again.';
}

$("btnLogout").addEventListener("click", () => {
  if (confirm("Are you sure you want to log out?")) signOut(auth);
});

// ============================================
// DATABASE SYNC
// ============================================
async function initUserData(uid) {
  // Load user settings
  const settingsRef = doc(db, "users", uid, "data", "settings");
  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) state.targets = { ...state.targets, ...snap.data() };
    updateTargetInputs();
  } catch (e) { console.error("Error loading settings:", e); }

  // Subscribe to meal library
  const libRef = collection(db, "users", uid, "meals");
  const qLib = query(libRef, orderBy("name"));
  state.unsubscribeLib = onSnapshot(qLib, (snapshot) => {
    state.library = [];
    snapshot.forEach((doc) => state.library.push({ id: doc.id, ...doc.data() }));
    buildDropdown($("mealSearch").value);
    renderSettingsLibrary();
  });

  // Subscribe to food log
  const logRef = collection(db, "users", uid, "logs");
  const qLog = query(logRef, orderBy("createdAt", "desc"));
  $("logLoader").style.display = "flex";
  state.unsubscribeLog = onSnapshot(qLog, (snapshot) => {
    state.log = [];
    snapshot.forEach((doc) => state.log.push({ id: doc.id, ...doc.data() }));
    $("logLoader").style.display = "none";
    render();
    calculateStreak();
  });

  // Subscribe to daily metrics
  const daysRef = collection(db, "users", uid, "days");
  state.unsubscribeDays = onSnapshot(daysRef, (snapshot) => {
    state.days = {};
    snapshot.forEach((doc) => { state.days[doc.id] = doc.data(); });
    renderMetrics();
    renderWeeklyMini();
  });

  // Subscribe to workout schedule
  const schedRef = collection(db, "users", uid, "workoutSchedule");
  state.unsubscribeWoSchedule = onSnapshot(schedRef, (snapshot) => {
    state.workoutSchedule = {};
    snapshot.forEach((d) => { state.workoutSchedule[d.id] = d.data(); });
    renderWorkoutView();
    renderScheduleEditor();
  });

  // Subscribe to workout logs
  const woLogRef = collection(db, "users", uid, "workoutLogs");
  const qWoLog = query(woLogRef, orderBy("date", "desc"));
  state.unsubscribeWoLogs = onSnapshot(qWoLog, (snapshot) => {
    state.workoutLogs = [];
    snapshot.forEach((d) => state.workoutLogs.push({ id: d.id, ...d.data() }));
    renderWorkoutView();
  });
}

// ============================================
// NUTRITION CORE FUNCTIONS
// ============================================
async function saveTargets() {
  if (!state.user) return;
  state.targets = {
    calories: num($("targetCalories").value),
    protein: num($("targetProtein").value),
    carbs: num($("targetCarbs").value),
    fat: num($("targetFat").value),
    timezone: $("tzSelect").value,
    restTimer: num($("restTimerSelect").value) || 60
  };
  const ref = doc(db, "users", state.user.uid, "data", "settings");
  await setDoc(ref, state.targets, { merge: true });
  toast("Targets updated!");
  render();
}

async function saveDayMetrics() {
  if (!state.user) return;
  const dateStr = getLocalDate(state.currentDate);
  const data = { weight: num($("dayWeight").value), steps: num($("daySteps").value) };
  const ref = doc(db, "users", state.user.uid, "days", dateStr);
  await setDoc(ref, data, { merge: true });
  toast("Metrics saved");
}

async function saveDayNotes() {
  if (!state.user) return;
  const dateStr = getLocalDate(state.currentDate);
  const notes = $("dayNotes").value.trim();
  const ref = doc(db, "users", state.user.uid, "days", dateStr);
  await setDoc(ref, { notes }, { merge: true });
  toast("Note saved");
}

async function addEntry(name, macros, source, servings = 1) {
  if (!state.user) return;
  const s = num(servings);
  if (s <= 0) { toast("Please enter valid servings"); return; }
  const entry = {
    date: getLocalDate(state.currentDate),
    createdAt: Date.now(),
    name, source, servings: s,
    calories: num(macros.calories) * s,
    protein: num(macros.protein) * s,
    carbs: num(macros.carbs) * s,
    fat: num(macros.fat) * s,
    base: {
      calories: num(macros.calories),
      protein: num(macros.protein),
      carbs: num(macros.carbs),
      fat: num(macros.fat)
    }
  };
  try {
    await addDoc(collection(db, "users", state.user.uid, "logs"), entry);
    toast(`Added: ${name}`);
    $("mealSearch").value = "";
    $("mealServings").value = "1";
    buildDropdown("");
  } catch (e) { console.error("Error adding entry:", e); toast("Error adding entry"); }
}

async function saveToLibrary(name, macros) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, "users", state.user.uid, "meals"), { 
      name, calories: num(macros.calories), protein: num(macros.protein),
      carbs: num(macros.carbs), fat: num(macros.fat)
    });
    toast(`Saved to Library: ${name}`);
  } catch (e) { toast("Error saving to library"); }
}

async function updateLibraryMeal(id, data) {
  if (!state.user) return;
  await updateDoc(doc(db, "users", state.user.uid, "meals", id), data);
  toast("Meal updated");
}

async function deleteLibraryMeal(id) {
  if (!state.user) return;
  if (!confirm("Permanently delete this food from your library?")) return;
  await deleteDoc(doc(db, "users", state.user.uid, "meals", id));
  toast("Meal deleted");
}

async function deleteEntry(id) {
  if (!state.user) return;
  if (!confirm("Remove this item from today's log?")) return;
  await deleteDoc(doc(db, "users", state.user.uid, "logs", id));
  toast("Entry removed");
}

async function copyPreviousDay() {
  if (!state.user) return;
  const currentDateStr = getLocalDate(state.currentDate);
  const prevDate = new Date(state.currentDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = getLocalDate(prevDate);
  const prevDayLog = state.log.filter(i => i.date === prevDateStr);
  if (prevDayLog.length === 0) { toast("No meals logged yesterday"); return; }
  if (!confirm(`Copy ${prevDayLog.length} meal(s) from yesterday?`)) return;
  try {
    const batch = writeBatch(db);
    const collectionRef = collection(db, "users", state.user.uid, "logs");
    prevDayLog.forEach((meal) => {
      const newDoc = doc(collectionRef);
      batch.set(newDoc, { ...meal, id: undefined, date: currentDateStr, createdAt: Date.now() });
    });
    await batch.commit();
    toast(`Copied ${prevDayLog.length} meals from yesterday!`);
  } catch (e) { console.error("Error copying meals:", e); toast("Error copying meals"); }
}

async function importDefaults() {
  if (!state.user) return;
  const btn = $("btnImportDefaults");
  const status = $("importStatus");
  btn.disabled = true;
  status.textContent = "Loading...";
  try {
    const res = await fetch("meals.json");
    const defaults = await res.json();
    status.textContent = "Uploading...";
    const batch = writeBatch(db);
    const collectionRef = collection(db, "users", state.user.uid, "meals");
    Object.entries(defaults).forEach(([name, macros]) => {
      const newDoc = doc(collectionRef);
      batch.set(newDoc, { name, calories: num(macros.calories), protein: num(macros.protein), carbs: num(macros.carbs), fat: num(macros.fat), source: "default" });
    });
    await batch.commit();
    status.textContent = "✓ Success!";
    toast(`Imported ${Object.keys(defaults).length} meals`);
  } catch (e) { status.textContent = "Error: " + e.message; }
  finally { btn.disabled = false; setTimeout(() => { status.textContent = ""; }, 3000); }
}

function calculateStreak() {
  const today = new Date();
  let streak = 0;
  let checkDate = new Date(today);
  while (true) {
    const dateStr = getLocalDate(checkDate);
    const dayLog = state.log.filter(i => i.date === dateStr);
    if (dayLog.length > 0) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
    else {
      if (dateStr === getLocalDate(today)) { checkDate.setDate(checkDate.getDate() - 1); continue; }
      break;
    }
  }
  $("streakCount").textContent = streak;
  const badge = $("streakBadge");
  badge.style.transform = "scale(1.1)";
  setTimeout(() => { badge.style.transform = "scale(1)"; }, 200);
}

function exportToCSV() {
  if (!state.user || state.log.length === 0) { toast("No data to export"); return; }
  const headers = ["Date", "Name", "Servings", "Calories", "Protein", "Carbs", "Fat"];
  const rows = state.log.map(entry => [entry.date, `"${entry.name.replace(/"/g, '""')}"`, entry.servings, Math.round(entry.calories), Math.round(entry.protein), Math.round(entry.carbs), Math.round(entry.fat)]);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fitness-tracker-export-${getLocalDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Data exported!");
}

// ============================================
// NUTRITION UI RENDERING
// ============================================
function getDayLog() {
  const dateStr = getLocalDate(state.currentDate);
  return state.log.filter(i => i.date === dateStr);
}

function updateDateDisplay() {
  const now = new Date();
  const d = state.currentDate;
  const dStr = getLocalDate(d);
  const todayStr = getLocalDate(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yestStr = getLocalDate(yesterday);
  let label;
  if (dStr === todayStr) label = "Today";
  else if (dStr === yestStr) label = "Yesterday";
  else label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  $("dateLabel").textContent = label;
  $("dateSub").textContent = dStr;
  // Also update workout date
  $("woDateLabel").textContent = label;
  $("woDateSub").textContent = dStr;
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
    updateMealPreview(null);
  } else {
    sel.selectedIndex = 0;
    updateMealPreview(state.library.find(x => x.id === sel.value));
  }
}

function updateMealPreview(item) {
  if (!item) {
    $("previewName").textContent = "Select a meal";
    $("previewMacros").innerHTML = `<span class="macro-pill cal-pill">-- cal</span><span class="macro-pill p-pill">P: --</span><span class="macro-pill c-pill">C: --</span><span class="macro-pill f-pill">F: --</span>`;
    return;
  }
  const servings = num($("mealServings").value) || 1;
  $("previewName").textContent = item.name;
  $("previewMacros").innerHTML = `<span class="macro-pill cal-pill">${Math.round(item.calories * servings)} cal</span><span class="macro-pill p-pill">P: ${Math.round(item.protein * servings)}g</span><span class="macro-pill c-pill">C: ${Math.round(item.carbs * servings)}g</span><span class="macro-pill f-pill">F: ${Math.round(item.fat * servings)}g</span>`;
}

function renderRecents() {
  const host = $("recentList");
  host.innerHTML = "";
  const map = new Map();
  state.log.forEach(item => { if (!map.has(item.name) && item.base) map.set(item.name, item.base); });
  const recents = Array.from(map.entries()).slice(0, 12);
  if (recents.length === 0) { $("noRecents").classList.remove("hidden"); return; }
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
  $("emptyLog").style.display = dayLog.length ? "none" : "flex";
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
          <span class="macro-p">P: ${fmt(pro)}g</span>
          <span class="macro-c">C: ${fmt(item.carbs)}g</span>
          <span class="macro-f">F: ${fmt(item.fat)}g</span>
          <span class="macro-ppc">PPC: ${ppc}</span>
        </div>
      </div>
      <div class="log-actions">
        <button class="delete-trigger" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `;
    el.querySelector(".delete-trigger").onclick = (e) => { e.stopPropagation(); deleteEntry(item.id); };
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
  $("dayNotes").value = data.notes || "";
}

function updateStats(dayLog) {
  const totals = dayLog.reduce((acc, x) => ({
    cal: acc.cal + x.calories, p: acc.p + x.protein, c: acc.c + x.carbs, f: acc.f + x.fat
  }), { cal: 0, p: 0, c: 0, f: 0 });

  const totalGrams = totals.p + totals.c + totals.f;
  const pPct = totalGrams ? (totals.p / totalGrams) * 100 : 0;
  const cPct = totalGrams ? (totals.c / totalGrams) * 100 : 0;
  const chart = $("macroDonut");
  if (totalGrams > 0) {
    chart.style.background = `conic-gradient(var(--accent-p) 0% ${pPct}%, var(--accent-c) ${pPct}% ${pPct + cPct}%, var(--accent-f) ${pPct + cPct}% 100%)`;
  } else { chart.style.background = "var(--border)"; }

  $("calDisplay").textContent = Math.round(totals.cal);
  $("dispP").textContent = `${Math.round(totals.p)}g`;
  $("dispC").textContent = `${Math.round(totals.c)}g`;
  $("dispF").textContent = `${Math.round(totals.f)}g`;

  const setBar = (fillId, remId, currentId, targetId, val, target, unit = "") => {
    const pct = Math.min((val / target) * 100, 100);
    const rem = target - val;
    $(fillId).style.width = `${pct}%`;
    $(currentId).textContent = Math.round(val);
    $(targetId).textContent = target;
    if (rem >= 0) { $(remId).textContent = `${Math.round(rem)}${unit} left`; $(remId).style.color = "var(--text-muted)"; }
    else { $(remId).textContent = `${Math.round(Math.abs(rem))}${unit} over`; $(remId).style.color = "var(--danger)"; }
  };
  setBar("barCal", "remCal", "calCurrent", "calTarget", totals.cal, state.targets.calories);
  setBar("barPro", "remPro", "proCurrent", "proTarget", totals.p, state.targets.protein, "g");
  setBar("barCarb", "remCarb", "carbCurrent", "carbTarget", totals.c, state.targets.carbs, "g");
  setBar("barFat", "remFat", "fatCurrent", "fatTarget", totals.f, state.targets.fat, "g");
}

function renderWeeklyMini() {
  const weekDots = $("weekDots");
  weekDots.innerHTML = "";
  const today = new Date();
  const todayStr = getLocalDate(today);
  let weekCalTotal = 0, weekProTotal = 0, daysWithData = 0;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const dayLog = state.log.filter(l => l.date === dateStr);
    const dayTotals = dayLog.reduce((acc, x) => ({ cal: acc.cal + x.calories, pro: acc.pro + x.protein }), { cal: 0, pro: 0 });
    if (dayTotals.cal > 0) { weekCalTotal += dayTotals.cal; weekProTotal += dayTotals.pro; daysWithData++; }
    const pct = Math.min((dayTotals.cal / state.targets.calories) * 100, 100);
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const dot = document.createElement("div");
    dot.className = "week-dot" + (dateStr === todayStr ? " today" : "");
    dot.innerHTML = `<div class="week-dot-fill" style="height: ${pct}%"></div><div class="week-dot-label">${dayNames[d.getDay()]}</div>`;
    dot.title = `${dateStr}: ${Math.round(dayTotals.cal)} cal`;
    weekDots.appendChild(dot);
  }
  $("weekAvgCal").textContent = daysWithData > 0 ? Math.round(weekCalTotal / daysWithData) : "--";
  $("weekAvgPro").textContent = daysWithData > 0 ? `${Math.round(weekProTotal / daysWithData)}g` : "--";
}

function updateTargetInputs() {
  $("targetCalories").value = state.targets.calories;
  $("targetProtein").value = state.targets.protein;
  $("targetCarbs").value = state.targets.carbs;
  $("targetFat").value = state.targets.fat;
  $("tzSelect").value = state.targets.timezone || "local";
  $("restTimerSelect").value = state.targets.restTimer || 60;
}

function renderSettingsLibrary() {
  const list = $("libraryList");
  list.innerHTML = "";
  const filter = ($("libSearch").value || "").toLowerCase();
  const items = state.library.filter(i => i.name.toLowerCase().includes(filter)).sort((a, b) => a.name.localeCompare(b.name));
  if (items.length === 0) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No foods found</div>'; return; }
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "lib-item";
    div.innerHTML = `<div><div class="lib-info">${item.name}</div><div class="lib-meta">${Math.round(item.calories)} cal • P:${item.protein} C:${item.carbs} F:${item.fat}</div></div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="color:var(--text-muted);"><polyline points="9 18 15 12 9 6"/></svg>`;
    div.onclick = () => openEditLibModal(item);
    list.appendChild(div);
  });
}

// ============================================
// NUTRITION ANALYTICS
// ============================================
function renderStats() {
  const fNum = (n) => n ? Math.round(n).toLocaleString() : "-";
  const weeklyTbody = $("weeklyTable").querySelector("tbody");
  weeklyTbody.innerHTML = "";
  const today = new Date();
  let weeklyTotals = { cal: 0, pro: 0, carb: 0, fat: 0, wt: 0, steps: 0, wtCount: 0 };
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const logs = state.log.filter(l => l.date === dateStr);
    const dt = logs.reduce((acc, x) => ({ cal: acc.cal + x.calories, pro: acc.pro + x.protein, carb: acc.carb + x.carbs, fat: acc.fat + x.fat }), { cal: 0, pro: 0, carb: 0, fat: 0 });
    const metrics = state.days[dateStr] || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</td><td>${fNum(dt.cal)}</td><td>${fNum(dt.pro)}</td><td>${fNum(dt.carb)}</td><td>${fNum(dt.fat)}</td><td>${metrics.weight || "-"}</td><td>${fNum(metrics.steps)}</td>`;
    weeklyTbody.appendChild(tr);
    weeklyTotals.cal += dt.cal; weeklyTotals.pro += dt.pro; weeklyTotals.carb += dt.carb; weeklyTotals.fat += dt.fat;
    if (metrics.weight) { weeklyTotals.wt += metrics.weight; weeklyTotals.wtCount++; }
    if (metrics.steps) weeklyTotals.steps += metrics.steps;
  }
  $("weeklyAvgRow").innerHTML = `<td>Avg/Tot</td><td>${fNum(weeklyTotals.cal/7)}</td><td>${fNum(weeklyTotals.pro/7)}</td><td>${fNum(weeklyTotals.carb/7)}</td><td>${fNum(weeklyTotals.fat/7)}</td><td>${weeklyTotals.wtCount ? (weeklyTotals.wt/weeklyTotals.wtCount).toFixed(1) : "-"}</td><td>${fNum(weeklyTotals.steps)}</td>`;
  
  // Monthly Overview
  const monthlyTbody = $("monthlyTable").querySelector("tbody");
  monthlyTbody.innerHTML = "";
  for (let w = 0; w < 4; w++) {
    let weekCal = 0, weekPro = 0, weekWt = 0, weekWtCnt = 0, weekSteps = 0, startDate;
    for (let d = 0; d < 7; d++) {
      const dayOffset = (w * 7) + d;
      const dateObj = new Date(today); dateObj.setDate(today.getDate() - dayOffset);
      if (d === 6) startDate = dateObj;
      const dateStr = getLocalDate(dateObj);
      const logs = state.log.filter(l => l.date === dateStr);
      weekCal += logs.reduce((sum, x) => sum + x.calories, 0);
      weekPro += logs.reduce((sum, x) => sum + x.protein, 0);
      const met = state.days[dateStr] || {};
      if (met.weight) { weekWt += met.weight; weekWtCnt++; }
      if (met.steps) weekSteps += met.steps;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${startDate ? startDate.toLocaleDateString() : 'Current'}</td><td>${fNum(weekCal/7)}</td><td>${fNum(weekPro/7)}</td><td>${weekWtCnt ? (weekWt/weekWtCnt).toFixed(1) : "-"}</td><td>${fNum(weekSteps)}</td>`;
    monthlyTbody.appendChild(tr);
  }
  renderWeightChart();
  renderAdherenceGrid();
}

function renderWeightChart() {
  const container = $("weightChart"); container.innerHTML = "";
  const weights = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const data = state.days[dateStr];
    if (data?.weight) weights.push({ date: d, weight: data.weight, dateStr });
  }
  if (weights.length < 2) { container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Not enough weight data (need 2+ entries)</div>'; return; }
  const min = Math.min(...weights.map(w => w.weight));
  const max = Math.max(...weights.map(w => w.weight));
  const range = max - min || 1;
  weights.forEach((w) => {
    const heightPct = ((w.weight - min) / range) * 80 + 10;
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${heightPct}%`;
    bar.innerHTML = `<div class="chart-bar-val">${w.weight}</div><div class="chart-bar-label">${w.date.getDate()}</div>`;
    container.appendChild(bar);
  });
}

function renderAdherenceGrid() {
  const grid = $("adherenceGrid"); grid.innerHTML = "";
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const logs = state.log.filter(l => l.date === dateStr);
    const totalPro = logs.reduce((sum, x) => sum + x.protein, 0);
    const pct = Math.round((totalPro / state.targets.protein) * 100);
    let status = "missed", icon = "✗";
    if (pct >= 90) { status = "met"; icon = "✓"; }
    else if (pct >= 50) { status = "partial"; icon = Math.round(pct) + "%"; }
    const day = document.createElement("div");
    day.className = "adherence-day";
    day.innerHTML = `<div class="adherence-circle ${status}">${icon}</div><div class="adherence-label">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div>`;
    grid.appendChild(day);
  }
}

// ============================================
// WORKOUT SCHEDULE MANAGEMENT
// ============================================
let currentScheduleDay = "Tuesday";

async function saveScheduleDay(day, data) {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "workoutSchedule", day);
  await setDoc(ref, data);
}

function renderScheduleEditor() {
  const dayData = state.workoutSchedule[currentScheduleDay] || { title: '', focus: '', restDay: false, exercises: [] };
  
  $("woScheduleTitle").value = dayData.title || '';
  $("woScheduleFocus").value = dayData.focus || '';
  $("woScheduleRestDay").checked = dayData.restDay || false;
  
  // Update day tab indicators
  document.querySelectorAll(".wo-day-tab").forEach(tab => {
    const day = tab.dataset.day;
    tab.classList.toggle("active", day === currentScheduleDay);
    const sched = state.workoutSchedule[day];
    tab.classList.toggle("has-exercises", !!(sched && sched.exercises && sched.exercises.length > 0 && !sched.restDay));
  });
  
  const container = $("woScheduleExercises");
  container.innerHTML = "";
  
  if (dayData.restDay) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">Rest Day - No exercises</div>';
    return;
  }
  
  (dayData.exercises || []).forEach((ex, idx) => {
    const row = document.createElement("div");
    row.className = "wo-sched-ex-row";
    row.innerHTML = `
      <input type="text" value="${ex.name || ''}" placeholder="Exercise name" data-field="name" data-idx="${idx}" />
      <input type="text" value="${ex.sets || '3'}" placeholder="Sets" data-field="sets" data-idx="${idx}" />
      <input type="text" value="${ex.reps || '8-12'}" placeholder="Reps" data-field="reps" data-idx="${idx}" />
      <input type="text" value="${ex.bodyPart || ''}" placeholder="Body part" data-field="bodyPart" data-idx="${idx}" />
      <button class="wo-sched-remove" data-idx="${idx}" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;
    container.appendChild(row);
  });
  
  // Attach event listeners for auto-save
  container.querySelectorAll("input").forEach(input => {
    input.addEventListener("change", () => scheduleFieldChanged());
  });
  container.querySelectorAll(".wo-sched-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      const dayData = state.workoutSchedule[currentScheduleDay] || { exercises: [] };
      dayData.exercises.splice(idx, 1);
      saveScheduleDay(currentScheduleDay, dayData);
    });
  });
}

function scheduleFieldChanged() {
  const dayData = state.workoutSchedule[currentScheduleDay] || { exercises: [] };
  dayData.title = $("woScheduleTitle").value.trim();
  dayData.focus = $("woScheduleFocus").value.trim();
  dayData.restDay = $("woScheduleRestDay").checked;
  
  // Gather exercises from DOM
  const container = $("woScheduleExercises");
  const inputs = container.querySelectorAll("input[data-field]");
  const exercises = [];
  const maxIdx = Math.max(...Array.from(inputs).map(i => parseInt(i.dataset.idx)), -1);
  for (let i = 0; i <= maxIdx; i++) {
    const name = container.querySelector(`input[data-idx="${i}"][data-field="name"]`)?.value || '';
    const sets = container.querySelector(`input[data-idx="${i}"][data-field="sets"]`)?.value || '3';
    const reps = container.querySelector(`input[data-idx="${i}"][data-field="reps"]`)?.value || '8-12';
    const bodyPart = container.querySelector(`input[data-idx="${i}"][data-field="bodyPart"]`)?.value || '';
    if (name.trim()) exercises.push({ name: name.trim(), sets, reps, bodyPart });
  }
  dayData.exercises = exercises;
  saveScheduleDay(currentScheduleDay, dayData);
}

// ============================================
// WORKOUT TRACKING
// ============================================

function getWorkoutForDate(dateStr) {
  return state.workoutLogs.find(l => l.date === dateStr);
}

function getScheduleForDate(d) {
  const dayName = getDayName(d);
  return state.workoutSchedule[dayName] || null;
}

function getPreviousPerformance(exerciseName) {
  // Search workout logs for the most recent entry of this exercise (not today)
  const todayStr = getLocalDate(state.currentDate);
  for (const log of state.workoutLogs) {
    if (log.date === todayStr) continue;
    if (log.exercises) {
      const ex = log.exercises.find(e => e.name.toLowerCase() === exerciseName.toLowerCase());
      if (ex && ex.sets && ex.sets.length > 0) {
        const completedSets = ex.sets.filter(s => s.completed);
        if (completedSets.length > 0) {
          const best = completedSets.reduce((a, b) => (num(a.weight) * num(a.reps) > num(b.weight) * num(b.reps) ? a : b));
          return `Last: ${best.weight}lbs × ${best.reps} reps`;
        }
      }
    }
  }
  return null;
}

function getPersonalRecord(exerciseName) {
  let bestWeight = 0;
  let bestVolume = 0; // weight * reps
  for (const log of state.workoutLogs) {
    if (log.exercises) {
      const ex = log.exercises.find(e => e.name.toLowerCase() === exerciseName.toLowerCase());
      if (ex && ex.sets) {
        for (const s of ex.sets) {
          if (s.completed) {
            const w = num(s.weight);
            const vol = w * num(s.reps);
            if (w > bestWeight) bestWeight = w;
            if (vol > bestVolume) bestVolume = vol;
          }
        }
      }
    }
  }
  return { bestWeight, bestVolume };
}

async function saveWorkoutLog(dateStr, workoutData) {
  if (!state.user) return;
  const existing = getWorkoutForDate(dateStr);
  if (existing) {
    const ref = doc(db, "users", state.user.uid, "workoutLogs", existing.id);
    await updateDoc(ref, workoutData);
  } else {
    await addDoc(collection(db, "users", state.user.uid, "workoutLogs"), { date: dateStr, ...workoutData });
  }
}

function getCurrentWorkoutData() {
  const dateStr = getLocalDate(state.currentDate);
  const existing = getWorkoutForDate(dateStr);
  if (existing) return JSON.parse(JSON.stringify(existing));
  
  // Build from schedule
  const schedule = getScheduleForDate(state.currentDate);
  const exercises = [];
  if (schedule && schedule.exercises && !schedule.restDay) {
    schedule.exercises.forEach(ex => {
      const numSets = parseInt(ex.sets) || 3;
      const sets = [];
      for (let i = 0; i < numSets; i++) {
        sets.push({ weight: '', reps: '', completed: false });
      }
      exercises.push({
        name: ex.name,
        targetSets: ex.sets,
        targetReps: ex.reps,
        bodyPart: ex.bodyPart || '',
        sets,
        completed: false,
        fromSchedule: true
      });
    });
  }
  return { date: dateStr, exercises, startTime: null, endTime: null, duration: 0 };
}

function renderWorkoutView() {
  const dateStr = getLocalDate(state.currentDate);
  const schedule = getScheduleForDate(state.currentDate);
  const dayName = getDayName(state.currentDate);
  
  // Update title
  if (schedule && schedule.title) {
    $("woDayTitle").textContent = `${dayName} – ${schedule.title}`;
  } else {
    $("woDayTitle").textContent = `${dayName}'s Workout`;
  }
  
  const workoutData = getCurrentWorkoutData();
  const exercises = workoutData.exercises || [];
  
  // Empty state
  if (exercises.length === 0 && (!schedule || schedule.restDay)) {
    $("woExerciseList").innerHTML = "";
    $("woEmptyState").style.display = "flex";
    if (schedule && schedule.restDay) {
      $("woEmptyState").querySelector("p").textContent = "Rest Day";
      $("woEmptyState").querySelector("span").textContent = "Take it easy and recover!";
    }
  } else {
    $("woEmptyState").style.display = "none";
    renderExerciseCards(exercises, dateStr);
  }
  
  // Update summary
  updateWorkoutSummary(exercises, dateStr);
  
  // Update completion percentage
  const totalExercises = exercises.length;
  const completedExercises = exercises.filter(e => e.completed).length;
  const pct = totalExercises > 0 ? Math.round((completedExercises / totalExercises) * 100) : 0;
  $("woCompletion").textContent = `${pct}%`;
  
  // Active workout state
  const existing = getWorkoutForDate(dateStr);
  if (existing && existing.startTime && !existing.endTime) {
    $("woStartBtn").classList.add("hidden");
    $("woFinishBtn").classList.remove("hidden");
    startDurationTimer(existing.startTime);
  } else if (existing && existing.endTime) {
    $("woStartBtn").classList.add("hidden");
    $("woFinishBtn").classList.add("hidden");
    if (existing.duration) {
      $("woDuration").textContent = formatDuration(existing.duration);
    }
  } else {
    $("woStartBtn").classList.remove("hidden");
    $("woFinishBtn").classList.add("hidden");
    $("woDuration").textContent = "0:00";
  }
}

function renderExerciseCards(exercises, dateStr) {
  const container = $("woExerciseList");
  container.innerHTML = "";
  
  exercises.forEach((ex, exIdx) => {
    const card = document.createElement("div");
    card.className = "wo-exercise-card" + (ex.completed ? " completed" : "");
    
    const prev = getPreviousPerformance(ex.name);
    const isSuperset = (ex.name || '').toLowerCase().includes('superset');
    
    card.innerHTML = `
      <div class="wo-ex-header" data-ex-idx="${exIdx}">
        <div class="wo-ex-info">
          <div class="wo-ex-name">
            ${ex.name}
            ${isSuperset ? '<span class="superset-tag">SS</span>' : ''}
          </div>
          <div class="wo-ex-meta">
            <span class="target-reps">${ex.targetSets || '3'} × ${ex.targetReps || '8-12'}</span>
            ${ex.bodyPart ? ` • ${ex.bodyPart}` : ''}
          </div>
          ${prev ? `<div class="wo-ex-previous">${prev}</div>` : ''}
        </div>
        <div class="wo-ex-actions">
          <button class="wo-ex-check ${ex.completed ? 'checked' : ''}" data-ex-idx="${exIdx}" title="Mark complete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          ${!ex.fromSchedule ? `<button class="wo-ex-delete" data-ex-idx="${exIdx}" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 6L6 18M6 6l12 12"/></svg></button>` : ''}
        </div>
      </div>
      <div class="wo-sets-container">
        <div class="wo-sets-header">
          <span>SET</span><span>WEIGHT (lbs)</span><span>REPS</span><span>RPE</span><span>✓</span>
        </div>
        ${(ex.sets || []).map((s, sIdx) => {
          const pr = getPersonalRecord(ex.name);
          const isPR = s.completed && num(s.weight) > 0 && num(s.weight) >= pr.bestWeight && num(s.weight) > 0;
          return `
          <div class="wo-set-row ${s.completed ? 'completed-set' : ''}">
            <span class="wo-set-num">${sIdx + 1}</span>
            <input class="wo-set-input" type="number" placeholder="0" value="${s.weight || ''}" data-ex="${exIdx}" data-set="${sIdx}" data-field="weight" />
            <input class="wo-set-input" type="number" placeholder="0" value="${s.reps || ''}" data-ex="${exIdx}" data-set="${sIdx}" data-field="reps" />
            <input class="wo-set-input" type="number" placeholder="-" value="${s.rpe || ''}" data-ex="${exIdx}" data-set="${sIdx}" data-field="rpe" min="1" max="10" />
            <button class="wo-set-check ${s.completed ? 'checked' : ''} ${isPR ? 'pr-set' : ''}" data-ex="${exIdx}" data-set="${sIdx}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
          </div>`;
        }).join('')}
        <button class="wo-add-set-btn" data-ex-idx="${exIdx}">+ Add Set</button>
      </div>
    `;
    container.appendChild(card);
  });
  
  // Attach event listeners
  container.querySelectorAll(".wo-set-input").forEach(input => {
    input.addEventListener("change", (e) => handleSetInputChange(e, dateStr));
  });
  container.querySelectorAll(".wo-set-check").forEach(btn => {
    btn.addEventListener("click", (e) => handleSetComplete(e, dateStr));
  });
  container.querySelectorAll(".wo-ex-check").forEach(btn => {
    btn.addEventListener("click", (e) => handleExerciseComplete(e, dateStr));
  });
  container.querySelectorAll(".wo-add-set-btn").forEach(btn => {
    btn.addEventListener("click", (e) => handleAddSet(e, dateStr));
  });
  container.querySelectorAll(".wo-ex-delete").forEach(btn => {
    btn.addEventListener("click", (e) => handleDeleteExercise(e, dateStr));
  });
}

async function handleSetInputChange(e, dateStr) {
  const exIdx = parseInt(e.target.dataset.ex);
  const setIdx = parseInt(e.target.dataset.set);
  const field = e.target.dataset.field;
  const value = e.target.value;
  
  const workoutData = getCurrentWorkoutData();
  if (workoutData.exercises[exIdx] && workoutData.exercises[exIdx].sets[setIdx]) {
    workoutData.exercises[exIdx].sets[setIdx][field] = value;
    await saveWorkoutLog(dateStr, workoutData);
  }
}

async function handleSetComplete(e, dateStr) {
  const btn = e.currentTarget;
  const exIdx = parseInt(btn.dataset.ex);
  const setIdx = parseInt(btn.dataset.set);
  
  const workoutData = getCurrentWorkoutData();
  if (workoutData.exercises[exIdx] && workoutData.exercises[exIdx].sets[setIdx]) {
    const set = workoutData.exercises[exIdx].sets[setIdx];
    set.completed = !set.completed;
    
    // Auto-complete exercise if all sets done
    const allDone = workoutData.exercises[exIdx].sets.every(s => s.completed);
    workoutData.exercises[exIdx].completed = allDone;
    
    await saveWorkoutLog(dateStr, workoutData);
    
    // Start rest timer if completing a set
    if (set.completed) {
      startRestTimer();
    }
  }
}

async function handleExerciseComplete(e, dateStr) {
  const btn = e.currentTarget;
  const exIdx = parseInt(btn.dataset.exIdx);
  
  const workoutData = getCurrentWorkoutData();
  if (workoutData.exercises[exIdx]) {
    const newState = !workoutData.exercises[exIdx].completed;
    workoutData.exercises[exIdx].completed = newState;
    // Mark all sets as completed too
    workoutData.exercises[exIdx].sets.forEach(s => { s.completed = newState; });
    await saveWorkoutLog(dateStr, workoutData);
  }
}

async function handleAddSet(e, dateStr) {
  const exIdx = parseInt(e.currentTarget.dataset.exIdx);
  const workoutData = getCurrentWorkoutData();
  if (workoutData.exercises[exIdx]) {
    workoutData.exercises[exIdx].sets.push({ weight: '', reps: '', completed: false });
    await saveWorkoutLog(dateStr, workoutData);
  }
}

async function handleDeleteExercise(e, dateStr) {
  const exIdx = parseInt(e.currentTarget.dataset.exIdx);
  if (!confirm("Remove this exercise?")) return;
  const workoutData = getCurrentWorkoutData();
  workoutData.exercises.splice(exIdx, 1);
  await saveWorkoutLog(dateStr, workoutData);
}

// Add ad-hoc exercise
async function addAdHocExercise() {
  const name = $("addExName").value.trim();
  if (!name) { toast("Please enter an exercise name"); return; }
  const dateStr = getLocalDate(state.currentDate);
  const workoutData = getCurrentWorkoutData();
  const numSets = parseInt($("addExSets").value) || 3;
  const sets = [];
  for (let i = 0; i < numSets; i++) sets.push({ weight: '', reps: '', completed: false });
  
  workoutData.exercises.push({
    name,
    targetSets: $("addExSets").value || '3',
    targetReps: $("addExReps").value || '8-12',
    bodyPart: $("addExBody").value || '',
    notes: $("addExNotes").value || '',
    sets,
    completed: false,
    fromSchedule: false
  });
  
  await saveWorkoutLog(dateStr, workoutData);
  $("addExerciseModal").close();
  $("addExName").value = "";
  $("addExSets").value = "3";
  $("addExReps").value = "";
  $("addExBody").value = "";
  $("addExNotes").value = "";
  toast(`Added: ${name}`);
}

// ============================================
// TIMERS
// ============================================
function startRestTimer() {
  clearInterval(state.restTimerInterval);
  state.restTimeRemaining = state.targets.restTimer || 60;
  const timerEl = $("woRestTimer");
  const timeDisplay = $("restTimeDisplay");
  timerEl.classList.remove("hidden");
  
  const updateDisplay = () => {
    const m = Math.floor(state.restTimeRemaining / 60);
    const s = state.restTimeRemaining % 60;
    timeDisplay.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  };
  updateDisplay();
  
  state.restTimerInterval = setInterval(() => {
    state.restTimeRemaining--;
    if (state.restTimeRemaining <= 0) {
      clearInterval(state.restTimerInterval);
      timerEl.classList.add("hidden");
      toast("Rest complete! 💪");
    } else {
      updateDisplay();
    }
  }, 1000);
}

function skipRestTimer() {
  clearInterval(state.restTimerInterval);
  $("woRestTimer").classList.add("hidden");
}

function startDurationTimer(startTime) {
  clearInterval(state.durationInterval);
  state.durationInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    $("woDuration").textContent = formatDuration(elapsed);
  }, 1000);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function startWorkout() {
  const dateStr = getLocalDate(state.currentDate);
  const workoutData = getCurrentWorkoutData();
  workoutData.startTime = Date.now();
  workoutData.endTime = null;
  await saveWorkoutLog(dateStr, workoutData);
  $("woStartBtn").classList.add("hidden");
  $("woFinishBtn").classList.remove("hidden");
  startDurationTimer(workoutData.startTime);
  toast("Workout started! Let's go! 💪");
}

async function finishWorkout() {
  if (!confirm("Finish this workout?")) return;
  const dateStr = getLocalDate(state.currentDate);
  const workoutData = getCurrentWorkoutData();
  workoutData.endTime = Date.now();
  workoutData.duration = Math.floor((workoutData.endTime - (workoutData.startTime || workoutData.endTime)) / 1000);
  await saveWorkoutLog(dateStr, workoutData);
  clearInterval(state.durationInterval);
  clearInterval(state.restTimerInterval);
  $("woRestTimer").classList.add("hidden");
  $("woStartBtn").classList.add("hidden");
  $("woFinishBtn").classList.add("hidden");
  toast("Workout complete! Great job! 🎉");
}

// ============================================
// WORKOUT SUMMARY
// ============================================
function updateWorkoutSummary(exercises, dateStr) {
  let totalSets = 0, totalVolume = 0, prCount = 0;
  const muscleVolume = {};
  
  // Build PR map from historical data (excluding today)
  const prMap = {};
  for (const log of state.workoutLogs) {
    if (log.date === dateStr) continue;
    if (log.exercises) {
      for (const ex of log.exercises) {
        const key = ex.name.toLowerCase();
        if (!prMap[key]) prMap[key] = 0;
        for (const s of (ex.sets || [])) {
          if (s.completed) {
            const w = num(s.weight);
            if (w > prMap[key]) prMap[key] = w;
          }
        }
      }
    }
  }
  
  exercises.forEach(ex => {
    const completedSets = (ex.sets || []).filter(s => s.completed);
    totalSets += completedSets.length;
    
    completedSets.forEach(s => {
      const vol = num(s.weight) * num(s.reps);
      totalVolume += vol;
      
      // Check for PR
      const key = ex.name.toLowerCase();
      if (num(s.weight) > (prMap[key] || 0) && num(s.weight) > 0) {
        prCount++;
        prMap[key] = num(s.weight); // Update so we don't double count
      }
    });
    
    // Muscle volume
    const parts = (ex.bodyPart || 'Other').split(',').map(p => p.trim());
    const setVol = completedSets.reduce((sum, s) => sum + num(s.weight) * num(s.reps), 0);
    parts.forEach(part => {
      if (!muscleVolume[part]) muscleVolume[part] = 0;
      muscleVolume[part] += setVol;
    });
  });
  
  $("woSummaryExercises").textContent = exercises.length;
  $("woSummarySets").textContent = totalSets;
  $("woSummaryVolume").textContent = totalVolume > 0 ? `${Math.round(totalVolume).toLocaleString()} lbs` : "0 lbs";
  $("woSummaryPRs").textContent = prCount;
  
  // Render muscle volume bars
  const muscleContainer = $("woMuscleVolume");
  muscleContainer.innerHTML = "";
  const muscleEntries = Object.entries(muscleVolume).filter(([,v]) => v > 0).sort((a, b) => b[1] - a[1]);
  
  if (muscleEntries.length === 0) {
    $("woMuscleEmpty").style.display = "flex";
    muscleContainer.style.display = "none";
  } else {
    $("woMuscleEmpty").style.display = "none";
    muscleContainer.style.display = "flex";
    const maxVol = muscleEntries[0][1];
    muscleEntries.forEach(([muscle, vol]) => {
      const row = document.createElement("div");
      row.className = "wo-muscle-bar-row";
      const pct = (vol / maxVol) * 100;
      row.innerHTML = `
        <span class="wo-muscle-bar-label">${muscle}</span>
        <div class="wo-muscle-bar-track"><div class="wo-muscle-bar-fill" style="width: ${pct}%"></div></div>
        <span class="wo-muscle-bar-val">${Math.round(vol).toLocaleString()}</span>
      `;
      muscleContainer.appendChild(row);
    });
  }
  
  // Render recent PRs
  renderRecentPRs();
}

function renderRecentPRs() {
  const prList = $("woPRList");
  prList.innerHTML = "";
  const prs = [];
  
  // Find PRs from all workout logs
  const exerciseBests = {};
  const sortedLogs = [...state.workoutLogs].sort((a, b) => a.date.localeCompare(b.date));
  
  sortedLogs.forEach(log => {
    if (log.exercises) {
      log.exercises.forEach(ex => {
        const key = ex.name.toLowerCase();
        (ex.sets || []).forEach(s => {
          if (s.completed && num(s.weight) > 0) {
            const w = num(s.weight);
            if (!exerciseBests[key] || w > exerciseBests[key].weight) {
              exerciseBests[key] = { weight: w, reps: num(s.reps), date: log.date, name: ex.name };
              if (prs.length < 10) {
                prs.push({ ...exerciseBests[key] });
              }
            }
          }
        });
      });
    }
  });
  
  // Show most recent PRs (last 5)
  const recentPRs = Object.values(exerciseBests).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  
  if (recentPRs.length === 0) {
    $("woPREmpty").style.display = "flex";
    prList.style.display = "none";
  } else {
    $("woPREmpty").style.display = "none";
    prList.style.display = "flex";
    recentPRs.forEach(pr => {
      const item = document.createElement("div");
      item.className = "wo-pr-item";
      item.innerHTML = `
        <span class="wo-pr-icon">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
        </span>
        <div class="wo-pr-info">
          <div class="wo-pr-name">${pr.name}</div>
          <div class="wo-pr-detail">${pr.weight} lbs × ${pr.reps} reps</div>
        </div>
        <span class="wo-pr-date">${pr.date}</span>
      `;
      prList.appendChild(item);
    });
  }
}

// ============================================
// WORKOUT ANALYTICS
// ============================================
function renderWorkoutStats() {
  // Weekly workout summary
  const tbody = $("woWeeklyTable").querySelector("tbody");
  tbody.innerHTML = "";
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const log = state.workoutLogs.find(l => l.date === dateStr);
    
    let exercises = 0, sets = 0, volume = 0, duration = '-';
    if (log && log.exercises) {
      exercises = log.exercises.length;
      log.exercises.forEach(ex => {
        (ex.sets || []).forEach(s => {
          if (s.completed) { sets++; volume += num(s.weight) * num(s.reps); }
        });
      });
      if (log.duration) duration = formatDuration(log.duration);
    }
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</td>
      <td>${exercises || '-'}</td>
      <td>${sets || '-'}</td>
      <td>${volume > 0 ? Math.round(volume).toLocaleString() : '-'}</td>
      <td>${duration}</td>
    `;
    tbody.appendChild(tr);
  }
  
  // Populate exercise select
  const select = $("statsExerciseSelect");
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select exercise...</option>';
  const exerciseNames = new Set();
  state.workoutLogs.forEach(log => {
    if (log.exercises) log.exercises.forEach(ex => exerciseNames.add(ex.name));
  });
  Array.from(exerciseNames).sort().forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
  
  if (currentVal) renderExerciseProgress(currentVal);
  
  // All PRs
  renderAllPRs();
  
  // Monthly muscle volume
  renderMonthlyMuscleVolume();
}

function renderExerciseProgress(exerciseName) {
  const container = $("exerciseProgressChart");
  container.innerHTML = "";
  
  if (!exerciseName) {
    $("exerciseProgressEmpty").style.display = "flex";
    container.style.display = "none";
    return;
  }
  
  const dataPoints = [];
  const today = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const log = state.workoutLogs.find(l => l.date === dateStr);
    if (log && log.exercises) {
      const ex = log.exercises.find(e => e.name === exerciseName);
      if (ex && ex.sets) {
        const completedSets = ex.sets.filter(s => s.completed && num(s.weight) > 0);
        if (completedSets.length > 0) {
          const maxWeight = Math.max(...completedSets.map(s => num(s.weight)));
          const totalVol = completedSets.reduce((sum, s) => sum + num(s.weight) * num(s.reps), 0);
          dataPoints.push({ date: d, maxWeight, totalVol, dateStr });
        }
      }
    }
  }
  
  if (dataPoints.length < 1) {
    $("exerciseProgressEmpty").style.display = "flex";
    container.style.display = "none";
    return;
  }
  
  $("exerciseProgressEmpty").style.display = "none";
  container.style.display = "flex";
  
  const min = Math.min(...dataPoints.map(p => p.maxWeight));
  const max = Math.max(...dataPoints.map(p => p.maxWeight));
  const range = max - min || 1;
  
  dataPoints.forEach(p => {
    const heightPct = ((p.maxWeight - min) / range) * 80 + 10;
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${heightPct}%`;
    bar.innerHTML = `<div class="chart-bar-val">${p.maxWeight}</div><div class="chart-bar-label">${p.date.getDate()}</div>`;
    bar.title = `${p.dateStr}: ${p.maxWeight}lbs max, ${Math.round(p.totalVol)}lbs total volume`;
    container.appendChild(bar);
  });
}

function renderAllPRs() {
  const container = $("allPRsList");
  container.innerHTML = "";
  
  const exerciseBests = {};
  state.workoutLogs.forEach(log => {
    if (log.exercises) {
      log.exercises.forEach(ex => {
        const key = ex.name.toLowerCase();
        (ex.sets || []).forEach(s => {
          if (s.completed && num(s.weight) > 0) {
            if (!exerciseBests[key] || num(s.weight) > exerciseBests[key].weight) {
              exerciseBests[key] = { weight: num(s.weight), reps: num(s.reps), date: log.date, name: ex.name };
            }
          }
        });
      });
    }
  });
  
  const allPRs = Object.values(exerciseBests).sort((a, b) => a.name.localeCompare(b.name));
  
  if (allPRs.length === 0) {
    $("allPRsEmpty").style.display = "flex";
    container.style.display = "none";
    return;
  }
  
  $("allPRsEmpty").style.display = "none";
  container.style.display = "flex";
  
  allPRs.forEach(pr => {
    const item = document.createElement("div");
    item.className = "wo-pr-item";
    item.innerHTML = `
      <span class="wo-pr-icon"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></span>
      <div class="wo-pr-info"><div class="wo-pr-name">${pr.name}</div><div class="wo-pr-detail">${pr.weight} lbs × ${pr.reps} reps</div></div>
      <span class="wo-pr-date">${pr.date}</span>
    `;
    container.appendChild(item);
  });
}

function renderMonthlyMuscleVolume() {
  const container = $("monthlyMuscleChart");
  container.innerHTML = "";
  
  const muscleVolume = {};
  const today = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const log = state.workoutLogs.find(l => l.date === dateStr);
    if (log && log.exercises) {
      log.exercises.forEach(ex => {
        const parts = (ex.bodyPart || 'Other').split(',').map(p => p.trim());
        (ex.sets || []).forEach(s => {
          if (s.completed) {
            const vol = num(s.weight) * num(s.reps);
            parts.forEach(part => {
              if (!muscleVolume[part]) muscleVolume[part] = 0;
              muscleVolume[part] += vol;
            });
          }
        });
      });
    }
  }
  
  const entries = Object.entries(muscleVolume).filter(([,v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No workout data in the last 30 days</div>';
    return;
  }
  
  const maxVol = entries[0][1];
  entries.forEach(([muscle, vol]) => {
    const row = document.createElement("div");
    row.className = "wo-muscle-bar-row";
    const pct = (vol / maxVol) * 100;
    row.innerHTML = `
      <span class="wo-muscle-bar-label">${muscle}</span>
      <div class="wo-muscle-bar-track"><div class="wo-muscle-bar-fill" style="width: ${pct}%"></div></div>
      <span class="wo-muscle-bar-val">${Math.round(vol).toLocaleString()}</span>
    `;
    container.appendChild(row);
  });
}

// ============================================
// MODAL HANDLERS
// ============================================
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
    $("deleteLibBtn").style.display = "inline-flex";
  }
  $("editLibModal").showModal();
}

$("saveLibBtn").onclick = async () => {
  const name = $("libName").value.trim();
  if (!name) { toast("Name is required"); return; }
  const macros = { calories: num($("libCal").value), protein: num($("libPro").value), carbs: num($("libCarb").value), fat: num($("libFat").value) };
  if (editingLibId) await updateLibraryMeal(editingLibId, { name, ...macros });
  else await saveToLibrary(name, macros);
  $("editLibModal").close();
};

$("deleteLibBtn").onclick = async () => { if (editingLibId) await deleteLibraryMeal(editingLibId); $("editLibModal").close(); };
$("closeLibBtn").onclick = () => $("editLibModal").close();
$("btnAddLibItem").onclick = () => openEditLibModal(null);

// ============================================
// MAIN INITIALIZATION
// ============================================
async function init() {
  // Theme
  const savedTheme = localStorage.getItem("mt_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  
  // Auth state listener
  onAuthStateChanged(auth, (user) => updateAuthUI(user));
  
  // === MAIN NAV ===
  document.querySelectorAll(".main-nav-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".main-nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      $("nutritionView").classList.toggle("hidden", view !== "nutrition");
      $("workoutView").classList.toggle("hidden", view !== "workout");
      if (view === "workout") renderWorkoutView();
    };
  });
  
  // === NUTRITION EVENTS ===
  $("mealSearch").addEventListener("input", (e) => buildDropdown(e.target.value));
  $("mealDropdown").addEventListener("change", () => updateMealPreview(state.library.find(x => x.id === $("mealDropdown").value)));
  $("mealServings").addEventListener("input", () => updateMealPreview(state.library.find(x => x.id === $("mealDropdown").value)));
  
  document.querySelectorAll(".btn-adjust").forEach(btn => {
    btn.onclick = () => {
      const adjust = num(btn.dataset.adjust);
      const input = $("mealServings");
      input.value = Math.max(0.25, num(input.value) + adjust);
      updateMealPreview(state.library.find(x => x.id === $("mealDropdown").value));
    };
  });
  
  $("addMealBtn").onclick = () => {
    const id = $("mealDropdown").value;
    const item = state.library.find(x => x.id === id);
    if (item) addEntry(item.name, item, "db", $("mealServings").value);
    else toast("Please select a meal");
  };
  
  $("addManualBtn").onclick = () => {
    const name = $("manualName").value.trim() || "Manual Entry";
    const macros = { calories: $("manualCalories").value, protein: $("manualProtein").value, carbs: $("manualCarbs").value, fat: $("manualFat").value };
    addEntry(name, macros, "manual", $("manualServings").value);
    $("manualName").value = ""; $("manualCalories").value = ""; $("manualProtein").value = ""; $("manualCarbs").value = ""; $("manualFat").value = ""; $("manualServings").value = "1";
  };
  
  $("addSaveManualBtn").onclick = async () => {
    const name = $("manualName").value.trim();
    if (!name) { toast("Name is required to save to library"); return; }
    const macros = { calories: num($("manualCalories").value), protein: num($("manualProtein").value), carbs: num($("manualCarbs").value), fat: num($("manualFat").value) };
    await saveToLibrary(name, macros);
    await addEntry(name, macros, "manual", $("manualServings").value);
    $("manualName").value = ""; $("manualCalories").value = ""; $("manualProtein").value = ""; $("manualCarbs").value = ""; $("manualFat").value = ""; $("manualServings").value = "1";
  };
  
  $("saveMetricsBtn").onclick = saveDayMetrics;
  $("notesToggle").onclick = () => { $("notesToggle").classList.toggle("expanded"); $("notesContent").classList.toggle("hidden"); };
  $("saveNotesBtn").onclick = saveDayNotes;
  $("btnImportDefaults").onclick = importDefaults;
  $("copyPrevDayBtn").onclick = copyPreviousDay;
  
  // Date navigation (shared for both views)
  const navigateDate = (offset) => {
    state.currentDate.setDate(state.currentDate.getDate() + offset);
    render();
    renderWorkoutView();
  };
  $("prevDateBtn").onclick = () => navigateDate(-1);
  $("nextDateBtn").onclick = () => navigateDate(1);
  $("woPrevDateBtn").onclick = () => navigateDate(-1);
  $("woNextDateBtn").onclick = () => navigateDate(1);
  
  // Theme toggle
  $("themeToggle").onclick = () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mt_theme", next);
  };
  
  // === STATS VIEW ===
  $("btnStats").onclick = () => {
    renderStats();
    renderWorkoutStats();
    $("nutritionView").classList.add("hidden");
    $("workoutView").classList.add("hidden");
    $("mainNav").classList.add("hidden");
    $("statsView").classList.remove("hidden");
  };
  
  $("closeStatsBtn").onclick = () => {
    $("statsView").classList.add("hidden");
    $("mainNav").classList.remove("hidden");
    // Restore the active view
    const activeNav = document.querySelector(".main-nav-btn.active");
    if (activeNav) {
      const view = activeNav.dataset.view;
      $(view === "nutrition" ? "nutritionView" : "workoutView").classList.remove("hidden");
    } else {
      $("nutritionView").classList.remove("hidden");
    }
  };
  
  // Stats tab toggle
  document.querySelectorAll(".stats-toggle-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.statsTab;
      $("nutrition-stats").classList.toggle("hidden", tab !== "nutrition-stats");
      $("workout-stats").classList.toggle("hidden", tab !== "workout-stats");
      if (tab === "workout-stats") renderWorkoutStats();
    };
  });
  
  $("statsExerciseSelect").addEventListener("change", (e) => renderExerciseProgress(e.target.value));
  $("exportDataBtn").onclick = exportToCSV;
  
  // === SETTINGS ===
  $("btnSettings").onclick = () => {
    renderSettingsLibrary();
    updateTargetInputs();
    renderScheduleEditor();
    $("settingsModal").showModal();
  };
  $("closeSettingsBtn").onclick = () => $("settingsModal").close();
  $("saveTargetsBtn").onclick = saveTargets;
  $("libSearch").addEventListener("input", renderSettingsLibrary);
  
  // Settings tabs
  document.querySelectorAll(".settings-tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".settings-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.settingsTab;
      document.querySelectorAll(".settings-tab-content").forEach(c => c.classList.add("hidden"));
      $(tab).classList.remove("hidden");
      if (tab === "workout-schedule-settings") renderScheduleEditor();
    };
  });
  
  // Schedule day tabs
  document.querySelectorAll(".wo-day-tab").forEach(tab => {
    tab.onclick = () => {
      // Save current day first
      scheduleFieldChanged();
      currentScheduleDay = tab.dataset.day;
      renderScheduleEditor();
    };
  });
  
  // Schedule field changes
  $("woScheduleTitle").addEventListener("change", scheduleFieldChanged);
  $("woScheduleFocus").addEventListener("change", scheduleFieldChanged);
  $("woScheduleRestDay").addEventListener("change", scheduleFieldChanged);
  
  // Add exercise to schedule
  $("woAddScheduleExercise").onclick = () => {
    const dayData = state.workoutSchedule[currentScheduleDay] || { title: '', focus: '', restDay: false, exercises: [] };
    if (!dayData.exercises) dayData.exercises = [];
    dayData.exercises.push({ name: '', sets: '3', reps: '8-12', bodyPart: '' });
    state.workoutSchedule[currentScheduleDay] = dayData;
    saveScheduleDay(currentScheduleDay, dayData);
  };
  
  // === WORKOUT EVENTS ===
  $("woAddExerciseBtn").onclick = () => $("addExerciseModal").showModal();
  $("cancelAddExBtn").onclick = () => $("addExerciseModal").close();
  $("confirmAddExBtn").onclick = addAdHocExercise;
  $("woStartBtn").onclick = startWorkout;
  $("woFinishBtn").onclick = finishWorkout;
  $("restTimerSkip").onclick = skipRestTimer;
  
  // Meal tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
      if (btn.dataset.tab === "recent") renderRecents();
    };
  });
  
  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); $("mealSearch").focus(); }
    if (e.key === "Enter" && document.activeElement === $("mealSearch")) { e.preventDefault(); $("addMealBtn").click(); }
    if (e.key === "Escape") {
      $("settingsModal").close();
      $("editLibModal").close();
      $("editModal").close();
      $("addExerciseModal").close();
    }
  });
  
  // Close modals on backdrop click
  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  });
  
  render();
}

function render() {
  updateDateDisplay();
  buildDropdown($("mealSearch").value);
  renderLog();
  renderWeeklyMini();
  if (!$("tab-recent").classList.contains("hidden")) renderRecents();
}

document.addEventListener("DOMContentLoaded", init);

// ============================================
// NUTRITION LABEL SCANNER (Tesseract.js OCR)
// ============================================
let scannerStream = null;
let scanTargetContext = null;
let tesseractWorker = null;

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error('Failed to load OCR library'));
    document.head.appendChild(script);
  });
}

function openScanner(targetContext) {
  scanTargetContext = targetContext;
  const modal = $("scannerModal");
  $("cameraContainer").classList.remove("hidden");
  $("previewContainer").classList.add("hidden");
  $("scanResults").classList.add("hidden");
  $("scanError").classList.add("hidden");
  $("captureBtn").classList.remove("hidden");
  $("useScanBtn").classList.add("hidden");
  $("previewOverlay").classList.remove("hidden");
  modal.showModal();
  startCamera();
}

async function startCamera() {
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const video = $("cameraVideo");
    video.srcObject = scannerStream;
    await video.play();
  } catch (err) {
    console.error("Camera error:", err);
    stopCamera();
    $("cameraContainer").classList.add("hidden");
    $("fileInput").click();
  }
}

function stopCamera() {
  if (scannerStream) { scannerStream.getTracks().forEach(track => track.stop()); scannerStream = null; }
  $("cameraVideo").srcObject = null;
}

function captureImage() {
  const video = $("cameraVideo");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function processImage(imageDataUrl) {
  $("cameraContainer").classList.add("hidden");
  $("previewContainer").classList.remove("hidden");
  $("previewImage").src = imageDataUrl;
  $("previewOverlay").classList.remove("hidden");
  $("captureBtn").classList.add("hidden");
  stopCamera();
  try {
    const Tesseract = await loadTesseract();
    const result = await Tesseract.recognize(imageDataUrl, 'eng');
    const text = result.data.text;
    const nutritionData = parseNutritionLabel(text);
    if (nutritionData && (nutritionData.calories || nutritionData.protein || nutritionData.carbs || nutritionData.fat)) {
      $("previewOverlay").classList.add("hidden");
      $("scanResults").classList.remove("hidden");
      $("useScanBtn").classList.remove("hidden");
      $("scanCalories").value = nutritionData.calories || "";
      $("scanProtein").value = nutritionData.protein || "";
      $("scanCarbs").value = nutritionData.carbs || "";
      $("scanFat").value = nutritionData.fat || "";
    } else {
      showScanError("Could not detect nutrition values. Try a clearer photo.");
    }
  } catch (err) {
    showScanError(err.message || "Failed to analyze image.");
  }
}

function parseNutritionLabel(text) {
  const normalizedText = text.toLowerCase().replace(/[oO]/g, match => match === 'O' ? '0' : match).replace(/\s+/g, ' ').replace(/,/g, '');
  const result = { calories: null, protein: null, carbs: null, fat: null };
  const patterns = {
    calories: [/calories[:\s]*(\d+)/i, /(\d+)\s*calories/i, /energy[:\s]*(\d+)\s*kcal/i, /kcal[:\s]*(\d+)/i, /(\d+)\s*kcal/i, /cal[:\s]*(\d+)/i],
    protein: [/protein[:\s]*(\d+\.?\d*)\s*g/i, /(\d+\.?\d*)\s*g\s*protein/i, /protein[:\s]*(\d+)/i],
    carbs: [/total\s*carb[a-z]*[:\s]*(\d+\.?\d*)\s*g/i, /carb[a-z]*[:\s]*(\d+\.?\d*)\s*g/i, /(\d+\.?\d*)\s*g\s*carb/i, /carb[a-z]*[:\s]*(\d+)/i],
    fat: [/total\s*fat[:\s]*(\d+\.?\d*)\s*g/i, /(?<!trans\s)(?<!saturated\s)fat[:\s]*(\d+\.?\d*)\s*g/i, /(\d+\.?\d*)\s*g\s*(?:total\s*)?fat/i, /^fat[:\s]*(\d+)/im]
  };
  for (const [nutrient, patternList] of Object.entries(patterns)) {
    for (const pattern of patternList) {
      const match = text.match(pattern) || normalizedText.match(pattern);
      if (match && match[1]) {
        const value = parseFloat(match[1]);
        if (!isNaN(value) && value >= 0 && value < 10000) { result[nutrient] = Math.round(value); break; }
      }
    }
  }
  if (!result.calories && (result.protein || result.carbs || result.fat)) {
    result.calories = Math.round((result.protein || 0) * 4 + (result.carbs || 0) * 4 + (result.fat || 0) * 9);
  }
  return result;
}

function showScanError(message) {
  $("previewContainer").classList.add("hidden");
  $("scanResults").classList.add("hidden");
  $("scanError").classList.remove("hidden");
  $("scanErrorMsg").textContent = message;
  $("captureBtn").classList.add("hidden");
  $("useScanBtn").classList.add("hidden");
}

function applyScannedValues() {
  const vals = { calories: num($("scanCalories").value), protein: num($("scanProtein").value), carbs: num($("scanCarbs").value), fat: num($("scanFat").value) };
  if (scanTargetContext === "manual") {
    $("manualCalories").value = vals.calories || "";
    $("manualProtein").value = vals.protein || "";
    $("manualCarbs").value = vals.carbs || "";
    $("manualFat").value = vals.fat || "";
  } else if (scanTargetContext === "library") {
    $("libCal").value = vals.calories || "";
    $("libPro").value = vals.protein || "";
    $("libCarb").value = vals.carbs || "";
    $("libFat").value = vals.fat || "";
  }
  closeScanner();
  toast("Values applied!");
}

function closeScanner() { stopCamera(); $("scannerModal").close(); }

$("scanLabelBtn").addEventListener("click", () => openScanner("manual"));
$("scanLibLabelBtn").addEventListener("click", () => openScanner("library"));
$("closeScannerBtn").addEventListener("click", closeScanner);
$("cancelScanBtn").addEventListener("click", closeScanner);
$("captureBtn").addEventListener("click", () => processImage(captureImage()));
$("useScanBtn").addEventListener("click", applyScannedValues);
$("retryScnBtn").addEventListener("click", () => {
  $("scanError").classList.add("hidden");
  $("cameraContainer").classList.remove("hidden");
  $("captureBtn").classList.remove("hidden");
  startCamera();
});
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => { $("cameraContainer").classList.add("hidden"); $("previewContainer").classList.remove("hidden"); processImage(event.target.result); };
    reader.readAsDataURL(file);
  }
  e.target.value = "";
});
$("scannerModal").addEventListener("click", (e) => { if (e.target === $("scannerModal")) closeScanner(); });
$("scannerModal").addEventListener("close", () => stopCamera());
