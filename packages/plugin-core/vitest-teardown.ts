export default function (): void {
  setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref();
}
