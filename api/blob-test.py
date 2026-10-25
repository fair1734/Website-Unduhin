from http.server import BaseHTTPRequestHandler
import asyncio
import hmac
import json
import os

from vercel.blob import AsyncBlobClient

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
    self.send_json(200, {
        "ok": True,
        "message": "Blob test endpoint ready"
    })

def do_POST(self):
    expected = os.environ.get("PYTHON_FUNCTION_SECRET", "")
    supplied = self.headers.get("X-Function-Secret", "")

    if not expected or not hmac.compare_digest(
        supplied, expected
    ):
        self.send_json(401, {
            "ok": False,
            "error": "Unauthorized"
        })
        return

    if not os.environ.get("BLOB_READ_WRITE_TOKEN"):
        self.send_json(500, {
            "ok": False,
            "error": "BLOB_READ_WRITE_TOKEN is not configured"
        })
        return

    try:
        uploaded = asyncio.run(self.upload_test_blob())

        self.send_json(200, {
            "ok": True,
            "uploaded": True,
            "pathname": uploaded.pathname
        })

    except Exception as exc:
        self.send_json(500, {
            "ok": False,
            "error": type(exc).__name__,
            "detail": str(exc)[:200]
        })

async def upload_test_blob(self):
    client = AsyncBlobClient()

    return await client.put(
        "diagnostics/test.txt",
        b"Website Unduhin Blob test",
        access="private",
        content_type="text/plain",
        add_random_suffix=True
    )