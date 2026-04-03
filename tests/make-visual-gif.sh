#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="artifacts/screenshots"
GIF_OUT="artifacts/zk-proof-lab-preview.gif"

if [[ ! -d "$OUT_DIR" ]]; then
  echo "No screenshots directory found at $OUT_DIR; skipping GIF generation."
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not available; skipping GIF generation."
  exit 0
fi

TMP_LIST="artifacts/.gif-inputs.txt"
find "$OUT_DIR" -maxdepth 1 -name "*-desktop.png" | sort > "$TMP_LIST"

if [[ ! -s "$TMP_LIST" ]]; then
  echo "No desktop screenshots found; skipping GIF generation."
  rm -f "$TMP_LIST"
  exit 0
fi

rm -f "$GIF_OUT"

ffmpeg -y -f concat -safe 0 -i <(
  while IFS= read -r img; do
    printf "file '%s'\n" "$img"
    printf "duration 1\n"
  done < "$TMP_LIST"
) -vf "fps=10,scale=960:-1:flags=lanczos" "$GIF_OUT" >/dev/null 2>&1 || {
  echo "ffmpeg failed; skipping GIF output."
  rm -f "$TMP_LIST"
  exit 0
}

rm -f "$TMP_LIST"
echo "Created $GIF_OUT"
