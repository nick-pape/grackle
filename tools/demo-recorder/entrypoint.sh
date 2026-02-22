#!/bin/bash
set -e

# 1. Start Xvfb (virtual X display)
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99
sleep 1

# 2. Start window manager (maximizes browser window)
fluxbox &
sleep 1

# 3. Start PulseAudio with virtual sink
pulseaudio --start --exit-idle-time=-1
pactl load-module module-null-sink sink_name=virtual_speaker
pactl set-default-sink virtual_speaker
pactl set-default-source virtual_speaker.monitor

# 4. Start PocketTTS HTTP server (with GPU acceleration if available)
/opt/pockettts/bin/python /app/pockettts-gpu-serve.py &

# 4b. Serve pre-exported voice safetensors over HTTP (PocketTTS voice_url requires http://)
python3 -m http.server 8891 --directory /app/voices &

# 5. Start recording controller (waits for agent to signal start/stop)
/app/recording-ctl.sh &
RECORDING_CTL_PID=$!

# 6. Start PowerLine (not exec, so recording controller stays alive)
node /app/dist/index.js --port=7433 &
POWERLINE_PID=$!

# Wait for PowerLine to exit (keeps container alive and preserves all children)
wait $POWERLINE_PID
