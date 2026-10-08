#!/bin/bash
# Starts the Tonal engine in the background (if it isn't already running) and opens it in your browser.
#   ./launch.sh         start + open
#   ./launch.sh stop    stop the engine
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://127.0.0.1:$PORT/"

for candidate in /Library/Frameworks/Python.framework/Versions/Current/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$candidate" ]; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then
  osascript -e 'display alert "Tonal needs Python 3" message "Install it from python.org, then open Tonal again."'
  exit 1
fi

running() { /usr/bin/curl -s -o /dev/null --max-time 1 "${URL}api/state"; }

if [ "$1" = "stop" ]; then
  /usr/bin/pkill -f "tonal.py serve --port $PORT" && echo "Tonal stopped." || echo "Tonal wasn't running."
  exit 0
fi

if ! running; then
  nohup "$PY" tonal.py serve --port "$PORT" >> tonal.log 2>&1 &
  for _ in $(seq 1 40); do running && break; sleep 0.25; done
fi

if running; then
  open "$URL"
else
  osascript -e 'display alert "Tonal could not start" message "See tonal.log in the Tonal_Database folder for details."'
  exit 1
fi
