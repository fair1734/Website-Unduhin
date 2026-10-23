from http.server import BaseHTTPRequestHandler
import hmac
import json
import os

from vercel.blob import BlobClient


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(
            json.dumps({
                "ok": True,
                "message": "Blob test endpoint ready"
            }).encode()
        )

    def do_POST(self):
        expected = os.environ.get("PYTHON_FUNCTION_SECRET", "")
        supplied = self.headers.get("X-Function-Secret", "")

        if not expected or not hmac.compare_digest(
            supplied, expected
        ):
            self.send_response(401)
            self.end_headers()
            return

        try:
            client = BlobClient()
            uploaded = client.put(
                "diagnostics/test.txt",
                b"Website Unduhin Blob test",
                access="private",
                content_type="text/plain",
                add_random_suffix=True,
            )

            body = json.dumps({
                "ok": True,
                "uploaded": True,
                "pathname": uploaded.pathname,
            }).encode()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        except Exception as exc:
            body = json.dumps({
                "ok": False,
                "error": type(exc).__name__,
                "detail": str(exc)[:200],
            }).encode()

            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)