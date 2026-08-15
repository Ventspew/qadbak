from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.config import settings
from app.deps import require_admin
from app.models import AdminUser

router = APIRouter(prefix="/devices", tags=["devices"])

ALLOWED_ACTIONS = {"restart", "reboot", "disable", "enable", "disconnect", "delete"}


def _headers() -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if settings.rotom_secret:
        headers["X-Rotom-Secret"] = settings.rotom_secret
    return headers


def _rotom_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"Rotom is niet bereikbaar: {exc}")


@router.get("")
def list_devices(_admin: AdminUser = Depends(require_admin)) -> dict[str, Any]:
    url = f"{settings.rotom_url.rstrip('/')}/api/device"
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(url, headers=_headers(), params={"include_workers": "true"})
    except httpx.HTTPError as exc:
        raise _rotom_error(exc) from exc
    if res.status_code >= 400:
        raise HTTPException(status_code=res.status_code, detail=res.text[:500] or "Rotom error")
    data = res.json()
    if isinstance(data, list):
        return {"devices": data}
    return data


@router.put("/{device_id}/action/{action}")
def device_action(
    device_id: str,
    action: str,
    _admin: AdminUser = Depends(require_admin),
) -> Response:
    if action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
    url = f"{settings.rotom_url.rstrip('/')}/api/device/{device_id}/action/{action}"
    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.put(url, headers=_headers())
    except httpx.HTTPError as exc:
        raise _rotom_error(exc) from exc
    return Response(content=res.content, status_code=res.status_code, media_type=res.headers.get("content-type"))
