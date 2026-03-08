import { CommandLineAction, type CommandLineIntegerParameter, type CommandLineStringParameter } from "@rushstack/ts-command-line";
import { createGrackleClient } from "../client.js";
import Table from "cli-table3";

/** Action: `finding:list` — list findings in a project. */
export class FindingListAction extends CommandLineAction {
  private readonly _projectId: CommandLineStringParameter;
  private readonly _category: CommandLineStringParameter;
  private readonly _tag: CommandLineStringParameter;
  private readonly _limit: CommandLineIntegerParameter;

  public constructor() {
    super({
      actionName: "finding:list",
      summary: "List findings in a project",
      documentation: "Displays findings for the specified project, with optional category and tag filters.",
    });

    this._projectId = this.defineStringParameter({
      parameterLongName: "--project-id",
      argumentName: "PROJECT_ID",
      description: "Project ID",
      required: true,
    });
    this._category = this.defineStringParameter({
      parameterLongName: "--category",
      argumentName: "CATEGORY",
      description: "Filter by category",
    });
    this._tag = this.defineStringParameter({
      parameterLongName: "--tag",
      argumentName: "TAG",
      description: "Filter by tag",
    });
    this._limit = this.defineIntegerParameter({
      parameterLongName: "--limit",
      argumentName: "N",
      description: "Maximum number of results",
      defaultValue: 20,
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const res = await client.queryFindings({
      projectId: this._projectId.value!,
      categories: this._category.value ? [this._category.value] : [],
      tags: this._tag.value ? [this._tag.value] : [],
      limit: this._limit.value!,
    });
    if (res.findings.length === 0) {
      console.log("No findings.");
      return;
    }
    const table = new Table({
      head: ["ID", "Category", "Title", "Tags", "Created"],
    });
    for (const f of res.findings) {
      table.push([f.id, f.category, f.title.slice(0, 40), f.tags.join(",") || "-", f.createdAt]);
    }
    console.log(table.toString());
  }
}

/** Action: `finding:post` — post a new finding. */
export class FindingPostAction extends CommandLineAction {
  private readonly _projectId: CommandLineStringParameter;
  private readonly _title: CommandLineStringParameter;
  private readonly _category: CommandLineStringParameter;
  private readonly _content: CommandLineStringParameter;
  private readonly _tags: CommandLineStringParameter;

  public constructor() {
    super({
      actionName: "finding:post",
      summary: "Post a finding",
      documentation: "Posts a new finding to the specified project.",
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
      description: "Finding title",
      required: true,
    });
    this._category = this.defineStringParameter({
      parameterLongName: "--category",
      argumentName: "CATEGORY",
      description: "Finding category",
      defaultValue: "general",
    });
    this._content = this.defineStringParameter({
      parameterLongName: "--content",
      argumentName: "TEXT",
      description: "Finding content",
      defaultValue: "",
    });
    this._tags = this.defineStringParameter({
      parameterLongName: "--tags",
      argumentName: "TAGS",
      description: "Comma-separated tags",
    });
  }

  protected async onExecuteAsync(): Promise<void> {
    const client = createGrackleClient();
    const tags = this._tags.value ? this._tags.value.split(",") : [];
    const f = await client.postFinding({
      projectId: this._projectId.value!,
      taskId: "",
      sessionId: "",
      category: this._category.value!,
      title: this._title.value!,
      content: this._content.value!,
      tags,
    });
    console.log(`Posted finding: ${f.id}`);
  }
}
