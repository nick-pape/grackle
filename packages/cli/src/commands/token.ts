import { CommandLineAction, type CommandLineStringParameter } from "@rushstack/ts-command-line";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

/** Action: `token:set` — create or update a token. */
export class TokenSetAction extends CommandLineAction {
  private readonly _name: CommandLineStringParameter;
  private readonly _file: CommandLineStringParameter;
  private readonly _env: CommandLineStringParameter;
  private readonly _type: CommandLineStringParameter;
  private readonly _envVar: CommandLineStringParameter;
  private readonly _filePath: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "token:set",
      summary: "Set a token",
      documentation: "Creates or updates a named token used by PowerLine agents.",
    });

    this._name = this.defineStringParameter({
      parameterLongName: "--name",
      argumentName: "NAME",
      description: "Token name",
      required: true,
    });
    this._file = this.defineStringParameter({
      parameterLongName: "--file",
      argumentName: "PATH",
      description: "Read value from file",
    });
    this._env = this.defineStringParameter({
      parameterLongName: "--env",
      argumentName: "VAR",
      description: "Read value from environment variable",
    });
    this._type = this.defineStringParameter({
      parameterLongName: "--type",
      argumentName: "TYPE",
      description: "Token type: env_var or file",
      defaultValue: "env_var",
    });
    this._envVar = this.defineStringParameter({
      parameterLongName: "--env-var",
      argumentName: "NAME",
      description: "Environment variable name to set on PowerLine",
    });
    this._filePath = this.defineStringParameter({
      parameterLongName: "--file-path",
      argumentName: "PATH",
      description: "File path to write on PowerLine",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const name = this._name.value!;
    let value: string;

    if (this._file.value) {
      value = readFileSync(this._file.value, "utf-8").trim();
    } else if (this._env.value) {
      value = process.env[this._env.value] ?? "";
      if (!value) {
        console.error(`Environment variable ${this._env.value} is not set`);
        process.exit(1);
      }
    } else {
      // Interactive
      value = await new Promise<string>((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`Enter value for ${name}: `, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    }

    await client.setToken({
      name,
      type: this._type.value!,
      envVar: this._envVar.value ?? name.toUpperCase() + "_TOKEN",
      filePath: this._filePath.value ?? "",
      value,
      expiresAt: "",
    });
    console.log(`Token set: ${name}`);
  }
}

/** Action: `token:list` — list configured tokens. */
export class TokenListAction extends CommandLineAction {
  public constructor() {
    super({
      actionName: "token:list",
      summary: "List configured tokens",
      documentation: "Displays a table of all configured tokens.",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const res = await client.listTokens({});
    if (res.tokens.length === 0) {
      console.log("No tokens configured.");
      return;
    }
    const table = new Table({
      head: ["Name", "Type", "Target", "Expires"],
    });
    for (const t of res.tokens) {
      const target = t.type === "env_var" ? t.envVar : t.filePath;
      table.push([t.name, t.type, target, t.expiresAt || "never"]);
    }
    console.log(table.toString());
  }
}
