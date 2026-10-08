"""Parse cached Hooktheory HTML / GetSongBPM JSON / Tunebat markdown and print a comparison per song (writes results.json)."""
import sys, json
from collections import Counter
from pathlib import Path
from common import hooktheory_rows, hooktheory_match, getsongbpm_cards, tunebat_cards, match_cards


HERE = Path(sys.argv[1]).resolve()  # work dir containing songs.py; pages are cached in HERE/ht, HERE/gs, HERE/tb
sys.path.insert(0, str(HERE))
from songs import SONGS


def summary(variants):
    return [{"bpm": b, "key": k, "camelot": c, "n": n} for (b, k, c), n in variants.most_common()]


def show(f, vs, n_cards):
    if not f.exists():
        return None
    return "; ".join(f"{v['bpm']} {v['key']} {v['camelot']} x{v['n']}" for v in vs[:3]) or f"NO MATCH ({n_cards})"


results = []
for i, (title, artist, album, dur, fav, core, slug) in enumerate(SONGS):
    ht_file = HERE / "ht" / f"{slug}.html"
    rows = hooktheory_rows(ht_file.read_text()) if ht_file.exists() else {}
    ht = hooktheory_match(rows, core)
    out = {"i": i, "title": title, "artist": artist, "ht_page": bool(rows), "ht": ht}
    lines = []
    for src, f, cards_of in (("gs", HERE / "gs" / f"{i:02d}.json", getsongbpm_cards), ("tb", HERE / "tb" / f"{i:02d}.md", tunebat_cards)):
        cards = cards_of(f.read_text()) if f.exists() else []
        matches = match_cards(cards, title, artist, core)
        out[src] = summary(Counter((c["bpm"], c["key"], c["camelot"]) for c in matches))
        out[src + "_first"] = matches[0] if matches else None
        s = show(f, out[src], len(cards))
        if s:
            lines.append(f"{src.upper()}: {s}")
    results.append(out)
    ht_s = f"{ht['tonic']} {ht['mode']} {ht['bpm']}" if ht else ("—" if rows else "no page")
    print(f"{i:02d} {title[:38]:38} | HT: {ht_s:24} | {' | '.join(lines) or 'no fallback fetched'}")

(HERE / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
