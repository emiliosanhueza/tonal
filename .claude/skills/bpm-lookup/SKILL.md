---
name: bpm-lookup
description: Find BPM, key and mode for songs (from a list, screenshot or playlist) using Hooktheory and the GetSongBPM API, cross-check them, and add them to the Tonal database. Use whenever the user wants songs added to Tonal without BPM/key, or asks to look up / verify BPM or key.
---

# BPM & key lookup for Tonal

Goal: for each song, get a **BPM** and a **key + mode**, note where they came from, and import them into Tonal (`tonal.db`) with `python3 tonal.py import`.

## Sources, in order of trust

No Firecrawl: both sources are read over plain HTTP (curl) by the scripts below, at no credit cost.

1. **Hooktheory TheoryTab**: human-transcribed. Best for **mode** (Mixolydian, Dorian…) and the **felt tempo**. Only covers well-known songs.
   - Artist index, served as plain HTML (no Cloudflare): `https://www.hooktheory.com/theorytab/artist/<artist-slug>` (e.g. `taylor-swift`, `haim`, `sabrina-carpenter`). One page lists every analysed song with tonic, mode and BPM (Taylor Swift: 238 songs). An unknown slug returns 404.
   - Unsure of a slug? `curl -s -o /dev/null -w "%{http_code}" https://www.hooktheory.com/theorytab/artist/<guess>` and look for 200.
2. **GetSongBPM API** (`https://api.getsong.co`): free, needs an API key. The scripts read it from env `GETSONGBPM_API_KEY` or from the file `.getsongbpm_key` in the Tonal project folder. Never print the key. Limit: 3000 requests/hour. Covers many songs, but gives major/minor only (no modes) and sometimes doubles or halves the tempo. Their terms require a backlink to getsongbpm.com.
   - Search: `/search/?type=both&lookup=song:<title> artist:<artist>` with header `X-API-KEY`. Results carry `tempo`, `key_of` (e.g. `Em`, `F#`) and `open_key` (e.g. `2m`); parse.py turns these into `E minor` and Camelot `9A`.
3. **Not usable from scripts:** Tunebat, songdata.io, musicstax and the getsongbpm.com / getsongkey.com web pages all sit behind a Cloudflare bot check. They returned 403 to curl, to Playwright in both headless and visible modes, and to the built-in browser pane. Don't try to get around it. songbpm.com returns 404. If the user wants a Tunebat value for one song, ask them to look it up in their own browser.
4. Very small acts (e.g. "Young Dreams" by Young Dreams) may be on neither source. Import without BPM or key and say so.

## Lookup steps (any number of songs, including one)

1. Make a work dir in the scratchpad and write `songs.py` there:
   `SONGS = [(title, artist, album, "m:ss", favorite_bool, core_title_for_matching, hooktheory_artist_slug), ...]`
   `core_title` drops "(2012 Remaster)", "(feat. …)" and punctuation. Keep version words such as "Extended" or "Piano" in the full title: the parser prefers results that carry them and rejects remix/live/etc. results you didn't ask for.
2. `python3 .claude/skills/bpm-lookup/scripts/fetch.py <workdir>`: run big batches in the background. It fetches one GetSongBPM search per song (1.5 s apart) and one Hooktheory artist page per artist (2 s apart), and caches them in `gs/` and `ht/`. Without an API key it warns and fetches Hooktheory only. A 401 stops it, which means the key is wrong or not yet activated.
3. `python3 .claude/skills/bpm-lookup/scripts/parse.py <workdir>` prints `GS: bpm key camelot xN | HT: tonic mode bpm` per song and writes `results.json` (Hooktheory rows include the song page `url`). "no page" means Hooktheory doesn't have the artist; "—" means it has the artist but not the song; "not fetched" means there was no API key.
4. Make decisions per the rules below and write the CSV (add a `Length` column from the screenshot durations).

Hooktheory modes can include "Harmonic Minor", which Tonal doesn't have, so import it as minor and mention it in notes.

## Verification rules (do not skip)

- **Match the exact version.** Remix, live, VIP, radio edit, Taylor's Version, karaoke and "feat." versions differ in key and tempo. Pick the result whose title matches the user's version. GetSongBPM can list several releases of the same recording; agreement between them is fine, but they are not independent sources.
- **Hooktheory "Running" ≠ "Running (Disclosure Remix)"**: an original's analysis does not apply to a remix.
- **Half/double tempo:** if GetSongBPM and Hooktheory differ by about 2×, they are counting the same beat. Prefer Hooktheory's felt tempo for ballads and mid-tempo songs (e.g. Ruin The Friendship: Hooktheory 80, Spotify-based sites 160 → 80). Keep the higher value for dance tracks or where DJ databases agree (Bad Blood: 170, Hooktheory says 85). Mention the other value in notes. Tonal's half/double-time matching covers either way.
- **Single-source and suspicious values:** with only GetSongBPM, and a BPM ≥ 150 or ≤ 70 on a pop or indie song, keep the value but note "may feel like X" so the user can check with Tap tempo.
- **Mode:** if Hooktheory gives a mode, use it (e.g. D Mixolydian). GetSongBPM's major/minor answer is then usually the relative key on the same Camelot number (G major ↔ D Mixolydian), which confirms it.
- **GetSongBPM keys vs Hooktheory:** they often differ by one Camelot step. Usually Hooktheory says D major or D Mixolydian where the database says G major. When Hooktheory has the song, use its key and mode and put GetSongBPM's in notes.
- **Live, orchestral or rubato versions** (e.g. "Distant Worlds" concert recordings): tempos across releases scatter widely. Leave BPM blank and keep only a key you trust.
- Never invent a value. If nothing reliable is found, import the song without BPM or key and say so.

## Adding to Tonal

1. Write a CSV in the scratchpad with columns `Title,Artist,BPM,Key,Tags,Notes`.
   - `Key` in plain form: `E minor`, `G major`, `D mixolydian` (Tonal's parser accepts all of these).
   - `Notes`: album, then the sources, e.g. `Settle (Deluxe). GetSongBPM 125 BPM, E minor (9A).` Name every source and any disagreement.
   - `Tags`: `favorite` for songs the user starred or hearted in Apple Music or Spotify.
2. Import from the project folder: `python3 tonal.py import <file.csv>`. Duplicates are skipped. Use `--update` only when the user wants existing entries refreshed.
3. Check with `python3 tonal.py list --search "<artist>"`. Tell the user to reload the Tonal tab (the running server reads the same database, so no restart is needed).
4. Report to the user: a table of title, BPM, key, Camelot and source, plus a short list of values worth checking by ear.
