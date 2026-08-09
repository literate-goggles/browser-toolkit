"""Google OpenID Connect for the private daily and sandbox applications."""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token


GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
STATE_TTL_SECONDS = 10 * 60
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60


class OAuthConfigurationError(RuntimeError):
    """The OAuth service is missing required server-side configuration."""


class OAuthStateError(ValueError):
    """The OAuth callback state is missing, expired, or invalid."""


class OAuthExchangeError(RuntimeError):
    """Google rejected the authorization-code exchange."""


class OAuthIdentityError(ValueError):
    """The returned Google identity is invalid or is not allowed."""


@dataclass(frozen=True)
class AuthenticatedIdentity:
    email: str
    subject: str


@dataclass(frozen=True)
class LoginStart:
    authorization_url: str
    state_cookie: str


@dataclass(frozen=True)
class LoginResult:
    identity: AuthenticatedIdentity
    session_cookie: str
    next_url: str


TokenExchange = Callable[[dict[str, str]], Awaitable[dict[str, Any]]]
IdTokenVerifier = Callable[[str, str], dict[str, Any]]


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


async def _exchange_google_code(payload: dict[str, str]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            response = await client.post(GOOGLE_TOKEN_URL, data=payload)
    except httpx.TimeoutException as exc:
        raise OAuthExchangeError("Google's token endpoint timed out.") from exc
    except httpx.RequestError as exc:
        raise OAuthExchangeError("Google's token endpoint is unavailable.") from exc
    if not response.is_success:
        raise OAuthExchangeError("Google rejected the authorization code.")
    try:
        token_payload = response.json()
    except ValueError as exc:
        raise OAuthExchangeError("Google returned an invalid token response.") from exc
    if not isinstance(token_payload, dict):
        raise OAuthExchangeError("Google returned an invalid token response.")
    return token_payload


def _verify_google_id_token(token: str, client_id: str) -> dict[str, Any]:
    claims = google_id_token.verify_oauth2_token(
        token,
        GoogleAuthRequest(),
        client_id,
    )
    if not isinstance(claims, dict):
        raise OAuthIdentityError("Google returned invalid identity claims.")
    return claims


class GoogleOAuthService:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        session_secret: str,
        allowed_email: str,
        redirect_uri: str,
        application_origin: str = "https://daily.chebakov.me",
        allowed_hosts: tuple[str, ...] = (
            "daily.chebakov.me",
            "sandbox.chebakov.me",
        ),
        token_exchange: TokenExchange = _exchange_google_code,
        id_token_verifier: IdTokenVerifier = _verify_google_id_token,
        now_provider: Callable[[], float] = time.time,
    ) -> None:
        self.client_id = client_id.strip()
        self.client_secret = client_secret.strip()
        self.session_secret = session_secret.strip().encode("utf-8")
        self.allowed_email = allowed_email.strip().casefold()
        self.redirect_uri = redirect_uri.strip()
        self.application_origin = application_origin.rstrip("/")
        self.allowed_hosts = frozenset(host.casefold() for host in allowed_hosts)
        self._token_exchange = token_exchange
        self._id_token_verifier = id_token_verifier
        self._now_provider = now_provider

    @property
    def configured(self) -> bool:
        return bool(
            self.client_id
            and self.client_secret
            and len(self.session_secret) >= 32
            and self.allowed_email
            and self.redirect_uri
        )

    def require_configuration(self) -> None:
        if not self.configured:
            raise OAuthConfigurationError(
                "Google authentication is not fully configured."
            )

    def _encode(self, payload: dict[str, Any]) -> str:
        serialized = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        body = _base64url_encode(serialized)
        signature = hmac.new(
            self.session_secret,
            body.encode("ascii"),
            hashlib.sha256,
        ).digest()
        return f"{body}.{_base64url_encode(signature)}"

    def _decode(self, token: str, *, kind: str) -> dict[str, Any]:
        try:
            body, supplied_signature = token.split(".", 1)
            expected_signature = hmac.new(
                self.session_secret,
                body.encode("ascii"),
                hashlib.sha256,
            ).digest()
            if not hmac.compare_digest(
                _base64url_decode(supplied_signature),
                expected_signature,
            ):
                raise OAuthStateError("The signed authentication value is invalid.")
            payload = json.loads(_base64url_decode(body))
        except (
            ValueError,
            TypeError,
            binascii.Error,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ) as exc:
            raise OAuthStateError("The signed authentication value is invalid.") from exc
        if not isinstance(payload, dict) or payload.get("kind") != kind:
            raise OAuthStateError("The signed authentication value is invalid.")
        expires_at = payload.get("exp")
        if not isinstance(expires_at, (int, float)) or expires_at < self._now_provider():
            raise OAuthStateError("The authentication value has expired.")
        return payload

    def safe_next_url(self, candidate: str | None) -> str:
        if not candidate:
            return f"{self.application_origin}/"
        if candidate.startswith("/") and not candidate.startswith("//"):
            candidate = f"{self.application_origin}{candidate}"
        try:
            parsed = urlsplit(candidate)
            port = parsed.port
        except ValueError:
            return f"{self.application_origin}/"
        if (
            parsed.scheme != "https"
            or parsed.hostname is None
            or parsed.hostname.casefold() not in self.allowed_hosts
            or parsed.username is not None
            or parsed.password is not None
            or port not in (None, 443)
        ):
            return f"{self.application_origin}/"
        return urlunsplit(
            (
                "https",
                parsed.hostname.casefold(),
                parsed.path or "/",
                parsed.query,
                "",
            )
        )

    def start_login(self, next_url: str | None) -> LoginStart:
        self.require_configuration()
        now = int(self._now_provider())
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = _base64url_encode(hashlib.sha256(verifier.encode()).digest())
        state_cookie = self._encode(
            {
                "kind": "oauth-state",
                "state": state,
                "nonce": nonce,
                "verifier": verifier,
                "next": self.safe_next_url(next_url),
                "iat": now,
                "exp": now + STATE_TTL_SECONDS,
            }
        )
        parameters = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "openid email",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "access_type": "online",
            "prompt": "select_account",
            "login_hint": self.allowed_email,
        }
        return LoginStart(
            authorization_url=f"{GOOGLE_AUTHORIZATION_URL}?{urlencode(parameters)}",
            state_cookie=state_cookie,
        )

    async def finish_login(
        self,
        *,
        code: str,
        returned_state: str,
        state_cookie: str,
    ) -> LoginResult:
        self.require_configuration()
        state_payload = self._decode(state_cookie, kind="oauth-state")
        expected_state = str(state_payload.get("state") or "")
        if not expected_state or not hmac.compare_digest(
            returned_state,
            expected_state,
        ):
            raise OAuthStateError("The OAuth state did not match this browser session.")
        token_payload = await self._token_exchange(
            {
                "code": code,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "redirect_uri": self.redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": str(state_payload.get("verifier") or ""),
            }
        )
        raw_id_token = token_payload.get("id_token")
        if not isinstance(raw_id_token, str) or not raw_id_token:
            raise OAuthExchangeError("Google did not return an ID token.")
        try:
            claims = await asyncio.to_thread(
                self._id_token_verifier,
                raw_id_token,
                self.client_id,
            )
        except Exception as exc:
            raise OAuthIdentityError(
                "Google returned an ID token that could not be verified."
            ) from exc
        expected_nonce = str(state_payload.get("nonce") or "")
        returned_nonce = str(claims.get("nonce") or "")
        if not expected_nonce or not hmac.compare_digest(
            returned_nonce,
            expected_nonce,
        ):
            raise OAuthIdentityError("Google returned an invalid login nonce.")
        email = str(claims.get("email") or "").strip().casefold()
        if claims.get("email_verified") is not True:
            raise OAuthIdentityError("The Google email address is not verified.")
        if email != self.allowed_email:
            raise OAuthIdentityError("This Google account is not allowed.")
        subject = str(claims.get("sub") or "").strip()
        if not subject:
            raise OAuthIdentityError("Google returned an invalid account identifier.")
        now = int(self._now_provider())
        session_cookie = self._encode(
            {
                "kind": "session",
                "email": email,
                "sub": subject,
                "iat": now,
                "exp": now + SESSION_TTL_SECONDS,
            }
        )
        return LoginResult(
            identity=AuthenticatedIdentity(email=email, subject=subject),
            session_cookie=session_cookie,
            next_url=self.safe_next_url(str(state_payload.get("next") or "")),
        )

    def authenticate_session(
        self,
        session_cookie: str | None,
    ) -> AuthenticatedIdentity | None:
        if not self.configured or not session_cookie:
            return None
        try:
            payload = self._decode(session_cookie, kind="session")
        except OAuthStateError:
            return None
        email = str(payload.get("email") or "").strip().casefold()
        subject = str(payload.get("sub") or "").strip()
        if email != self.allowed_email or not subject:
            return None
        return AuthenticatedIdentity(email=email, subject=subject)
