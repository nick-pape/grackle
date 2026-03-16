import type { Command } from "commander";
import chalk from "chalk";
import { createGrackleClient } from "../client.js";

/** Register the `pair` command that generates a new pairing code for web UI access. */
export function registerPairCommand(program: Command): void {
  program
    .command("pair")
    .description("Generate a new pairing code for the web UI")
    .action(async () => {
      const client = createGrackleClient();
      const response = await client.generatePairingCode({});

      console.log("");
      console.log(chalk.bold("  Pairing code: ") + chalk.cyan(response.code));
      console.log(chalk.bold("  URL: ") + response.url);
      console.log("");

      // Print QR code (best-effort)
      try {
        const qrcode = await import("qrcode");
        const qr = await qrcode.toString(response.url, { type: "terminal", small: true });
        console.log(qr);
      } catch {
        // qrcode not installed — skip QR
      }

      console.log(chalk.dim("  Code expires in 5 minutes."));
      console.log("");
    });
}
