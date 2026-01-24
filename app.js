
/* Meal Tracker (static / no backend)
   - Loads base meals from meals.json
   - Stores targets, current log, and saved manual meals in localStorage
*/

const STORAGE = {
  TARGETS: "mealTracker.targets.v1",
  MANUAL_MEALS: "mealTracker.manualMeals.v1",
  LOG: "mealTracker.log.v1",
  THEME: "mealTracker.theme.v1"
};

const $ = (id) => document.getElementById(id);

let mealsFromFile = {};
let manualMeals = {};
let allMeals = {};
let logItems = [];

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function num(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmt(n, digits = 1) {
  const x = num(n);
  if (!Number.isFinite(x)) return "0";
  const rounded = Math.round(x);
  if (Math.abs(x - rounded) < 1e-9) return String(rounded);
  const fixed = x.toFixed(digits);
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => el.classList.remove("show"), 1800);
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

function getTargets() {
  return {
    calories: num($("targetCalories").value),
    protein: num($("targetProtein").value),
    carbs: num($("targetCarbs").value),
    fat: num($("targetFat").value)
  };
}

function setTargets(values) {
  $("targetCalories").value = values.calories ?? 1800;
  $("targetProtein").value = values.protein ?? 180;
  $("targetCarbs").value = values.carbs ?? 160;
  $("targetFat").value = values.fat ?? 50;
}

function loadTargets() {
  const saved = readJSON(STORAGE.TARGETS, null);
  if (saved) setTargets(saved);
  ["targetCalories","targetProtein","targetCarbs","targetFat"].forEach((id) => {
    $(id).addEventListener("input", () => {
      writeJSON(STORAGE.TARGETS, getTargets());
      updateStats();
    });
  });
}

function mergeMeals() {
  // Saved manual meals override file meals if names collide (intentional).
  allMeals = { ...mealsFromFile, ...manualMeals };
}

function buildMealDropdown(filterText = "") {
  const select = $("mealDropdown");
  const filter = filterText.trim().toLowerCase();

  const match = (name) => !filter || name.toLowerCase().includes(filter);

  const savedNames = Object.keys(manualMeals).filter(match).sort((a,b)=>a.localeCompare(b));
  const fileNames = Object.keys(mealsFromFile).filter((n) => !manualMeals[n]).filter(match).sort((a,b)=>a.localeCompare(b));

  select.innerHTML = "";

  const makeGroup = (label, names) => {
    if (!names.length) return;
    const og = document.createElement("optgroup");
    og.label = label;
    names.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      og.appendChild(opt);
    });
    select.appendChild(og);
  };

  makeGroup("Saved", savedNames);
  makeGroup("Meals", fileNames);

  if (!select.options.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No matches";
    select.appendChild(opt);
  }
}

function computeTotals() {
  return logItems.reduce(
    (acc, it) => {
      acc.calories += num(it.calories);
      acc.protein += num(it.protein);
      acc.carbs += num(it.carbs);
      acc.fat += num(it.fat);
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function setStat(statId, barId, progId, remId, total, target, label, unit = "") {
  const totalNum = num(total);
  const targetNum = num(target);

  $(statId).textContent = `${fmt(totalNum)}${unit}`;

  const percent = targetNum > 0 ? (totalNum / targetNum) * 100 : 0;
  const capped = clamp(percent, 0, 140); // allow showing overage a bit
  $(barId).style.width = `${capped}%`;

  const prog = $(progId);
  if (targetNum > 0 && totalNum > targetNum) prog.classList.add("over");
  else prog.classList.remove("over");

  const remaining = targetNum - totalNum;
  const remText = targetNum > 0
    ? (remaining >= 0 ? `Remaining: ${fmt(remaining)}${unit}` : `Over: ${fmt(Math.abs(remaining))}${unit}`)
    : "Set a target to track remaining";
  $(remId).textContent = remText;

  // a11y
  prog.setAttribute("aria-label", `${label} progress`);
  prog.setAttribute("aria-valuenow", String(Math.round(percent)));
  prog.setAttribute("aria-valuemin", "0");
  prog.setAttribute("aria-valuemax", "100");
}

function updateStats() {
  const totals = computeTotals();
  const targets = getTargets();

  setStat("statCalories", "barCalories", "progCalories", "remCalories", totals.calories, targets.calories, "Calories");
  setStat("statProtein", "barProtein", "progProtein", "remProtein", totals.protein, targets.protein, "Protein", "g");
  setStat("statCarbs", "barCarbs", "progCarbs", "remCarbs", totals.carbs, targets.carbs, "Carbs", "g");
  setStat("statFat", "barFat", "progFat", "remFat", totals.fat, targets.fat, "Fat", "g");

  const badge = $("mealCountBadge");
  const n = logItems.length;
  badge.textContent = `${n} item${n === 1 ? "" : "s"}`;
}

function renderLog() {
  const host = $("selectedMeals");
  host.innerHTML = "";
  $("emptyLog").style.display = logItems.length ? "none" : "block";

  const frag = document.createDocumentFragment();

  logItems.forEach((it) => {
    const wrap = document.createElement("div");
    wrap.className = "log-item";

    const top = document.createElement("div");
    top.className = "log-item-top";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "log-title";
    title.textContent = it.name;

    const meta = document.createElement("div");
    meta.className = "log-meta";
    const src = it.source === "saved" ? "Saved" : (it.source === "manual" ? "Manual" : "Meal");
    const servingsText = it.servings && num(it.servings) !== 1 ? ` • ${fmt(it.servings)} serving(s)` : "";
    meta.textContent = `${src}${servingsText}`;

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const btnRemove = document.createElement("button");
    btnRemove.className = "icon-btn";
    btnRemove.type = "button";
    btnRemove.title = "Remove";
    btnRemove.innerHTML = "✕";
    btnRemove.addEventListener("click", () => {
      removeLogItem(it.id);
    });

    actions.appendChild(btnRemove);

    top.appendChild(left);
    top.appendChild(actions);

    const chips = document.createElement("div");
    chips.className = "macro-chips";

    const cal = num(it.calories);
    const pro = num(it.protein);
    const ppc = cal > 0 ? pro / cal : 0;

    chips.appendChild(makeChip(`Cal ${fmt(cal)}`));
    chips.appendChild(makeChip(`P ${fmt(pro)}g`));
    chips.appendChild(makeChip(`C ${fmt(it.carbs)}g`));
    chips.appendChild(makeChip(`PPC ${fmt(ppc, 3)}`, "Protein per calorie (protein ÷ calories)"));

    wrap.appendChild(top);
    wrap.appendChild(chips);
    frag.appendChild(wrap);
  });

  host.appendChild(frag);
  updateStats();
}

function makeChip(text, title) {
  const el = document.createElement("div");
  el.className = "chip";
  el.textContent = text;
  if (title) el.title = title;
  return el;
}

function saveLog() {
  writeJSON(STORAGE.LOG, {
    items: logItems,
    savedAt: new Date().toISOString()
  });
}

function loadLog() {
  const saved = readJSON(STORAGE.LOG, null);
  if (!saved || !Array.isArray(saved.items)) return;

  // sanitize items
  logItems = saved.items
    .filter((x) => x && typeof x.name === "string")
    .map((x) => ({
      id: String(x.id ?? uuid()),
      name: String(x.name),
      source: String(x.source ?? "meal"),
      servings: num(x.servings || 1) || 1,
      calories: num(x.calories),
      protein: num(x.protein),
      carbs: num(x.carbs),
      fat: num(x.fat)
    }));
}

function addLogItem(name, macros, source, servings) {
  const s = num(servings) || 1;
  const item = {
    id: uuid(),
    name: String(name),
    source,
    servings: s,
    calories: num(macros.calories) * s,
    protein: num(macros.protein) * s,
    carbs: num(macros.carbs) * s,
    fat: num(macros.fat) * s
  };

  logItems.unshift(item); // newest first
  saveLog();
  renderLog();
  toast(`Added: ${item.name}`);
}

function removeLogItem(id) {
  const before = logItems.length;
  logItems = logItems.filter((x) => x.id !== id);
  if (logItems.length !== before) {
    saveLog();
    renderLog();
    toast("Removed item");
  }
}

function clearLog() {
  logItems = [];
  saveLog();
  renderLog();
  toast("Cleared log");
}

function validateMealObject(obj) {
  if (!obj || typeof obj !== "object") return false;
  const keys = ["calories","protein","carbs","fat"];
  return keys.every((k) => Number.isFinite(num(obj[k])));
}

function saveManualMealToLibrary(name, macros) {
  const n = String(name).trim();
  if (!n) return false;
  if (!validateMealObject(macros)) return false;

  manualMeals[n] = {
    calories: num(macros.calories),
    protein: num(macros.protein),
    carbs: num(macros.carbs),
    fat: num(macros.fat)
  };

  writeJSON(STORAGE.MANUAL_MEALS, manualMeals);
  mergeMeals();
  buildMealDropdown($("mealSearch").value);
  renderSavedMeals();
  return true;
}

function deleteManualMeal(name) {
  const n = String(name);
  if (!manualMeals[n]) return;
  delete manualMeals[n];
  writeJSON(STORAGE.MANUAL_MEALS, manualMeals);
  mergeMeals();
  buildMealDropdown($("mealSearch").value);
  renderSavedMeals();
  toast(`Deleted: ${n}`);
}

function renderSavedMeals() {
  const host = $("savedMealsList");
  host.innerHTML = "";

  const names = Object.keys(manualMeals).sort((a,b)=>a.localeCompare(b));
  $("noSavedMeals").style.display = names.length ? "none" : "block";

  names.forEach((name) => {
    const m = manualMeals[name];
    const wrap = document.createElement("div");
    wrap.className = "log-item";

    const top = document.createElement("div");
    top.className = "log-item-top";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "log-title";
    title.textContent = name;

    const meta = document.createElement("div");
    meta.className = "log-meta";
    meta.textContent = "Saved manual meal";

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn btn-primary";
    btnAdd.type = "button";
    btnAdd.textContent = "Add";
    btnAdd.addEventListener("click", () => addLogItem(name, m, "saved", 1));

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn";
    btnEdit.type = "button";
    btnEdit.textContent = "Edit";
    btnEdit.addEventListener("click", () => {
      $("manualName").value = name;
      $("manualCalories").value = fmt(m.calories);
      $("manualProtein").value = fmt(m.protein);
      $("manualCarbs").value = fmt(m.carbs);
      $("manualFat").value = fmt(m.fat);
      $("manualServings").value = 1;
      $("manualName").focus();
      toast("Loaded into manual entry");
    });

    const btnDel = document.createElement("button");
    btnDel.className = "btn btn-danger";
    btnDel.type = "button";
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", () => {
      if (confirm(`Delete saved meal: \"${name}\"?`)) deleteManualMeal(name);
    });

    actions.appendChild(btnAdd);
    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);

    top.appendChild(left);
    top.appendChild(actions);

    const chips = document.createElement("div");
    chips.className = "macro-chips";
    chips.appendChild(makeChip(`Cal ${fmt(m.calories)}`));
    chips.appendChild(makeChip(`P ${fmt(m.protein)}g`));
    chips.appendChild(makeChip(`C ${fmt(m.carbs)}g`));
    chips.appendChild(makeChip(`F ${fmt(m.fat)}g`));

    wrap.appendChild(top);
    wrap.appendChild(chips);
    host.appendChild(wrap);
  });
}

function clearManualForm() {
  $("manualName").value = "";
  $("manualCalories").value = "";
  $("manualProtein").value = "";
  $("manualCarbs").value = "";
  $("manualFat").value = "";
  $("manualServings").value = 1;
}

function readManualForm() {
  const name = String($("manualName").value || "").trim();
  const servings = num($("manualServings").value) || 1;
  const macros = {
    calories: num($("manualCalories").value),
    protein: num($("manualProtein").value),
    carbs: num($("manualCarbs").value),
    fat: num($("manualFat").value)
  };
  return { name, servings, macros };
}

function hookUI() {
  $("addMealBtn").addEventListener("click", () => {
    const name = $("mealDropdown").value;
    const servings = num($("mealServings").value) || 1;
    if (!name || !allMeals[name]) {
      toast("Pick a meal first");
      return;
    }
    addLogItem(name, allMeals[name], manualMeals[name] ? "saved" : "meal", servings);
  });

  $("mealSearch").addEventListener("input", (e) => {
    buildMealDropdown(e.target.value);
  });

  $("mealServings").addEventListener("input", () => {
    const v = num($("mealServings").value);
    if (v <= 0) $("mealServings").value = 1;
  });

  $("addManualBtn").addEventListener("click", () => {
    const { name, servings, macros } = readManualForm();
    if (!name) return toast("Manual name is required");
    if (!validateMealObject(macros)) return toast("Enter calories, protein, carbs, and fat");
    addLogItem(`${name} (Manual)`, macros, "manual", servings);
    clearManualForm();
  });

  $("saveManualBtn").addEventListener("click", () => {
    const { name, macros } = readManualForm();
    if (!name) return toast("Manual name is required");
    if (!validateMealObject(macros)) return toast("Enter calories, protein, carbs, and fat");
    const ok = saveManualMealToLibrary(name, macros);
    if (ok) {
      toast(`Saved: ${name}`);
    } else {
      toast("Couldn't save meal");
    }
  });

  $("addSaveManualBtn").addEventListener("click", () => {
    const { name, servings, macros } = readManualForm();
    if (!name) return toast("Manual name is required");
    if (!validateMealObject(macros)) return toast("Enter calories, protein, carbs, and fat");
    const ok = saveManualMealToLibrary(name, macros);
    if (ok) {
      addLogItem(name, macros, "saved", servings);
      clearManualForm();
      toast(`Added & saved: ${name}`);
    } else {
      toast("Couldn't add & save");
    }
  });

  // Enter key adds manual meal (without saving)
  $("manualForm").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("addManualBtn").click();
    }
  });

  $("clearLogBtn").addEventListener("click", () => {
    if (!logItems.length) return toast("Nothing to clear");
    if (confirm("Clear today's log?")) clearLog();
  });

  // Export/import saved meals
  $("exportSavedBtn").addEventListener("click", () => {
    const payload = { version: 1, savedMeals: manualMeals };
    downloadJSON(payload, "saved-meals.json");
  });

  $("importSavedBtn").addEventListener("click", () => $("importFile").click());

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming = data.savedMeals || data; // allow raw object too
      if (!incoming || typeof incoming !== "object") throw new Error("Bad format");
      let added = 0;
      Object.entries(incoming).forEach(([name, macros]) => {
        if (String(name).trim() && validateMealObject(macros)) {
          manualMeals[String(name).trim()] = {
            calories: num(macros.calories),
            protein: num(macros.protein),
            carbs: num(macros.carbs),
            fat: num(macros.fat)
          };
          added++;
        }
      });
      writeJSON(STORAGE.MANUAL_MEALS, manualMeals);
      mergeMeals();
      buildMealDropdown($("mealSearch").value);
      renderSavedMeals();
      toast(`Imported ${added} meal(s)`);
    } catch {
      toast("Import failed (invalid JSON)");
    }
  });

  // Export/import log
  $("exportLogBtn").addEventListener("click", () => {
    const payload = { version: 1, targets: getTargets(), items: logItems };
    downloadJSON(payload, "meal-log.json");
  });

  $("importLogBtn").addEventListener("click", () => $("importLogFile").click());

  $("importLogFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.targets) setTargets(data.targets);
      writeJSON(STORAGE.TARGETS, getTargets());

      if (Array.isArray(data.items)) {
        logItems = data.items
          .filter((x) => x && typeof x.name === "string")
          .map((x) => ({
            id: String(x.id ?? uuid()),
            name: String(x.name),
            source: String(x.source ?? "meal"),
            servings: num(x.servings || 1) || 1,
            calories: num(x.calories),
            protein: num(x.protein),
            carbs: num(x.carbs),
            fat: num(x.fat)
          }));
        saveLog();
        renderLog();
        toast(`Imported ${logItems.length} item(s)`);
      } else {
        toast("No items found in log");
      }
    } catch {
      toast("Import failed (invalid JSON)");
    }
  });

  // Theme toggle
  $("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(current === "dark" ? "light" : "dark");
  });
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE.THEME, theme);
}

function loadTheme() {
  const saved = localStorage.getItem(STORAGE.THEME);
  if (saved === "light" || saved === "dark") setTheme(saved);
  else setTheme(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}

async function init() {
  loadTheme();
  loadTargets();

  manualMeals = readJSON(STORAGE.MANUAL_MEALS, {}) || {};
  loadLog();
  renderLog();

  hookUI();

  try {
    const res = await fetch("meals.json", { cache: "no-store" });
    mealsFromFile = await res.json();
  } catch {
    mealsFromFile = {};
    toast("Couldn't load meals.json");
  }

  mergeMeals();
  buildMealDropdown("");
  renderSavedMeals();
  updateStats();
}

document.addEventListener("DOMContentLoaded", init);
