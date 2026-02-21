import { useState, type FormEvent } from "react";
import { useGrackle } from "../context/GrackleContext.js";

export function SpawnBar() {
  const { environments, spawn } = useGrackle();
  const [prompt, setPrompt] = useState("");
  const [envId, setEnvId] = useState("");

  const connectedEnvs = environments.filter((e) => e.status === "connected");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const targetEnv = envId || connectedEnvs[0]?.id;
    if (!targetEnv || !prompt.trim()) return;
    spawn(targetEnv, prompt);
    setPrompt("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        borderTop: "1px solid #0f3460",
        background: "#16213e",
      }}
    >
      <span style={{ fontSize: "12px", color: "#888" }}>New:</span>
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Enter prompt..."
        style={{
          flex: 1,
          background: "#0f3460",
          border: "1px solid #333",
          color: "#e0e0e0",
          padding: "6px 10px",
          borderRadius: "4px",
          outline: "none",
          fontFamily: "monospace",
          fontSize: "13px",
        }}
      />
      <select
        value={envId}
        onChange={(e) => setEnvId(e.target.value)}
        style={{
          background: "#0f3460",
          border: "1px solid #333",
          color: "#e0e0e0",
          padding: "6px 8px",
          borderRadius: "4px",
          fontFamily: "monospace",
          fontSize: "12px",
        }}
      >
        {connectedEnvs.length === 0 && <option value="">No envs</option>}
        {connectedEnvs.map((env) => (
          <option key={env.id} value={env.id}>
            {env.displayName || env.id}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={connectedEnvs.length === 0 || !prompt.trim()}
        style={{
          background: connectedEnvs.length > 0 && prompt.trim() ? "#4ecca3" : "#333",
          border: "none",
          color: "#1a1a2e",
          padding: "6px 16px",
          borderRadius: "4px",
          cursor: connectedEnvs.length > 0 ? "pointer" : "not-allowed",
          fontWeight: "bold",
          fontFamily: "monospace",
        }}
      >
        Go
      </button>
    </form>
  );
}
