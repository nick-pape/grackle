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

# 4. Start PocketTTS HTTP server
/opt/pockettts/bin/pocket-tts serve --port 8890 &

# 5. Start ffmpeg recording in background (agent just needs to stop it)
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i default \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -movflags frag_keyframe+empty_moov \
  -y /workspace/grackle-demo.mp4 &
echo $! > /tmp/ffmpeg.pid
echo "ffmpeg recording started with PID $(cat /tmp/ffmpeg.pid)"

# 6. Start PowerLine
exec node /app/dist/index.js --port=7433
