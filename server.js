/**
 * Titian Jewelry — WhatsApp AI Assistant (Review Mode)
 * ─────────────────────────────────────────────────────
 * Flow:
 *   1. Customer sends WhatsApp message
 *   2. Claude generates a suggested reply
 *   3. Row logged to Google Sheets (timestamp, customer, message, suggestion, status)
 *   4. NO auto-reply sent — human reviews sheet and replies manually from phone
 *
 * When ready to go fully automated later, flip SEND_REPLIES=true in .env
 */

const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  WA_TOKEN: process.env.WA_TOKEN,
  WA_PHONE_ID: process.env.WA_PHONE_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  SEND_REPLIES: process.env.SEND_REPLIES === "true", // false = review mode (default)
  PORT: process.env.PORT || 3000,
};

// ─── GOOGLE SHEETS AUTH ───────────────────────────────────────────────────────
async function getSheetsClient() {
  const auth = new google.auth.JWT(
    CONFIG.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    CONFIG.GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  return google.sheets({ version: "v4", auth });
}

// ─── LOG TO GOOGLE SHEETS ─────────────────────────────────────────────────────
async function logToSheet(data) {
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: CONFIG.GOOGLE_SHEET_ID,
      range: "Sheet1!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          data.timestamp,        // A: Timestamp (Bali time)
          data.customerPhone,    // B: Customer WhatsApp number
          data.customerName,     // C: Customer name
          data.customerMessage,  // D: What customer said
          data.suggestedReply,   // E: Claude's suggested reply
          "Pending",             // F: Status — change to Replied / Ignored manually
        ]],
      },
    });
    console.log(`📊 Logged to Google Sheets`);
  } catch (error) {
    console.error("❌ Google Sheets error:", error.message);
  }
}

// ─── IN-MEMORY CONVERSATION STORE ────────────────────────────────────────────
const conversations = new Map();

function getHistory(phoneNumber) {
  if (!conversations.has(phoneNumber)) {
    conversations.set(phoneNumber, []);
  }
  return conversations.get(phoneNumber);
}

function addToHistory(phoneNumber, role, content) {
  const history = getHistory(phoneNumber);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a helpful and friendly customer service assistant for Titian Jewelry, a premium jewelry brand based in Bali, Indonesia. You represent TWO sister brands:

1. TITIAN FINE
   - Specializes in GOLD jewelry (18K and 24K)
   - All pieces are MADE-TO-ORDER — custom crafted for each customer
   - Lead time: typically 2-4 weeks depending on design complexity
   - Higher price point, premium positioning
   - Perfect for: engagement rings, wedding bands, heirlooms, special gifts

2. TITIAN JEWELRY
   - Specializes in SILVER jewelry (925 sterling silver)
   - READY STOCK — available for immediate purchase or shipping
   - More accessible price range
   - Perfect for: everyday wear, fashion pieces, gifts

YOUR ROLE:
- Answer questions about both brands clearly
- Help customers identify which brand suits their needs
- Share pricing guidance (collect leads for custom quotes)
- Capture customer contact details (name, what they are looking for) for follow-up
- Speak in whichever language the customer uses — switch naturally between Bahasa Indonesia and English
- Be warm, professional, and reflect Balinese craftsmanship values
- For TITIAN FINE orders: always collect their design idea, occasion, budget range, and contact details
- For TITIAN JEWELRY: guide them to ask about current stock

LEAD COLLECTION:
When a customer shows purchase intent, naturally ask for:
- Their name
- What they are looking for (occasion, style)
- Budget range (asked softly)
- Best contact method

IMPORTANT RULES:
- Never make up specific prices — say harga mulai dari (prices start from) and offer to connect with the team
- For gold pieces, always mention made-to-order with 2-4 week lead time
- Always end with a warm Balinese touch
- Keep messages concise — this is WhatsApp, not email
- Use emojis sparingly but warmly`;

// ─── CLAUDE API CALL ──────────────────────────────────────────────────────────
async function askClaude(phoneNumber, userMessage) {
  addToHistory(phoneNumber, "user", userMessage);
  const history = getHistory(phoneNumber);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history,
    },
    {
      headers: {
        "x-api-key": CONFIG.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    }
  );

  const assistantMessage = response.data.content[0].text;
  addToHistory(phoneNumber, "assistant", assistantMessage);
  return assistantMessage;
}

// ─── SEND WHATSAPP MESSAGE (only when SEND_REPLIES=true) ─────────────────────
async function sendWhatsAppMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${CONFIG.WA_PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${CONFIG.WA_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ─── WEBHOOK VERIFICATION ─────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── INCOMING MESSAGE HANDLER ─────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return;

    const message = value.messages[0];
    const from = message.from;
    const messageType = message.type;
    const contactName = value?.contacts?.[0]?.profile?.name || "Unknown";

    if (messageType !== "text") {
      console.log(`Non-text message from ${from} — skipping`);
      return;
    }

    const userText = message.text.body;
    const timestamp = new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Makassar",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    console.log(`[${timestamp}] ${contactName} (${from}): ${userText}`);

    // Get Claude's suggested reply
    const suggestedReply = await askClaude(from, userText);

    // Log everything to Google Sheets
    await logToSheet({
      timestamp,
      customerPhone: from,
      customerName: contactName,
      customerMessage: userText,
      suggestedReply,
    });

    // Auto-send only if explicitly enabled
    if (CONFIG.SEND_REPLIES) {
      await sendWhatsAppMessage(from, suggestedReply);
      console.log(`Auto-reply sent to ${from}`);
    } else {
      console.log(`Review mode — logged to sheet, not sent to customer`);
    }

  } catch (error) {
    console.error("Error:", error?.response?.data || error.message);
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    brand: "Titian Jewelry Bot",
    mode: CONFIG.SEND_REPLIES ? "AUTO-REPLY" : "REVIEW MODE",
    timestamp: new Date(),
  });
});

app.listen(CONFIG.PORT, () => {
  console.log(`
Titian Jewelry WhatsApp Bot
Mode: ${CONFIG.SEND_REPLIES ? "AUTO-REPLY" : "REVIEW MODE (Google Sheets logging only)"}
Port: ${CONFIG.PORT}
  `);
});
