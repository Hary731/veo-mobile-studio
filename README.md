# Veo Mobile Studio + Telegram

نسخة مناسبة للاستخدام من الموبايل: واجهة ويب + سيرفر Node.js + Veo API + Telegram Bot API.

## مهم قبل التشغيل
- لا تضع أي API key أو Bot Token داخل `public/index.html`.
- استخدم متغيرات البيئة فقط.
- رابط Telegram Bot API المستخدم في السيرفر هو `https://api.telegram.org`، والوثائق الرسمية: https://core.telegram.org/bots/api
- لا تضع التوكن الحقيقي داخل GitHub أو أي ملف عام.

## Veo
النسخة الحالية تستخدم `veo-3.1-generate-preview` وتدعم 4 أو 6 أو 8 ثوانٍ. خيار 12 ثانية غير موجود لأن واجهة Veo الحالية لا تقبله.

## النشر من الموبايل
يمكن نشر المشروع على خدمة Node.js تدعم Git/repository. ملف `render.yaml` موجود لتسهيل النشر على Render.

بعد إنشاء الخدمة، أضف متغيرات البيئة:
- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `PUBLIC_URL` = رابط الخدمة الكامل مثل `https://your-app.onrender.com`

عند وجود `PUBLIC_URL` يستخدم البوت Telegram webhook تلقائيًا على:
`/telegram/webhook`

إذا تركت `PUBLIC_URL` فارغًا، يعمل البوت محليًا باستخدام long polling.

## تشغيل محلي
```bash
npm install
npm start
```
ثم افتح:
`http://localhost:3000`

## الوظائف
- رفع صورة من الهاتف
- 4 / 6 / 8 ثوانٍ
- Prompt
- Image-to-video عبر Veo
- مشاهدة الفيديو
- تنزيل الفيديو
- Telegram bot: /start ثم اختيار المدة ثم الصورة ثم Prompt
