# Titian Jewelry — WhatsApp AI Assistant
## Setup Guide (Review Mode + Google Sheets)

---

## How It Works

```
Customer sends WhatsApp message
        ↓
Bot receives it (no reply sent to customer)
        ↓
Claude generates a suggested reply
        ↓
Row added to your Google Sheet:
[Timestamp | Phone | Name | Their message | Suggested reply | Status]
        ↓
Your partner reads the sheet → replies manually from her phone
```

When you're confident in the bot's quality, flip `SEND_REPLIES=true` to go fully automated.

---

## Your Google Sheet Will Look Like This

| Timestamp | Phone | Name | Customer Message | Suggested Reply | Status |
|-----------|-------|------|-----------------|-----------------|--------|
| 11/04/2026 09:15 | 6281234567890 | Sari | Halo, ada cincin perak? | Halo Sari! Tentu saja... | Pending |
| 11/04/2026 10:30 | 6289876543210 | John | Gold ring price? | Hi John! For our gold... | Replied |

Your partner changes "Pending" to "Replied" or "Ignored" after she responds.

---

## Step 1: Get Your API Keys

### A. Anthropic (Claude)
1. Go to https://console.anthropic.com
2. Sign up → API Keys → Create Key
3. Add $20 billing credit
4. Save key → `ANTHROPIC_API_KEY`

### B. WhatsApp Business API (Meta)
1. Go to https://developers.facebook.com
2. Create App → Business type → Add WhatsApp product
3. In WhatsApp → API Setup:
   - Copy **Phone Number ID** → `WA_PHONE_ID`
   - Generate **Access Token** → `WA_TOKEN`

---

## Step 2: Set Up Google Sheets

### A. Create the Sheet
1. Go to https://sheets.google.com
2. Create a new spreadsheet — name it "Titian Jewelry — WhatsApp Log"
3. In Row 1, add these headers:
   - A1: `Timestamp`
   - B1: `Phone`
   - C1: `Name`
   - D1: `Customer Message`
   - E1: `Suggested Reply`
   - F1: `Status`
4. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**THIS_PART**`/edit`
   → Paste as `GOOGLE_SHEET_ID`

### B. Create a Google Service Account
1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "Titian Bot")
3. Go to APIs & Services → Enable APIs → search for and enable **Google Sheets API**
4. Go to APIs & Services → Credentials → Create Credentials → Service Account
   - Name: `titian-bot`
   - Click Create and Continue → Done
5. Click on the service account you just created
6. Go to Keys tab → Add Key → Create New Key → JSON
7. Download the JSON file — it contains your credentials
8. From the JSON file, copy:
   - `client_email` → paste as `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → paste as `GOOGLE_PRIVATE_KEY`

### C. Share Your Sheet with the Service Account
1. Open your Google Sheet
2. Click Share button (top right)
3. Paste the `client_email` value (looks like: titian-bot@your-project.iam.gserviceaccount.com)
4. Give it **Editor** access
5. Click Send

---

## Step 3: Deploy to Railway

1. Push this code to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add all environment variables from `.env.example`
4. Railway gives you a URL: `https://titian-bot.up.railway.app`

---

## Step 4: Connect WhatsApp Webhook

1. Meta Developer Console → WhatsApp → Configuration
2. Callback URL: `https://titian-bot.up.railway.app/webhook`
3. Verify Token: same as your `VERIFY_TOKEN` value
4. Subscribe to **messages** field

---

## Step 5: Test

Send a WhatsApp message to your test number.
Check your Google Sheet — a new row should appear within seconds.

Test messages:
- "Halo, ada cincin perak?"
- "I'm looking for a gold engagement ring"
- "Berapa harga gelang emas?"

---

## Step 6: Going Fully Automated (When Ready)

When you're happy with the reply quality:
1. In Railway dashboard → Variables
2. Change `SEND_REPLIES` from `false` to `true`
3. Redeploy — bot now replies automatically

---

## Monthly Costs

| Service | Cost |
|---------|------|
| Anthropic API | ~$0.60/month (at 20 msg/day) |
| Railway | ~$5/month |
| WhatsApp API | Free (under 1,000 convos) |
| Google Sheets | Free |
| **Total** | **~$5.60/month** |

---

## Troubleshooting

**Sheet not updating?**
- Check that the service account email has Editor access to the sheet
- Check Railway logs for Google Sheets errors

**Webhook not verifying?**
- Make sure `VERIFY_TOKEN` in Railway matches exactly what you entered in Meta console

**Bot not receiving messages?**
- Make sure you subscribed to the `messages` webhook field in Meta console
