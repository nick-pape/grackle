import { CommandLineAction, type CommandLineStringParameter } from "@rushstack/ts-command-line";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";

/** Action: `project:list` — list all active projects. */
export class ProjectListAction extends CommandLineAction {
  public constructor() {
    super({
      actionName: "project:list",
      summary: "List all active projects",
      documentation: "Displays a table of all active projects.",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const res = await client.listProjects({});
    if (res.projects.length === 0) {
      console.log("No projects.");
      return;
    }
    const table = new Table({
      head: ["ID", "Name", "Env", "Status", "Created"],
    });
    for (const p of res.projects) {
      table.push([p.id, p.name, p.defaultEnvironmentId || "-", p.status, p.createdAt]);
    }
    console.log(table.toString());
  }
}

/** Action: `project:create` — create a new project. */
export class ProjectCreateAction extends CommandLineAction {
  private readonly _name: CommandLineStringParameter;
  private readonly _repo: CommandLineStringParameter;
  private readonly _env: CommandLineStringParameter;
  private readonly _desc: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "project:create",
      summary: "Create a new project",
      documentation: "Creates a new project in the Grackle server.",
    });

    this._name = this.defineStringParameter({
      parameterLongName: "--name",
      argumentName: "NAME",
      description: "Project name",
      required: true,
    });
    this._repo = this.defineStringParameter({
      parameterLongName: "--repo",
      argumentName: "URL",
      description: "Repository URL",
    });
    this._env = this.defineStringParameter({
      parameterLongName: "--env",
      argumentName: "ENV_ID",
      description: "Default environment ID",
    });
    this._desc = this.defineStringParameter({
      parameterLongName: "--desc",
      argumentName: "DESCRIPTION",
      description: "Project description",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const p = await client.createProject({
      name: this._name.value!,
      description: this._desc.value ?? "",
      repoUrl: this._repo.value ?? "",
      defaultEnvironmentId: this._env.value ?? "",
    });
    console.log(`Created project: ${p.id} (${p.name})`);
  }
}

/** Action: `project:archive` — archive a project. */
export class ProjectArchiveAction extends CommandLineAction {
  private readonly _id: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "project:archive",
      summary: "Archive a project",
      documentation: "Archives a project, removing it from active listings.",
    });

    this._id = this.defineStringParameter({
      parameterLongName: "--id",
      argumentName: "ID",
      description: "Project ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    await client.archiveProject({ id: this._id.value! });
    console.log(`Archived: ${this._id.value}`);
  }
}
