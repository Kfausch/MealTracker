// ============================================
// FITNESS TRACKER PRO - APP.JS
// Firebase-powered nutrition & workout tracking
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

// Initialize Firebase
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
    calories: 1800, 
    protein: 180, 
    carbs: 200, 
    fat: 65, 
    timezone: "local",
    restTimer: 60
  },
  unsubscribeLog: null,
  unsubscribeLib: null,
  unsubscribeDays: null,
  // Workout state
  workoutDate: new Date(),
  workoutSchedule: {},    // Template: {Monday: {title, focus, restDay, exercises[]}, ...}
  workoutLogs: [],        // All workout log documents
  activeWorkout: null,    // {startTime, exerciseStates}
  unsubscribeSchedule: null,
  unsubscribeWorkoutLogs: null,
  currentView: 'nutrition',
  restTimerInterval: null,
  durationInterval: null,
  restTimeLeft: 0
};

// === UTILITY FUNCTIONS ===
const $ = (id) => document.getElementById(id);
const num = (v) => parseFloat(v) || 0;
const fmt = (v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;

// Get date string based on user timezone setting
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

// Toast notification
function toast(msg, duration = 2500) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

// === AUTHENTICATION ===
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
    if (state.unsubscribeSchedule) state.unsubscribeSchedule();
    if (state.unsubscribeWorkoutLogs) state.unsubscribeWorkoutLogs();
  }
}

$("btnLogin").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value;
  $("authError").textContent = "";
  
  if (!email || !pass) {
    $("authError").textContent = "Please enter email and password";
    return;
  }
  
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
  
  if (!email || !pass) {
    $("authError").textContent = "Please enter email and password";
    return;
  }
  
  if (pass.length < 6) {
    $("authError").textContent = "Password must be at least 6 characters";
    return;
  }
  
  try {
    $("btnSignup").disabled = true;
    $("btnSignup").textContent = "Creating account...";
    await createUserWithEmailAndPassword(auth, email, pass);
    toast("Account created! Welcome to Meal Tracker 🎉");
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
  if (confirm("Are you sure you want to log out?")) {
    signOut(auth);
  }
});

// === DATABASE SYNC ===
async function initUserData(uid) {
  // Load user settings
  const settingsRef = doc(db, "users", uid, "data", "settings");
  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      state.targets = { ...state.targets, ...snap.data() };
    }
    updateTargetInputs();
  } catch (e) {
    console.error("Error loading settings:", e);
  }

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
    snapshot.forEach((doc) => {
      state.days[doc.id] = doc.data();
    });
    renderMetrics();
    renderWeeklyMini();
  });

  // Subscribe to workout schedule (template)
  const schedRef = collection(db, "users", uid, "workoutSchedule");
  state.unsubscribeSchedule = onSnapshot(schedRef, (snapshot) => {
    state.workoutSchedule = {};
    snapshot.forEach((d) => {
      state.workoutSchedule[d.id] = d.data();
    });
    renderWorkoutView();
    renderScheduleEditor();
  });

  // Subscribe to workout logs
  const woLogRef = collection(db, "users", uid, "workoutLogs");
  const qWoLog = query(woLogRef, orderBy("date", "desc"));
  state.unsubscribeWorkoutLogs = onSnapshot(qWoLog, (snapshot) => {
    state.workoutLogs = [];
    snapshot.forEach((d) => state.workoutLogs.push({ id: d.id, ...d.data() }));
    renderWorkoutView();
  });
}

// === CORE FUNCTIONS ===

// Save daily targets
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

// Save daily metrics (weight, steps)
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

// Save daily notes
async function saveDayNotes() {
  if (!state.user) return;
  const dateStr = getLocalDate(state.currentDate);
  const notes = $("dayNotes").value.trim();
  const ref = doc(db, "users", state.user.uid, "days", dateStr);
  await setDoc(ref, { notes }, { merge: true });
  toast("Note saved");
}

// Add food entry to log
async function addEntry(name, macros, source, servings = 1) {
  if (!state.user) return;
  const s = num(servings);
  if (s <= 0) {
    toast("Please enter valid servings");
    return;
  }
  
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
  } catch (e) {
    console.error("Error adding entry:", e);
    toast("Error adding entry");
  }
}

// Save meal to library
async function saveToLibrary(name, macros) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, "users", state.user.uid, "meals"), { 
      name, 
      calories: num(macros.calories),
      protein: num(macros.protein),
      carbs: num(macros.carbs),
      fat: num(macros.fat)
    });
    toast(`Saved to Library: ${name}`);
  } catch (e) {
    toast("Error saving to library");
  }
}

// Update library meal
async function updateLibraryMeal(id, data) {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "meals", id);
  await updateDoc(ref, data);
  toast("Meal updated");
}

// Delete library meal
async function deleteLibraryMeal(id) {
  if (!state.user) return;
  if (!confirm("Permanently delete this food from your library?")) return;
  const ref = doc(db, "users", state.user.uid, "meals", id);
  await deleteDoc(ref);
  toast("Meal deleted");
}

// Delete log entry
async function deleteEntry(id) {
  if (!state.user) return;
  if (!confirm("Remove this item from today's log?")) return;
  await deleteDoc(doc(db, "users", state.user.uid, "logs", id));
  toast("Entry removed");
}

// Copy previous day's meals
async function copyPreviousDay() {
  if (!state.user) return;
  
  const currentDateStr = getLocalDate(state.currentDate);
  const prevDate = new Date(state.currentDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = getLocalDate(prevDate);
  
  const prevDayLog = state.log.filter(i => i.date === prevDateStr);
  
  if (prevDayLog.length === 0) {
    toast("No meals logged yesterday");
    return;
  }
  
  if (!confirm(`Copy ${prevDayLog.length} meal(s) from yesterday?`)) return;
  
  try {
    const batch = writeBatch(db);
    const collectionRef = collection(db, "users", state.user.uid, "logs");
    
    prevDayLog.forEach((meal) => {
      const newDoc = doc(collectionRef);
      batch.set(newDoc, {
        ...meal,
        id: undefined,
        date: currentDateStr,
        createdAt: Date.now()
      });
    });
    
    await batch.commit();
    toast(`Copied ${prevDayLog.length} meals from yesterday!`);
  } catch (e) {
    console.error("Error copying meals:", e);
    toast("Error copying meals");
  }
}

// Import default meals from JSON
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
    status.textContent = "✓ Success!";
    toast(`Imported ${Object.keys(defaults).length} meals`);
  } catch (e) {
    status.textContent = "Error: " + e.message;
  } finally {
    btn.disabled = false;
    setTimeout(() => { status.textContent = ""; }, 3000);
  }
}

// Calculate logging streak
function calculateStreak() {
  const today = new Date();
  let streak = 0;
  let checkDate = new Date(today);
  
  // Start from today and go backwards
  while (true) {
    const dateStr = getLocalDate(checkDate);
    const dayLog = state.log.filter(i => i.date === dateStr);
    
    if (dayLog.length > 0) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      // If it's today and nothing logged, don't break streak yet
      if (dateStr === getLocalDate(today)) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }
  }
  
  $("streakCount").textContent = streak;
  
  // Add animation if streak increased
  const badge = $("streakBadge");
  badge.style.transform = "scale(1.1)";
  setTimeout(() => { badge.style.transform = "scale(1)"; }, 200);
}

// Export data to CSV
function exportToCSV() {
  if (!state.user || state.log.length === 0) {
    toast("No data to export");
    return;
  }
  
  const headers = ["Date", "Name", "Servings", "Calories", "Protein", "Carbs", "Fat"];
  const rows = state.log.map(entry => [
    entry.date,
    `"${entry.name.replace(/"/g, '""')}"`,
    entry.servings,
    Math.round(entry.calories),
    Math.round(entry.protein),
    Math.round(entry.carbs),
    Math.round(entry.fat)
  ]);
  
  // Sort by date
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `meal-tracker-export-${getLocalDate(new Date())}.csv`;
  a.click();
  
  URL.revokeObjectURL(url);
  toast("Data exported!");
}

// === UI RENDERING ===

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
  if (dStr === todayStr) {
    label = "Today";
  } else if (dStr === yestStr) {
    label = "Yesterday";
  } else {
    label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  
  $("dateLabel").textContent = label;
  $("dateSub").textContent = dStr;
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
    const selectedItem = state.library.find(x => x.id === sel.value);
    updateMealPreview(selectedItem);
  }
}

function updateMealPreview(item) {
  if (!item) {
    $("previewName").textContent = "Select a meal";
    $("previewMacros").innerHTML = `
      <span class="macro-pill cal-pill">-- cal</span>
      <span class="macro-pill p-pill">P: --</span>
      <span class="macro-pill c-pill">C: --</span>
      <span class="macro-pill f-pill">F: --</span>
    `;
    return;
  }
  
  const servings = num($("mealServings").value) || 1;
  $("previewName").textContent = item.name;
  $("previewMacros").innerHTML = `
    <span class="macro-pill cal-pill">${Math.round(item.calories * servings)} cal</span>
    <span class="macro-pill p-pill">P: ${Math.round(item.protein * servings)}g</span>
    <span class="macro-pill c-pill">C: ${Math.round(item.carbs * servings)}g</span>
    <span class="macro-pill f-pill">F: ${Math.round(item.fat * servings)}g</span>
  `;
}

function renderRecents() {
  const host = $("recentList");
  host.innerHTML = "";
  
  const map = new Map();
  state.log.forEach(item => {
    if (!map.has(item.name) && item.base) {
      map.set(item.name, item.base);
    }
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `;
    
    el.querySelector(".delete-trigger").onclick = (e) => {
      e.stopPropagation();
      deleteEntry(item.id);
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
  $("dayNotes").value = data.notes || "";
}

function updateStats(dayLog) {
  const totals = dayLog.reduce((acc, x) => ({
    cal: acc.cal + x.calories,
    p: acc.p + x.protein,
    c: acc.c + x.carbs,
    f: acc.f + x.fat
  }), { cal: 0, p: 0, c: 0, f: 0 });
  
  // Update donut chart
  const totalGrams = totals.p + totals.c + totals.f;
  const pPct = totalGrams ? (totals.p / totalGrams) * 100 : 0;
  const cPct = totalGrams ? (totals.c / totalGrams) * 100 : 0;
  const chart = $("macroDonut");
  
  if (totalGrams > 0) {
    chart.style.background = `conic-gradient(
      var(--accent-p) 0% ${pPct}%, 
      var(--accent-c) ${pPct}% ${pPct + cPct}%, 
      var(--accent-f) ${pPct + cPct}% 100%
    )`;
  } else {
    chart.style.background = "var(--border)";
  }
  
  // Update displays
  $("calDisplay").textContent = Math.round(totals.cal);
  $("dispP").textContent = `${Math.round(totals.p)}g`;
  $("dispC").textContent = `${Math.round(totals.c)}g`;
  $("dispF").textContent = `${Math.round(totals.f)}g`;
  
  // Update progress bars
  const setBar = (fillId, remId, currentId, targetId, val, target, unit = "") => {
    const pct = Math.min((val / target) * 100, 100);
    const rem = target - val;
    
    $(fillId).style.width = `${pct}%`;
    $(currentId).textContent = Math.round(val);
    $(targetId).textContent = target;
    
    if (rem >= 0) {
      $(remId).textContent = `${Math.round(rem)}${unit} left`;
      $(remId).style.color = "var(--text-muted)";
    } else {
      $(remId).textContent = `${Math.round(Math.abs(rem))}${unit} over`;
      $(remId).style.color = "var(--danger)";
    }
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
  let weekCalTotal = 0;
  let weekProTotal = 0;
  let daysWithData = 0;
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    
    const dayLog = state.log.filter(l => l.date === dateStr);
    const dayTotals = dayLog.reduce((acc, x) => ({
      cal: acc.cal + x.calories,
      pro: acc.pro + x.protein
    }), { cal: 0, pro: 0 });
    
    if (dayTotals.cal > 0) {
      weekCalTotal += dayTotals.cal;
      weekProTotal += dayTotals.pro;
      daysWithData++;
    }
    
    const pct = Math.min((dayTotals.cal / state.targets.calories) * 100, 100);
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    
    const dot = document.createElement("div");
    dot.className = "week-dot" + (dateStr === todayStr ? " today" : "");
    dot.innerHTML = `
      <div class="week-dot-fill" style="height: ${pct}%"></div>
      <div class="week-dot-label">${dayNames[d.getDay()]}</div>
    `;
    dot.title = `${dateStr}: ${Math.round(dayTotals.cal)} cal`;
    weekDots.appendChild(dot);
  }
  
  // Update weekly averages
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
  const items = state.library
    .filter(i => i.name.toLowerCase().includes(filter))
    .sort((a, b) => a.name.localeCompare(b.name));
  
  if (items.length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No foods found</div>';
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="color: var(--text-muted);">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    `;
    div.onclick = () => openEditLibModal(item);
    list.appendChild(div);
  });
}

// === ANALYTICS ===

function renderStats() {
  const fNum = (n) => n ? Math.round(n).toLocaleString() : "-";
  
  // Weekly Stats
  const weeklyTbody = $("weeklyTable").querySelector("tbody");
  weeklyTbody.innerHTML = "";
  const today = new Date();
  let weeklyTotals = { cal: 0, pro: 0, carb: 0, fat: 0, wt: 0, steps: 0, wtCount: 0 };
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    
    const logs = state.log.filter(l => l.date === dateStr);
    const dayTotals = logs.reduce((acc, x) => ({
      cal: acc.cal + x.calories,
      pro: acc.pro + x.protein,
      carb: acc.carb + x.carbs,
      fat: acc.fat + x.fat
    }), { cal: 0, pro: 0, carb: 0, fat: 0 });
    
    const metrics = state.days[dateStr] || {};
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</td>
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
    if (metrics.weight) { weeklyTotals.wt += metrics.weight; weeklyTotals.wtCount++; }
    if (metrics.steps) weeklyTotals.steps += metrics.steps;
  }
  
  $("weeklyAvgRow").innerHTML = `
    <td>Avg/Tot</td>
    <td>${fNum(weeklyTotals.cal / 7)}</td>
    <td>${fNum(weeklyTotals.pro / 7)}</td>
    <td>${fNum(weeklyTotals.carb / 7)}</td>
    <td>${fNum(weeklyTotals.fat / 7)}</td>
    <td>${weeklyTotals.wtCount ? (weeklyTotals.wt / weeklyTotals.wtCount).toFixed(1) : "-"}</td>
    <td>${fNum(weeklyTotals.steps)}</td>
  `;
  
  // Monthly Overview
  const monthlyTbody = $("monthlyTable").querySelector("tbody");
  monthlyTbody.innerHTML = "";
  
  for (let w = 0; w < 4; w++) {
    let weekCal = 0, weekPro = 0, weekWt = 0, weekWtCnt = 0, weekSteps = 0;
    let startDate;
    
    for (let d = 0; d < 7; d++) {
      const dayOffset = (w * 7) + d;
      const dateObj = new Date(today);
      dateObj.setDate(today.getDate() - dayOffset);
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
    tr.innerHTML = `
      <td>${startDate ? startDate.toLocaleDateString() : 'Current'}</td>
      <td>${fNum(weekCal / 7)}</td>
      <td>${fNum(weekPro / 7)}</td>
      <td>${weekWtCnt ? (weekWt / weekWtCnt).toFixed(1) : "-"}</td>
      <td>${fNum(weekSteps)}</td>
    `;
    monthlyTbody.appendChild(tr);
  }
  
  // Weight chart
  renderWeightChart();
  
  // Adherence grid
  renderAdherenceGrid();
}

function renderWeightChart() {
  const container = $("weightChart");
  container.innerHTML = "";
  
  const weights = [];
  const today = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    const data = state.days[dateStr];
    
    if (data?.weight) {
      weights.push({ date: d, weight: data.weight, dateStr });
    }
  }
  
  if (weights.length < 2) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Not enough weight data (need 2+ entries)</div>';
    return;
  }
  
  const min = Math.min(...weights.map(w => w.weight));
  const max = Math.max(...weights.map(w => w.weight));
  const range = max - min || 1;
  
  weights.forEach((w, idx) => {
    const heightPct = ((w.weight - min) / range) * 80 + 10;
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${heightPct}%`;
    bar.innerHTML = `
      <div class="chart-bar-val">${w.weight}</div>
      <div class="chart-bar-label">${w.date.getDate()}</div>
    `;
    container.appendChild(bar);
  });
}

function renderAdherenceGrid() {
  const grid = $("adherenceGrid");
  grid.innerHTML = "";
  
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getLocalDate(d);
    
    const logs = state.log.filter(l => l.date === dateStr);
    const totalPro = logs.reduce((sum, x) => sum + x.protein, 0);
    const pct = Math.round((totalPro / state.targets.protein) * 100);
    
    let status = "missed";
    let icon = "✗";
    if (pct >= 90) { status = "met"; icon = "✓"; }
    else if (pct >= 50) { status = "partial"; icon = Math.round(pct) + "%"; }
    
    const day = document.createElement("div");
    day.className = "adherence-day";
    day.innerHTML = `
      <div class="adherence-circle ${status}">${icon}</div>
      <div class="adherence-label">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
    `;
    grid.appendChild(day);
  }
}

// === MODAL HANDLERS ===

let editingLibId = null;

function openEditLibModal(item) {
  if (!item) {
    editingLibId = null;
    $("libModalTitle").textContent = "Add New Food";
    $("libName").value = "";
    $("libCal").value = "";
    $("libPro").value = "";
    $("libCarb").value = "";
    $("libFat").value = "";
    $("deleteLibBtn").style.display = "none";
  } else {
    editingLibId = item.id;
    $("libModalTitle").textContent = "Edit Saved Meal";
    $("libName").value = item.name;
    $("libCal").value = item.calories;
    $("libPro").value = item.protein;
    $("libCarb").value = item.carbs;
    $("libFat").value = item.fat;
    $("deleteLibBtn").style.display = "inline-flex";
  }
  $("editLibModal").showModal();
}

$("saveLibBtn").onclick = async () => {
  const name = $("libName").value.trim();
  if (!name) {
    toast("Name is required");
    return;
  }
  const macros = {
    calories: num($("libCal").value),
    protein: num($("libPro").value),
    carbs: num($("libCarb").value),
    fat: num($("libFat").value)
  };
  if (editingLibId) {
    await updateLibraryMeal(editingLibId, { name, ...macros });
  } else {
    await saveToLibrary(name, macros);
  }
  $("editLibModal").close();
};

$("deleteLibBtn").onclick = async () => {
  if (editingLibId) {
    await deleteLibraryMeal(editingLibId);
  }
  $("editLibModal").close();
};

$("closeLibBtn").onclick = () => $("editLibModal").close();
$("btnAddLibItem").onclick = () => openEditLibModal(null);

// === EVENT LISTENERS & INITIALIZATION ===

async function init() {
  // Theme
  const savedTheme = localStorage.getItem("mt_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  
  // Auth state listener
  onAuthStateChanged(auth, (user) => updateAuthUI(user));
  
  // Search functionality
  $("mealSearch").addEventListener("input", (e) => buildDropdown(e.target.value));
  
  // Dropdown change - update preview
  $("mealDropdown").addEventListener("change", () => {
    const item = state.library.find(x => x.id === $("mealDropdown").value);
    updateMealPreview(item);
  });
  
  // Servings change - update preview
  $("mealServings").addEventListener("input", () => {
    const item = state.library.find(x => x.id === $("mealDropdown").value);
    updateMealPreview(item);
  });
  
  // Servings adjustment buttons
  document.querySelectorAll(".btn-adjust").forEach(btn => {
    btn.onclick = () => {
      const adjust = num(btn.dataset.adjust);
      const input = $("mealServings");
      const newVal = Math.max(0.25, num(input.value) + adjust);
      input.value = newVal;
      const item = state.library.find(x => x.id === $("mealDropdown").value);
      updateMealPreview(item);
    };
  });
  
  // Add meal from search
  $("addMealBtn").onclick = () => {
    const id = $("mealDropdown").value;
    const item = state.library.find(x => x.id === id);
    if (item) {
      addEntry(item.name, item, "db", $("mealServings").value);
    } else {
      toast("Please select a meal");
    }
  };
  
  // Manual entry
  $("addManualBtn").onclick = () => {
    const name = $("manualName").value.trim() || "Manual Entry";
    const macros = {
      calories: $("manualCalories").value,
      protein: $("manualProtein").value,
      carbs: $("manualCarbs").value,
      fat: $("manualFat").value
    };
    addEntry(name, macros, "manual", $("manualServings").value);
    // Clear form
    $("manualName").value = "";
    $("manualCalories").value = "";
    $("manualProtein").value = "";
    $("manualCarbs").value = "";
    $("manualFat").value = "";
    $("manualServings").value = "1";
  };
  
  // Add and save to library
  $("addSaveManualBtn").onclick = async () => {
    const name = $("manualName").value.trim();
    if (!name) {
      toast("Name is required to save to library");
      return;
    }
    const macros = {
      calories: num($("manualCalories").value),
      protein: num($("manualProtein").value),
      carbs: num($("manualCarbs").value),
      fat: num($("manualFat").value)
    };
    await saveToLibrary(name, macros);
    await addEntry(name, macros, "manual", $("manualServings").value);
    // Clear form
    $("manualName").value = "";
    $("manualCalories").value = "";
    $("manualProtein").value = "";
    $("manualCarbs").value = "";
    $("manualFat").value = "";
    $("manualServings").value = "1";
  };
  
  // Metrics
  $("saveMetricsBtn").onclick = saveDayMetrics;
  
  // Notes toggle
  $("notesToggle").onclick = () => {
    $("notesToggle").classList.toggle("expanded");
    $("notesContent").classList.toggle("hidden");
  };
  
  // Save notes
  $("saveNotesBtn").onclick = saveDayNotes;
  
  // Import defaults
  $("btnImportDefaults").onclick = importDefaults;
  
  // Copy previous day
  $("copyPrevDayBtn").onclick = copyPreviousDay;
  
  // Date navigation
  $("prevDateBtn").onclick = () => {
    state.currentDate.setDate(state.currentDate.getDate() - 1);
    render();
  };
  
  $("nextDateBtn").onclick = () => {
    state.currentDate.setDate(state.currentDate.getDate() + 1);
    render();
  };
  
  // Theme toggle
  $("themeToggle").onclick = () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mt_theme", next);
  };
  
  // Stats view
  $("btnStats").onclick = () => {
    renderStats();
    $("nutritionView").classList.add("hidden");
    $("workoutView").classList.add("hidden");
    document.querySelector(".main-nav").classList.add("hidden");
    $("statsView").classList.remove("hidden");
  };
  
  $("closeStatsBtn").onclick = () => {
    $("statsView").classList.add("hidden");
    document.querySelector(".main-nav").classList.remove("hidden");
    if (state.currentView === 'workout') {
      $("workoutView").classList.remove("hidden");
    } else {
      $("nutritionView").classList.remove("hidden");
    }
  };
  
  // Export
  $("exportDataBtn").onclick = exportToCSV;
  
  // Settings
  $("btnSettings").onclick = () => {
    renderSettingsLibrary();
    updateTargetInputs();
    $("settingsModal").showModal();
  };
  
  $("closeSettingsBtn").onclick = () => $("settingsModal").close();
  $("saveTargetsBtn").onclick = saveTargets;
  $("libSearch").addEventListener("input", renderSettingsLibrary);
  
  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      const tabId = `tab-${btn.dataset.tab}`;
      $(tabId).classList.remove("hidden");
      
      // Render recents when tab is activated
      if (btn.dataset.tab === "recent") {
        renderRecents();
      }
    };
  });
  
  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Cmd/Ctrl + K to focus search
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      $("mealSearch").focus();
    }
    
    // Enter to add meal when search is focused
    if (e.key === "Enter" && document.activeElement === $("mealSearch")) {
      e.preventDefault();
      $("addMealBtn").click();
    }
    
    // Escape to close modals
    if (e.key === "Escape") {
      $("settingsModal").close();
      $("editLibModal").close();
      $("editModal").close();
    }
  });
  
  // Close modals on backdrop click
  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        dialog.close();
      }
    });
  });
  
  // === MAIN NAVIGATION ===
  document.querySelectorAll(".main-nav-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".main-nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentView = btn.dataset.view;
      $("nutritionView").classList.toggle("hidden", state.currentView !== 'nutrition');
      $("workoutView").classList.toggle("hidden", state.currentView !== 'workout');
      if (state.currentView === 'workout') renderWorkoutView();
    };
  });

  // === SETTINGS TABS ===
  document.querySelectorAll(".settings-tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".settings-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".settings-tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      $(`stab-${btn.dataset.stab}`).classList.remove("hidden");
      if (btn.dataset.stab === 'schedule') renderScheduleEditor();
    };
  });

  // === WORKOUT DATE NAVIGATION ===
  $("woPrevDateBtn").onclick = () => {
    state.workoutDate.setDate(state.workoutDate.getDate() - 1);
    renderWorkoutView();
  };
  $("woNextDateBtn").onclick = () => {
    state.workoutDate.setDate(state.workoutDate.getDate() + 1);
    renderWorkoutView();
  };
  $("woLastWeekBtn").onclick = () => {
    state.workoutDate.setDate(state.workoutDate.getDate() - 7);
    renderWorkoutView();
  };
  $("woTodayBtn").onclick = () => {
    state.workoutDate = new Date();
    renderWorkoutView();
  };

  // === WORKOUT ACTIONS ===
  $("woStartBtn").onclick = startWorkout;
  $("woFinishBtn").onclick = finishWorkout;
  $("woSkipRest").onclick = skipRestTimer;
  $("woAddExerciseBtn").onclick = () => {
    $("addExName").value = "";
    $("addExSets").value = "3";
    $("addExReps").value = "";
    $("addExBodyPart").value = "";
    $("addExNotes").value = "";
    $("addExerciseModal").showModal();
  };
  $("closeAddExerciseBtn").onclick = () => $("addExerciseModal").close();
  $("addExSubmitBtn").onclick = addExerciseToWorkout;

  // === SCHEDULE EDITOR ===
  document.querySelectorAll(".sched-day-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".sched-day-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderScheduleEditor();
    };
  });
  $("schedAddExercise").onclick = addScheduleExerciseRow;
  $("schedSaveBtn").onclick = saveScheduleDay;

  render();
}

function render() {
  updateDateDisplay();
  buildDropdown($("mealSearch").value);
  renderLog();
  renderWeeklyMini();
  if (!$("tab-recent").classList.contains("hidden")) {
    renderRecents();
  }
}

// ============================================
// WORKOUT TRACKING
// ============================================

// Get the day-of-week name for a date
function getDayName(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// Get workout date string
function getWorkoutDateStr() {
  return getLocalDate(state.workoutDate);
}

// Get the workout log for the current workout date
function getWorkoutLog() {
  const dateStr = getWorkoutDateStr();
  return state.workoutLogs.find(l => l.date === dateStr);
}

// Get the schedule template for a given day name
function getScheduleForDay(dayName) {
  return state.workoutSchedule[dayName] || null;
}

// Get exercises for current workout date (merge template + existing log)
function getCurrentWorkoutData() {
  const dateStr = getWorkoutDateStr();
  const existingLog = getWorkoutLog();
  const dayName = getDayName(state.workoutDate);
  const template = getScheduleForDay(dayName);
  
  // If there's an existing saved log for this date, use it
  if (existingLog && existingLog.exercises && existingLog.exercises.length > 0) {
    return existingLog;
  }
  
  // Otherwise build from template
  if (template && !template.restDay && template.exercises && template.exercises.length > 0) {
    return {
      date: dateStr,
      dayName: dayName,
      title: template.title || dayName,
      focus: template.focus || '',
      exercises: template.exercises.map(ex => ({
        name: ex.name || '',
        targetSets: ex.sets || '3',
        targetReps: ex.reps || '',
        bodyPart: ex.bodyPart || '',
        notes: ex.notes || '',
        fromSchedule: true,
        completed: false,
        sets: Array.from({ length: parseInt(ex.sets) || 3 }, () => ({
          weight: '', reps: '', rpe: '', completed: false
        }))
      }))
    };
  }
  
  // Rest day or no schedule
  return {
    date: dateStr,
    dayName: dayName,
    title: template?.title || '',
    focus: template?.focus || '',
    restDay: template?.restDay ?? true,
    exercises: []
  };
}

// Save the current workout log to Firebase
async function saveWorkoutLog(data) {
  if (!state.user) return;
  const dateStr = getWorkoutDateStr();
  const ref = doc(db, "users", state.user.uid, "workoutLogs", dateStr);
  await setDoc(ref, { ...data, date: dateStr }, { merge: true });
}

// Get previous performance for an exercise (from past logs)
function getPreviousPerformance(exerciseName) {
  const todayStr = getWorkoutDateStr();
  const nameLower = exerciseName.toLowerCase();
  
  for (const log of state.workoutLogs) {
    if (log.date === todayStr) continue;
    if (!log.exercises) continue;
    for (const ex of log.exercises) {
      if (ex.name.toLowerCase() === nameLower) {
        // Find the best completed set
        const completedSets = (ex.sets || []).filter(s => s.completed && s.weight && s.reps);
        if (completedSets.length > 0) {
          const best = completedSets.reduce((a, b) => 
            (parseFloat(a.weight) || 0) > (parseFloat(b.weight) || 0) ? a : b
          );
          return { weight: best.weight, reps: best.reps, date: log.date };
        }
      }
    }
  }
  return null;
}

// Get the last notes for an exercise (from past logs)
function getLastExerciseNotes(exerciseName) {
  const todayStr = getWorkoutDateStr();
  const nameLower = exerciseName.toLowerCase();
  
  for (const log of state.workoutLogs) {
    if (log.date === todayStr) continue;
    if (!log.exercises) continue;
    for (const ex of log.exercises) {
      if (ex.name.toLowerCase() === nameLower && ex.notes) {
        return { notes: ex.notes, date: log.date };
      }
    }
  }
  return null;
}

// Render the full workout view
function renderWorkoutView() {
  const d = state.workoutDate;
  const now = new Date();
  const dStr = getLocalDate(d);
  const todayStr = getLocalDate(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yestStr = getLocalDate(yesterday);
  
  let label;
  if (dStr === todayStr) label = "Today";
  else if (dStr === yestStr) label = "Yesterday";
  else label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  
  $("woDateLabel").textContent = label;
  $("woDateSub").textContent = `${getDayName(d)} · ${dStr}`;
  
  // Quick nav label
  const oneWeekAgo = new Date(d);
  oneWeekAgo.setDate(d.getDate() - 7);
  $("woQuickNavLabel").textContent = `${getDayName(d)}`;
  
  const data = getCurrentWorkoutData();
  
  // Day header
  if (data.title) {
    $("woDayTitle").textContent = `${getDayName(d)} – ${data.title}`;
  } else {
    $("woDayTitle").textContent = getDayName(d);
  }
  $("woDayFocus").textContent = data.focus || '';
  
  // Show/hide rest state
  const isRest = data.restDay || (!data.exercises || data.exercises.length === 0);
  $("woRestState").classList.toggle("hidden", !isRest || (data.exercises && data.exercises.length > 0));
  
  // Render exercise cards
  renderExerciseCards(data);
  
  // Show timer bar only for today or if workout is active
  const isToday = dStr === todayStr;
  $("woTimerBar").style.display = isToday ? 'flex' : 'none';
  
  // Update summary if workout finished
  const existingLog = getWorkoutLog();
  if (existingLog && existingLog.endTime) {
    updateWorkoutSummary(existingLog);
    $("woSummaryCard").classList.remove("hidden");
  } else {
    $("woSummaryCard").classList.add("hidden");
  }
}

// Render exercise cards
function renderExerciseCards(data) {
  const container = $("woExerciseList");
  container.innerHTML = '';
  
  if (!data.exercises || data.exercises.length === 0) return;
  
  data.exercises.forEach((ex, exIdx) => {
    const card = document.createElement('div');
    card.className = `wo-exercise-card${ex.completed ? ' completed' : ''} expanded`;
    
    const prev = getPreviousPerformance(ex.name);
    const lastNotes = getLastExerciseNotes(ex.name);
    const isSuperset = ex.name.toLowerCase().includes('superset');
    
    // Build note indicator for collapsed state
    const noteText = ex.notes || '';
    const noteIndicatorHtml = noteText ? 
      `<div class="wo-ex-note-indicator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>${noteText.substring(0, 50)}${noteText.length > 50 ? '...' : ''}</div>` : '';
    
    card.innerHTML = `
      <div class="wo-ex-header" data-idx="${exIdx}">
        <div class="wo-ex-check${ex.completed ? ' checked' : ''}" data-ex-idx="${exIdx}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="wo-ex-info">
          <div class="wo-ex-name">
            ${ex.name}
            ${isSuperset ? '<span class="wo-ex-badge">SS</span>' : ''}
          </div>
          <div class="wo-ex-meta">
            ${ex.targetSets || '?'}×${ex.targetReps || '?'} · ${ex.bodyPart || 'General'}
            ${prev ? ` · <span class="wo-ex-prev">Last: ${prev.weight}lbs × ${prev.reps}</span>` : ''}
          </div>
          ${noteIndicatorHtml}
        </div>
        ${!ex.fromSchedule ? `<button class="wo-remove-ex-btn" data-ex-idx="${exIdx}" title="Remove exercise"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
        <svg class="wo-ex-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="wo-ex-body">
        <div class="wo-ex-notes-section">
          <div class="wo-ex-notes-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Notes${lastNotes ? ` <span style="font-weight:400;color:var(--muted)">(last note from ${lastNotes.date})</span>` : ''}
          </div>
          <textarea data-ex-idx="${exIdx}" placeholder="e.g. Superset with curls, focus on form, felt strong today...">${ex.notes || (lastNotes ? lastNotes.notes : '')}</textarea>
        </div>
        <table class="wo-set-table">
          <thead><tr><th>Set</th><th>Weight (lbs)</th><th>Reps</th><th>RPE</th><th>✓</th></tr></thead>
          <tbody>
            ${(ex.sets || []).map((s, sIdx) => `
              <tr>
                <td>${sIdx + 1}</td>
                <td><input type="number" value="${s.weight}" data-ex="${exIdx}" data-set="${sIdx}" data-field="weight" placeholder="—" /></td>
                <td><input type="number" value="${s.reps}" data-ex="${exIdx}" data-set="${sIdx}" data-field="reps" placeholder="—" /></td>
                <td><input type="number" value="${s.rpe}" data-ex="${exIdx}" data-set="${sIdx}" data-field="rpe" placeholder="—" min="1" max="10" /></td>
                <td>
                  <div class="wo-set-check${s.completed ? ' checked' : ''}" data-ex="${exIdx}" data-set="${sIdx}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="wo-add-set-row">
          <button class="wo-add-set-btn" data-ex-idx="${exIdx}">+ Add Set</button>
        </div>
      </div>
    `;
    
    container.appendChild(card);
  });
  
  // Event delegation for all workout interactions
  container.onclick = (e) => {
    // Toggle card expand/collapse
    const header = e.target.closest('.wo-ex-header');
    if (header && !e.target.closest('.wo-ex-check') && !e.target.closest('.wo-remove-ex-btn')) {
      const card = header.closest('.wo-exercise-card');
      card.classList.toggle('expanded');
      return;
    }
    
    // Exercise completion checkbox
    const exCheck = e.target.closest('.wo-ex-check[data-ex-idx]');
    if (exCheck) {
      handleExerciseComplete(parseInt(exCheck.dataset.exIdx));
      return;
    }
    
    // Set completion checkbox
    const setCheck = e.target.closest('.wo-set-check');
    if (setCheck) {
      handleSetComplete(parseInt(setCheck.dataset.ex), parseInt(setCheck.dataset.set));
      return;
    }
    
    // Add set button
    const addSetBtn = e.target.closest('.wo-add-set-btn');
    if (addSetBtn) {
      addSet(parseInt(addSetBtn.dataset.exIdx));
      return;
    }
    
    // Remove exercise button
    const removeBtn = e.target.closest('.wo-remove-ex-btn');
    if (removeBtn) {
      removeExercise(parseInt(removeBtn.dataset.exIdx));
      return;
    }
  };
  
  // Input change delegation
  container.addEventListener('input', (e) => {
    // Set inputs (weight, reps, rpe)
    if (e.target.dataset.ex !== undefined && e.target.dataset.set !== undefined) {
      handleSetInputChange(
        parseInt(e.target.dataset.ex),
        parseInt(e.target.dataset.set),
        e.target.dataset.field,
        e.target.value
      );
    }
    
    // Exercise notes
    if (e.target.closest('.wo-ex-notes-section') && e.target.tagName === 'TEXTAREA') {
      handleExerciseNoteChange(parseInt(e.target.dataset.exIdx), e.target.value);
    }
  });
}

// Handle set input change
function handleSetInputChange(exIdx, setIdx, field, value) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  data.exercises[exIdx].sets[setIdx][field] = value;
  saveWorkoutLog(data);
}

// Handle exercise note change (debounced save)
let noteDebounceTimer = null;
function handleExerciseNoteChange(exIdx, value) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  data.exercises[exIdx].notes = value;
  
  clearTimeout(noteDebounceTimer);
  noteDebounceTimer = setTimeout(() => saveWorkoutLog(data), 800);
}

// Handle set completion
function handleSetComplete(exIdx, setIdx) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  const set = data.exercises[exIdx].sets[setIdx];
  set.completed = !set.completed;
  saveWorkoutLog(data);
  
  // Start rest timer if completing a set
  if (set.completed) {
    startRestTimer();
  }
  
  renderWorkoutView();
}

// Handle exercise-level completion
function handleExerciseComplete(exIdx) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  const ex = data.exercises[exIdx];
  ex.completed = !ex.completed;
  // Mark all sets
  if (ex.sets) {
    ex.sets.forEach(s => { s.completed = ex.completed; });
  }
  saveWorkoutLog(data);
  renderWorkoutView();
}

// Add a set to an exercise
function addSet(exIdx) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  data.exercises[exIdx].sets.push({ weight: '', reps: '', rpe: '', completed: false });
  saveWorkoutLog(data);
  renderWorkoutView();
}

// Remove an ad-hoc exercise
function removeExercise(exIdx) {
  const data = getCurrentWorkoutData();
  data.exercises.splice(exIdx, 1);
  saveWorkoutLog(data);
  renderWorkoutView();
}

// Add exercise from modal
function addExerciseToWorkout() {
  const name = $("addExName").value.trim();
  if (!name) { toast("Enter an exercise name"); return; }
  
  const sets = parseInt($("addExSets").value) || 3;
  const reps = $("addExReps").value.trim();
  const bodyPart = $("addExBodyPart").value.trim();
  const notes = $("addExNotes").value.trim();
  
  const data = getCurrentWorkoutData();
  data.exercises = data.exercises || [];
  data.exercises.push({
    name,
    targetSets: String(sets),
    targetReps: reps,
    bodyPart,
    notes,
    fromSchedule: false,
    completed: false,
    sets: Array.from({ length: sets }, () => ({
      weight: '', reps: '', rpe: '', completed: false
    }))
  });
  
  // Remove restDay flag since we're adding exercises
  data.restDay = false;
  
  saveWorkoutLog(data);
  $("addExerciseModal").close();
  toast(`Added ${name}`);
  renderWorkoutView();
}

// Start / Finish Workout
function startWorkout() {
  state.activeWorkout = { startTime: Date.now() };
  $("woStartBtn").classList.add("hidden");
  $("woFinishBtn").classList.remove("hidden");
  
  // Start duration timer
  state.durationInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.activeWorkout.startTime) / 1000);
    $("woDuration").textContent = formatDuration(elapsed);
  }, 1000);
  
  toast("Workout started!");
}

function finishWorkout() {
  if (!state.activeWorkout) return;
  const duration = Math.floor((Date.now() - state.activeWorkout.startTime) / 1000);
  
  clearInterval(state.durationInterval);
  clearInterval(state.restTimerInterval);
  $("woRestTimerArea").style.display = 'none';
  
  const data = getCurrentWorkoutData();
  data.startTime = state.activeWorkout.startTime;
  data.endTime = Date.now();
  data.duration = duration;
  saveWorkoutLog(data);
  
  state.activeWorkout = null;
  $("woStartBtn").classList.remove("hidden");
  $("woFinishBtn").classList.add("hidden");
  $("woDuration").textContent = formatDuration(duration);
  
  updateWorkoutSummary(data);
  $("woSummaryCard").classList.remove("hidden");
  toast("Workout complete!");
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Rest Timer
function startRestTimer() {
  clearInterval(state.restTimerInterval);
  state.restTimeLeft = state.targets.restTimer || 60;
  $("woRestTimerArea").style.display = 'flex';
  $("woRestTime").textContent = formatDuration(state.restTimeLeft);
  
  state.restTimerInterval = setInterval(() => {
    state.restTimeLeft--;
    if (state.restTimeLeft <= 0) {
      clearInterval(state.restTimerInterval);
      $("woRestTimerArea").style.display = 'none';
      return;
    }
    $("woRestTime").textContent = formatDuration(state.restTimeLeft);
  }, 1000);
}

function skipRestTimer() {
  clearInterval(state.restTimerInterval);
  $("woRestTimerArea").style.display = 'none';
}

// Workout Summary
function updateWorkoutSummary(data) {
  if (!data.exercises) return;
  let totalSets = 0, totalVolume = 0;
  const exercisesDone = data.exercises.filter(ex => {
    const doneSets = (ex.sets || []).filter(s => s.completed);
    totalSets += doneSets.length;
    doneSets.forEach(s => {
      totalVolume += (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0);
    });
    return doneSets.length > 0;
  }).length;
  
  $("woSumExercises").textContent = exercisesDone;
  $("woSumSets").textContent = totalSets;
  $("woSumVolume").textContent = totalVolume.toLocaleString();
  $("woSumDuration").textContent = data.duration ? formatDuration(data.duration) : '—';
}

// ============================================
// WORKOUT SCHEDULE EDITOR
// ============================================

function getSelectedScheduleDay() {
  const active = document.querySelector('.sched-day-btn.active');
  return active ? active.dataset.day : 'Monday';
}

function renderScheduleEditor() {
  const dayName = getSelectedScheduleDay();
  const data = state.workoutSchedule[dayName] || {};
  
  $("schedTitle").value = data.title || '';
  $("schedFocus").value = data.focus || '';
  $("schedRestDay").checked = data.restDay || false;
  
  // Update day tabs indicators
  document.querySelectorAll('.sched-day-btn').forEach(btn => {
    const d = state.workoutSchedule[btn.dataset.day];
    btn.classList.toggle('has-exercises', !!(d && d.exercises && d.exercises.length > 0 && !d.restDay));
  });
  
  // Render exercise list
  const list = $("schedExerciseList");
  list.innerHTML = '';
  
  const exercises = data.exercises || [];
  exercises.forEach((ex, idx) => {
    const row = document.createElement('div');
    row.className = 'sched-exercise-row';
    row.innerHTML = `
      <input type="text" value="${ex.name || ''}" placeholder="Exercise name" data-idx="${idx}" data-field="name" />
      <input type="text" value="${ex.sets || ''}" placeholder="Sets" data-idx="${idx}" data-field="sets" />
      <input type="text" value="${ex.reps || ''}" placeholder="Reps" data-idx="${idx}" data-field="reps" />
      <input type="text" value="${ex.bodyPart || ''}" placeholder="Body part" data-idx="${idx}" data-field="bodyPart" />
      <button class="sched-remove-btn" data-idx="${idx}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    list.appendChild(row);
  });
  
  // Remove button handlers
  list.querySelectorAll('.sched-remove-btn').forEach(btn => {
    btn.onclick = () => {
      const dayName = getSelectedScheduleDay();
      const data = state.workoutSchedule[dayName] || {};
      const exercises = data.exercises || [];
      exercises.splice(parseInt(btn.dataset.idx), 1);
      state.workoutSchedule[dayName] = { ...data, exercises };
      renderScheduleEditor();
    };
  });
}

function addScheduleExerciseRow() {
  const dayName = getSelectedScheduleDay();
  const data = state.workoutSchedule[dayName] || {};
  const exercises = data.exercises || [];
  exercises.push({ name: '', sets: '3', reps: '', bodyPart: '' });
  state.workoutSchedule[dayName] = { ...data, exercises };
  renderScheduleEditor();
  
  // Focus the new row's name input
  const rows = $("schedExerciseList").querySelectorAll('.sched-exercise-row');
  if (rows.length > 0) {
    rows[rows.length - 1].querySelector('input').focus();
  }
}

async function saveScheduleDay() {
  if (!state.user) return;
  const dayName = getSelectedScheduleDay();
  
  // Read current values from the form
  const title = $("schedTitle").value.trim();
  const focus = $("schedFocus").value.trim();
  const restDay = $("schedRestDay").checked;
  
  // Read exercises from DOM
  const exerciseRows = $("schedExerciseList").querySelectorAll('.sched-exercise-row');
  const exercises = Array.from(exerciseRows).map(row => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    sets: row.querySelector('[data-field="sets"]').value.trim(),
    reps: row.querySelector('[data-field="reps"]').value.trim(),
    bodyPart: row.querySelector('[data-field="bodyPart"]').value.trim()
  })).filter(ex => ex.name); // Remove empty rows
  
  const data = { title, focus, restDay, exercises };
  
  const ref = doc(db, "users", state.user.uid, "workoutSchedule", dayName);
  await setDoc(ref, data);
  state.workoutSchedule[dayName] = data;
  
  toast(`${dayName} schedule saved!`);
  renderScheduleEditor();
  renderWorkoutView();
}

// Start app
document.addEventListener("DOMContentLoaded", init);

// === NUTRITION LABEL SCANNER (Tesseract.js OCR) ===

let scannerStream = null;
let scanTargetContext = null; // 'manual' or 'library'
let tesseractWorker = null;

// Load Tesseract.js dynamically
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

// Open scanner modal
function openScanner(targetContext) {
  scanTargetContext = targetContext;
  const modal = $("scannerModal");
  
  // Reset UI state
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

// Start camera stream
async function startCamera() {
  try {
    const constraints = {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    
    scannerStream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = $("cameraVideo");
    video.srcObject = scannerStream;
    await video.play();
  } catch (err) {
    console.error("Camera error:", err);
    // Fall back to file input
    stopCamera();
    $("cameraContainer").classList.add("hidden");
    $("fileInput").click();
  }
}

// Stop camera stream
function stopCamera() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
  }
  const video = $("cameraVideo");
  video.srcObject = null;
}

// Capture image from video
function captureImage() {
  const video = $("cameraVideo");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);
  
  return canvas.toDataURL("image/jpeg", 0.92);
}

// Process captured image
async function processImage(imageDataUrl) {
  // Show preview
  $("cameraContainer").classList.add("hidden");
  $("previewContainer").classList.remove("hidden");
  $("previewImage").src = imageDataUrl;
  $("previewOverlay").classList.remove("hidden");
  $("captureBtn").classList.add("hidden");
  
  stopCamera();
  
  try {
    // Load Tesseract if not loaded
    const Tesseract = await loadTesseract();
    
    // Perform OCR
    const result = await Tesseract.recognize(imageDataUrl, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          // Could update progress here if desired
        }
      }
    });
    
    const text = result.data.text;
    console.log("OCR Result:", text);
    
    // Parse nutrition values from text
    const nutritionData = parseNutritionLabel(text);
    
    if (nutritionData && (nutritionData.calories || nutritionData.protein || nutritionData.carbs || nutritionData.fat)) {
      // Show results
      $("previewOverlay").classList.add("hidden");
      $("scanResults").classList.remove("hidden");
      $("useScanBtn").classList.remove("hidden");
      
      // Populate fields
      $("scanCalories").value = nutritionData.calories || "";
      $("scanProtein").value = nutritionData.protein || "";
      $("scanCarbs").value = nutritionData.carbs || "";
      $("scanFat").value = nutritionData.fat || "";
    } else {
      showScanError("Could not detect nutrition values. Try taking a clearer photo with good lighting.");
    }
  } catch (err) {
    console.error("Scan error:", err);
    showScanError(err.message || "Failed to analyze image. Please try again.");
  }
}

// Parse nutrition label text using regex patterns
function parseNutritionLabel(text) {
  // Normalize text: lowercase, fix common OCR errors
  const normalizedText = text
    .toLowerCase()
    .replace(/[oO]/g, match => match === 'O' ? '0' : match)
    .replace(/\s+/g, ' ')
    .replace(/,/g, '');
  
  const result = {
    calories: null,
    protein: null,
    carbs: null,
    fat: null
  };
  
  // Patterns for different nutrition label formats
  const patterns = {
    // Calories: "Calories 200", "Calories: 200", "Energy 200kcal", "200 calories"
    calories: [
      /calories[:\s]*(\d+)/i,
      /(\d+)\s*calories/i,
      /energy[:\s]*(\d+)\s*kcal/i,
      /kcal[:\s]*(\d+)/i,
      /(\d+)\s*kcal/i,
      /cal[:\s]*(\d+)/i
    ],
    // Protein: "Protein 25g", "Protein: 25 g", "25g protein"
    protein: [
      /protein[:\s]*(\d+\.?\d*)\s*g/i,
      /(\d+\.?\d*)\s*g\s*protein/i,
      /protein[:\s]*(\d+)/i,
      /prot[:\s]*(\d+\.?\d*)/i
    ],
    // Carbs: "Total Carbohydrate 30g", "Carbs 30g", "Carbohydrates: 30g"
    carbs: [
      /total\s*carb[a-z]*[:\s]*(\d+\.?\d*)\s*g/i,
      /carb[a-z]*[:\s]*(\d+\.?\d*)\s*g/i,
      /(\d+\.?\d*)\s*g\s*carb/i,
      /carb[a-z]*[:\s]*(\d+)/i,
      /glucides[:\s]*(\d+\.?\d*)/i
    ],
    // Fat: "Total Fat 10g", "Fat 10g", "Fat: 10 g"
    fat: [
      /total\s*fat[:\s]*(\d+\.?\d*)\s*g/i,
      /(?<!trans\s)(?<!saturated\s)fat[:\s]*(\d+\.?\d*)\s*g/i,
      /(\d+\.?\d*)\s*g\s*(?:total\s*)?fat/i,
      /lipides[:\s]*(\d+\.?\d*)/i,
      /^fat[:\s]*(\d+)/im
    ]
  };
  
  // Try each pattern for each nutrient
  for (const [nutrient, patternList] of Object.entries(patterns)) {
    for (const pattern of patternList) {
      const match = text.match(pattern) || normalizedText.match(pattern);
      if (match && match[1]) {
        const value = parseFloat(match[1]);
        if (!isNaN(value) && value >= 0 && value < 10000) {
          result[nutrient] = Math.round(value);
          break;
        }
      }
    }
  }
  
  // Additional validation: if calories seems too low but we have macros, estimate
  if (!result.calories && (result.protein || result.carbs || result.fat)) {
    const estimatedCal = (result.protein || 0) * 4 + (result.carbs || 0) * 4 + (result.fat || 0) * 9;
    if (estimatedCal > 0) {
      result.calories = Math.round(estimatedCal);
    }
  }
  
  return result;
}

// Show scan error
function showScanError(message) {
  $("previewContainer").classList.add("hidden");
  $("scanResults").classList.add("hidden");
  $("scanError").classList.remove("hidden");
  $("scanErrorMsg").textContent = message;
  $("captureBtn").classList.add("hidden");
  $("useScanBtn").classList.add("hidden");
}

// Apply scanned values to form
function applyScannedValues() {
  const calories = num($("scanCalories").value);
  const protein = num($("scanProtein").value);
  const carbs = num($("scanCarbs").value);
  const fat = num($("scanFat").value);
  
  if (scanTargetContext === "manual") {
    $("manualCalories").value = calories || "";
    $("manualProtein").value = protein || "";
    $("manualCarbs").value = carbs || "";
    $("manualFat").value = fat || "";
  } else if (scanTargetContext === "library") {
    $("libCal").value = calories || "";
    $("libPro").value = protein || "";
    $("libCarb").value = carbs || "";
    $("libFat").value = fat || "";
  }
  
  closeScanner();
  toast("Values applied!");
}

// Close scanner
function closeScanner() {
  stopCamera();
  $("scannerModal").close();
}

// Scanner event listeners
$("scanLabelBtn").addEventListener("click", () => openScanner("manual"));
$("scanLibLabelBtn").addEventListener("click", () => openScanner("library"));

$("closeScannerBtn").addEventListener("click", closeScanner);
$("cancelScanBtn").addEventListener("click", closeScanner);

$("captureBtn").addEventListener("click", () => {
  const imageData = captureImage();
  processImage(imageData);
});

$("useScanBtn").addEventListener("click", applyScannedValues);

$("retryScnBtn").addEventListener("click", () => {
  $("scanError").classList.add("hidden");
  $("cameraContainer").classList.remove("hidden");
  $("captureBtn").classList.remove("hidden");
  startCamera();
});

// Handle file input (fallback for devices without camera API)
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      // Show the preview container since camera isn't being used
      $("cameraContainer").classList.add("hidden");
      $("previewContainer").classList.remove("hidden");
      processImage(event.target.result);
    };
    reader.readAsDataURL(file);
  }
  e.target.value = "";
});

// Close scanner when modal backdrop is clicked
$("scannerModal").addEventListener("click", (e) => {
  if (e.target === $("scannerModal")) {
    closeScanner();
  }
});

// Clean up camera when modal closes
$("scannerModal").addEventListener("close", () => {
  stopCamera();
});
