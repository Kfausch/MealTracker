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
// PASTE YOUR FIREBASE CONFIG HERE (Use the one from your screenshot)
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
  library: [], // Unified list of foods from DB
  targets: { calories: 1800, protein: 180, carbs: 200, fat: 65 },
  unsubscribeLog: null,
  unsubscribeLib: null
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
    state.library = [];
    if (state.unsubscribeLog) state.unsubscribeLog();
    if (state.unsubscribeLib) state.unsubscribeLib();
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
  // 1. Load User Targets
  const settingsRef = doc(db, "users", uid, "data", "settings");
  try {
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      state.targets = { ...state.targets, ...snap.data() };
    }
    updateTargetInputs();
  } catch(e) { console.error(e); }

  // 2. Realtime Listener for FOOD LIBRARY (The "Meals")
  const libRef = collection(db, "users", uid, "meals");
  const qLib = query(libRef, orderBy("name"));
  
  state.unsubscribeLib = onSnapshot(qLib, (snapshot) => {
    state.library = [];
    snapshot.forEach((doc) => {
      state.library.push({ id: doc.id, ...doc.data() });
    });
    buildDropdown($("mealSearch").value);
  });

  // 3. Realtime Listener for DAILY LOGS
  const logRef = collection(db, "users", uid, "logs");
  const qLog = query(logRef, orderBy("createdAt", "desc"));
  
  $("logLoader").style.display = "block";
  state.unsubscribeLog = onSnapshot(qLog, (snapshot) => {
    state.log = [];
    snapshot.forEach((doc) => {
      state.log.push({ id: doc.id, ...doc.data() });
    });
    $("logLoader").style.display = "none";
    render(); 
  });
}

// ---- LOGIC ----

// Save Targets
async function saveTargets() {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "data", "settings");
  await setDoc(ref, state.targets, { merge: true });
}

// IMPORT DEFAULTS (Batch Write)
async function importDefaults() {
  if (!state.user) return;
  const btn = $("btnImportDefaults");
  const status = $("importStatus");
  btn.disabled = true;
  status.textContent = "Loading JSON...";

  try {
    // Fetch local JSON file
    const res = await fetch("meals.json");
    const defaults = await res.json();
    
    status.textContent = "Uploading to Database...";
    const batch = writeBatch(db);
    const collectionRef = collection(db, "users", state.user.uid, "meals");

    // Loop through JSON and queue writes
    Object.entries(defaults).forEach(([name, macros]) => {
      const newDoc = doc(collectionRef); // Generate auto-ID
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
    status.textContent = "Success! Default meals added.";
    toast(`Imported ${Object.keys(defaults).length} meals`);
    
  } catch (e) {
    console.error(e);
    status.textContent = "Error importing: " + e.message;
  } finally {
    btn.disabled = false;
  }
}

// Add Entry (To Day Log)
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
    base: { ...macros } 
  };
  
  try {
    await addDoc(collection(db, "users", state.user.uid, "logs"), entry);
    toast(`Added: ${name}`);
  } catch (e) {
    toast("Error adding entry");
  }
}

// Save New Meal (To Library)
async function saveToLibrary(name, macros) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, "users", state.user.uid, "meals"), {
      name: name,
      ...macros
    });
    toast(`Saved to Library: ${name}`);
  } catch (e) {
    toast("Error saving to library");
  }
}

async function deleteEntry(id) {
  if (!state.user) return;
  if(!confirm("Remove this item?")) return;
  await deleteDoc(doc(db, "users", state.user.uid, "logs", id));
}

// ---- UI RENDERING ----

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
  
  // FILTER THE LIBRARY FROM DB
  const matches = state.library.filter(m => m.name.toLowerCase().includes(term));

  matches.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.id; // Store ID as value for lookup
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
}

// ---- INIT ----

async function init() {
  const savedTheme = localStorage.getItem("mt_theme"); 
  if(savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

  onAuthStateChanged(auth, (user) => updateAuthUI(user));

  $("mealSearch").addEventListener("input", (e) => buildDropdown(e.target.value));
  
  // ADD FROM LIBRARY
  $("addMealBtn").onclick = () => {
    const id = $("mealDropdown").value;
    const item = state.library.find(x => x.id === id);
    if (item) addEntry(item.name, item, "db", $("mealServings").value);
  };
  
  // ADD MANUAL
  $("addManualBtn").onclick = () => {
    const macros = {
      calories: $("manualCalories").value, protein: $("manualProtein").value,
      carbs: $("manualCarbs").value, fat: $("manualFat").value
    };
    addEntry($("manualName").value || "Manual", macros, "manual", $("manualServings").value);
  };

  // SAVE MANUAL TO LIBRARY
  $("addSaveManualBtn").onclick = async () => {
    const name = $("manualName").value.trim();
    if (!name) return toast("Name required");
    const macros = {
      calories: num($("manualCalories").value), protein: num($("manualProtein").value),
      carbs: num($("manualCarbs").value), fat: num($("manualFat").value)
    };
    
    await saveToLibrary(name, macros);
    await addEntry(name, macros, "manual", $("manualServings").value);
  };

  $("btnImportDefaults").onclick = importDefaults;

  $("prevDateBtn").onclick = () => { state.currentDate.setDate(state.currentDate.getDate() - 1); render(); };
  $("nextDateBtn").onclick = () => { state.currentDate.setDate(state.currentDate.getDate() + 1); render(); };

  $("themeToggle").onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mt_theme", next);
  };

  ["targetCalories","targetProtein","targetCarbs","targetFat"].forEach(id => {
    $(id).addEventListener("change", () => {
      state.targets[id.replace("target","").toLowerCase()] = num($(id).value);
      render();
      saveTargets();
    });
  });

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


