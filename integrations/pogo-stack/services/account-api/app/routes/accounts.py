from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, AccountEvent, AuthService, Team
from app.schemas import (
    AccountCreate,
    AccountOut,
    AccountPublic,
    AccountStats,
    AccountUpdate,
    ReleaseRequest,
)

router = APIRouter(prefix="/account", tags=["accounts"])


def log_event(db: Session, account_id: int, event_type: str, detail: dict | None = None) -> None:
    db.add(AccountEvent(account_id=account_id, event_type=event_type, detail=detail))
    db.commit()


def account_to_out(account: Account) -> AccountOut:
    return AccountOut.model_validate(account)


@router.get("/stats", response_model=AccountStats)
def stats(db: Session = Depends(get_db)) -> AccountStats:
    rows = db.execute(select(Account)).scalars().all()
    return AccountStats(
        total=len(rows),
        available=sum(1 for a in rows if not a.in_use and not a.banned and not a.shadowbanned),
        in_use=sum(1 for a in rows if a.in_use),
        banned=sum(1 for a in rows if a.banned),
        shadowbanned=sum(1 for a in rows if a.shadowbanned),
        warning=sum(1 for a in rows if a.warning),
    )


@router.get("", response_model=list[AccountPublic])
def list_accounts(
    db: Session = Depends(get_db),
    in_use: bool | None = None,
    banned: bool | None = None,
    system_id: str | None = None,
) -> list[AccountPublic]:
    stmt = select(Account).order_by(Account.updated_at.desc())
    if in_use is not None:
        stmt = stmt.where(Account.in_use == in_use)
    if banned is not None:
        stmt = stmt.where(Account.banned == banned)
    if system_id:
        stmt = stmt.where(Account.system_id == system_id)
    return [AccountPublic.model_validate(a) for a in db.execute(stmt).scalars().all()]


@router.post("", response_model=AccountPublic, status_code=201)
def create_account(body: AccountCreate, db: Session = Depends(get_db)) -> AccountPublic:
    existing = db.execute(
        select(Account).where(
            Account.auth_service == AuthService(body.auth_service),
            Account.username == body.username,
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Account already exists")

    account = Account(
        auth_service=AuthService(body.auth_service),
        username=body.username,
        password=body.password,
        notes=body.notes,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    log_event(db, account.id, "created", {"username": account.username})
    return AccountPublic.model_validate(account)


@router.get("/request", response_model=AccountOut)
def request_account(
    db: Session = Depends(get_db),
    system_id: str = Query(..., min_length=1, max_length=128),
    min_level: int = Query(0, ge=0),
) -> AccountOut:
    account = db.execute(
        select(Account)
        .where(
            Account.in_use.is_(False),
            Account.banned.is_(False),
            Account.shadowbanned.is_(False),
            Account.captcha.is_(False),
            Account.level >= min_level,
        )
        .order_by(Account.last_used_at.asc().nullsfirst(), Account.id.asc())
        .limit(1)
    ).scalar_one_or_none()

    if not account:
        raise HTTPException(status_code=404, detail="No available account")

    account.in_use = True
    account.system_id = system_id
    account.last_used_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(account)
    log_event(db, account.id, "assigned", {"system_id": system_id})
    return account_to_out(account)


@router.post("/update", response_model=AccountOut)
def update_account(
    body: AccountUpdate,
    db: Session = Depends(get_db),
    account_id: int | None = Query(None),
    username: str | None = Query(None),
    system_id: str | None = Query(None),
) -> AccountOut:
    stmt = select(Account)
    if account_id is not None:
        stmt = stmt.where(Account.id == account_id)
    elif username:
        stmt = stmt.where(Account.username == username)
    else:
        raise HTTPException(status_code=400, detail="Provide account_id or username")

    account = db.execute(stmt).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if system_id and account.system_id and account.system_id != system_id:
        raise HTTPException(status_code=409, detail="Account assigned to another system")

    changes: dict[str, object] = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "team" and value is not None:
            setattr(account, field, Team(value))
        else:
            setattr(account, field, value)
        changes[field] = value

    for flag in ("banned", "shadowbanned", "warning", "captcha"):
        if flag in changes and changes[flag]:
            log_event(db, account.id, f"{flag}_set", changes)

    db.commit()
    db.refresh(account)
    log_event(db, account.id, "updated", changes or None)
    return account_to_out(account)


@router.post("/release")
def release_account(body: ReleaseRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    stmt = select(Account)
    if body.account_id is not None:
        stmt = stmt.where(Account.id == body.account_id)
    elif body.username:
        stmt = stmt.where(Account.username == body.username)
    elif body.system_id:
        stmt = stmt.where(Account.system_id == body.system_id)
    else:
        raise HTTPException(status_code=400, detail="Provide account_id, username, or system_id")

    accounts = db.execute(stmt).scalars().all()
    if not accounts:
        raise HTTPException(status_code=404, detail="Account not found")

    released = 0
    for account in accounts:
        account.in_use = False
        account.system_id = None
        released += 1
        log_event(db, account.id, "released", {"by": body.system_id})

    db.commit()
    return {"status": "ok", "released": str(released)}


@router.get("/{account_id}", response_model=AccountOut)
def get_account(account_id: int, db: Session = Depends(get_db)) -> AccountOut:
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account_to_out(account)
