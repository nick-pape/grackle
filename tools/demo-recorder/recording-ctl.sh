#!/bin/bash
set -uo pipefail
# Recording controller daemon — auto-starts recording when Chrome launches.
# Stops when the Claude Code session ends (PowerLine exits or stop signal).

OUTFILE="/workspace/grackle-demo.mp4"

echo "[recording-ctl] Waiting for Chrome to launch..."

# Wait for Playwright's Chrome to appear (timeout after 120s)
CHROME_WAIT_TIMEOUT="${CHROME_WAIT_TIMEOUT:-120}"
start_time=$(date +%s)
while ! pgrep -f "chrome.*remote-debugging" > /dev/null 2>&1; do
  elapsed=$(( $(date +%s) - start_time ))
  if [ "$elapsed" -ge "$CHROME_WAIT_TIMEOUT" ]; then
    echo "[recording-ctl] ERROR: Chrome not detected within ${CHROME_WAIT_TIMEOUT}s. Aborting." >&2
    exit 1
  fi
  sleep 0.5
done

# Give the page a moment to render
sleep 2

echo "[recording-ctl] Chrome detected. Starting ffmpeg recording -> $OUTFILE"

# Start ffmpeg with stdin from a named pipe for graceful 'q' shutdown
rm -f /tmp/ffmpeg-input
mkfifo /tmp/ffmpeg-input
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i default \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -y "$OUTFILE" < /tmp/ffmpeg-input > /tmp/ffmpeg.log 2>&1 &
FFPID=$!
echo $FFPID > /tmp/ffmpeg.pid

# Keep the write end of the pipe open so ffmpeg doesn't get EOF
exec 3>/tmp/ffmpeg-input

echo "[recording-ctl] Recording started (PID $FFPID)"

# Wait for stop signal OR for PowerLine to exit
while true; do
  # Check for explicit stop signal
  if [ -f /tmp/stop-recording ] || [ -f /workspace/stop-recording ]; then
    echo "[recording-ctl] Stop signal detected"
    rm -f /tmp/stop-recording /workspace/stop-recording
    break
  fi
  # Check if ffmpeg died on its own
  if ! kill -0 $FFPID 2>/dev/null; then
    echo "[recording-ctl] ffmpeg exited unexpectedly"
    cat /tmp/ffmpeg.log 2>/dev/null
    break
  fi
  # Check if PowerLine is still running (container shutting down)
  if ! pgrep -f "node.*dist/index.js" > /dev/null 2>&1; then
    echo "[recording-ctl] PowerLine exited, stopping recording"
    break
  fi
  sleep 1
done

echo "[recording-ctl] Stopping ffmpeg gracefully..."
# Send 'q' to ffmpeg via the named pipe for clean shutdown (writes moov atom)
echo q >&3
exec 3>&-
rm -f /tmp/ffmpeg-input

# Wait for ffmpeg to finish writing
wait $FFPID 2>/dev/null
sleep 1

echo "[recording-ctl] Recording complete."
ls -lh "$OUTFILE" 2>/dev/null
