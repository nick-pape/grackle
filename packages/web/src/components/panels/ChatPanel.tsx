import { useChat } from "@ai-sdk/react";
import { useRef, useEffect, type JSX, type FormEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./ChatPanel.module.scss";

declare const window: Window & { __GRACKLE_API_KEY__?: string };

/** Minimal chat panel backed by Claude Code + Grackle MCP tools. */
export function ChatPanel(): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, status, error } = useChat({
    api: "/api/chat",
    streamProtocol: "text",
    headers: {
      Authorization: `Bearer ${window.__GRACKLE_API_KEY__ || ""}`,
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!input.trim() || isLoading) {
      return;
    }
    handleSubmit(e);
  }

  return (
    <div className={styles.chatContainer}>
      <div className={styles.messageList} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles.welcome}>
            <div className={styles.welcomeTitle}>Welcome to Grackle</div>
            <div className={styles.welcomeHint}>
              Ask me to manage environments, tasks, or projects.
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`${styles.message} ${m.role === "user" ? styles.user : styles.assistant}`}
          >
            <div className={styles.role}>{m.role === "user" ? "You" : "Grackle"}</div>
            <div className={styles.bubble}>
              <div className={styles.content}>
                {m.role === "assistant" ? (
                  <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                ) : (
                  m.content
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className={styles.thinking}>
            <div className={styles.role}>Grackle</div>
            <div className={styles.bubble}>
              <div className={styles.dots}>
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className={styles.error}>{error.message}</div>
      )}
      <form className={styles.inputBar} onSubmit={onSubmit}>
        <input
          className={styles.input}
          value={input}
          onChange={handleInputChange}
          placeholder="Ask Grackle anything..."
          disabled={isLoading}
        />
        <button className={styles.sendButton} type="submit" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
