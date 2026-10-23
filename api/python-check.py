from http.server import BaseHTTPRequestHandler
import importlib.metadata
import json
import os
import subprocess
import sys


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
                "error": None,
            }

            try:
                data["vercelSdkVersion"] = (
                    importlib.metadata.version("vercel")
                )
            except Exception as exc:
                data["vercelSdkVersion"] = type(exc).__name__

            try:
                import vercel.blob
                data["blobSdk"] = True
            except Exception as exc:
                data["blobImportError"] = (
                    type(exc).__name__ + ": " + str(exc)[:200]
                )

            if result.returncode != 0:
                data["error"] = result.stderr.strip()[:250]

            data["ok"] = (
                result.returncode == 0
                and data["blobSdk"]
                and data["blobTokenConfigured"]
            )

            self.send_json(200, data)

        except Exception as exc:
            self.send_json(500, {
                "ok": False,
                "error": type(exc).__name__,
            })

    def do_POST(self):
        self.send_json(405, {
            "ok": False,
            "error": "Method not allowed",
        })