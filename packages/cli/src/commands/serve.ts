import { CommandLineAction, type CommandLineStringParameter } from "@rushstack/ts-command-line";

/** Action: `serve` — start the Grackle server and web UI. */
export class ServeAction extends CommandLineAction {
  private readonly _port: CommandLineStringParameter;
  private readonly _webPort: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "serve",
      summary: "Start the Grackle server",
      documentation: "Starts the Grackle gRPC server and web UI.",
    });

    this._port = this.defineStringParameter({
      parameterLongName: "--port",
      argumentName: "PORT",
      description: "Server gRPC port",
      defaultValue: "7434",
    });
    this._webPort = this.defineStringParameter({
      parameterLongName: "--web-port",
      argumentName: "PORT",
      description: "Web UI port",
      defaultValue: "3000",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    process.env.GRACKLE_PORT = this._port.value!;
    process.env.GRACKLE_WEB_PORT = this._webPort.value!;

    console.log(`Starting Grackle server on port ${this._port.value}...`);
    console.log(`Web UI will be available at http://localhost:${this._webPort.value}`);

    // Dynamic import to start the server
    await import("@grackle-ai/server");
  }
}
