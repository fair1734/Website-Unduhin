from http.server import BaseHTTPRequestHandler
import hmac
import json
import os
import subprocess
import sys
import uuid


def send_json(handler, status, data):
    body = json.dumps(data).encode("utf-8")
    handler.send_response(status)
    handler.send_header(
        "Content-Type", "application/json; charset=utf-8"
    )
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        try:
            result = subprocess.run(
                [sys.executable, "-m", "gallery_dl", "--version"],
                capture_output=True,
                text=True,
                timeout=10
            )

            try:
                import vercel.blob
                blob_sdk = True
                blob_error = None
            except Exception as e:
                blob_sdk = False
                blob_error = type(e).__name__

            send_json(self, 200, {
                "ok": (
                    result.returncode == 0
                    and blob_sdk
                    and bool(os.environ.get("BLOB_READ_WRITE_TOKEN"))
                ),
                "python": sys.version.split()[0],
                "galleryDl": result.stdout.strip() or None,
                "blobSdk": blob_sdk,
                "blobTokenConfigured": bool(
                    os.environ.get("BLOB_READ_WRITE_TOKEN")
                ),
                "blobImportError": blob_error,
                "error": (
                    result.stderr.strip()
                    if result.returncode != 0 else None
                )
            })

        except Exception as e:
            send_json(self, 500, {
                "ok": False,
                "error": type(e).__name__
            })

    def do_POST(self):
        expected = os.environ.get("PYTHON_FUNCTION_SECRET", "")
        supplied = self.headers.get("X-Function-Secret", "")

        if not expected or not hmac.compare_digest(
            supplied, expected
        ):
            send_json(self, 401, {
                "ok": False,
                "error": "Unauthorized"
            })
            return

        token = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
        if not token:
            send_json(self, 500, {
                "ok": False,
                "error": "Blob token not configured"
            })
            return

        try:
            from vercel.blob import BlobClient

            client = BlobClient(token=token)
            pathname = (
                f"diagnostics/blob-test-{uuid.uuid4().hex}.txt"
            )

            uploaded = client.put(
                pathname,
                b"Website Unduhin private Blob upload test",
                access="private",
                content_type="text/plain",
                add_random_suffix=True
            )

            send_json(self, 200, {
                "ok": True,
                "uploaded": True,
                "access": "private",
                "pathname": uploaded.get("pathname", pathname)
                if isinstance(uploaded, dict) else pathname
            })

        except Exception as e:
            send_json(self, 500, {
                "ok": False,
                "error": type(e).__name__
            })