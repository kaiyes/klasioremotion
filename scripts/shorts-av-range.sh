#!/bin/bash
set -e

START=${1:-120}
END=${2:-}
WORDS_FILE="source_content/all_anime_top_2000.match.first2000.json"
OUT_DIR="out/shorts"
BACKUP_DIR="out/testEval"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$WORDS_FILE" ]; then
  echo "Error: $WORDS_FILE not found"
  exit 1
fi

TOTAL=$(jq 'length' "$WORDS_FILE")
if [ -z "$END" ]; then
  END=$TOTAL
fi

echo "Processing words $START to $END (of $TOTAL)"
echo "Backing up to: $BACKUP_DIR"

for i in $(seq $START $END); do
  WORD=$(jq -r ".[$i-1].word" "$WORDS_FILE")
  echo ""
  echo "========================================"
  echo "[$i/$END] Processing: $WORD"
  echo "========================================"
  
  npm run -s shorts:av:one -- --query "$WORD" --keepOutputs || echo "FAILED: $WORD (continuing...)"
  
  # Copy generated files to backup dir (keep original)
  if ls $OUT_DIR/*.mp4 1> /dev/null 2>&1; then
    echo "Copying files to $BACKUP_DIR..."
    cp $OUT_DIR/*.mp4 "$BACKUP_DIR/" 2>/dev/null || true
  fi
  
  sleep 10
done

echo "Done! Files saved to: $BACKUP_DIR"
