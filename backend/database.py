import sqlite3
import os
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

DB_PATH = os.path.join(os.path.dirname(__file__), "restaurant.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def get_now_formatted(minutes_ago: int = 0) -> str:
    tz = timezone(timedelta(hours=5, minutes=30))
    dt = datetime.now(tz) - timedelta(minutes=minutes_ago)
    return dt.strftime("%Y-%m-%d %I:%M %p")

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Menu Items Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS menu_items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            is_available INTEGER NOT NULL DEFAULT 1,
            prep_time_mins INTEGER NOT NULL DEFAULT 15,
            image_url TEXT
        )
    """)

    # Orders Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_address TEXT,
            order_type TEXT NOT NULL,
            subtotal REAL NOT NULL,
            tax REAL NOT NULL,
            delivery_fee REAL NOT NULL DEFAULT 0.0,
            total REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            created_at TEXT NOT NULL,
            notes TEXT,
            call_id TEXT
        )
    """)

    # Order Items Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            notes TEXT,
            FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
        )
    """)

    # Calls Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS calls (
            id TEXT PRIMARY KEY,
            caller_name TEXT,
            caller_phone TEXT NOT NULL,
            call_time TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            sentiment TEXT NOT NULL DEFAULT 'neutral',
            transcript_summary TEXT NOT NULL,
            order_id TEXT,
            notes TEXT
        )
    """)

    conn.commit()

    # Seed data if menu_items is empty
    cursor.execute("SELECT COUNT(*) FROM menu_items")
    if cursor.fetchone()[0] == 0:
        seed_data(conn)

    conn.close()

def seed_data(conn: sqlite3.Connection):
    cursor = conn.cursor()

    menu_seeds = [
        ("menu-1", "Truffle Mushroom Risotto", "Mains", "Creamy arborio rice with wild forest mushrooms, white truffle oil, and parmigiano-reggiano crisps.", 450.0, 1, 20, "https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?w=600&auto=format&fit=crop&q=80"),
        ("menu-2", "Smoked Wagyu Smash Burger", "Mains", "Double dry-aged patties, smoked cheddar, caramelized shallot jam, black garlic aioli on brioche.", 380.0, 1, 15, "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80"),
        ("menu-3", "Wood-fired Margherita DOP", "Pizzas", "San Marzano tomatoes, buffalo mozzarella, fresh basil leaves, extra virgin olive oil.", 340.0, 1, 12, "https://images.unsplash.com/photo-1604382355076-af4b0eb60143?w=600&auto=format&fit=crop&q=80"),
        ("menu-4", "Crispy Calamari Fritti", "Starters", "Tender baby squid dusted in seasoned semolina, served with yuzu tartar and charred lemon.", 290.0, 0, 10, "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=600&auto=format&fit=crop&q=80"),
        ("menu-5", "Burrata & Heirloom Peach Salad", "Starters", "Creamy Pugliese burrata, grilled yellow peaches, aged balsamic reduction, micro basil.", 320.0, 1, 8, "https://images.unsplash.com/photo-1592417817098-8f3d6910985c?w=600&auto=format&fit=crop&q=80"),
        ("menu-6", "Rosemary Garlic Truffle Fries", "Sides", "Hand-cut russet potatoes tossed with fresh rosemary, sea salt, pecorino, and black truffle oil.", 180.0, 1, 8, "https://images.unsplash.com/photo-1576107232684-1279f3908594?w=600&auto=format&fit=crop&q=80"),
        ("menu-7", "Pistachio Lava Cake", "Desserts", "Warm molten Sicilian pistachio center with Madagascar vanilla gelato and crushed pistachios.", 240.0, 1, 12, "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&auto=format&fit=crop&q=80"),
        ("menu-8", "Smoked Berry Hibiscus Spritz", "Beverages", "Wild hibiscus infusion, crushed blackberries, sparkling tonic, fresh thyme sprig.", 160.0, 1, 5, "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&auto=format&fit=crop&q=80"),
        ("menu-9", "Chicken Biryani", "Mains", "Fragrant seeraga samba rice cooked with tender chicken, whole spices, served with brinjal gravy and onion raita.", 320.0, 1, 20, "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80"),
    ]

    cursor.executemany("""
        INSERT INTO menu_items (id, name, category, description, price, is_available, prep_time_mins, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, menu_seeds)

    conn.commit()

# Query Helpers
def get_all_menu_items(category: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    if category and category.lower() != "all":
        cursor.execute("SELECT * FROM menu_items WHERE LOWER(category) = LOWER(?) ORDER BY name ASC", (category,))
    else:
        cursor.execute("SELECT * FROM menu_items ORDER BY category ASC, name ASC")
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "description": r["description"] or "",
            "price": float(r["price"]),
            "is_available": bool(r["is_available"]),
            "prep_time_mins": int(r["prep_time_mins"]),
            "image_url": r["image_url"],
        }
        for r in rows
    ]

def add_menu_item_db(item: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO menu_items (id, name, category, description, price, is_available, prep_time_mins, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        item["id"],
        item["name"],
        item["category"],
        item.get("description", ""),
        float(item["price"]),
        1 if item.get("is_available", True) else 0,
        int(item.get("prep_time_mins", 15)),
        item.get("image_url")
    ))
    conn.commit()
    conn.close()
    return item

def update_menu_item_db(item_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM menu_items WHERE id = ?", (item_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        return None

    name = updates.get("name", existing["name"])
    category = updates.get("category", existing["category"])
    description = updates.get("description", existing["description"])
    price = updates.get("price", existing["price"])
    prep_time = updates.get("prep_time_mins", existing["prep_time_mins"])
    is_avail = updates.get("is_available", existing["is_available"])

    cursor.execute("""
        UPDATE menu_items
        SET name = ?, category = ?, description = ?, price = ?, prep_time_mins = ?, is_available = ?
        WHERE id = ?
    """, (name, category, description, price, prep_time, 1 if is_avail else 0, item_id))
    conn.commit()

    cursor.execute("SELECT * FROM menu_items WHERE id = ?", (item_id,))
    updated = cursor.fetchone()
    conn.close()
    return {
        "id": updated["id"],
        "name": updated["name"],
        "category": updated["category"],
        "description": updated["description"] or "",
        "price": float(updated["price"]),
        "is_available": bool(updated["is_available"]),
        "prep_time_mins": int(updated["prep_time_mins"]),
        "image_url": updated["image_url"],
    }

def toggle_menu_availability_db(item_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT is_available FROM menu_items WHERE id = ?", (item_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    new_avail = 0 if row["is_available"] else 1
    cursor.execute("UPDATE menu_items SET is_available = ? WHERE id = ?", (new_avail, item_id))
    conn.commit()

    cursor.execute("SELECT * FROM menu_items WHERE id = ?", (item_id,))
    updated = cursor.fetchone()
    conn.close()
    return {
        "id": updated["id"],
        "name": updated["name"],
        "category": updated["category"],
        "description": updated["description"] or "",
        "price": float(updated["price"]),
        "is_available": bool(updated["is_available"]),
        "prep_time_mins": int(updated["prep_time_mins"]),
        "image_url": updated["image_url"],
    }

def delete_menu_item_db(item_id: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM menu_items WHERE id = ?", (item_id,))
    changed = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return changed

def get_orders_db(status: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM orders WHERE 1=1"
    params = []

    if status and status.lower() != "all":
        query += " AND LOWER(status) = LOWER(?)"
        params.append(status)

    if search:
        s = f"%{search.lower()}%"
        query += " AND (LOWER(id) LIKE ? OR LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)"
        params.extend([s, s, s])

    query += " ORDER BY ROWID DESC"
    cursor.execute(query, params)
    order_rows = cursor.fetchall()

    orders_list = []
    for o in order_rows:
        cursor.execute("SELECT * FROM order_items WHERE order_id = ?", (o["id"],))
        item_rows = cursor.fetchall()
        items = [
            {
                "item_id": i["item_id"],
                "name": i["name"],
                "quantity": int(i["quantity"]),
                "unit_price": float(i["unit_price"]),
                "notes": i["notes"]
            }
            for i in item_rows
        ]
        orders_list.append({
            "id": o["id"],
            "customer_name": o["customer_name"],
            "customer_phone": o["customer_phone"],
            "customer_address": o["customer_address"],
            "order_type": o["order_type"],
            "subtotal": float(o["subtotal"]),
            "tax": float(o["tax"]),
            "delivery_fee": float(o["delivery_fee"]),
            "total": float(o["total"]),
            "status": o["status"],
            "created_at": o["created_at"],
            "notes": o["notes"],
            "call_id": o["call_id"],
            "items": items,
        })

    conn.close()
    return orders_list

def get_order_by_id_db(order_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    o = cursor.fetchone()
    if not o:
        conn.close()
        return None

    cursor.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
    item_rows = cursor.fetchall()
    items = [
        {
            "item_id": i["item_id"],
            "name": i["name"],
            "quantity": int(i["quantity"]),
            "unit_price": float(i["unit_price"]),
            "notes": i["notes"]
        }
        for i in item_rows
    ]
    conn.close()
    return {
        "id": o["id"],
        "customer_name": o["customer_name"],
        "customer_phone": o["customer_phone"],
        "customer_address": o["customer_address"],
        "order_type": o["order_type"],
        "subtotal": float(o["subtotal"]),
        "tax": float(o["tax"]),
        "delivery_fee": float(o["delivery_fee"]),
        "total": float(o["total"]),
        "status": o["status"],
        "created_at": o["created_at"],
        "notes": o["notes"],
        "call_id": o["call_id"],
        "items": items,
    }

def create_order_db(order_data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM orders")
    count = cursor.fetchone()[0]
    new_id = f"ORD-{101 + count}"

    cursor.execute("""
        INSERT INTO orders (id, customer_name, customer_phone, customer_address, order_type, subtotal, tax, delivery_fee, total, status, created_at, notes, call_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id,
        order_data["customer_name"],
        order_data["customer_phone"],
        order_data.get("customer_address"),
        order_data["order_type"],
        order_data["subtotal"],
        order_data["tax"],
        order_data.get("delivery_fee", 0.0),
        order_data["total"],
        "Pending",
        get_now_formatted(0),
        order_data.get("notes"),
        order_data.get("call_id")
    ))

    for item in order_data["items"]:
        cursor.execute("""
            INSERT INTO order_items (order_id, item_id, name, quantity, unit_price, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            new_id,
            item["item_id"],
            item["name"],
            item["quantity"],
            item["unit_price"],
            item.get("notes")
        ))

    conn.commit()
    conn.close()
    return get_order_by_id_db(new_id)

def update_order_status_db(order_id: str, new_status: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE orders SET status = ? WHERE id = ?", (new_status, order_id))
    if cursor.rowcount == 0:
        conn.close()
        return None
    conn.commit()
    conn.close()
    return get_order_by_id_db(order_id)

def get_calls_db(status: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM calls"
    params = []
    if status and status.lower() != "all":
        query += " WHERE LOWER(status) = LOWER(?)"
        params.append(status)
    query += " ORDER BY ROWID DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "caller_name": r["caller_name"] or "Unknown Caller",
            "caller_phone": r["caller_phone"],
            "call_time": r["call_time"],
            "duration_seconds": int(r["duration_seconds"]),
            "status": r["status"],
            "sentiment": r["sentiment"],
            "transcript_summary": r["transcript_summary"],
            "order_id": r["order_id"],
            "notes": r["notes"]
        }
        for r in rows
    ]

def create_call_db(call_data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM calls")
    count = cursor.fetchone()[0]
    new_id = f"CALL-{801 + count}"

    cursor.execute("""
        INSERT INTO calls (id, caller_name, caller_phone, call_time, duration_seconds, status, sentiment, transcript_summary, order_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        new_id,
        call_data.get("caller_name", "Anonymous Caller"),
        call_data["caller_phone"],
        get_now_formatted(0),
        call_data.get("duration_seconds", 0),
        call_data["status"],
        call_data.get("sentiment", "neutral"),
        call_data["transcript_summary"],
        call_data.get("order_id"),
        call_data.get("notes")
    ))
    conn.commit()
    conn.close()

    return {
        "id": new_id,
        "caller_name": call_data.get("caller_name", "Anonymous Caller"),
        "caller_phone": call_data["caller_phone"],
        "call_time": get_now_formatted(0),
        "duration_seconds": call_data.get("duration_seconds", 0),
        "status": call_data["status"],
        "sentiment": call_data.get("sentiment", "neutral"),
        "transcript_summary": call_data["transcript_summary"],
        "order_id": call_data.get("order_id"),
        "notes": call_data.get("notes")
    }

def get_stats_db() -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM orders WHERE status IN ('Pending', 'Preparing', 'Ready')")
    live_orders = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM orders")
    total_orders = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM orders WHERE status = 'Delivered'")
    delivered_orders = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'Cancelled'")
    total_rev = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM calls")
    total_calls = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM calls WHERE status = 'completed'")
    completed_calls = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM calls WHERE status = 'abandoned'")
    abandoned_calls = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM calls WHERE status = 'failed'")
    failed_calls = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM calls WHERE status = 'incoming'")
    incoming_calls = cursor.fetchone()[0]

    conn.close()

    return {
        "live_orders_count": live_orders,
        "total_orders_count": total_orders,
        "delivered_orders_count": delivered_orders,
        "total_revenue": round(float(total_rev), 2),
        "calls": {
            "total": total_calls,
            "completed": completed_calls,
            "abandoned": abandoned_calls,
            "failed": failed_calls,
            "incoming": incoming_calls
        }
    }
