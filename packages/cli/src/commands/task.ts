import { CommandLineAction, type CommandLineStringParameter } from "@rushstack/ts-command-line";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";

/** Action: `task:list` — list tasks in a project. */
export class TaskListAction extends CommandLineAction {
  private readonly _projectId: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "task:list",
      summary: "List tasks in a project",
      documentation: "Displays a table of all tasks belonging to the specified project.",
    });

    this._projectId = this.defineStringParameter({
      parameterLongName: "--project-id",
      argumentName: "PROJECT_ID",
      description: "Project ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const res = await client.listTasks({ id: this._projectId.value! });
    if (res.tasks.length === 0) {
      console.log("No tasks.");
      return;
    }
    const table = new Table({
      head: ["ID", "Title", "Status", "Branch", "Deps", "Session"],
    });
    for (const t of res.tasks) {
      const deps = t.dependsOn.length > 0 ? t.dependsOn.join(",") : "-";
      table.push([
        t.id,
        t.title.slice(0, 30),
        t.status,
        t.branch.slice(0, 30),
        deps,
        t.sessionId?.slice(0, 8) ?? "-",
      ]);
    }
    console.log(table.toString());
  }
}

/** Action: `task:create` — create a new task. */
export class TaskCreateAction extends CommandLineAction {
  private readonly _projectId: CommandLineStringParameter;
  private readonly _title: CommandLineStringParameter;
  private readonly _desc: CommandLineStringParameter;
  private readonly _env: CommandLineStringParameter;
  private readonly _dependsOn: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "task:create",
      summary: "Create a task",
      documentation: "Creates a new task within the specified project.",
    });

    this._projectId = this.defineStringParameter({
      parameterLongName: "--project-id",
      argumentName: "PROJECT_ID",
      description: "Project ID",
      required: true,
    });
    this._title = this.defineStringParameter({
      parameterLongName: "--title",
      argumentName: "TITLE",
      description: "Task title",
      required: true,
    });
    this._desc = this.defineStringParameter({
      parameterLongName: "--desc",
      argumentName: "TEXT",
      description: "Task description",
    });
    this._env = this.defineStringParameter({
      parameterLongName: "--env",
      argumentName: "ENV_ID",
      description: "Environment ID",
    });
    this._dependsOn = this.defineStringParameter({
      parameterLongName: "--depends-on",
      argumentName: "IDS",
      description: "Comma-separated dependency task IDs",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const dependsOn = this._dependsOn.value ? this._dependsOn.value.split(",") : [];
    const t = await client.createTask({
      projectId: this._projectId.value!,
      title: this._title.value!,
      description: this._desc.value ?? "",
      environmentId: this._env.value ?? "",
      dependsOn,
    });
    console.log(`Created task: ${t.id} (${t.title}) branch: ${t.branch}`);
  }
}

/** Action: `task:show` — show task details. */
export class TaskShowAction extends CommandLineAction {
  private readonly _taskId: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "task:show",
      summary: "Show task details",
      documentation: "Displays full details for the specified task.",
    });

    this._taskId = this.defineStringParameter({
      parameterLongName: "--task-id",
      argumentName: "TASK_ID",
      description: "Task ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const t = await client.getTask({ id: this._taskId.value! });
    console.log(`ID:          ${t.id}`);
    console.log(`Title:       ${t.title}`);
    console.log(`Status:      ${t.status}`);
    console.log(`Branch:      ${t.branch}`);
    console.log(`Env:         ${t.environmentId || "-"}`);
    console.log(`Session:     ${t.sessionId || "-"}`);
    console.log(`Depends On:  ${t.dependsOn.length > 0 ? t.dependsOn.join(", ") : "none"}`);
    if (t.description) {
      console.log(`Description: ${t.description}`);
    }
    if (t.reviewNotes) {
      console.log(`Review Notes: ${t.reviewNotes}`);
    }
  }
}

/** Action: `task:start` — start a task by spawning an agent. */
export class TaskStartAction extends CommandLineAction {
  private readonly _taskId: CommandLineStringParameter;
  private readonly _runtime: CommandLineStringParameter;
  private readonly _model: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "task:start",
      summary: "Start a task (spawn agent)",
      documentation: "Starts a task by spawning an agent session.",
    });

    this._taskId = this.defineStringParameter({
      parameterLongName: "--task-id",
      argumentName: "TASK_ID",
      description: "Task ID",
      required: true,
    });
    this._runtime = this.defineStringParameter({
      parameterLongName: "--runtime",
      argumentName: "RUNTIME",
      description: "Agent runtime",
    });
    this._model = this.defineStringParameter({
      parameterLongName: "--model",
      argumentName: "MODEL",
      description: "Model to use",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const session = await client.startTask({
      taskId: this._taskId.value!,
      runtime: this._runtime.value ?? "",
      model: this._model.value ?? "",
    });
    console.log(`Task started. Session: ${session.id}`);
  }
}

/** Action: `task:delete` — delete a task. */
export class TaskDeleteAction extends CommandLineAction {
  private readonly _taskId: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "task:delete",
      summary: "Delete a task",
      documentation: "Permanently deletes the specified task.",
    });

    this._taskId = this.defineStringParameter({
      parameterLongName: "--task-id",
      argumentName: "TASK_ID",
      description: "Task ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    await client.deleteTask({ id: this._taskId.value! });
    console.log(`Deleted: ${this._taskId.value}`);
  }
}

/** Action: `task:approve` — approve a task in review. */
export class TaskApproveAction extends CommandLineAction {
  private readonly _taskId: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "task:approve",
      summary: "Approve a task in review",
      documentation: "Approves a task that is awaiting review.",
    });

    this._taskId = this.defineStringParameter({
      parameterLongName: "--task-id",
      argumentName: "TASK_ID",
      description: "Task ID",
      required: true,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const t = await client.approveTask({ id: this._taskId.value! });
    console.log(`Approved: ${t.id} → ${t.status}`);
  }
}

/** Action: `task:reject` — reject a task in review. */
export class TaskRejectAction extends CommandLineAction {
  private readonly _taskId: CommandLineStringParameter;
  private readonly _notes: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "task:reject",
      summary: "Reject a task in review",
      documentation: "Rejects a task that is awaiting review, optionally providing review notes.",
    });

    this._taskId = this.defineStringParameter({
      parameterLongName: "--task-id",
      argumentName: "TASK_ID",
      description: "Task ID",
      required: true,
    });
    this._notes = this.defineStringParameter({
      parameterLongName: "--notes",
      argumentName: "TEXT",
      description: "Review notes",
      defaultValue: "",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const t = await client.rejectTask({
      id: this._taskId.value!,
      title: "",
      description: "",
      status: "",
      environmentId: "",
      dependsOn: [],
      reviewNotes: this._notes.value!,
    });
    console.log(`Rejected: ${t.id} → ${t.status}`);
  }
}
