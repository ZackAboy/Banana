"""Health-only ASGI application; no inference or model loading at startup."""

from typing import Literal

from fastapi import FastAPI

app = FastAPI(title="Banana Vision Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, Literal["ok"]]:
    """Report process health, not model readiness."""
    return {"status": "ok"}
