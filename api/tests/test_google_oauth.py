from __future__ import annotations

import unittest
from urllib.parse import parse_qs, urlsplit

from api.google_oauth import (
    GoogleOAuthService,
    OAuthIdentityError,
    OAuthStateError,
)


class GoogleOAuthServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.now = [1_786_268_400.0]
        self.exchange_payload: dict[str, str] = {}
        self.claims: dict[str, object] = {}

        async def exchange(payload: dict[str, str]):
            self.exchange_payload = payload
            return {"id_token": "signed-google-token"}

        def verify(token: str, client_id: str):
            self.assertEqual(token, "signed-google-token")
            self.assertEqual(client_id, "client-id")
            return dict(self.claims)

        self.service = GoogleOAuthService(
            client_id="client-id",
            client_secret="client-secret",
            session_secret="s" * 64,
            allowed_email="id104442304@gmail.com",
            redirect_uri="https://daily.chebakov.me/auth/callback/",
            token_exchange=exchange,
            id_token_verifier=verify,
            now_provider=lambda: self.now[0],
        )

    def start(self, next_url: str = "https://sandbox.chebakov.me/ielts-writing/"):
        login = self.service.start_login(next_url)
        parameters = parse_qs(urlsplit(login.authorization_url).query)
        self.claims = {
            "nonce": parameters["nonce"][0],
            "email": "id104442304@gmail.com",
            "email_verified": True,
            "sub": "google-account-subject",
        }
        return login, parameters

    async def test_authorization_code_flow_issues_a_verified_session(self) -> None:
        login, parameters = self.start()

        result = await self.service.finish_login(
            code="authorization-code",
            returned_state=parameters["state"][0],
            state_cookie=login.state_cookie,
        )

        self.assertEqual(
            parameters["redirect_uri"],
            ["https://daily.chebakov.me/auth/callback/"],
        )
        self.assertEqual(parameters["code_challenge_method"], ["S256"])
        self.assertEqual(parameters["scope"], ["openid email"])
        self.assertEqual(result.next_url, "https://sandbox.chebakov.me/ielts-writing/")
        self.assertTrue(self.exchange_payload["code_verifier"])
        identity = self.service.authenticate_session(result.session_cookie)
        self.assertIsNotNone(identity)
        self.assertEqual(identity.email, "id104442304@gmail.com")

    async def test_callback_rejects_a_different_google_account(self) -> None:
        login, parameters = self.start()
        self.claims["email"] = "someone-else@gmail.com"

        with self.assertRaises(OAuthIdentityError):
            await self.service.finish_login(
                code="authorization-code",
                returned_state=parameters["state"][0],
                state_cookie=login.state_cookie,
            )

    async def test_callback_rejects_mismatched_state(self) -> None:
        login, _ = self.start()

        with self.assertRaises(OAuthStateError):
            await self.service.finish_login(
                code="authorization-code",
                returned_state="attacker-state",
                state_cookie=login.state_cookie,
            )

    async def test_session_expires_and_invalid_cookie_is_rejected(self) -> None:
        login, parameters = self.start()
        result = await self.service.finish_login(
            code="authorization-code",
            returned_state=parameters["state"][0],
            state_cookie=login.state_cookie,
        )

        self.now[0] += 31 * 24 * 60 * 60

        self.assertIsNone(self.service.authenticate_session(result.session_cookie))
        self.assertIsNone(self.service.authenticate_session("invalid.cookie"))

    def test_next_url_is_limited_to_the_two_application_hosts(self) -> None:
        self.assertEqual(
            self.service.safe_next_url("https://attacker.example/steal"),
            "https://daily.chebakov.me/",
        )
        self.assertEqual(
            self.service.safe_next_url("/vocab/?level=c1"),
            "https://daily.chebakov.me/vocab/?level=c1",
        )
