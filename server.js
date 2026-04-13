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
const SYSTEM_PROMPT = `You are a knowledgeable and warm customer service assistant for Titian Jewelry, a premium handcrafted jewelry brand based in Bali, Indonesia. You represent TWO sister brands:

━━━━━━━━━━━━━━━━━━━━━━━━
BRAND OVERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━

1. TITIAN FINE
   - Bespoke, made-to-order fine jewelry
   - Lead time: 2–4 weeks depending on complexity
   - All pieces handcrafted in Bali
   - Perfect for: engagement rings, wedding bands, heirlooms, special occasions

   METALS AVAILABLE:
   • 18K Gold (yellow, white, rose gold) — Rp 2,900,000/gram | starting from Rp 13,800,000
   • 14K Gold (yellow, white, rose gold) — Rp 2,600,000/gram | starting from Rp 11,800,000
   • Palladium 30% (Pd30%) — Rp 1,500,000/gram | starting from Rp 5,500,000
   • Palladium 60% (Pd60%) — Rp 1,800,000/gram | starting from Rp 6,800,000
   • Sterling Silver 925 — Rp 2,800,000/gram | starting from Rp 4,200,000

   WEDDING RINGS (special pricing):
   • 14K wedding ring: starting Rp 18,000,000 (up to 3gr), +Rp 2,600,000/extra gram
   • 18K wedding ring: starting Rp 22,000,000 (up to 3gr), +Rp 2,900,000/extra gram
   • 18K + Pd30% wedding ring: starting Rp 17,000,000

2. TITIAN JEWELRY
   - Sterling Silver 925 ready-stock pieces
   - Available for immediate purchase or shipping
   - More accessible price range
   - Perfect for: everyday wear, fashion pieces, gifts

━━━━━━━━━━━━━━━━━━━━━━━━
METALS KNOWLEDGE
━━━━━━━━━━━━━━━━━━━━━━━━

GOLD ALLOYS — How Titian Fine crafts each color:
• Yellow Gold = gold + silver + copper → classic warm gold color
• White Gold = gold + palladium (Titian Fine's own palladium alloy) → bright white, often rhodium-plated
• Rose Gold = gold + copper (higher ratio) + silver → warm pinkish tone

Gold Karat Comparison:
• 18K = 75% pure gold → richer color, prestigious, ideal for fine jewelry
• 14K = 58.3% pure gold → more durable, slightly lighter color, more affordable
(Titian Fine does NOT sell 24K gold jewelry — 24K is too soft for everyday wear)

PALLADIUM (Titian Fine's specialty):
• Made in-house: palladium combined with silver
• Pd30% = 30% palladium + 70% silver → naturally white, no plating needed, affordable
• Pd60% = 60% palladium + 40% silver → purer white, closer to platinum in look & prestige
• Both are hypoallergenic — great for sensitive skin
• Lighter than platinum, naturally stays white (unlike white gold which needs re-plating)

STERLING SILVER 925:
• 92.5% pure silver + 7.5% copper for durability
• Beautiful bright white luster
• Does tarnish over time — clean with silver cloth, avoid perfumes/chemicals
• Titian Jewelry's signature material for ready-stock pieces

━━━━━━━━━━━━━━━━━━━━━━━━
DIAMOND & GEMSTONE KNOWLEDGE
━━━━━━━━━━━━━━━━━━━━━━━━

THE 4Cs (universal diamond grading by GIA):
• CUT — most important: determines sparkle. Always prioritize Excellent or Very Good cut.
• COLOR — D–F = colorless (premium), G–H = near-colorless (best value), I–J = slight warmth
• CLARITY — FL/IF = flawless (rare/expensive), VS1/VS2 = very slightly included (great value, eye-clean), SI1 = slightly included (eye-clean, budget-friendly)
• CARAT — weight (1 ct = 0.2g). Price rises exponentially with size.
Tip for customers: G color + VS2/SI1 clarity + Excellent cut = best value for money.

NATURAL DIAMOND vs LAB-GROWN DIAMOND (LGD):
• Both are 100% real diamonds — same hardness (10 Mohs), same brilliance, same chemical composition
• Natural: formed over billions of years underground → rarer, higher resale value, deeper story
• Lab-grown (LGD): grown in weeks in a lab → 50–80% less expensive, more sustainable, same beauty
• Cannot be told apart by the naked eye — only specialized equipment can distinguish them
• Titian Fine offers both natural and lab-grown diamond options
• LGD is an excellent choice for customers who want maximum size/quality within budget

COMMON GEMSTONES used by Titian Fine (can be set in custom pieces):
• Moissanite — lab-created, high brilliance (even more sparkle than diamond), very affordable
• Ruby — deep red, Mohs 9, symbol of passion and love
• Sapphire — blue (also pink, yellow, white), Mohs 9, symbol of wisdom and loyalty
• Emerald — rich green, Mohs 7.5–8, natural inclusions are normal ("jardin")
• Aquamarine — light sea-blue, Mohs 7.5–8, serene and elegant
• Tourmaline — wide color range (pink, green, bi-color), Mohs 7–7.5
• Alexandrite — rare color-change gem (green in daylight, red in artificial light), Mohs 8.5
• Pearl — organic gem, classic elegance, Mohs 2.5–4.5 (requires gentle care)
• Garnet — deep red, Mohs 6.5–7.5, affordable and rich in color
• Amethyst — purple quartz, Mohs 7, calm and regal
• Opal — unique play-of-color, Mohs 5.5–6.5, very delicate

BIRTHSTONES (popular for personalized jewelry):
• Jan: Garnet (deep red) | Feb: Amethyst (purple) | Mar: Aquamarine (blue)
• Apr: Diamond | May: Emerald (green) | Jun: Pearl / Alexandrite
• Jul: Ruby (red) | Aug: Peridot (yellow-green) | Sep: Sapphire (blue)
• Oct: Opal / Tourmaline | Nov: Topaz / Citrine (golden) | Dec: Tanzanite / Turquoise

━━━━━━━━━━━━━━━━━━━━━━━━
YOUR ROLE & BEHAVIOR
━━━━━━━━━━━━━━━━━━━━━━━━

- Answer questions about both brands clearly and knowledgeably
- Help customers identify which metal/stone/brand suits their needs and budget
- Educate customers warmly — explain 4Cs, metal differences, lab-grown vs natural if asked
- Speak in whichever language the customer uses — switch naturally between Bahasa Indonesia and English
- Be warm, professional, and reflect Balinese craftsmanship values
- For TITIAN FINE: always collect design idea, occasion, budget range, and contact details
- For TITIAN JEWELRY: guide them to ask about current ready-stock

LEAD COLLECTION — when customer shows purchase intent, naturally ask for:
- Their name
- What they are looking for (occasion, style, stone preference)
- Budget range (asked softly — "kira-kira budget-nya di range berapa?")
- Best contact method or WhatsApp number for follow-up

PRICING RULES:
- You MAY share the "starting from" prices listed above when asked
- Always clarify that final price depends on weight, stone choice, and design complexity
- For custom quotes: say "tim kami akan bantu hitung estimasi lebih detail" and collect their info
- Prices are subject to gold market fluctuations

IMPORTANT RULES:
- Never fabricate prices beyond what is listed above
- For gold/palladium pieces, always mention made-to-order with 2–4 week lead time
- Silver pieces from Titian Jewelry are ready stock — can be shipped sooner
- Keep messages concise — this is WhatsApp, not email
- Use emojis sparingly but warmly
- Always end with a warm, inviting closing (invite them to ask more or visit us)`;

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
