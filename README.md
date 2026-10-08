# tonal

personal project: key and bpm database for music i like

Tonal is a small local app for logging songs with their BPM and key, then building harmonically compatible, beatmatched playlists (Camelot wheel, all seven modes, half/double-time matching). Everything runs on your own Mac: a stdlib Python server with SQLite and a plain HTML/JS front end.

## Run it

Double-click `Tonal.app` or `Start Tonal.command`, or:

```bash
./launch.sh          # start and open http://127.0.0.1:8765/
./launch.sh stop     # stop
```

Command line:

```bash
python3 tonal.py add ...          # add one song
python3 tonal.py import file.csv  # import CSV, TSV or JSON
python3 tonal.py list --search "artist"
python3 tonal.py export songs.csv
python3 tonal.py backup
```

The database (`tonal.db`) and `backups/` are kept local and not committed.

## Data sources

- Key, mode and felt-tempo analyses from [Hooktheory TheoryTab](https://www.hooktheory.com/theorytab), used first for every song.
- For songs Hooktheory doesn't cover: [Tunebat](https://tunebat.com) (Spotify audio analysis), fetched through [Firecrawl](https://firecrawl.dev).
- Optional: BPM and key data from [GetSongBPM](https://getsongbpm.com) via the [GetSongBPM API](https://getsongbpm.com/api), used when an API key is configured.

Lookups are done by the scripts in `.claude/skills/bpm-lookup/`. The GetSongBPM API key is read from the `GETSONGBPM_API_KEY` environment variable or a local `.getsongbpm_key` file, which is git-ignored.
