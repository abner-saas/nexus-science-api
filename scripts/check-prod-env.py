#!/usr/bin/env python3
"""Valida APP_ENV / DOCKER_ENV (GitHub Secrets) sem imprimir valores."""

from __future__ import annotations

import os
import sys

APP_REQUIRED = (
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "FIELD_ENCRYPTION_KEY",
    "CORS_ORIGIN",
    "COOKIE_SECURE",
    "COOKIE_SAME_SITE",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
)
DOCKER_REQUIRED = ("POSTGRES_PASSWORD",)


def parse_dotenv(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


def require(blob: str, name: str, keys: tuple[str, ...]) -> dict[str, str]:
    if not blob.strip():
        print(f"{name} is empty. Set it on GitHub Environment 'production'.")
        sys.exit(1)
    values = parse_dotenv(blob)
    missing = [k for k in keys if not values.get(k)]
    if missing:
        print(f"{name} missing keys: {', '.join(missing)}")
        sys.exit(1)
    return values


def main() -> None:
    app = require(os.environ.get("APP_ENV", ""), "APP_ENV", APP_REQUIRED)
    require(os.environ.get("DOCKER_ENV", ""), "DOCKER_ENV", DOCKER_REQUIRED)

    if not app["BETTER_AUTH_URL"].startswith("https://"):
        print("BETTER_AUTH_URL must be public HTTPS (not localhost) in production.")
        sys.exit(1)
    if "localhost" in app["CORS_ORIGIN"] and "https://" not in app["CORS_ORIGIN"]:
        print("CORS_ORIGIN must include the Vercel HTTPS origin in production.")
        sys.exit(1)
    if app["COOKIE_SAME_SITE"] != "none":
        print("COOKIE_SAME_SITE must be none while the front is on vercel.app.")
        sys.exit(1)
    if app["COOKIE_SECURE"] != "true":
        print("COOKIE_SECURE must be true in production.")
        sys.exit(1)
    print("Production env blobs look complete.")


if __name__ == "__main__":
    main()
