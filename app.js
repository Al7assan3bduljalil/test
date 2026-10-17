"use strict";

// ===== التخزين =====
const STORAGE_KEY = "homeManager.v1";

const CURRENCIES = {
  LYD: { label: "دينار ليبي (د.ل)", symbol: "د.ل", decimals: 3 },
  USD: { label: "دولار أمريكي ($)", symbol: "$", decimals: 2 },
};

const defaultState = () => ({
  settings: { currency: "LYD", monthlyBudget: 5000, city: "طرابلس", kwhPrice: 0.18 },
  members: [],
  tasks: [],
  shopping: [],
  expenses: [],
  bills: [],
  inventory: [],
  devices: [],
  cameras: [],
  deviceLog: [],
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeState(JSON.parse(raw));
  } catch (e) {
    console.warn("تعذر قراءة البيانات المحفوظة", e);
  }
  return defaultState();
}

// يدمج البيانات المحفوظة مع القيم الافتراضية حتى لا تنقص الحقول المضافة حديثًا
function mergeState(data) {
  const base = defaultState();
  const merged = { ...base, ...data, settings: { ...base.settings, ...data.settings } };
  if (!CURRENCIES[merged.settings.currency]) merged.settings.currency = base.settings.currency;
  return merged;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast("تعذر حفظ البيانات في المتصفح");
  }
}

// ===== أدوات مساعدة =====
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmtDate(new Date());
const currentMonth = () => today().slice(0, 7);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function money(n) {
  const num = Number(n) || 0;
  const cur = CURRENCIES[state.settings.currency] || CURRENCIES.LYD;
  return `${num.toLocaleString("ar-EG", { maximumFractionDigits: cur.decimals })} ${cur.symbol}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const ms = new Date(dateStr + "T00:00:00") - new Date(today() + "T00:00:00");
  return Math.round(ms / 86400000);
}

function dueBadge(dateStr, done) {
  if (!dateStr) return "";
  if (done) return `<span class="badge">${esc(dateStr)}</span>`;
  const d = daysUntil(dateStr);
  if (d < 0) return `<span class="badge overdue">متأخر ${-d} يوم</span>`;
  if (d === 0) return `<span class="badge soon">اليوم</span>`;
  if (d <= 3) return `<span class="badge soon">بعد ${d} يوم</span>`;
  return `<span class="badge">${esc(dateStr)}</span>`;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2500);
}

const memberOptions = () => [["", "— بدون —"], ...state.members.map((m) => [m.id, m.name])];
const memberName = (id) => state.members.find((m) => m.id === id)?.name || "—";

// ===== تعريف الكيانات =====
const PRIORITIES = [["high", "عالية"], ["medium", "متوسطة"], ["low", "منخفضة"]];
const EXPENSE_CATEGORIES = ["طعام", "فواتير", "مواصلات", "صحة", "تعليم", "ترفيه", "ملابس", "صيانة", "أخرى"];
const SHOPPING_CATEGORIES = ["خضار وفواكه", "لحوم", "ألبان", "مخبوزات", "منظفات", "مشروبات", "أخرى"];
const label = (pairs, key) => pairs.find(([k]) => k === key)?.[1] || key;

const ENTITIES = {
  members: {
    title: "فرد",
    fields: [
      { name: "name", label: "الاسم", type: "text", required: true },
      { name: "role", label: "الصفة (أب، أم، ابن...)", type: "text" },
      { name: "phone", label: "رقم الجوال", type: "tel" },
    ],
  },
  tasks: {
    title: "مهمة",
    fields: [
      { name: "title", label: "المهمة", type: "text", required: true },
      { name: "assignee", label: "مسندة إلى", type: "select", options: memberOptions },
      { name: "priority", label: "الأولوية", type: "select", options: () => PRIORITIES, default: "medium" },
      { name: "due", label: "تاريخ الاستحقاق", type: "date" },
      { name: "repeat", label: "التكرار", type: "select", options: () => [["", "مرة واحدة"], ["daily", "يومي"], ["weekly", "أسبوعي"], ["monthly", "شهري"]] },
      { name: "done", label: "منجزة", type: "checkbox" },
    ],
  },
  shopping: {
    title: "صنف",
    fields: [
      { name: "name", label: "الصنف", type: "text", required: true },
      { name: "qty", label: "الكمية", type: "text", default: "1" },
      { name: "category", label: "الفئة", type: "select", options: () => SHOPPING_CATEGORIES.map((c) => [c, c]), default: "أخرى" },
      { name: "price", label: "السعر التقديري", type: "number" },
      { name: "bought", label: "تم الشراء", type: "checkbox" },
    ],
  },
  expenses: {
    title: "مصروف",
    fields: [
      { name: "description", label: "الوصف", type: "text", required: true },
      { name: "amount", label: "المبلغ", type: "number", required: true },
      { name: "category", label: "الفئة", type: "select", options: () => EXPENSE_CATEGORIES.map((c) => [c, c]), default: "أخرى" },
      { name: "date", label: "التاريخ", type: "date", default: today },
      { name: "paidBy", label: "دفعها", type: "select", options: memberOptions },
    ],
  },
  bills: {
    title: "فاتورة",
    fields: [
      { name: "name", label: "اسم الفاتورة (كهرباء، ماء، إنترنت...)", type: "text", required: true },
      { name: "amount", label: "المبلغ", type: "number", required: true },
      { name: "due", label: "تاريخ الاستحقاق", type: "date", required: true },
      { name: "monthly", label: "تتكرر شهريًا", type: "checkbox", default: true },
      { name: "paid", label: "مدفوعة", type: "checkbox" },
    ],
  },
  inventory: {
    title: "غرض",
    fields: [
      { name: "name", label: "الغرض", type: "text", required: true },
      { name: "qty", label: "الكمية الحالية", type: "number", required: true, default: 1 },
      { name: "minQty", label: "الحد الأدنى للتنبيه", type: "number", default: 1 },
      { name: "unit", label: "الوحدة (علبة، كيلو...)", type: "text" },
      { name: "location", label: "مكان التخزين", type: "text" },
      { name: "expiry", label: "تاريخ الانتهاء", type: "date" },
    ],
  },
};

// ===== النموذج العام =====
let formContext = null;

function openForm(entity, id = null) {
  const def = ENTITIES[entity];
  const item = id ? state[entity].find((x) => x.id === id) : null;
  formContext = { entity, id };
  $("#formTitle").textContent = (item ? "تعديل " : "إضافة ") + def.title;

  $("#formFields").innerHTML = def.fields.map((f) => {
    let value = item ? item[f.name] : typeof f.default === "function" ? f.default() : f.default;
    value = value ?? "";
    const req = f.required ? "required" : "";
    if (f.type === "checkbox") {
      return `<div class="field check"><input type="checkbox" id="f_${f.name}" name="${f.name}" ${value ? "checked" : ""}><label for="f_${f.name}">${f.label}</label></div>`;
    }
    if (f.type === "select") {
      const opts = f.options().map(([k, v]) => `<option value="${esc(k)}" ${k === value ? "selected" : ""}>${esc(v)}</option>`).join("");
      return `<div class="field"><label for="f_${f.name}">${f.label}</label><select id="f_${f.name}" name="${f.name}">${opts}</select></div>`;
    }
    const step = f.type === "number" ? 'step="any" min="0"' : "";
    return `<div class="field"><label for="f_${f.name}">${f.label}</label><input type="${f.type}" id="f_${f.name}" name="${f.name}" value="${esc(value)}" ${step} ${req}></div>`;
  }).join("");

  $("#formDialog").showModal();
  $("#formFields input, #formFields select")?.focus();
}

$("#entityForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const { entity, id } = formContext;
  const form = e.target;
  const data = {};
  for (const f of ENTITIES[entity].fields) {
    const el = form.elements[f.name];
    if (f.type === "checkbox") data[f.name] = el.checked;
    else if (f.type === "number") data[f.name] = el.value === "" ? "" : Number(el.value);
    else data[f.name] = el.value.trim();
  }
  if (id) {
    const idx = state[entity].findIndex((x) => x.id === id);
    state[entity][idx] = { ...state[entity][idx], ...data };
  } else {
    const item = { id: uid(), createdAt: today(), ...data };
    ENTITIES[entity].onCreate?.(item);
    state[entity].push(item);
  }
  save();
  $("#formDialog").close();
  render();
  toast("تم الحفظ");
});

$("#cancelForm").addEventListener("click", () => $("#formDialog").close());

function removeItem(entity, id) {
  if (!confirm("هل تريد الحذف فعلًا؟")) return;
  state[entity] = state[entity].filter((x) => x.id !== id);
  save();
  render();
  toast("تم الحذف");
}

// ===== منطق التكرار =====
function addInterval(dateStr, repeat) {
  const d = new Date((dateStr || today()) + "T00:00:00");
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
  return fmtDate(d);
}

function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t.done && t.repeat) {
    // المهام المتكررة: تُسجل كمنجزة وتُنشأ نسخة جديدة بالموعد التالي
    state.tasks.push({ ...t, id: uid(), done: false, due: addInterval(t.due, t.repeat) });
  }
  t.done = !t.done;
  save();
  render();
}

function payBill(id) {
  const b = state.bills.find((x) => x.id === id);
  if (b.paid) {
    b.paid = false;
  } else {
    b.paid = true;
    state.expenses.push({ id: uid(), createdAt: today(), description: `فاتورة ${b.name}`, amount: b.amount, category: "فواتير", date: today(), paidBy: "" });
    if (b.monthly) {
      state.bills.push({ ...b, id: uid(), paid: false, due: addInterval(b.due, "monthly") });
    }
    toast("تم تسجيل الدفع وإضافته إلى المصاريف");
  }
  save();
  render();
}

function toggleBought(id) {
  const s = state.shopping.find((x) => x.id === id);
  s.bought = !s.bought;
  save();
  render();
}

function clearBought() {
  const bought = state.shopping.filter((s) => s.bought);
  if (!bought.length) return toast("لا توجد أصناف مشتراة");
  const total = bought.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
  if (total > 0 && confirm(`تسجيل مصروف تسوق بقيمة ${total}؟`)) {
    state.expenses.push({ id: uid(), createdAt: today(), description: "مشتريات التسوق", amount: total, category: "طعام", date: today(), paidBy: "" });
  }
  state.shopping = state.shopping.filter((s) => !s.bought);
  save();
  render();
  toast("تم تنظيف القائمة");
}

function adjustStock(id, delta) {
  const it = state.inventory.find((x) => x.id === id);
  it.qty = Math.max(0, (Number(it.qty) || 0) + delta);
  save();
  render();
}

function stockToShopping(id) {
  const it = state.inventory.find((x) => x.id === id);
  if (state.shopping.some((s) => !s.bought && s.name === it.name)) return toast("الصنف موجود بالفعل في قائمة التسوق");
  state.shopping.push({ id: uid(), createdAt: today(), name: it.name, qty: it.unit ? `1 ${it.unit}` : "1", category: "أخرى", price: "", bought: false });
  save();
  toast("أضيف إلى قائمة التسوق");
}

// ===== الحسابات =====
const monthExpenses = (month = currentMonth()) => state.expenses.filter((e) => (e.date || "").startsWith(month));
const sum = (arr, key = "amount") => arr.reduce((s, x) => s + (Number(x[key]) || 0), 0);
const lowStock = () => state.inventory.filter((i) => Number(i.qty) <= Number(i.minQty || 0));
const expiringSoon = () => state.inventory.filter((i) => i.expiry && daysUntil(i.expiry) <= 7);
const pendingTasks = () => state.tasks.filter((t) => !t.done);
const unpaidBills = () => state.bills.filter((b) => !b.paid);

// ===== العرض =====
let currentView = "dashboard";
const filters = { tasks: "pending", expensesMonth: currentMonth(), search: "" };

const actions = (entity, id) =>
  `<button class="btn sm" data-edit="${entity}" data-id="${id}">✏️</button> <button class="btn sm" data-del="${entity}" data-id="${id}">🗑️</button>`;

function header(title, entity, extra = "") {
  return `<div class="view-header"><h2>${title}</h2><div class="toolbar">${extra}${entity ? `<button class="btn primary" data-add="${entity}">+ إضافة ${ENTITIES[entity].title}</button>` : ""}</div></div>`;
}

function table(cols, rows, rowClass = () => "") {
  if (!rows.length) return `<div class="panel empty">لا توجد بيانات بعد</div>`;
  return `<div class="table-wrap panel" style="padding:0"><table>
    <thead><tr>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="${rowClass(r)}">${cols.map((c) => `<td class="${c.cls || ""}">${c.render(r)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

const views = {
  dashboard() {
    const spent = sum(monthExpenses());
    const budget = Number(state.settings.monthlyBudget) || 0;
    const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
    const upcomingBills = unpaidBills().sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
    const urgentTasks = pendingTasks().sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")).slice(0, 5);
    const low = lowStock();
    const overdue = upcomingBills.filter((b) => daysUntil(b.due) < 0).length;

    return `
      <div class="view-header"><h2>لوحة التحكم</h2><span class="muted">${new Date().toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span></div>
      <div class="cards">
        <div class="card"><div class="label">مهام قيد التنفيذ</div><div class="value">${pendingTasks().length}</div></div>
        <div class="card ${spent > budget ? "danger" : "ok"}"><div class="label">مصاريف هذا الشهر</div><div class="value">${money(spent)}</div></div>
        <div class="card ${overdue ? "danger" : ""}"><div class="label">فواتير غير مدفوعة</div><div class="value">${unpaidBills().length}</div></div>
        <div class="card ${low.length ? "warn" : ""}"><div class="label">أغراض قاربت على النفاد</div><div class="value">${low.length}</div></div>
        <div class="card"><div class="label">أصناف في قائمة التسوق</div><div class="value">${state.shopping.filter((s) => !s.bought).length}</div></div>
        ${typeof dashboardSmartCards === "function" ? dashboardSmartCards() : ""}
      </div>

      <div class="panel">
        <h3>الميزانية الشهرية</h3>
        <div class="progress ${spent > budget ? "over" : ""}"><div style="width:${pct}%"></div></div>
        <p class="muted">صُرف ${money(spent)} من ${money(budget)} — المتبقي ${money(budget - spent)}</p>
      </div>

      <div class="grid-2">
        <div class="panel"><h3>المهام القادمة</h3>
          ${urgentTasks.length ? `<ul class="list">${urgentTasks.map((t) => `<li><span>${esc(t.title)} <span class="muted">· ${esc(memberName(t.assignee))}</span></span>${dueBadge(t.due)}</li>`).join("")}</ul>` : `<p class="muted">لا توجد مهام معلقة 🎉</p>`}
        </div>
        <div class="panel"><h3>الفواتير المستحقة</h3>
          ${upcomingBills.length ? `<ul class="list">${upcomingBills.map((b) => `<li><span>${esc(b.name)} — ${money(b.amount)}</span>${dueBadge(b.due)}</li>`).join("")}</ul>` : `<p class="muted">كل الفواتير مدفوعة ✅</p>`}
        </div>
        <div class="panel"><h3>تنبيهات المخزون</h3>
          ${low.length || expiringSoon().length ? `<ul class="list">
            ${low.map((i) => `<li><span>${esc(i.name)}</span><span class="badge low-stock">متبقٍ ${esc(i.qty)} ${esc(i.unit)}</span></li>`).join("")}
            ${expiringSoon().map((i) => `<li><span>${esc(i.name)}</span>${daysUntil(i.expiry) < 0 ? `<span class="badge overdue">منتهي الصلاحية</span>` : `<span class="badge soon">ينتهي ${esc(i.expiry)}</span>`}</li>`).join("")}
          </ul>` : `<p class="muted">المخزون بحالة جيدة</p>`}
        </div>
        <div class="panel"><h3>المصاريف حسب الفئة (هذا الشهر)</h3>${categoryBreakdown(monthExpenses())}</div>
      </div>`;
  },

  tasks() {
    let rows = state.tasks;
    if (filters.tasks === "pending") rows = rows.filter((t) => !t.done);
    if (filters.tasks === "done") rows = rows.filter((t) => t.done);
    rows = [...rows].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    const filter = `<select data-filter="tasks">
      ${[["pending", "قيد التنفيذ"], ["done", "المنجزة"], ["all", "الكل"]].map(([k, v]) => `<option value="${k}" ${filters.tasks === k ? "selected" : ""}>${v}</option>`).join("")}
    </select>`;
    return header("المهام المنزلية", "tasks", filter) + table([
      { label: "", render: (t) => `<input type="checkbox" data-toggle-task="${t.id}" ${t.done ? "checked" : ""}>` },
      { label: "المهمة", cls: "title", render: (t) => esc(t.title) + (t.repeat ? ` <span class="badge">🔁</span>` : "") },
      { label: "مسندة إلى", render: (t) => esc(memberName(t.assignee)) },
      { label: "الأولوية", render: (t) => `<span class="badge ${t.priority}">${label(PRIORITIES, t.priority)}</span>` },
      { label: "الموعد", render: (t) => dueBadge(t.due, t.done) },
      { label: "", render: (t) => actions("tasks", t.id) },
    ], rows, (t) => (t.done ? "done" : ""));
  },

  shopping() {
    const rows = [...state.shopping].sort((a, b) => a.bought - b.bought || a.category.localeCompare(b.category));
    const total = sum(state.shopping.filter((s) => !s.bought), "price");
    const extra = `<span class="muted">التكلفة التقديرية: ${money(total)}</span><button class="btn" data-action="clearBought">🧹 إزالة المشتراة</button>`;
    return header("قائمة التسوق", "shopping", extra) + table([
      { label: "", render: (s) => `<input type="checkbox" data-toggle-bought="${s.id}" ${s.bought ? "checked" : ""}>` },
      { label: "الصنف", cls: "title", render: (s) => esc(s.name) },
      { label: "الكمية", render: (s) => esc(s.qty) },
      { label: "الفئة", render: (s) => `<span class="badge">${esc(s.category)}</span>` },
      { label: "السعر", render: (s) => (s.price !== "" && s.price != null ? money(s.price) : "—") },
      { label: "", render: (s) => actions("shopping", s.id) },
    ], rows, (s) => (s.bought ? "done" : ""));
  },

  expenses() {
    const month = filters.expensesMonth;
    const rows = monthExpenses(month).sort((a, b) => b.date.localeCompare(a.date));
    const total = sum(rows);
    const budget = Number(state.settings.monthlyBudget) || 0;
    const extra = `<input type="month" data-filter="expensesMonth" value="${month}">`;
    return header("المصاريف والميزانية", "expenses", extra) + `
      <div class="cards">
        <div class="card"><div class="label">إجمالي الشهر</div><div class="value">${money(total)}</div></div>
        <div class="card"><div class="label">الميزانية</div><div class="value">${money(budget)}</div></div>
        <div class="card ${budget - total < 0 ? "danger" : "ok"}"><div class="label">المتبقي</div><div class="value">${money(budget - total)}</div></div>
      </div>
      <div class="panel"><h3>التوزيع حسب الفئة</h3>${categoryBreakdown(rows)}</div>` +
      table([
        { label: "التاريخ", render: (e) => esc(e.date) },
        { label: "الوصف", render: (e) => esc(e.description) },
        { label: "الفئة", render: (e) => `<span class="badge">${esc(e.category)}</span>` },
        { label: "المبلغ", render: (e) => money(e.amount) },
        { label: "دفعها", render: (e) => esc(memberName(e.paidBy)) },
        { label: "", render: (e) => actions("expenses", e.id) },
      ], rows);
  },

  bills() {
    const rows = [...state.bills].sort((a, b) => a.paid - b.paid || a.due.localeCompare(b.due));
    const extra = `<span class="muted">غير المدفوع: ${money(sum(unpaidBills()))}</span>`;
    return header("الفواتير", "bills", extra) + table([
      { label: "الفاتورة", cls: "title", render: (b) => esc(b.name) + (b.monthly ? ` <span class="badge">شهرية</span>` : "") },
      { label: "المبلغ", render: (b) => money(b.amount) },
      { label: "الاستحقاق", render: (b) => dueBadge(b.due, b.paid) },
      { label: "الحالة", render: (b) => (b.paid ? `<span class="badge paid">مدفوعة</span>` : `<span class="badge">غير مدفوعة</span>`) },
      { label: "", render: (b) => `<button class="btn sm ${b.paid ? "" : "primary"}" data-pay="${b.id}">${b.paid ? "↩️ تراجع" : "💳 دفع"}</button> ${actions("bills", b.id)}` },
    ], rows, (b) => (b.paid ? "done" : ""));
  },

  inventory() {
    const q = filters.search.toLowerCase();
    const rows = state.inventory.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.location || "").toLowerCase().includes(q));
    const extra = `<input type="search" placeholder="بحث..." data-filter="search" value="${esc(filters.search)}">`;
    return header("المخزون", "inventory", extra) + table([
      { label: "الغرض", render: (i) => esc(i.name) },
      { label: "الكمية", render: (i) => `<button class="btn sm" data-stock="${i.id}" data-delta="-1">−</button> <strong>${esc(i.qty)}</strong> ${esc(i.unit)} <button class="btn sm" data-stock="${i.id}" data-delta="1">+</button>` },
      { label: "الحالة", render: (i) => (Number(i.qty) <= Number(i.minQty || 0) ? `<span class="badge low-stock">منخفض</span>` : `<span class="badge ok">متوفر</span>`) },
      { label: "المكان", render: (i) => esc(i.location || "—") },
      { label: "الانتهاء", render: (i) => (i.expiry ? dueBadge(i.expiry) : "—") },
      { label: "", render: (i) => `<button class="btn sm" data-to-shopping="${i.id}" title="أضف لقائمة التسوق">🛒</button> ${actions("inventory", i.id)}` },
    ], rows);
  },

  members() {
    return header("أفراد الأسرة", "members") + table([
      { label: "الاسم", render: (m) => esc(m.name) },
      { label: "الصفة", render: (m) => esc(m.role || "—") },
      { label: "الجوال", render: (m) => esc(m.phone || "—") },
      { label: "المهام المعلقة", render: (m) => pendingTasks().filter((t) => t.assignee === m.id).length },
      { label: "", render: (m) => actions("members", m.id) },
    ], state.members);
  },

  settings() {
    return `<div class="view-header"><h2>الإعدادات</h2></div>
      <div class="panel">
        <h3>عام</h3>
        <form id="settingsForm">
          <div class="field"><label>العملة</label><select name="currency">
            ${Object.entries(CURRENCIES).map(([code, c]) => `<option value="${code}" ${state.settings.currency === code ? "selected" : ""}>${c.label}</option>`).join("")}
          </select></div>
          <div class="field"><label>الميزانية الشهرية</label><input name="monthlyBudget" type="number" min="0" step="any" value="${esc(state.settings.monthlyBudget)}"></div>
          <div class="field"><label>المدينة (للطقس)</label><input name="city" value="${esc(state.settings.city)}"></div>
          <div class="field"><label>سعر الكيلوواط ساعة</label><input name="kwhPrice" type="number" min="0" step="any" value="${esc(state.settings.kwhPrice)}"></div>
          <button class="btn primary">حفظ الإعدادات</button>
        </form>
      </div>
      <div class="panel">
        <h3>النسخ الاحتياطي</h3>
        <p class="muted">البيانات محفوظة في هذا المتصفح فقط. صدّرها بانتظام للاحتفاظ بنسخة.</p>
        <div class="toolbar">
          <button class="btn" data-action="export">⬇️ تصدير البيانات</button>
          <label class="btn">⬆️ استيراد البيانات<input type="file" accept="application/json" id="importFile" hidden></label>
          <button class="btn" data-action="demo">✨ تحميل بيانات تجريبية</button>
          <button class="btn danger" data-action="reset">حذف كل البيانات</button>
        </div>
      </div>`;
  },
};

function categoryBreakdown(expenses) {
  const total = sum(expenses);
  if (!total) return `<p class="muted">لا توجد مصاريف</p>`;
  const byCat = {};
  expenses.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0)));
  return `<ul class="list">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `
    <li style="flex-direction:column">
      <div style="display:flex;justify-content:space-between"><span>${esc(cat)}</span><span>${money(amt)} (${Math.round((amt / total) * 100)}%)</span></div>
      <div class="progress"><div style="width:${(amt / total) * 100}%;background:var(--primary)"></div></div>
    </li>`).join("")}</ul>`;
}

// دوال تُستدعى بعد كل رسم (مثل إعادة ربط بث الكاميرا)
const afterRenderHooks = [];

function render() {
  $("#main").innerHTML = views[currentView]();
  afterRenderHooks.forEach((fn) => fn());
  document.querySelectorAll("#sidebar button").forEach((b) => b.classList.toggle("active", b.dataset.view === currentView));
}

// ===== الأحداث =====
$("#sidebar").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;
  currentView = btn.dataset.view;
  $("#sidebar").classList.remove("open");
  render();
});

$("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

$("#main").addEventListener("click", (e) => {
  const t = e.target.closest("button, input[type=checkbox]");
  if (!t) return;
  const d = t.dataset;
  if (d.add) openForm(d.add);
  else if (d.edit) openForm(d.edit, d.id);
  else if (d.del) removeItem(d.del, d.id);
  else if (d.toggleTask) toggleTask(d.toggleTask);
  else if (d.toggleBought) toggleBought(d.toggleBought);
  else if (d.pay) payBill(d.pay);
  else if (d.stock) adjustStock(d.stock, Number(d.delta));
  else if (d.toShopping) stockToShopping(d.toShopping);
  else if (d.action === "clearBought") clearBought();
  else if (d.action === "export") exportData();
  else if (d.action === "demo") loadDemo();
  else if (d.action === "reset") resetData();
});

$("#main").addEventListener("input", (e) => {
  const key = e.target.dataset.filter;
  if (!key) return;
  filters[key] = e.target.value;
  render();
  // إعادة التركيز على حقل البحث بعد إعادة الرسم
  if (key === "search") {
    const el = $(`[data-filter="search"]`);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
});

$("#main").addEventListener("submit", (e) => {
  if (e.target.id !== "settingsForm") return;
  e.preventDefault();
  const f = e.target.elements;
  state.settings.currency = CURRENCIES[f.currency.value] ? f.currency.value : "LYD";
  state.settings.monthlyBudget = Number(f.monthlyBudget.value) || 0;
  const city = f.city.value.trim() || "الرياض";
  if (city !== state.settings.city) weatherCache = null;
  state.settings.city = city;
  state.settings.kwhPrice = Number(f.kwhPrice.value) || 0;
  save();
  toast("تم حفظ الإعدادات");
});

$("#main").addEventListener("change", (e) => {
  if (e.target.id !== "importFile" || !e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (typeof data !== "object" || !data) throw new Error();
      state = mergeState(data);
      save();
      render();
      toast("تم استيراد البيانات");
    } catch {
      toast("ملف غير صالح");
    }
  };
  reader.readAsText(e.target.files[0]);
});

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `home-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function resetData() {
  if (!confirm("سيتم حذف جميع البيانات نهائيًا. هل أنت متأكد؟")) return;
  state = defaultState();
  save();
  render();
  toast("تم حذف البيانات");
}

function loadDemo() {
  if ((state.tasks.length || state.expenses.length) && !confirm("سيتم استبدال البيانات الحالية. متابعة؟")) return;
  const m1 = uid(), m2 = uid(), m3 = uid();
  const d = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return fmtDate(date);
  };
  state = {
    ...defaultState(),
    members: [
      { id: m1, name: "أحمد", role: "الأب", phone: "" },
      { id: m2, name: "سارة", role: "الأم", phone: "" },
      { id: m3, name: "يوسف", role: "الابن", phone: "" },
    ],
    tasks: [
      { id: uid(), title: "تنظيف المطبخ", assignee: m2, priority: "medium", due: d(0), repeat: "daily", done: false },
      { id: uid(), title: "إخراج القمامة", assignee: m3, priority: "low", due: d(1), repeat: "daily", done: false },
      { id: uid(), title: "صيانة المكيف", assignee: m1, priority: "high", due: d(-2), repeat: "", done: false },
      { id: uid(), title: "سقي النباتات", assignee: m3, priority: "low", due: d(3), repeat: "weekly", done: false },
    ],
    shopping: [
      { id: uid(), name: "حليب", qty: "2", category: "ألبان", price: 12, bought: false },
      { id: uid(), name: "خبز", qty: "1", category: "مخبوزات", price: 5, bought: false },
      { id: uid(), name: "طماطم", qty: "1 كيلو", category: "خضار وفواكه", price: 8, bought: true },
    ],
    expenses: [
      { id: uid(), description: "مشتريات السوبرماركت", amount: 450, category: "طعام", date: d(-3), paidBy: m1 },
      { id: uid(), description: "بنزين", amount: 150, category: "مواصلات", date: d(-1), paidBy: m1 },
      { id: uid(), description: "أدوية", amount: 90, category: "صحة", date: d(0), paidBy: m2 },
    ],
    bills: [
      { id: uid(), name: "الكهرباء", amount: 320, due: d(2), monthly: true, paid: false },
      { id: uid(), name: "الإنترنت", amount: 230, due: d(-1), monthly: true, paid: false },
      { id: uid(), name: "الماء", amount: 80, due: d(10), monthly: true, paid: false },
    ],
    inventory: [
      { id: uid(), name: "أرز", qty: 1, minQty: 2, unit: "كيس", location: "المخزن", expiry: "" },
      { id: uid(), name: "زيت", qty: 3, minQty: 1, unit: "علبة", location: "المطبخ", expiry: "" },
      { id: uid(), name: "زبادي", qty: 4, minQty: 2, unit: "علبة", location: "الثلاجة", expiry: d(2) },
      { id: uid(), name: "مناديل", qty: 0, minQty: 2, unit: "علبة", location: "المخزن", expiry: "" },
    ],
    ...demoSmartData(),
  };
  save();
  currentView = "dashboard";
  render();
  toast("تم تحميل البيانات التجريبية");
}
