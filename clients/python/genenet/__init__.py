"""A small Python client for a GeneNet installation.

Deliberately small. It wraps the one shape the API actually has -- a resource
with a list, a get, a create and an update -- and does not try to model the
lab. Code written against it reads like the thing it is doing:

    lab = GeneNet("https://genenet.example.org", token="gnt_...")
    for s in lab.samples.list(q="pEGFP"):
        print(s["sampleId"], s["name"])

Only the standard library is used, so it can be dropped into an analysis
environment without asking anybody to install anything.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterator

__all__ = ["GeneNet", "Resource", "GeneNetError", "verify_signature"]

__version__ = "1.0.0"

#: Every resource the server exposes. Asking for one it does not have is a
#: mistake worth catching here rather than as a 404 three lines later.
RESOURCES = (
    "samples",
    "sequences",
    "oligos",
    "plates",
    "requests",
    "reads",
    "procedures",
    "projects",
    "tasks",
    "freezers",
)


class GeneNetError(RuntimeError):
    """Something the server refused, with what it said about it."""

    def __init__(self, status: int, message: str, body: Any = None):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message
        self.body = body


class GeneNet:
    """A connection to one installation."""

    def __init__(self, base_url: str, token: str, *, timeout: float = 30.0):
        if not token:
            raise ValueError("An API token is needed. Make one under Settings.")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def __getattr__(self, name: str) -> "Resource":
        if name in RESOURCES:
            return Resource(self, name)
        raise AttributeError(
            f"{name!r} is not a resource this server has. "
            f"Try one of: {', '.join(RESOURCES)}."
        )

    def __dir__(self):
        return [*super().__dir__(), *RESOURCES]

    # -- the one request method everything goes through ----------------------

    def request(self, method: str, path: str, *, params: dict | None = None,
                body: Any = None) -> Any:
        url = f"{self.base_url}/api/v1/{path.lstrip('/')}"
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url = f"{url}?{urllib.parse.urlencode(clean)}"

        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", f"genenet-python/{__version__}")
        if data is not None:
            req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                parsed = json.loads(raw)
                message = parsed.get("error") or parsed.get("message") or str(parsed)
            except Exception:
                parsed = raw.decode("utf-8", "replace")
                message = parsed
            raise GeneNetError(e.code, message, parsed) from None
        except urllib.error.URLError as e:
            raise GeneNetError(0, f"Could not reach {self.base_url}: {e.reason}") from None


class Resource:
    """One kind of record: samples, sequences, oligos, and so on."""

    def __init__(self, client: GeneNet, name: str):
        self._client = client
        self.name = name

    def __repr__(self) -> str:
        return f"<GeneNet {self.name}>"

    def list(self, *, q: str | None = None, limit: int = 50,
             offset: int = 0) -> list[dict]:
        """One page. The server caps a page at 200 however much is asked for."""
        out = self._client.request("GET", self.name, params={"q": q, "limit": limit, "offset": offset})
        return out.get("data", out) if isinstance(out, dict) else out

    def all(self, *, q: str | None = None, page: int = 200) -> Iterator[dict]:
        """Every matching record, a page at a time.

        A generator rather than a list, because "every sample in the freezer"
        is a reasonable thing to ask for and an unreasonable thing to hold in
        memory all at once on a laptop.
        """
        offset = 0
        while True:
            batch = self.list(q=q, limit=page, offset=offset)
            if not batch:
                return
            yield from batch
            if len(batch) < page:
                return
            offset += len(batch)

    def get(self, record_id: str) -> dict:
        return self._client.request("GET", f"{self.name}/{record_id}")

    def create(self, **fields: Any) -> dict:
        return self._client.request("POST", self.name, body=fields)

    def update(self, record_id: str, **fields: Any) -> dict:
        return self._client.request("PATCH", f"{self.name}/{record_id}", body=fields)


# -- webhooks ----------------------------------------------------------------


def verify_signature(body: bytes | str, header: str, secret: str,
                     *, max_age: int = 300, now: float | None = None) -> bool:
    """Check a webhook delivery really came from the installation it claims.

    The header is ``t=<unix seconds>,v1=<hmac>`` over ``"<t>.<body>"``. The
    timestamp is part of what is signed, which is what stops an old capture
    being replayed: a signature over the body alone stays valid for ever.

    ``body`` must be the exact bytes that arrived. Parsing the JSON and
    re-serialising it changes the whitespace and the signature will not match
    -- which is the usual reason somebody's first attempt at this fails.
    """
    if isinstance(body, str):
        body = body.encode("utf-8")

    parts = dict(
        p.split("=", 1) for p in header.split(",") if "=" in p
    )
    try:
        timestamp = int(parts["t"].strip())
        given = parts["v1"].strip()
    except (KeyError, ValueError):
        return False

    age = (now if now is not None else time.time()) - timestamp
    if abs(age) > max_age:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.".encode("utf-8") + body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, given)
