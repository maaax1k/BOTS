# === init_db.py ===
from __future__ import annotations
import os
from sqlalchemy import text
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy import inspect

from db import engine, session_scope
from models import Base, Persona, Thread

# Можно задать дефолтную модель для новых/мигрируемых тредов через .env
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemini:gemini-1.5-flash")

DEFAULT_PERSONAS = [
    {
        "id": "friendly",
        "name": "Аня",
        "bio": "27 лет, дружелюбная, эмпатичная, любит кофе и прогулки.",
        "style": "теплая, поддерживающая, легкий юмор, без навязчивости",
        "boundaries": "без интимного контента; уважай границы собеседника",
        "goals": "поддерживать,подбадривать,дружеский диалог",
    },
    {
        "id": "romantic",
        "name": "Лиза",
        "bio": "25 лет, романтичная, любит кино и ночные прогулки.",
        "style": "мягкая, флирт деликатный, искренний и бережный",
        "boundaries": "строго без откровенной эротики; уважай границы и возраст",
        "goals": "создавать теплую атмосферу,забота,лёгкий флирт",
    },
    {
        "id": "neutral",
        "name": "Иван",
        "bio": "30 лет, спокойный советчик, любит технику и логику.",
        "style": "нейтральный, рассудительный, лаконичный",
        "boundaries": "уважай личные границы, избегай токсичности",
        "goals": "давать советы,сохранять нейтралитет,дружелюбно помогать",
    },
]

def ensure_threads_model_column(e: Engine):
    """
    Мягкая миграция: если в таблице threads нет колонки model, добавим её.
    Для SQLite допустим простой ALTER TABLE ADD COLUMN.
    """
    insp = inspect(e)
    try:
        cols = {c["name"] for c in insp.get_columns("threads")}
    except Exception:
        # если таблицы нет — просто выходим, её создаст create_all
        return
    if "model" not in cols:
        with e.begin() as conn:
            # добавляем колонку
            conn.execute(text("ALTER TABLE threads ADD COLUMN model VARCHAR NOT NULL DEFAULT ''"))
            # заполняем дефолтом
            conn.execute(text("UPDATE threads SET model = :m WHERE model = '' OR model IS NULL"), {"m": DEFAULT_MODEL})

def seed_personas():
    with session_scope() as s:
        for p in DEFAULT_PERSONAS:
            if not s.get(Persona, p["id"]):
                s.add(Persona(**p))

def backfill_threads_model_if_empty():
    # На случай, если колонка есть, но пустая — проставим дефолт.
    with session_scope() as s:
        s.execute(
            text("UPDATE threads SET model = :m WHERE model = '' OR model IS NULL"),
            {"m": DEFAULT_MODEL},
        )

def main():

    Base.metadata.create_all(engine)

    ensure_threads_model_column(engine)

    seed_personas()

    backfill_threads_model_if_empty()

    print("DB init OK. DEFAULT_MODEL =", DEFAULT_MODEL)

if __name__ == "__main__":
    main()
