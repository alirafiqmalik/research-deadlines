"""Build a temporary Jekyll preview for browser tests. No production settings change."""
import subprocess
import tempfile
import yaml
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

root = Path(__file__).resolve().parents[1]
baseurl = yaml.safe_load((root / "_config.yml").read_text()).get("baseurl", "").rstrip("/")
with tempfile.TemporaryDirectory(prefix="venue-preview-") as directory:
    subprocess.run(["ruby", "-e", 'load Gem.bin_path("jekyll", "jekyll")', "--", "build", "--source", str(root), "--destination", directory, "--disable-disk-cache"], check=True, cwd=root)
    # Serve the configured baseurl without changing the production configuration.
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            if baseurl and path.startswith(baseurl + "/"):
                path = path[len(baseurl):]
            return super().translate_path(path)
        def log_message(self, *args):
            pass
    ThreadingHTTPServer(("127.0.0.1", 48763), partial(Handler, directory=directory)).serve_forever()
