from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import secrets
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


# ---------- Comptes & sessions --------------------------------------------
# Authentification réelle, séparée du blob JSON générique (COLLECTIONS) pour
# que les identifiants ne transitent jamais par /api/state, qui est un simple
# dump/restauration de tout le CRM. Table dédiée + mots de passe hachés
# (PBKDF2-HMAC-SHA256, sel aléatoire par compte) : aucune dépendance externe.
SESSION_TTL_DAYS = 30
PROFILES = ("Administrateur", "Collecte", "Comptabilité", "Lecture seule")
HASH_ITERATIONS = 200_000


def hash_password(password, salt_hex=None):
    salt_hex = salt_hex or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), HASH_ITERATIONS
    ).hex()
    return digest, salt_hex


def verify_password(password, digest, salt_hex):
    check, _ = hash_password(password, salt_hex)
    return secrets.compare_digest(check, digest)


def init_auth_tables(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            first TEXT,
            last TEXT,
            profile TEXT NOT NULL DEFAULT 'Lecture seule',
            scope_mode TEXT NOT NULL DEFAULT 'all',
            scope_tags TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            last_login TEXT
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )
        """
    )


def accounts_count():
    with connect() as db:
        return db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]


def public_account(row):
    d = dict(row)
    d.pop("password_hash", None)
    salt = d.pop("salt", None)
    return {
        "id": d["id"],
        "email": d["email"],
        "first": d.get("first") or "",
        "last": d.get("last") or "",
        "profile": d.get("profile") or "Lecture seule",
        "scopeMode": d.get("scope_mode") or "all",
        "scopeTags": json.loads(d.get("scope_tags") or "[]"),
        "createdAt": d.get("created_at"),
        "lastLogin": d.get("last_login"),
    }


def create_account(email, password, first="", last="", profile="Lecture seule", scope_mode="all", scope_tags=None):
    email = (email or "").strip().lower()
    if not email or not password:
        raise ValueError("Email et mot de passe requis")
    if profile not in PROFILES:
        profile = "Lecture seule"
    digest, salt = hash_password(password)
    account_id = f"U-{uuid.uuid4().hex[:10]}"
    created = now_iso()
    with connect() as db:
        try:
            db.execute(
                """
                INSERT INTO accounts
                    (id, email, password_hash, salt, first, last, profile, scope_mode, scope_tags, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (account_id, email, digest, salt, first, last, profile, scope_mode,
                 json.dumps(scope_tags or [], ensure_ascii=False), created),
            )
        except sqlite3.IntegrityError:
            raise ValueError("Un compte existe déjà avec cet email")
        row = db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    return public_account(row)


def create_session(account_id):
    token = secrets.token_urlsafe(32)
    created = now_iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    with connect() as db:
        db.execute(
            "INSERT INTO sessions(token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, account_id, created, expires),
        )
    return token


def account_from_token(token):
    if not token:
        return None
    with connect() as db:
        row = db.execute(
            "SELECT account_id, expires_at FROM sessions WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < now_iso():
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return None
        acct = db.execute("SELECT * FROM accounts WHERE id = ?", (row["account_id"],)).fetchone()
        return acct


def scope_visible_record_ids(records, scope_tags):
    allowed = {t.lower() for t in (scope_tags or [])}
    ids = set()
    for r in records:
        if not isinstance(r, dict):
            continue
        if r.get("kind") == "Structure":
            ids.add(r.get("id"))
            continue
        labels = {str(t).lower() for t in ((r.get("tags") or []) + (r.get("segments") or []) + (r.get("groups") or []))}
        if labels & allowed:
            ids.add(r.get("id"))
    return ids


def apply_scope_to_state(data, account):
    """Filtre records/payments/interactions pour un compte à accès restreint.
    Ne modifie jamais les données en base : ne touche que la copie renvoyée."""
    if account["scope_mode"] != "tags":
        return data
    scope_tags = json.loads(account["scope_tags"] or "[]")
    records = data.get("records") or []
    visible_ids = scope_visible_record_ids(records, scope_tags)
    filtered = dict(data)
    filtered["records"] = [r for r in records if r.get("id") in visible_ids]
    filtered["payments"] = [p for p in (data.get("payments") or []) if p.get("recordId") in visible_ids]
    filtered["interactions"] = [i for i in (data.get("interactions") or []) if i.get("recordId") in visible_ids]
    filtered["users"] = []
    return filtered


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
        init_auth_tables(db)
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


def write_state_to_db(db, data, merge_collections=None):
    """merge_collections=None : comportement historique, remplace tout (utilisé
    pour un compte non restreint). Sinon : fusionne uniquement les collections
    listées (sans jamais supprimer les éléments existants hors de ce lot) et
    ignore complètement les autres collections — utilisé pour un compte à
    accès restreint dont le navigateur ne voit qu'un sous-ensemble des
    données, pour qu'un enregistrement ne puisse jamais effacer ce qu'il ne
    voit pas."""
    saved_at = data.get("savedAt") or now_iso()
    db.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
        ("savedAt", saved_at),
    )
    if merge_collections is None:
        db.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
            ("uiState", json.dumps(data.get("state") or {}, ensure_ascii=False)),
        )
    target_collections = merge_collections if merge_collections is not None else COLLECTIONS
    for collection in target_collections:
        if merge_collections is None:
            db.execute("DELETE FROM collection_items WHERE collection = ?", (collection,))
        items = data.get(collection) or []
        if not isinstance(items, list):
            items = []
        timestamp = now_iso()
        for position, item in enumerate(items):
            key = item_key(collection, item, position)
            if merge_collections is not None:
                existing = db.execute(
                    "SELECT position FROM collection_items WHERE collection = ? AND item_id = ?",
                    (collection, key),
                ).fetchone()
                if existing is None:
                    last_position = db.execute(
                        "SELECT COALESCE(MAX(position), -1) FROM collection_items WHERE collection = ?",
                        (collection,),
                    ).fetchone()[0]
                    position = last_position + 1
                else:
                    position = existing["position"]
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ---------- Authentification --------------------------------------
    def bearer_token(self):
        header = self.headers.get("Authorization") or ""
        if header.lower().startswith("bearer "):
            return header[7:].strip()
        return None

    def current_account(self):
        return account_from_token(self.bearer_token())

    def require_account(self, admin_only=False):
        account = self.current_account()
        if not account:
            self.send_error_json(401, "Connexion requise")
            return None
        if admin_only and account["profile"] != "Administrateur":
            self.send_error_json(403, "Réservé aux administrateurs")
            return None
        return account

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
        if path == "/api/auth/status":
            self.send_json({"setupRequired": accounts_count() == 0})
            return
        if path == "/api/auth/me":
            account = self.require_account()
            if not account:
                return
            self.send_json(public_account(account))
            return
        if path == "/api/accounts":
            if not self.require_account(admin_only=True):
                return
            with connect() as db:
                rows = db.execute("SELECT * FROM accounts ORDER BY created_at ASC").fetchall()
            self.send_json({"items": [public_account(r) for r in rows]})
            return

        # Tout le reste de l'API nécessite une session valide.
        if path.startswith("/api/"):
            account = self.require_account()
            if not account:
                return

        if path == "/api/state":
            data = state_from_db()
            data = apply_scope_to_state(data, account)
            self.send_json(data)
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
        path = parsed.path

        if path == "/api/auth/setup":
            if accounts_count() > 0:
                self.send_error_json(409, "Un compte administrateur existe déjà")
                return
            data = self.read_json()
            try:
                account = create_account(
                    data.get("email"), data.get("password"),
                    first=data.get("first", ""), last=data.get("last", ""),
                    profile="Administrateur", scope_mode="all",
                )
            except ValueError as exc:
                self.send_error_json(400, str(exc))
                return
            token = create_session(account["id"])
            self.send_json({"token": token, "account": account}, status=201)
            return

        if path == "/api/auth/login":
            data = self.read_json()
            email = (data.get("email") or "").strip().lower()
            password = data.get("password") or ""
            with connect() as db:
                row = db.execute("SELECT * FROM accounts WHERE email = ?", (email,)).fetchone()
            if not row or not verify_password(password, row["password_hash"], row["salt"]):
                self.send_error_json(401, "Email ou mot de passe incorrect")
                return
            with connect() as db:
                db.execute("UPDATE accounts SET last_login = ? WHERE id = ?", (now_iso(), row["id"]))
            token = create_session(row["id"])
            self.send_json({"token": token, "account": public_account(row)})
            return

        if path == "/api/auth/logout":
            token = self.bearer_token()
            if token:
                with connect() as db:
                    db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            self.send_json({"ok": True})
            return

        if path == "/api/accounts":
            if not self.require_account(admin_only=True):
                return
            data = self.read_json()
            try:
                account = create_account(
                    data.get("email"), data.get("password"),
                    first=data.get("first", ""), last=data.get("last", ""),
                    profile=data.get("profile", "Lecture seule"),
                    scope_mode=data.get("scopeMode", "all"),
                    scope_tags=data.get("scopeTags") or [],
                )
            except ValueError as exc:
                self.send_error_json(400, str(exc))
                return
            self.send_json(account, status=201)
            return

        # Tout le reste de l'API nécessite une session valide.
        account = self.require_account()
        if not account:
            return

        if path == "/api/state":
            if account["profile"] == "Lecture seule":
                self.send_error_json(403, "Compte en lecture seule : enregistrement impossible")
                return
            data = self.read_json()
            if data.get("version") != 1:
                self.send_error_json(400, "Version de sauvegarde non supportee")
                return
            if account["scope_mode"] == "all":
                # Cet appareil voit l'intégralité des fiches (aucun filtre côté
                # lecture) : sa copie locale est donc complète et un remplacement
                # total est fiable (les suppressions se propagent normalement).
                with connect() as db:
                    write_state_to_db(db, data)
                persist_json_backup(data)
            else:
                # Compte à accès restreint : sa copie locale ne contient que son
                # périmètre. On ne fusionne donc que les collections "de terrain",
                # uniquement pour les fiches dans son périmètre — jamais de
                # remplacement total, qui effacerait ce qu'il ne voit pas.
                scope_tags = json.loads(account["scope_tags"] or "[]")
                records = data.get("records") or []
                visible_ids = scope_visible_record_ids(records, scope_tags)
                data = dict(data)
                data["records"] = [r for r in records if r.get("id") in visible_ids]
                data["payments"] = [p for p in (data.get("payments") or []) if p.get("recordId") in visible_ids]
                data["interactions"] = [i for i in (data.get("interactions") or []) if i.get("recordId") in visible_ids]
                with connect() as db:
                    write_state_to_db(db, data, merge_collections={"records", "payments", "interactions", "auditLog"})
                    rebuild_state_backup(db)
            self.send_json({"ok": True, "savedAt": data.get("savedAt")})
            return

        route = self.collection_route(path)
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
        parsed = urlparse(self.path)
        parts = [unquote(p) for p in parsed.path.strip("/").split("/") if p]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "accounts":
            if not self.require_account(admin_only=True):
                return
            data = self.read_json()
            fields, values = [], []
            for key, column in (("first", "first"), ("last", "last"), ("profile", "profile")):
                if key in data:
                    fields.append(f"{column} = ?")
                    values.append(data[key])
            if "scopeMode" in data:
                fields.append("scope_mode = ?")
                values.append(data["scopeMode"])
            if "scopeTags" in data:
                fields.append("scope_tags = ?")
                values.append(json.dumps(data["scopeTags"] or [], ensure_ascii=False))
            if data.get("password"):
                digest, salt = hash_password(data["password"])
                fields.append("password_hash = ?")
                values.append(digest)
                fields.append("salt = ?")
                values.append(salt)
            if not fields:
                self.send_error_json(400, "Rien à mettre à jour")
                return
            values.append(parts[2])
            with connect() as db:
                db.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?", values)
                row = db.execute("SELECT * FROM accounts WHERE id = ?", (parts[2],)).fetchone()
            if not row:
                self.send_error_json(404, "Compte introuvable")
                return
            self.send_json(public_account(row))
            return
        self.update_item(partial=True)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        parts = [unquote(p) for p in parsed.path.strip("/").split("/") if p]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "accounts":
            admin = self.require_account(admin_only=True)
            if not admin:
                return
            if admin["id"] == parts[2]:
                self.send_error_json(400, "Impossible de supprimer son propre compte")
                return
            with connect() as db:
                cursor = db.execute("DELETE FROM accounts WHERE id = ?", (parts[2],))
                db.execute("DELETE FROM sessions WHERE account_id = ?", (parts[2],))
            if cursor.rowcount == 0:
                self.send_error_json(404, "Compte introuvable")
                return
            self.send_json({"ok": True, "deleted": parts[2]})
            return
        if not self.require_account():
            return
        route = self.collection_route(parsed.path)
        if not route or not route[1]:
            self.send_error_json(404, "Route API introuvable")
            return
        deleted = delete_item(route[0], route[1])
        if not deleted:
            self.send_error_json(404, "Element introuvable")
            return
        self.send_json({"ok": True, "deleted": route[1]})

    def update_item(self, partial=False):
        if not self.require_account():
            return
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
