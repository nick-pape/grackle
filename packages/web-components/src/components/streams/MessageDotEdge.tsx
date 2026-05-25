import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { JSX } from "react";
import type { CoordEdgeData } from "./coordinationGraphModel.js";
import styles from "./CoordinationGraph.module.scss";

/** Duration of a single message-dot traversal. */
const DOT_DURATION: string = "0.7s";
/** Radius of the message dot (pixels). */
const DOT_RADIUS: number = 3;

/**
 * Custom React Flow edge for the Coordination graph. Renders the same smoothstep
 * path as Phase A (via {@link BaseEdge}) and, when a new message arrives on the
 * edge's stream, fires a one-shot dot that travels source -> target.
 *
 * The dot is keyed on `data.pulseSeq` (the stream's latest message seq): when the
 * seq advances, the keyed `<circle>` remounts and the SMIL animation replays. The
 * dot rests at `opacity: 0` (base) with non-frozen SMIL, so it leaves no artifact
 * once the traversal completes.
 */
export function MessageDotEdge(props: EdgeProps): JSX.Element {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, style, data } = props;
  const [edgePath] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const pulseSeq = (data as CoordEdgeData | undefined)?.pulseSeq;

  return (
    <>
      <BaseEdge path={edgePath} markerStart={markerStart} markerEnd={markerEnd} style={style} />
      {pulseSeq !== undefined && (
        <circle
          key={pulseSeq}
          r={DOT_RADIUS}
          opacity={0}
          className={styles.messageDot}
          data-testid="coordination-message-dot"
        >
          <animateMotion dur={DOT_DURATION} repeatCount="1" path={edgePath} />
          <animate
            attributeName="opacity"
            dur={DOT_DURATION}
            repeatCount="1"
            values="0;1;1;0"
            keyTimes="0;0.1;0.85;1"
          />
        </circle>
      )}
    </>
  );
}
