
from http.server import BaseHTTPRequestHandler
import json
import subprocess
import sys


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            result = subprocess.run(
                [sys.executable, "-m", "gallery_dl", "--version"],
                capture_output=True,
                text=True,
                timeout=10
            )
            data = {
                "ok": result.returncode == 0,
                "python": sys.version.split()[0],
                "galleryDl": result.stdout.strip(),
                "error": result.stderr.strip() or None
            }
        except Exception as e:
            data = {
                "ok": False,
                "python": sys.version.split()[0],
                "error": str(e)
            }

        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
