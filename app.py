"""
SiglaAni — Flask Backend
"""

import os, sqlite3, base64
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

    # Ensure all dynamic inventory columns exist
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

# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "mode": "teachable_machine_priority"})

# ── Phase 5: Vendor Inventory & Supplier Routes ──────────────────────────────
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

    # Save the original full frame
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

# ── Phase 2: Batch Checkout Endpoint ──────────────────────────────────────────
@app.route("/api/checkout", methods=["POST"])
def checkout():
    body = request.get_json(silent=True) or {}
    scan_ids = body.get("scan_ids") or []
    vendor_name = body.get("vendor_name", "Sigla Ani Kiosk - Valenzuela")

    if not scan_ids:
        return jsonify({"error": "no_items", "message": "Walang scan IDs na ibinigay para sa checkout."}), 400

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        
        placeholders = ",".join("?" for _ in scan_ids)
        rows = cur.execute(f"SELECT * FROM scans WHERE id IN ({placeholders})", scan_ids).fetchall()
        
        if not rows:
            return jsonify({"error": "not_found", "message": "Hindi nahanap ang mga na-scan na prutas."}), 404

        total_amount = 0.0
        for r in rows:
            fruit_name = r["fruit"]
            inv = cur.execute("SELECT unit_price, stock_count FROM inventory WHERE LOWER(fruit_type) = LOWER(?)", (fruit_name,)).fetchone()
            price = inv["unit_price"] if inv else 20.0
            total_amount += price

            cur.execute("""
                UPDATE inventory 
                SET stock_count = MAX(0, stock_count - 1) 
                WHERE LOWER(fruit_type) = LOWER(?)
            """, (fruit_name,))

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        transaction_id = f"TXN_{ts}"

        cur.execute("""
            INSERT INTO transactions (transaction_id, vendor_name, total_amount, total_items)
            VALUES (?, ?, ?, ?)
        """, (transaction_id, vendor_name, round(total_amount, 2), len(rows)))

        cur.execute(f"""
            UPDATE scans 
            SET transaction_id = ?, is_purchased = 1 
            WHERE id IN ({placeholders})
        """, [transaction_id] + scan_ids)

        conn.commit()

        return jsonify({
            "success": True,
            "transaction_id": transaction_id,
            "qr_payload": f"siglaani://receipt/{transaction_id}",
            "total_amount": round(total_amount, 2),
            "total_items": len(rows)
        }), 200
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