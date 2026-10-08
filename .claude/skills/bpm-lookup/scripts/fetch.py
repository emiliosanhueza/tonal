"""Fetch GetSongBPM API searches (JSON) and Hooktheory artist pages (HTML) over plain HTTP, cached on disk.

API key: env GETSONGBPM_API_KEY, or the file .getsongbpm_key in the Tonal project folder.
"""
import sys, os, time, subprocess, urllib.parse
from pathlib import Path


HERE = Path(sys.argv[1]).resolve()  # work dir containing songs.py; pages are cached in HERE/gs and HERE/ht
PROJECT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(HERE))
(HERE / 'gs').mkdir(exist_ok=True); (HERE / 'ht').mkdir(exist_ok=True)
from songs import SONGS
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


def api_key():
    key = os.environ.get("GETSONGBPM_API_KEY", "").strip()
    f = PROJECT / ".getsongbpm_key"
    if not key and f.exists():
        key = f.read_text().strip()
    return key


def get(url, headers=None):
    """GET with curl (uses the macOS keychain certificates; python.org Python ships without them)."""
    cmd = ["curl", "-sS", "-L", "--max-time", "30", "-A", UA, "-w", "\n%{http_code}", url]
    for k, v in (headers or {}).items():
        cmd[1:1] = ["-H", f"{k}: {v}"]
    r = subprocess.run(cmd, capture_output=True)
    body, _, code = r.stdout.rpartition(b"\n")
    return (int(code) if code.strip().isdigit() else 0), body


KEY = api_key()
if not KEY:
    print("No GetSongBPM key (set GETSONGBPM_API_KEY or create .getsongbpm_key): skipping GetSongBPM, Hooktheory only.", flush=True)

jobs = []
if KEY:
    for i, (title, artist, *_rest) in enumerate(SONGS):
        core = _rest[-2]
        main_artist = artist.split(" & ")[0]
        q = urllib.parse.urlencode({"type": "both", "lookup": f"song:{core} artist:{main_artist}", "limit": 20})
        jobs.append((HERE / "gs" / f"{i:02d}.json", f"https://api.getsong.co/search/?{q}", {"X-API-KEY": KEY}, 1.5))
for slug in sorted({s[-1] for s in SONGS if s[-1]}):
    jobs.append((HERE / "ht" / f"{slug}.html", f"https://www.hooktheory.com/theorytab/artist/{slug}", None, 2.0))

for out, url, headers, pause in jobs:
    if out.exists() and out.stat().st_size > 0:
        continue
    for attempt in range(3):
        status, body = get(url, headers)
        if status in (200, 404) or (status == 401 and headers):
            break
        print("retry", status, url.split("?")[0], flush=True)
        time.sleep(30)
    if status == 401:
        sys.exit("GetSongBPM rejected the API key (401): " + body.decode(errors="replace")[:200])
    # 404 is cached as an empty-result marker so it isn't refetched
    out.write_bytes(body if status == 200 else (b"{}" if headers else b"<!-- 404 -->"))
    print("ok" if status == 200 else status, out.name, flush=True)
    time.sleep(pause)
print("DONE", flush=True)
