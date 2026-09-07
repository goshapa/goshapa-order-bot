import json
from datetime import datetime, timezone

import aiosqlite

from config import DB_PATH

VALID_STATUSES = ("New", "Contacted", "In Progress", "Completed", "Cancelled")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    telegram_id INTEGER NOT NULL,
    username TEXT,
    full_name TEXT,
    service TEXT NOT NULL,
    bundle TEXT NOT NULL,
    answers TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'New',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(_SCHEMA)
        await db.commit()


async def create_order(
    telegram_id: int,
    username: str | None,
    full_name: str | None,
    service: str,
    bundle: str,
    answers: dict,
) -> str:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO orders
                (order_number, telegram_id, username, full_name, service, bundle, answers, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'New', ?, ?)
            """,
            ("", telegram_id, username, full_name, service, bundle, json.dumps(answers, ensure_ascii=False), now, now),
        )
        order_id = cursor.lastrowid
        order_number = f"GS-{order_id:06d}"
        await db.execute(
            "UPDATE orders SET order_number = ? WHERE id = ?",
            (order_number, order_id),
        )
        await db.commit()
        return order_number


async def update_status(order_number: str, status: str) -> bool:
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}")
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "UPDATE orders SET status = ?, updated_at = ? WHERE order_number = ?",
            (status, now, order_number),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_order(order_number: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM orders WHERE order_number = ?", (order_number,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
