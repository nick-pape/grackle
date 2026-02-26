import type { JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";

export function StatusBar(): JSX.Element {
  const { connected, environments, sessions } = useGrackle();
  const totalEnvs = environments.length;
  const connectedEnvs = environments.filter((e) => e.status === "connected").length;
  const activeCount = sessions.filter((s) => ["running", "waiting_input"].includes(s.status)).length;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 16px",
        background: "#16213e",
        borderBottom: "1px solid #0f3460",
        fontSize: "14px",
      }}
    >
      <div style={{ fontWeight: "bold", fontSize: "16px" }}>Grackle</div>
      <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#a0a0a0" }}>
        <span>
          <span style={{ color: connected ? "#4ecca3" : "#e94560" }}>●</span>
          {" "}{connected ? "Connected" : "Disconnected"}
        </span>
        <span>{connectedEnvs}/{totalEnvs} env{totalEnvs !== 1 ? "s" : ""}</span>
        <span>{activeCount} active</span>
      </div>
    </div>
  );
}
