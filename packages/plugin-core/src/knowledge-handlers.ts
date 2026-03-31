import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import {
  knowledgeSearch,
  getNode as getKnowledgeNodeById,
  expandNode,
  createNativeNode,
  ingest,
  createPassThroughChunker,
  listRecentNodes,
  type SearchResult,
  type Embedder,
  type EdgeType,
} from "@grackle-ai/knowledge";
import { getKnowledgeEmbedder, isKnowledgeEnabled } from "@grackle-ai/core";
import { isNeo4jHealthy } from "@grackle-ai/core";
import { knowledgeNodeToProto, knowledgeEdgeToProto } from "./grpc-proto-converters.js";
import { logger } from "@grackle-ai/core";

/** Error message returned when Neo4j is unreachable. */
const NEO4J_UNAVAILABLE_MESSAGE: string =
  "Knowledge graph temporarily unavailable — Neo4j unreachable";

/**
 * Guard that checks Neo4j health status.
 *
 * @throws ConnectError with Code.Unavailable if Neo4j is unreachable.
 */
function requireKnowledgeReady(): void {
  if (!isNeo4jHealthy()) {
    throw new ConnectError(NEO4J_UNAVAILABLE_MESSAGE, Code.Unavailable);
  }
}

/**
 * Guard that checks embedder availability and Neo4j health, returning the embedder.
 *
 * @throws ConnectError with Code.Unavailable if knowledge is not ready.
 */
function requireEmbedder(): Embedder {
  const embedder: Embedder | undefined = getKnowledgeEmbedder();
  if (!embedder) {
    throw new ConnectError("Knowledge graph not available", Code.Unavailable);
  }
  requireKnowledgeReady();
  return embedder;
}

/**
 * Wrap non-ConnectError exceptions as Code.Unavailable.
 *
 * ConnectErrors (e.g. NotFound, InvalidArgument) are re-thrown as-is so
 * the handler's own error semantics are preserved.
 */
function wrapNeo4jError(err: unknown): never {
  if (err instanceof ConnectError) {
    throw err;
  }
  // Log the full error server-side for debugging; return a generic message
  // to clients to avoid leaking internal details (hostnames, ports, etc.)
  logger.error({ err }, "Knowledge graph operation failed");
  throw new ConnectError(NEO4J_UNAVAILABLE_MESSAGE, Code.Unavailable);
}

/** Search the knowledge graph using semantic similarity. */
export async function searchKnowledge(req: grackle.SearchKnowledgeRequest): Promise<grackle.SearchKnowledgeResponse> {
  const embedder: Embedder = requireEmbedder();

  try {
    const results = await knowledgeSearch(req.query, embedder, {
      limit: req.limit || 10,
      workspaceId: req.workspaceId || undefined,
    });

    return create(grackle.SearchKnowledgeResponseSchema, {
      results: results.map((r: SearchResult) =>
        create(grackle.SearchKnowledgeResultSchema, {
          score: r.score,
          node: knowledgeNodeToProto(r.node),
          edges: r.edges.map(knowledgeEdgeToProto),
        }),
      ),
    });
  } catch (err) {
    wrapNeo4jError(err);
  }
}

/** Get a knowledge node by ID. */
export async function getKnowledgeNode(req: grackle.GetKnowledgeNodeRequest): Promise<grackle.GetKnowledgeNodeResponse> {
  if (!isKnowledgeEnabled()) {
    throw new ConnectError("Knowledge graph not available", Code.Unavailable);
  }
  requireKnowledgeReady();

  try {
    const result = await getKnowledgeNodeById(req.id);
    if (!result) {
      throw new ConnectError(`Knowledge node not found: ${req.id}`, Code.NotFound);
    }

    return create(grackle.GetKnowledgeNodeResponseSchema, {
      node: knowledgeNodeToProto(result.node),
      edges: result.edges.map(knowledgeEdgeToProto),
    });
  } catch (err) {
    wrapNeo4jError(err);
  }
}

/** Expand a knowledge node to retrieve its neighbors. */
export async function expandKnowledgeNode(req: grackle.ExpandKnowledgeNodeRequest): Promise<grackle.ExpandKnowledgeNodeResponse> {
  if (!isKnowledgeEnabled()) {
    throw new ConnectError("Knowledge graph not available", Code.Unavailable);
  }
  requireKnowledgeReady();

  try {
    const result = await expandNode(req.id, {
      depth: req.depth || 1,
      edgeTypes: req.edgeTypes.length > 0 ? (req.edgeTypes as EdgeType[]) : undefined,
    });

    return create(grackle.ExpandKnowledgeNodeResponseSchema, {
      nodes: result.nodes.map(knowledgeNodeToProto),
      edges: result.edges.map(knowledgeEdgeToProto),
    });
  } catch (err) {
    wrapNeo4jError(err);
  }
}

/** List recently created knowledge nodes. */
export async function listRecentKnowledgeNodes(req: grackle.ListRecentKnowledgeNodesRequest): Promise<grackle.ListRecentKnowledgeNodesResponse> {
  if (!isKnowledgeEnabled()) {
    throw new ConnectError("Knowledge graph not available", Code.Unavailable);
  }
  requireKnowledgeReady();

  try {
    const result = await listRecentNodes(
      req.limit || 20,
      req.workspaceId || undefined,
    );

    return create(grackle.ListRecentKnowledgeNodesResponseSchema, {
      nodes: result.nodes.map(knowledgeNodeToProto),
      edges: result.edges.map(knowledgeEdgeToProto),
    });
  } catch (err) {
    wrapNeo4jError(err);
  }
}

/** Create a new native knowledge node with embedding. */
export async function createKnowledgeNode(req: grackle.CreateKnowledgeNodeRequest): Promise<grackle.CreateKnowledgeNodeResponse> {
  const embedder: Embedder = requireEmbedder();

  try {
    const chunker = createPassThroughChunker();
    const embedded = await ingest(req.content, chunker, embedder);
    if (embedded.length === 0) {
      throw new ConnectError("Content produced no embeddings", Code.InvalidArgument);
    }

    const id: string = await createNativeNode({
      category: (req.category || "insight") as "decision" | "insight" | "concept" | "snippet",
      title: req.title,
      content: req.content,
      tags: [...req.tags],
      embedding: embedded[0].vector,
      workspaceId: req.workspaceId || "",
    });

    return create(grackle.CreateKnowledgeNodeResponseSchema, { id });
  } catch (err) {
    wrapNeo4jError(err);
  }
}
