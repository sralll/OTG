#!/usr/bin/env python3
# Static server for the city generator. Dual-stack (IPv4 + IPv6) so cloudflared reaches it whether
# it resolves localhost to 127.0.0.1 or ::1; threaded so parallel ES-module fetches don't stall;
# no-cache headers so phones always get the latest; and a POST /_capture endpoint that writes the
# body to reference/<X-Capture-Name>.json (used to save the original generator's exported GeoJSON).
import http.server
import socketserver
import socket
import os

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # quiet

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        name = self.headers.get("X-Capture-Name", "_capture")
        safe = "".join(c for c in name if c.isalnum() or c in "-_") or "_capture"
        with open(os.path.join(ROOT, "reference", safe + ".json"), "wb") as f:
            f.write(data)
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b"ok")


class DualStackServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    address_family = socket.AF_INET6  # accepts IPv6 AND IPv4-mapped (V6ONLY off below)

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


with DualStackServer(("", PORT), Handler) as httpd:
    print(f"serving (dual-stack, threaded, no-cache, +POST /_capture) on :{PORT}")
    httpd.serve_forever()
