#!/usr/bin/env python3
"""Local survey server for Waldoch Maybach seat color matching."""

from __future__ import annotations

import csv
import json
import mimetypes
import os
import re
import subprocess
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("SURVEY_PORT", "8765"))
EMAIL_TO = "aslater@waldoch.com"
RESULTS_DIR = ROOT / "survey-results"

SWATCH = {
    "BLACK": "#1c1c1c",
    "QUICKSILVER": "#6e7278",
    "PEWTER": "#8e8e8a",
    "MEDIUM NEUTRAL": "#c4ad8a",
    "NEUTRAL": "#d2c2a6",
    "CREAM": "#e8d9be",
    "CHAMOIS": "#c4a574",
    "LATTE": "#b08968",
    "MEDIUM ALABASTER": "#d8d0c4",
    "ALABASTER": "#d8d0c4",
    "WHITE": "#ece6db",
}

LOCAL_FALLBACK = [
    "black-pewter.JPG",
    "black-white.JPG",
    "black-white2.JPG",
    "creme-chamois.JPG",
    "creme-sand.JPG",
    "granite-crystal.JPG",
    "leather-sand.jpg",
    "pewter-black.JPG",
    "sofas/quicksilver.JPG",
]


def hex_for(name: str) -> str:
    key = (name or "").upper().strip()
    if key in SWATCH:
        return SWATCH[key]
    for token, color in SWATCH.items():
        if token in key:
            return color
    return "#7a746a"


def parse_color_full(full: str) -> dict:
    normalized = re.sub(r"\s+", " ", (full or "").replace("W/", " W/ ")).strip()
    parts = [p.strip() for p in normalized.split(" W/ ") if p.strip()]

    def strip_paren(value: str) -> str:
        value = re.sub(r"\s*\([^)]*\)", "", value)
        value = re.sub(r"\s*PIPING", "", value, flags=re.I)
        return value.strip()

    body = strip_paren(parts[0] if parts else normalized)
    piping = strip_paren(parts[1] if len(parts) > 1 else "")
    inserts = strip_paren(parts[2] if len(parts) > 2 else "")

    def title(value: str) -> str:
        return value.title()

    short = f"{title(body)} w/ {title(piping)} piping" if piping else title(body)
    detail_bits = []
    if body:
        detail_bits.append(f"Body: {title(body)}")
    if piping:
        detail_bits.append(f"Piping: {title(piping)}")
    if inserts:
        detail_bits.append(f"Inserts: {title(inserts)}")
    return {
        "colorFull": full,
        "body": body,
        "piping": piping,
        "inserts": inserts,
        "shortName": short,
        "bodyHex": hex_for(body),
        "pipingHex": hex_for(piping or body),
        "detail": " · ".join(detail_bits),
    }


def load_colors() -> list[dict]:
    path = ROOT / "Shop Seats - Add.csv"
    grouped: dict[str, dict] = {}
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            sku = (row.get("Name") or "").strip()
            display = (row.get("Display Name") or "").strip()
            if not sku or not display:
                continue
            match = re.search(r"COLOR:\s*(.+)$", display, re.I)
            color_full = (match.group(1) if match else display).strip()
            side = "DS" if " - DS - " in display else "PS" if " - PS - " in display else ""
            if color_full not in grouped:
                grouped[color_full] = {
                    "id": f"color-{len(grouped) + 1}",
                    "skuDs": "",
                    "skuPs": "",
                    "skus": [],
                    **parse_color_full(color_full),
                }
            item = grouped[color_full]
            item["skus"].append(sku)
            if side == "DS":
                item["skuDs"] = sku
            if side == "PS":
                item["skuPs"] = sku
    colors = []
    for item in grouped.values():
        ds = item["skuDs"] or (item["skus"][0] if item["skus"] else "")
        ps = item["skuPs"]
        item["partsLabel"] = f"{ds} (DS)  ·  {ps} (PS)" if ps else ds
        colors.append(item)
    colors.extend(
        [
            {
                "id": "unsure",
                "shortName": "Not sure / cannot determine",
                "partsLabel": "Needs a closer look",
                "detail": "Lighting, crop, or quality is not enough to match a colorway.",
                "bodyHex": "#3a3a40",
                "pipingHex": "#8a8378",
                "extra": True,
            },
            {
                "id": "none",
                "shortName": "None of these colors",
                "partsLabel": "No matching part number",
                "detail": "The photo does not match any Shop Seat color listed in the CSV.",
                "bodyHex": "#2a1f1f",
                "pipingHex": "#d46a6a",
                "extra": True,
            },
        ]
    )
    return colors


def list_local_images() -> list[dict]:
    found: list[str] = []
    for pattern in ("*.JPG", "*.jpg", "*.jpeg", "*.JPEG", "*.png", "*.PNG", "*.webp", "*.WEBP"):
        found.extend(str(p.relative_to(ROOT)).replace("\\", "/") for p in ROOT.rglob(pattern))
    skip = {"survey-results"}
    unique = []
    seen = set()
    for rel in found + LOCAL_FALLBACK:
        if rel in seen:
            continue
        if any(part in skip for part in Path(rel).parts):
            continue
        if not (ROOT / rel).exists():
            continue
        seen.add(rel)
        unique.append(rel)
    unique.sort(key=lambda p: (p.lower().startswith("sofas/"), p.lower()))
    return [
        {
            "id": f"local-{i + 1}",
            "src": path,
            "path": path,
            "label": path,
            "kind": "local",
            "hint": path,
        }
        for i, path in enumerate(unique)
    ]


def load_remote_images() -> list[dict]:
    path = ROOT / "potential-usable-files.txt"
    images = []
    if not path.exists():
        return images
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.lower() == "potential usable files":
            continue
        match = re.search(r"https?://\S+", text, re.I)
        if not match:
            continue
        url = match.group(0)
        label = text.replace(url, "").strip() or url.rsplit("/", 1)[-1]
        images.append(
            {
                "id": f"url-{len(images) + 1}",
                "src": url,
                "path": url,
                "label": label,
                "kind": "url",
                "hint": label,
            }
        )
    return images


def catalog() -> dict:
    return {"colors": load_colors(), "images": list_local_images() + load_remote_images()}


def try_send_mail(subject: str, body: str) -> bool:
    for command in (
        ["mail", "-s", subject, EMAIL_TO],
        ["sendmail", EMAIL_TO],
    ):
        try:
            payload = body if command[0] == "mail" else f"Subject: {subject}\nTo: {EMAIL_TO}\n\n{body}"
            completed = subprocess.run(
                command,
                input=payload,
                text=True,
                capture_output=True,
                timeout=12,
                check=False,
            )
            if completed.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
    return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/catalog":
            return self._json(200, catalog())
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/submit":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return self._json(400, {"ok": False, "error": "Invalid JSON"})

        RESULTS_DIR.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", (payload.get("reviewer") or "reviewer")).strip("-")
        json_path = RESULTS_DIR / f"{stamp}-{safe_name}.json"
        csv_path = RESULTS_DIR / f"{stamp}-{safe_name}.csv"
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        csv_path.write_text(payload.get("csv") or "", encoding="utf-8")

        emailed = try_send_mail(payload.get("subject") or "Seat color survey", payload.get("body") or "")
        return self._json(
            200,
            {
                "ok": True,
                "emailed": emailed,
                "saved": [str(json_path.name), str(csv_path.name)],
            },
        )

    def _json(self, status: int, data: dict):
        blob = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def log_message(self, fmt: str, *args):
        print(f"[survey] {self.address_string()} {fmt % args}")


def guess_types():
    mimetypes.add_type("image/jpeg", ".JPG")
    mimetypes.add_type("image/jpeg", ".JPEG")
    mimetypes.add_type("image/webp", ".webp")
    mimetypes.add_type("text/csv", ".csv")


def main():
    guess_types()
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Waldoch seat color survey: {url}")
    print(f"Results email: {EMAIL_TO}")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSurvey server stopped.")


if __name__ == "__main__":
    main()
