#!/bin/bash
set -e

# 1. Start Xvfb (virtual X display)
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99
sleep 1

# 2. Start window manager (maximizes browser window, no decorations)
mkdir -p ~/.fluxbox
cat > ~/.fluxbox/apps <<'FLUXEOF'
[app] (.*)
  [Deco] {NONE}
  [Maximized] {yes}
[end]
FLUXEOF
fluxbox &
sleep 1

# 3. Start PulseAudio with virtual sink
pulseaudio --start --exit-idle-time=-1
# Wait for PulseAudio to be ready (daemonizes asynchronously)
for i in $(seq 1 10); do
  pactl info >/dev/null 2>&1 && break
  sleep 0.5
done
# Load virtual sink (idempotent — skip if already loaded)
if ! pactl list short modules 2>/dev/null | grep -q "module-null-sink.*sink_name=virtual_speaker"; then
  pactl load-module module-null-sink sink_name=virtual_speaker
fi
pactl set-default-sink virtual_speaker
pactl set-default-source virtual_speaker.monitor

# 4. Start recording controller (waits for agent to signal start/stop)
/app/recording-ctl.sh &
RECORDING_CTL_PID=$!

# 5. Start PowerLine (not exec, so recording controller stays alive)
node /app/dist/index.js --port=7433 &
POWERLINE_PID=$!

# Wait for PowerLine to exit (keeps container alive and preserves all children)
wait $POWERLINE_PID
POWERLINE_EXIT=$?

# Wait for recording controller to finalize (ffmpeg writes moov atom on shutdown)
wait $RECORDING_CTL_PID 2>/dev/null
RECORDING_EXIT=$?
if [ "$RECORDING_EXIT" -ne 0 ]; then
  echo "[entrypoint] WARNING: recording-ctl exited with status $RECORDING_EXIT — MP4 may be missing or corrupt" >&2
fi

exit $POWERLINE_EXIT
