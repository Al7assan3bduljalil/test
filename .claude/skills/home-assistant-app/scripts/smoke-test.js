// اختبار دخان: يشغّل التطبيق في Chromium مع Home Assistant وهمي ويتأكد من عدم وجود أخطاء.
// الاستخدام: node .claude/skills/home-assistant-app/scripts/smoke-test.js [http://localhost:8000]
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8000";

// كيانات وهمية تحاكي ما يرسله Home Assistant (Sonoff عبر SonoffLAN)
const FAKE_STATES = [
  { entity_id: "switch.sonoff_plug", state: "on", attributes: { friendly_name: "مقبس الثلاجة" } },
  { entity_id: "light.living_room", state: "off", attributes: { friendly_name: "إضاءة الصالة", brightness: 0 } },
  { entity_id: "lock.front_door", state: "locked", attributes: { friendly_name: "الباب الأمامي" } },
  { entity_id: "sensor.th_temperature", state: "24.5", attributes: { friendly_name: "حرارة غرفة النوم", device_class: "temperature", unit_of_measurement: "°C" } },
  { entity_id: "sensor.pow_power", state: "120", attributes: { friendly_name: "استهلاك المكيف", device_class: "power", unit_of_measurement: "W" } },
];

function fakeHomeAssistant(states) {
  window.__haCalls = [];
  class FakeWS {
    constructor() {
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.emit({ type: "auth_required" }); }, 10);
    }
    emit(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
    send(raw) {
      const m = JSON.parse(raw);
      if (m.type === "auth") return this.emit({ type: "auth_ok" });
      const results = {
        get_states: states,
        "config/area_registry/list": [{ area_id: "living", name: "الصالة" }],
        "config/device_registry/list": [],
        "config/entity_registry/list": [{ entity_id: "light.living_room", area_id: "living" }],
      };
      if (m.type === "call_service") window.__haCalls.push(m);
      setTimeout(() => this.emit({ id: m.id, type: "result", success: true, result: results[m.type] ?? null }), 5);
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  FakeWS.OPEN = 1;
  window.WebSocket = FakeWS;
  localStorage.setItem("homeManager.ha", JSON.stringify({ url: "http://homeassistant.local:8123", token: "test-token", hidden: [] }));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/open-meteo|Failed to load resource/i.test(m.text()) && errors.push("console: " + m.text()));
  await page.addInitScript(fakeHomeAssistant, FAKE_STATES);
  await page.goto(BASE + "/index.html");

  const views = await page.$$eval("#sidebar button[data-view]", (bs) => bs.map((b) => b.dataset.view));
  for (const v of views) {
    await page.click(`#sidebar button[data-view="${v}"]`, { force: true });
    await page.waitForTimeout(150);
  }

  await page.click('#sidebar button[data-view="devices"]', { force: true });
  await page.waitForTimeout(300);
  const badge = (await page.textContent("#haBadge")) || "";
  const shown = await page.$$eval("[data-ha-toggle]", (els) => els.map((e) => e.dataset.haToggle));
  if (!badge.includes("Home Assistant")) errors.push("شارة الاتصال لا تظهر: " + badge);
  if (!shown.includes("light.living_room")) errors.push("الكيانات الوهمية لم تظهر في الأجهزة الذكية");
  else {
    await page.click('label.switch:has([data-ha-toggle="light.living_room"])');
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__haCalls);
    if (!calls.some((c) => c.domain === "light" && c.service === "turn_on")) errors.push("الضغط على الإضاءة لم يرسل light.turn_on");
  }

  await browser.close();
  console.log(`views: ${views.join(", ")}`);
  console.log(`HA entities rendered: ${shown.length}`);
  if (errors.length) {
    console.error("FAIL\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("PASS");
})();
