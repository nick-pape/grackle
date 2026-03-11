"""Recording control MCP server — stop_recording tool for demo-recorder.

Signals the recording-ctl.sh script to finalize the MP4 by writing a
sentinel file. Includes a fixed 2-second delay for final audio to reach
the PulseAudio sink before stopping.
"""

import asyncio
from pathlib import Path

from fastmcp import FastMCP

mcp = FastMCP("mcp-recording")


@mcp.tool()
async def stop_recording() -> str:
    """Stop the screen recording. Waits a fixed 2 seconds for final audio to reach PulseAudio, then signals ffmpeg to finalize the MP4. Call this as your LAST action when the demo is complete."""
    # Extra buffer for final audio to reach PulseAudio sink
    await asyncio.sleep(2.0)

    try:
        Path("/workspace/stop-recording").write_text("")
        return "Recording stopped. MP4 is being finalized."
    except Exception as exc:
        raise RuntimeError(f"Failed to stop recording: {exc}") from exc


if __name__ == "__main__":
    mcp.run()
