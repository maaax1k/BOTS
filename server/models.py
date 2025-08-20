from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class Persona(Base):
    __tablename__ = "personas"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    bio: Mapped[str] = mapped_column(Text, default="")
    style: Mapped[str] = mapped_column(Text, default="")
    boundaries: Mapped[str] = mapped_column(Text, default="")
    goals: Mapped[str] = mapped_column(Text, default="")  # хранится как CSV строка
    threads: Mapped[list[Thread]] = relationship(back_populates="persona")

class Thread(Base):
    __tablename__ = "threads"
    id: Mapped[str] = mapped_column(String, primary_key=True)  # ваш threadId из фронта
    persona_id: Mapped[str] = mapped_column(ForeignKey("personas.id"), nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    persona: Mapped[Persona] = relationship(back_populates="threads")
    messages: Mapped[list[Message]] = relationship(
    back_populates="thread",
    order_by="Message.created_at",
    cascade="all, delete-orphan"
)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("threads.id"), index=True)
    role: Mapped[str] = mapped_column(String)  # 'user' | 'assistant' | 'system'
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    thread: Mapped[Thread] = relationship(back_populates="messages")