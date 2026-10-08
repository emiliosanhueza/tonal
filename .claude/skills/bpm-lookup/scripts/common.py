"""Shared parsing for fetch.py / parse.py: Hooktheory artist HTML, Tunebat markdown, GetSongBPM JSON, title matching."""
import json, re, html, unicodedata

VERSION_WORDS = {"live", "remix", "karaoke", "instrumental", "cover", "acoustic", "demo", "edit", "mix", "version",
                 "extended", "piano", "rehearsal", "session", "sped", "slowed", "reprise", "tribute", "lofi"}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("&", " and ")
    s = re.sub(r"\b(\d{4} )?remaster(ed)?( \d{4})?\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _text(fragment):
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def hooktheory_rows(page):
    """Artist page rows: <a href="/theorytab/view/..">Title</a> … asr-key … asr-scale … asr-tempo."""
    rows = {}
    for m in re.finditer(r'<a href="(/theorytab/view/[^"]+)">(.*?)</a>.*?<td class="asr-key">(.*?)</td>'
                         r'\s*<td class="asr-scale">(.*?)</td>\s*<td class="asr-tempo">(.*?)</td>', page, re.S):
        title, tonic, mode, bpm = _text(m.group(2)), _text(m.group(3)), _text(m.group(4)), _text(m.group(5))
        rows[norm(title)] = {"title": title, "tonic": tonic, "mode": mode,
                             "bpm": int(bpm) if bpm.isdigit() else None,
                             "url": "https://www.hooktheory.com" + m.group(1)}
    return rows


def hooktheory_match(rows, core):
    want_t = norm(core)
    return rows.get(want_t) or next((r for k, r in rows.items() if k.startswith(want_t) or want_t.startswith(k) and len(k) > 5), None)


def tunebat_cards(md):
    """Result cards from a Firecrawl markdown scrape of https://tunebat.com/Search?q=…"""
    cards = []
    for chunk in md.split("](https://tunebat.com/Info/")[:-1]:
        lines = [l.strip().rstrip("\\").strip() for l in chunk.split("\n")]
        lines = [l for l in lines if l]
        if "Key" not in lines:
            continue
        i = len(lines) - 1 - lines[::-1].index("Key")
        try:
            cards.append({"artist": lines[i - 3], "title": lines[i - 2], "key": lines[i - 1],
                          "bpm": int(lines[i + 1]), "camelot": lines[i + 3]})
        except (IndexError, ValueError):
            pass
    return cards


def gs_key(key_of, open_key):
    """'Em' / 'C♯m' / 'Bb' + Open Key '2m' -> ('E minor', '9A'). Either part may be None."""
    key = None
    m = re.match(r"^\s*([A-G])\s*([#♯b♭]?)\s*(maj(?:or)?|m(?:in(?:or)?)?)?(?![a-z])", key_of or "")
    if m:
        acc = {"#": "♯", "b": "♭"}.get(m.group(2), m.group(2))
        q = m.group(3) or ""
        key = f"{m.group(1)}{acc} {'minor' if q.startswith('m') and not q.startswith('maj') else 'major'}"
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


def match_cards(cards, title, artist, core):
    """Cards for the same song and version: artist contains the main artist, title starts with the core title,
    no version words we didn't ask for; cards carrying the version words we did ask for win."""
    want_t, want_a = norm(core), norm(artist.split(" & ")[0])
    wanted_version = set(norm(title).split()) & VERSION_WORDS
    matches = []
    for c in cards:
        ct, ca = norm(c["title"]), norm(c["artist"])
        if want_a not in ca or not ct.startswith(want_t):
            continue
        if (set(ct[len(want_t):].split()) & VERSION_WORDS) - wanted_version:
            continue
        matches.append(c)
    if wanted_version:
        exact = [c for c in matches if wanted_version & set(norm(c["title"]).split())]
        matches = exact or matches
    return matches
