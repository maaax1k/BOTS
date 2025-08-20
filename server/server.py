from __future__ import annotations
import os, json
from typing import List, Dict
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.orm import joinedload
from dotenv import load_dotenv
from typing import Optional



from db import session_scope
from models import Persona, Thread, Message

load_dotenv()
app = FastAPI(title="Chat API with SQLite")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
LAST_TURNS = int(os.getenv("LAST_TURNS", "12"))
TEMP_DEFAULT = float(os.getenv("TEMP_DEFAULT", "0.7"))

class ChatIn(BaseModel):
    model: str          # "gemini:gemini-1.5-flash" | "ollama:llama3"
    personaId: str
    message: str
    threadId: str
    temperature: Optional[float] = None  # ← НОВОЕ

class ChatOut(BaseModel):
    text: str

# рядом с ChatIn/ChatOut
class PersonaOut(BaseModel):
    id: str
    name: str
    bio: str
    style: str
    boundaries: str
    goals: str  # храним CSV-строкой

class PersonaIn(BaseModel):
    name: str
    bio: str
    style: str
    boundaries: str
    goals: str  # CSV строка, например: "поддерживать,подбадривать,дружеский диалог"


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: str

class ThreadOut(BaseModel):
    id: str
    persona_id: str
    summary: str


def system_prompt(persona: Persona) -> str:
    goals = persona.goals
    return (
        f"Ты играешь роль: {persona.name}.\n"
        f"Био: {persona.bio}.\n"
        f"Стиль: {persona.style}.\n"
        f"Границы: {persona.boundaries}.\n"
        f"Цели: {goals}.\n"
        # --- Глобальные правила стиля ---
        "Коммуникация: пиши как реальный человек в личном чате. "
        "Короткие живые реплики (1–4 предложения), иногда уточняющий вопрос.\n"
        "Запреты: не используй эмодзи, смайлики, ASCII-арт, стикеры и реакции; "
        "не используй Markdown/списки/таблицы без явной просьбы; "
        "не ставь кавычки вокруг своих фраз без необходимости.\n"
        "Тон: естественный, дружелюбный, без искусственной приподнятости и шаблонных фраз. "
        "Если чего-то не знаешь — скажи кратко и предложи уточнить. Без лишних дисклеймеров.\n"
        "Персона: говори от первого лица, сохраняй характер и границы персоны. "
        "Не раскрывай, что ты ИИ/модель.\n"
        "Язык: русский, разговорный.\n"
    )



def split_provider(spec: str):
    a, b = spec.split(":", 1)
    return a.strip(), b.strip()


def to_gemini_payload(messages: List[Dict[str, str]]) -> Dict:
    arr = []
    for m in messages:
        role = m["role"]
        arr.append({
            "role": "user" if role in ("user", "system") else "model",
            "parts": [{"text": m["content"]}],
        })
    return {"contents": arr}


async def call_gemini(
    model: str,
    messages: list[dict[str, str]],
    temperature: float = TEMP_DEFAULT,
) -> str:
    if not GEMINI_KEY:
        return "(Не задан GEMINI_API_KEY)"

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={GEMINI_KEY}"
    )

    system_parts = [{"text": m["content"]} for m in messages if m.get("role") == "system"]
    ua_messages = [
        {
            "role": "user" if m["role"] == "user" else "model",  # assistant -> model
            "parts": [{"text": m["content"]}],
        }
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]

    gen_cfg = {
        "temperature": max(0.0, min(2.0, float(temperature))),
    }

    payload = {
        "contents": ua_messages,
        "generationConfig": gen_cfg,
    }
    if system_parts:

        payload["systemInstruction"] = {"role": "user", "parts": system_parts}

    try:
        async with httpx.AsyncClient(timeout=60) as cli:
            r = await cli.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:

        try:
            detail = e.response.json()
        except Exception:
            detail = e.response.text if e.response is not None else str(e)
        return f"(Gemini HTTP {e.response.status_code if e.response else ''}: {detail})"
    except Exception as e:
        return f"(Gemini ошибка сети: {e})"
    pf = data.get("promptFeedback", {})
    if pf.get("blockReason"):
        return f"(Gemini заблокировал запрос: {pf.get('blockReason')})"


    candidates = data.get("candidates") or []
    for c in candidates:
        content = (c.get("content") or {})
        parts = content.get("parts") or []
  
        out = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        if out.strip():
            return out.strip()

    finish = candidates[0].get("finishReason") if candidates else None
    return f"(Gemini не вернул текст; finishReason={finish})"


async def call_openrouter(
    model: str,
    messages: list[dict[str, str]],
    temperature: float = TEMP_DEFAULT
) -> str:
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        return "(Не задан OPENROUTER_API_KEY)"

    url = f"{os.getenv('OPENROUTER_URL', 'https://openrouter.ai/api/v1')}/chat/completions"

    # Нормализация ролей под OpenAI-стиль (OpenRouter его понимает)
    norm_msgs = []
    for m in messages:
        role = (m.get("role") or "user").lower()
        if role not in ("system", "user", "assistant"):
            role = "user"
        norm_msgs.append({"role": role, "content": m.get("content", "")})

    payload = {
        "model": model,  # напр. "openai/gpt-oss-20b"
        "messages": norm_msgs,
        "temperature": max(0.0, min(2.0, float(temperature))),
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # Рекомендуется OpenRouter (для rate limiting/идентификации клиента)
        "HTTP-Referer": "http://localhost",
        "X-Title": "Multi-Model Persona Chat",
    }

    try:
        async with httpx.AsyncClient(timeout=60) as cli:
            r = await cli.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        try:
            detail = e.response.json()
        except Exception:
            detail = e.response.text if e.response is not None else str(e)
        return f"(OpenRouter HTTP {e.response.status_code if e.response else ''}: {detail})"
    except Exception as e:
        return f"(OpenRouter ошибка сети: {e})"

    try:
        return (data["choices"][0]["message"]["content"] or "").strip()
    except Exception:
        return f"(OpenRouter: неожиданный ответ {str(data)[:300]}...)"






async def call_ollama(model: str, messages: list[dict[str, str]], temperature: float = TEMP_DEFAULT) -> str:
    url = f"{OLLAMA_URL}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": max(0.0, min(2.0, float(temperature)))
        }
    }
    async with httpx.AsyncClient(timeout=120) as cli:
        r = await cli.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):
            if data.get("message") and data["message"].get("content"):
                return data["message"]["content"]
            return data.get("response", "")
        return "(пустой ответ ollama)"



@app.post("/api/chat", response_model=ChatOut)
async def chat(inp: ChatIn):
    with session_scope() as s:
        persona = s.get(Persona, inp.personaId)
        if not persona:
            raise HTTPException(404, "persona not found")

        thread = s.get(Thread, inp.threadId)
        if not thread:
            thread = Thread(id=inp.threadId, persona_id=persona.id, summary="")
            s.add(thread)
            s.flush()

        # записываем входящее сообщение
        s.add(Message(thread_id=thread.id, role="user", content=inp.message))
        s.flush()

        # собираем short-context последних LAST_TURNS
        last_msgs = s.execute(
            select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at.desc()).limit(LAST_TURNS)
        ).scalars().all()[::-1]

        messages = [
            {"role": "system", "content": system_prompt(persona)},
            {"role": "system", "content": f"Контекст: {thread.summary or 'пока пусто'}"},
        ] + [{"role": m.role, "content": m.content} for m in last_msgs]

    # вызываем модель вне транзакции
    vendor, model_name = split_provider(inp.model)
    temp = inp.temperature if inp.temperature is not None else TEMP_DEFAULT

    if vendor == "gemini":
        out_text = await call_gemini(model_name, messages, temperature=temp)
    elif vendor == "ollama":
        out_text = await call_ollama(model_name, messages, temperature=temp)
    elif vendor == "openrouter":
        out_text = await call_openrouter(model_name, messages, temperature=temp)
    else:
        out_text = "(поддержаны только gemini:*, ollama:*, openrouter:*)"



    # сохраняем ответ ассистента
    with session_scope() as s:
        s.add(Message(thread_id=inp.threadId, role="assistant", content=out_text))
    return ChatOut(text=out_text)


# === Admin/CRUD endpoints ===
@app.get("/api/threads", response_model=list[ThreadOut])
def list_threads():
    with session_scope() as s:
        rows = s.execute(select(Thread)).scalars().all()
        return [ThreadOut(id=t.id, persona_id=t.persona_id, summary=t.summary or "") for t in rows]

@app.get("/api/threads/{thread_id}", response_model=ThreadOut)
def get_thread(thread_id: str):
    with session_scope() as s:
        t = s.get(Thread, thread_id)
        if not t: raise HTTPException(404, "thread not found")
        return ThreadOut(id=t.id, persona_id=t.persona_id, summary=t.summary or "")

@app.get("/api/threads/{thread_id}/messages", response_model=list[MessageOut])
def get_messages(thread_id: str):
    with session_scope() as s:
        rows = s.execute(select(Message).where(Message.thread_id==thread_id).order_by(Message.created_at)).scalars().all()
        return [MessageOut(id=m.id, role=m.role, content=m.content, created_at=m.created_at.isoformat()) for m in rows]

class SummaryIn(BaseModel):
    summary: str

@app.patch("/api/threads/{thread_id}")
def update_thread_summary(thread_id: str, inp: SummaryIn):
    with session_scope() as s:
        t = s.get(Thread, thread_id)
        if not t: raise HTTPException(404, "thread not found")
        t.summary = inp.summary
        return {"ok": True}

@app.delete("/api/messages/{msg_id}")
def delete_message(msg_id: int):
    with session_scope() as s:
        res = s.execute(delete(Message).where(Message.id==msg_id))
        if res.rowcount == 0:
            raise HTTPException(404, "message not found")
        return {"ok": True}
    
# === Personas API ===
@app.get("/api/personas", response_model=list[PersonaOut])
def list_personas():
    with session_scope() as s:
        rows = s.execute(select(Persona)).scalars().all()
        return [PersonaOut(
            id=p.id, name=p.name, bio=p.bio, style=p.style,
            boundaries=p.boundaries, goals=p.goals or ""
        ) for p in rows]

@app.get("/api/personas/{pid}", response_model=PersonaOut)
def get_persona(pid: str):
    with session_scope() as s:
        p = s.get(Persona, pid)
        if not p: raise HTTPException(404, "persona not found")
        return PersonaOut(
            id=p.id, name=p.name, bio=p.bio, style=p.style,
            boundaries=p.boundaries, goals=p.goals or ""
        )

@app.patch("/api/personas/{pid}", response_model=PersonaOut)
def update_persona(pid: str, data: PersonaIn):
    with session_scope() as s:
        p = s.get(Persona, pid)
        if not p: raise HTTPException(404, "persona not found")
        p.name = data.name
        p.bio = data.bio
        p.style = data.style
        p.boundaries = data.boundaries
        p.goals = data.goals  # строка CSV
        s.flush()
        return PersonaOut(
            id=p.id, name=p.name, bio=p.bio, style=p.style,
            boundaries=p.boundaries, goals=p.goals or ""
        )


@app.delete("/api/threads/{thread_id}")
def delete_thread(thread_id: str):
    with session_scope() as s:
        # сначала удаляем сообщения треда
        s.execute(delete(Message).where(Message.thread_id == thread_id))
        t = s.get(Thread, thread_id)
        if not t:
            raise HTTPException(404, "thread not found")
        s.delete(t)
        return {"ok": True}



