
from http.server import BaseHTTPRequestHandler
import json
import os
import subprocess
import sys


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
            "error": None
        }

        try:
            result = subprocess.run(
                [sys.executable, "-m", "gallery_dl", "--version"],
                capture_output=True,
                text=True,
                timeout=10
            )

            data["galleryDl"] = (
                result.stdout.strip()
                if result.returncode == 0
                else None
            )

            if result.returncode != 0:
                data["error"] = result.stderr.strip() or (
                    "gallery-dl gagal dijalankan"
                )

            try:
                import vercel.blob
                data["blobSdk"] = True
            except Exception as e:
                data["error"] = (
                    f"Blob SDK: {type(e).__name__}: {e}"
                )

            data["ok"] = (
                result.returncode == 0
                and data["blobSdk"]
                and data["blobTokenConfigured"]
            )

        except Exception as e:
            data["error"] = f"{type(e).__name__}: {e}"

        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header(
            "Content-Type", "application/json; charset=utf-8"
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
