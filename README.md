# AI Restaurant Assistant • Command & Dispatch Dashboard

A modern restaurant command center built with **React (TypeScript) + Tailwind CSS** on the frontend and **Python (FastAPI)** on the backend. Styled with custom brand colors `#381932` (Royal Plum) and `#fff3e6` (Warm Cream).

---

## 🎨 Theme & Palette
- **Primary Accent / Surfaces**: `#381932` (Royal Plum)
- **Background & Warm Accents**: `#fff3e6` (Warm Linen/Cream)
- **Status Indicators**: Emerald (Ready/Delivered), Amber (Pending/Incoming), Blue (Preparing), Rose (Failed/Cancelled/Unavailable).

---

## 📱 The 4 Core Screens

### 1. Live Orders
- Shows order number (e.g. `#ORD-101`), customer name & phone, complete items list with quantities, calculated total price, order time, and dynamic status badges.
- **Quick Status Progression**: Advance orders in 1-click through the kitchen pipeline (`Pending` → `Preparing` → `Ready` → `Delivered`).
- **Interactive Manual Order Placement**: Click **"Create Sample Order"** to build manual orders with live subtotal, tax (9%), delivery fee, and grand total computation.

### 2. Menu Management
- Interactive food catalog organized by category (`Mains`, `Starters`, `Pizzas`, `Sides`, `Desserts`, `Beverages`).
- **Mark Unavailable / Available**: Instant toggle to switch kitchen availability in real-time.
- **Edit Prices & Item Details**: Update item pricing, descriptions, and preparation times.
- **Add New Food Items**: Complete modal form with photo preview, category tags, and prep times.

### 3. Order Details
- Comprehensive itemized order breakdown table (Item, Quantity, Unit Price, Line Subtotal, Chef notes).
- **Calculated Financials**: Subtotal, 9% Tax, Delivery Fee, and Bold Grand Total.
- **Customer Contact Details**: Full name, telephone number with 1-click copy, delivery address or table location, and customer notes.
- **Linked Call Integration**: Direct link to the originating AI voice call record.
- **Kitchen Ticket Print Simulation**: Kitchen prep slip generation.

### 4. Call History
- Dedicated tracking for:
  - **Incoming Calls** (Active live calls & recent queries)
  - **Completed Orders** (Voice interactions converted into placed orders)
  - **Abandoned Calls** (Callers dropped before checkout)
  - **Failed Interactions** (Speech recognition or payment gateway errors)
- Sentiment classification (Positive, Neutral, Frustrated).
- AI audio transcript summaries for every customer phone call.
- **Simulate Call Interaction**: Interactive tool to test new phone interactions.

---

## 🚀 Running the Project

### 1. Backend (Python FastAPI)
```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
- API Base URL: `http://127.0.0.1:8000`
- Interactive API Docs: `http://127.0.0.1:8000/docs`

### 2. Frontend (React + TypeScript + Tailwind CSS)
```bash
cd frontend
npm install
npm run dev
```
- Dashboard URL: `http://127.0.0.1:5173`

---

## 📞 Real Phone Calls (Twilio + Gemini Live)

When a customer dials your Twilio restaurant number, this flow runs:

1. **Customer calls** the Twilio number (normal mobile/landline call).
2. **Twilio** `POST`s to `/api/voice/incoming` → backend answers with TwiML `<Stream>` → live 8kHz mu-law audio flows over `/api/voice/twilio-stream`.
3. **AI backend** (`TwilioCallBridge` + shared `GeminiLiveSession`) transcodes audio both ways and runs the same menu/ordering tools as the dashboard voice tester.
4. **AI speaks**: greets once, takes the order, reads back items + total, waits for explicit confirmation (barge-in supported via `clear` events).
5. **Restaurant gets the order**: saved to SQLite (appears live on the dashboard) + one call record with transcript; WhatsApp receipt attempted if `WHATSAPP_*` keys are set.

### Setup
```bash
# 1. Expose your backend publicly (Twilio cannot reach 127.0.0.1)
ngrok http 8000   # note the https URL, e.g. https://abc123.ngrok.io

# 2. backend/.env — fill Twilio credentials (Twilio Console)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+19876543210
# Optional override (defaults to wss://<public-host>/api/voice/twilio-stream):
# TWILIO_STREAM_URL=wss://abc123.ngrok.io/api/voice/twilio-stream

# 3. Restart backend, then in Twilio Console > Phone Numbers > your number:
#    Voice webhook (POST): https://abc123.ngrok.io/api/voice/incoming
```
- Test by calling the Twilio number from your own phone. Watch backend logs for `Incoming call`, `Twilio call started`, greeting, `recv->first_audio`, and the saved order.
- Browser voice tester (`/api/voice-simulator/stream`) is unchanged — same brain, two doorways.
