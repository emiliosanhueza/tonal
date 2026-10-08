"""Parse cached GetSongBPM JSON / Hooktheory HTML and print a comparison per song (writes results.json)."""
import sys, json, re, html, unicodedata
from collections import Counter
from pathlib import Path


HERE = Path(sys.argv[1]).resolve()  # work dir containing songs.py; pages are cached in HERE/gs and HERE/ht
sys.path.insert(0, str(HERE))
(HERE / 'gs').mkdir(exist_ok=True); (HERE / 'ht').mkdir(exist_ok=True)
from songs import SONGS
VERSION_WORDS = {"live", "remix", "karaoke", "instrumental", "cover", "acoustic", "demo", "edit", "mix", "version",
                 "extended", "piano", "rehearsal", "session", "sped", "slowed", "reprise", "tribute", "lofi"}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("&", " and ")
    s = re.sub(r"\b(\d{4} )?remaster(ed)?( \d{4})?\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def gs_key(key_of, open_key):
    """'Em' / 'C♯m' / 'Bb' + Open Key '2m' -> ('E minor', '9A'). Either part may be None."""
    key = None
    m = re.match(r"^\s*([A-G])\s*([#♯b♭]?)\s*(maj(?:or)?|m(?:in(?:or)?)?)?(?![a-z])", key_of or "")
    if m:
        acc = {"#": "♯", "b": "♭"}.get(m.group(2), m.group(2))
        key = f"{m.group(1)}{acc} {'minor' if (m.group(3) or '').startswith('m') and not (m.group(3) or '').startswith('maj') else 'major'}"
    cam = None
    m = re.match(r"^\s*(\d{1,2})\s*([md])\s*$", open_key or "")
    if m:  # Open Key 1d = C major = Camelot 8B, 1m = A minor = 8A
        cam = f"{(int(m.group(1)) + 6) % 12 + 1}{'A' if m.group(2) == 'm' else 'B'}"
    return key, cam


def getsongbpm_cards(raw):
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return []
    found = data.get("search") if isinstance(data, dict) else None
    if not isinstance(found, list):  # "no result" comes back as {"search": {"error": ...}}
        return []
    cards = []
    for s in found:
        if not isinstance(s, dict) or "title" not in s:
            continue
        key, cam = gs_key(s.get("key_of"), s.get("open_key"))
        try:
            bpm = int(float(s.get("tempo") or 0)) or None
        except ValueError:
            bpm = None
        cards.append({"artist": (s.get("artist") or {}).get("name", ""), "title": s["title"], "key": key,
                      "bpm": bpm, "camelot": cam, "album": (s.get("album") or {}).get("title"), "url": s.get("uri")})
    return cards


def text(fragment):
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def hooktheory_rows(page):
    """Artist page rows: <a href="/theorytab/view/..">Title</a> … asr-key … asr-scale … asr-tempo."""
    rows = {}
    for m in re.finditer(r'<a href="(/theorytab/view/[^"]+)">(.*?)</a>.*?<td class="asr-key">(.*?)</td>'
                         r'\s*<td class="asr-scale">(.*?)</td>\s*<td class="asr-tempo">(.*?)</td>', page, re.S):
        title, tonic, mode, bpm = text(m.group(2)), text(m.group(3)), text(m.group(4)), text(m.group(5))
        rows[norm(title)] = {"title": title, "tonic": tonic, "mode": mode,
                             "bpm": int(bpm) if bpm.isdigit() else None,
                             "url": "https://www.hooktheory.com" + m.group(1)}
    return rows


results = []
for i, (title, artist, album, dur, fav, core, slug) in enumerate(SONGS):
    want_t, want_a = norm(core), norm(artist.split(" & ")[0])
    wanted_version = set(norm(title).split()) & VERSION_WORDS
    gs_file = HERE / "gs" / f"{i:02d}.json"
    cards = getsongbpm_cards(gs_file.read_text()) if gs_file.exists() else []
    matches = []
    for c in cards:
        ct, ca = norm(c["title"]), norm(c["artist"])
        if want_a not in ca or not ct.startswith(want_t):
            continue
        extra = set(ct[len(want_t):].split()) & VERSION_WORDS
        if extra - wanted_version:
            continue
        matches.append(c)
    # prefer cards that carry the version words we asked for (e.g. "extended", "piano")
    if wanted_version:
        exact = [c for c in matches if wanted_version & set(norm(c["title"]).split())]
        matches = exact or matches
    variants = Counter((c["bpm"], c["key"], c["camelot"]) for c in matches)
    ht_file = HERE / "ht" / f"{slug}.html"
    rows = hooktheory_rows(ht_file.read_text()) if ht_file.exists() else {}
    ht = rows.get(want_t) or next((r for k, r in rows.items() if k.startswith(want_t) or want_t.startswith(k) and len(k) > 5), None)
    results.append({"i": i, "title": title, "artist": artist, "gs_cards": len(cards),
                    "gs": [{"bpm": b, "key": k, "camelot": c, "n": n} for (b, k, c), n in variants.most_common()],
                    "gs_first": matches[0] if matches else None,
                    "ht_page": bool(rows), "ht": ht})
    if not gs_file.exists():
        gs_s = "not fetched"
    else:
        gs_s = "; ".join(f"{v['bpm']} {v['key']} {v['camelot']} x{v['n']}" for v in results[-1]["gs"][:3]) or f"NO MATCH ({len(cards)} results)"
    ht_s = f"{ht['tonic']} {ht['mode']} {ht['bpm']}" if ht else ("—" if rows else "no page")
    print(f"{i:02d} {title[:38]:38} | GS: {gs_s:48} | HT: {ht_s}")

(HERE / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
