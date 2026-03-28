import type { JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { classifyTool } from "./classifyTool.js";
import { FileReadCard } from "./FileReadCard.js";
import { FileEditCard } from "./FileEditCard.js";
import { ShellCard } from "./ShellCard.js";
import { SearchCard } from "./SearchCard.js";
import { TodoCard } from "./TodoCard.js";
import { MetadataCard } from "./MetadataCard.js";
import { FindingCard } from "./FindingCard.js";
import { TaskCard } from "./TaskCard.js";
import { WorkpadCard } from "./WorkpadCard.js";
import { KnowledgeCard } from "./KnowledgeCard.js";
import { IpcCard } from "./IpcCard.js";
import { ToolSearchCard } from "./ToolSearchCard.js";
import { GenericToolCard } from "./GenericToolCard.js";

/**
 * Routes a tool event to the appropriate specialized card component.
 *
 * This is a thin classifier + router — all rendering logic lives in the
 * individual card components, which are independently testable via Storybook.
 */
export function ToolCard(props: ToolCardProps): JSX.Element {
  const category = classifyTool(props.tool);

  switch (category) {
    case "file-read":
      return <FileReadCard {...props} />;
    case "file-edit":
      return <FileEditCard {...props} />;
    case "file-write":
      return <FileReadCard {...props} writeVariant />;
    case "shell":
      return <ShellCard {...props} />;
    case "search":
      return <SearchCard {...props} />;
    case "todo":
      return <TodoCard {...props} />;
    case "metadata":
      return <MetadataCard {...props} />;
    case "finding":
      return <FindingCard {...props} />;
    case "task":
      return <TaskCard {...props} />;
    case "workpad":
      return <WorkpadCard {...props} />;
    case "knowledge":
      return <KnowledgeCard {...props} />;
    case "ipc":
      return <IpcCard {...props} />;
    case "tool-search":
      return <ToolSearchCard {...props} />;
    default:
      return <GenericToolCard {...props} />;
  }
}
