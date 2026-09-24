import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Server-only secrets. Never put these in public/index.html.
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");

if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const TG = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const TG_FILE = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const generatedDir = path.join(__dirname, "generated");
fs.mkdirSync(generatedDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/generated", express.static(generatedDir));

async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

async function tgMultipart(method, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Blob) form.append(key, value, "video.mp4");
    else form.append(key, String(value));
  }
  const r = await fetch(`${TG}/${method}`, { method: "POST", body: form });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

async function downloadTelegramFile(fileId) {
  const info = await tg("getFile", { file_id: fileId });
  if (!info.file_path) throw new Error("Telegram did not return file_path");
  const r = await fetch(`${TG_FILE}/${info.file_path}`);
  if (!r.ok) throw new Error("Could not download Telegram image");
  const buffer = Buffer.from(await r.arrayBuffer());
  const ext = path.extname(info.file_path).toLowerCase() || ".jpg";
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return { buffer, mime };
}

async function generateVeo({ imageBuffer, mimeType, prompt, duration }) {
  const seconds = Number(duration);
  // Current Veo 3.1 API supports 4, 6 or 8 seconds. 12 seconds is not a valid duration.
  if (![4, 6, 8].includes(seconds)) {
    throw new Error("المدة المتاحة حاليًا مع Veo هي 4 أو 6 أو 8 ثوانٍ.");
  }

  const operation = await ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt,
    image: {
      imageBytes: imageBuffer.toString("base64"),
      mimeType
    },
    config: {
      durationSeconds: seconds,
      aspectRatio: "16:9",
      numberOfVideos: 1
    }
  });

  let op = operation;
  while (!op.done) {
    await new Promise(r => setTimeout(r, 10000));
    op = await ai.operations.getVideosOperation({ operation: op });
  }

  const generated = op.response?.generatedVideos?.[0]?.video;
  if (!generated) throw new Error("Veo returned no video");

  const filename = `veo-${Date.now()}.mp4`;
  const outputPath = path.join(generatedDir, filename);
  await ai.files.download({ file: generated, downloadPath: outputPath });

  const publicBase = PUBLIC_URL || "";
  return {
    filename,
    outputPath,
    url: `${publicBase}/generated/${filename}`
  };
}

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "اختر صورة أولاً." });
    const prompt = String(req.body.prompt || "").trim();
    const duration = String(req.body.duration || "8");
    if (!prompt) return res.status(400).json({ error: "اكتب Prompt أولاً." });

    const result = await generateVeo({
      imageBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
      prompt,
      duration
    });

    res.json({ success: true, videoUrl: result.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Generation failed" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Telegram bot session state. For a single-instance deployment this is enough.
const sessions = new Map();
function session(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, { duration: "8", photo: null });
  return sessions.get(chatId);
}

async function sendDurationMenu(chatId) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: "🎬 Veo Image → Video\n\nأرسل الصورة، ثم الـPrompt. اختر المدة:",
    reply_markup: {
      inline_keyboard: [[
        { text: "4 ثوانٍ", callback_data: "dur_4" },
        { text: "6 ثوانٍ", callback_data: "dur_6" },
        { text: "8 ثوانٍ", callback_data: "dur_8" }
      ]]
    }
  });
}

async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    const q = update.callback_query;
    const chatId = q.message?.chat?.id;
    const seconds = q.data?.match(/^dur_(4|6|8)$/)?.[1];
    if (!chatId || !seconds) return;
    session(chatId).duration = seconds;
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: `تم اختيار ${seconds} ثوانٍ` });
    await tg("sendMessage", { chat_id: chatId, text: `✅ المدة: ${seconds} ثوانٍ.\nالآن أرسل الصورة 📷` });
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const s = session(chatId);

  if (msg.text === "/start" || msg.text === "/reset") {
    s.duration = "8";
    s.photo = null;
    await sendDurationMenu(chatId);
    return;
  }

  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    s.photo = largest.file_id;
    await tg("sendMessage", {
      chat_id: chatId,
      text: `✅ تم استلام الصورة.\nالمدة: ${s.duration} ثوانٍ.\n\nالآن أرسل الـPrompt.`
    });
    return;
  }

  if (msg.text && !msg.text.startsWith("/")) {
    if (!s.photo) {
      await tg("sendMessage", { chat_id: chatId, text: "أرسل الصورة أولاً 📷" });
      return;
    }

    await tg("sendMessage", {
      chat_id: chatId,
      text: "⏳ جاري إنشاء الفيديو بواسطة Veo..."
    });

    try {
      const image = await downloadTelegramFile(s.photo);
      const result = await generateVeo({
        imageBuffer: image.buffer,
        mimeType: image.mime,
        prompt: msg.text,
        duration: s.duration
      });
      const videoBuffer = fs.readFileSync(result.outputPath);

      if (videoBuffer.length <= 50 * 1024 * 1024) {
        await tgMultipart("sendVideo", {
          chat_id: chatId,
          video: new Blob([videoBuffer], { type: "video/mp4" }),
          caption: "✅ تم إنشاء الفيديو بواسطة Veo."
        });
      } else {
        await tg("sendMessage", {
          chat_id: chatId,
          text: `✅ تم إنشاء الفيديو. استخدم رابط التحميل:\n${result.url}`
        });
      }
      s.photo = null;
    } catch (e) {
      console.error(e);
      await tg("sendMessage", { chat_id: chatId, text: `❌ حدث خطأ:\n${e.message}` });
    }
  }
}

// Public webhook endpoint for online hosting.
app.post("/telegram/webhook", async (req, res) => {
  res.sendStatus(200);
  handleTelegramUpdate(req.body).catch(err => console.error("Telegram webhook error:", err));
});

async function configureTelegram() {
  if (PUBLIC_URL) {
    const webhookUrl = `${PUBLIC_URL}/telegram/webhook`;
    await tg("setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    });
    console.log(`Telegram webhook: ${webhookUrl}`);
  } else {
    // Local fallback: long polling.
    let offset = 0;
    console.log("Telegram long polling started (PUBLIC_URL is empty)");
    while (true) {
      try {
        const updates = await tg("getUpdates", {
          offset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"]
        });
        for (const update of updates) {
          offset = update.update_id + 1;
          handleTelegramUpdate(update).catch(err => console.error("Telegram update error:", err));
        }
      } catch (e) {
        console.error("Telegram polling error:", e.message);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
}

app.listen(PORT, () => {
  console.log(`Web app listening on port ${PORT}`);
  configureTelegram().catch(err => console.error("Telegram setup failed:", err));
});
