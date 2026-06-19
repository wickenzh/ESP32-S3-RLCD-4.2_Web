#!/usr/bin/env python3
import argparse
import http.server
import os
import ssl
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CERT_DIR = ROOT / ".dev_certs"
CERT_FILE = CERT_DIR / "localhost.pem"
KEY_FILE = CERT_DIR / "localhost-key.pem"


def ensure_cert():
    CERT_DIR.mkdir(exist_ok=True)
    if CERT_FILE.exists() and KEY_FILE.exists():
        return
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-sha256",
            "-days",
            "3650",
            "-nodes",
            "-keyout",
            str(KEY_FILE),
            "-out",
            str(CERT_FILE),
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        check=True,
    )


def main():
    parser = argparse.ArgumentParser(description="WeatherClock host web HTTPS dev server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=4173, type=int)
    args = parser.parse_args()

    ensure_cert()
    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"Serving HTTPS on https://{args.host}:{args.port}/")
    print(f"Certificate: {CERT_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
