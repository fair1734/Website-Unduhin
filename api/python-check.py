
from http.server import BaseHTTPRequestHandler
import json
import sys

try:
    import gallery_dl
    gallery_status = {
        "ok": True,
        "version": getattr(gallery_dl, "__version__", "terpasang")
    }
except Exception as e:
    gallery_status = {
        "ok": False,
        "error": str(e)
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({
            "ok": gallery_status["ok"],
            "python": sys.version,
            "galleryDl": gallery_status
        }).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
