export default function (): void {
  setTimeout(() => process.exit(0), 1000).unref();
}
