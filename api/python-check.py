from http.server import BaseHTTPRequestHandler
import sys

class handler(BaseHTTPRequestHandler):
def do_GET(self):
body = (
f"Python runtime aktif: {sys.version}"
).encode("utf-8")

    self.send_response(200)
    self.send_header("Content-Type", "text/plain; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)