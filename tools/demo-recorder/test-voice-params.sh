#!/usr/bin/env bash
# test-voice-params.sh — Generate test WAVs to evaluate prefix and tempo variants
#
# Usage: ./test-voice-params.sh [POCKETTTS_URL] [VOICE_SERVER_PORT]
#
# Requires:
#   1. PocketTTS running on localhost:8890
#   2. Pre-exported safetensors served on localhost:VOICE_SERVER_PORT (default 8891)
#      (Start with: node -e "..." or copy from Docker container)
# Output: test-output/ directory with WAV files for each variant.

set -euo pipefail

POCKETTTS_URL="${1:-http://localhost:8890}"
VOICE_SERVER_PORT="${2:-8891}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTDIR="${SCRIPT_DIR}/test-output"

mkdir -p "$OUTDIR"

SNOOP_VOICE="http://localhost:${VOICE_SERVER_PORT}/snoop.safetensors"
CUMBERBATCH_VOICE="http://localhost:${VOICE_SERVER_PORT}/cumberbatch.safetensors"

# Verify voice server is reachable
echo "Checking voice server on port ${VOICE_SERVER_PORT}..."
curl -s -o /dev/null -w "  snoop.safetensors: HTTP %{http_code} (%{size_download}B)\n" "${SNOOP_VOICE}"
curl -s -o /dev/null -w "  cumberbatch.safetensors: HTTP %{http_code} (%{size_download}B)\n" "${CUMBERBATCH_VOICE}"
echo ""

TEST_TEXT="Welcome to this demonstration of Grackle, an open source tool for multi-agent coordination."

# ── Prefix variants ──────────────────────────────────────────
declare -A PREFIXES=(
  ["none"]=""
  ["ellipsis"]="... "
  ["comma"]=", "
  ["period"]=". "
  ["space"]=" "
  ["hmm"]="hmm "
)

declare -A VOICE_URLS=(
  ["snoop"]="$SNOOP_VOICE"
  ["cumberbatch"]="$CUMBERBATCH_VOICE"
)

echo "=== Generating prefix variant test WAVs ==="
for voice in snoop cumberbatch; do
  voice_url="${VOICE_URLS[$voice]}"
  for prefix_name in none ellipsis comma period space hmm; do
    prefix="${PREFIXES[$prefix_name]}"
    outfile="${OUTDIR}/${voice}_prefix-${prefix_name}.wav"
    full_text="${prefix}${TEST_TEXT}"
    echo "  ${voice} / prefix=${prefix_name} -> $(basename "$outfile")"
    curl -s -X POST "${POCKETTTS_URL}/tts" \
      -F "text=${full_text}" \
      -F "voice_url=${voice_url}" \
      -o "$outfile" \
      -w "    [%{http_code} %{size_download}B]\n" || echo "    FAILED"
  done
done

# ── Tempo variants (Cumberbatch only) ────────────────────────
echo ""
echo "=== Generating tempo variant test WAVs (Cumberbatch) ==="
TEMPOS=("1.00" "1.02" "1.04" "1.06")

# Synthesize one base WAV, then apply different tempos via ffmpeg
base_file="${OUTDIR}/_cumberbatch_tempo-base.wav"
echo "  Synthesizing base WAV for tempo tests..."
curl -s -X POST "${POCKETTTS_URL}/tts" \
  -F "text=${TEST_TEXT}" \
  -F "voice_url=${CUMBERBATCH_VOICE}" \
  -o "$base_file" \
  -w "    [%{http_code} %{size_download}B]\n" || { echo "  SYNTH FAILED"; exit 1; }

for tempo in "${TEMPOS[@]}"; do
  outfile="${OUTDIR}/cumberbatch_tempo-${tempo}.wav"
  echo "  cumberbatch / tempo=${tempo} -> $(basename "$outfile")"
  ffmpeg -y -i "$base_file" -af "atempo=${tempo}" "$outfile" 2>/dev/null || echo "    FFMPEG FAILED"
done
rm -f "$base_file"

echo ""
echo "=== Done. Test files in ${OUTDIR}/ ==="
echo "Listen and pick: (a) best prefix per voice, (b) best Cumberbatch tempo"
echo ""
ls -lhS "$OUTDIR"/*.wav 2>/dev/null
