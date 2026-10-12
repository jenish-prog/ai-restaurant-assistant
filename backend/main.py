import uuid
import base64
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from database import (
    init_db,
    get_all_menu_items,
    add_menu_item_db,
    update_menu_item_db,
    toggle_menu_availability_db,
    delete_menu_item_db,
    get_orders_db,
    get_order_by_id_db,
    create_order_db,
    update_order_status_db,
    get_calls_db,
    create_call_db,
    get_stats_db,
)

app = FastAPI(
    title="AI Restaurant Assistant Dashboard API",
    description="Backend API connected to SQLite Database for Live Orders, Menu Management, Order Details, and Call History",
    version="2.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize SQLite database on startup
@app.on_event("startup")
def on_startup():
    init_db()

# ----------------- Models -----------------

class MenuItem(BaseModel):
    id: str
    name: str
    category: str
    description: str
    price: float
    is_available: bool = True
    prep_time_mins: int = 15
    image_url: Optional[str] = None

class MenuItemCreate(BaseModel):
    name: str
    category: str
    description: str
    price: float
    is_available: bool = True
    prep_time_mins: int = 15
    image_url: Optional[str] = None

class MenuItemUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    is_available: Optional[bool] = None
    prep_time_mins: Optional[int] = None

class OrderItem(BaseModel):
    item_id: str
    name: str
    quantity: int
    unit_price: float
    notes: Optional[str] = None

class Order(BaseModel):
    id: str
    customer_name: str
    customer_phone: str
    customer_address: Optional[str] = None
    order_type: str = "Dine-in"
    items: List[OrderItem]
    subtotal: float
    tax: float
    delivery_fee: float = 0.0
    total: float
    status: str = "Pending"
    created_at: str
    notes: Optional[str] = None
    call_id: Optional[str] = None

class OrderCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_address: Optional[str] = None
    order_type: str = "Takeout"
    items: List[OrderItem]
    notes: Optional[str] = None
    delivery_fee: float = 0.0
    call_id: Optional[str] = None

class OrderStatusUpdate(BaseModel):
    status: str

class CallRecord(BaseModel):
    id: str
    caller_name: Optional[str] = "Unknown Caller"
    caller_phone: str
    call_time: str
    duration_seconds: int
    status: str
    sentiment: str = "neutral"
    transcript_summary: str
    order_id: Optional[str] = None
    notes: Optional[str] = None

class CallRecordCreate(BaseModel):
    caller_name: Optional[str] = "Unknown Caller"
    caller_phone: str
    duration_seconds: int = 0
    status: str = "incoming"
    sentiment: str = "neutral"
    transcript_summary: str
    order_id: Optional[str] = None
    notes: Optional[str] = None

# ----------------- Endpoints -----------------

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Restaurant Assistant API",
        "database": "SQLite (restaurant.db)",
    }

# Menu endpoints
@app.get("/api/menu", response_model=List[MenuItem])
def get_menu(category: Optional[str] = None):
    return get_all_menu_items(category)

@app.post("/api/menu", response_model=MenuItem)
def add_menu_item(item: MenuItemCreate):
    new_id = f"menu-{uuid.uuid4().hex[:6]}"
    item_dict = {
        "id": new_id,
        "name": item.name,
        "category": item.category,
        "description": item.description,
        "price": item.price,
        "is_available": item.is_available,
        "prep_time_mins": item.prep_time_mins,
        "image_url": item.image_url or "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80"
    }
    return add_menu_item_db(item_dict)

@app.put("/api/menu/{item_id}", response_model=MenuItem)
def update_menu_item(item_id: str, updates: MenuItemUpdate):
    data = updates.model_dump(exclude_unset=True)
    res = update_menu_item_db(item_id, data)
    if not res:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return res

@app.patch("/api/menu/{item_id}/toggle-availability", response_model=MenuItem)
def toggle_item_availability(item_id: str):
    res = toggle_menu_availability_db(item_id)
    if not res:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return res

@app.delete("/api/menu/{item_id}")
def delete_menu_item(item_id: str):
    deleted = delete_menu_item_db(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return {"message": "Menu item deleted successfully", "id": item_id}

# Orders endpoints
@app.get("/api/orders", response_model=List[Order])
def get_orders(status: Optional[str] = None, search: Optional[str] = None):
    return get_orders_db(status, search)

@app.get("/api/orders/{order_id}", response_model=Order)
def get_order_by_id(order_id: str):
    order = get_order_by_id_db(order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found")
    return order

@app.post("/api/orders", response_model=Order)
def create_order(payload: OrderCreate):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Cannot create order with no items")

    subtotal = sum(item.quantity * item.unit_price for item in payload.items)
    tax = round(subtotal * 0.05, 2)  # 5% GST (CGST 2.5% + SGST 2.5%)
    total = round(subtotal + tax + payload.delivery_fee, 2)

    order_dict = {
        "customer_name": payload.customer_name,
        "customer_phone": payload.customer_phone,
        "customer_address": payload.customer_address,
        "order_type": payload.order_type,
        "subtotal": subtotal,
        "tax": tax,
        "delivery_fee": payload.delivery_fee,
        "total": total,
        "notes": payload.notes,
        "call_id": payload.call_id,
        "items": [i.model_dump() for i in payload.items],
    }
    return create_order_db(order_dict)

@app.patch("/api/orders/{order_id}/status", response_model=Order)
def update_order_status(order_id: str, payload: OrderStatusUpdate):
    valid_statuses = ["Pending", "Preparing", "Ready", "Delivered", "Cancelled"]
    if payload.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{payload.status}'. Must be one of {valid_statuses}"
        )
    updated = update_order_status_db(order_id, payload.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not found")
    return updated

# Calls endpoints
@app.get("/api/calls", response_model=List[CallRecord])
def get_calls(status: Optional[str] = None):
    return get_calls_db(status)

@app.post("/api/calls", response_model=CallRecord)
def create_call(payload: CallRecordCreate):
    return create_call_db(payload.model_dump())

# Stats endpoint
@app.get("/api/stats")
def get_dashboard_stats():
    return get_stats_db()

# ----------------- AI Voice Simulator (Google Gemini Multimodal Live WebSocket) -----------------

@app.websocket("/api/voice-simulator/stream")
async def browser_voice_simulator_stream(websocket: WebSocket):
    """
    Real-time Bidirectional WebSocket Audio Stream to Google Gemini Live API:
    - Browser microphone sends 16kHz PCM audio chunks.
    - Gemini Live responds with 24kHz PCM audio chunks streamed back to the browser.
    - Real-time tool calls (get_menu, create_order_draft, calculate_order_total, confirm_order) execute live.
    - Real-time interruptions stop audio playback immediately.
    """
    await websocket.accept()
    from services.gemini_live_client import GeminiLiveSession, get_gemini_api_key, get_model_id
    import logging as _logging
    _ws_log = _logging.getLogger("voice_ws")

    caller_phone = websocket.query_params.get("phone", "+91 7845742951")
    caller_name = websocket.query_params.get("name", "Valued Caller")
    masked = f"{(caller_phone or '')[:4]}...{(caller_phone or '')[-2:]}"
    _ws_log.info(f"WS OPEN caller={masked} name={caller_name}")
    ws_stats = {"audio_in": 0, "audio_bytes": 0, "text_in": 0}

    async def send_diag_to_browser(payload: dict):
        try:
            await websocket.send_json(payload)
        except Exception:
            pass

    async def send_audio_to_browser(pcm24k_bytes: bytes):
        try:
            b64 = base64.b64encode(pcm24k_bytes).decode('ascii')
            await websocket.send_json({"type": "audio", "data": b64})
        except Exception:
            pass

    async def send_transcript_to_browser(sender: str, text: str):
        try:
            await websocket.send_json({"type": "transcript", "sender": sender, "text": text})
        except Exception:
            pass

    async def send_tool_to_browser(name: str, args: dict, result: dict):
        try:
            await websocket.send_json({
                "type": "tool_call",
                "name": name,
                "args": args,
                "result": result
            })
        except Exception:
            pass

    async def send_interrupted_to_browser():
        try:
            await websocket.send_json({"type": "interrupted"})
        except Exception:
            pass

    async def send_turn_complete_to_browser():
        try:
            await websocket.send_json({"type": "turn_complete"})
        except Exception:
            pass

    session = GeminiLiveSession(
        caller_phone=caller_phone,
        caller_name=caller_name,
        on_audio_out=send_audio_to_browser,
        on_transcript=send_transcript_to_browser,
        on_tool_call=send_tool_to_browser,
        on_interrupted=send_interrupted_to_browser,
        on_turn_complete=send_turn_complete_to_browser,
        on_diag=send_diag_to_browser
    )

    started = await session.start()
    if not started:
        api_key = get_gemini_api_key()
        err_msg = session.last_error or ("Google Gemini Live API key missing or invalid." if not api_key else "Failed to connect to Gemini Live. Check API key quota or network.")
        try:
            await websocket.send_json({
                "type": "status",
                "connected": False,
                "error": err_msg
            })
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
        return

    try:
        await websocket.send_json({
            "type": "status",
            "connected": True,
            "model": get_model_id(),
            "message": f"Connected to Google Gemini Live API ({get_model_id()}). Live audio input & output active."
        })
    except Exception:
        # Browser closed/reconnected before we could send status — just clean up.
        await session.close(source="status_send_failed")
        return

    # Exactly one greeting per WebSocket connection (one Gemini session).
    # greeting_sent flag inside the session makes replays impossible.
    try:
        await session.send_greeting_once()
    except Exception:
        pass

    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type") if isinstance(msg, dict) else None
            cid = msg.get("cid") if isinstance(msg, dict) else None

            if msg_type == "audio":
                # Base64 16kHz mono PCM from browser microphone
                pcm_bytes = decode_audio_payload(msg.get("data", "") if isinstance(msg, dict) else "")
                if pcm_bytes is None:
                    ws_stats["audio_rejected"] = ws_stats.get("audio_rejected", 0) + 1
                    continue
                if session.is_active:
                    ws_stats["audio_in"] += 1
                    ws_stats["audio_bytes"] += len(pcm_bytes)
                    await session.send_audio_chunk(pcm_bytes)

            elif msg_type == "text":
                text = extract_text_turn(msg)
                if text and session.is_active:
                    ws_stats["text_in"] += 1
                    _ws_log.info(f"WS text turn ({len(text)} chars) cid={cid}.")
                    ok = await session.send_text_prompt(text, cid=cid)
                    try:
                        if ok:
                            await websocket.send_json({"type": "ack", "cid": cid, "accepted": True})
                        else:
                            await websocket.send_json({
                                "type": "error", "cid": cid,
                                "message": "Assistant did not accept the message (session unavailable). Try Reconnect."
                            })
                    except Exception:
                        pass
                elif text:
                    try:
                        await websocket.send_json({
                            "type": "error", "cid": cid,
                            "message": "Voice session is not active. Press Reconnect and try again."
                        })
                    except Exception:
                        pass

            elif msg_type == "audio_end":
                if session.is_active:
                    _ws_log.info(f"WS audio_end cid={cid}.")
                    await session.end_audio_stream()

            elif msg_type == "stop":
                break

    except WebSocketDisconnect as e:
        # Browser socket gone (tab closed, modal unmounted, network drop).
        # This must NOT be misread as a Gemini failure: log code/reason.
        _ws_log.info(f"WS DISCONNECT caller={masked} code={e.code} reason={e.reason!r} stats={ws_stats}")
    except Exception as e:
        import logging, traceback
        logging.getLogger("main").error(
            f"Browser WS handler error: {e}\n{traceback.format_exc()}")
    finally:
        # The ONLY places session cleanup may start: real browser disconnect,
        # handler error, or explicit stop. Never on turn_complete.
        _ws_log.info(f"WS CLOSE caller={masked} stats={ws_stats} -> closing Gemini session.")
        await session.close(source="browser_ws_closed")

# ----------------- Voice Tool Endpoints -----------------

def decode_audio_payload(b64: str) -> Optional[bytes]:
    """Validates a base64 mic frame. Returns PCM bytes or None.

    Pure function (no I/O) so message routing is unit-testable.
    Rejects empty, odd-length (not 16-bit aligned), or oversize frames.
    """
    if not isinstance(b64, str) or not b64:
        return None
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    if len(raw) == 0 or len(raw) % 2 != 0 or len(raw) > 128000:
        return None
    return raw


def extract_text_turn(msg: Any) -> str:
    """Extracts a typed user turn from a browser WS message. Pure/testable."""
    if not isinstance(msg, dict):
        return ""
    v = msg.get("text", "")
    return v.strip() if isinstance(v, str) else ""

class DraftCalculateRequest(BaseModel):
    items: List[Dict[str, Any]]
    order_type: str = "Takeout"
    customer_name: Optional[str] = "Valued Caller"
    customer_phone: Optional[str] = "+91 7845742951"
    customer_address: Optional[str] = None
    notes: Optional[str] = None

class DraftConfirmRequest(BaseModel):
    draft_id: str
    customer_confirmed: bool

@app.get("/api/tools/menu")
def tool_get_menu(category: Optional[str] = None):
    """Tool endpoint: returns current dishes, INR prices, and kitchen availability."""
    from services.ordering_service import get_live_menu
    return get_live_menu(category)

@app.post("/api/tools/draft")
def tool_create_draft(payload: DraftCalculateRequest):
    """Tool endpoint: creates or updates order draft and calculates 5% GST & delivery fee."""
    from services.ordering_service import create_or_update_order_draft
    return create_or_update_order_draft(
        items=payload.items,
        order_type=payload.order_type,
        customer_name=payload.customer_name or "Valued Caller",
        customer_phone=payload.customer_phone or "+91 7845742951",
        customer_address=payload.customer_address,
        notes=payload.notes
    )

@app.get("/api/tools/draft/{draft_id}/total")
def tool_calculate_total(draft_id: str):
    """Tool endpoint: calculates order total and breakdown."""
    from services.ordering_service import calculate_order_total
    return calculate_order_total(draft_id)

@app.post("/api/tools/confirm")
def tool_confirm(payload: DraftConfirmRequest):
    """Tool endpoint: persists confirmed order to database only upon explicit confirmation."""
    from services.ordering_service import confirm_and_place_order
    return confirm_and_place_order(
        draft_id=payload.draft_id,
        caller_confirmed=payload.customer_confirmed
    )

@app.get("/api/voice/status")
def voice_status():
    from services.gemini_live_client import get_gemini_api_key, get_model_id
    key = get_gemini_api_key()
    return {
        "google_ai_studio_configured": bool(key),
        "key_preview": f"{key[:6]}...{key[-4:]}" if key else None,
        "model": get_model_id(),
        "live_audio_supported": True
    }


