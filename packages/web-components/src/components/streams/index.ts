/**
 * IPC stream inventory and detail panel components (Coordination tab).
 *
 * @module streams
 */

export { CoordinationList } from "./CoordinationList.js";
export type { CoordinationListProps } from "./CoordinationList.js";
export { StreamDetailPanel } from "./StreamDetailPanel.js";
export type { StreamDetailPanelProps } from "./StreamDetailPanel.js";
export { StreamTranscript } from "./StreamTranscript.js";
export type { StreamTranscriptProps } from "./StreamTranscript.js";
export { CoordinationGraph } from "./CoordinationGraph.js";
export type { CoordinationGraphProps } from "./CoordinationGraph.js";
export { SessionNode } from "./SessionNode.js";
export { StreamNode } from "./StreamNode.js";
export { buildCoordinationGraph, useCoordinationLayout } from "./useCoordinationLayout.js";
export type {
  CoordEdgeData,
  CoordNodeData,
  CoordinationLayoutResult,
  SessionNodeData,
  StreamNodeData,
} from "./useCoordinationLayout.js";
