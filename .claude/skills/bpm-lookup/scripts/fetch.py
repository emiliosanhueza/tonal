"""Hooktheory first, then a fallback only for the songs Hooktheory doesn't have.

1. Hooktheory artist pages (HTML) over plain HTTP: free.                          -> HERE/ht/<slug>.html
2. For songs not found there: GetSongBPM API if a key is set (free), else
   Tunebat search through the Firecrawl CLI (markdown, ~1 credit per song).       -> HERE/gs/NN.json, HERE/tb/NN.md
   Songs the API didn't match also fall through to Tunebat.

Flags: --tunebat-all  also scrape Tunebat for songs Hooktheory has (cross-check; costs credits)
       --no-tunebat   never call Firecrawl
API key: env GETSONGBPM_API_KEY, or the file .getsongbpm_key in the Tonal project folder.
"""
import sys, os, time, subprocess, urllib.parse
from pathlib import Path
from common import hooktheory_rows, hooktheory_match, getsongbpm_cards, match_cards


HERE = Path(sys.argv[1]).resolve()  # work dir containing songs.py; pages are cached in HERE/ht, HERE/gs, HERE/tb
FLAGS = set(sys.argv[2:])
PROJECT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(HERE))
for d in ("ht", "gs", "tb"):
    (HERE / d).mkdir(exist_ok=True)
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


def fetch_http(out, url, headers=None, pause=2.0):
    """Cached GET; 404 is cached as an empty marker. Returns False on 401 (bad API key)."""
    if out.exists() and out.stat().st_size > 0:
        return True
    for _ in range(3):
        status, body = get(url, headers)
        if status in (200, 404, 401):
            break
        print("retry", status, url.split("?")[0], flush=True)
        time.sleep(30)
    if status == 401:
        print("GetSongBPM rejected the API key (401):", body.decode(errors="replace")[:200], flush=True)
        return False
    out.write_bytes(body if status == 200 else (b"{}" if headers else b"<!-- 404 -->"))
    print("ok" if status == 200 else status, out.name, flush=True)
    time.sleep(pause)
    return True


def fetch_tunebat(out, url):
    if out.exists() and out.stat().st_size > 500:
        return
    for _ in range(3):
        r = subprocess.run(["firecrawl", "scrape", url, "--format", "markdown", "--only-main-content", "-o", str(out)],
                           capture_output=True, text=True)
        if out.exists() and out.stat().st_size > 0:
            break
        print("retry", url, r.stderr[-200:], flush=True)
        time.sleep(30)
    print("ok" if out.exists() else "FAIL", out.name, "(Firecrawl)", flush=True)
    time.sleep(6.5)  # ~10 scrapes/minute on this plan


# 1. Hooktheory, one page per artist
rows = {}
for slug in sorted({s[-1] for s in SONGS if s[-1]}):
    out = HERE / "ht" / f"{slug}.html"
    fetch_http(out, f"https://www.hooktheory.com/theorytab/artist/{slug}")
    rows[slug] = hooktheory_rows(out.read_text())

need = [i for i, s in enumerate(SONGS) if "--tunebat-all" in FLAGS or not hooktheory_match(rows.get(s[-1], {}), s[-2])]
print(f"Hooktheory has {len(SONGS) - sum(1 for i, s in enumerate(SONGS) if not hooktheory_match(rows.get(s[-1], {}), s[-2]))}"
      f"/{len(SONGS)} songs; {len(need)} go to the fallback.", flush=True)

# 2a. GetSongBPM API (free) when a key is set
KEY = api_key()
if KEY:
    for i in list(need):
        title, artist, *_rest = SONGS[i]
        q = urllib.parse.urlencode({"type": "both", "lookup": f"song:{_rest[-2]} artist:{artist.split(' & ')[0]}", "limit": 20})
        out = HERE / "gs" / f"{i:02d}.json"
        if not fetch_http(out, f"https://api.getsong.co/search/?{q}", {"X-API-KEY": KEY}, 1.5):
            break
        if match_cards(getsongbpm_cards(out.read_text()), title, artist, _rest[-2]):
            need.remove(i)

# 2b. Tunebat through Firecrawl for whatever is left
if need and "--no-tunebat" not in FLAGS:
    print(f"Tunebat via Firecrawl: {len(need)} song(s), ~{len(need)} credit(s).", flush=True)
    for i in need:
        title, artist, *_rest = SONGS[i]
        q = urllib.parse.quote(f"{_rest[-2]} {artist.split(' & ')[0]}")
        fetch_tunebat(HERE / "tb" / f"{i:02d}.md", f"https://tunebat.com/Search?q={q}")
print("DONE", flush=True)
