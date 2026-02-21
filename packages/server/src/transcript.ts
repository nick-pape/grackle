import { readLog, type LogEntry } from "./log-writer.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

function renderEntry(entry: LogEntry): string {
  switch (entry.type) {
    case "system":
      return `> _${entry.content}_\n`;
    case "text":
      return `${entry.content}\n`;
    case "tool_use": {
      try {
        const parsed = JSON.parse(entry.content);
        return `\`\`\`\n${parsed.tool}: ${JSON.stringify(parsed.args, null, 2)}\n\`\`\`\n`;
      } catch {
        return `\`\`\`\n${entry.content}\n\`\`\`\n`;
      }
    }
    case "tool_result":
      return `<details>\n<summary>Tool output</summary>\n\n\`\`\`\n${entry.content}\n\`\`\`\n</details>\n`;
    case "error":
      return `**Error:** ${entry.content}\n`;
    case "status":
      return `---\n*Status: ${entry.content}*\n`;
    default:
      return `${entry.content}\n`;
  }
}

/** Generate a Markdown transcript from a session's JSONL log. */
export function generateTranscript(logPath: string): string {
  const entries = readLog(logPath);
  if (entries.length === 0) return "*(empty session)*\n";

  const lines: string[] = [];
  lines.push(`# Session Transcript\n`);
  lines.push(`*Started: ${entries[0].timestamp}*\n`);

  for (const entry of entries) {
    lines.push(renderEntry(entry));
  }

  const last = entries[entries.length - 1];
  lines.push(`\n*Ended: ${last.timestamp}*\n`);

  return lines.join("\n");
}

/** Generate and write a Markdown transcript file alongside the session log. */
export function writeTranscript(logPath: string): void {
  const md = generateTranscript(logPath);
  const transcriptPath = join(logPath, "transcript.md");
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, md, "utf8");
}
