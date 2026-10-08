#!/usr/bin/env python3
"""Tonal — a local harmonic-mixing song database.

Everything lives next to this file:
  tonal.db        SQLite database (your library and playlists)
  backups/        automatic daily copies of tonal.db
  web/            the browser UI

Usage:
  python3 tonal.py serve [--port 8765] [--open]
  python3 tonal.py add "Title" "Artist" --bpm 120 --key "Ab mixolydian" [--notes ...] [--tags ...]
  python3 tonal.py import songs.csv [--update]      (CSV, TSV or JSON)
  python3 tonal.py list [--key 3B] [--search text]
  python3 tonal.py export out.csv | out.json
  python3 tonal.py backup
"""

import argparse
import csv
import io
import json
import mimetypes
import re
import shutil
import sqlite3
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "tonal.db"
WEB_DIR = ROOT / "web"
BACKUP_DIR = ROOT / "backups"
SEED_FILE = ROOT / "seed" / "starter_library.csv"
DEFAULT_PORT = 8765
KEEP_BACKUPS = 30

# ---------------------------------------------------------------- theory

# Offset of each mode's tonic above its parent major tonic (Hooktheory's seven modes).
MODE_OFFSETS = {
    "lydian": 5, "major": 0, "mixolydian": 7, "dorian": 2,
    "minor": 9, "phrygian": 4, "locrian": 11,
}
MODE_ALIASES = {
    "": "major", "maj": "major", "major": "major", "ionian": "major", "ion": "major", "dur": "major",
    "m": "minor", "min": "minor", "minor": "minor", "aeolian": "minor", "aeol": "minor", "moll": "minor",
    "dorian": "dorian", "dor": "dorian",
    "phrygian": "phrygian", "phryg": "phrygian", "phr": "phrygian",
    "lydian": "lydian", "lyd": "lydian",
    "mixolydian": "mixolydian", "mixo": "mixolydian", "mix": "mixolydian", "mixolyd": "mixolydian",
    "locrian": "locrian", "loc": "locrian",
}
LETTER_PC = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def _parse_key_simple(s):
    s = s.strip().lower()
    s = re.sub(r"^(key of|in)\s+", "", s)
    s = re.sub(r"\s+(scale|mode|key)$", "", s)
    if not s:
        return None
    m = re.fullmatch(r"0?(\d{1,2})\s*([ab])", s)  # Camelot
    if m:
        num, letter = int(m.group(1)), m.group(2)
        if 1 <= num <= 12:
            major_pc = ((num - 8) * 7) % 12
            return (major_pc, "major") if letter == "b" else ((major_pc + 9) % 12, "minor")
        return None
    m = re.fullmatch(r"(\d{1,2})\s*([dm])", s)  # Open Key
    if m:
        num = int(m.group(1))
        if 1 <= num <= 12:
            return _parse_key_simple(f"{(num + 6) % 12 + 1}{'b' if m.group(2) == 'd' else 'a'}")
        return None
    m = re.fullmatch(r"([a-g])\s*(#|b|-?sharp|-?flat)?\s*-?\s*([a-z]*)", s)
    if not m:
        return None
    pc = LETTER_PC[m.group(1)]
    acc = m.group(2) or ""
    if acc in ("#", "sharp", "-sharp"):
        pc += 1
    elif acc in ("b", "flat", "-flat"):
        pc -= 1
    mode = MODE_ALIASES.get(m.group(3))
    if mode is None:
        return None
    return pc % 12, mode


def parse_key(value):
    """Return (tonic_pc, mode) or None. Accepts 'Am', 'Bbm', 'Ab mixolydian', '8A', '3B (A♭ Mixolydian)', '5m'."""
    if value is None:
        return None
    s = str(value).replace("♭", "b").replace("♯", "#").replace("–", "-").strip()
    if not s:
        return None
    paren = re.search(r"\(([^)]*)\)", s)
    if paren:
        inner = _parse_key_simple(paren.group(1))
        if inner:
            return inner
        s = re.sub(r"\([^)]*\)", "", s)
    return _parse_key_simple(s)


def parse_duration(value):
    if value in (None, ""):
        return None
    s = str(value).strip()
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{2})", s)
    if m:
        h = int(m.group(1) or 0)
        return h * 3600 + int(m.group(2)) * 60 + int(m.group(3))
    try:
        return int(float(s))
    except ValueError:
        return None


def _num(value, lo=None, hi=None, integer=False):
    if value in (None, ""):
        return None
    try:
        n = float(str(value).lower().replace("bpm", "").strip())
    except ValueError:
        return None
    if lo is not None and n < lo or hi is not None and n > hi:
        return None
    return int(round(n)) if integer else round(n, 2)


# ---------------------------------------------------------------- database

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  bpm REAL,
  tonic INTEGER,
  mode TEXT,
  duration INTEGER,
  energy INTEGER,
  rating INTEGER,
  tags TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, position)
);
"""

SONG_FIELDS = ("title", "artist", "bpm", "tonic", "mode", "duration", "energy", "rating", "tags", "notes")
_write_lock = threading.Lock()


def now():
    return datetime.now().isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db():
    fresh = not DB_PATH.exists()
    with connect() as conn:
        conn.executescript(SCHEMA)
    if fresh and SEED_FILE.exists():
        rows = read_table_file(SEED_FILE)
        with connect() as conn:
            result = insert_songs(conn, [normalize_song(r) for r in rows])
        print(f"Created tonal.db with {result['added']} starter songs.")


def song_row(row):
    d = dict(row)
    d["tags"] = d["tags"] or ""
    d["notes"] = d["notes"] or ""
    return d


def norm_key(title, artist):
    clean = lambda s: re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
    return clean(title), clean(artist)


def normalize_song(raw):
    """Turn a loosely-shaped dict (CSV row, JSON object, API payload) into song fields."""
    low = {str(k).strip().lower(): v for k, v in raw.items()}

    def pick(*names):
        for n in names:
            if n in low and low[n] not in (None, ""):
                return low[n]
        return None

    song = {
        "title": str(pick("title", "song", "song title", "track", "track title", "name") or "").strip(),
        "artist": str(pick("artist", "artists", "by") or "").strip(),
        "bpm": _num(pick("bpm", "tempo"), 30, 300),
        "duration": parse_duration(pick("duration", "length", "time")),
        "energy": _num(pick("energy"), 1, 5, integer=True),
        "rating": _num(pick("rating", "stars"), 0, 5, integer=True),
        "notes": str(pick("notes", "note", "comments", "comment", "mixing notes", "harmonic / mixing notes") or "").strip(),
        "tonic": None,
        "mode": None,
    }
    tags = pick("tags", "genre", "genres")
    song["tags"] = ", ".join(t.strip() for t in tags if str(t).strip()) if isinstance(tags, list) else str(tags or "").strip()
    tonic, mode = low.get("tonic"), low.get("mode")
    if isinstance(tonic, int) and 0 <= tonic <= 11 and mode in MODE_OFFSETS:
        song["tonic"], song["mode"] = tonic, mode
    else:
        parsed = parse_key(pick("key", "key & mode", "key & modal center", "musical key", "keyinput", "camelot", "key/mode"))
        if parsed:
            song["tonic"], song["mode"] = parsed
    return song


def validate_song(song):
    if not song.get("title"):
        raise ValueError("Title is required")
    if (song.get("tonic") is None) != (song.get("mode") is None):
        song["tonic"] = song["mode"] = None
    if song.get("mode") is not None and song["mode"] not in MODE_OFFSETS:
        raise ValueError(f"Unknown mode {song['mode']}")
    return song


def insert_songs(conn, songs, on_duplicate="skip"):
    """Insert songs, de-duplicating on (title, artist). Returns counts plus a ref -> id map."""
    existing = {norm_key(r["title"], r["artist"]): r["id"] for r in conn.execute("SELECT id, title, artist FROM songs")}
    added = updated = skipped = 0
    errors, ref_map = [], {}
    ts = now()
    for i, song in enumerate(songs):
        ref = song.get("ref")
        try:
            validate_song(song)
        except ValueError as e:
            errors.append(f"Row {i + 1}: {e}")
            continue
        key = norm_key(song["title"], song["artist"])
        values = [song.get(f) if f not in ("tags", "notes") else (song.get(f) or "") for f in SONG_FIELDS]
        if key in existing:
            sid = existing[key]
            if on_duplicate == "update":
                # Only overwrite fields the incoming row actually has.
                sets = [(f, v) for f, v in zip(SONG_FIELDS, values) if v not in (None, "")]
                if sets:
                    conn.execute(
                        f"UPDATE songs SET {', '.join(f + ' = ?' for f, _ in sets)}, updated_at = ? WHERE id = ?",
                        [v for _, v in sets] + [ts, sid],
                    )
                updated += 1
            else:
                skipped += 1
        else:
            cur = conn.execute(
                f"INSERT INTO songs ({', '.join(SONG_FIELDS)}, created_at, updated_at) VALUES ({', '.join('?' * len(SONG_FIELDS))}, ?, ?)",
                values + [ts, ts],
            )
            sid = cur.lastrowid
            existing[key] = sid
            added += 1
        if ref is not None:
            ref_map[str(ref)] = sid
    return {"added": added, "updated": updated, "skipped": skipped, "errors": errors, "ref_map": ref_map}


def list_songs(conn):
    return [song_row(r) for r in conn.execute("SELECT * FROM songs ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE")]


def list_playlists(conn):
    out = []
    for p in conn.execute("SELECT * FROM playlists ORDER BY updated_at DESC"):
        d = dict(p)
        d["song_ids"] = [r[0] for r in conn.execute(
            "SELECT song_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position", (p["id"],))]
        out.append(d)
    return out


def write_tracks(conn, playlist_id, song_ids):
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
    valid = {r[0] for r in conn.execute("SELECT id FROM songs")}
    rows = [(playlist_id, pos, sid) for pos, sid in enumerate(s for s in song_ids if s in valid)]
    conn.executemany("INSERT INTO playlist_tracks (playlist_id, position, song_id) VALUES (?, ?, ?)", rows)


def create_playlist(conn, name, notes="", song_ids=()):
    ts = now()
    cur = conn.execute("INSERT INTO playlists (name, notes, created_at, updated_at) VALUES (?, ?, ?, ?)",
                       ((name or "Untitled set").strip(), notes or "", ts, ts))
    write_tracks(conn, cur.lastrowid, list(song_ids))
    return cur.lastrowid


def full_backup(conn):
    return {"format": "tonal-backup", "version": 2, "exported": now(),
            "songs": list_songs(conn), "playlists": list_playlists(conn)}


def backup_db(label="daily"):
    if not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d") if label == "daily" else datetime.now().strftime("%Y-%m-%d_%H%M%S")
    target = BACKUP_DIR / f"tonal-{stamp}{'' if label == 'daily' else '-' + label}.db"
    if label == "daily" and target.exists():
        return target
    src = connect()
    dst = sqlite3.connect(target)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    for old in sorted(BACKUP_DIR.glob("tonal-*.db"))[:-KEEP_BACKUPS]:
        old.unlink()
    return target


# ---------------------------------------------------------------- file import / export

def read_table_file(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    stripped = text.lstrip()
    if stripped.startswith("[") or stripped.startswith("{"):
        data = json.loads(text)
        return data.get("songs", []) if isinstance(data, dict) else data
    first = text.splitlines()[0] if text else ""
    dialect = "excel-tab" if "\t" in first else "excel"
    return list(csv.DictReader(io.StringIO(text), dialect=dialect))


EXPORT_COLUMNS = ["title", "artist", "bpm", "key", "camelot", "duration", "energy", "rating", "tags", "notes"]
# Tonic spellings per mode, as listed on Hooktheory's cheat sheets.
HOOK_TONICS = {
    "major":      "A♭ A B♭ B C D♭ D E♭ E F F♯ G",
    "minor":      "A B♭ B C C♯ D D♯ E F F♯ G G♯",
    "dorian":     "A B♭ B C C♯ D E♭ E F F♯ G G♯",
    "mixolydian": "A♭ A B♭ B C C♯ D E♭ E F F♯ G",
    "lydian":     "A♭ A B♭ B C D♭ D E♭ E F G♭ G",
    "phrygian":   "A A♯ B C C♯ D D♯ E F F♯ G G♯",
    "locrian":    "A A♯ B C C♯ D D♯ E E♯ F♯ G G♯",
}


def _name_pc(name):
    return (LETTER_PC[name[0].lower()] + name.count("♯") - name.count("♭")) % 12


SPELLING = {mode: {_name_pc(n): n for n in names.split()} for mode, names in HOOK_TONICS.items()}


def key_label(tonic, mode):
    if tonic is None or mode is None:
        return "", ""
    parent = (tonic - MODE_OFFSETS[mode]) % 12
    num = (parent * 7 + 7) % 12 + 1
    letter = "B" if mode in ("lydian", "major", "mixolydian") else "A"
    return f"{SPELLING[mode][tonic]} {mode.capitalize()}", f"{num}{letter}"


def fmt_bpm(bpm):
    return "" if bpm is None else (str(int(bpm)) if bpm == int(bpm) else str(bpm))


def songs_to_csv(songs):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([c.capitalize() for c in EXPORT_COLUMNS])
    for s in songs:
        key, cam = key_label(s["tonic"], s["mode"])
        dur = f"{s['duration'] // 60}:{s['duration'] % 60:02d}" if s.get("duration") else ""
        w.writerow([s["title"], s["artist"], fmt_bpm(s["bpm"]), key, cam, dur,
                    s["energy"] or "", s["rating"] or "", s["tags"], s["notes"]])
    return buf.getvalue()


# ---------------------------------------------------------------- HTTP server

class Handler(BaseHTTPRequestHandler):
    server_version = "Tonal/2"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, body, content_type="application/json; charset=utf-8", extra=None):
        data = body if isinstance(body, bytes) else (
            json.dumps(body, ensure_ascii=False).encode() if not isinstance(body, str) else body.encode())
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}") if length else {}

    def _route(self):
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        return parts

    def do_GET(self):
        parts = self._route()
        if parts[:1] != ["api"]:
            return self._static(parts)
        with connect() as conn:
            if parts == ["api", "state"]:
                return self._send(200, {"songs": list_songs(conn), "playlists": list_playlists(conn),
                                        "db_path": str(DB_PATH)})
            if parts == ["api", "backup.json"]:
                stamp = datetime.now().strftime("%Y-%m-%d")
                return self._send(200, json.dumps(full_backup(conn), ensure_ascii=False, indent=2),
                                  extra={"Content-Disposition": f'attachment; filename="tonal-backup-{stamp}.json"'})
            if parts == ["api", "songs.csv"]:
                stamp = datetime.now().strftime("%Y-%m-%d")
                return self._send(200, songs_to_csv(list_songs(conn)), "text/csv; charset=utf-8",
                                  extra={"Content-Disposition": f'attachment; filename="tonal-songs-{stamp}.csv"'})
        self._send(404, {"error": "Not found"})

    def _static(self, parts):
        rel = "/".join(parts) or "index.html"
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR)) or not target.is_file():
            return self._send(404, "Not found", "text/plain")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    def _write(self, fn):
        try:
            body = self._body()
            with _write_lock, connect() as conn:
                status, result = fn(conn, body)
            self._send(status, result)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            self._send(400, {"error": str(e)})

    def do_POST(self):
        parts = self._route()
        if parts == ["api", "songs"]:
            def add(conn, body):
                songs = [{f: s.get(f) for f in SONG_FIELDS} for s in body.get("songs", [])]
                result = insert_songs(conn, songs, body.get("on_duplicate", "skip"))
                return 200, {**result, "songs": list_songs(conn)}
            return self._write(add)
        if parts == ["api", "import"]:
            def imp(conn, body):
                songs = []
                for s in body.get("songs", []):
                    song = {f: s.get(f) for f in SONG_FIELDS}
                    song["ref"] = s.get("ref")
                    songs.append(song)
                result = insert_songs(conn, songs, body.get("on_duplicate", "skip"))
                made = 0
                for p in body.get("playlists", []):
                    ids = [result["ref_map"][str(r)] for r in p.get("refs", []) if str(r) in result["ref_map"]]
                    if ids:
                        create_playlist(conn, p.get("name"), p.get("notes", ""), ids)
                        made += 1
                return 200, {**result, "playlists_added": made,
                             "songs": list_songs(conn), "playlists": list_playlists(conn)}
            return self._write(imp)
        if parts == ["api", "songs", "delete"]:
            def bulk_delete(conn, body):
                ids = [int(i) for i in body.get("ids", [])]
                conn.executemany("DELETE FROM songs WHERE id = ?", [(i,) for i in ids])
                return 200, {"deleted": len(ids)}
            return self._write(bulk_delete)
        if parts == ["api", "playlists"]:
            def make(conn, body):
                pid = create_playlist(conn, body.get("name"), body.get("notes", ""),
                                      [int(i) for i in body.get("song_ids", [])])
                return 200, {"id": pid, "playlists": list_playlists(conn)}
            return self._write(make)
        if parts == ["api", "restore"]:
            def restore(conn, body):
                if body.get("format") != "tonal-backup":
                    raise ValueError("Not a Tonal backup file")
                backup_db("before-restore")
                conn.execute("DELETE FROM playlist_tracks")
                conn.execute("DELETE FROM playlists")
                conn.execute("DELETE FROM songs")
                songs = [{**{f: s.get(f) for f in SONG_FIELDS}, "ref": s.get("id")} for s in body.get("songs", [])]
                result = insert_songs(conn, songs, "keep")
                for p in body.get("playlists", []):
                    ids = [result["ref_map"][str(r)] for r in p.get("song_ids", []) if str(r) in result["ref_map"]]
                    create_playlist(conn, p.get("name"), p.get("notes", ""), ids)
                return 200, {"songs": list_songs(conn), "playlists": list_playlists(conn)}
            return self._write(restore)
        self._send(404, {"error": "Not found"})

    def do_PUT(self):
        parts = self._route()
        if len(parts) == 3 and parts[:2] == ["api", "songs"]:
            sid = int(parts[2])

            def update(conn, body):
                song = validate_song({f: body.get(f) for f in SONG_FIELDS})
                song["tags"] = song["tags"] or ""
                song["notes"] = song["notes"] or ""
                conn.execute(f"UPDATE songs SET {', '.join(f + ' = ?' for f in SONG_FIELDS)}, updated_at = ? WHERE id = ?",
                             [song[f] for f in SONG_FIELDS] + [now(), sid])
                row = conn.execute("SELECT * FROM songs WHERE id = ?", (sid,)).fetchone()
                if not row:
                    return 404, {"error": "Song not found"}
                return 200, {"song": song_row(row)}
            return self._write(update)
        if len(parts) == 3 and parts[:2] == ["api", "playlists"]:
            pid = int(parts[2])

            def update_pl(conn, body):
                if not conn.execute("SELECT 1 FROM playlists WHERE id = ?", (pid,)).fetchone():
                    return 404, {"error": "Playlist not found"}
                if "name" in body or "notes" in body:
                    conn.execute("UPDATE playlists SET name = COALESCE(?, name), notes = COALESCE(?, notes) WHERE id = ?",
                                 (body.get("name"), body.get("notes"), pid))
                if "song_ids" in body:
                    write_tracks(conn, pid, [int(i) for i in body["song_ids"]])
                conn.execute("UPDATE playlists SET updated_at = ? WHERE id = ?", (now(), pid))
                return 200, {"playlists": list_playlists(conn)}
            return self._write(update_pl)
        self._send(404, {"error": "Not found"})

    def do_DELETE(self):
        parts = self._route()
        if len(parts) == 3 and parts[0] == "api" and parts[1] in ("songs", "playlists"):
            table, rid = parts[1], int(parts[2])

            def remove(conn, body):
                conn.execute(f"DELETE FROM {table} WHERE id = ?", (rid,))
                return 200, {"ok": True}
            return self._write(remove)
        self._send(404, {"error": "Not found"})


def serve(port, open_browser):
    init_db()
    backup_db()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"Tonal is running at {url}  (database: {DB_PATH})\nPress Ctrl+C to stop.", flush=True)
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser(prog="tonal", description="Tonal harmonic-mixing song database")
    sub = ap.add_subparsers(dest="cmd")

    p = sub.add_parser("serve", help="run the app in your browser")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--open", action="store_true", help="open the browser")

    p = sub.add_parser("add", help="add one song")
    p.add_argument("title")
    p.add_argument("artist")
    p.add_argument("--bpm")
    p.add_argument("--key", help="e.g. Am, Bbm, 'Ab mixolydian', 8A")
    p.add_argument("--notes", default="")
    p.add_argument("--tags", default="")
    p.add_argument("--energy")
    p.add_argument("--rating")
    p.add_argument("--duration", help="m:ss")

    p = sub.add_parser("import", help="import a CSV, TSV or JSON file")
    p.add_argument("file")
    p.add_argument("--update", action="store_true", help="update songs that already exist")

    p = sub.add_parser("list", help="print songs")
    p.add_argument("--key", help="filter by key or Camelot, e.g. 3B or 'Db major'")
    p.add_argument("--search", default="")

    p = sub.add_parser("export", help="write all songs to .csv or a full .json backup")
    p.add_argument("file")

    sub.add_parser("backup", help="snapshot tonal.db into backups/")

    args = ap.parse_args()
    if args.cmd in (None, "serve"):
        return serve(getattr(args, "port", DEFAULT_PORT), getattr(args, "open", False))

    init_db()
    with connect() as conn:
        if args.cmd == "add":
            if args.key and not parse_key(args.key):
                sys.exit(f"Could not understand key '{args.key}'. Try e.g. Am, F#m, 'Eb dorian', 8A.")
            song = normalize_song({"title": args.title, "artist": args.artist, "bpm": args.bpm, "key": args.key,
                                   "notes": args.notes, "tags": args.tags, "energy": args.energy,
                                   "rating": args.rating, "duration": args.duration})
            r = insert_songs(conn, [song])
            key, cam = key_label(song["tonic"], song["mode"])
            print(f"Added: {song['title']} — {song['artist']}  {fmt_bpm(song['bpm']) or '?'} BPM  {key} {cam}"
                  if r["added"] else f"Already in library: {song['title']} — {song['artist']}")
        elif args.cmd == "import":
            rows = read_table_file(args.file)
            r = insert_songs(conn, [normalize_song(x) for x in rows], "update" if args.update else "skip")
            print(f"Added {r['added']}, updated {r['updated']}, skipped {r['skipped']} duplicates.")
            for e in r["errors"]:
                print("  " + e)
        elif args.cmd == "list":
            want = parse_key(args.key) if args.key else None
            want_cam = key_label(*want)[1] if want else None
            for s in list_songs(conn):
                key, cam = key_label(s["tonic"], s["mode"])
                if want_cam and cam != want_cam:
                    continue
                if args.search and args.search.lower() not in f"{s['title']} {s['artist']} {s['tags']}".lower():
                    continue
                print(f"{cam:>4}  {fmt_bpm(s['bpm']):>6}  {key:<20} {s['title']} — {s['artist']}")
        elif args.cmd == "export":
            out = Path(args.file)
            if out.suffix.lower() == ".json":
                out.write_text(json.dumps(full_backup(conn), ensure_ascii=False, indent=2), encoding="utf-8")
            else:
                out.write_text(songs_to_csv(list_songs(conn)), encoding="utf-8")
            print(f"Wrote {out}")
        elif args.cmd == "backup":
            print(f"Saved {backup_db('manual')}")


if __name__ == "__main__":
    main()
