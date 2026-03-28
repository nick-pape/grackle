import type { JSX } from "react";
import { motion } from "motion/react";
import type { FindingData } from "../../hooks/types.js";
import styles from "./FindingsPanel.module.scss";
import { formatRelativeTime } from "../../utils/time.js";
import { getCategoryColor } from "../../utils/findingCategory.js";

/** Props for the FindingsPanel component. */
interface Props {
  /** Pre-filtered findings to display. */
  findings: FindingData[];
  /** Optional click handler for finding cards. When provided, cards become clickable. */
  onFindingClick?: (findingId: string) => void;
}

/** Displays workspace findings as styled cards with staggered entrance animation. */
export function FindingsPanel({ findings, onFindingClick }: Props): JSX.Element {
  if (findings.length === 0) {
    return (
      <div className={styles.emptyState}>
        No findings yet. Agents will post discoveries here.
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {findings.map((f, index) => {
        const categoryColor = getCategoryColor(f.category);
        const Tag = onFindingClick ? motion.button : motion.div;
        return (
          <Tag
            key={f.id}
            type={onFindingClick ? "button" : undefined}
            className={`${styles.card} ${onFindingClick ? styles.cardClickable : ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.2 }}
            onClick={onFindingClick ? () => { onFindingClick(f.id); } : undefined}
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
              <span className={styles.findingDate} title={f.createdAt}>
                {formatRelativeTime(f.createdAt)}
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
          </Tag>
        );
      })}
    </div>
  );
}
