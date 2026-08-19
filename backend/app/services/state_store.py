"""SQLite-backed compact cycle, action, and audit persistence."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any, Protocol
from uuid import uuid4

from app.core.config import settings


class HeatShieldStateStore(Protocol):
    def save_cycle(self, cycle_id: str, payload: dict[str, Any]) -> None: ...
    def save_decision(self, decision_id: str, cycle_id: str, payload: dict[str, Any]) -> None: ...
    def get_cycle(self, cycle_id: str) -> dict[str, Any] | None: ...
    def save_action(self, cycle_id: str, action: dict[str, Any]) -> None: ...
    def get_actions(self, cycle_id: str) -> list[dict[str, Any]]: ...
    def update_action(self, cycle_id: str, action_id: str, status: str) -> None: ...
    def save_operational_record(self, action_id: str, cycle_id: str, payload: dict[str, Any]) -> None: ...
    def save_verification(self, verification_id: str, cycle_id: str, payload: dict[str, Any]) -> None: ...
    def get_operational_record(self, action_id: str) -> dict[str, Any] | None: ...
    def add_audit(self, cycle_id: str, event_type: str, details: dict[str, Any] | None = None) -> dict[str, Any]: ...
    def get_audit(self, cycle_id: str) -> list[dict[str, Any]]: ...
    def save_site_snapshot(self, snapshot_id: str, generated_at: str, payload: dict[str, Any]) -> None: ...
    def get_site_snapshot(self, snapshot_id: str) -> dict[str, Any] | None: ...


class _ClosingConnection(sqlite3.Connection):
    """Commit/rollback like sqlite's context manager, then release Windows locks."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class SQLiteHeatShieldStateStore:
    def __init__(self, path: str | Path | None = None) -> None:
        self.path = str(path or settings.heatshield_state_db_path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.path, factory=_ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS cycles (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operational_records (action_id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS verifications (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL, details TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS site_snapshots (id TEXT PRIMARY KEY, generated_at TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS audit_cycle_time ON audit_events(cycle_id, timestamp);
            """)

    def save_cycle(self, cycle_id: str, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as db:
            db.execute("INSERT OR REPLACE INTO cycles VALUES (?, ?)", (cycle_id, json.dumps(payload)))

    def get_cycle(self, cycle_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT payload FROM cycles WHERE id=?", (cycle_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_decision(self, decision_id: str, cycle_id: str, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as db:
            db.execute("INSERT OR REPLACE INTO decisions VALUES (?, ?, ?)", (decision_id, cycle_id, json.dumps(payload)))

    def save_action(self, cycle_id: str, action: dict[str, Any]) -> None:
        with self._lock, self._connect() as db:
            db.execute("INSERT OR REPLACE INTO actions VALUES (?, ?, ?, ?)", (action["action_id"], cycle_id, action["status"], json.dumps(action)))

    def get_actions(self, cycle_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT payload, status FROM actions WHERE cycle_id=? ORDER BY rowid", (cycle_id,)).fetchall()
        result = []
        for row in rows:
            item = json.loads(row[0]); item["status"] = row[1]; result.append(item)
        return result

    def update_action(self, cycle_id: str, action_id: str, status: str) -> None:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT payload FROM actions WHERE id=? AND cycle_id=?", (action_id, cycle_id)).fetchone()
            if not row: raise KeyError("Action does not belong to this cycle")
            payload = json.loads(row[0]); payload["status"] = status
            db.execute("UPDATE actions SET status=?, payload=? WHERE id=?", (status, json.dumps(payload), action_id))

    def save_operational_record(self, action_id: str, cycle_id: str, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as db:
            db.execute("INSERT OR IGNORE INTO operational_records VALUES (?, ?, ?)", (action_id, cycle_id, json.dumps(payload)))

    def get_operational_record(self, action_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT payload FROM operational_records WHERE action_id=?", (action_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_verification(self, verification_id: str, cycle_id: str, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as db:
            db.execute("INSERT OR REPLACE INTO verifications VALUES (?, ?, ?)", (verification_id, cycle_id, json.dumps(payload)))

    def add_audit(self, cycle_id: str, event_type: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
        event = {"event_id": str(uuid4()), "cycle_id": cycle_id, "timestamp": datetime.now(UTC).isoformat(), "event_type": event_type, "safe_details": details or {}}
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)", (event["event_id"], cycle_id, event["timestamp"], event_type, json.dumps(event["safe_details"])))
        return event

    def get_audit(self, cycle_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM audit_events WHERE cycle_id=? ORDER BY timestamp, rowid", (cycle_id,)).fetchall()
        return [{"event_id": row["id"], "cycle_id": cycle_id, "timestamp": row["timestamp"], "event_type": row["event_type"], "safe_details": json.loads(row["details"])} for row in rows]

    def save_site_snapshot(self, snapshot_id: str, generated_at: str, payload: dict[str, Any]) -> None:
        with self._lock, self._connect() as db:
            db.execute("INSERT OR REPLACE INTO site_snapshots VALUES (?, ?, ?)",
                       (snapshot_id, generated_at, json.dumps(payload)))

    def get_site_snapshot(self, snapshot_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT payload FROM site_snapshots WHERE id=?", (snapshot_id,)).fetchone()
        return json.loads(row[0]) if row else None


class InMemoryHeatShieldStateStore:
    def __init__(self) -> None:
        self.cycles: dict[str, dict] = {}; self.decisions: dict[str, dict] = {}; self.actions: dict[str, dict] = {}; self.records: dict[str, dict] = {}; self.verifications: dict[str, dict] = {}; self.audit: list[dict] = []; self.site_snapshots: dict[str, dict] = {}
    def save_cycle(self, cycle_id, payload): self.cycles[cycle_id] = json.loads(json.dumps(payload))
    def get_cycle(self, cycle_id): return self.cycles.get(cycle_id)
    def save_decision(self, decision_id, cycle_id, payload): self.decisions[decision_id] = {"cycle_id": cycle_id, "payload": json.loads(json.dumps(payload))}
    def save_action(self, cycle_id, action): self.actions[action["action_id"]] = {**json.loads(json.dumps(action)), "cycle_id": cycle_id}
    def get_actions(self, cycle_id): return [{k:v for k,v in a.items() if k != "cycle_id"} for a in self.actions.values() if a["cycle_id"] == cycle_id]
    def update_action(self, cycle_id, action_id, status):
        if action_id not in self.actions or self.actions[action_id]["cycle_id"] != cycle_id: raise KeyError("Action does not belong to this cycle")
        self.actions[action_id]["status"] = status
    def save_operational_record(self, action_id, cycle_id, payload): self.records.setdefault(action_id, json.loads(json.dumps(payload)))
    def get_operational_record(self, action_id): return self.records.get(action_id)
    def save_verification(self, verification_id, cycle_id, payload): self.verifications[verification_id] = {"cycle_id": cycle_id, "payload": json.loads(json.dumps(payload))}
    def add_audit(self, cycle_id, event_type, details=None):
        event={"event_id":str(uuid4()),"cycle_id":cycle_id,"timestamp":datetime.now(UTC).isoformat(),"event_type":event_type,"safe_details":details or {}}; self.audit.append(event); return event
    def get_audit(self, cycle_id): return [e for e in self.audit if e["cycle_id"] == cycle_id]
    def save_site_snapshot(self, snapshot_id, generated_at, payload): self.site_snapshots[snapshot_id] = json.loads(json.dumps(payload))
    def get_site_snapshot(self, snapshot_id): return self.site_snapshots.get(snapshot_id)
