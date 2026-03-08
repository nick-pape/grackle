import { CommandLineAction, type CommandLineFlagParameter, type CommandLineStringParameter } from "@rushstack/ts-command-line";
import chalk from "chalk";
import { createGrackleClient } from "../client.js";
import type { AdapterType } from "@grackle/common";
import Table from "cli-table3";

/** Action: `env:list` — list all environments. */
export class EnvListAction extends CommandLineAction {
  public constructor() {
    super({
      actionName: "env:list",
      summary: "List all environments",
      documentation: "Displays a table of all registered environments with their status.",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const res = await client.listEnvironments({});
    if (res.environments.length === 0) {
      console.log("No environments configured.");
      return;
    }
    const table = new Table({
      head: ["ID", "Type", "Runtime", "Status", "Bootstrapped"],
    });
    for (const e of res.environments) {
      const status =
        e.status === "connected"
          ? chalk.green("●") + " " + e.status
          : e.status === "sleeping"
            ? chalk.yellow("●") + " " + e.status
            : e.status === "error"
              ? chalk.red("●") + " " + e.status
              : chalk.gray("●") + " " + e.status;
      table.push([e.id, e.adapterType, e.defaultRuntime, status, e.bootstrapped ? "yes" : "no"]);
    }
    console.log(table.toString());
  }
}

/** Action: `env:add` — add a new environment. */
export class EnvAddAction extends CommandLineAction {
  private readonly _name: CommandLineStringParameter;
  private readonly _codespace: CommandLineFlagParameter;
  private readonly _docker: CommandLineFlagParameter;
  private readonly _ssh: CommandLineFlagParameter;
  private readonly _local: CommandLineFlagParameter;
  private readonly _repo: CommandLineStringParameter;
  private readonly _machine: CommandLineStringParameter;
  private readonly _image: CommandLineStringParameter;
  private readonly _host: CommandLineStringParameter;
  private readonly _port: CommandLineStringParameter;
  private readonly _user: CommandLineStringParameter;
  private readonly _runtime: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "env:add",
      summary: "Add an environment",
      documentation: "Registers a new environment with the Grackle server.",
    });

    this._name = this.defineStringParameter({
      parameterLongName: "--name",
      argumentName: "NAME",
      description: "Display name for the environment",
      required: true,
    });
    this._codespace = this.defineFlagParameter({
      parameterLongName: "--codespace",
      description: "Use Codespace adapter",
    });
    this._docker = this.defineFlagParameter({
      parameterLongName: "--docker",
      description: "Use Docker adapter",
    });
    this._ssh = this.defineFlagParameter({
      parameterLongName: "--ssh",
      description: "Use SSH adapter",
    });
    this._local = this.defineFlagParameter({
      parameterLongName: "--local",
      description: "Use local PowerLine adapter",
    });
    this._repo = this.defineStringParameter({
      parameterLongName: "--repo",
      argumentName: "REPO",
      description: "GitHub repo (codespace) or repository URL (docker)",
    });
    this._machine = this.defineStringParameter({
      parameterLongName: "--machine",
      argumentName: "MACHINE",
      description: "Machine type (codespace)",
    });
    this._image = this.defineStringParameter({
      parameterLongName: "--image",
      argumentName: "IMAGE",
      description: "Docker image",
    });
    this._host = this.defineStringParameter({
      parameterLongName: "--host",
      argumentName: "HOST",
      description: "SSH host or local PowerLine host",
    });
    this._port = this.defineStringParameter({
      parameterLongName: "--port",
      argumentName: "PORT",
      description: "PowerLine port (local adapter)",
    });
    this._user = this.defineStringParameter({
      parameterLongName: "--user",
      argumentName: "USER",
      description: "SSH user",
    });
    this._runtime = this.defineStringParameter({
      parameterLongName: "--runtime",
      argumentName: "RUNTIME",
      description: "Default agent runtime",
      defaultValue: "claude-code",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    let adapterType: AdapterType = "docker";
    const config: Record<string, unknown> = {};

    if (this._local.value) {
      adapterType = "local";
      if (this._host.value) {
        config.host = this._host.value;
      }
      if (this._port.value) {
        config.port = parseInt(this._port.value, 10);
      }
    } else if (this._codespace.value) {
      adapterType = "codespace";
      if (this._repo.value) {
        config.repo = this._repo.value;
      }
      if (this._machine.value) {
        config.machine = this._machine.value;
      }
    } else if (this._ssh.value) {
      adapterType = "ssh";
      if (this._host.value) {
        config.host = this._host.value;
      }
      if (this._user.value) {
        config.user = this._user.value;
      }
    } else {
      if (this._image.value) {
        config.image = this._image.value;
      }
      if (this._repo.value) {
        config.repo = this._repo.value;
      }
    }

    const env = await client.addEnvironment({
      displayName: this._name.value!,
      adapterType,
      adapterConfig: JSON.stringify(config),
      defaultRuntime: this._runtime.value!,
    });
    console.log(`Added environment: ${env.id} (${env.adapterType})`);
  }
}

/** Action: `env:provision` — provision and connect an environment. */
export class EnvProvisionAction extends CommandLineAction {
  private readonly _id: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "env:provision",
      summary: "Provision and connect an environment",
      documentation: "Provisions an environment and streams provisioning progress.",
    });

    this._id = this.defineStringParameter({
      parameterLongName: "--id",
      argumentName: "ID",
      description: "Environment ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    for await (const event of client.provisionEnvironment({ id: this._id.value! })) {
      const pct = Math.round(event.progress * 100);
      console.log(`[${pct}%] ${event.stage}: ${event.message}`);
    }
  }
}

/** Action: `env:stop` — stop a running environment. */
export class EnvStopAction extends CommandLineAction {
  private readonly _id: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "env:stop",
      summary: "Stop an environment",
      documentation: "Stops a running environment.",
    });

    this._id = this.defineStringParameter({
      parameterLongName: "--id",
      argumentName: "ID",
      description: "Environment ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    await client.stopEnvironment({ id: this._id.value! });
    console.log(`Stopped: ${this._id.value}`);
  }
}

/** Action: `env:destroy` — destroy an environment. */
export class EnvDestroyAction extends CommandLineAction {
  private readonly _id: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "env:destroy",
      summary: "Destroy an environment",
      documentation: "Destroys an environment and removes associated resources.",
    });

    this._id = this.defineStringParameter({
      parameterLongName: "--id",
      argumentName: "ID",
      description: "Environment ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    await client.destroyEnvironment({ id: this._id.value! });
    console.log(`Destroyed: ${this._id.value}`);
  }
}

/** Action: `env:remove` — remove an environment from the registry. */
export class EnvRemoveAction extends CommandLineAction {
  private readonly _id: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "env:remove",
      summary: "Remove environment from registry",
      documentation: "Removes an environment entry from the registry without destroying it.",
    });

    this._id = this.defineStringParameter({
      parameterLongName: "--id",
      argumentName: "ID",
      description: "Environment ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    await client.removeEnvironment({ id: this._id.value! });
    console.log(`Removed: ${this._id.value}`);
  }
}

/** Action: `env:wake` — wake a sleeping environment. */
export class EnvWakeAction extends CommandLineAction {
  private readonly _id: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "env:wake",
      summary: "Wake a sleeping environment",
      documentation: "Wakes a sleeping environment and streams provisioning progress.",
    });

    this._id = this.defineStringParameter({
      parameterLongName: "--id",
      argumentName: "ID",
      description: "Environment ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    for await (const event of client.provisionEnvironment({ id: this._id.value! })) {
      const pct = Math.round(event.progress * 100);
      console.log(`[${pct}%] ${event.stage}: ${event.message}`);
    }
  }
}
