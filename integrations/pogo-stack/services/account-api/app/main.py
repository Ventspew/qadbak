import time

from fastapi import Depends, FastAPI, Header, HTTPException
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.database import Base, engine
from app.routes.accounts import router as accounts_router

app = FastAPI(
    title="PoGo Account API",
    description="PGPool-inspired account pool for self-hosted Pokemon GO stacks",
    version="0.1.0",
)


def verify_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


app.include_router(accounts_router, dependencies=[Depends(verify_api_key)])


@app.on_event("startup")
def startup() -> None:
    for attempt in range(30):
        try:
            Base.metadata.create_all(bind=engine)
            return
        except OperationalError:
            time.sleep(2)
    raise RuntimeError("Could not connect to database")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "pogo-account-api", "docs": "/docs"}
