from http.server import BaseHTTPRequestHandler
import hmac
import importlib.metadata
import json
import os
import subprocess
import sys
import uuid

from vercel.blob import BlobClient

class handler(BaseHTTPRequestHandler):

def send_json(self, status, data):
    body = json.dumps(data).encode("utf-8")
    self.send_response(status)
    self.send_header(
        "Content-Type", "application/json; charset=utf-8"
    )
    self.send_header("Cache-Control", "no-store")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

def do_GET(self):
    try:
        result = subprocess.run(
            [sys.executable, "-m", "gallery_dl", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )

        try:
            sdk_version = importlib.metadata.version("vercel")
        except Exception:
            sdk_version = None

        data = {
            "ok": (
                result.returncode == 0
                and bool(os.environ.get("BLOB_READ_WRITE_TOKEN"))
            ),
            "python": sys.version.split()[0],
            "galleryDl": result.stdout.strip() or None,
            "vercelSdkVersion": sdk_version,
            "blobSdk": True,
            "blobTokenConfigured": bool(
                os.environ.get("BLOB_READ_WRITE_TOKEN")
            ),
            "error": (
                result.stderr.strip()[:250]
                if result.returncode != 0 else None
            ),
        }

        self.send_json(200, data)

    except Exception as exc:
        self.send_json(500, {
            "ok": False,
            "error": type(exc).__name__,
        })

def do_POST(self):
    expected = os.environ.get("PYTHON_FUNCTION_SECRET", "")
    supplied = self.headers.get("X-Function-Secret", "")

    if not expected or not hmac.compare_digest(
        supplied, expected
    ):
        self.send_json(401, {
            "ok": False,
            "error": "Unauthorized",
        })
        return

    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "")

    if not token:
        self.send_json(500, {
            "ok": False,
            "error": "Blob token not configured",
        })
        return

    try:
        client = BlobClient()
        pathname = (
            "diagnostics/blob-test-"
            + uuid.uuid4().hex
            + ".txt"
        )

        uploaded = client.put(
            pathname,
            b"Website Unduhin private Blob upload test",
            access="private",
            content_type="text/plain",
            add_random_suffix=True,
            token=token,
        )

        self.send_json(200, {
            "ok": True,
            "uploaded": True,
            "access": "private",
            "pathname": uploaded.pathname,
        })

    except Exception as exc:
        self.send_json(500, {
            "ok": False,
            "error": type(exc).__name__,
            "detail": str(exc)[:250],
        })