"""Firebase ID-token verification + single-owner pairing.

Verifies Firebase ID tokens using Google's public x509 certs (no service-account
required — only public material). This keeps the backend dependency-light and
lets the user run the device without first downloading a service account JSON.

Two ways to authenticate:

1. **Pairing** — first caller proves they hold the local PAIRING_CODE printed
   in the console at boot. They send their Firebase ID token along with the
   code. We verify the token, then store its UID as the device owner.
2. **Bearer ID token** — caller sends `Authorization: Bearer <id-token>`.
   We verify signature + issuer + audience + expiry, then check `uid == owner`.
"""
from __future__ import annotations

import logging
import secrets
import threading
import time
from dataclasses import dataclass

import httpx
import jwt
from cryptography import x509
from fastapi import Depends, Header, HTTPException

from . import database
from .config import settings

log = logging.getLogger("backend.auth")

_CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)


class _CertCache:
    """Caches Google's Firebase JWT signing certs, refreshed when stale."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._certs: dict[str, str] = {}
        self._expires_at: float = 0.0

    def get(self, kid: str) -> str:
        now = time.time()
        if not self._certs or now >= self._expires_at or kid not in self._certs:
            with self._lock:
                if not self._certs or now >= self._expires_at or kid not in self._certs:
                    self._refresh()
        cert_pem = self._certs.get(kid)
        if not cert_pem:
            raise ValueError(f"unknown signing key kid={kid}")
        return cert_pem

    def _refresh(self) -> None:
        with httpx.Client(timeout=5) as c:
            r = c.get(_CERTS_URL)
            r.raise_for_status()
            self._certs = r.json()
            cc = r.headers.get("cache-control", "")
            ttl = 3600
            for part in cc.split(","):
                part = part.strip()
                if part.startswith("max-age="):
                    try:
                        ttl = int(part.split("=", 1)[1])
                    except ValueError:
                        pass
            self._expires_at = time.time() + min(ttl, 6 * 3600)


_cert_cache = _CertCache()


def _public_key_pem(kid: str) -> str:
    cert_pem = _cert_cache.get(kid)
    cert = x509.load_pem_x509_certificate(cert_pem.encode())
    public_key = cert.public_key()
    from cryptography.hazmat.primitives import serialization

    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


@dataclass
class Caller:
    uid: str
    email: str | None
    name: str | None


def _bearer(authorization: str) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization[len("Bearer ") :].strip()


def _decode(token: str) -> dict:
    project = settings.firebase_project_id
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"invalid id token: {e}") from e
    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="invalid id token: missing kid")
    try:
        public_pem = _public_key_pem(kid)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"invalid id token: {e}") from e
    try:
        decoded = jwt.decode(
            token,
            public_pem,
            algorithms=["RS256"],
            audience=project,
            issuer=f"https://securetoken.google.com/{project}",
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"invalid id token: {e}") from e

    sub = decoded.get("sub")
    auth_time = decoded.get("auth_time", 0)
    if not sub or auth_time > time.time() + 60:
        raise HTTPException(status_code=401, detail="invalid id token: malformed")
    return decoded


async def verify_id_token(authorization: str = Header(default="")) -> Caller:
    token = _bearer(authorization)
    decoded = _decode(token)
    return Caller(
        uid=decoded["sub"],
        email=decoded.get("email"),
        name=decoded.get("name"),
    )


async def require_owner(caller: Caller = Depends(verify_id_token)) -> Caller:
    owner = database.get_owner_uid()
    if owner is None:
        raise HTTPException(
            status_code=409,
            detail="device not paired — call POST /pair with the pairing code",
        )
    if caller.uid != owner:
        if settings.owner_takeover_enabled:
            log.warning(
                "reassigning local device owner from uid=%s to uid=%s",
                owner,
                caller.uid,
            )
            database.reassign_owner(caller.uid)
            return caller
        raise HTTPException(
            status_code=403,
            detail="this account is not the device owner",
        )
    return caller


# ---- pairing -------------------------------------------------------------


def _print_pairing_code_once() -> None:
    code = settings.pairing_code
    if not code:
        code = "".join(secrets.choice("0123456789") for _ in range(6))
        settings.__dict__["pairing_code"] = code  # frozen dataclass workaround
    log.warning("\n┌──────────────────────────────────────────────┐")
    log.warning(  "│  PAIRING CODE: %-30s │", code)
    log.warning(  "│  Enter this in the web app /settings page.   │")
    log.warning(  "└──────────────────────────────────────────────┘\n")


def claim_pairing(code: str, caller: Caller) -> bool:
    if not settings.pairing_code or code.strip() != settings.pairing_code:
        return False
    if settings.owner_takeover_enabled:
        database.reassign_owner(caller.uid)
        return True
    return database.claim_owner(caller.uid)
