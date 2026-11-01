---
name: home-assistant-app
description: Develop, fix, test, and deploy this repo's Arabic home-management PWA ("نظام إدارة المنزل") and its Home Assistant / Sonoff (eWeLink) integration. Use for any change to app.js, smart.js, ha.js, style.css, index.html, sw.js, adding a new device type or Home Assistant entity domain, scenes, the baby camera, weather, or when asked to run/test/deploy the app. Triggers on Arabic requests too, e.g. "أضف جهاز", "Home Assistant", "سونوف", "الكاميرا", "انشر التطبيق".
---

# تطوير تطبيق إدارة المنزل وربط Home Assistant

## بنية المشروع
تطبيق JavaScript خام بدون أي أداة بناء أو مكتبات أو `package.json`. الملفات تُخدَّم كما هي.

- `index.html` يحمّل ثلاثة سكربتات **بهذا الترتيب** وكلها تتشارك النطاق العام (global scope):
  1. `app.js`: الحالة `state` والتخزين و`render()` و`views` والنماذج (`ENTITIES`) والأدوات (`$`, `esc`, `money`, `toast`, `uid`).
  2. `smart.js`: الأجهزة التجريبية (`DEVICE_TYPES`, `SCENES`) والطقس (Open-Meteo) وكاميرا الأطفال. يعرّف `views.devices` و`views.monitor` و`views.babycam`.
  3. `ha.js`: اتصال WebSocket مع Home Assistant. يغلّف الواجهات الموجودة بدل تعديلها (مثال: `views.settings = () => baseSettingsView() + haSettingsPanel()`).
- الملف اللاحق يستخدم دوال الملف السابق، فلا تستدعِ من `app.js` دالةً معرّفة في `ha.js` أثناء التحميل.

## قواعد كتابة الكود
- **الحالة:** عدّل `state` ثم استدعِ `save()` ثم `render()`. أي حقل جديد يُضاف في `defaultState()`، لأن `mergeState()` يكمل به بيانات المستخدمين القديمة. لا تغيّر `STORAGE_KEY` (`homeManager.v1`) لأن ذلك يمسح بيانات المستخدمين فعليًا.
- **إعدادات HA منفصلة** في `homeManager.ha` (`ha.config`، `saveHaConfig()`). رمز الوصول يعطي تحكمًا كاملًا بالبيت، لذلك لا يُوضع أبدًا في `state` ولا يدخل ملف التصدير ولا يُكتب في سجل أو رسالة.
- **HTML:** الواجهة تُبنى من template strings. مرّر كل نص من المستخدم أو من HA (مثل `friendly_name` و`entity_id`) عبر `esc()` لتجنب XSS.
- **الأحداث:** تُفوَّض كلها على `#main` عبر خصائص `data-*` (مثل `data-ha-toggle` و`data-action`). لا تضف مستمع أحداث على كل عنصر.
- **النصوص:** كل نصوص الواجهة والتعليقات بالعربية والاتجاه RTL. استخدم `<bdi>` حول القيم المختلطة (أرقام ووحدات). المبالغ تُعرض عبر `money()` وليس برمز عملة ثابت (LYD/USD).
- **الأسلوب:** `"use strict"`، ودوال قصيرة، وأسماء دوال HA تبدأ بـ `ha`. التزم بالحد الأدنى من التغيير.

## Home Assistant (`ha.js`)
- الطلبات تمر عبر `haSend({type, ...})`، وهو Promise بمعرّف `id` ومهلة 15 ثانية. الأوامر تمر عبر `haCall(domain, service, entityIds, data)` الذي يعرض `toast` عند الفشل.
- التحديث الفوري يتم بالاشتراك في `state_changed` ثم `haOnStateChanged`، وإعادة الرسم مؤجلة عبر `haScheduleRender()` حتى لا يقفز المنزلق أثناء السحب.
- الغرف تأتي من سجلات area/device/entity، وهذه تحتاج حساب مدير. عند غيابها تعمل الأجهزة دون غرف ولا يجوز أن يتعطل التطبيق.
- **لإضافة نوع كيان جديد** (مثل `media_player` أو `vacuum`):
  1. أضفه في `HA_DOMAINS` (مع `readOnly: true` إن كان للقراءة فقط).
  2. حدّث `haIsOn` و`haStateLabel` بالعربية.
  3. أضف الخدمة المناسبة في `haToggle`، وفي `haSetValue` و`haSlider` إن كان له منزلق.
  4. أضف كيانًا وهميًا له في `scripts/smoke-test.js`.
- **قواعد أمان ثابتة لا تُكسر:**
  - فتح القفل يطلب `confirm()`.
  - مشهد «مغادرة المنزل» لا يطفئ `switch`، لأن المقابس قد تغذي الثلاجة أو الراوتر.
  - صفحة `https` لا تتصل بعنوان HA يبدأ بـ `http` (المتصفح يمنع ذلك)، فاعرض للمستخدم رسالة توضّح الحل ولا تحاول الالتفاف على هذا المنع.

## PWA (`sw.js`)
عند إضافة ملف جديد يحتاجه التطبيق، أضفه إلى `FILES` وإلى `<script>`/`<link>` في `index.html`. وعند أي تغيير في قائمة الملفات ارفع رقم `CACHE` (`home-manager-v1` ← `v2`). الطلبات الخارجية (الطقس و HA) لا تُخزَّن ويجب أن تبقى كذلك.

## التحقق قبل كل commit
```bash
node --check app.js smart.js ha.js sw.js
python3 -m http.server 8765 &   # في جذر المستودع
node .claude/skills/home-assistant-app/scripts/smoke-test.js http://localhost:8765
```
اختبار الدخان يستبدل `WebSocket` بخادم Home Assistant وهمي، ثم يفتح كل الصفحات، ويتأكد من ظهور الكيانات، ومن أن الضغط على الإضاءة يرسل `light.turn_on`، ومن عدم وجود أخطاء في الصفحة. يجب أن يطبع `PASS`.
- لا يوجد Home Assistant حقيقي ولا أجهزة Sonoff في بيئة السحابة. لا تدّعِ أن تغييرًا اختُبر على أجهزة حقيقية، وقل للمستخدم ما الذي يجب أن يجرّبه في البيت.
- طلبات Open-Meteo قد تُمنع في بيئة السحابة. هذا متوقع والاختبار يتجاهلها.
- بعد الانتهاء أوقف الخادم المحلي.

## التوثيق
- تغيير يراه المستخدم: حدّث قسم المزايا في `README.md`، وجدول الملفات إن أضفت ملفًا.
- تغيير في الإعداد أو الربط مع HA أو Sonoff أو الكاميرا: حدّث `HOME-ASSISTANT.md` (الخطوات وجدول حل المشكلات).

## النشر
Vercel ينشر تلقائيًا من فرع الإنتاج المذكور في `DEPLOY.md` إلى `home.atmata.ly`. الدفع إلى ذلك الفرع ينشر للمستخدمين فورًا، **فاطلب تأكيد المستخدم قبله**. العمل اليومي يكون على فرع التطوير المحدد للجلسة.

## رسائل الـ commit
بالعربية، سطر أول قصير يصف التغيير، على نمط السجل الحالي (مثل «ربط الأجهزة الحقيقية عبر Home Assistant»).
