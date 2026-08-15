from datetime import datetime, timezone

import bcrypt
from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import AdminSession, AdminUser

COOKIE_NAME = "pogo_session"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def get_admin_from_session(
    db: Session,
    token: str | None,
) -> AdminUser | None:
    if not token:
        return None
    session = db.execute(select(AdminSession).where(AdminSession.token == token)).scalar_one_or_none()
    if not session:
        return None
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        db.delete(session)
        db.commit()
        return None
    return db.get(AdminUser, session.user_id)


def require_admin(
    pogo_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> AdminUser:
    admin = get_admin_from_session(db, pogo_session)
    if not admin:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return admin


def require_admin_or_api_key(
    pogo_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> None:
    if settings.api_key and x_api_key == settings.api_key:
        return
    if get_admin_from_session(db, pogo_session):
        return
    raise HTTPException(status_code=401, detail="Not authenticated")
