"use strict";

// ===== الأجهزة الذكية =====
// التحكم هنا محاكاة داخل التطبيق؛ الربط الفعلي يحتاج منصة مثل Home Assistant.
const DEVICE_TYPES = {
  light: { label: "إضاءة", icon: "💡", power: 12, range: { min: 0, max: 100, def: 80, unit: "%", label: "السطوع" } },
  ac: { label: "مكيف", icon: "❄️", power: 1500, range: { min: 16, max: 30, def: 24, unit: "°", label: "الحرارة" } },
  tv: { label: "تلفاز", icon: "📺", power: 120 },
  fan: { label: "مروحة", icon: "🌀", power: 60, range: { min: 1, max: 5, def: 3, unit: "", label: "السرعة" } },
  curtain: { label: "ستارة", icon: "🪟", range: { min: 0, max: 100, def: 100, unit: "%", label: "الفتح" } },
  lock: { label: "قفل باب", icon: "🔒" },
  plug: { label: "مقبس ذكي", icon: "🔌", power: 100 },
  heater: { label: "سخان ماء", icon: "♨️", power: 2000 },
  washer: { label: "غسالة", icon: "🧺", power: 500 },
  sensor: { label: "حساس حرارة ورطوبة", icon: "🌡️", readOnly: true },
};

ENTITIES.devices = {
  title: "جهاز",
  fields: [
    { name: "name", label: "اسم الجهاز", type: "text", required: true },
    { name: "type", label: "النوع", type: "select", options: () => Object.entries(DEVICE_TYPES).map(([k, t]) => [k, `${t.icon} ${t.label}`]), default: "light" },
    { name: "room", label: "الغرفة", type: "text", default: "الصالة" },
    { name: "power", label: "الاستهلاك بالواط (اختياري)", type: "number" },
  ],
  onCreate(item) {
    const t = DEVICE_TYPES[item.type];
    item.on = item.type === "lock";
    item.value = t.range?.def ?? "";
    if (item.power === "") item.power = t.power ?? 0;
  },
};

ENTITIES.cameras = {
  title: "كاميرا",
  fields: [
    { name: "name", label: "اسم الكاميرا", type: "text", required: true, default: "غرفة الأطفال" },
    { name: "room", label: "الغرفة (لربطها بحساس الحرارة)", type: "text", default: "غرفة الأطفال" },
    { name: "source", label: "المصدر", type: "select", options: () => [["ha", "كاميرا من Home Assistant"], ["device", "كاميرا هذا الجهاز"], ["url", "كاميرا شبكة (رابط بث)"]], default: "device" },
    { name: "entity", label: "كاميرا Home Assistant", type: "select", options: () => [["", haConnected() ? "— اختر —" : "— Home Assistant غير متصل —"], ...haCameras().map((e) => [e.entity_id, haName(e)])] },
    { name: "url", label: "رابط البث أو الصورة (لكاميرا الشبكة)", type: "url" },
    { name: "refresh", label: "طريقة العرض (لكاميرا الشبكة)", type: "select", options: () => [["0", "بث مباشر MJPEG"], ["2", "صورة تتحدث كل ثانيتين"], ["5", "صورة تتحدث كل 5 ثوانٍ"]], default: "0" },
  ],
};

const devType = (d) => DEVICE_TYPES[d.type] || DEVICE_TYPES.plug;

function devicePower(d) {
  if (!d.on || devType(d).readOnly || d.type === "lock") return 0;
  const p = Number(d.power) || 0;
  return d.type === "light" ? (p * (Number(d.value) || 0)) / 100 : p;
}

const totalPower = () => state.devices.reduce((s, d) => s + devicePower(d), 0);
const monthlyCost = (watts = totalPower()) => (watts / 1000) * 24 * 30 * (Number(state.settings.kwhPrice) || 0);

function deviceStatus(d) {
  const t = devType(d);
  if (t.readOnly) {
    const r = sensorReading(d);
    return `<span data-sensor="${d.id}">${r.t.toFixed(1)}° · ${Math.round(r.h)}%</span>`;
  }
  if (d.type === "lock") return d.on ? "مقفل" : "مفتوح";
  if (d.type === "curtain") return d.on ? `مفتوحة ${d.value}%` : "مغلقة";
  if (!d.on) return "مطفأ";
  return t.range ? `يعمل · ${t.range.label} ${d.value}${t.range.unit}` : "يعمل";
}

function logDevice(text) {
  state.deviceLog.unshift({ time: new Date().toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }), text });
  state.deviceLog = state.deviceLog.slice(0, 50);
}

function toggleDevice(id) {
  const d = state.devices.find((x) => x.id === id);
  d.on = !d.on;
  logDevice(`${d.name}: ${deviceStatus(d)}`);
  save();
  render();
}

function setDeviceValue(id, value) {
  const d = state.devices.find((x) => x.id === id);
  d.value = Number(value);
  logDevice(`${d.name}: ${deviceStatus(d)}`);
  save();
  render();
}

const SCENES = {
  leave: {
    label: "🚪 مغادرة المنزل",
    apply(d) {
      if (d.type === "lock") d.on = true;
      else if (d.type === "curtain") d.on = false;
      else if (["light", "tv", "fan", "plug", "ac"].includes(d.type)) d.on = false;
    },
  },
  home: {
    label: "🏡 العودة للمنزل",
    apply(d) {
      if (d.type === "light" && /صالة|مدخل/.test(d.room)) { d.on = true; d.value = 80; }
      if (d.type === "ac" && /صالة/.test(d.room)) { d.on = true; d.value = 23; }
    },
  },
  night: {
    label: "🌙 وضع النوم",
    apply(d) {
      if (d.type === "lock") d.on = true;
      else if (d.type === "curtain") d.on = false;
      else if (["light", "tv"].includes(d.type)) d.on = false;
      else if (d.type === "ac" && d.on) d.value = 24;
    },
  },
};

function applyScene(key) {
  const scene = SCENES[key];
  state.devices.forEach(scene.apply);
  haApplyScene(key);
  logDevice(`تفعيل مشهد: ${scene.label}`);
  save();
  render();
  toast(`تم تفعيل ${scene.label}`);
}

// قراءات الحساسات محاكاة تتغير تدريجيًا (لا تُحفظ)
const sensorState = {};
function sensorReading(d) {
  if (!sensorState[d.id]) sensorState[d.id] = { t: 22 + Math.random() * 3, h: 40 + Math.random() * 15 };
  return sensorState[d.id];
}

setInterval(() => {
  for (const d of state.devices.filter((x) => x.type === "sensor")) {
    const r = sensorReading(d);
    const acOn = state.devices.some((x) => x.type === "ac" && x.on && x.room === d.room);
    const target = acOn ? 23 : 26;
    r.t += (target - r.t) * 0.05 + (Math.random() - 0.5) * 0.2;
    r.h = Math.min(80, Math.max(25, r.h + (Math.random() - 0.5)));
    document.querySelectorAll(`[data-sensor="${d.id}"]`).forEach((el) => (el.textContent = `${r.t.toFixed(1)}° · ${Math.round(r.h)}%`));
  }
}, 5000);

function deviceCard(d) {
  const t = devType(d);
  const control = t.readOnly ? "" : `
    <label class="switch" title="تشغيل/إيقاف"><input type="checkbox" data-toggle-device="${d.id}" ${d.on ? "checked" : ""}><span></span></label>`;
  const slider = t.range && d.on && !t.readOnly ? `
    <div class="slider"><span class="muted">${t.range.label}</span>
      <input type="range" min="${t.range.min}" max="${t.range.max}" value="${esc(d.value)}" data-device-value="${d.id}">
    </div>` : "";
  return `<div class="device-card ${d.on && !t.readOnly ? "on" : ""}">
      <div class="device-top"><span class="device-icon">${t.icon}</span>${control}</div>
      <div class="device-name">${esc(d.name)}</div>
      <div class="muted device-status">${deviceStatus(d)}</div>
      ${slider}
      <div class="device-foot"><span class="muted">${devicePower(d) ? Math.round(devicePower(d)) + " واط" : ""}</span><span>${actions("devices", d.id)}</span></div>
    </div>`;
}

function groupByRoom(items) {
  const rooms = {};
  items.forEach((d) => (rooms[d.room || "بدون غرفة"] ??= []).push(d));
  return Object.entries(rooms);
}

views.devices = function () {
  const scenes = Object.entries(SCENES).map(([k, s]) => `<button class="btn" data-scene="${k}">${s.label}</button>`).join("");
  let body = state.devices.length
    ? groupByRoom(state.devices).map(([room, list]) => `<h3 class="room-title">${esc(room)}</h3><div class="device-grid">${list.map(deviceCard).join("")}</div>`).join("")
    : `<div class="panel empty">لا توجد أجهزة بعد. أضف جهازًا أو حمّل البيانات التجريبية من الإعدادات.</div>`;
  if (haConnected()) body = state.devices.length ? `<h3 class="room-title">أجهزة تجريبية (محاكاة)</h3>${body}` : "";
  return header("الأجهزة الذكية", "devices") + `
    <div class="panel"><h3>المشاهد السريعة</h3><div class="toolbar">${scenes}</div></div>
    ${haDevicesSection()}
    ${body}
    ${state.devices.length ? `<p class="muted small">ملاحظة: الأجهزة التجريبية محاكاة ولا تتحكم بأجهزة حقيقية.</p>` : ""}`;
};

// ===== الطقس (Open-Meteo مجاني دون مفتاح) =====
let weatherCache = null;
let weatherError = "";
let weatherLoading = false;
let weatherAttemptAt = 0;

const WEATHER_CODES = {
  0: ["☀️", "صافٍ"], 1: ["🌤️", "صافٍ غالبًا"], 2: ["⛅", "غائم جزئيًا"], 3: ["☁️", "غائم"],
  45: ["🌫️", "ضباب"], 48: ["🌫️", "ضباب"], 51: ["🌦️", "رذاذ خفيف"], 53: ["🌦️", "رذاذ"], 55: ["🌦️", "رذاذ كثيف"],
  61: ["🌧️", "مطر خفيف"], 63: ["🌧️", "مطر"], 65: ["🌧️", "مطر غزير"], 71: ["🌨️", "ثلج خفيف"], 73: ["🌨️", "ثلج"], 75: ["❄️", "ثلج كثيف"],
  80: ["🌦️", "زخات مطر"], 81: ["🌧️", "زخات مطر"], 82: ["⛈️", "زخات غزيرة"], 95: ["⛈️", "عاصفة رعدية"], 96: ["⛈️", "عاصفة مع برد"], 99: ["⛈️", "عاصفة مع برد"],
};
const weatherInfo = (code) => WEATHER_CODES[code] || ["🌡️", "—"];

async function loadWeather(force = false) {
  if (weatherLoading) return;
  if (!force && weatherCache && Date.now() - weatherCache.fetchedAt < 30 * 60000) return;
  // بعد فشل المحاولة لا نعيد الطلب تلقائيًا قبل 5 دقائق
  if (!force && !weatherCache && weatherError && Date.now() - weatherAttemptAt < 5 * 60000) return;
  weatherAttemptAt = Date.now();
  weatherLoading = true;
  weatherError = "";
  try {
    const city = state.settings.city;
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar`).then((r) => r.json());
    const place = geo.results?.[0];
    if (!place) throw new Error(`لم يتم العثور على مدينة "${city}"`);
    const params = "current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5";
    const data = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&${params}`).then((r) => r.json());
    if (!data.current) throw new Error("استجابة غير متوقعة من خدمة الطقس");
    weatherCache = { place: place.name, current: data.current, daily: data.daily, fetchedAt: Date.now() };
  } catch (e) {
    weatherError = e.message && !/fetch|network/i.test(e.message) ? e.message : "تعذر الاتصال بخدمة الطقس";
  } finally {
    weatherLoading = false;
    if (["monitor", "dashboard"].includes(currentView)) render();
  }
}

function weatherPanel() {
  if (!weatherCache) {
    return `<div class="panel weather"><h3>الطقس</h3><p class="muted">${weatherLoading ? "جارٍ التحميل..." : esc(weatherError) || "جارٍ التحميل..."}</p>
      ${weatherError ? `<button class="btn sm" data-action="weather">إعادة المحاولة</button>` : ""}</div>`;
  }
  const { current: c, daily, place } = weatherCache;
  const [icon, desc] = weatherInfo(c.weather_code);
  const days = daily.time.map((day, i) => {
    const [di] = weatherInfo(daily.weather_code[i]);
    const name = i === 0 ? "اليوم" : new Date(day + "T00:00:00").toLocaleDateString("ar-EG", { weekday: "short" });
    return `<div class="forecast-day"><div class="muted">${name}</div><div class="forecast-icon">${di}</div><div>${Math.round(daily.temperature_2m_max[i])}° / <span class="muted">${Math.round(daily.temperature_2m_min[i])}°</span></div></div>`;
  }).join("");
  return `<div class="panel weather">
      <div class="view-header"><h3>الطقس في ${esc(place)}</h3><button class="btn sm" data-action="weather">🔄</button></div>
      <div class="weather-now"><span class="weather-icon">${icon}</span>
        <div><div class="weather-temp">${Math.round(c.temperature_2m)}°</div><div>${desc}</div></div>
        <ul class="list weather-meta">
          <li><span class="muted">الإحساس</span><span>${Math.round(c.apparent_temperature)}°</span></li>
          <li><span class="muted">الرطوبة</span><span>${c.relative_humidity_2m}%</span></li>
          <li><span class="muted">الرياح</span><span>${Math.round(c.wind_speed_10m)} كم/س</span></li>
        </ul>
      </div>
      <div class="forecast">${days}</div>
    </div>`;
}

// ===== المراقبة =====
function smartAlerts() {
  const alerts = [];
  state.devices.filter((d) => d.type === "lock" && !d.on).forEach((d) => alerts.push(["danger", `🔓 ${d.name} مفتوح`]));
  state.devices.filter((d) => d.type === "heater" && d.on).forEach((d) => alerts.push(["warn", `♨️ ${d.name} يعمل (استهلاك مرتفع)`]));
  state.devices.filter((d) => d.type === "sensor").forEach((d) => {
    const r = sensorReading(d);
    if (r.t > 28) alerts.push(["warn", `🌡️ الحرارة مرتفعة في ${d.room} (${r.t.toFixed(1)}°)`]);
    if (r.h > 65) alerts.push(["warn", `💧 الرطوبة مرتفعة في ${d.room}`]);
  });
  const outside = weatherCache?.current.temperature_2m;
  if (outside > 35 && !state.devices.some((d) => d.type === "ac" && d.on)) alerts.push(["warn", `☀️ الحرارة في الخارج ${Math.round(outside)}° والمكيفات مطفأة`]);
  if (state.devices.some((d) => d.type === "curtain" && d.on) && new Date().getHours() >= 20) alerts.push(["", "🪟 بعض الستائر مفتوحة ليلًا"]);
  return alerts;
}

views.monitor = function () {
  loadWeather();
  const hs = haSummary();
  const on = state.devices.filter((d) => d.on && !["lock", "sensor"].includes(d.type));
  const controllable = state.devices.filter((d) => !["lock", "sensor"].includes(d.type)).length + hs.controllable.length;
  const locks = state.devices.filter((d) => d.type === "lock");
  const openLocks = locks.filter((l) => !l.on).length + hs.openLocks.length;
  const lockCount = locks.length + (hs.locks?.length || 0);
  const sensors = state.devices.filter((d) => d.type === "sensor");
  const power = totalPower() + hs.power;
  const alerts = [...hs.alerts, ...smartAlerts()];
  return `<div class="view-header"><h2>المراقبة والطقس</h2></div>
    <div class="cards">
      <div class="card"><div class="label">أجهزة تعمل الآن</div><div class="value">${on.length + hs.on.length} / ${controllable}</div></div>
      <div class="card"><div class="label">الاستهلاك الحالي</div><div class="value">${Math.round(power)} واط</div></div>
      <div class="card"><div class="label">التكلفة الشهرية التقديرية</div><div class="value">${money(monthlyCost(power))}</div></div>
      <div class="card ${openLocks ? "danger" : "ok"}"><div class="label">الأقفال</div><div class="value">${lockCount ? (openLocks ? `${openLocks} مفتوح` : "كلها مقفلة") : "—"}</div></div>
    </div>
    <div class="grid-2">
      ${weatherPanel()}
      <div class="panel"><h3>التنبيهات</h3>
        ${alerts.length ? `<ul class="list">${alerts.map(([cls, text]) => `<li class="alert ${cls}">${esc(text)}</li>`).join("")}</ul>` : `<p class="muted">لا توجد تنبيهات ✅</p>`}
      </div>
      <div class="panel"><h3>حساسات الغرف</h3>
        ${sensors.length || hs.sensors.length ? `<ul class="list">
          ${hs.sensors.map((e) => `<li><span>${haIcon(e)} ${esc(haName(e))}</span><bdi>${esc(haStateLabel(e))}</bdi></li>`).join("")}
          ${sensors.map((d) => `<li><span>${esc(d.room)} <span class="muted">(تجريبي)</span></span>${deviceStatus(d)}</li>`).join("")}
        </ul>` : `<p class="muted">لا توجد حساسات</p>`}
      </div>
      <div class="panel"><h3>الأجهزة العاملة</h3>
        ${on.length || hs.on.length ? `<ul class="list">
          ${hs.on.map((e) => `<li><span>${haIcon(e)} ${esc(haName(e))}</span><span class="badge ha">HA</span></li>`).join("")}
          ${on.map((d) => `<li><span>${devType(d).icon} ${esc(d.name)} <span class="muted">· ${esc(d.room)}</span></span><span class="muted">${Math.round(devicePower(d))} واط</span></li>`).join("")}
        </ul>` : `<p class="muted">كل الأجهزة مطفأة</p>`}
      </div>
      <div class="panel"><h3>الكاميرات</h3>
        ${state.cameras.length ? `<ul class="list">${state.cameras.map((c) => `<li><span>📹 ${esc(c.name)}</span>${cameraBadge(c)}</li>`).join("")}</ul><button class="btn sm" data-goto="babycam">فتح كاميرا الأطفال</button>` : `<p class="muted">لا توجد كاميرات</p>`}
      </div>
      <div class="panel"><h3>سجل النشاط</h3>
        ${state.deviceLog.length ? `<ul class="list log">${state.deviceLog.slice(0, 12).map((l) => `<li><span>${esc(l.text)}</span><span class="muted">${esc(l.time)}</span></li>`).join("")}</ul>` : `<p class="muted">لا يوجد نشاط بعد</p>`}
      </div>
    </div>`;
};

function dashboardSmartCards() {
  loadWeather();
  const on = state.devices.filter((d) => d.on && !["lock", "sensor"].includes(d.type)).length + haSummary().on.length;
  const w = weatherCache ? `${weatherInfo(weatherCache.current.weather_code)[0]} ${Math.round(weatherCache.current.temperature_2m)}°` : "—";
  return `<div class="card"><div class="label">الطقس${weatherCache ? " في " + esc(weatherCache.place) : ""}</div><div class="value">${w}</div></div>
    <div class="card"><div class="label">أجهزة ذكية تعمل</div><div class="value">${on}</div></div>`;
}

// ===== كاميرا الأطفال =====
let camStream = null;
let camError = "";
const camUi = {}; // حالة كل كاميرا: { night, motion, sensitivity, lastMotion }
const motionState = { prev: null, timer: null, lastAlert: 0 };
const motionLog = [];
const ui = (id) => (camUi[id] ??= { night: false, motion: false, sensitivity: 3, lastMotion: 0 });

function cameraBadge(c) {
  if (c.source === "ha") return haConnected() && ha.states[c.entity] ? `<span class="badge ok">● HA</span>` : `<span class="badge">غير متصلة</span>`;
  if (c.source === "device") return camStream ? `<span class="badge ok">● مباشر</span>` : `<span class="badge">متوقفة</span>`;
  return c.url ? `<span class="badge ok">● شبكة</span>` : `<span class="badge">بلا رابط</span>`;
}

async function startDeviceCamera() {
  camError = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    camError = "المتصفح لا يدعم الوصول إلى الكاميرا.";
  } else {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      camError = e.name === "NotAllowedError" ? "تم رفض إذن الكاميرا. اسمح بالوصول من إعدادات المتصفح." : "تعذر تشغيل الكاميرا على هذا الجهاز.";
    }
  }
  render();
}

function stopDeviceCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  render();
}

function camUrl(c) {
  if (c.refresh === "0" || !c.refresh) return c.url;
  return c.url + (c.url.includes("?") ? "&" : "?") + "_t=" + Date.now();
}

function cameraTile(c) {
  const u = ui(c.id);
  const sensor = state.devices.find((d) => d.type === "sensor" && d.room === c.room);
  let media;
  if (c.source === "device") {
    media = camStream
      ? `<video data-cam-video="${c.id}" autoplay playsinline muted></video>`
      : `<div class="cam-placeholder"><p>${esc(camError) || "الكاميرا متوقفة"}</p><button class="btn primary" data-cam-start>▶️ تشغيل الكاميرا</button></div>`;
  } else if (c.source === "ha") {
    const src = haConnected() ? haCameraSrc(c.entity) : "";
    media = src
      ? `<img data-cam-ha="${c.id}" src="${esc(src)}" alt="${esc(c.name)}">`
      : `<div class="cam-placeholder"><p>${!haConnected() ? "Home Assistant غير متصل" : !c.entity ? "اختر كاميرا Home Assistant من زر التعديل ✏️" : "الكاميرا غير موجودة في Home Assistant"}</p></div>`;
  } else if (c.url) {
    media = `<img data-cam-img="${c.id}" src="${esc(camUrl(c))}" alt="${esc(c.name)}" data-error-msg="تعذر تحميل البث. تأكد من الرابط وأن الجهاز على نفس الشبكة.">`;
  } else {
    media = `<div class="cam-placeholder"><p>أضف رابط بث الكاميرا من زر التعديل ✏️</p></div>`;
  }
  const motionOk = c.source === "device" && camStream;
  return `<div class="panel cam-tile">
    <div class="view-header"><h3>📹 ${esc(c.name)}</h3><span>${cameraBadge(c)} ${actions("cameras", c.id)}</span></div>
    <div class="cam-view ${u.night ? "night" : ""}" data-cam-box="${c.id}">
      ${media}
      <div class="cam-overlay">
        <span class="cam-time" data-cam-clock>${new Date().toLocaleTimeString("ar-EG")}</span>
        ${sensor ? `<span class="cam-sensor">🌡️ <span data-sensor="${sensor.id}">${sensorReading(sensor).t.toFixed(1)}° · ${Math.round(sensorReading(sensor).h)}%</span></span>` : ""}
        <span class="cam-motion" data-motion-badge="${c.id}" hidden>⚠️ حركة!</span>
      </div>
    </div>
    <div class="toolbar cam-controls">
      <button class="btn sm ${u.night ? "primary" : ""}" data-cam-night="${c.id}">🌙 الرؤية الليلية</button>
      <button class="btn sm" data-cam-full="${c.id}">⛶ ملء الشاشة</button>
      ${c.source === "device" && camStream ? `<button class="btn sm" data-cam-stop>⏹️ إيقاف</button>` : ""}
      ${motionOk ? `<button class="btn sm ${u.motion ? "primary" : ""}" data-cam-motion="${c.id}">🚨 كشف الحركة ${u.motion ? "مفعل" : ""}</button>
        <label class="muted small">الحساسية <input type="range" min="1" max="5" value="${u.sensitivity}" data-cam-sens="${c.id}"></label>` : ""}
    </div>
  </div>`;
}

views.babycam = function () {
  const tiles = state.cameras.length
    ? `<div class="cam-grid">${state.cameras.map(cameraTile).join("")}</div>`
    : `<div class="panel empty">لا توجد كاميرات. أضف كاميرا للبدء.</div>`;
  return header("كاميرا الأطفال", "cameras") + tiles + `
    <div class="panel"><h3>سجل الحركة</h3>
      ${motionLog.length ? `<ul class="list">${motionLog.slice(0, 10).map((m) => `<li><span>⚠️ حركة في ${esc(m.name)}</span><span class="muted">${esc(m.time)}</span></li>`).join("")}</ul>` : `<p class="muted">لم تُرصد حركة</p>`}
    </div>
    <div class="panel muted small">
      <strong>طريقتان للاستخدام:</strong><br>
      • <strong>كاميرا هذا الجهاز:</strong> ضع هاتفًا أو حاسوبًا قديمًا في غرفة الطفل وافتح التطبيق عليه، ثم شغّل كشف الحركة لتنبيهك بصوت عند تحرك الطفل.<br>
      • <strong>كاميرا شبكة:</strong> أدخل رابط البث من كاميرا IP (مثل <code>http://192.168.1.20:8080/video</code>). يجب أن يكون الجهاز على نفس شبكة المنزل. المتصفحات تمنع روابط http داخل صفحة https، لذلك شغّل التطبيق محليًا عند استخدام هذا النوع.
    </div>`;
};

// يُعاد ربط البث بعد كل رسم لأن الرسم يستبدل عناصر الصفحة
afterRenderHooks.push(() => {
  document.querySelectorAll("[data-cam-video]").forEach((v) => (v.srcObject = camStream));
  document.querySelectorAll("[data-cam-img]").forEach((img) => {
    img.onerror = () => {
      img.replaceWith(Object.assign(document.createElement("div"), { className: "cam-placeholder", textContent: img.dataset.errorMsg }));
    };
  });
  document.querySelectorAll("[data-cam-ha]").forEach((img) => {
    img.onerror = () => {
      img.replaceWith(Object.assign(document.createElement("div"), { className: "cam-placeholder", innerHTML: `<p>تعذر تحميل بث الكاميرا</p><button class="btn" data-goto="babycam">إعادة المحاولة</button>` }));
    };
  });
  manageMotion();
});

// تحديث صور الكاميرات والساعة دون إعادة رسم الصفحة
setInterval(() => {
  document.querySelectorAll("[data-cam-clock]").forEach((el) => (el.textContent = new Date().toLocaleTimeString("ar-EG")));
  const now = Date.now();
  document.querySelectorAll("[data-cam-img]").forEach((img) => {
    const c = state.cameras.find((x) => x.id === img.dataset.camImg);
    const every = Number(c?.refresh) * 1000;
    if (every && now - (Number(img.dataset.loadedAt) || 0) >= every) {
      img.dataset.loadedAt = now;
      img.src = camUrl(c);
    }
  });
}, 1000);

// كشف الحركة: مقارنة إطارات مصغرة متتالية
function manageMotion() {
  const cam = state.cameras.find((c) => c.source === "device" && ui(c.id).motion);
  const active = cam && camStream;
  if (!active) {
    clearInterval(motionState.timer);
    motionState.timer = null;
    motionState.prev = null;
    return;
  }
  if (motionState.timer) return;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  motionState.timer = setInterval(() => {
    const video = document.querySelector(`[data-cam-video="${cam.id}"]`);
    if (!video || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, 64, 48);
    const frame = ctx.getImageData(0, 0, 64, 48).data;
    const gray = new Uint8Array(64 * 48);
    for (let i = 0; i < gray.length; i++) gray[i] = (frame[i * 4] + frame[i * 4 + 1] + frame[i * 4 + 2]) / 3;
    if (motionState.prev) {
      let changed = 0;
      for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - motionState.prev[i]) > 25) changed++;
      // الحساسية 5 = يكفي تغير 1% من الإطار، الحساسية 1 = 9%
      const threshold = (11 - ui(cam.id).sensitivity * 2) / 100;
      if (changed / gray.length > threshold) onMotion(cam);
    }
    motionState.prev = gray;
  }, 500);
}

function onMotion(cam) {
  const badge = document.querySelector(`[data-motion-badge="${cam.id}"]`);
  if (badge) {
    badge.hidden = false;
    clearTimeout(badge.timer);
    badge.timer = setTimeout(() => (badge.hidden = true), 3000);
  }
  const now = Date.now();
  if (now - motionState.lastAlert < 10000) return;
  motionState.lastAlert = now;
  motionLog.unshift({ name: cam.name, time: new Date().toLocaleTimeString("ar-EG") });
  motionLog.splice(20);
  beep();
}

let audioCtx = null;
function beep() {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch {
    // الصوت غير متاح؛ يكفي التنبيه المرئي
  }
}

// ===== الأحداث =====
$("#main").addEventListener("click", (e) => {
  const t = e.target.closest("button, input[type=checkbox]");
  if (!t) return;
  const d = t.dataset;
  if (d.toggleDevice) toggleDevice(d.toggleDevice);
  else if (d.scene) applyScene(d.scene);
  else if (d.action === "weather") { weatherCache = null; loadWeather(true); render(); }
  else if (d.goto) { currentView = d.goto; render(); }
  else if ("camStart" in d) startDeviceCamera();
  else if ("camStop" in d) stopDeviceCamera();
  else if (d.camNight) { ui(d.camNight).night = !ui(d.camNight).night; render(); }
  else if (d.camMotion) { ui(d.camMotion).motion = !ui(d.camMotion).motion; render(); }
  else if (d.camFull) {
    const box = $(`[data-cam-box="${d.camFull}"]`);
    (box.requestFullscreen?.() ?? Promise.reject()).catch(() => toast("ملء الشاشة غير متاح هنا"));
  }
});

$("#main").addEventListener("change", (e) => {
  const d = e.target.dataset;
  if (d.deviceValue) setDeviceValue(d.deviceValue, e.target.value);
  else if (d.camSens) ui(d.camSens).sensitivity = Number(e.target.value);
});

function demoSmartData() {
  const dev = (name, type, room, on, value) => ({ id: uid(), name, type, room, on, value: value ?? DEVICE_TYPES[type].range?.def ?? "", power: DEVICE_TYPES[type].power ?? 0 });
  return {
    devices: [
      dev("إضاءة الصالة", "light", "الصالة", true, 70),
      dev("مكيف الصالة", "ac", "الصالة", true, 23),
      dev("التلفاز", "tv", "الصالة", false),
      dev("ستارة الصالة", "curtain", "الصالة", true, 60),
      dev("حساس الصالة", "sensor", "الصالة", false),
      dev("الباب الرئيسي", "lock", "المدخل", true),
      dev("إضاءة المدخل", "light", "المدخل", false, 100),
      dev("مكيف غرفة الأطفال", "ac", "غرفة الأطفال", true, 24),
      dev("إضاءة ليلية", "light", "غرفة الأطفال", true, 15),
      dev("حساس غرفة الأطفال", "sensor", "غرفة الأطفال", false),
      dev("الغسالة", "washer", "المطبخ", false),
      dev("سخان الماء", "heater", "الحمام", false),
      dev("باب المطبخ الخلفي", "lock", "المطبخ", false),
    ],
    cameras: [{ id: uid(), name: "غرفة الأطفال", room: "غرفة الأطفال", source: "device", url: "", refresh: "0" }],
    deviceLog: [],
  };
}
