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
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
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
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn("Persistent cache unavailable, falling back:", e);
  db = initializeFirestore(app, {});
}

// === APPLICATION STATE ===
let state = {
  user: null,
  currentDate: new Date(),
  log: [],
  library: [],
  selectedMealId: null,
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
  workoutSchedule: {},
  workoutLogs: [],
  activeWorkout: null,
  unsubscribeSchedule: null,
  unsubscribeWorkoutLogs: null,
  currentView: 'nutrition',
  restTimerInterval: null,
  durationInterval: null,
  restTimeLeft: 0,
  expandedExercises: new Set(),
  isEditingWorkout: false,
  timerPromptShown: false
};

// === UTILITY FUNCTIONS ===
const $ = (id) => document.getElementById(id);
const num = (v) => parseFloat(v) || 0;
const fmt = (v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const vibrate = (pattern = 10) => {
  if (navigator.vibrate) navigator.vibrate(pattern);
};

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

let toastTimer = null;
function toast(msg, duration = 2500, actionLabel = null, onAction = null) {
  const t = $("toast");
  clearTimeout(toastTimer);
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  
  if (actionLabel && onAction) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    btn.onclick = () => {
      clearTimeout(toastTimer);
      t.classList.remove("show");
      onAction();
    };
    t.appendChild(btn);
    t.classList.add("has-action");
  } else {
    t.classList.remove("has-action");
  }
  
  t.classList.add("show");
  toastTimer = setTimeout(() => t.classList.remove("show"), duration);
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
  if (confirm("Are you sure you want to log out?")) {
    signOut(auth);
  }
});

// === DATABASE SYNC ===
async function initUserData(uid) {
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
  $("logLoader").style.display = "flex";
  state.unsubscribeLog = onSnapshot(qLog, (snapshot) => {
    state.log = [];
    snapshot.forEach((doc) => state.log.push({ id: doc.id, ...doc.data() }));
    $("logLoader").style.display = "none";
    render();
    calculateStreak();
  });

  const daysRef = collection(db, "users", uid, "days");
  state.unsubscribeDays = onSnapshot(daysRef, (snapshot) => {
    state.days = {};
    snapshot.forEach((doc) => {
      state.days[doc.id] = doc.data();
    });
    renderMetrics();
    renderWeeklyMini();
  });

  const schedRef = collection(db, "users", uid, "workoutSchedule");
  state.unsubscribeSchedule = onSnapshot(schedRef, (snapshot) => {
    state.workoutSchedule = {};
    snapshot.forEach((d) => {
      state.workoutSchedule[d.id] = d.data();
    });
    renderWorkoutView();
    renderScheduleEditor();
  });

  const woLogRef = collection(db, "users", uid, "workoutLogs");
  const qWoLog = query(woLogRef, orderBy("date", "desc"));
  state.unsubscribeWorkoutLogs = onSnapshot(qWoLog, (snapshot) => {
    state.workoutLogs = [];
    snapshot.forEach((d) => state.workoutLogs.push({ id: d.id, ...d.data() }));
    if (!state.isEditingWorkout) renderWorkoutView();
  });
}

// === CORE FUNCTIONS ===
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
  const data = {
    weight: num($("dayWeight").value),
    steps: num($("daySteps").value)
  };
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
  } catch (e) {
    console.error("Error adding entry:", e);
    toast("Error adding entry");
  }
}

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

async function updateLibraryMeal(id, data) {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "meals", id);
  await updateDoc(ref, data);
  toast("Meal updated");
}

async function deleteLibraryMeal(id) {
  if (!state.user) return;
  if (!confirm("Permanently delete this food from your library?")) return;
  const ref = doc(db, "users", state.user.uid, "meals", id);
  await deleteDoc(ref);
  toast("Meal deleted");
}

async function deleteEntry(id) {
  if (!state.user) return;
  const entry = state.log.find(i => i.id === id);
  await deleteDoc(doc(db, "users", state.user.uid, "logs", id));
  vibrate();
  
  if (entry) {
    const { id: _omit, ...data } = entry;
    toast(`Removed ${entry.name}`, 5000, "Undo", async () => {
      await addDoc(collection(db, "users", state.user.uid, "logs"), data);
      toast("Restored");
    });
  }
}

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
      const { id, ...mealData } = meal;
      batch.set(newDoc, {
        ...mealData,
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

function calculateStreak() {
  const today = new Date();
  let streak = 0;
  let checkDate = new Date(today);
  
  while (true) {
    const dateStr = getLocalDate(checkDate);
    const dayLog = state.log.filter(i => i.date === dateStr);
    
    if (dayLog.length > 0) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      if (dateStr === getLocalDate(today)) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }
  }
  
  $("streakCount").textContent = streak;
  const badge = $("streakBadge");
  badge.style.transform = "scale(1.1)";
  setTimeout(() => { badge.style.transform = "scale(1)"; }, 200);
}

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
  const host = $("mealResults");
  host.innerHTML = "";
  const term = filter.toLowerCase().trim();
  const matches = state.library.filter(m => m.name.toLowerCase().includes(term));
  
  if (!matches.length) {
    state.selectedMealId = null;
    host.innerHTML = `<div class="meal-result-empty">No matches found${term ? ` for "${esc(term)}"` : ""}</div>`;
    updateMealPreview(null);
    return;
  }
  
  if (!matches.some(m => m.id === state.selectedMealId)) {
    state.selectedMealId = matches[0].id;
  }
  
  matches.slice(0, 50).forEach(item => {
    const row = document.createElement("div");
    row.className = "meal-result" + (item.id === state.selectedMealId ? " selected" : "");
    row.setAttribute("role", "option");
    row.innerHTML = `
      <div class="meal-result-info">
        <span class="meal-result-name">${esc(item.name)}</span>
        <span class="meal-result-macros">${Math.round(item.calories)} cal · P ${fmt(item.protein)} · C ${fmt(item.carbs)} · F ${fmt(item.fat)}</span>
      </div>
      <button class="meal-result-quickadd" title="Quick add 1 serving" aria-label="Quick add ${esc(item.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    `;
    
    row.onclick = () => {
      state.selectedMealId = item.id;
      host.querySelectorAll(".meal-result").forEach(r => r.classList.remove("selected"));
      row.classList.add("selected");
      updateMealPreview(item);
    };
    
    row.querySelector(".meal-result-quickadd").onclick = (e) => {
      e.stopPropagation();
      vibrate();
      addEntry(item.name, item, "db", 1);
    };
    
    host.appendChild(row);
  });
  
  updateMealPreview(state.library.find(x => x.id === state.selectedMealId));
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
    if (!item.base) return;
    if (!map.has(item.name)) {
      map.set(item.name, { macros: item.base, count: 0 });
    }
    map.get(item.name).count++;
  });
  
  const recents = Array.from(map.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 16);
  
  if (recents.length === 0) {
    $("noRecents").classList.remove("hidden");
    return;
  }
  
  $("noRecents").classList.add("hidden");
  
  recents.forEach(([name, { macros, count }]) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "recent-item";
    el.innerHTML = `
      <span class="recent-name">${esc(name)}</span>
      <span class="recent-meta">${Math.round(macros.calories)} cal${count > 1 ? ` · ×${count}` : ""}</span>
    `;
    el.onclick = () => {
      vibrate();
      addEntry(name, macros, "recent", 1);
    };
    host.appendChild(el);
  });
}

// Swipe-to-delete log item renderer
function renderLog() {
  const list = $("selectedMeals");
  list.innerHTML = "";
  const dayLog = getDayLog();
  
  $("emptyLog").style.display = dayLog.length ? "none" : "flex";
  
  dayLog.forEach(item => {
    const wrapper = document.createElement("div");
    wrapper.className = "log-item-wrapper";
    
    const cal = num(item.calories);
    const pro = num(item.protein);
    let ppc = cal > 0 ? (pro / cal).toFixed(2) : "0";
    if (ppc.endsWith('0')) ppc = ppc.slice(0, -1);
    if (ppc.endsWith('.')) ppc = ppc.slice(0, -1);
    
    wrapper.innerHTML = `
      <div class="log-item-background">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
      </div>
      <div class="log-item">
        <div class="log-info">
          <h4>${esc(item.name)}</h4>
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
      </div>
    `;
    
    const el = wrapper.querySelector('.log-item');
    
    // Swipe to delete logic
    let startX = 0, currentX = 0;
    el.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      el.classList.add('swiping');
    }, {passive: true});
    
    el.addEventListener('touchmove', (e) => {
      currentX = e.touches[0].clientX - startX;
      // Only allow swiping left
      if (currentX < 0) {
        el.style.transform = `translateX(${currentX}px)`;
      }
    }, {passive: true});
    
    el.addEventListener('touchend', (e) => {
      el.classList.remove('swiping');
      if (currentX < -100) {
        el.style.transform = `translateX(-100%)`;
        setTimeout(() => deleteEntry(item.id), 250);
      } else {
        el.style.transform = `translateX(0)`;
      }
      currentX = 0;
    });

    el.querySelector(".delete-trigger").onclick = (e) => {
      e.stopPropagation();
      deleteEntry(item.id);
    };
    
    el.onclick = () => openEditEntryModal(item);
    list.appendChild(wrapper);
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
        <div class="lib-info">${esc(item.name)}</div>
        <div class="lib-meta">${Math.round(item.calories)} cal • P:${fmt(item.protein)} C:${fmt(item.carbs)} F:${fmt(item.fat)}</div>
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
  
  renderWeightChart();
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
let editingEntryId = null;
let editingEntryBase = null;

function openEditEntryModal(item) {
  editingEntryId = item.id;
  editingEntryBase = item.base || null;
  $("editName").value = item.name;
  $("editServings").value = item.servings;
  $("editCalories").value = fmt(item.calories);
  $("editP").value = fmt(item.protein);
  $("editC").value = fmt(item.carbs);
  $("editF").value = fmt(item.fat);
  $("editModal").showModal();
}

$("editServings").addEventListener("input", () => {
  if (!editingEntryBase) return;
  const s = num($("editServings").value);
  if (s <= 0) return;
  $("editCalories").value = fmt(editingEntryBase.calories * s);
  $("editP").value = fmt(editingEntryBase.protein * s);
  $("editC").value = fmt(editingEntryBase.carbs * s);
  $("editF").value = fmt(editingEntryBase.fat * s);
});

$("saveEditBtn").onclick = async () => {
  if (!state.user || !editingEntryId) return;
  const servings = num($("editServings").value) || 1;
  const totals = {
    name: $("editName").value.trim() || "Entry",
    servings,
    calories: num($("editCalories").value),
    protein: num($("editP").value),
    carbs: num($("editC").value),
    fat: num($("editF").value)
  };
  totals.base = {
    calories: totals.calories / servings,
    protein: totals.protein / servings,
    carbs: totals.carbs / servings,
    fat: totals.fat / servings
  };
  
  await updateDoc(doc(db, "users", state.user.uid, "logs", editingEntryId), totals);
  $("editModal").close();
  toast("Entry updated");
};

$("closeEditBtn").onclick = () => $("editModal").close();

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

// Calculate barbell plates
function openPlateCalc(targetWeight) {
  $("calcTargetWeight").value = targetWeight || "";
  $("plateCalcModal").showModal();
  updatePlateCalc();
}

function updatePlateCalc() {
  const target = num($("calcTargetWeight").value);
  const bar = num($("calcBarWeight").value) || 45;
  const visualizer = $("plateVisualizer");
  const textOut = $("plateCalcText");
  
  visualizer.innerHTML = '<div class="plate-sleeve"></div>';
  if (target <= bar) {
    textOut.textContent = target === bar ? "Empty bar" : "Weight must be greater than bar weight";
    return;
  }

  let perSide = (target - bar) / 2;
  const plates = [45, 35, 25, 10, 5, 2.5];
  const required = [];

  plates.forEach(p => {
    const count = Math.floor(perSide / p);
    if (count > 0) {
      for(let i=0; i<count; i++) required.push(p);
      perSide -= (count * p);
    }
  });

  required.forEach(p => {
    const div = document.createElement("div");
    div.className = `plate plate-${p.toString().replace('.', '_')}`;
    div.textContent = p;
    visualizer.appendChild(div);
  });
  
  const counts = required.reduce((acc, curr) => { acc[curr] = (acc[curr] || 0) + 1; return acc; }, {});
  const strArr = Object.entries(counts).map(([weight, qty]) => `${qty}x ${weight}lbs`).reverse();
  textOut.textContent = `Per side: ${strArr.join(' | ')}`;
}


// === EVENT LISTENERS & INITIALIZATION ===
async function init() {
  const savedTheme = localStorage.getItem("mt_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  
  onAuthStateChanged(auth, (user) => updateAuthUI(user));
  
  $("mealSearch").addEventListener("input", (e) => buildDropdown(e.target.value));
  
  $("mealServings").addEventListener("input", () => {
    const item = state.library.find(x => x.id === state.selectedMealId);
    updateMealPreview(item);
  });
  
  document.querySelectorAll(".btn-adjust").forEach(btn => {
    btn.onclick = () => {
      const adjust = num(btn.dataset.adjust);
      const input = $("mealServings");
      const newVal = Math.max(0.25, num(input.value) + adjust);
      input.value = newVal;
      const item = state.library.find(x => x.id === state.selectedMealId);
      updateMealPreview(item);
    };
  });
  
  $("addMealBtn").onclick = () => {
    const item = state.library.find(x => x.id === state.selectedMealId);
    if (item) {
      addEntry(item.name, item, "db", $("mealServings").value);
      $("mealSearch").value = "";
      $("mealServings").value = "1";
      buildDropdown("");
    } else {
      toast("Please select a meal");
    }
  };

  // PC Bulk Entry Toggle
  $("btnSingleEntry").onclick = () => {
    $("btnSingleEntry").classList.add("active");
    $("btnBulkEntry").classList.remove("active");
    $("manualForm").classList.remove("hidden");
    $("bulkEntryForm").classList.add("hidden");
  };
  $("btnBulkEntry").onclick = () => {
    $("btnBulkEntry").classList.add("active");
    $("btnSingleEntry").classList.remove("active");
    $("bulkEntryForm").classList.remove("hidden");
    $("manualForm").classList.add("hidden");
  };

  // Process Bulk Data
  $("processBulkBtn").onclick = async () => {
    const text = $("bulkEntryText").value;
    const lines = text.split('\n');
    let added = 0;
    
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(/[,\t]+/).map(s => s.trim());
      if (parts.length >= 6) {
        const macros = {
          calories: num(parts[2]),
          protein: num(parts[3]),
          carbs: num(parts[4]),
          fat: num(parts[5])
        };
        await addEntry(parts[0], macros, "bulk", num(parts[1]));
        added++;
      }
    }
    
    if (added > 0) {
      toast(`Successfully imported ${added} entries!`);
      $("bulkEntryText").value = "";
    } else {
      toast("No valid data found. Check formatting.");
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
    $("manualName").value = "";
    $("manualCalories").value = "";
    $("manualProtein").value = "";
    $("manualCarbs").value = "";
    $("manualFat").value = "";
    $("manualServings").value = "1";
  };
  
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
    $("manualName").value = "";
    $("manualCalories").value = "";
    $("manualProtein").value = "";
    $("manualCarbs").value = "";
    $("manualFat").value = "";
    $("manualServings").value = "1";
  };
  
  $("saveMetricsBtn").onclick = saveDayMetrics;
  
  $("notesToggle").onclick = () => {
    $("notesToggle").classList.toggle("expanded");
    $("notesContent").classList.toggle("hidden");
  };
  
  $("saveNotesBtn").onclick = saveDayNotes;
  $("btnImportDefaults").onclick = importDefaults;
  $("copyPrevDayBtn").onclick = copyPreviousDay;
  
  $("prevDateBtn").onclick = () => {
    state.currentDate.setDate(state.currentDate.getDate() - 1);
    render();
  };
  
  $("nextDateBtn").onclick = () => {
    state.currentDate.setDate(state.currentDate.getDate() + 1);
    render();
  };
  
  $("themeToggle").onclick = () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mt_theme", next);
  };
  
  $("btnStats").onclick = () => switchView('stats');
  $("closeStatsBtn").onclick = () => switchView(state.lastMainView || 'nutrition');
  $("exportDataBtn").onclick = exportToCSV;
  
  $("btnSettings").onclick = () => {
    renderSettingsLibrary();
    updateTargetInputs();
    $("settingsModal").showModal();
  };
  
  $("closeSettingsBtn").onclick = () => $("settingsModal").close();
  $("saveTargetsBtn").onclick = saveTargets;
  $("libSearch").addEventListener("input", renderSettingsLibrary);
  
  // Plate Calc Event Listeners
  $("calcTargetWeight").addEventListener("input", updatePlateCalc);
  $("calcBarWeight").addEventListener("input", updatePlateCalc);
  $("closePlateCalcBtn").onclick = () => $("plateCalcModal").close();

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      // Ignore manual entry internal tabs
      if (btn.id === 'btnSingleEntry' || btn.id === 'btnBulkEntry') return;

      document.querySelectorAll(".tabs > .tab-btn:not(#btnSingleEntry):not(#btnBulkEntry)").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".card.p-0 > .tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      const tabId = `tab-${btn.dataset.tab}`;
      $(tabId).classList.remove("hidden");
      
      if (btn.dataset.tab === "recent") {
        renderRecents();
      }
    };
  });
  
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      $("mealSearch").focus();
    }
    
    if (e.key === "Enter" && document.activeElement === $("mealSearch")) {
      e.preventDefault();
      $("addMealBtn").click();
    }
    
    if (e.key === "Escape") {
      $("settingsModal").close();
      $("editLibModal").close();
      $("editModal").close();
      $("plateCalcModal").close();
    }
  });
  
  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        dialog.close();
      }
    });
  });
  
  document.querySelectorAll(".main-nav-btn, .bottom-nav-btn[data-view]").forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });
  
  const bottomSettings = $("bottomNavSettings");
  if (bottomSettings) {
    bottomSettings.onclick = () => $("btnSettings").click();
  }
  
  const updateSyncStatus = () => {
    const el = $("syncStatus");
    if (navigator.onLine) {
      el.innerHTML = '<span class="sync-dot"></span><span>Synced</span>';
      el.classList.remove("offline");
    } else {
      el.innerHTML = '<span class="sync-dot offline-dot"></span><span>Offline — will sync</span>';
      el.classList.add("offline");
    }
  };
  window.addEventListener("online", () => { updateSyncStatus(); toast("Back online — syncing"); });
  window.addEventListener("offline", updateSyncStatus);
  updateSyncStatus();
  
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(e => console.warn("SW registration failed:", e));
  }

  document.querySelectorAll(".settings-tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".settings-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".settings-tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      $(`stab-${btn.dataset.stab}`).classList.remove("hidden");
      if (btn.dataset.stab === 'schedule') renderScheduleEditor();
    };
  });

  $("woPrevDateBtn").onclick = () => {
    state.workoutDate.setDate(state.workoutDate.getDate() - 1);
    state.expandedExercises = new Set();
    state.timerPromptShown = false;
    renderWorkoutView();
  };
  $("woNextDateBtn").onclick = () => {
    state.workoutDate.setDate(state.workoutDate.getDate() + 1);
    state.expandedExercises = new Set();
    state.timerPromptShown = false;
    renderWorkoutView();
  };
  $("woLastWeekBtn").onclick = () => {
    state.workoutDate.setDate(state.workoutDate.getDate() - 7);
    state.expandedExercises = new Set();
    state.timerPromptShown = false;
    renderWorkoutView();
  };
  $("woTodayBtn").onclick = () => {
    state.workoutDate = new Date();
    state.expandedExercises = new Set();
    state.timerPromptShown = false;
    renderWorkoutView();
  };

  $("woStartBtn").onclick = startWorkout;
  $("woFinishBtn").onclick = finishWorkout;
  $("woSkipRest").onclick = skipRestTimer;
  $("woAddExerciseBtn").onclick = () => {
    $("addExName").value = "";
    $("addExSets").value = "3";
    $("addExReps").value = "";
    $("addExBodyPart").value = "";
    $("addExEquipment").value = "";
    $("addExNotes").value = "";
    $("addExerciseModal").showModal();
  };
  $("closeAddExerciseBtn").onclick = () => $("addExerciseModal").close();
  $("addExSubmitBtn").onclick = addExerciseToWorkout;

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

function switchView(view) {
  if (state.currentView !== 'stats') state.lastMainView = state.currentView;
  state.currentView = view;
  
  $("nutritionView").classList.toggle("hidden", view !== 'nutrition');
  $("workoutView").classList.toggle("hidden", view !== 'workout');
  $("statsView").classList.toggle("hidden", view !== 'stats');
  document.querySelector(".main-nav").classList.toggle("hidden", view === 'stats');
  
  document.querySelectorAll(".main-nav-btn, .bottom-nav-btn[data-view]").forEach(b => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  
  if (view === 'workout') renderWorkoutView();
  if (view === 'stats') renderStats();
  window.scrollTo({ top: 0, behavior: "instant" });
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

function getDayName(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function getWorkoutDateStr() {
  return getLocalDate(state.workoutDate);
}

function getWorkoutLog() {
  const dateStr = getWorkoutDateStr();
  return state.workoutLogs.find(l => l.date === dateStr);
}

function getScheduleForDay(dayName) {
  return state.workoutSchedule[dayName] || null;
}

function getCurrentWorkoutData() {
  const dateStr = getWorkoutDateStr();
  const existingLog = getWorkoutLog();
  const dayName = getDayName(state.workoutDate);
  const template = getScheduleForDay(dayName);
  
  if (existingLog && existingLog.exercises && existingLog.exercises.length > 0) {
    return existingLog;
  }
  
  if (template && !template.restDay && template.exercises && template.exercises.length > 0) {
    return {
      date: dateStr,
      dayName: dayName,
      title: template.title || dayName,
      focus: template.focus || '',
      exercises: template.exercises.map(ex => ({
        name: ex.name || '',
        type: ex.type || 'strength',
        equipment: ex.equipment || '',
        targetSets: ex.sets || '3',
        targetReps: ex.reps || '',
        bodyPart: ex.bodyPart || '',
        notes: ex.notes || '',
        scheduleNotes: ex.notes || '',
        fromSchedule: true,
        completed: false,
        sets: Array.from({ length: parseInt(ex.sets) || 3 }, () => ({
          weight: '', reps: '', rpe: '', duration: '', speed: '', incline: '', completed: false
        }))
      }))
    };
  }
  
  return {
    date: dateStr,
    dayName: dayName,
    title: template?.title || '',
    focus: template?.focus || '',
    restDay: template?.restDay ?? true,
    exercises: []
  };
}

async function saveWorkoutLog(data) {
  if (!state.user) return;
  const dateStr = getWorkoutDateStr();
  const ref = doc(db, "users", state.user.uid, "workoutLogs", dateStr);
  await setDoc(ref, { ...data, date: dateStr }, { merge: true });
}

function getPreviousPerformance(exerciseName) {
  const todayStr = getWorkoutDateStr();
  const nameLower = exerciseName.toLowerCase();
  
  for (const log of state.workoutLogs) {
    if (log.date === todayStr) continue;
    if (!log.exercises) continue;
    for (const ex of log.exercises) {
      if (ex.name.toLowerCase() === nameLower) {
        const completedSets = (ex.sets || []).filter(s => s.completed && (s.weight || s.duration));
        if (completedSets.length > 0) {
          if (ex.type === 'cardio') {
             const best = completedSets.reduce((a, b) => (parseFloat(a.duration) || 0) > (parseFloat(b.duration) || 0) ? a : b);
             return { duration: best.duration, date: log.date };
          } else {
             const best = completedSets.reduce((a, b) => (parseFloat(a.weight) || 0) > (parseFloat(b.weight) || 0) ? a : b);
             return { weight: best.weight, reps: best.reps, date: log.date };
          }
        }
      }
    }
  }
  return null;
}

function getPreviousSets(exerciseName) {
  const todayStr = getWorkoutDateStr();
  const nameLower = exerciseName.toLowerCase();
  
  for (const log of state.workoutLogs) {
    if (log.date === todayStr) continue;
    if (!log.exercises) continue;
    for (const ex of log.exercises) {
      if (ex.name.toLowerCase() === nameLower) {
        const done = (ex.sets || []).filter(s => s.completed && (s.weight || s.reps || s.duration));
        if (done.length > 0) return done;
      }
    }
  }
  return [];
}

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
  
  const oneWeekAgo = new Date(d);
  oneWeekAgo.setDate(d.getDate() - 7);
  $("woQuickNavLabel").textContent = `${getDayName(d)}`;
  
  const data = getCurrentWorkoutData();
  
  if (data.title) {
    $("woDayTitle").textContent = `${getDayName(d)} – ${data.title}`;
  } else {
    $("woDayTitle").textContent = getDayName(d);
  }
  $("woDayFocus").textContent = data.focus || '';
  
  const isRest = data.restDay || (!data.exercises || data.exercises.length === 0);
  $("woRestState").classList.toggle("hidden", !isRest || (data.exercises && data.exercises.length > 0));
  
  renderExerciseCards(data);
  
  const isToday = dStr === todayStr;
  $("woTimerBar").style.display = isToday ? 'flex' : 'none';
  
  const existingLog = getWorkoutLog();
  if (existingLog && existingLog.endTime) {
    updateWorkoutSummary(existingLog);
    $("woSummaryCard").classList.remove("hidden");
  } else {
    $("woSummaryCard").classList.add("hidden");
  }
}

function renderExerciseCards(data) {
  const container = $("woExerciseList");
  container.innerHTML = '';
  
  if (!data.exercises || data.exercises.length === 0) return;
  
  if (state.expandedExercises.size === 0 && data.exercises.length > 0) {
    data.exercises.forEach((_, i) => state.expandedExercises.add(i));
  }
  
  data.exercises.forEach((ex, exIdx) => {
    const isExpanded = state.expandedExercises.has(exIdx);
    const card = document.createElement('div');
    card.className = `wo-exercise-card${ex.completed ? ' completed' : ''}${isExpanded ? ' expanded' : ''}`;
    
    const prev = getPreviousPerformance(ex.name);
    const prevSets = getPreviousSets(ex.name);
    const lastNotes = getLastExerciseNotes(ex.name);
    const isSuperset = ex.name.toLowerCase().includes('superset');
    
    const noteText = ex.notes || ex.scheduleNotes || '';
    const noteIndicatorHtml = noteText ? 
      `<div class="wo-ex-note-indicator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>${esc(noteText.substring(0, 50))}${noteText.length > 50 ? '...' : ''}</div>` : '';
    
    const schedNoteHtml = ex.scheduleNotes ? 
      `<div class="wo-sched-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${esc(ex.scheduleNotes)}</div>` : '';
    
    let tableHTML = '';
    if (ex.type === 'cardio') {
      tableHTML = `
        <table class="wo-set-table">
          <thead><tr><th>Interval</th><th class="cardio-header">Duration (min)</th><th class="cardio-header">Speed</th><th class="cardio-header">Incline</th><th>✓</th></tr></thead>
          <tbody>
            ${(ex.sets || []).map((s, sIdx) => `
              <tr>
                <td>${sIdx + 1}</td>
                <td><input type="number" inputmode="decimal" value="${esc(s.duration || '')}" data-ex="${exIdx}" data-set="${sIdx}" data-field="duration" placeholder="e.g. 15" /></td>
                <td><input type="number" inputmode="decimal" value="${esc(s.speed || '')}" data-ex="${exIdx}" data-set="${sIdx}" data-field="speed" placeholder="e.g. 3.5" /></td>
                <td><input type="number" inputmode="decimal" value="${esc(s.incline || '')}" data-ex="${exIdx}" data-set="${sIdx}" data-field="incline" placeholder="e.g. 12" /></td>
                <td><div class="wo-set-check${s.completed ? ' checked' : ''}" data-ex="${exIdx}" data-set="${sIdx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    } else {
      tableHTML = `
        <table class="wo-set-table">
          <thead><tr><th>Set</th><th>Weight (lbs)</th><th>Reps</th><th>RPE</th><th>✓</th></tr></thead>
          <tbody>
            ${(ex.sets || []).map((s, sIdx) => {
              const ph = prevSets[sIdx] || null;
              return `
              <tr>
                <td>${sIdx + 1}</td>
                <td>
                  <div class="weight-input-wrapper">
                    <input type="number" inputmode="decimal" value="${esc(s.weight || '')}" data-ex="${exIdx}" data-set="${sIdx}" data-field="weight" placeholder="${ph && ph.weight ? esc(ph.weight) : '—'}" />
                    <button class="btn-plate-calc" data-weight-val="${esc(s.weight || (ph ? ph.weight : ''))}" title="Calculate Plates"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></button>
                  </div>
                </td>
                <td><input type="number" inputmode="numeric" value="${esc(s.reps || '')}" data-ex="${exIdx}" data-set="${sIdx}" data-field="reps" placeholder="${ph && ph.reps ? esc(ph.reps) : '—'}" /></td>
                <td><input type="number" inputmode="numeric" value="${esc(s.rpe || '')}" data-ex="${exIdx}" data-set="${sIdx}" data-field="rpe" placeholder="—" min="1" max="10" /></td>
                <td><div class="wo-set-check${s.completed ? ' checked' : ''}" data-ex="${exIdx}" data-set="${sIdx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div></td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>`;
    }

    card.innerHTML = `
      <div class="wo-ex-header" data-idx="${exIdx}">
        <div class="wo-ex-check${ex.completed ? ' checked' : ''}" data-ex-idx="${exIdx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div class="wo-ex-info">
          <div class="wo-ex-name">${esc(ex.name)} ${isSuperset ? '<span class="wo-ex-badge">SS</span>' : ''}</div>
          <div class="wo-ex-meta">
            ${ex.equipment ? `<b>${esc(ex.equipment)}</b> · ` : ''} ${esc(ex.targetSets || '?')}×${esc(ex.targetReps || '?')}
            ${prev ? ` · <span class="wo-ex-prev">Last: ${esc(prev.weight || prev.duration)} ${ex.type === 'cardio' ? 'min' : 'lbs'}</span>` : ''}
          </div>
          ${noteIndicatorHtml}
        </div>
        ${!ex.fromSchedule ? `<button class="wo-remove-ex-btn" data-ex-idx="${exIdx}" title="Remove exercise"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
        <svg class="wo-ex-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="wo-ex-body">
        ${schedNoteHtml}
        <div class="wo-ex-notes-section">
          <div class="wo-ex-notes-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Notes</div>
          <textarea data-ex-idx="${exIdx}" placeholder="Exercise notes...">${esc(ex.notes || (lastNotes ? lastNotes.notes : ''))}</textarea>
        </div>
        ${tableHTML}
        <div class="wo-add-set-row"><button class="wo-add-set-btn" data-ex-idx="${exIdx}">+ Add ${ex.type === 'cardio' ? 'Interval' : 'Set'}</button></div>
      </div>
    `;
    
    container.appendChild(card);
  });
  
  container.onclick = (e) => {
    const plateBtn = e.target.closest('.btn-plate-calc');
    if (plateBtn) {
      const inputVal = plateBtn.previousElementSibling?.value || plateBtn.dataset.weightVal;
      openPlateCalc(num(inputVal));
      return;
    }

    const header = e.target.closest('.wo-ex-header');
    if (header && !e.target.closest('.wo-ex-check') && !e.target.closest('.wo-remove-ex-btn')) {
      const card = header.closest('.wo-exercise-card');
      const idx = parseInt(header.dataset.idx);
      card.classList.toggle('expanded');
      if (card.classList.contains('expanded')) {
        state.expandedExercises.add(idx);
      } else {
        state.expandedExercises.delete(idx);
      }
      return;
    }
    
    const exCheck = e.target.closest('.wo-ex-check[data-ex-idx]');
    if (exCheck) {
      handleExerciseComplete(parseInt(exCheck.dataset.exIdx));
      return;
    }
    
    const setCheck = e.target.closest('.wo-set-check');
    if (setCheck) {
      handleSetComplete(parseInt(setCheck.dataset.ex), parseInt(setCheck.dataset.set));
      return;
    }
    
    const addSetBtn = e.target.closest('.wo-add-set-btn');
    if (addSetBtn) {
      addSet(parseInt(addSetBtn.dataset.exIdx));
      return;
    }
    
    const removeBtn = e.target.closest('.wo-remove-ex-btn');
    if (removeBtn) {
      removeExercise(parseInt(removeBtn.dataset.exIdx));
      return;
    }
  };
  
  let setInputTimer = null;
  container.addEventListener('input', (e) => {
    if (e.target.dataset.ex !== undefined && e.target.dataset.set !== undefined) {
      clearTimeout(setInputTimer);
      setInputTimer = setTimeout(() => {
        handleSetInputChange(
          parseInt(e.target.dataset.ex),
          parseInt(e.target.dataset.set),
          e.target.dataset.field,
          e.target.value
        );
      }, 600);
    }
    
    if (e.target.closest('.wo-ex-notes-section') && e.target.tagName === 'TEXTAREA') {
      handleExerciseNoteChange(parseInt(e.target.dataset.exIdx), e.target.value);
    }
  });
  
  container.addEventListener('focusin', (e) => {
    if (e.target.matches('.wo-set-table input')) {
      state.isEditingWorkout = true;
    }
  });
  container.addEventListener('focusout', (e) => {
    if (e.target.matches('.wo-set-table input')) {
      setTimeout(() => { state.isEditingWorkout = false; }, 1000);
    }
  });
}

function handleSetInputChange(exIdx, setIdx, field, value) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  data.exercises[exIdx].sets[setIdx][field] = value;
  saveWorkoutLog(data);
}

let noteDebounceTimer = null;
function handleExerciseNoteChange(exIdx, value) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  data.exercises[exIdx].notes = value;
  
  clearTimeout(noteDebounceTimer);
  noteDebounceTimer = setTimeout(() => saveWorkoutLog(data), 800);
}

function handleSetComplete(exIdx, setIdx) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  const set = data.exercises[exIdx].sets[setIdx];
  set.completed = !set.completed;
  saveWorkoutLog(data);
  
  if (set.completed) {
    vibrate(15);
    startRestTimer();
    
    if (!state.activeWorkout && !state.timerPromptShown) {
      const anyPreviouslyCompleted = data.exercises.some((ex, ei) =>
        (ex.sets || []).some((s, si) => s.completed && !(ei === exIdx && si === setIdx))
      );
      if (!anyPreviouslyCompleted) {
        state.timerPromptShown = true;
        showWorkoutPrompt(
          'Start Workout Timer?',
          'You completed your first set. Start tracking workout duration?',
          'Start Timer',
          null,
          () => { startWorkout(); }
        );
      }
    }
  }
  
  renderWorkoutView();
}

function handleExerciseComplete(exIdx) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  const ex = data.exercises[exIdx];
  ex.completed = !ex.completed;
  if (ex.sets) {
    ex.sets.forEach(s => { s.completed = ex.completed; });
  }
  saveWorkoutLog(data);
  
  if (ex.completed && state.activeWorkout) {
    const allDone = data.exercises.every(e => e.completed);
    if (allDone) {
      showWorkoutPrompt(
        'Workout Complete?',
        'All exercises are done! Would you like to finish the workout or add another exercise?',
        'Finish Workout',
        'Add Exercise',
        () => { finishWorkout(); },
        () => {
          $("addExName").value = "";
          $("addExSets").value = "3";
          $("addExReps").value = "";
          $("addExBodyPart").value = "";
          $("addExEquipment").value = "";
          $("addExNotes").value = "";
          $("addExerciseModal").showModal();
        }
      );
    }
  }
  
  renderWorkoutView();
}

function showWorkoutPrompt(title, message, primaryLabel, secondaryLabel, onPrimary, onSecondary) {
  const dialog = $("woPromptDialog");
  $("woPromptTitle").textContent = title;
  $("woPromptMsg").textContent = message;
  $("woPromptPrimary").textContent = primaryLabel;
  
  const secondaryBtn = $("woPromptSecondary");
  if (secondaryLabel) {
    secondaryBtn.textContent = secondaryLabel;
    secondaryBtn.classList.remove("hidden");
    secondaryBtn.onclick = () => { dialog.close(); if (onSecondary) onSecondary(); };
  } else {
    secondaryBtn.classList.add("hidden");
  }
  
  $("woPromptPrimary").onclick = () => { dialog.close(); if (onPrimary) onPrimary(); };
  $("woPromptDismiss").onclick = () => dialog.close();
  dialog.showModal();
}

function addSet(exIdx) {
  const data = getCurrentWorkoutData();
  if (!data.exercises[exIdx]) return;
  const ex = data.exercises[exIdx];
  
  if (ex.type === 'cardio') {
    ex.sets.push({ duration: '', speed: '', incline: '', completed: false });
  } else {
    ex.sets.push({ weight: '', reps: '', rpe: '', completed: false });
  }
  
  state.expandedExercises.add(exIdx);
  saveWorkoutLog(data);
  renderWorkoutView();
}

function removeExercise(exIdx) {
  const data = getCurrentWorkoutData();
  data.exercises.splice(exIdx, 1);
  const newExpanded = new Set();
  state.expandedExercises.forEach(i => {
    if (i < exIdx) newExpanded.add(i);
    else if (i > exIdx) newExpanded.add(i - 1);
  });
  state.expandedExercises = newExpanded;
  saveWorkoutLog(data);
  renderWorkoutView();
}

function addExerciseToWorkout() {
  const name = $("addExName").value.trim();
  if (!name) { toast("Enter an exercise name"); return; }
  
  const type = $("addExType").value || 'strength';
  const equipment = $("addExEquipment").value.trim();
  const sets = parseInt($("addExSets").value) || 1;
  const reps = $("addExReps").value.trim();
  const bodyPart = $("addExBodyPart").value.trim();
  const notes = $("addExNotes").value.trim();
  
  const data = getCurrentWorkoutData();
  data.exercises = data.exercises || [];
  
  let setStructure;
  if (type === 'cardio') {
    setStructure = Array.from({ length: sets }, () => ({ duration: '', speed: '', incline: '', completed: false }));
  } else {
    setStructure = Array.from({ length: sets }, () => ({ weight: '', reps: '', rpe: '', completed: false }));
  }

  data.exercises.push({
    name, type, equipment,
    targetSets: String(sets),
    targetReps: type === 'cardio' ? 'N/A' : reps,
    bodyPart: type === 'cardio' ? 'Cardio' : bodyPart,
    notes,
    fromSchedule: false,
    completed: false,
    sets: setStructure
  });
  
  data.restDay = false;
  state.expandedExercises.add(data.exercises.length - 1);
  saveWorkoutLog(data);
  $("addExerciseModal").close();
  toast(`Added ${name}`);
  renderWorkoutView();
}

function startWorkout() {
  state.activeWorkout = { startTime: Date.now() };
  $("woStartBtn").classList.add("hidden");
  $("woFinishBtn").classList.remove("hidden");
  
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

function playRestChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.2);
    });
  } catch (e) { }
}

function startRestTimer() {
  clearInterval(state.restTimerInterval);
  state.restTimeLeft = state.targets.restTimer || 60;
  $("woRestTimerArea").style.display = 'flex';
  $("woRestTime").textContent = formatDuration(state.restTimeLeft);
  $("woRestTime").classList.remove("urgent");
  
  state.restTimerInterval = setInterval(() => {
    state.restTimeLeft--;
    if (state.restTimeLeft <= 0) {
      clearInterval(state.restTimerInterval);
      $("woRestTimerArea").style.display = 'none';
      vibrate([100, 60, 100]);
      playRestChime();
      toast("Rest over — next set! 💪");
      return;
    }
    $("woRestTime").classList.toggle("urgent", state.restTimeLeft <= 5);
    $("woRestTime").textContent = formatDuration(state.restTimeLeft);
  }, 1000);
}

function skipRestTimer() {
  clearInterval(state.restTimerInterval);
  $("woRestTimerArea").style.display = 'none';
}

function updateWorkoutSummary(data) {
  if (!data.exercises) return;
  let totalSets = 0, totalVolume = 0;
  const exercisesDone = data.exercises.filter(ex => {
    const doneSets = (ex.sets || []).filter(s => s.completed);
    totalSets += doneSets.length;
    if (ex.type !== 'cardio') {
      doneSets.forEach(s => {
        totalVolume += (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0);
      });
    }
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
  
  document.querySelectorAll('.sched-day-btn').forEach(btn => {
    const d = state.workoutSchedule[btn.dataset.day];
    btn.classList.toggle('has-exercises', !!(d && d.exercises && d.exercises.length > 0 && !d.restDay));
  });
  
  const list = $("schedExerciseList");
  list.innerHTML = '';
  
  const exercises = data.exercises || [];
  exercises.forEach((ex, idx) => {
    const row = document.createElement('div');
    row.className = 'sched-exercise-row';
    row.innerHTML = `
      <div class="sched-ex-main">
        <input type="text" value="${esc(ex.name || '')}" placeholder="Exercise name" data-idx="${idx}" data-field="name" />
        <input type="text" value="${esc(ex.sets || '')}" placeholder="Sets" data-idx="${idx}" data-field="sets" class="sched-input-sm" inputmode="numeric" />
        <input type="text" value="${esc(ex.reps || '')}" placeholder="Reps" data-idx="${idx}" data-field="reps" class="sched-input-sm" />
        <input type="text" value="${esc(ex.bodyPart || '')}" placeholder="Body part" data-idx="${idx}" data-field="bodyPart" />
        <button class="sched-remove-btn" data-idx="${idx}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="sched-ex-notes">
        <input type="text" value="${esc(ex.notes || '')}" placeholder="Notes (e.g. superset with curls, slow eccentric…)" data-idx="${idx}" data-field="notes" class="sched-notes-input" />
      </div>
    `;
    list.appendChild(row);
  });
  
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
  exercises.push({ name: '', sets: '3', reps: '', bodyPart: '', notes: '' });
  state.workoutSchedule[dayName] = { ...data, exercises };
  renderScheduleEditor();
  
  const rows = $("schedExerciseList").querySelectorAll('.sched-exercise-row');
  if (rows.length > 0) {
    rows[rows.length - 1].querySelector('input').focus();
  }
}

async function saveScheduleDay() {
  if (!state.user) return;
  const dayName = getSelectedScheduleDay();
  
  const title = $("schedTitle").value.trim();
  const focus = $("schedFocus").value.trim();
  const restDay = $("schedRestDay").checked;
  
  const exerciseRows = $("schedExerciseList").querySelectorAll('.sched-exercise-row');
  const exercises = Array.from(exerciseRows).map(row => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    sets: row.querySelector('[data-field="sets"]').value.trim(),
    reps: row.querySelector('[data-field="reps"]').value.trim(),
    bodyPart: row.querySelector('[data-field="bodyPart"]').value.trim(),
    notes: row.querySelector('[data-field="notes"]')?.value.trim() || ''
  })).filter(ex => ex.name);
  
  const data = { title, focus, restDay, exercises };
  
  const ref = doc(db, "users", state.user.uid, "workoutSchedule", dayName);
  await setDoc(ref, data);
  state.workoutSchedule[dayName] = data;
  
  toast(`${dayName} schedule saved!`);
  renderScheduleEditor();
  renderWorkoutView();
}

document.addEventListener("DOMContentLoaded", init);

// === NUTRITION LABEL SCANNER (Tesseract.js OCR) ===

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
    stopCamera();
    $("cameraContainer").classList.add("hidden");
    $("fileInput").click();
  }
}

function stopCamera() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
  }
  const video = $("cameraVideo");
  video.srcObject = null;
}

function captureImage() {
  const video = $("cameraVideo");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);
  
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
    
    const result = await Tesseract.recognize(imageDataUrl, 'eng', {
      logger: m => { }
    });
    
    const text = result.data.text;
    console.log("OCR Result:", text);
    
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
      showScanError("Could not detect nutrition values. Try taking a clearer photo with good lighting.");
    }
  } catch (err) {
    console.error("Scan error:", err);
    showScanError(err.message || "Failed to analyze image. Please try again.");
  }
}

function parseNutritionLabel(text) {
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
  
  const patterns = {
    calories: [
      /calories[:\s]*(\d+)/i,
      /(\d+)\s*calories/i,
      /energy[:\s]*(\d+)\s*kcal/i,
      /kcal[:\s]*(\d+)/i,
      /(\d+)\s*kcal/i,
      /cal[:\s]*(\d+)/i
    ],
    protein: [
      /protein[:\s]*(\d+\.?\d*)\s*g/i,
      /(\d+\.?\d*)\s*g\s*protein/i,
      /protein[:\s]*(\d+)/i,
      /prot[:\s]*(\d+\.?\d*)/i
    ],
    carbs: [
      /total\s*carb[a-z]*[:\s]*(\d+\.?\d*)\s*g/i,
      /carb[a-z]*[:\s]*(\d+\.?\d*)\s*g/i,
      /(\d+\.?\d*)\s*g\s*carb/i,
      /carb[a-z]*[:\s]*(\d+)/i,
      /glucides[:\s]*(\d+\.?\d*)/i
    ],
    fat: [
      /total\s*fat[:\s]*(\d+\.?\d*)\s*g/i,
      /(?<!trans\s)(?<!saturated\s)fat[:\s]*(\d+\.?\d*)\s*g/i,
      /(\d+\.?\d*)\s*g\s*(?:total\s*)?fat/i,
      /lipides[:\s]*(\d+\.?\d*)/i,
      /^fat[:\s]*(\d+)/im
    ]
  };
  
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
  
  if (!result.calories && (result.protein || result.carbs || result.fat)) {
    const estimatedCal = (result.protein || 0) * 4 + (result.carbs || 0) * 4 + (result.fat || 0) * 9;
    if (estimatedCal > 0) {
      result.calories = Math.round(estimatedCal);
    }
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

function closeScanner() {
  stopCamera();
  $("scannerModal").close();
}

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

$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      $("cameraContainer").classList.add("hidden");
      $("previewContainer").classList.remove("hidden");
      processImage(event.target.result);
    };
    reader.readAsDataURL(file);
  }
  e.target.value = "";
});

$("scannerModal").addEventListener("click", (e) => {
  if (e.target === $("scannerModal")) {
    closeScanner();
  }
});

$("scannerModal").addEventListener("close", () => {
  stopCamera();
});
