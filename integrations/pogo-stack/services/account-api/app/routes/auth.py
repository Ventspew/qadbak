import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import COOKIE_NAME, hash_password, require_admin, verify_password, get_admin_from_session
from app.models import AdminSession, AdminUser
from app.schemas import AdminOut, LoginRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def seed_dashboard_admin() -> None:
    from app.database import SessionLocal

    password = settings.dashboard_password
    username = settings.dashboard_user.strip() or "admin"
    if not password:
        return
    db = SessionLocal()
    try:
        user = db.execute(select(AdminUser).where(AdminUser.username == username)).scalar_one_or_none()
        hashed = hash_password(password)
        if user is None:
            db.add(AdminUser(username=username, password_hash=hashed))
        else:
            user.password_hash = hashed
        db.commit()
    finally:
        db.close()


@router.post("/login", response_model=AdminOut)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)) -> AdminOut:
    user = db.execute(select(AdminUser).where(AdminUser.username == body.username)).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Ongeldige gebruikersnaam of wachtwoord")

    token = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(days=settings.session_days)
    db.add(AdminSession(user_id=user.id, token=token, expires_at=expires))
    db.commit()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.session_days * 86400,
        path="/",
    )
    return AdminOut(username=user.username)


@router.post("/logout")
def logout(
    response: Response,
    pogo_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if pogo_session:
        session = db.execute(select(AdminSession).where(AdminSession.token == pogo_session)).scalar_one_or_none()
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/me", response_model=AdminOut)
def me(admin: AdminUser = Depends(require_admin)) -> AdminOut:
    return AdminOut(username=admin.username)


@router.get("/verify")
def verify(
    pogo_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if not get_admin_from_session(db, pogo_session):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"status": "ok"}
