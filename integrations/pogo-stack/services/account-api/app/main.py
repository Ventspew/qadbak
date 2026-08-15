import time

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from app.database import Base, engine
from app.deps import require_admin_or_api_key
from app.routes.accounts import router as accounts_router
from app.routes.auth import router as auth_router, seed_dashboard_admin
from app.routes.devices import router as devices_router

app = FastAPI(
    title="PoGo Account API",
    description="PGPool-inspired account pool for self-hosted Pokemon GO stacks",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(accounts_router, dependencies=[Depends(require_admin_or_api_key)])


@app.on_event("startup")
def startup() -> None:
    for attempt in range(30):
        try:
            Base.metadata.create_all(bind=engine)
            seed_dashboard_admin()
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
