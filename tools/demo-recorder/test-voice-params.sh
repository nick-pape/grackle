#!/usr/bin/env bash
# test-voice-params.sh — Generate test WAVs to evaluate prefix and tempo variants
#
# Usage: ./test-voice-params.sh [POCKETTTS_URL]
#
# Requires:
#   1. PocketTTS running on localhost:8890
# Output: test-output/ directory with WAV files for each variant.

set -euo pipefail

POCKETTTS_URL="${1:-http://localhost:8890}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTDIR="${SCRIPT_DIR}/test-output"

mkdir -p "$OUTDIR"

MALE_VOICE="marius"
FEMALE_VOICE="alba"

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

declare -A VOICES=(
  ["male"]="$MALE_VOICE"
  ["female"]="$FEMALE_VOICE"
)

echo "=== Generating prefix variant test WAVs ==="
for voice_name in male female; do
  voice="${VOICES[$voice_name]}"
  for prefix_name in none ellipsis comma period space hmm; do
    prefix="${PREFIXES[$prefix_name]}"
    outfile="${OUTDIR}/${voice_name}_prefix-${prefix_name}.wav"
    full_text="${prefix}${TEST_TEXT}"
    echo "  ${voice_name} / prefix=${prefix_name} -> $(basename "$outfile")"
    curl -s -X POST "${POCKETTTS_URL}/tts" \
      -F "text=${full_text}" \
      -F "voice_url=${voice}" \
      -o "$outfile" \
      -w "    [%{http_code} %{size_download}B]\n" || echo "    FAILED"
  done
done

# ── Tempo variants (female only) ────────────────────────────
echo ""
echo "=== Generating tempo variant test WAVs (female) ==="
TEMPOS=("1.00" "1.02" "1.04" "1.06")

# Synthesize one base WAV, then apply different tempos via ffmpeg
base_file="${OUTDIR}/_female_tempo-base.wav"
echo "  Synthesizing base WAV for tempo tests..."
curl -s -X POST "${POCKETTTS_URL}/tts" \
  -F "text=${TEST_TEXT}" \
  -F "voice_url=${FEMALE_VOICE}" \
  -o "$base_file" \
  -w "    [%{http_code} %{size_download}B]\n" || { echo "  SYNTH FAILED"; exit 1; }

for tempo in "${TEMPOS[@]}"; do
  outfile="${OUTDIR}/female_tempo-${tempo}.wav"
  echo "  female / tempo=${tempo} -> $(basename "$outfile")"
  ffmpeg -y -i "$base_file" -af "atempo=${tempo}" "$outfile" 2>/dev/null || echo "    FFMPEG FAILED"
done
rm -f "$base_file"

echo ""
echo "=== Done. Test files in ${OUTDIR}/ ==="
echo "Listen and pick: (a) best prefix per voice, (b) best female tempo"
echo ""
ls -lhS "$OUTDIR"/*.wav 2>/dev/null || echo "(no WAV files generated)"
