import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { motion } from "motion/react";
import styles from "./FindingsPanel.module.scss";

/** Category color mapping using CSS custom property values. */
const CATEGORY_COLORS: Record<string, { text: string; bg: string }> = {
  architecture: { text: "var(--accent-blue)", bg: "var(--accent-blue-dim)" },
  api: { text: "var(--accent-green)", bg: "var(--accent-green-dim)" },
  bug: { text: "var(--accent-red)", bg: "var(--accent-red-dim)" },
  decision: { text: "var(--accent-yellow)", bg: "var(--accent-yellow-dim)" },
  dependency: { text: "var(--accent-purple)", bg: "var(--accent-purple-dim)" },
  pattern: { text: "var(--text-secondary)", bg: "var(--bg-elevated)" },
  general: { text: "var(--text-secondary)", bg: "var(--bg-elevated)" },
};

/** Default category styling fallback. */
const DEFAULT_CATEGORY_COLOR: { text: string; bg: string } = { text: "var(--text-secondary)", bg: "var(--bg-elevated)" };

/** Props for the FindingsPanel component. */
interface Props {
  projectId: string;
}

/** Displays project findings as styled cards with staggered entrance animation. */
export function FindingsPanel({ projectId }: Props): JSX.Element {
  const { findings } = useGrackle();

  const projectFindings = findings.filter((f) => f.projectId === projectId);

  if (projectFindings.length === 0) {
    return (
      <div className={styles.emptyState}>
        No findings yet. Agents will post discoveries here.
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {projectFindings.map((f, index) => {
        const categoryColor = CATEGORY_COLORS[f.category] || DEFAULT_CATEGORY_COLOR;
        return (
          <motion.div
            key={f.id}
            className={styles.card}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.2 }}
          >
            <div className={styles.cardHeader}>
              <span
                className={styles.categoryBadge}
                style={{ background: categoryColor.bg, color: categoryColor.text }}
              >
                {f.category}
              </span>
              <span className={styles.findingTitle}>
                {f.title}
              </span>
              <span className={styles.findingDate}>
                {f.createdAt}
              </span>
            </div>
            <div className={styles.findingContent}>
              {f.content.length > 300 ? f.content.slice(0, 300) + "..." : f.content}
            </div>
            {f.tags.length > 0 && (
              <div className={styles.tags}>
                {f.tags.map((tag) => (
                  <span
                    key={tag}
                    className={styles.tag}
                    style={{ color: categoryColor.text, textShadow: `0 0 8px ${categoryColor.text}` }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
