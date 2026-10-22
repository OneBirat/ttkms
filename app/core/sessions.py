"""Session cookie: Starlette's SessionMiddleware (itsdangerous-signed) plus "Keep me signed in".

Starlette applies one Max-Age to every session cookie. Here the cookie is a browser-session
cookie by default and only gets ``Max-Age`` (``settings.session_max_age_days``) when the session
carries :data:`PERSIST_KEY`, which the login form sets from the "Keep me signed in" checkbox. The
signature age is always capped at ``max_age``.

``__call__`` mirrors starlette 1.9.0's ``SessionMiddleware.__call__``; re-check it when upgrading.
"""

from __future__ import annotations

import json
from base64 import b64decode, b64encode

from itsdangerous.exc import BadSignature
from starlette.datastructures import MutableHeaders
from starlette.middleware.sessions import Session
from starlette.middleware.sessions import SessionMiddleware as _StarletteSessionMiddleware
from starlette.requests import HTTPConnection
from starlette.types import Message, Receive, Scope, Send

PERSIST_KEY = "_persist"


class SessionMiddleware(_StarletteSessionMiddleware):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):  # pragma: no cover
            await self.app(scope, receive, send)
            return

        connection = HTTPConnection(scope)
        initial_session_was_empty = True

        if self.session_cookie in connection.cookies:
            data = connection.cookies[self.session_cookie].encode("utf-8")
            try:
                data = self.signer.unsign(data, max_age=self.max_age)
                scope["session"] = Session(json.loads(b64decode(data)))
                initial_session_was_empty = False
            except BadSignature:
                scope["session"] = Session()
        else:
            scope["session"] = Session()

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                session: Session = scope["session"]
                headers = MutableHeaders(scope=message)
                if session.accessed:
                    headers.add_vary_header("Cookie")
                if session.modified and session:
                    data = b64encode(json.dumps(session).encode("utf-8"))
                    data = self.signer.sign(data)
                    persist = self.max_age is not None and bool(session.get(PERSIST_KEY))
                    max_age = f"Max-Age={self.max_age}; " if persist else ""
                    headers.append(
                        "Set-Cookie",
                        f"{self.session_cookie}={data.decode('utf-8')}; path={self.path}; "
                        f"{max_age}{self.security_flags}",
                    )
                elif session.modified and not initial_session_was_empty:
                    headers.append(
                        "Set-Cookie",
                        f"{self.session_cookie}=null; path={self.path}; "
                        f"expires=Thu, 01 Jan 1970 00:00:00 GMT; {self.security_flags}",
                    )
            await send(message)

        await self.app(scope, receive, send_wrapper)
