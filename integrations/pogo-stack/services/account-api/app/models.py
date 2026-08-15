from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Enum as SAEnum, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuthService(str, Enum):
    ptc = "ptc"
    google = "google"


class Team(str, Enum):
    unset = "unset"
    mystic = "mystic"
    valor = "valor"
    instinct = "instinct"


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    auth_service: Mapped[AuthService] = mapped_column(SAEnum(AuthService), default=AuthService.ptc)
    username: Mapped[str] = mapped_column(String(255), unique=False)
    password: Mapped[str] = mapped_column(String(512))
    level: Mapped[int] = mapped_column(Integer, default=0)
    experience: Mapped[int] = mapped_column(BigInteger, default=0)
    team: Mapped[Team] = mapped_column(SAEnum(Team), default=Team.unset)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    stardust: Mapped[int] = mapped_column(BigInteger, default=0)
    last_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    in_use: Mapped[bool] = mapped_column(Boolean, default=False)
    system_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    banned: Mapped[bool] = mapped_column(Boolean, default=False)
    shadowbanned: Mapped[bool] = mapped_column(Boolean, default=False)
    warning: Mapped[bool] = mapped_column(Boolean, default=False)
    captcha: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AccountEvent(Base):
    __tablename__ = "account_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(64))
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(128), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    token: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
