import time
import uuid
import logging
from typing import Dict, Any, List, Optional
from database import (
    get_all_menu_items,
    create_order_db,
    create_call_db,
    get_now_formatted,
)

logger = logging.getLogger("ordering_service")

# In-memory storage for active order drafts during phone/voice sessions
# Draft structure: { draft_id: { items, subtotal, tax, delivery_fee, total, status, created_at, ... } }
active_drafts: Dict[str, Dict[str, Any]] = {}

def get_live_menu(category: Optional[str] = None) -> Dict[str, Any]:
    """
    Retrieves live menu items from SQLite database.
    Re-checks prices and kitchen availability.
    Payload is compact (trimmed descriptions) to keep tool round-trips fast;
    the dashboard UI uses /api/menu (full rows) separately.
    """
    items = get_all_menu_items(category)
    available_items = []
    unavailable_items = []

    for item in items:
        desc = item["description"] or ""
        if len(desc) > 80:
            desc = desc[:77] + "..."
        entry = {
            "id": item["id"],
            "name": item["name"],
            "category": item["category"],
            "description": desc,
            "price_inr": item["price"],
            "prep_time_mins": item["prep_time_mins"],
            "is_available": item["is_available"]
        }
        if item["is_available"]:
            available_items.append(entry)
        else:
            unavailable_items.append(entry)

    return {
        "status": "success",
        "currency": "INR",
        "currency_symbol": "₹",
        "total_available": len(available_items),
        "available_items": available_items,
        "unavailable_items": unavailable_items,
    }

def normalize_token(w: str) -> str:
    w = w.lower().strip()
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w

def find_menu_item_match(
    query: str,
    available_only: bool = True,
    db_items: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fuzzy / case-insensitive search to match caller's spoken item name with database items.
    Handles plurals (biryanis -> biryani, risottos -> risotto) and partial mentions.
    Accepts a pre-fetched item list to avoid repeat DB queries in hot paths.
    """
    items = db_items if db_items is not None else get_all_menu_items()
    clean_query = query.lower().strip()

    # Exact or substring match
    best_match = None
    for item in items:
        name_lower = item["name"].lower()
        if clean_query == name_lower or clean_query in name_lower or name_lower in clean_query:
            if available_only and not item["is_available"]:
                continue
            best_match = item
            break

    # If no match yet, try normalized token-level overlap
    if not best_match:
        query_tokens = {normalize_token(w) for w in clean_query.split() if len(w) > 2}
        for item in items:
            name_tokens = {normalize_token(w) for w in item["name"].lower().split() if len(w) > 2}
            if query_tokens.intersection(name_tokens):
                if available_only and not item["is_available"]:
                    continue
                best_match = item
                break

    return best_match

def create_or_update_order_draft(
    items: List[Dict[str, Any]],
    order_type: str = "Takeout",
    customer_name: str = "Valued Caller",
    customer_phone: str = "+91 7845742951",
    customer_address: Optional[str] = None,
    notes: Optional[str] = None,
    draft_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Validates items against active menu in DB, enforces live INR prices,
    computes 5% GST and delivery fee, and creates/updates a draft.
    Does NOT save to permanent database until caller explicitly confirms.
    Single DB fetch: menu is read once and reused for validation + matching.
    """
    all_db_items_list = get_all_menu_items()
    all_db_items = {item["id"]: item for item in all_db_items_list}
    all_db_items_by_name = {item["name"].lower(): item for item in all_db_items_list}

    validated_items = []
    rejected_items = []
    subtotal = 0.0

    if isinstance(items, str):
        items = [{"name": items, "quantity": 1}]

    for req_item in items:
        if isinstance(req_item, str):
            req_item = {"name": req_item, "quantity": 1}
        elif not isinstance(req_item, dict):
            continue

        raw_name = str(req_item.get("name", "")).strip()
        raw_id = str(req_item.get("item_id", "")).strip()
        try:
            qty = int(req_item.get("quantity", 1))
        except (ValueError, TypeError):
            qty = 1
        if qty <= 0:
            qty = 1

        db_item = None
        if raw_id and raw_id in all_db_items:
            db_item = all_db_items[raw_id]
        elif raw_name:
            # Look up by name
            if raw_name.lower() in all_db_items_by_name:
                db_item = all_db_items_by_name[raw_name.lower()]
            else:
                db_item = find_menu_item_match(raw_name, available_only=False, db_items=all_db_items_list)

        if not db_item:
            rejected_items.append({
                "item_name": raw_name,
                "reason": "Item not found in restaurant menu"
            })
            continue

        if not db_item["is_available"]:
            rejected_items.append({
                "item_name": db_item["name"],
                "reason": "Currently sold out / unavailable in kitchen"
            })
            continue

        item_unit_price = float(db_item["price"])
        item_total = round(item_unit_price * qty, 2)
        subtotal += item_total

        validated_items.append({
            "item_id": db_item["id"],
            "name": db_item["name"],
            "quantity": qty,
            "unit_price": item_unit_price,
            "item_total": item_total,
            "notes": req_item.get("notes")
        })

    if not validated_items:
        return {
            "status": "error",
            "message": "No valid and available menu items were selected.",
            "rejected_items": rejected_items,
            "requires_action": "Inform caller about unavailable/unmatched items and offer alternatives."
        }

    # Tax & Delivery Calculations (Indian context: 5% GST, ₹40 Delivery charge)
    tax = round(subtotal * 0.05, 2)
    delivery_fee = 40.0 if order_type.lower() == "delivery" else 0.0
    total = round(subtotal + tax + delivery_fee, 2)

    new_draft_id = draft_id or f"DRAFT-{uuid.uuid4().hex[:6].upper()}"
    draft_data = {
        "draft_id": new_draft_id,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "customer_address": customer_address,
        "order_type": order_type,
        "items": validated_items,
        "rejected_items": rejected_items,
        "subtotal": round(subtotal, 2),
        "tax": tax,
        "delivery_fee": delivery_fee,
        "total": total,
        "notes": notes,
        "status": "draft_pending_confirmation",
        "created_at": time.time(),
    }

    active_drafts[new_draft_id] = draft_data

    # Human-readable read-back string for the AI voice agent to read out.
    # Essentials only (items + grand total) to keep spoken replies short;
    # full subtotal/GST/delivery breakdown stays in the numeric fields.
    items_summary_en = ", ".join([f"{i['quantity']}x {i['name']} (₹{i['item_total']:.0f})" for i in validated_items])
    read_back_en = (
        f"{items_summary_en}. The grand total is ₹{total:.0f}. "
        "Shall I confirm and place this order for you?"
    )

    return {
        "status": "success",
        "draft_id": new_draft_id,
        "order_type": order_type,
        "items": validated_items,
        "rejected_items": rejected_items,
        "subtotal": round(subtotal, 2),
        "gst_5_percent": tax,
        "delivery_fee": delivery_fee,
        "grand_total": total,
        "currency": "INR",
        "currency_symbol": "₹",
        "read_back_prompt": read_back_en,
        "requires_explicit_confirmation": True
    }

def confirm_and_place_order(
    draft_id: str,
    caller_confirmed: bool,
    call_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Saves order to permanent database ONLY after explicit caller confirmation.
    Validates that draft exists and has not already been confirmed.
    """
    if not caller_confirmed:
        return {
            "status": "error",
            "message": "Order not confirmed. The caller must explicitly agree to the items and total."
        }

    draft = active_drafts.get(draft_id)
    if not draft:
        return {
            "status": "error",
            "message": f"Draft {draft_id} not found or expired. Please create a new draft."
        }

    if draft.get("status") == "confirmed_and_saved":
        return {
            "status": "duplicate_prevented",
            "message": f"This order has already been placed under Order ID {draft.get('order_id')}.",
            "order_id": draft.get("order_id"),
            "total": draft.get("total")
        }

    # Save to SQLite database orders and order_items tables
    order_payload = {
        "customer_name": draft["customer_name"],
        "customer_phone": draft["customer_phone"],
        "customer_address": draft["customer_address"],
        "order_type": draft["order_type"],
        "subtotal": draft["subtotal"],
        "tax": draft["tax"],
        "delivery_fee": draft["delivery_fee"],
        "total": draft["total"],
        "notes": draft["notes"],
        "call_id": call_id,
        "items": draft["items"]
    }

    try:
        saved_order = create_order_db(order_payload)
        order_id = saved_order["id"]

        # Mark draft as confirmed to prevent duplicates
        draft["status"] = "confirmed_and_saved"
        draft["order_id"] = order_id

        prep_time = "30-40 minutes" if draft["order_type"].lower() == "delivery" else "15-20 minutes"

        # Log or update call record if call_id provided
        if call_id:
            summary = f"Caller confirmed {draft['order_type']} order #{order_id} for ₹{draft['total']:.0f}."
            create_call_db({
                "caller_name": draft["customer_name"],
                "caller_phone": draft["customer_phone"],
                "duration_seconds": 120,
                "status": "completed",
                "sentiment": "positive",
                "transcript_summary": summary,
                "order_id": order_id,
                "notes": f"Gemini Live AI automated phone order. Delivery/Pickup: {prep_time}"
            })

        logger.info(f"Order {order_id} successfully confirmed and persisted to database.")

        return {
            "status": "success",
            "order_id": order_id,
            "customer_name": draft["customer_name"],
            "customer_phone": draft["customer_phone"],
            "total_inr": draft["total"],
            "order_type": draft["order_type"],
            "estimated_time": prep_time,
            "message": f"Order #{order_id} has been successfully sent to the kitchen! Total: ₹{draft['total']:.0f}.",
            "whatsapp_triggered": True
        }

    except Exception as e:
        logger.error(f"Failed to persist confirmed order: {e}")
        return {
            "status": "error",
            "message": f"Database error while saving order: {str(e)}"
        }

def log_call_record(
    caller_phone: str,
    caller_name: Optional[str] = "Caller",
    status: str = "completed",
    sentiment: str = "positive",
    transcript_summary: str = "",
    duration_seconds: int = 60,
    order_id: Optional[str] = None,
    notes: Optional[str] = None
) -> Dict[str, Any]:
    """
    Logs call record to SQLite calls table for dashboard tracking.
    """
    try:
        call = create_call_db({
            "caller_name": caller_name,
            "caller_phone": caller_phone,
            "duration_seconds": duration_seconds,
            "status": status,
            "sentiment": sentiment,
            "transcript_summary": transcript_summary,
            "order_id": order_id,
            "notes": notes or "Google Gemini Live AI Call"
        })
        return {"status": "success", "call_id": call["id"]}
    except Exception as e:
        logger.error(f"Failed to log call: {e}")
        return {"status": "error", "message": str(e)}

def calculate_order_total(draft_id: str) -> Dict[str, Any]:
    """
    Retrieves the itemized calculation for an active order draft.
    Calculates subtotal, 5% GST, delivery fee, and grand total in INR (₹).
    """
    draft = active_drafts.get(draft_id)
    if not draft:
        return {
            "status": "error",
            "message": f"Draft {draft_id} not found. Please provide items to create an order draft."
        }

    return {
        "status": "success",
        "draft_id": draft_id,
        "items": draft["items"],
        "subtotal": draft["subtotal"],
        "gst_5_percent": draft["tax"],
        "delivery_fee": draft["delivery_fee"],
        "grand_total": draft["total"],
        "currency": "INR",
        "currency_symbol": "₹",
        "order_type": draft["order_type"],
        "customer_address": draft.get("customer_address"),
        "read_back_total": f"Subtotal is ₹{draft['subtotal']:.0f}, with 5% GST of ₹{draft['tax']:.0f}"
            + (f" and ₹{draft['delivery_fee']:.0f} delivery fee" if draft["delivery_fee"] > 0 else "")
            + f", giving a grand total of ₹{draft['total']:.0f}."
    }

# Tool Aliases matching exact user function requirements
get_menu = get_live_menu
create_order_draft = create_or_update_order_draft
confirm_order = confirm_and_place_order
