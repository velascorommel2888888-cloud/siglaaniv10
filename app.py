"""
SiglaAni — Flask Backend
"""

import os, sqlite3, base64, hashlib, random, threading, time, urllib.request, json, re
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

CLOUD_SYNC_URL = os.environ.get("SIGLAANI_CLOUD_URL", "")

app = Flask(__name__)
CORS(app)

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma']        = 'no-cache'
    response.headers['Expires']       = '-1'
    return response

# ── Password Hashing & Validation Helpers ─────────────────────────────────────
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def validate_password_strength(password: str):
    if len(password) < 8:
        return False, "Kailangang hindi bababa sa 8 characters ang password (At least 8 characters)."
    if not re.search(r'[A-Z]', password):
        return False, "Kailangang may kahit isang uppercase letter A-Z (At least 1 uppercase letter)."
    if not re.search(r'[a-z]', password):
        return False, "Kailangang may kahit isang lowercase letter a-z (At least 1 lowercase letter)."
    if not re.search(r'\d', password):
        return False, "Kailangang may kahit isang numero 0-9 (At least 1 number)."
    if not re.search(r'[!@#$%^&*(),.?":{}|<>_]', password):
        return False, "Kailangang may kahit isang special character tulad ng !@#$%^&* o _ (At least 1 symbol)."
    return True, ""

def validate_ph_phone_number(phone: str):
    clean_phone = re.sub(r'[\s\-()]', '', str(phone or ''))
    pattern = r'^(09\d{9}|(\+?639)\d{9})$'
    if not re.match(pattern, clean_phone):
        return False, "Invalid mobile number. Gamitin ang format na 09XXXXXXXXX o +639XXXXXXXXX."
    return True, clean_phone

PASSWORD_RESET_CODES = {}

# ── Metadata & Recommendations ────────────────────────────────────────────────
CONDITION_LABELS = {
    "ripe":     "Hinog (Ripe)",
    "overripe": "Sobrang Hinog (Overripe)",
    "unripe":   "Hindi Pa Hinog (Unripe)",
    "rotten":   "Bulok (Rotten)",
}

RECOMMENDATIONS = {
    "ripe":     "Ang prutas ay nasa tamang kondisyon para sa pagkain. Maaari na itong kainin ngayon o ilagay sa ref sa loob ng 3–5 araw.",
    "overripe": "Ang prutas ay medyo sobrang hinog na. Angkop pa rin para sa pagluluto o smoothie. Gamitin kaagad sa loob ng 1–2 araw.",
    "unripe":   "Ang prutas ay hindi pa ganap na hinog. Ilagay sa maaliwalas na lugar. Magiging handa ito sa loob ng 2–4 araw.",
    "rotten":   "Ang prutas ay hindi na ligtas kainin. Itapon na ito agad para maiwasan ang kontaminasyon.",
}

FRUIT_METADATA = {
    "banana":     ("Banana",     "Musa acuminata"),
    "apple":      ("Apple",      "Malus domestica"),
    "orange":     ("Orange",     "Citrus sinensis"),
    "mango":      ("Mango",      "Mangifera indica"),
    "strawberry": ("Strawberry", "Fragaria × ananassa"),
}

def parse_model_label(raw_label: str):
    lbl = str(raw_label or "").strip().lower()
    if not lbl or "background" in lbl or "empty" in lbl:
        return None, None, None, True

    fruit_name = "Fruit"
    sci_name = "SIGLA ANI AI"
    for key, (display_name, scientific) in FRUIT_METADATA.items():
        if key in lbl:
            fruit_name = display_name
            sci_name = scientific
            break

    if "overripe" in lbl:
        condition = "overripe"
    elif "unripe" in lbl:
        condition = "unripe"
    elif "rotten" in lbl:
        condition = "rotten"
    elif "ripe" in lbl or "fresh" in lbl:
        condition = "ripe"
    else:
        condition = "ripe"

    return fruit_name, sci_name, condition, False

def condition_to_rating(condition: str, confidence: int) -> int:
    if condition == "ripe":
        return 5 if confidence >= 85 else 4
    if condition == "overripe":
        return 2
    if condition == "unripe":
        return 3
    return 1

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
            is_purchased     INTEGER DEFAULT 0,
            synced           INTEGER DEFAULT 0,
            is_archived      INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id   TEXT PRIMARY KEY,
            vendor_name      TEXT DEFAULT 'Sigla Ani Kiosk - Valenzuela',
            vendor_id        INTEGER DEFAULT NULL,
            total_amount     REAL DEFAULT 0.0,
            total_items      INTEGER DEFAULT 0,
            purchased_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            synced           INTEGER DEFAULT 0,
            is_archived      INTEGER DEFAULT 0
        )
    """)
    
    conn.execute("""
        CREATE TABLE IF NOT EXISTS inventory (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor_id        INTEGER DEFAULT NULL,
            fruit_type       TEXT NOT NULL,
            stock_count      INTEGER DEFAULT 0,
            unit_price       REAL DEFAULT 20.0,
            price_per_kg     REAL DEFAULT 120.0,
            supplier_name    TEXT DEFAULT 'Valenzuela Local Market',
            supplier_contact TEXT DEFAULT 'N/A',
            is_archived      INTEGER DEFAULT 0
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('vendor', 'consumer')),
            full_name TEXT,
            phone_number TEXT DEFAULT '',
            synced_kiosk_code TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS kiosks (
            kiosk_code TEXT PRIMARY KEY,
            kiosk_name TEXT NOT NULL,
            synced_vendor_id INTEGER DEFAULT NULL,
            synced_vendor_username TEXT DEFAULT NULL,
            FOREIGN KEY (synced_vendor_id) REFERENCES users(id)
        )
    """)

    conn.execute("INSERT OR IGNORE INTO kiosks (kiosk_code, kiosk_name) VALUES ('KSK-VAL-01', 'Valenzuela Market Kiosk #1')")
    conn.execute("INSERT OR IGNORE INTO kiosks (kiosk_code, kiosk_name) VALUES ('KSK-VAL-02', 'Valenzuela Market Kiosk #2')")

    migrations = [
        ("inventory", "vendor_id", "INTEGER DEFAULT NULL"),
        ("inventory", "is_archived", "INTEGER DEFAULT 0"),
        ("scans", "is_archived", "INTEGER DEFAULT 0"),
        ("transactions", "vendor_id", "INTEGER DEFAULT NULL"),
        ("transactions", "is_archived", "INTEGER DEFAULT 0"),
        ("users", "phone_number", "TEXT DEFAULT ''"),
    ]
    for tbl, col, decl in migrations:
        try:
            conn.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {decl}")
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
               xai_explanation, xai_generated, transaction_id, is_purchased, synced, is_archived)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)
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

def get_history(limit=50, include_archived=False):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        where = "WHERE is_archived = 0" if not include_archived else "WHERE is_archived = 1"
        rows = conn.execute(f"SELECT * FROM scans {where} ORDER BY scanned_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

def check_internet(timeout=3):
    try:
        urllib.request.urlopen("https://1.1.1.1", timeout=timeout)
        return True
    except Exception:
        return False

def sync_worker_loop():
    while True:
        time.sleep(15)
        if not CLOUD_SYNC_URL or not check_internet():
            continue
        try:
            conn = sqlite3.connect(DB_PATH, timeout=15)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            unsynced_txns = cur.execute("SELECT * FROM transactions WHERE synced = 0 LIMIT 25").fetchall()
            unsynced_scans = cur.execute("SELECT * FROM scans WHERE synced = 0 AND is_purchased = 1 LIMIT 50").fetchall()

            if not unsynced_txns and not unsynced_scans:
                conn.close()
                continue

            payload = {
                "transactions": [dict(t) for t in unsynced_txns],
                "scans": [dict(s) for s in unsynced_scans]
            }
            req = urllib.request.Request(
                CLOUD_SYNC_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    txn_ids = [t["transaction_id"] for t in unsynced_txns]
                    scan_ids = [s["id"] for s in unsynced_scans]
                    if txn_ids:
                        cur.execute(f"UPDATE transactions SET synced = 1 WHERE transaction_id IN ({','.join(['?']*len(txn_ids))})", txn_ids)
                    if scan_ids:
                        cur.execute(f"UPDATE scans SET synced = 1 WHERE id IN ({','.join(['?']*len(scan_ids))})", scan_ids)
                    conn.commit()
            conn.close()
        except Exception:
            pass

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
    phone_number = str(data.get('phone_number', '')).strip()

    if not username or not password or not phone_number:
        return jsonify({'success': False, 'message': 'Username, password, and phone number are required.'}), 400

    is_phone_valid, phone_result = validate_ph_phone_number(phone_number)
    if not is_phone_valid:
        return jsonify({'success': False, 'message': phone_result}), 400
    phone_number = phone_result

    is_valid, err_msg = validate_password_strength(password)
    if not is_valid:
        return jsonify({'success': False, 'message': err_msg}), 400

    if role not in ('vendor', 'consumer'):
        return jsonify({'success': False, 'message': 'Invalid account role.'}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO users (username, password_hash, role, full_name, phone_number)
            VALUES (?, ?, ?, ?, ?)
        ''', (username, hash_password(password), role, full_name or username, phone_number))
        conn.commit()
        user_id = cursor.lastrowid
        return jsonify({
            'success': True,
            'user': {
                'id': user_id,
                'username': username,
                'role': role,
                'full_name': full_name or username,
                'phone_number': phone_number,
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
        SELECT id, username, role, full_name, phone_number, synced_kiosk_code FROM users
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
            'phone_number': row[4],
            'synced_kiosk_code': row[5]
        }
    }), 200

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip()

    conn = sqlite3.connect(DB_PATH, timeout=15)
    cursor = conn.cursor()
    cursor.execute('SELECT id, username, phone_number FROM users WHERE LOWER(username) = LOWER(?)', (username,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': 'Username not found in records.'}), 404

    reset_code = f"{random.randint(100000, 999999)}"
    PASSWORD_RESET_CODES[username.lower()] = reset_code
    phone_raw = row[2] or ""
    masked_phone = f"******{phone_raw[-4:]}" if len(phone_raw) >= 4 else "your registered number"

    print("\n" + "=" * 55, flush=True)
    print(f"🔑 [SIGLA ANI OTP] Reset Code for '{username}': >>> {reset_code} <<<", flush=True)
    print("=" * 55 + "\n", flush=True)

    return jsonify({
        'success': True,
        'message': f'Verification code has been sent via SMS to {masked_phone}.',
        'masked_phone': masked_phone,
        'reset_code': reset_code,
        'otp': reset_code
    }), 200

@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip().lower()
    code = str(data.get('code', '')).strip()
    new_password = str(data.get('new_password', '')).strip()

    if username not in PASSWORD_RESET_CODES or PASSWORD_RESET_CODES[username] != code:
        return jsonify({'success': False, 'message': 'Invalid or expired verification code.'}), 400

    if not new_password:
        return jsonify({'success': False, 'message': 'New password is required.'}), 400

    is_valid, err_msg = validate_password_strength(new_password)
    if not is_valid:
        return jsonify({'success': False, 'message': err_msg}), 400

    new_hash = hash_password(new_password)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    cursor = conn.cursor()

    cursor.execute('SELECT password_hash FROM users WHERE LOWER(username) = ?', (username,))
    user_row = cursor.fetchone()
    if user_row and user_row[0] == new_hash:
        conn.close()
        return jsonify({
            'success': False,
            'message': 'Bawal gamitin ang dating password. Maglagay ng bagong password (Cannot reuse previous password).'
        }), 400

    cursor.execute('UPDATE users SET password_hash = ? WHERE LOWER(username) = ?', (new_hash, username))
    conn.commit()
    conn.close()

    del PASSWORD_RESET_CODES[username]
    return jsonify({'success': True, 'message': 'Password has been successfully reset! You can now sign in.'}), 200

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

    if kiosk[2] is not None and str(kiosk[2]) != str(vendor_id):
        conn.close()
        return jsonify({
            'success': False,
            'message': f'Kiosk {kiosk_code} is currently occupied by vendor "@{kiosk[3]}". Only one vendor can sync at a time.'
        }), 409

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
    kiosk_code = request.args.get("kiosk_code")
    vendor_id = request.args.get("vendor_id")
    view_archived = request.args.get("archived", "0") == "1"

    if not kiosk_code:
        return jsonify([]), 200

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        kiosk = conn.execute(
            "SELECT synced_vendor_id FROM kiosks WHERE kiosk_code = ?", (kiosk_code,)
        ).fetchone()

        if not kiosk or (vendor_id and str(kiosk["synced_vendor_id"]) != str(vendor_id)):
            return jsonify([]), 200

        query = """
            SELECT * FROM inventory 
            WHERE is_archived = ? 
              AND (vendor_id = ? OR vendor_id IS NULL)
            ORDER BY fruit_type ASC
        """
        rows = conn.execute(query, (1 if view_archived else 0, vendor_id)).fetchall()
        return jsonify([dict(r) for r in rows]), 200
    finally:
        conn.close()

@app.route("/api/inventory", methods=["POST"])
def add_fruit_inventory():
    body = request.get_json(silent=True) or {}
    vendor_id = body.get("vendor_id")
    fruit_type = str(body.get("fruit_type", "")).strip().capitalize()
    stock_count = float(body.get("stock_kg", body.get("stock_count", 50.0)))
    price_per_kg = float(body.get("price_per_kg", 100.0))
    supplier_name = str(body.get("supplier_name", "Valenzuela Local Market")).strip()
    supplier_contact = str(body.get("supplier_contact", "N/A")).strip()

    if not fruit_type:
        return jsonify({"error": "invalid_payload", "message": "Ilagay ang pangalan ng prutas."}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        
        # Explicit existence check: avoids SQLite ON CONFLICT index requirements
        if vendor_id:
            existing = cur.execute(
                "SELECT id FROM inventory WHERE LOWER(fruit_type) = LOWER(?) AND (vendor_id = ? OR vendor_id IS NULL)",
                (fruit_type, vendor_id)
            ).fetchone()
        else:
            existing = cur.execute(
                "SELECT id FROM inventory WHERE LOWER(fruit_type) = LOWER(?)",
                (fruit_type,)
            ).fetchone()

        if existing:
            cur.execute("""
                UPDATE inventory 
                SET stock_count = stock_count + ?,
                    price_per_kg = ?,
                    unit_price = ?,
                    supplier_name = ?,
                    supplier_contact = ?,
                    is_archived = 0,
                    vendor_id = COALESCE(vendor_id, ?)
                WHERE id = ?
            """, (stock_count, price_per_kg, price_per_kg, supplier_name, supplier_contact, vendor_id, existing[0]))
        else:
            cur.execute("""
                INSERT INTO inventory (vendor_id, fruit_type, stock_count, price_per_kg, unit_price, supplier_name, supplier_contact, is_archived)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            """, (vendor_id, fruit_type, stock_count, price_per_kg, price_per_kg, supplier_name, supplier_contact))

        conn.commit()
        return jsonify({"success": True, "message": f"Naidagdag ang {fruit_type} sa inventory!"}), 201
    except Exception as e:
        print("[ADD FRUIT ERROR]:", e, flush=True)
        return jsonify({"error": "db_error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route("/api/inventory/<string:fruit_type>", methods=["PUT"])
def update_fruit_inventory(fruit_type):
    body = request.get_json(silent=True) or {}
    vendor_id = body.get("vendor_id")
    new_price = body.get("price_per_kg") or body.get("unit_price")
    new_stock = body.get("stock_count") if body.get("stock_count") is not None else body.get("stock_kg")
    supplier_name = body.get("supplier_name")
    supplier_contact = body.get("supplier_contact")

    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        where_clause = "WHERE LOWER(fruit_type) = LOWER(?)"
        params_base = [fruit_type]
        if vendor_id:
            where_clause += " AND (vendor_id = ? OR vendor_id IS NULL)"
            params_base.append(vendor_id)

        if new_price is not None:
            cur.execute(f"UPDATE inventory SET price_per_kg = ?, unit_price = ? {where_clause}", [float(new_price), float(new_price)] + params_base)
        if new_stock is not None:
            cur.execute(f"UPDATE inventory SET stock_count = ? {where_clause}", [float(new_stock)] + params_base)
        if supplier_name is not None:
            cur.execute(f"UPDATE inventory SET supplier_name = ? {where_clause}", [str(supplier_name)] + params_base)
        if supplier_contact is not None:
            cur.execute(f"UPDATE inventory SET supplier_contact = ? {where_clause}", [str(supplier_contact)] + params_base)

        conn.commit()
        return jsonify({"success": True, "message": f"Updated {fruit_type} inventory."}), 200
    except Exception as e:
        print("[UPDATE FRUIT ERROR]:", e, flush=True)
        return jsonify({"error": "db_error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route("/api/inventory/<string:fruit_type>", methods=["DELETE"])
def archive_fruit_inventory(fruit_type):
    vendor_id = request.args.get("vendor_id")
    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        if vendor_id:
            cur.execute("""
                UPDATE inventory 
                SET is_archived = 1 
                WHERE LOWER(fruit_type) = LOWER(?) 
                  AND (vendor_id = ? OR vendor_id IS NULL)
            """, (fruit_type, vendor_id))
        else:
            cur.execute("""
                UPDATE inventory 
                SET is_archived = 1 
                WHERE LOWER(fruit_type) = LOWER(?)
            """, (fruit_type,))

        conn.commit()
        return jsonify({"success": True, "message": f"Nai-archive ang {fruit_type}."}), 200
    except Exception as e:
        print("[ARCHIVE ERROR]:", e, flush=True)
        return jsonify({"error": "db_error", "message": str(e)}), 500
    finally:
        conn.close()

@app.route("/api/inventory/<string:fruit_type>/restore", methods=["POST"])
def restore_fruit_inventory(fruit_type):
    vendor_id = request.args.get("vendor_id")
    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        if vendor_id:
            cur.execute("""
                UPDATE inventory 
                SET is_archived = 0 
                WHERE LOWER(fruit_type) = LOWER(?) 
                  AND (vendor_id = ? OR vendor_id IS NULL)
            """, (fruit_type, vendor_id))
        else:
            cur.execute("""
                UPDATE inventory 
                SET is_archived = 0 
                WHERE LOWER(fruit_type) = LOWER(?)
            """, (fruit_type,))

        conn.commit()
        return jsonify({"success": True, "message": f"Naibalik ang {fruit_type} sa active inventory."}), 200
    except Exception as e:
        print("[RESTORE ERROR]:", e, flush=True)
        return jsonify({"error": "db_error", "message": str(e)}), 500
    finally:
        conn.close()

# ── Permanent Hard Delete Endpoint ───────────────────────────────────────────
@app.route("/api/inventory/<string:fruit_type>/permanent", methods=["DELETE"])
def permanent_delete_fruit_inventory(fruit_type):
    vendor_id = request.args.get("vendor_id")
    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        cur = conn.cursor()
        if vendor_id:
            cur.execute("""
                DELETE FROM inventory 
                WHERE LOWER(fruit_type) = LOWER(?) 
                  AND (vendor_id = ? OR vendor_id IS NULL)
            """, (fruit_type, vendor_id))
        else:
            cur.execute("DELETE FROM inventory WHERE LOWER(fruit_type) = LOWER(?)", (fruit_type,))

        conn.commit()
        return jsonify({"success": True, "message": f"Tuluyang binura ang {fruit_type} sa database."}), 200
    except Exception as e:
        print("[PERMANENT DELETE ERROR]:", e, flush=True)
        return jsonify({"error": "db_error", "message": str(e)}), 500
    finally:
        conn.close()

# ── Sales History ────────────────────────────────────────────────────────────
@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    kiosk_code = request.args.get("kiosk_code")
    vendor_id = request.args.get("vendor_id")
    filter_preset = request.args.get("filter_preset")

    if not kiosk_code:
        return jsonify([]), 200

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        kiosk = conn.execute(
            "SELECT synced_vendor_id FROM kiosks WHERE kiosk_code = ?", (kiosk_code,)
        ).fetchone()

        if not kiosk or (vendor_id and str(kiosk["synced_vendor_id"]) != str(vendor_id)):
            return jsonify([]), 200

        query = """
            SELECT * FROM transactions 
            WHERE is_archived = 0 
              AND (vendor_id = ? OR vendor_id IS NULL)
        """
        params = [vendor_id]

        if filter_preset == 'today':
            query += " AND DATE(purchased_at) = DATE('now', 'localtime')"
        elif filter_preset == 'week':
            query += " AND DATE(purchased_at) >= DATE('now', '-7 days', 'localtime')"
        elif filter_preset == 'month':
            query += " AND DATE(purchased_at) >= DATE('now', '-30 days', 'localtime')"

        query += " ORDER BY purchased_at DESC"
        rows = conn.execute(query, params).fetchall()
        return jsonify([dict(r) for r in rows]), 200
    finally:
        conn.close()

# ── Inspection Scan Records ──────────────────────────────────────────────────
@app.route("/api/history", methods=["GET"])
def history():
    kiosk_code = request.args.get("kiosk_code")
    limit = int(request.args.get("limit", 50))
    view_archived = request.args.get("archived", "0") == "1"

    if not kiosk_code:
        return jsonify([]), 200

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        kiosk = conn.execute("SELECT synced_vendor_id FROM kiosks WHERE kiosk_code = ?", (kiosk_code,)).fetchone()
        if not kiosk or not kiosk["synced_vendor_id"]:
            return jsonify([]), 200

        where = "WHERE is_archived = 0" if not view_archived else "WHERE is_archived = 1"
        rows = conn.execute(f"SELECT * FROM scans {where} ORDER BY scanned_at DESC LIMIT ?", (limit,)).fetchall()
        return jsonify([dict(r) for r in rows]), 200
    finally:
        conn.close()

@app.route("/api/history/<int:scan_id>", methods=["DELETE"])
def delete_scan(scan_id):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("UPDATE scans SET is_archived = 1 WHERE id = ?", (scan_id,))
    conn.commit()
    conn.close()
    return jsonify({"archived": scan_id}), 200

@app.route("/api/history/<int:scan_id>/restore", methods=["POST"])
def restore_scan(scan_id):
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("UPDATE scans SET is_archived = 0 WHERE id = ?", (scan_id,))
    conn.commit()
    conn.close()
    return jsonify({"restored": scan_id}), 200

# ── Core Scanning and Checkout Endpoints ─────────────────────────────────────
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
            raw_label = str(item.get("detected_fruit") or "").strip()
            fruit_display, sci, parsed_condition, is_bg = parse_model_label(raw_label)

            if is_bg:
                continue

            passed_condition = str(item.get("model_condition") or "").strip().lower()
            condition = passed_condition if passed_condition in CONDITION_LABELS else parsed_condition

            confidence = int(item.get("model_confidence") or 85)
            bbox = item.get("bbox")

            crop, _ = get_analysis_region(frame, bbox)
            crop_filename = save_crop_image(crop, prefix=f"crop_{fruit_display.lower()}_{idx+1}")

            inv = cur.execute("SELECT price_per_kg, unit_price FROM inventory WHERE LOWER(fruit_type) = LOWER(?) AND is_archived = 0", (fruit_display,)).fetchone()
            price_per_kg = inv["price_per_kg"] if inv and "price_per_kg" in inv.keys() else (inv["unit_price"] if inv else 100.0)

            result_item = {
                "fruit":            fruit_display,
                "scientific":       sci,
                "condition":        condition,
                "conditionLabel":   CONDITION_LABELS.get(condition, "Hinog (Ripe)"),
                "confidence":       confidence,
                "rating":           condition_to_rating(condition, confidence),
                "recommendation":   RECOMMENDATIONS.get(condition, RECOMMENDATIONS["ripe"]),
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

        if not analyzed_results:
            return jsonify({
                "success": False,
                "message": "Walang prutas na nakita sa inspection tray.",
                "total_count": 0,
                "results": []
            }), 200

        cur.execute("""
            INSERT INTO transactions (transaction_id, vendor_name, total_amount, total_items, synced, is_archived)
            VALUES (?, ?, ?, ?, 0, 0)
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

@app.route("/api/checkout", methods=["POST"])
def checkout():
    body = request.get_json(silent=True) or {}
    kiosk_code = body.get("kiosk_code")
    scan_ids = body.get("scan_ids") or []
    vendor_name = body.get("vendor_name", "Sigla Ani Kiosk - Valenzuela")
    passed_total = body.get("total_amount")
    fruit_breakdown = body.get("fruit_breakdown") or []

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        
        assigned_vendor_id = None
        if kiosk_code:
            k_row = cur.execute("SELECT synced_vendor_id FROM kiosks WHERE kiosk_code = ?", (kiosk_code,)).fetchone()
            if k_row and k_row["synced_vendor_id"]:
                assigned_vendor_id = k_row["synced_vendor_id"]

        clean_ids = [int(x) for x in scan_ids if str(x).isdigit()]
        rows = []
        if clean_ids:
            placeholders = ",".join("?" for _ in clean_ids)
            rows = cur.execute(f"SELECT * FROM scans WHERE id IN ({placeholders})", clean_ids).fetchall()

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        transaction_id = f"TXN_{ts}"

        if fruit_breakdown:
            for item in fruit_breakdown:
                f_type = str(item.get("fruit_type", "")).strip()
                w_kg = float(item.get("weight_kg", 0.25))
                cur.execute("""
                    UPDATE inventory 
                    SET stock_count = MAX(0, stock_count - ?) 
                    WHERE LOWER(fruit_type) = LOWER(?) AND is_archived = 0
                """, (w_kg, f_type))
            final_amount = float(passed_total) if passed_total is not None else 100.0
        else:
            final_amount = float(passed_total) if passed_total is not None else (len(rows) * 20.0 if rows else 25.0)

        if clean_ids:
            placeholders = ",".join("?" for _ in clean_ids)
            cur.execute(f"""
                UPDATE scans 
                SET transaction_id = ?, is_purchased = 1, synced = 0 
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
                        INSERT INTO scans (fruit, scientific, condition, condition_label, confidence, rating, recommendation, transaction_id, is_purchased, synced, is_archived)
                        VALUES (?, 'SIGLA ANI AI', 'ripe', 'Hinog (Ripe)', 90, 4, 'Napakasariwa at angkop kainin.', ?, 1, 0, 0)
                    """, (f_type, transaction_id))
        else:
            total_items_count = 1
            cur.execute("""
                INSERT INTO scans (fruit, scientific, condition, condition_label, confidence, rating, recommendation, transaction_id, is_purchased, synced, is_archived)
                VALUES ('Fruit', 'SIGLA ANI AI', 'ripe', 'Hinog (Ripe)', 90, 4, 'Napakasariwa at angkop kainin.', ?, 1, 0, 0)
            """, (transaction_id,))

        cur.execute("""
            INSERT INTO transactions (transaction_id, vendor_name, vendor_id, total_amount, total_items, synced, is_archived)
            VALUES (?, ?, ?, ?, ?, 0, 0)
        """, (transaction_id, vendor_name, assigned_vendor_id, round(final_amount, 2), total_items_count))

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

# ── Static File Serving & Receipts ───────────────────────────────────────────
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

if __name__ == "__main__":
    init_db()
    threading.Thread(target=sync_worker_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=5001, debug=True)