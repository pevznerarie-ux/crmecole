from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from datetime import datetime, timezone
import json
import os
import sqlite3
import uuid


ROOT = Path(__file__).resolve().parent
DATA_ROOT = Path(os.environ.get("DATA_DIR") or ("/data" if Path("/data").exists() else ROOT))
DATA_ROOT.mkdir(parents=True, exist_ok=True)
STATE_FILE = DATA_ROOT / "crm-state.json"
DB_FILE = DATA_ROOT / "crm.sqlite"

COLLECTIONS = {
    "records",
    "payments",
    "imports",
    "users",
    "groups",
    "interactions",
    "linkages",
    "customFields",
    "receiptTemplates",
    "savedViews",
    "auditLog",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def connect():
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS collection_items (
                collection TEXT NOT NULL,
                item_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (collection, item_id)
            )
            """
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_collection_position ON collection_items(collection, position)"
        )
        count = db.execute("SELECT COUNT(*) FROM collection_items").fetchone()[0]
        if count == 0 and STATE_FILE.exists():
            try:
                data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                if data.get("version") == 1:
                    write_state_to_db(db, data)
            except Exception:
                pass


def item_key(collection, item, position=0):
    if not isinstance(item, dict):
        return f"row-{position}"
    for key in ("id", "email", "name"):
        value = item.get(key)
        if value:
            return str(value)
    if collection == "imports" and (item.get("date") or item.get("file")):
        return f"{item.get('date', '')}:{item.get('file', '')}:{position}"
    if collection == "linkages":
        return f"{item.get('a', '')}:{item.get('roleA', '')}:{item.get('b', '')}:{item.get('roleB', '')}:{position}"
    return f"row-{position}-{uuid.uuid4().hex[:8]}"


def state_from_db():
    with connect() as db:
        count = db.execute("SELECT COUNT(*) FROM collection_items").fetchone()[0]
        if count == 0:
            return {}
        state = {
            "version": 1,
            "savedAt": get_meta(db, "savedAt") or now_iso(),
            "state": json.loads(get_meta(db, "uiState") or "{}"),
        }
        for collection in COLLECTIONS:
            rows = db.execute(
                """
                SELECT payload
                FROM collection_items
                WHERE collection = ?
                ORDER BY position ASC, item_id ASC
                """,
                (collection,),
            ).fetchall()
            state[collection] = [json.loads(row["payload"]) for row in rows]
        return state


def write_state_to_db(db, data):
    saved_at = data.get("savedAt") or now_iso()
    db.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
        ("savedAt", saved_at),
    )
    db.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
        ("uiState", json.dumps(data.get("state") or {}, ensure_ascii=False)),
    )
    for collection in COLLECTIONS:
        db.execute("DELETE FROM collection_items WHERE collection = ?", (collection,))
        items = data.get(collection) or []
        if not isinstance(items, list):
            items = []
        timestamp = now_iso()
        for position, item in enumerate(items):
            key = item_key(collection, item, position)
            db.execute(
                """
                INSERT OR REPLACE INTO collection_items
                    (collection, item_id, position, payload, created_at, updated_at)
                VALUES (?, ?, ?, ?, COALESCE(
                    (SELECT created_at FROM collection_items WHERE collection = ? AND item_id = ?),
                    ?
                ), ?)
                """,
                (
                    collection,
                    key,
                    position,
                    json.dumps(item, ensure_ascii=False),
                    collection,
                    key,
                    timestamp,
                    timestamp,
                ),
            )


def persist_json_backup(data):
    STATE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_meta(db, key):
    row = db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def api_counts():
    with connect() as db:
        rows = db.execute(
            "SELECT collection, COUNT(*) AS count FROM collection_items GROUP BY collection ORDER BY collection"
        ).fetchall()
        return {row["collection"]: row["count"] for row in rows}


def list_collection(collection, query=None):
    with connect() as db:
        rows = db.execute(
            """
            SELECT item_id, payload, created_at, updated_at
            FROM collection_items
            WHERE collection = ?
            ORDER BY position ASC, item_id ASC
            """,
            (collection,),
        ).fetchall()
    items = []
    q = (query or "").lower().strip()
    for row in rows:
        item = json.loads(row["payload"])
        item["_backendId"] = row["item_id"]
        item["_createdAt"] = row["created_at"]
        item["_updatedAt"] = row["updated_at"]
        if not q or q in json.dumps(item, ensure_ascii=False).lower():
            items.append(item)
    return items


def get_item(collection, item_id):
    with connect() as db:
        row = db.execute(
            """
            SELECT item_id, payload, created_at, updated_at
            FROM collection_items
            WHERE collection = ? AND item_id = ?
            """,
            (collection, item_id),
        ).fetchone()
    if not row:
        return None
    item = json.loads(row["payload"])
    item["_backendId"] = row["item_id"]
    item["_createdAt"] = row["created_at"]
    item["_updatedAt"] = row["updated_at"]
    return item


def upsert_item(collection, data, item_id=None):
    if not isinstance(data, dict):
        raise ValueError("JSON object expected")
    key = item_id or item_key(collection, data, 0)
    if not data.get("id") and collection in {"records", "payments", "interactions"}:
        data["id"] = key
    with connect() as db:
        last_position = db.execute(
            "SELECT COALESCE(MAX(position), -1) FROM collection_items WHERE collection = ?",
            (collection,),
        ).fetchone()[0]
        existing = db.execute(
            "SELECT position, created_at FROM collection_items WHERE collection = ? AND item_id = ?",
            (collection, key),
        ).fetchone()
        position = existing["position"] if existing else last_position + 1
        created_at = existing["created_at"] if existing else now_iso()
        updated_at = now_iso()
        db.execute(
            """
            INSERT OR REPLACE INTO collection_items
                (collection, item_id, position, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (collection, key, position, json.dumps(data, ensure_ascii=False), created_at, updated_at),
        )
        rebuild_state_backup(db)
    return get_item(collection, key)


def delete_item(collection, item_id):
    with connect() as db:
        cursor = db.execute(
            "DELETE FROM collection_items WHERE collection = ? AND item_id = ?",
            (collection, item_id),
        )
        deleted = cursor.rowcount > 0
        if deleted:
            rebuild_state_backup(db)
    return deleted


def rebuild_state_backup(db):
    data = {
        "version": 1,
        "savedAt": now_iso(),
        "state": json.loads(get_meta(db, "uiState") or "{}"),
    }
    db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)", ("savedAt", data["savedAt"]))
    for collection in COLLECTIONS:
        rows = db.execute(
            "SELECT payload FROM collection_items WHERE collection = ? ORDER BY position ASC, item_id ASC",
            (collection,),
        ).fetchall()
        data[collection] = [json.loads(row["payload"]) for row in rows]
    persist_json_backup(data)


class SinaiCrmHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/api/health":
            self.send_json({
                "ok": True,
                "backend": "sqlite",
                "database": str(DB_FILE),
                "jsonBackup": str(STATE_FILE),
                "collections": api_counts(),
            })
            return
        if path == "/api/state":
            self.send_json(state_from_db())
            return
        if path == "/api/collections":
            self.send_json({"collections": sorted(COLLECTIONS), "counts": api_counts()})
            return
        route = self.collection_route(path)
        if route:
            collection, item_id = route
            if item_id:
                item = get_item(collection, item_id)
                if item is None:
                    self.send_error_json(404, "Element introuvable")
                else:
                    self.send_json(item)
            else:
                self.send_json({
                    "items": list_collection(collection, (query.get("q") or [""])[0]),
                    "count": len(list_collection(collection, (query.get("q") or [""])[0])),
                })
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            data = self.read_json()
            if data.get("version") != 1:
                self.send_error_json(400, "Version de sauvegarde non supportee")
                return
            with connect() as db:
                write_state_to_db(db, data)
            persist_json_backup(data)
            self.send_json({"ok": True, "savedAt": data.get("savedAt")})
            return
        route = self.collection_route(parsed.path)
        if route and not route[1]:
            try:
                item = upsert_item(route[0], self.read_json())
                self.send_json(item, status=201)
            except Exception as exc:
                self.send_error_json(400, str(exc))
            return
        self.send_error_json(404, "Route API introuvable")

    def do_PUT(self):
        self.update_item()

    def do_PATCH(self):
        self.update_item(partial=True)

    def do_DELETE(self):
        route = self.collection_route(urlparse(self.path).path)
        if not route or not route[1]:
            self.send_error_json(404, "Route API introuvable")
            return
        deleted = delete_item(route[0], route[1])
        if not deleted:
            self.send_error_json(404, "Element introuvable")
            return
        self.send_json({"ok": True, "deleted": route[1]})

    def update_item(self, partial=False):
        route = self.collection_route(urlparse(self.path).path)
        if not route or not route[1]:
            self.send_error_json(404, "Route API introuvable")
            return
        collection, item_id = route
        try:
            data = self.read_json()
            if partial:
                current = get_item(collection, item_id)
                if current is None:
                    self.send_error_json(404, "Element introuvable")
                    return
                for key in list(current):
                    if key.startswith("_"):
                        current.pop(key, None)
                current.update(data)
                data = current
            item = upsert_item(collection, data, item_id)
            self.send_json(item)
        except Exception as exc:
            self.send_error_json(400, str(exc))

    def collection_route(self, path):
        parts = [unquote(part) for part in path.strip("/").split("/") if part]
        if len(parts) < 2 or parts[0] != "api" or parts[1] not in COLLECTIONS:
            return None
        item_id = parts[2] if len(parts) > 2 else None
        return parts[1], item_id

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        if not body:
            return {}
        return json.loads(body)

    def send_json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_error_json(self, status, message):
        self.send_json({"ok": False, "error": message}, status=status)


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8766"))
    host = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    server = ThreadingHTTPServer((host, port), SinaiCrmHandler)
    print(f"CRM Sinai backend running at http://{host}:{port}/index.html")
    print(f"SQLite database: {DB_FILE}")
    server.serve_forever()
