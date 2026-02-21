import { useState, type FormEvent } from "react";
import { useGrackle } from "../context/GrackleContext.js";

interface Props {
  sessionId: string;
}

export function InputBar({ sessionId }: Props) {
  const { sendInput } = useGrackle();
  const [text, setText] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendInput(sessionId, text);
    setText("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        borderTop: "1px solid #0f3460",
        padding: "8px 12px",
        gap: "8px",
        background: "#16213e",
      }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message..."
        autoFocus
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
      <button
        type="submit"
        style={{
          background: "#4ecca3",
          border: "none",
          color: "#1a1a2e",
          padding: "6px 16px",
          borderRadius: "4px",
          cursor: "pointer",
          fontWeight: "bold",
          fontFamily: "monospace",
        }}
      >
        Send
      </button>
    </form>
  );
}
