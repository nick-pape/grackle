/**
 * AgentHeader — presentational header above the agent tab bar (#1419).
 * Shows avatar, name, and heartbeat status indicators.
 *
 * @module
 */

import type { JSX } from "react";
import { ArrowLeft } from "lucide-react";
import type { ScheduleData } from "../../hooks/types.js";
import { formatCountdown, formatRelativeTime } from "../../utils/time.js";
import { isImageAvatar } from "./AgentManager.js";
import styles from "./AgentHeader.module.scss";

/** Props for {@link AgentHeader}. */
export interface AgentHeaderProps {
  /** Agent display name. */
  name: string;
  /** Emoji, image URL, or data URI. Empty = monogram fallback. */
  avatar: string;
  /** Derived heartbeat schedule (populated by server on read). */
  heartbeat?: ScheduleData;
  /** Navigate back to the home page. */
  onNavigateBack: () => void;
}

/** Render an avatar: image, emoji glyph, or name-derived monogram. */
function AvatarDisplay({ name, avatar }: { name: string; avatar: string }): JSX.Element {
  if (avatar && isImageAvatar(avatar)) {
    return (
      <img
        className={styles.avatar}
        src={avatar}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        data-testid="agent-header-avatar-image"
      />
    );
  }
  const glyph = avatar || (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <span className={styles.avatar} aria-hidden="true" data-testid="agent-header-avatar-glyph">
      {glyph}
    </span>
  );
}

/** Agent detail page header with avatar, name, and heartbeat indicators. */
export function AgentHeader({
  name,
  avatar,
  heartbeat,
  onNavigateBack,
}: AgentHeaderProps): JSX.Element {
  return (
    <header className={styles.header} data-testid="agent-header">
      <button
        className={styles.backButton}
        onClick={onNavigateBack}
        aria-label="Back"
        data-testid="agent-header-back"
      >
        <ArrowLeft size={18} />
      </button>
      <AvatarDisplay name={name} avatar={avatar} />
      <div className={styles.info}>
        <h1 className={styles.name} data-testid="agent-header-name">
          {name}
        </h1>
        {heartbeat && (
          <div className={styles.status} data-testid="agent-header-status">
            {heartbeat.enabled && heartbeat.nextRunAt && (
              <span className={styles.statusItem} data-testid="agent-header-next-wake">
                Next wake {formatCountdown(heartbeat.nextRunAt)}
              </span>
            )}
            {!heartbeat.enabled && (
              <span className={styles.statusItem} data-testid="agent-header-paused">
                Paused
              </span>
            )}
            {heartbeat.lastRunAt && (
              <span className={styles.statusItem} data-testid="agent-header-last-activity">
                Last activity {formatRelativeTime(heartbeat.lastRunAt)}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
