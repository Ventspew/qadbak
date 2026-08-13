from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AccountCreate(BaseModel):
    auth_service: Literal["ptc", "google"] = "ptc"
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=512)
    notes: str | None = None


class AccountUpdate(BaseModel):
    level: int | None = None
    experience: int | None = None
    team: Literal["unset", "mystic", "valor", "instinct"] | None = None
    coins: int | None = None
    stardust: int | None = None
    last_latitude: float | None = None
    last_longitude: float | None = None
    banned: bool | None = None
    shadowbanned: bool | None = None
    warning: bool | None = None
    captcha: bool | None = None
    notes: str | None = None


class AccountOut(BaseModel):
    id: int
    auth_service: str
    username: str
    password: str
    level: int
    experience: int
    team: str
    coins: int
    stardust: int
    last_latitude: float | None
    last_longitude: float | None
    in_use: bool
    system_id: str | None
    banned: bool
    shadowbanned: bool
    warning: bool
    captcha: bool
    notes: str | None
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None

    model_config = {"from_attributes": True}


class AccountPublic(BaseModel):
    id: int
    auth_service: str
    username: str
    level: int
    team: str
    in_use: bool
    system_id: str | None
    banned: bool
    shadowbanned: bool
    warning: bool
    captcha: bool
    notes: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class AccountStats(BaseModel):
    total: int
    available: int
    in_use: int
    banned: int
    shadowbanned: int
    warning: int


class ReleaseRequest(BaseModel):
    account_id: int | None = None
    username: str | None = None
    system_id: str | None = None
