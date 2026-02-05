// ============================================
// MEAL TRACKER PRO - APP.JS
// Firebase-powered meal tracking with cloud sync
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
    timezone: "local" 
  },
  unsubscribeLog: null,
  unsubscribeLib: null,
  unsubscribeDays: null
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
    timezone: $("tzSelect").value
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
    $("trackerLayout").classList.add("hidden");
    $("statsView").classList.remove("hidden");
  };
  
  $("closeStatsBtn").onclick = () => {
    $("statsView").classList.add("hidden");
    $("trackerLayout").classList.remove("hidden");
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

// Start app
document.addEventListener("DOMContentLoaded", init);

// === NUTRITION LABEL SCANNER ===

let scannerStream = null;
let scanTargetContext = null; // 'manual' or 'library'

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
    // Check if we're on a mobile device or if camera is available
    const constraints = {
      video: {
        facingMode: { ideal: "environment" }, // Prefer back camera
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
  
  return canvas.toDataURL("image/jpeg", 0.9);
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
    // Extract base64 data
    const base64Data = imageDataUrl.split(",")[1];
    
    // Call Claude API to analyze the nutrition label
    const nutritionData = await analyzeNutritionLabel(base64Data);
    
    if (nutritionData) {
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
      showScanError("Could not detect nutrition information. Please try again with a clearer image.");
    }
  } catch (err) {
    console.error("Scan error:", err);
    showScanError(err.message || "Failed to analyze image. Please try again.");
  }
}

// Analyze nutrition label using Claude API
async function analyzeNutritionLabel(base64Image) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image
              }
            },
            {
              type: "text",
              text: `Analyze this nutrition label image and extract the following values per serving:
- Calories (kcal)
- Protein (grams)
- Total Carbohydrates (grams)
- Total Fat (grams)

Respond ONLY with a JSON object in this exact format, no other text:
{"calories": number, "protein": number, "carbs": number, "fat": number}

If you cannot read any value clearly, use null for that field.
If this is not a nutrition label, respond with: {"error": "not_nutrition_label"}`
            }
          ]
        }
      ]
    })
  });
  
  if (!response.ok) {
    throw new Error("API request failed");
  }
  
  const data = await response.json();
  const text = data.content[0]?.text || "";
  
  // Parse JSON response
  try {
    // Clean up the response in case there's extra text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      if (result.error) {
        throw new Error("This doesn't appear to be a nutrition label");
      }
      return result;
    }
  } catch (e) {
    console.error("Parse error:", e);
  }
  
  return null;
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
    $("manualCalories").value = calories;
    $("manualProtein").value = protein;
    $("manualCarbs").value = carbs;
    $("manualFat").value = fat;
  } else if (scanTargetContext === "library") {
    $("libCal").value = calories;
    $("libPro").value = protein;
    $("libCarb").value = carbs;
    $("libFat").value = fat;
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
      processImage(event.target.result);
    };
    reader.readAsDataURL(file);
  }
  e.target.value = ""; // Reset for future use
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
