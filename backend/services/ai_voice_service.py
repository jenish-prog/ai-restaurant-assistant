import os
import re
import json
import logging
import requests
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

from database import (
    get_all_menu_items,
    create_order_db,
    create_call_db,
    get_order_by_id_db,
)

load_dotenv(".env")
logger = logging.getLogger("ai_voice")

def get_gemini_api_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY")

def call_google_ai_studio(
    prompt: str,
    system_instruction: str,
    api_key: str,
    model: str = "gemini-2.5-flash"
) -> Optional[str]:
    """Call Google AI Studio REST API."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 600,
        }
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=12)
        if resp.status_code == 200:
            data = resp.json()
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "").strip()
        else:
            logger.warning(f"Google AI Studio error {resp.status_code}: {resp.text[:180]}")
    except Exception as e:
        logger.error(f"Error calling Google AI Studio: {e}")
    return None

def match_menu_items(text: str, menu_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Match requested food items and quantities from text against real menu items."""
    detected = []
    text_lower = text.lower()
    
    number_words = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "a": 1, "an": 1
    }

    for item in menu_items:
        item_name = item["name"].lower()
        # Find key tokens from dish name
        keywords = [k for k in re.findall(r"\w+", item_name) if len(k) > 3]
        
        is_matched = False
        if item_name in text_lower:
            is_matched = True
        else:
            # Check for multi-keyword matches (e.g. 'truffle risotto', 'hibiscus spritz', 'burrata')
            matches = sum(1 for kw in keywords if kw in text_lower)
            if matches >= 2 or (len(keywords) == 1 and matches == 1) or ("burrata" in text_lower and "burrata" in item_name) or ("tiramisu" in text_lower and "tiramisu" in item_name) or ("risotto" in text_lower and "risotto" in item_name) or ("lamb" in text_lower and "lamb" in item_name) or ("spritz" in text_lower and "spritz" in item_name):
                is_matched = True

        if is_matched:
            # Detect quantity preceding the item
            qty = 1
            pattern = rf"(\d+|one|two|three|four|five)\s+(?:of\s+)?(?:the\s+)?(?:order\s+of\s+)?.*?(?:{item_name.split()[0]})"
            match = re.search(pattern, text_lower)
            if match:
                val = match.group(1)
                qty = int(val) if val.isdigit() else number_words.get(val, 1)
            else:
                # Direct check for digits near the name
                digit_match = re.search(rf"(\d+)\s+{re.escape(keywords[0]) if keywords else ''}", text_lower)
                if digit_match:
                    qty = int(digit_match.group(1))

            detected.append({
                "item_id": item["id"],
                "name": item["name"],
                "quantity": max(1, qty),
                "unit_price": float(item["price"]),
                "notes": None
            })
    return detected

def build_smart_voice_reply(
    customer_input: str,
    menu_items: List[Dict[str, Any]],
    customer_name: str,
    customer_phone: str,
    customer_address: Optional[str] = None
) -> Dict[str, Any]:
    """Smart culinary conversational engine for voice assistance and order processing."""
    text_lower = customer_input.lower().strip()
    detected_items = match_menu_items(customer_input, menu_items)
    
    sentiment = "positive"
    if any(w in text_lower for w in ["angry", "bad", "slow", "wrong", "cold", "cancel", "terrible", "hate", "frustrated"]):
        sentiment = "frustrated"
    elif any(w in text_lower for w in ["maybe", "wait", "not sure", "thinking", "hmm"]):
        sentiment = "neutral"

    # Intent 1: Asking for recommendations or menu details
    if any(w in text_lower for w in ["recommend", "special", "what do you have", "what's good", "suggest", "popular"]):
        available = [i for i in menu_items if i.get("is_available", True)]
        picks = available[:3]
        dish_descriptions = ", ".join([f"{p['name']} for ₹{int(p['price'])}" for p in picks])
        voice_reply = (
            f"Welcome to Aura Dining! Our chef's top recommendations today are the {dish_descriptions}. "
            f"Would you like me to start an order with any of these for you?"
        )
        return {
            "voice_reply": voice_reply,
            "sentiment": sentiment,
            "intent": "menu_recommendation",
            "detected_items": [],
            "order_created": None,
            "summary": f"Inquired about chef recommendations: suggested {', '.join(p['name'] for p in picks)}."
        }

    # Intent 2: Inquiring about dietary/vegetarian options
    if any(w in text_lower for w in ["veg", "vegetarian", "vegan", "dairy free", "diet"]):
        veg_items = [i for i in menu_items if "risotto" in i["name"].lower() or "burrata" in i["name"].lower() or "dessert" in i.get("category", "").lower() or "beverage" in i.get("category", "").lower()]
        names = ", ".join([f"{v['name']} (₹{int(v['price'])})" for v in veg_items[:3]])
        voice_reply = (
            f"We have wonderful vegetarian creations including our {names}. "
            f"Everything is freshly prepared with artisanal ingredients. Shall I add any to your cart?"
        )
        return {
            "voice_reply": voice_reply,
            "sentiment": sentiment,
            "intent": "dietary_inquiry",
            "detected_items": [],
            "order_created": None,
            "summary": "Asked for vegetarian options. Recommended risotto and burrata."
        }

    # Intent 3: Inquiring about price of a specific dish
    if any(w in text_lower for w in ["how much", "cost", "price", "rate"]):
        for item in menu_items:
            if any(kw in text_lower for kw in item["name"].lower().split() if len(kw) > 3):
                voice_reply = f"The {item['name']} is ₹{int(item['price'])}. It takes about {item['prep_time_mins']} minutes to prepare. Would you like to order it?"
                return {
                    "voice_reply": voice_reply,
                    "sentiment": sentiment,
                    "intent": "price_inquiry",
                    "detected_items": [],
                    "order_created": None,
                    "summary": f"Inquired about price for {item['name']} (₹{int(item['price'])})."
                }

    # Intent 4: Customer ordering food
    if detected_items:
        subtotal = sum(i["quantity"] * i["unit_price"] for i in detected_items)
        tax = round(subtotal * 0.05, 2)  # 5% GST
        delivery_fee = 40.0
        total = round(subtotal + tax + delivery_fee, 2)

        items_summary_str = " and ".join([f"{i['quantity']} {i['name']}" for i in detected_items])

        # Automatically place order into database
        order_dict = {
            "customer_name": customer_name or "Guest Caller",
            "customer_phone": customer_phone or "+91 98765 43210",
            "customer_address": customer_address or "Koramangala 4th Block, Bengaluru",
            "order_type": "Takeout",
            "subtotal": subtotal,
            "tax": tax,
            "delivery_fee": delivery_fee,
            "total": total,
            "notes": "Voice Order via Google AI Studio Assistant",
            "items": detected_items
        }
        created_order = create_order_db(order_dict)

        voice_reply = (
            f"Terrific! I've placed an order for {items_summary_str}. "
            f"Your subtotal is ₹{int(subtotal)}, with 5% GST of ₹{tax} and ₹40 delivery fee, bringing your total to ₹{int(total)}. "
            f"Your order number is #{created_order['id']} and our kitchen is preparing it now. Can I help you with anything else?"
        )

        return {
            "voice_reply": voice_reply,
            "sentiment": "positive",
            "intent": "order_placed",
            "detected_items": detected_items,
            "order_created": created_order,
            "summary": f"Placed order #{created_order['id']} for {items_summary_str} (Total: ₹{total})."
        }

    # Intent 5: Inquiring about order status
    order_num_match = re.search(r"ord[- ]?(\d+)", text_lower)
    if order_num_match:
        target_id = f"ORD-{order_num_match.group(1)}"
        order = get_order_by_id_db(target_id)
        if order:
            voice_reply = f"I found order #{order['id']} for {order['customer_name']}. The status is currently {order['status']}, and the total is ₹{int(order['total'])}."
            return {
                "voice_reply": voice_reply,
                "sentiment": sentiment,
                "intent": "order_status_check",
                "detected_items": [],
                "order_created": None,
                "summary": f"Checked status of order #{order['id']}: {order['status']}."
            }

    # Intent 6: General Greetings
    if any(w in text_lower for w in ["hello", "hi", "hey", "good morning", "good evening", "namaste"]):
        voice_reply = (
            f"Hello! Thank you for calling Aura Dining. I am your AI voice concierge. "
            f"I can take your food order, suggest chef specialties, or check on existing orders. What would you like today?"
        )
        return {
            "voice_reply": voice_reply,
            "sentiment": "positive",
            "intent": "greeting",
            "detected_items": [],
            "order_created": None,
            "summary": "Customer greeted the assistant. AI introduced Aura Dining menu options."
        }

    # Fallback
    voice_reply = (
        f"Thank you for reaching out to Aura Dining. We have a selection of gourmet starters, mains, desserts, and craft beverages. "
        f"You can tell me dishes like Truffle Risotto or Berry Hibiscus Spritz, or ask me for our specials!"
    )
    return {
        "voice_reply": voice_reply,
        "sentiment": sentiment,
        "intent": "general_inquiry",
        "detected_items": [],
        "order_created": None,
        "summary": f"Caller said: '{customer_input[:60]}...'. AI guided on available menu items."
    }

def handle_voice_turn(
    customer_input: str,
    customer_name: str = "Voice Caller",
    customer_phone: str = "+91 98765 43210",
    customer_address: Optional[str] = "Bengaluru, Karnataka",
    call_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Primary handler for customer voice turn:
    1. Attempts to consult Google AI Studio (Gemini).
    2. Uses smart culinary logic for entity extraction & order placement.
    3. Records the call in database `calls` table.
    """
    menu_items = get_all_menu_items()
    api_key = get_gemini_api_key()

    source = "culinary_voice_engine"
    system_instruction = (
        "You are the warm, polite, and efficient AI Voice Assistant for Aura Dining, an upscale restaurant in India. "
        "All prices are in Indian Rupees (₹). "
        "Keep your spoken answers concise (1 to 3 sentences maximum) suitable for phone voice playback. "
        "Menu items currently available: " +
        ", ".join([f"{m['name']} (₹{int(m['price'])}, {m['category']})" for m in menu_items])
    )

    gemini_reply = None
    if api_key:
        # Try Google AI Studio Gemini model
        gemini_reply = call_google_ai_studio(
            prompt=customer_input,
            system_instruction=system_instruction,
            api_key=api_key,
            model="gemini-2.5-flash"
        )
        if gemini_reply:
            source = "google_ai_studio"

    # Process structured culinary intent & orders
    result = build_smart_voice_reply(
        customer_input=customer_input,
        menu_items=menu_items,
        customer_name=customer_name,
        customer_phone=customer_phone,
        customer_address=customer_address
    )

    # If Gemini returned custom conversational text, blend it
    if gemini_reply and not result.get("order_created"):
        result["voice_reply"] = gemini_reply

    # Record / update call event in database
    call_record_data = {
        "caller_name": customer_name,
        "caller_phone": customer_phone,
        "duration_seconds": 35,
        "status": "completed" if result.get("order_created") else "incoming",
        "sentiment": result["sentiment"],
        "transcript_summary": f"Customer: \"{customer_input}\" | AI: \"{result['voice_reply']}\"",
        "order_id": result["order_created"]["id"] if result.get("order_created") else None,
        "notes": f"Source: {source} | Intent: {result['intent']}"
    }
    call_record = create_call_db(call_record_data)

    result["call_record"] = call_record
    result["source"] = source
    result["provider_status"] = "Google AI Studio (Gemini)" if source == "google_ai_studio" else "Smart Culinary Engine"

    return result
