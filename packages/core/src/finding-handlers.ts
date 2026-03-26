import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { findingStore } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { emit } from "./event-bus.js";
import { findingRowToProto } from "./grpc-proto-converters.js";

/** Post a new finding. */
export async function postFinding(req: grackle.PostFindingRequest): Promise<grackle.Finding> {
  if (!req.title) {
    throw new ConnectError("title is required", Code.InvalidArgument);
  }
  const id = uuid().slice(0, 8);
  findingStore.postFinding(
    id,
    req.workspaceId,
    req.taskId,
    req.sessionId,
    req.category,
    req.title,
    req.content,
    [...req.tags],
  );
  emit("finding.posted", { workspaceId: req.workspaceId, findingId: id });
  const rows = findingStore.queryFindings(req.workspaceId);
  const row = rows.find((r) => r.id === id);
  return findingRowToProto(row!);
}

/** Query findings with optional filters. */
export async function queryFindings(req: grackle.QueryFindingsRequest): Promise<grackle.FindingList> {
  const rows = findingStore.queryFindings(
    req.workspaceId,
    req.categories.length > 0 ? [...req.categories] : undefined,
    req.tags.length > 0 ? [...req.tags] : undefined,
    req.limit || undefined,
  );
  return create(grackle.FindingListSchema, {
    findings: rows.map(findingRowToProto),
  });
}
