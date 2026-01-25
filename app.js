// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, 
  query, where, orderBy, onSnapshot, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
// TODO: PASTE YOUR FIREBASE CONFIG HERE
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
  user: null, // Logged in user
  currentDate: new Date(),
  log: [],          
  manualMeals: {},  
  mealsFromFile: {},
  targets: { calories: 1800, protein: 180, carbs: 200, fat: 65 },
  unsubscribeLog: null // To stop listening when logging out
};

// DOM Elements
const $ = (id) => document.getElementById(id);
const num = (v) => parseFloat(v) || 0;
const fmt = (v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
const toISODate = (d) => d.toISOString().split('T')[0];

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
    $("userEmailDisplay").textContent = user.email;
    initUserData(user.uid);
  } else {
    $("authOverlay").classList.remove("hidden");
    $("appContainer").classList.remove("active");
    $("userEmailDisplay").textContent = "";
    // Clear data
    state.log = [];
    state.manualMeals = {};
    if (state.unsubscribeLog) state.unsubscribeLog();
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
  // 1. Load User Settings (Targets)
  const settingsRef = doc(db, "users", uid, "data", "settings");
  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      state.targets = { ...state.targets, ...snap.data() };
    }
    updateTargetInputs();
  } catch(e) { console.error(e); }

  // 2. Load Manual Meals (Saved items)
  const manualRef = doc(db, "users", uid, "data", "manual_meals");
  try {
    const snap = await getDoc(manualRef);
    if (snap.exists()) {
      state.manualMeals = snap.data();
    }
    buildDropdown(); // Refresh dropdown with saved meals
  } catch(e) { console.error(e); }

  // 3. Realtime Listener for Daily Logs
  const logRef = collection(db, "users", uid, "logs");
  // We grab ALL history for analytics, but we could limit this for performance later
  const q = query(logRef, orderBy("createdAt", "desc"));
  
  $("logLoader").style.display = "block";
  
  state.unsubscribeLog = onSnapshot(q, (snapshot) => {
    state.log = [];
    snapshot.forEach((doc) => {
      state.log.push({ id: doc.id, ...doc.data() });
    });
    $("logLoader").style.display = "none";
    render(); // Re-render whenever DB changes
  });
}

// ---- LOGIC ----

// Save Targets to DB
async function saveTargets() {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "data", "settings");
  await setDoc(ref, state.targets, { merge: true });
}

// Save Manual Meal Library to DB
async function saveManualMeals() {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "data", "manual_meals");
  await setDoc(ref, state.manualMeals);
}

// Add Entry -> Writes to Firestore
async function addEntry(name, macros, source, servings = 1) {
  if (!state.user) return;
  const s = num(servings);
  const entry = {
    date: toISODate(state.currentDate),
    createdAt: Date.now(),
    name: name,
    source: source,
    servings: s,
    calories: num(macros.calories) * s,
    protein: num(macros.protein) * s,
    carbs: num(macros.carbs) * s,
    fat: num(macros.fat) * s,
    base: { ...macros } // Store base for editing
  };
  
  try {
    await addDoc(collection(db, "users", state.user.uid, "logs"), entry);
    toast(`Added: ${name}`);
  } catch (e) {
    toast("Error adding entry");
    console.error(e);
  }
}

// Update Entry -> Writes to Firestore
async function updateEntryInDB(id, data) {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "logs", id);
  await updateDoc(ref, data);
  toast("Updated");
}

// Delete Entry -> Deletes from Firestore
async function deleteEntry(id) {
  if (!state.user) return;
  if(!confirm("Remove this item?")) return;
  await deleteDoc(doc(db, "users", state.user.uid, "logs", id));
}

// ---- UI RENDERING (Similar to before, but simplified) ----

function getDayLog() {
  const dateStr = toISODate(state.currentDate);
  return state.log.filter(i => i.date === dateStr);
}

function updateDateDisplay() {
  const now = new Date();
  const d = state.currentDate;
  const isToday = d.toDateString() === now.toDateString();
  const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === d.toDateString();
  
  $("dateLabel").textContent = isToday ? "Today" : (isYesterday ? "Yesterday" : d.toLocaleDateString());
  $("dateSub").textContent = toISODate(d);
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
    
    // PPC Calc
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
        <button class="btn-ghost edit-trigger" style="font-size:1.2rem;">✎</button>
        <button class="btn-ghost delete-trigger" style="color:var(--danger);">✕</button>
      </div>
    `;
    
    el.querySelector(".edit-trigger").onclick = () => openEditModal(item);
    el.querySelector(".delete-trigger").onclick = (e) => {
      e.stopPropagation(); 
      deleteEntry(item.id);
    };
    list.appendChild(el);
  });

  updateStats(dayLog);
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
  const fPct = totalGrams ? (totals.f / totalGrams) * 100 : 0;
  
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

// ---- DROPDOWN & INPUTS ----

function buildDropdown(filter = "") {
  const sel = $("mealDropdown");
  sel.innerHTML = "";
  const term = filter.toLowerCase();
  const all = { ...state.mealsFromFile, ...state.manualMeals };
  const matches = Object.keys(all).filter(k => k.toLowerCase().includes(term)).sort();

  matches.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
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
}

// ---- EDIT MODAL ----
let editingId = null;
function openEditModal(item) {
  editingId = item.id;
  $("editName").value = item.name;
  $("editServings").value = item.servings;
  $("editCalories").value = Math.round(item.calories);
  $("editP").value = item.protein;
  $("editC").value = item.carbs;
  $("editF").value = item.fat;
  $("editModal").showModal();
}

$("saveEditBtn").onclick = async () => {
  if (!editingId) return;
  const newSrv = num($("editServings").value);
  await updateEntryInDB(editingId, {
    name: $("editName").value,
    servings: newSrv,
    calories: num($("editCalories").value),
    protein: num($("editP").value),
    carbs: num($("editC").value),
    fat: num($("editF").value)
  });
  $("editModal").close();
};

$("closeEditBtn").onclick = () => $("editModal").close();


// ---- INIT ----

async function init() {
  // Check System Theme
  const savedTheme = localStorage.getItem("mt_theme"); 
  if(savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

  // Load JSON file
  try {
    const res = await fetch("meals.json");
    state.mealsFromFile = await res.json();
  } catch (e) { console.warn("meals.json not found"); }

  // Listen for Auth Changes
  onAuthStateChanged(auth, (user) => updateAuthUI(user));

  // Event Listeners
  $("mealSearch").addEventListener("input", (e) => buildDropdown(e.target.value));
  $("addMealBtn").onclick = () => {
    const name = $("mealDropdown").value;
    const all = { ...state.mealsFromFile, ...state.manualMeals };
    if (all[name]) addEntry(name, all[name], "db", $("mealServings").value);
  };
  
  $("addManualBtn").onclick = () => {
    const macros = {
      calories: $("manualCalories").value, protein: $("manualProtein").value,
      carbs: $("manualCarbs").value, fat: $("manualFat").value
    };
    addEntry($("manualName").value || "Manual", macros, "manual", $("manualServings").value);
  };

  $("addSaveManualBtn").onclick = async () => {
    const name = $("manualName").value.trim();
    if (!name) return toast("Name required");
    const macros = {
      calories: num($("manualCalories").value), protein: num($("manualProtein").value),
      carbs: num($("manualCarbs").value), fat: num($("manualFat").value)
    };
    // Update local state temporarily for speed, then sync
    state.manualMeals[name] = macros; 
    await saveManualMeals();
    await addEntry(name, macros, "manual", $("manualServings").value);
    buildDropdown($("mealSearch").value);
  };

  $("prevDateBtn").onclick = () => { state.currentDate.setDate(state.currentDate.getDate() - 1); render(); };
  $("nextDateBtn").onclick = () => { state.currentDate.setDate(state.currentDate.getDate() + 1); render(); };

  $("themeToggle").onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mt_theme", next);
  };

  // Auto-save targets on change (debounced slightly by nature of event)
  ["targetCalories","targetProtein","targetCarbs","targetFat"].forEach(id => {
    $(id).addEventListener("change", () => {
      state.targets[id.replace("target","").toLowerCase()] = num($(id).value);
      render();
      saveTargets();
    });
  });

  // Tabs
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
