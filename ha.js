"use strict";

// ===== الربط مع Home Assistant عبر WebSocket API =====
// أجهزة Sonoff (eWeLink) تصل إلى Home Assistant عبر إضافة SonoffLAN،
// والتطبيق يقرأ حالتها ويرسل الأوامر من خلال Home Assistant.
const HA_KEY = "homeManager.ha"; // مفصول عن بيانات المنزل حتى لا يُصدَّر رمز الوصول مع النسخة الاحتياطية

const ha = {
  config: loadHaConfig(),
  ws: null,
  status: "off", // off | connecting | connected | error
  error: "",
  noRetry: false,
  msgId: 0,
  pending: new Map(),
  states: {},
  entityArea: {},
  entityMeta: {},
  retry: 0,
  retryTimer: null,
  renderTimer: null,
};

function loadHaConfig() {
  const base = { url: "", token: "", hidden: [] };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(HA_KEY) || "{}") };
  } catch {
    return base;
  }
}

function saveHaConfig() {
  try {
    localStorage.setItem(HA_KEY, JSON.stringify(ha.config));
  } catch {
    toast("تعذر حفظ إعدادات Home Assistant في المتصفح");
  }
}

const haConnected = () => ha.status === "connected";
const haBase = () => ha.config.url.replace(/\/+$/, "");

function haConnect() {
  haDisconnect();
  const { url, token } = ha.config;
  if (!url || !token) return;
  let wsUrl;
  try {
    const u = new URL(url);
    wsUrl = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}${u.pathname.replace(/\/+$/, "")}/api/websocket`;
  } catch {
    return haFail("رابط Home Assistant غير صالح", true);
  }
  ha.status = "connecting";
  ha.error = "";
  ha.noRetry = false;
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    return haFail("المتصفح منع الاتصال. إذا كانت الصفحة https والعنوان http فشغّل التطبيق محليًا.", true);
  }
  ha.ws = ws;
  ws.onmessage = (ev) => haOnMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    if (ha.ws !== ws) return;
    ha.ws = null;
    ha.pending.forEach((p) => p.reject(new Error("انقطع الاتصال")));
    ha.pending.clear();
    if (ha.noRetry) return;
    const delay = Math.min(30000, 2000 * 2 ** ha.retry++);
    haFail(ha.status === "connected" ? "انقطع الاتصال، تتم إعادة المحاولة..." : "تعذر الوصول إلى Home Assistant. تأكد من العنوان وأنك على شبكة المنزل.");
    ha.retryTimer = setTimeout(haConnect, delay);
  };
  haRender();
}

function haDisconnect() {
  clearTimeout(ha.retryTimer);
  if (ha.ws) {
    const ws = ha.ws;
    ha.ws = null;
    ws.close();
  }
  ha.status = "off";
}

function haFail(message, final = false) {
  ha.status = "error";
  ha.error = message;
  if (final) ha.noRetry = true;
  haRender();
}

function haSend(cmd) {
  return new Promise((resolve, reject) => {
    if (!ha.ws || ha.ws.readyState !== WebSocket.OPEN) return reject(new Error("Home Assistant غير متصل"));
    const id = ++ha.msgId;
    const timer = setTimeout(() => {
      ha.pending.delete(id);
      reject(new Error("انتهت مهلة الاستجابة"));
    }, 15000);
    ha.pending.set(id, {
      resolve: (v) => (clearTimeout(timer), resolve(v)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    ha.ws.send(JSON.stringify({ id, ...cmd }));
  });
}

function haOnMessage(msg) {
  if (msg.type === "auth_required") {
    ha.ws.send(JSON.stringify({ type: "auth", access_token: ha.config.token }));
  } else if (msg.type === "auth_ok") {
    ha.status = "connected";
    ha.error = "";
    ha.retry = 0;
    haLoadAll();
  } else if (msg.type === "auth_invalid") {
    haFail("رمز الوصول غير صحيح أو منتهي. أنشئ رمزًا جديدًا من ملفك الشخصي في Home Assistant.", true);
    ha.ws?.close();
  } else if (msg.type === "result") {
    const p = ha.pending.get(msg.id);
    if (!p) return;
    ha.pending.delete(msg.id);
    msg.success ? p.resolve(msg.result) : p.reject(new Error(msg.error?.message || "فشل الطلب"));
  } else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
    haOnStateChanged(msg.event.data);
  }
}

async function haLoadAll() {
  try {
    const states = await haSend({ type: "get_states" });
    ha.states = Object.fromEntries(states.map((s) => [s.entity_id, s]));
    // سجلات الغرف تحتاج حساب مدير؛ إن لم تتوفر تُعرض الأجهزة دون غرف
    const [areas, devices, entities] = await Promise.allSettled([
      haSend({ type: "config/area_registry/list" }),
      haSend({ type: "config/device_registry/list" }),
      haSend({ type: "config/entity_registry/list" }),
    ]);
    const areaName = Object.fromEntries((areas.value || []).map((a) => [a.area_id, a.name]));
    const deviceArea = Object.fromEntries((devices.value || []).map((d) => [d.id, d.area_id]));
    ha.entityArea = {};
    ha.entityMeta = {};
    for (const e of entities.value || []) {
      ha.entityArea[e.entity_id] = areaName[e.area_id || deviceArea[e.device_id]];
      ha.entityMeta[e.entity_id] = e;
    }
    await haSend({ type: "subscribe_events", event_type: "state_changed" });
  } catch (e) {
    toast("خطأ في تحميل أجهزة Home Assistant: " + e.message);
  }
  haRender();
}

function haOnStateChanged({ entity_id, new_state, old_state }) {
  if (!new_state) delete ha.states[entity_id];
  else ha.states[entity_id] = new_state;
  const domain = entity_id.split(".")[0];
  if (new_state && old_state && new_state.state !== old_state.state && HA_DOMAINS[domain] && !HA_DOMAINS[domain].readOnly && haVisible(new_state)) {
    logDevice(`${haName(new_state)}: ${haStateLabel(new_state)}`);
    save();
  }
  haScheduleRender();
}

// إعادة الرسم بعد تغيّر الحالة، مع تأجيلها أثناء سحب منزلق حتى لا يقفز
function haScheduleRender() {
  if (!["devices", "monitor", "dashboard"].includes(currentView)) return;
  clearTimeout(ha.renderTimer);
  ha.renderTimer = setTimeout(() => {
    if (document.activeElement?.type === "range" || $("#formDialog").open) return haScheduleRender();
    render();
  }, 300);
}

function haRender() {
  const badge = $("#haBadge");
  if (badge) {
    badge.hidden = ha.status === "off";
    badge.textContent = { connected: "● Home Assistant", connecting: "… جارٍ الاتصال", error: "⚠ Home Assistant" }[ha.status] || "";
    badge.className = `ha-badge ${ha.status}`;
  }
  render();
}

// ===== تصنيف الكيانات =====
const HA_DOMAINS = {
  switch: { icon: "🔌" },
  input_boolean: { icon: "🔘" },
  light: { icon: "💡" },
  fan: { icon: "🌀" },
  climate: { icon: "❄️" },
  cover: { icon: "🪟" },
  lock: { icon: "🔒" },
  sensor: { icon: "📟", readOnly: true },
  binary_sensor: { icon: "🚨", readOnly: true },
};
const SENSOR_ICONS = { temperature: "🌡️", humidity: "💧", power: "⚡", door: "🚪", window: "🪟", garage_door: "🚪", motion: "🏃", occupancy: "🏃", moisture: "💦", smoke: "🔥", gas: "🔥" };
const SENSOR_CLASSES = ["temperature", "humidity", "power"];
const BINARY_CLASSES = ["door", "window", "garage_door", "motion", "occupancy", "moisture", "smoke", "gas"];

const haDomain = (e) => e.entity_id.split(".")[0];
const haName = (e) => e.attributes.friendly_name || e.entity_id;
const haUnavailable = (e) => ["unavailable", "unknown"].includes(e.state);
const haIcon = (e) => SENSOR_ICONS[e.attributes.device_class] || HA_DOMAINS[haDomain(e)]?.icon || "📟";

function haVisible(e) {
  const domain = haDomain(e);
  const meta = ha.entityMeta[e.entity_id];
  if (!HA_DOMAINS[domain] || meta?.entity_category || meta?.hidden_by || meta?.disabled_by) return false;
  if (ha.config.hidden.includes(e.entity_id)) return false;
  if (domain === "sensor") return SENSOR_CLASSES.includes(e.attributes.device_class);
  if (domain === "binary_sensor") return BINARY_CLASSES.includes(e.attributes.device_class);
  return true;
}

const haEntities = () => Object.values(ha.states).filter(haVisible);

function haIsOn(e) {
  const d = haDomain(e);
  if (d === "climate") return e.state !== "off" && !haUnavailable(e);
  if (d === "cover") return ["open", "opening"].includes(e.state);
  if (d === "lock") return e.state === "locked";
  return e.state === "on";
}

function haStateLabel(e) {
  const a = e.attributes;
  if (haUnavailable(e)) return "غير متصل";
  switch (haDomain(e)) {
    case "sensor": {
      const n = Number(e.state);
      return `${Number.isFinite(n) ? Math.round(n * 10) / 10 : e.state} ${a.unit_of_measurement || ""}`.trim();
    }
    case "binary_sensor": {
      const on = e.state === "on";
      const labels = { door: ["مفتوح", "مغلق"], window: ["مفتوحة", "مغلقة"], garage_door: ["مفتوح", "مغلق"], motion: ["حركة", "لا حركة"], occupancy: ["يوجد أحد", "فارغ"], moisture: ["تسرب ماء!", "جاف"], smoke: ["دخان!", "طبيعي"], gas: ["غاز!", "طبيعي"] };
      const [yes, no] = labels[a.device_class] || ["نشط", "غير نشط"];
      return on ? yes : no;
    }
    case "lock":
      return { locked: "مقفل", unlocked: "مفتوح", locking: "جارٍ القفل", unlocking: "جارٍ الفتح", jammed: "عالق!" }[e.state] || e.state;
    case "cover":
      return { open: a.current_position != null ? `مفتوحة ${a.current_position}%` : "مفتوحة", closed: "مغلقة", opening: "جارٍ الفتح", closing: "جارٍ الإغلاق" }[e.state] || e.state;
    case "climate":
      return e.state === "off" ? "مطفأ" : `يعمل · ${a.temperature ?? "—"}°${a.current_temperature != null ? ` (الغرفة ${a.current_temperature}°)` : ""}`;
    case "light":
      return e.state === "on" ? (a.brightness != null ? `يعمل · ${Math.round(a.brightness / 2.55)}%` : "يعمل") : "مطفأ";
    case "fan":
      return e.state === "on" ? (a.percentage != null ? `يعمل · ${a.percentage}%` : "يعمل") : "مطفأ";
    default:
      return e.state === "on" ? "يعمل" : "مطفأ";
  }
}

function haSlider(e) {
  const a = e.attributes;
  const d = haDomain(e);
  if (haUnavailable(e)) return null;
  const on = haIsOn(e);
  if (d === "light" && on && (a.supported_color_modes || []).some((m) => m !== "onoff")) return { label: "السطوع", min: 1, max: 100, step: 1, value: Math.round((a.brightness ?? 255) / 2.55) };
  if (d === "climate" && on && a.temperature != null) return { label: "الحرارة", min: a.min_temp ?? 16, max: a.max_temp ?? 30, step: a.target_temp_step ?? 0.5, value: a.temperature };
  if (d === "fan" && on && a.percentage != null) return { label: "السرعة", min: 0, max: 100, step: a.percentage_step ?? 1, value: a.percentage };
  if (d === "cover" && a.current_position != null) return { label: "الفتح", min: 0, max: 100, step: 1, value: a.current_position };
  return null;
}

function haCard(e) {
  const unavailable = haUnavailable(e);
  const readOnly = HA_DOMAINS[haDomain(e)].readOnly;
  const on = haIsOn(e);
  const s = haSlider(e);
  const id = esc(e.entity_id);
  return `<div class="device-card ${on && !readOnly ? "on" : ""} ${unavailable ? "offline" : ""}">
      <div class="device-top"><span class="device-icon">${haIcon(e)}</span>
        ${readOnly || unavailable ? "" : `<label class="switch" title="تشغيل/إيقاف"><input type="checkbox" data-ha-toggle="${id}" ${on ? "checked" : ""}><span></span></label>`}
      </div>
      <div class="device-name">${esc(haName(e))}</div>
      <div class="muted device-status"><bdi>${esc(haStateLabel(e))}</bdi></div>
      ${s ? `<div class="slider"><span class="muted">${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" data-ha-value="${id}"></div>` : ""}
      <div class="device-foot"><span class="badge ha">HA</span><button class="btn sm" data-ha-hide="${id}" title="إخفاء من القائمة">🙈</button></div>
    </div>`;
}

function haCall(domain, service, entityIds, data = {}) {
  return haSend({ type: "call_service", domain, service, service_data: data, target: { entity_id: entityIds } })
    .catch((err) => {
      toast("فشل تنفيذ الأمر: " + err.message);
      render();
    });
}

function haToggle(entityId) {
  const e = ha.states[entityId];
  if (!e) return;
  const d = haDomain(e);
  const on = haIsOn(e);
  if (d === "lock") {
    if (on && !confirm(`هل تريد فتح ${haName(e)}؟`)) return render();
    return haCall("lock", on ? "unlock" : "lock", entityId);
  }
  if (d === "cover") return haCall("cover", on ? "close_cover" : "open_cover", entityId);
  haCall(d, on ? "turn_off" : "turn_on", entityId);
}

function haSetValue(entityId, value) {
  const d = entityId.split(".")[0];
  const v = Number(value);
  if (d === "light") haCall("light", "turn_on", entityId, { brightness_pct: v });
  else if (d === "climate") haCall("climate", "set_temperature", entityId, { temperature: v });
  else if (d === "fan") haCall("fan", "set_percentage", entityId, { percentage: v });
  else if (d === "cover") haCall("cover", "set_cover_position", entityId, { position: v });
}

// المشاهد على الأجهزة الحقيقية. المقابس (switch) لا تُطفأ تلقائيًا لأنها قد تغذي ثلاجة أو راوتر.
function haApplyScene(key) {
  if (!haConnected()) return;
  const all = haEntities().filter((e) => !haUnavailable(e));
  const ids = (domain, pred = () => true) => all.filter((e) => haDomain(e) === domain && pred(e)).map((e) => e.entity_id);
  const run = (domain, service, list, data) => list.length && haCall(domain, service, list, data);
  if (key === "leave" || key === "night") {
    run("light", "turn_off", ids("light", haIsOn));
    run("lock", "lock", ids("lock", (e) => !haIsOn(e)));
    run("cover", "close_cover", ids("cover", haIsOn));
    if (key === "leave") {
      run("climate", "turn_off", ids("climate", haIsOn));
      run("fan", "turn_off", ids("fan", haIsOn));
    }
  } else if (key === "home") {
    const entrance = (e) => /صال|مدخل|living|entrance|hall/i.test(ha.entityArea[e.entity_id] || "");
    run("light", "turn_on", ids("light", entrance));
  }
}

// ملخص للوحة المراقبة
function haSummary() {
  const empty = { controllable: [], on: [], power: 0, openLocks: [], sensors: [], alerts: [] };
  if (!haConnected()) return empty;
  const list = haEntities();
  const controllable = list.filter((e) => !HA_DOMAINS[haDomain(e)].readOnly && haDomain(e) !== "lock");
  const power = list
    .filter((e) => e.attributes.device_class === "power" && !haUnavailable(e))
    .reduce((s, e) => s + (Number(e.state) || 0) * (e.attributes.unit_of_measurement === "kW" ? 1000 : 1), 0);
  const openLocks = list.filter((e) => haDomain(e) === "lock" && e.state === "unlocked");
  const alerts = [];
  openLocks.forEach((e) => alerts.push(["danger", `🔓 ${haName(e)} مفتوح`]));
  list.filter((e) => haDomain(e) === "binary_sensor" && e.state === "on").forEach((e) => {
    const cls = e.attributes.device_class;
    if (["moisture", "smoke", "gas"].includes(cls)) alerts.push(["danger", `${haIcon(e)} ${haName(e)}: ${haStateLabel(e)}`]);
    else if (["door", "window", "garage_door"].includes(cls)) alerts.push(["warn", `${haIcon(e)} ${haName(e)} ${haStateLabel(e)}`]);
  });
  list.filter(haUnavailable).forEach((e) => alerts.push(["warn", `📴 ${haName(e)} غير متصل`]));
  return {
    controllable,
    on: controllable.filter(haIsOn),
    power,
    openLocks,
    locks: list.filter((e) => haDomain(e) === "lock"),
    sensors: list.filter((e) => ["temperature", "humidity"].includes(e.attributes.device_class)),
    alerts,
  };
}

function haDevicesSection() {
  if (!ha.config.url || !ha.config.token) {
    return `<div class="panel ha-panel"><h3>🔗 أجهزتك الحقيقية (Sonoff / eWeLink)</h3>
      <p class="muted">اربط التطبيق بـ Home Assistant للتحكم بأجهزة Sonoff الحقيقية.</p>
      <button class="btn primary" data-goto="settings">إعداد الربط</button></div>`;
  }
  if (!haConnected()) {
    return `<div class="panel ha-panel"><h3>🔗 Home Assistant</h3>
      <p class="${ha.status === "error" ? "alert danger" : "muted"}">${ha.status === "error" ? esc(ha.error) : "جارٍ الاتصال..."}</p>
      <button class="btn sm" data-action="ha-reconnect">إعادة الاتصال</button></div>`;
  }
  const list = haEntities().sort((a, b) => haName(a).localeCompare(haName(b), "ar"));
  const rooms = {};
  list.forEach((e) => (rooms[ha.entityArea[e.entity_id] || "بدون غرفة"] ??= []).push(e));
  const hidden = ha.config.hidden.length ? `<button class="btn sm" data-action="ha-unhide">إظهار المخفية (${ha.config.hidden.length})</button>` : "";
  const body = list.length
    ? Object.entries(rooms).map(([room, items]) => `<h4 class="room-title">${esc(room)}</h4><div class="device-grid">${items.map(haCard).join("")}</div>`).join("")
    : `<p class="muted">لم يُعثر على أجهزة. تأكد من إضافة SonoffLAN في Home Assistant.</p>`;
  return `<div class="panel ha-panel"><div class="view-header"><h3>🔗 أجهزة حقيقية — Home Assistant</h3><div class="toolbar">${hidden}<button class="btn sm" data-action="ha-reconnect">🔄 تحديث</button></div></div>${body}</div>`;
}

const haCameras = () => Object.values(ha.states).filter((e) => haDomain(e) === "camera");

function haCameraSrc(entityId) {
  const e = ha.states[entityId];
  if (!e?.attributes.access_token) return "";
  return `${haBase()}/api/camera_proxy_stream/${encodeURIComponent(entityId)}?token=${encodeURIComponent(e.attributes.access_token)}`;
}

function haSettingsPanel() {
  const mixed = location.protocol === "https:" && /^http:/i.test(ha.config.url);
  const statusText = { off: "غير متصل", connecting: "جارٍ الاتصال...", connected: `متصل · ${haEntities().length} جهاز`, error: ha.error }[ha.status];
  return `<div class="panel" id="haSettings">
    <h3>🔗 ربط Home Assistant (أجهزة Sonoff / eWeLink)</h3>
    <p>الحالة: <span class="badge ${haConnected() ? "ok" : ha.status === "error" ? "overdue" : ""}">${esc(statusText)}</span></p>
    <form id="haForm">
      <div class="field"><label>عنوان Home Assistant</label><input name="url" type="url" placeholder="http://homeassistant.local:8123" value="${esc(ha.config.url)}" required dir="ltr"></div>
      <div class="field"><label>رمز الوصول طويل الأمد (Long-Lived Access Token)</label><input name="token" type="password" autocomplete="off" dir="ltr" placeholder="${ha.config.token ? "محفوظ — اتركه فارغًا للإبقاء عليه" : "الصق الرمز هنا"}"></div>
      ${mixed ? `<p class="alert warn">⚠️ هذه الصفحة تعمل عبر https والعنوان http، والمتصفح سيمنع الاتصال. شغّل التطبيق محليًا أو استخدم عنوان https لـ Home Assistant.</p>` : ""}
      <div class="toolbar">
        <button class="btn primary">اتصال</button>
        ${ha.config.token ? `<button type="button" class="btn danger" data-action="ha-forget">قطع الاتصال وحذف الرمز</button>` : ""}
      </div>
    </form>
    <p class="muted small">يُحفظ الرمز في هذا المتصفح فقط ولا يُضمَّن في ملف التصدير. لا تستخدم التطبيق على جهاز لا تثق به.</p>
    <details>
      <summary>خطوات الإعداد</summary>
      <ol class="small">
        <li>ثبّت Home Assistant على جهاز في البيت (Raspberry Pi أو حاسوب).</li>
        <li>ثبّت HACS ثم أضف تكامل <strong>SonoffLAN</strong> وسجّل الدخول بحساب eWeLink.</li>
        <li>للكاميرا GK-200MP2: فعّل البث المحلي RTSP ثم أضفها عبر go2rtc أو Generic Camera.</li>
        <li>من ملفك الشخصي في Home Assistant ← الأمان ← أنشئ «رمز وصول طويل الأمد» والصقه هنا.</li>
      </ol>
      <p class="small muted">التفاصيل الكاملة في ملف HOME-ASSISTANT.md في المستودع.</p>
    </details>
  </div>`;
}

// ===== دمج مع الواجهة =====
const baseSettingsView = views.settings;
views.settings = () => baseSettingsView() + haSettingsPanel();

$("#main").addEventListener("click", (e) => {
  const t = e.target.closest("button, input[type=checkbox]");
  if (!t) return;
  const d = t.dataset;
  if (d.haToggle) haToggle(d.haToggle);
  else if (d.haHide) {
    ha.config.hidden.push(d.haHide);
    saveHaConfig();
    render();
  } else if (d.action === "ha-unhide") {
    ha.config.hidden = [];
    saveHaConfig();
    render();
  } else if (d.action === "ha-reconnect") haConnect();
  else if (d.action === "ha-forget") {
    if (!confirm("حذف رمز الوصول وقطع الاتصال؟")) return;
    haDisconnect();
    ha.config.token = "";
    ha.states = {};
    saveHaConfig();
    haRender();
  }
});

$("#main").addEventListener("change", (e) => {
  if (e.target.dataset.haValue) haSetValue(e.target.dataset.haValue, e.target.value);
});

$("#main").addEventListener("submit", (e) => {
  if (e.target.id !== "haForm") return;
  e.preventDefault();
  const f = e.target.elements;
  ha.config.url = f.url.value.trim().replace(/\/+$/, "");
  if (f.token.value.trim()) ha.config.token = f.token.value.trim();
  if (!ha.config.token) return toast("أدخل رمز الوصول");
  saveHaConfig();
  haConnect();
});

haConnect();
render();

// تثبيت التطبيق على الهاتف والعمل دون إنترنت (يتطلب https أو localhost)
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
