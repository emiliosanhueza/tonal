---
name: bpm-lookup
description: Find BPM, key and mode for songs (from a list, screenshot or playlist) using Hooktheory (free) with Tunebat via Firecrawl as fallback, cross-check them, and add them to the Tonal database. Use whenever the user wants songs added to Tonal without BPM/key, or asks to look up / verify BPM or key.
---

# BPM & key lookup for Tonal

Goal: for each song, get a **BPM** and a **key + mode**, note where they came from, and import them into Tonal (`tonal.db`) with `python3 tonal.py import`.

## Sources, in order of trust

Hooktheory goes first for every song, for free. Firecrawl (Tunebat) is used **only for songs Hooktheory doesn't have**, mostly small Nordic and indie releases, at about 1 credit each. Credits are limited (check with `firecrawl --status`), so don't scrape Tunebat for songs Hooktheory already covers unless the user asks for a cross-check.

1. **Hooktheory TheoryTab**: human-transcribed. Best for **mode** (Mixolydian, Dorian…) and the **felt tempo**. Covers well-known songs.
   - Artist index, served as plain HTML over curl (no Cloudflare, no Firecrawl): `https://www.hooktheory.com/theorytab/artist/<artist-slug>` (e.g. `taylor-swift`, `haim`, `sabrina-carpenter`). One page lists every analysed song with tonic, mode and BPM (Taylor Swift: 238 songs). An unknown slug returns 404.
   - Unsure of a slug? `curl -s -o /dev/null -w "%{http_code}" https://www.hooktheory.com/theorytab/artist/<guess>` and look for 200.
2. **Tunebat**, fallback only, through the `firecrawl` CLI (logged in; plain markdown scrape = 1 credit; never use JSON extraction, which costs 5). This is Spotify's audio analysis, so it covers almost everything. Gives major/minor only and sometimes doubles or halves the tempo. Tunebat blocks curl and Playwright with Cloudflare, so Firecrawl is the only way in. Don't try to get around the block.
   - Search: `https://tunebat.com/Search?q=<title> <artist>`.
3. **GetSongBPM API** (`https://api.getsong.co`), dormant: their key signup said "service currently unavailable" on 2026-10-08. The code is ready. If the user later saves a key in `.getsongbpm_key` (project folder) or env `GETSONGBPM_API_KEY`, fetch.py asks the API first for songs Hooktheory doesn't have, and sends only the songs the API doesn't match on to Tunebat. The backlink page is https://github.com/emiliosanhueza/tonal. Never print the key.
4. Not usable: songdata.io, musicstax, getsongbpm.com / getsongkey.com web pages (Cloudflare), songbpm.com (404).
5. Very small acts (e.g. "Young Dreams" by Young Dreams) may be on neither site. Import without BPM or key and say so.

## Lookup steps (any number of songs, including one)

1. Make a work dir in the scratchpad and write `songs.py` there:
   `SONGS = [(title, artist, album, "m:ss", favorite_bool, core_title_for_matching, hooktheory_artist_slug), ...]`
   `core_title` drops "(2012 Remaster)", "(feat. …)" and punctuation. Keep version words such as "Extended" or "Piano" in the full title: the parser prefers results that carry them and rejects remix/live/etc. results you didn't ask for.
2. `python3 .claude/skills/bpm-lookup/scripts/fetch.py <workdir>`: run big batches in the background. It fetches every Hooktheory artist page (2 s apart), works out which songs Hooktheory lacks, prints how many credits Tunebat will use, then scrapes only those (~6.5 s apart, the rate limit is about 10/minute). Everything is cached in `ht/`, `gs/` and `tb/`, so re-runs are free.
   - `--no-tunebat`: Hooktheory (and the API) only, no credits spent.
   - `--tunebat-all`: also scrape Tunebat for songs Hooktheory has (a cross-check; costs a credit per song). Only when the user asks.
3. `python3 .claude/skills/bpm-lookup/scripts/parse.py <workdir>` prints `HT: tonic mode bpm | TB: bpm key camelot xN` per song and writes `results.json` (Hooktheory rows include the song page `url`). "no page" means Hooktheory doesn't have the artist; "—" means it has the artist but not the song; "NO MATCH (n)" means Tunebat had n results but none for this artist and version.
4. Make decisions per the rules below and write the CSV (add a `Length` column from the screenshot durations).

Hooktheory modes can include "Harmonic Minor", which Tonal doesn't have, so import it as minor and mention it in notes. Shared parsing lives in `scripts/common.py`.

## Verification rules (do not skip)

- **Match the exact version.** Remix, live, VIP, radio edit, Taylor's Version, karaoke and "feat." versions differ in key and tempo. Pick the result whose title matches the user's version. Tunebat lists several releases of the same recording; agreement between them is fine, but they are not independent sources.
- **Hooktheory "Running" ≠ "Running (Disclosure Remix)"**: an original's analysis does not apply to a remix.
- **Hooktheory-only songs are the normal case now.** Use its key, mode and BPM as is; there's no second source unless the user asked for `--tunebat-all`.
- **Half/double tempo:** if Tunebat (or GetSongBPM) and Hooktheory differ by about 2×, they are counting the same beat. Prefer Hooktheory's felt tempo for ballads and mid-tempo songs (e.g. Ruin The Friendship: Hooktheory 80, Tunebat 160 → 80). Keep the higher value for dance tracks or where DJ databases agree (Bad Blood: 170, Hooktheory says 85). Mention the other value in notes. Tonal's half/double-time matching covers either way.
- **Single-source and suspicious values:** with only Tunebat (or GetSongBPM), and a BPM ≥ 150 or ≤ 70 on a pop or indie song, keep the value but note "may feel like X" so the user can check with Tap tempo.
- **Mode:** if Hooktheory gives a mode, use it (e.g. D Mixolydian). Tunebat's major/minor answer is then usually the relative key on the same Camelot number (G major ↔ D Mixolydian), which confirms it.
- **Tunebat keys vs Hooktheory (when both exist):** they often differ by one Camelot step. Usually Hooktheory says D major or D Mixolydian where the database says G major. When Hooktheory has the song, use its key and mode and put Tunebat's in notes.
- **Live, orchestral or rubato versions** (e.g. "Distant Worlds" concert recordings): tempos across releases scatter widely. Leave BPM blank and keep only a key you trust.
- Never invent a value. If nothing reliable is found, import the song without BPM or key and say so.

## Adding to Tonal

1. Write a CSV in the scratchpad with columns `Title,Artist,BPM,Key,Tags,Notes`.
   - `Key` in plain form: `E minor`, `G major`, `D mixolydian` (Tonal's parser accepts all of these).
   - `Notes`: album, then the sources, e.g. `Settle (Deluxe). Tunebat 125 BPM, E minor (9A).` or `Hooktheory 80 BPM, D Mixolydian.` Name every source and any disagreement.
   - `Tags`: `favorite` for songs the user starred or hearted in Apple Music or Spotify.
2. Import from the project folder: `python3 tonal.py import <file.csv>`. Duplicates are skipped. Use `--update` only when the user wants existing entries refreshed.
3. Check with `python3 tonal.py list --search "<artist>"`. Tell the user to reload the Tonal tab (the running server reads the same database, so no restart is needed).
4. Report to the user: a table of title, BPM, key, Camelot and source, plus a short list of values worth checking by ear.
