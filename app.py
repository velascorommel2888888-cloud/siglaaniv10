"""
SiglaAni — Flask Backend
"""

import os, sqlite3, base64, hashlib
from datetime import datetime
import numpy as np
import cv2
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(__file__)
DB_PATH     = os.path.join(BASE_DIR, "siglaani.db")
CAPTURE_DIR = os.path.join(BASE_DIR, "captures")
XAI_DIR     = os.path.join(BASE_DIR, "xai_overlays")
os.makedirs(CAPTURE_DIR, exist_ok=True)
os.makedirs(XAI_DIR, exist_ok=True)

USE_TFLITE = False
XAI_MIN_CONFIDENCE = 60
XAI_MIN_COVERAGE   = 0.015
XAI_MAX_COVERAGE   = 0.85

app = Flask(__name__)
CORS(app)

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma']        = 'no-cache'
    response.headers['Expires']       = '-1'
    return response

# ── Password Hashing Helper ──────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

# ── Database ──────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scans (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            fruit            TEXT    NOT NULL DEFAULT 'Unknown',
            scientific       TEXT    DEFAULT '',
            condition        TEXT    NOT NULL DEFAULT 'ripe',
            condition_label  TEXT    DEFAULT '',
            confidence       REAL    DEFAULT 0,
            rating           INTEGER DEFAULT 3,
            recommendation   TEXT    DEFAULT '',
            temp             REAL    DEFAULT 0,
            thumbnail        TEXT    DEFAULT '',
            scanned_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            capture_filename TEXT   DEFAULT '',
            xai_filename     TEXT   DEFAULT '',
            xai_coverage     REAL   DEFAULT 0,
            xai_explanation  TEXT   DEFAULT '',
            xai_generated    INTEGER DEFAULT 0,
            transaction_id   TEXT    DEFAULT NULL,
            is_purchased     INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id   TEXT PRIMARY KEY,
            vendor_name      TEXT DEFAULT 'Sigla Ani Kiosk - Valenzuela',
            total_amount     REAL DEFAULT 0.0,
            total_items      INTEGER DEFAULT 0,
            purchased_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Phase 2 & 5: Inventory Control Table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS inventory (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            fruit_type       TEXT UNIQUE NOT NULL,
            stock_count      INTEGER DEFAULT 0,
            unit_price       REAL DEFAULT 20.0,
            price_per_kg     REAL DEFAULT 120.0,
            supplier_name    TEXT DEFAULT 'Valenzuela Local Market',
            supplier_contact TEXT DEFAULT 'N/A'
        )
    """)

    # Authentication & User Accounts Table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('vendor', 'consumer')),
            full_name TEXT,
            synced_kiosk_code TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Kiosks Table (Exclusive 1-to-1 sync enforcement)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS kiosks (
            kiosk_code TEXT PRIMARY KEY,
            kiosk_name TEXT NOT NULL,
            synced_vendor_id INTEGER DEFAULT NULL,
            synced_vendor_username TEXT DEFAULT NULL,
            FOREIGN KEY (synced_vendor_id) REFERENCES users(id)
        )
    """)

    # Seed baseline kiosks
    conn.execute("INSERT OR IGNORE INTO kiosks (kiosk_code, kiosk_name) VALUES ('KSK-VAL-01', 'Valenzuela Market Kiosk #1')")
    conn.execute("INSERT OR IGNORE INTO kiosks (kiosk_code, kiosk_name) VALUES ('KSK-VAL-02', 'Valenzuela Market Kiosk #2')")

    # Ensure dynamic inventory columns exist
    inv_cols = [
        ("price_per_kg",     "REAL DEFAULT 120.0"),
        ("supplier_name",    "TEXT DEFAULT 'Valenzuela Local Market'"),
        ("supplier_contact", "TEXT DEFAULT 'N/A'")
    ]
    for col, decl in inv_cols:
        try:
            conn.execute(f"ALTER TABLE inventory ADD COLUMN {col} {decl}")
        except sqlite3.OperationalError:
            pass

    # Seed baseline inventory items if not already existing
    cur = conn.cursor()
    for item in [("Apple", 50, 25.0, 140.0, "Valenzuela Local Market", "0917-123-4567"), 
                 ("Banana", 80, 15.0, 75.0, "Bulacan Fruit Hub", "0918-987-6543"), 
                 ("Orange", 40, 20.0, 120.0, "Divisoria Wholesale", "0922-555-7890")]:
        cur.execute("""
            INSERT OR IGNORE INTO inventory (fruit_type, stock_count, unit_price, price_per_kg, supplier_name, supplier_contact)
            VALUES (?, ?, ?, ?, ?, ?)
        """, item)

    new_cols = [
        ("capture_filename", "TEXT DEFAULT ''"),
        ("xai_filename",     "TEXT DEFAULT ''"),
        ("xai_coverage",     "REAL DEFAULT 0"),
        ("xai_explanation",  "TEXT DEFAULT ''"),
        ("xai_generated",    "INTEGER DEFAULT 0"),
        ("transaction_id",   "TEXT DEFAULT NULL"),
        ("is_purchased",     "INTEGER DEFAULT 0")
    ]
    for col, decl in new_cols:
        try:
            conn.execute(f"ALTER TABLE scans ADD COLUMN {col} {decl}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    conn.close()

def save_scan(data: dict) -> int:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO scans
              (fruit, scientific, condition, condition_label,
               confidence, rating, recommendation, temp, thumbnail,
               capture_filename, xai_filename, xai_coverage,
               xai_explanation, xai_generated, transaction_id, is_purchased)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            str(data.get("fruit",            "Unknown")),
            str(data.get("scientific",       "SIGLA ANI AI")),
            str(data.get("condition",        "ripe")),
            str(data.get("conditionLabel",   "Hinog (Ripe)")),
            float(data.get("confidence",     0)),
            int(data.get("rating",           3)),
            str(data.get("recommendation",   "")),
            float(data.get("temp",           0)),
            str(data.get("thumbnail",        "")),
            str(data.get("capture_filename", "")),
            str(data.get("xai_filename",     "")),
            float(data.get("xai_coverage",   0)),
            str(data.get("xai_explanation",  "")),
            int(data.get("xai_generated",    0)),
            data.get("transaction_id",       None),
            int(data.get("is_purchased",     0)),
        ))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()

def get_history(limit=50):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT * FROM scans ORDER BY scanned_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

# ── Image helpers ─────────────────────────────────────────────────────────────
def decode_image(b64_string: str):
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_string)
    arr   = np.frombuffer(img_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Failed to decode image")
    return frame

def make_thumbnail(frame, max_px=160) -> str:
    h, w = frame.shape[:2]
    scale = max_px / max(h, w)
    small = cv2.resize(frame, (int(w * scale), int(h * scale)))
    _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return base64.b64encode(buf).decode()

def save_capture_image(frame) -> str:
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S_") + f"{datetime.now().microsecond // 1000:03d}"
    filename = f"scan_{ts}.jpg"
    filepath = os.path.join(CAPTURE_DIR, filename)
    cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return filename

def save_crop_image(crop_frame, prefix="crop") -> str:
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S_") + f"{datetime.now().microsecond // 1000:03d}"
    filename = f"{prefix}_{ts}.jpg"
    filepath = os.path.join(CAPTURE_DIR, filename)
    cv2.imwrite(filepath, crop_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return filename

# ── Metadata ──────────────────────────────────────────────────────────────────
CONDITION_LABELS = {
    "ripe":     "Hinog (Ripe)",
    "overripe": "Sobrang Hinog (Overripe)",
    "unripe":   "Hindi Pa Hinog (Unripe)",
    "rotten":   "Bulok (Rotten)",
}

RECOMMENDATIONS = {
    "ripe":     "Ang prutas ay nasa tamang kondisyon para sa pagkain. Maaari na itong kainin ngayon o ilagay sa ref sa loob ng 5–7 araw.",
    "overripe": "Ang prutas ay medyo sobrang hinog na. Angkop pa rin para sa pagluluto o smoothie. Gamitin kaagad sa loob ng 1–2 araw.",
    "unripe":   "Ang prutas ay hindi pa ganap na hinog. Ilagay sa maaliwalas na lugar. Magiging handa ito sa loob ng 2–4 araw.",
    "rotten":   "Ang prutas ay hindi na ligtas kainin. Itapon na ito agad para maiwasan ang kontaminasyon.",
}

FRUIT_METADATA = {
    "banana":  ("Banana", "Musa acuminata"),
    "saging":  ("Banana", "Musa acuminata"),
    "apple":   ("Apple",  "Malus domestica"),
    "orange":  ("Orange", "Citrus sinensis"),
}

def condition_to_rating(condition: str, confidence: int) -> int:
    if condition == "ripe":
        return 5 if confidence >= 85 else 4
    if condition == "overripe":
        return 2
    if condition == "unripe":
        return 3
    return 1

def get_analysis_region(frame, bbox=None, padding=0.20):
    h, w = frame.shape[:2]
    if bbox and len(bbox) == 4:
        try:
            x, y, bw, bh = [float(v) for v in bbox]
            if bw > 10 and bh > 10:
                pad_x = bw * padding
                pad_y = bh * padding
                x0 = max(0, int(round(x - pad_x)))
                y0 = max(0, int(round(y - pad_y)))
                x1 = min(w, int(round(x + bw + pad_x)))
                y1 = min(h, int(round(y + bh + pad_y)))
                if x1 - x0 > 10 and y1 - y0 > 10:
                    return frame[y0:y1, x0:x1], (x0, y0, x1, y1)
        except Exception:
            pass
    return frame.copy(), (0, 0, w, h)

# ── Core Endpoints ────────────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "mode": "teachable_machine_priority"})

# ── Authentication Routes ─────────────────────────────────────────────────────
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', '')).strip()
    role = str(data.get('role', 'consumer')).strip().lower()
    full_name = str(data.get('full_name', '')).strip()

    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password are required.'}), 400

    if role not in ('vendor', 'consumer'):
        return jsonify({'success': False, 'message': 'Invalid account role.'}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO users (username, password_hash, role, full_name)
            VALUES (?, ?, ?, ?)
        ''', (username, hash_password(password), role, full_name or username))
        conn.commit()
        user_id = cursor.lastrowid
        return jsonify({
            'success': True,
            'user': {
                'id': user_id,
                'username': username,
                'role': role,
                'full_name': full_name or username,
                'synced_kiosk_code': None
            }
        }), 201
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'message': 'Username already exists.'}), 409
    finally:
        conn.close()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', '')).strip()
    role = str(data.get('role', 'consumer')).strip().lower()

    conn = sqlite3.connect(DB_PATH, timeout=15)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, username, role, full_name, synced_kiosk_code FROM users
        WHERE LOWER(username) = LOWER(?) AND password_hash = ? AND role = ?
    ''', (username, hash_password(password), role))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': 'Invalid credentials or wrong account role selected.'}), 401

    return jsonify({
        'success': True,
        'user': {
            'id': row[0],
            'username': row[1],
            'role': row[2],
            'full_name': row[3],
            'synced_kiosk_code': row[4]
        }
    }), 200

# ── Kiosk Synchronization Routes ──────────────────────────────────────────────
@app.route('/api/kiosk/sync', methods=['POST'])
def sync_kiosk():
    data = request.get_json(silent=True) or {}
    kiosk_code = str(data.get('kiosk_code', '')).strip().upper()
    vendor_id = data.get('vendor_id')
    vendor_username = str(data.get('username', '')).strip()

    if not kiosk_code or not vendor_id:
        return jsonify({'success': False, 'message': 'Kiosk code and Vendor ID are required.'}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    cursor = conn.cursor()

    cursor.execute('SELECT kiosk_code, kiosk_name, synced_vendor_id, synced_vendor_username FROM kiosks WHERE kiosk_code = ?', (kiosk_code,))
    kiosk = cursor.fetchone()

    if not kiosk:
        conn.close()
        return jsonify({'success': False, 'message': f'Kiosk code "{kiosk_code}" not recognized.'}), 404

    # Enforce only one vendor per kiosk rule
    if kiosk[2] is not None and kiosk[2] != vendor_id:
        conn.close()
        return jsonify({
            'success': False,
            'message': f'Kiosk {kiosk_code} is currently occupied by vendor "@{kiosk[3]}". Only one vendor can sync at a time.'
        }), 409

    # Bind vendor to kiosk and update user record
    cursor.execute('UPDATE kiosks SET synced_vendor_id = ?, synced_vendor_username = ? WHERE kiosk_code = ?', (vendor_id, vendor_username, kiosk_code))
    cursor.execute('UPDATE users SET synced_kiosk_code = ? WHERE id = ?', (kiosk_code, vendor_id))
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'message': f'Synced successfully with {kiosk[1]} ({kiosk_code}).',
        'kiosk_code': kiosk_code,
        'kiosk_name': kiosk[1]
    }), 200

@app.route('/api/kiosk/unsync', methods=['POST'])
def unsync_kiosk():
    data = request.get_json(silent=True) or {}
    vendor_id = data.get('vendor_id')

    if not vendor_id:
        return jsonify({'success': False, 'message': 'Vendor ID is required.'}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    cursor = conn.cursor()
    cursor.execute('SELECT synced_kiosk_code FROM users WHERE id = ?', (vendor_id,))
    row = cursor.fetchone()
    current_code = row[0] if row else None

    if current_code:
        cursor.execute('UPDATE kiosks SET synced_vendor_id = NULL, synced_vendor_username = NULL WHERE kiosk_code = ?', (current_code,))
    
    cursor.execute('UPDATE users SET synced_kiosk_code = NULL WHERE id = ?', (vendor_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Successfully unsynced from kiosk.'}), 200

# ── Inventory & Supplier Routes ───────────────────────────────────────────────
@app.route("/api/inventory", methods=["GET"])
def get_inventory():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM inventory ORDER BY fruit_type ASC").fetchall()
        return jsonify([dict(r) for r in rows]), 200
    finally:
        conn.close()

@app.route("/api/inventory", methods=["POST"])
def add_fruit_inventory():
    body = request.get_json(silent=True) or {}
    fruit_type = str(body.get("fruit_type", "")).strip().capitalize()
    stock_count = float(body.get("stock_kg", 50.0))
    price_per_kg = float(body.get("price_per_kg", 100.0))
    supplier_name = str(body.get("supplier_name", "Valenzuela Local Market")).strip()
    supplier_contact = str(body.get("supplier_contact", "N/A")).strip()

    if not fruit_type:
        return jsonify({"error": "invalid_payload", "message": "Ilagay ang pangalan ng prutas."}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO inventory (fruit_type, stock_count, price_per_kg, unit_price, supplier_name, supplier_contact)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(fruit_type) DO UPDATE SET
                stock_count = stock_count + excluded.stock_count,
                price_per_kg = excluded.price_per_kg,
                unit_price = excluded.unit_price,
                supplier_name = excluded.supplier_name,
                supplier_contact = excluded.supplier_contact
        """, (fruit_type, stock_count, price_per_kg, price_per_kg, supplier_name, supplier_contact))
        conn.commit()
        return jsonify({"success": True, "message": f"Naidagdag ang {fruit_type} sa inventory!"}), 201
    except Exception as e:
        return jsonify({"error": "db_error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route("/api/inventory/<string:fruit_type>", methods=["PUT"])
def update_fruit_inventory(fruit_type):
    body = request.get_json(silent=True) or {}
    new_price = body.get("price_per_kg") or body.get("unit_price")
    new_stock = body.get("stock_count") if body.get("stock_count") is not None else body.get("stock_kg")
    supplier_name = body.get("supplier_name")
    supplier_contact = body.get("supplier_contact")

    if all(v is None for v in [new_price, new_stock, supplier_name, supplier_contact]):
        return jsonify({"error": "invalid_payload", "message": "Walang binigay na field para i-update."}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        if new_price is not None:
            cur.execute("""
                UPDATE inventory 
                SET price_per_kg = ?, unit_price = ? 
                WHERE LOWER(fruit_type) = LOWER(?)
            """, (float(new_price), float(new_price), fruit_type))
        if new_stock is not None:
            cur.execute("""
                UPDATE inventory 
                SET stock_count = ? 
                WHERE LOWER(fruit_type) = LOWER(?)
            """, (float(new_stock), fruit_type))
        if supplier_name is not None:
            cur.execute("""
                UPDATE inventory 
                SET supplier_name = ? 
                WHERE LOWER(fruit_type) = LOWER(?)
            """, (str(supplier_name), fruit_type))
        if supplier_contact is not None:
            cur.execute("""
                UPDATE inventory 
                SET supplier_contact = ? 
                WHERE LOWER(fruit_type) = LOWER(?)
            """, (str(supplier_contact), fruit_type))
        conn.commit()
        return jsonify({"success": True, "message": f"Updated {fruit_type} inventory & supplier info."}), 200
    finally:
        conn.close()

@app.route("/api/inventory/<string:fruit_type>", methods=["DELETE"])
def delete_fruit_inventory(fruit_type):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM inventory WHERE LOWER(fruit_type) = LOWER(?)", (fruit_type,))
        conn.commit()
        return jsonify({"success": True, "message": f"Deleted {fruit_type} from inventory."}), 200
    except Exception as e:
        return jsonify({"error": "db_error", "message": str(e)}), 500
    finally:
        conn.close()

# ── Scan and Processing Endpoints ─────────────────────────────────────────────
@app.route("/api/scan", methods=["POST"])
def scan():
    body = request.get_json(silent=True) or {}
    image_b64 = body.get("image")

    if not image_b64:
        return jsonify({"error": "no_image", "message": "Walang larawan."}), 400

    try:
        frame = decode_image(image_b64)
    except Exception as e:
        return jsonify({"error": "decode_failed", "message": str(e)}), 400

    full_capture_filename = save_capture_image(frame)

    fruits_list = body.get("fruits") or []
    if not fruits_list or not isinstance(fruits_list, list):
        fruits_list = [{
            "detected_fruit":   body.get("detected_fruit") or "Unknown",
            "bbox":             body.get("bbox"),
            "model_condition":  body.get("model_condition") or "ripe",
            "model_confidence": body.get("model_confidence", 85)
        }]

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    transaction_id = f"TXN_{ts}"
    analyzed_results = []

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        for idx, item in enumerate(fruits_list):
            raw_name = str(item.get("detected_fruit") or "").strip().lower()
            if raw_name in FRUIT_METADATA:
                fruit_display, sci = FRUIT_METADATA[raw_name]
            elif raw_name:
                fruit_display = raw_name.capitalize()
                sci = "SIGLA ANI AI"
            else:
                fruit_display = "Fruit"
                sci = "SIGLA ANI AI"

            condition = str(item.get("model_condition") or "ripe").lower()
            if condition not in CONDITION_LABELS:
                condition = "ripe"

            confidence = int(item.get("model_confidence") or 85)
            bbox = item.get("bbox")

            crop, _ = get_analysis_region(frame, bbox)
            crop_filename = save_crop_image(crop, prefix=f"crop_{fruit_display.lower()}_{idx+1}")

            inv = cur.execute("SELECT price_per_kg, unit_price FROM inventory WHERE LOWER(fruit_type) = LOWER(?)", (fruit_display,)).fetchone()
            price_per_kg = inv["price_per_kg"] if inv and "price_per_kg" in inv.keys() else (inv["unit_price"] if inv else 100.0)

            result_item = {
                "fruit":            fruit_display,
                "scientific":       sci,
                "condition":        condition,
                "conditionLabel":   CONDITION_LABELS[condition],
                "confidence":       confidence,
                "rating":           condition_to_rating(condition, confidence),
                "recommendation":   RECOMMENDATIONS[condition],
                "temp":             0.0,
                "price_per_kg":     price_per_kg,
                "thumbnail":        make_thumbnail(crop),
                "capture_filename": crop_filename,
                "image_url":        f"/captures/{crop_filename}",
                "full_image_url":   f"/captures/{full_capture_filename}",
                "transaction_id":   transaction_id,
                "is_purchased":     0,
                "xai":              {"available": False}
            }

            new_id = save_scan(result_item)
            result_item["id"] = new_id
            result_item["scan_id"] = new_id
            analyzed_results.append(result_item)

        cur.execute("""
            INSERT INTO transactions (transaction_id, vendor_name, total_amount, total_items)
            VALUES (?, ?, ?, ?)
        """, (transaction_id, "Sigla Ani Kiosk - Valenzuela", len(analyzed_results) * 20.0, len(analyzed_results)))
        conn.commit()
    finally:
        conn.close()

    return jsonify({
        "success":        True,
        "transaction_id": transaction_id,
        "total_count":    len(analyzed_results),
        "results":        analyzed_results
    }), 200

# ── Batch Checkout Endpoint ───────────────────────────────────────────────────
@app.route("/api/checkout", methods=["POST"])
def checkout():
    body = request.get_json(silent=True) or {}
    if isinstance(body, list):
        scan_ids = body
        passed_total = None
        fruit_breakdown = []
        vendor_name = "Sigla Ani Kiosk - Valenzuela"
    else:
        scan_ids = body.get("scan_ids") or []
        vendor_name = body.get("vendor_name", "Sigla Ani Kiosk - Valenzuela")
        passed_total = body.get("total_amount")
        fruit_breakdown = body.get("fruit_breakdown") or []

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        clean_ids = [int(x) for x in scan_ids if str(x).isdigit()]
        rows = []
        if clean_ids:
            placeholders = ",".join("?" for _ in clean_ids)
            rows = cur.execute(f"SELECT * FROM scans WHERE id IN ({placeholders})", clean_ids).fetchall()

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        transaction_id = f"TXN_{ts}"

        # Deduct weight from inventory
        if fruit_breakdown:
            for item in fruit_breakdown:
                f_type = str(item.get("fruit_type", "")).strip()
                w_kg = float(item.get("weight_kg", 0.25))
                cur.execute("""
                    UPDATE inventory 
                    SET stock_count = MAX(0, stock_count - ?) 
                    WHERE LOWER(fruit_type) = LOWER(?)
                """, (w_kg, f_type))
            final_amount = float(passed_total) if passed_total is not None else 100.0
        else:
            final_amount = float(passed_total) if passed_total is not None else (len(rows) * 20.0 if rows else 25.0)

        # Link scans to transaction
        if clean_ids:
            placeholders = ",".join("?" for _ in clean_ids)
            cur.execute(f"""
                UPDATE scans 
                SET transaction_id = ?, is_purchased = 1 
                WHERE id IN ({placeholders})
            """, [transaction_id] + clean_ids)
            total_items_count = len(clean_ids)
        elif fruit_breakdown:
            total_items_count = 0
            for item in fruit_breakdown:
                f_type = item.get("fruit_type", "Fruit")
                qty = int(item.get("quantity", 1))
                total_items_count += qty
                for _ in range(qty):
                    cur.execute("""
                        INSERT INTO scans (fruit, scientific, condition, condition_label, confidence, rating, recommendation, transaction_id, is_purchased)
                        VALUES (?, 'SIGLA ANI AI', 'ripe', 'Hinog (Ripe)', 90, 4, 'Napakasariwa at angkop kainin.', ?, 1)
                    """, (f_type, transaction_id))
        else:
            total_items_count = 1
            cur.execute("""
                INSERT INTO scans (fruit, scientific, condition, condition_label, confidence, rating, recommendation, transaction_id, is_purchased)
                VALUES ('Fruit', 'SIGLA ANI AI', 'ripe', 'Hinog (Ripe)', 90, 4, 'Napakasariwa at angkop kainin.', ?, 1)
            """, (transaction_id,))

        cur.execute("""
            INSERT INTO transactions (transaction_id, vendor_name, total_amount, total_items)
            VALUES (?, ?, ?, ?)
        """, (transaction_id, vendor_name, round(final_amount, 2), total_items_count))

        conn.commit()

        return jsonify({
            "success": True,
            "transaction_id": transaction_id,
            "qr_payload": f"siglaani://receipt/{transaction_id}",
            "total_amount": round(final_amount, 2),
            "total_items": total_items_count
        }), 200
    except Exception as e:
        return jsonify({"error": "checkout_failed", "message": str(e)}), 500
    finally:
        conn.close()

# ── Static File Serving ───────────────────────────────────────────────────────
@app.route("/captures/<path:filename>")
def serve_capture(filename):
    return send_from_directory(CAPTURE_DIR, filename)

@app.route("/xai_overlays/<path:filename>")
def serve_xai(filename):
    return send_from_directory(XAI_DIR, filename)

@app.route("/api/receipt/<string:transaction_id>", methods=["GET"])
def get_receipt(transaction_id):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        txn = conn.execute("SELECT * FROM transactions WHERE transaction_id = ?", (transaction_id,)).fetchone()
        if not txn:
            return jsonify({"error": "not_found"}), 404

        scans = conn.execute("SELECT * FROM scans WHERE transaction_id = ? ORDER BY id ASC", (transaction_id,)).fetchall()
        items = []
        for s in scans:
            row = dict(s)
            filename = row.get("capture_filename") or ""
            items.append({
                "scan_id":        row["id"],
                "fruit_type":     row["fruit"],
                "scientific":     row["scientific"],
                "status":         row["condition_label"] or CONDITION_LABELS.get(row["condition"], row["condition"]),
                "confidence":     row["confidence"],
                "rating":         row["rating"],
                "recommendation": row["recommendation"],
                "image_url":      f"/captures/{os.path.basename(filename)}" if filename else None
            })
        receipt_data = dict(txn)
        receipt_data["items"] = items
        return jsonify(receipt_data), 200
    finally:
        conn.close()

@app.route("/api/scan/<int:scan_id>", methods=["GET"])
def get_scan_by_id(scan_id):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM scans WHERE id = ?", (scan_id,)).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        data = dict(row)
        filename = data.get("capture_filename") or ""
        return jsonify({
            "scan_id":        data["id"],
            "fruit_type":     data["fruit"],
            "scientific":     data["scientific"],
            "status":         data["condition_label"] or CONDITION_LABELS.get(data["condition"], data["condition"]),
            "confidence":     data["confidence"],
            "rating":         data["rating"],
            "recommendation": data["recommendation"],
            "timestamp":      data["scanned_at"],
            "image_url":      f"/captures/{os.path.basename(filename)}" if filename else None,
            "transaction_id": data.get("transaction_id")
        }), 200
    finally:
        conn.close()

@app.route("/api/history", methods=["GET"])
def history():
    limit = int(request.args.get("limit", 50))
    return jsonify(get_history(limit)), 200

@app.route("/api/history/<int:scan_id>", methods=["DELETE"])
def delete(scan_id):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("DELETE FROM scans WHERE id = ?", (scan_id,))
    conn.commit()
    conn.close()
    return jsonify({"deleted": scan_id}), 200

@app.route("/api/history", methods=["DELETE"])
def clear():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("DELETE FROM scans")
    conn.commit()
    conn.close()
    return jsonify({"cleared": True}), 200

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=True)