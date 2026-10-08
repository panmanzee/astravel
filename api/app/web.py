"""Serve the web app from the API process, so ASTRAVEL ships as ONE container.

Enabled by setting STATIC_DIR (the Dockerfile at the repo root does). It does what the old nginx did:
the same security headers, long caching for fingerprinted assets, and index.html for any non-file path
(the app does its own client-side routing).
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.googleusercontent.com; "
        "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; script-src 'self' https://accounts.google.com/gsi/client; "
        "font-src 'self'; connect-src 'self' https://nominatim.openstreetmap.org https://accounts.google.com/gsi/; "
        "frame-src https://accounts.google.com/gsi/; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"),
}
LONG_CACHE = {".woff2", ".webp", ".png", ".jpg", ".jpeg", ".svg"}


def mount_static(app: FastAPI, directory: str | None = None) -> bool:
    directory = directory or os.environ.get("STATIC_DIR")
    if not directory:
        return False
    root = Path(directory).resolve()
    index = root / "index.html"
    app.add_middleware(GZipMiddleware, minimum_size=512)

    @app.get("/healthz")
    def healthz():
        return PlainTextResponse("ok")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def site(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        target = (root / path).resolve()
        if path and target.is_file() and (root == target.parent or root in target.parents):
            cache = ("public, max-age=2592000, immutable" if target.suffix.lower() in LONG_CACHE
                     else "public, max-age=31536000, immutable" if path.startswith("v/") else "no-cache")
            return FileResponse(target, headers={**SECURITY_HEADERS, "Cache-Control": cache})
        return FileResponse(index, headers={**SECURITY_HEADERS, "Cache-Control": "no-cache"})

    return True
