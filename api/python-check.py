from http.server import BaseHTTPRequestHandler
import hmac
import importlib.metadata
import json
import os
import subprocess
import sys

def send_json(handler, status, data):
body = json.dumps(data).encode("utf-8")
handler.send_response(status)
handler.send_header("Content-Type", "application/json; charset=utf-8")
handler.send_header("Cache-Control", "no-store")
handler.send_header("Content-Length", str(len(body)))
handler.end_headers()
handler.wfile.write(body)

class handler(BaseHTTPRequestHandler):

def do_GET(self):
    result = subprocess.run(
        [sys.executable, "-m", "gallery_dl", "--version"],
        capture_output=True,
        text=True,
        timeout=10
    )

    data = {
        "ok": False,
        "python": sys.version.split()[0],
        "galleryDl": result.stdout.strip() or None,
        "vercelSdkVersion": None,
        "blobSdk": False,
        "blobTokenConfigured": bool(
            os.environ.get("BLOB_READ_WRITE_TOKEN")
        ),
        "blobImportError": None,
        "error": None
    }

    try:
        data["vercelSdkVersion"] = (
            importlib.metadata.version("vercel")
        )
    except Exception as exc:
        data["vercelSdkVersion"] = type(exc).__name__

    try:
        from vercel.blob import BlobClient
        data["blobSdk"] = callable(BlobClient)
    except Exception as exc:
        data["blobImportError"] = (
            type(exc).__name__ + ": " + str(exc)[:250]
        )

    if result.returncode != 0:
        data["error"] = result.stderr.strip()[:250]

    data["ok"] = (
        result.returncode == 0
        and data["blobSdk"]
        and data["blobTokenConfigured"]
    )

    send_json(self, 200, data)

def do_POST(self):
    expected = os.environ.get("PYTHON_FUNCTION_SECRET", "")
    supplied = self.headers.get("X-Function-Secret", "")

    if not expected or not hmac.compare_digest(supplied, expected):
        send_json(self, 401, {
            "ok": False,
            "error": "Unauthorized"
        })
        return

    send_json(self, 200, {
        "ok": True,
        "message": "Secret valid; Blob upload not tested yet."
    })