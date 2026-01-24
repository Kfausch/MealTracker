/* Meal Tracker Pro
   - History enabled (keyed by YYYY-MM-DD)
   - Analytics and Recents
*/

const STORAGE = {
  TARGETS: "mt_targets_v2",
  MANUAL: "mt_manual_v2",
  LOG: "mt_log_v2",
  THEME: "mt_theme_v2"
};

const $ = (id) => document.getElementById(id);

// STATE
let state = {
  currentDate: new Date(), // Date object
  log: [],                 // Array of all items with .date property
  manualMeals: {},         // Saved templates
  mealsFromFile: {},       // JSON file data
  targets: { calories: 2000, protein: 150, carbs: 200, fat: 65 }
};

// UTILS
const num = (v) => parseFloat(v) || 0;
const fmt = (v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
const uuid = () => Date.now().toString(36) + Math.random().toString(36).substr(2);
const toISODate = (d) => d.toISOString().split('T')[0];

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}

// ---- DATA LAYER ----

function loadData() {
  // Theme
  const th = localStorage.getItem(STORAGE.THEME) || "dark";
  document.documentElement.setAttribute("data-theme", th);

  // Targets
  const savedTargets = JSON.parse(localStorage.getItem(STORAGE.TARGETS));
  if (savedTargets) state.targets = { ...state.targets, ...savedTargets };
  $("targetCalories").value = state.targets.calories;
  $("targetProtein").value = state.targets.protein;
  $("targetCarbs").value = state.targets.carbs;
  $("targetFat").value = state.targets.fat;

  // Manual Meals
  state.manualMeals = JSON.parse(localStorage.getItem(STORAGE.MANUAL)) || {};

  // Log & Migration
  const rawLog = JSON.parse(localStorage.getItem(STORAGE.LOG));
  if (rawLog && Array.isArray(rawLog.items)) {
    // Migrate v1 data (no date) to today
    const todayStr = toISODate(new Date());
    state.log = rawLog.items.map(item => ({
      ...item,
      date: item.date || todayStr // Backfill date if missing
    }));
  } else if (Array.isArray(rawLog)) {
    state.log = rawLog; // v2 format
  } else {
    state.log = [];
  }
}

function saveData() {
  localStorage.setItem(STORAGE.LOG, JSON.stringify(state.log));
  localStorage.setItem(STORAGE.MANUAL, JSON.stringify(state.manualMeals));
  localStorage.setItem(STORAGE.TARGETS, JSON.stringify(state.targets));
}

// ---- LOGIC ----

function getDayLog() {
  const dateStr = toISODate(state.currentDate);
  return state.log.filter(i => i.date === dateStr);
}

function addEntry(name, macros, source, servings = 1) {
  const entry = {
    id: uuid(),
    date: toISODate(state.currentDate),
    name: name,
    source: source, // 'db', 'manual', 'recent'
    servings: num(servings),
    calories: num(macros.calories) * num(servings),
    protein: num(macros.protein) * num(servings),
    carbs: num(macros.carbs) * num(servings),
    fat: num(macros.fat) * num(servings),
    base: { ...macros } // Store base macros for editing scaling
  };
  state.log.unshift(entry);
  saveData();
  render();
  toast(`Added: ${name}`);
}

function updateEntry(id, newVals) {
  const idx = state.log.findIndex(x => x.id === id);
  if (idx === -1) return;
  state.log[idx] = { ...state.log[idx], ...newVals };
  saveData();
  render();
  toast("Entry updated");
}

function deleteEntry(id) {
  state.log = state.log.filter(x => x.id !== id);
  saveData();
  render();
}

// ---- UI RENDERING ----

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
  
  // Find unique meal names from history, sorted by usage recency
  const map = new Map();
  state.log.forEach(item => {
    if (!map.has(item.name) && item.base) {
      map.set(item.name, item.base);
    }
  });

  const recents = Array.from(map.entries()).slice(0, 12); // Last 12 unique items

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
    el.innerHTML = `
      <div class="log-info">
        <h4>${item.name}</h4>
        <div class="log-sub">${fmt(item.servings)} srv • ${Math.round(item.calories)} kcal</div>
        <div class="log-macros">
          <span class="macro-p">P: ${fmt(item.protein)}</span>
          <span class="macro-c">C: ${fmt(item.carbs)}</span>
          <span class="macro-f">F: ${fmt(item.fat)}</span>
        </div>
      </div>
      <button class="btn-ghost" style="font-size:1.2rem;">&rsaquo;</button>
    `;
    el.onclick = () => openEditModal(item);
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

  // Update Donut Chart
  const totalGrams = totals.p + totals.c + totals.f;
  const pPct = totalGrams ? (totals.p / totalGrams) * 100 : 0;
  const cPct = totalGrams ? (totals.c / totalGrams) * 100 : 0;
  const fPct = totalGrams ? (totals.f / totalGrams) * 100 : 0;

  // CSS Conic Gradient logic
  // P starts at 0, ends at pPct
  // C starts at pPct, ends at pPct + cPct
  // F starts at pPct + cPct, ends at 100
  const cStart = pPct;
  const fStart = pPct + cPct;
  
  const chart = $("macroDonut");
  if (totalGrams > 0) {
    chart.style.background = `conic-gradient(
      var(--accent-p) 0% ${pPct}%,
      var(--accent-c) ${pPct}% ${fStart}%,
      var(--accent-f) ${fStart}% 100%
    )`;
  } else {
    chart.style.background = "var(--border)";
  }

  $("calDisplay").textContent = Math.round(totals.cal);
  $("dispP").textContent = `${Math.round(totals.p)}g`;
  $("dispC").textContent = `${Math.round(totals.c)}g`;
  $("dispF").textContent = `${Math.round(totals.f)}g`;

  // Update Bars
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
  } else {
      sel.selectedIndex = 0;
  }
}

// ---- MODAL ----
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

$("saveEditBtn").addEventListener("click", () => {
  if (!editingId) return;
  const newSrv = num($("editServings").value);
  
  // If user changed servos, we can auto-recalc from base if available, 
  // BUT if they manually edited macros, we trust the macro inputs.
  // For simplicity, we just save the exact macro inputs provided.
  updateEntry(editingId, {
    name: $("editName").value,
    servings: newSrv,
    calories: num($("editCalories").value),
    protein: num($("editP").value),
    carbs: num($("editC").value),
    fat: num($("editF").value)
  });
  $("editModal").close();
});

$("closeEditBtn").onclick = () => $("editModal").close();

// ---- INITIALIZATION & EVENTS ----

async function init() {
  loadData();
  
  // Load JSON
  try {
    const res = await fetch("meals.json");
    state.mealsFromFile = await res.json();
  } catch (e) { console.warn("No meals.json found"); }

  // Init UI
  buildDropdown();
  render();
  renderRecents();

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    });
  });

  // Events
  $("mealSearch").addEventListener("input", (e) => buildDropdown(e.target.value));
  
  $("addMealBtn").addEventListener("click", () => {
    const name = $("mealDropdown").value;
    const srv = $("mealServings").value;
    const all = { ...state.mealsFromFile, ...state.manualMeals };
    if (all[name]) addEntry(name, all[name], "db", srv);
  });

  $("addManualBtn").addEventListener("click", () => {
      const macros = {
          calories: $("manualCalories").value, protein: $("manualProtein").value,
          carbs: $("manualCarbs").value, fat: $("manualFat").value
      };
      addEntry($("manualName").value || "Manual Meal", macros, "manual", $("manualServings").value);
  });
  
  $("prevDateBtn").onclick = () => changeDate(-1);
  $("nextDateBtn").onclick = () => changeDate(1);
  $("themeToggle").onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(STORAGE.THEME, next);
  };
  
  $("clearDayBtn").onclick = () => {
      if(confirm("Clear this day?")) {
          const d = toISODate(state.currentDate);
          state.log = state.log.filter(x => x.date !== d);
          saveData();
          render();
      }
  };
  
  // Target inputs
  ["targetCalories","targetProtein","targetCarbs","targetFat"].forEach(id => {
      $(id).addEventListener("input", () => {
          state.targets[id.replace("target","").toLowerCase()] = num($(id).value);
          saveData();
          render();
      });
  });
}

function changeDate(delta) {
    state.currentDate.setDate(state.currentDate.getDate() + delta);
    render();
}

function render() {
    updateDateDisplay();
    renderLog();
    if(!$("tab-recent").classList.contains("hidden")) renderRecents();
}

document.addEventListener("DOMContentLoaded", init);