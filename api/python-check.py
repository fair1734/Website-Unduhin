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
        "Content-Type",
        "application/json; charset=utf-8"
    )
    handler.send_header("Cache-Control", "no-store")
    handler.send_header(
        "Content-Length",
        str(len(body))
    )
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        data = {
            "ok": False,
            "python": sys.version.split()[0],
            "galleryDl": None,
            "blobSdk": False,
            "blobTokenConfigured": bool(
                os.environ.get("BLOB_READ_WRITE_TOKEN")
            ),
            "blobImportError": None,
            "error": None
        }

        try:
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "gallery_dl",
                    "--version"
                ],
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode == 0:
                data["galleryDl"] = result.stdout.strip()
            else:
                data["error"] = (
                    result.stderr.strip()
                    or "gallery-dl gagal dijalankan"
                )

            try:
                from vercel.blob import put
                data["blobSdk"] = callable(put)

            except Exception as exc:
                data["blobImportError"] = type(exc).__name__

            data["ok"] = (
                result.returncode == 0
                and data["blobSdk"]
                and data["blobTokenConfigured"]
            )

            send_json(self, 200, data)

        except Exception as exc:
            send_json(self, 500, {
                "ok": False,
                "error": type(exc).__name__
            })

    def do_POST(self):
        expected = os.environ.get(
            "PYTHON_FUNCTION_SECRET", ""
        )
        supplied = self.headers.get(
            "X-Function-Secret", ""
        )

        # Autentikasi wajib.
        if not expected or not hmac.compare_digest(
            supplied, expected
        ):
            send_json(self, 401, {
                "ok": False,
                "error": "Unauthorized"
            })
            return

        token = os.environ.get(
            "BLOB_READ_WRITE_TOKEN", ""
        )

        if not token:
            send_json(self, 500, {
                "ok": False,
                "error": "Blob token not configured"
            })
            return

        try:
            from vercel.blob import put

            pathname = (
                "diagnostics/blob-test-"
                + uuid.uuid4().hex
                + ".txt"
            )

            uploaded = put(
                pathname,
                b"Website Unduhin private Blob upload test",
                access="private",
                content_type="text/plain",
                add_random_suffix=True,
                token=token
            )

            send_json(self, 200, {
                "ok": True,
                "uploaded": True,
                "access": "private",
                "pathname": uploaded.pathname
            })

        except Exception as exc:
            # Jangan pernah mengembalikan token atau secret.
            send_json(self, 500, {
                "ok": False,
                "error": type(exc).__name__
            })