export default function (): void {
  // Force-exit after 10s as a hang safety net for the better-sqlite3 native addon,
  // which cannot be unloaded and may prevent the worker from idle-exiting.
  // .unref() means normal exits (including coverage writes) happen first;
  // this only fires if the process genuinely hangs.
  setTimeout(() => process.exit(process.exitCode ?? 0), 10000).unref();
}
