import os
import logging
from typing import Dict, Any, Optional
import httpx

logger = logging.getLogger("whatsapp_service")

WHATSAPP_TOKEN = os.getenv("WHATSAPP_API_TOKEN", "")
WHATSAPP_PHONE_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
RESTAURANT_NAME = "Aura Dining & Kitchen"
RESTAURANT_PHONE = "+91 7845742951"

async def send_whatsapp_order_confirmation(
    to_phone: str,
    order_id: str,
    customer_name: str,
    items_summary: str,
    total_amount: float,
    order_type: str,
    estimated_time: str
) -> Dict[str, Any]:
    """
    Sends WhatsApp notification to the customer via Meta WhatsApp Cloud API.
    If credentials are not configured, performs graceful fallback simulation.
    """
    # Clean phone number (strip whitespace, ensure +91)
    clean_phone = to_phone.replace(" ", "").replace("-", "")
    if not clean_phone.startswith("+"):
        if len(clean_phone) == 10:
            clean_phone = f"+91{clean_phone}"

    message_body = (
        f"🍽️ *{RESTAURANT_NAME}* - Order Confirmed!\n\n"
        f"வணக்கம் / Hello *{customer_name}*,\n"
        f"Thank you for placing your order via our AI Voice Assistant.\n\n"
        f"📋 *Order ID:* #{order_id}\n"
        f"📦 *Type:* {order_type}\n"
        f"🍲 *Items Ordered:*\n{items_summary}\n\n"
        f"💰 *Grand Total:* ₹{total_amount:.2f} (Incl. 5% GST)\n"
        f"⏱️ *Estimated {order_type} Time:* {estimated_time}\n\n"
        f"For questions or updates, call us at {RESTAURANT_PHONE}.\n"
        f"நன்றி! We hope you enjoy your meal!"
    )

    if not WHATSAPP_TOKEN or not WHATSAPP_PHONE_ID:
        logger.info(
            f"[WhatsApp Mock] Live credentials not set. Simulated notification sent to {clean_phone} for Order #{order_id}."
        )
        return {
            "status": "simulated",
            "recipient": clean_phone,
            "order_id": order_id,
            "message": "WhatsApp confirmation logged in simulation mode (set WHATSAPP_API_TOKEN to deliver live message).",
            "preview": message_body
        }

    url = f"https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_ID}/messages"
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json"
    }

    # Format without '+' for WhatsApp API destination
    recipient_num = clean_phone.replace("+", "")
    payload = {
        "messaging_product": "whatsapp",
        "to": recipient_num,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": message_body
        }
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code in [200, 201]:
                data = resp.json()
                logger.info(f"WhatsApp sent successfully to {clean_phone}: {data}")
                return {
                    "status": "delivered",
                    "recipient": clean_phone,
                    "order_id": order_id,
                    "whatsapp_message_id": data.get("messages", [{}])[0].get("id")
                }
            else:
                logger.error(f"WhatsApp API returned error {resp.status_code}: {resp.text}")
                return {
                    "status": "failed",
                    "recipient": clean_phone,
                    "error": resp.text,
                    "status_code": resp.status_code
                }
    except Exception as e:
        logger.error(f"Exception sending WhatsApp: {e}")
        return {
            "status": "error",
            "recipient": clean_phone,
            "error": str(e)
        }
