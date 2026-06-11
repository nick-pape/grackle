import { type JSX } from "react";
import type { DockerContainer } from "../../hooks/types.js";
import styles from "./EnvironmentEditPanel.module.scss";

/** Props for the DockerContainerPicker component. */
export interface DockerContainerPickerProps {
  /** Whether to create a new container or attach to an existing one. */
  dockerMode: "create" | "attach";
  /** Called when the docker mode changes. */
  onDockerModeChange: (mode: "create" | "attach") => void;
  /** Docker image for new container creation. */
  image: string;
  /** Called when the image value changes. */
  onImageChange: (image: string) => void;
  /** Repository to clone into the new container. */
  repo: string;
  /** Called when the repo value changes. */
  onRepoChange: (repo: string) => void;
  /** Currently selected container name for attach mode. */
  attachContainer: string;
  /** Called when the attach container selection changes. */
  onAttachContainerChange: (container: string) => void;
  /** Current environment name (used for auto-fill). */
  envName: string;
  /** Called when the environment name should be auto-filled from the container. */
  onEnvNameChange: (name: string) => void;
  /** Running Docker containers available to attach to. */
  dockerContainers: DockerContainer[];
  /** Non-fatal error from listing Docker containers (e.g. docker CLI unavailable). */
  dockerContainersError: string;
  /** Callback to list running Docker containers. */
  onListDockerContainers: () => void;
}

/**
 * Docker source picker — toggle between creating a new container and attaching
 * to an existing one. Shows container discovery or a manual-entry fallback.
 */
export function DockerContainerPicker({
  dockerMode,
  onDockerModeChange,
  image,
  onImageChange,
  repo,
  onRepoChange,
  attachContainer,
  onAttachContainerChange,
  envName,
  onEnvNameChange,
  dockerContainers,
  dockerContainersError,
  onListDockerContainers,
}: DockerContainerPickerProps): JSX.Element {
  return (
    <>
      <div className={styles.section}>
        <label className={styles.label} htmlFor="env-docker-mode">
          Source
        </label>
        <select
          id="env-docker-mode"
          value={dockerMode}
          onChange={(e) => {
            const next = e.target.value as "create" | "attach";
            onDockerModeChange(next);
            if (next === "attach") {
              onListDockerContainers();
            }
          }}
          className={styles.adapterSelect}
          data-testid="env-docker-mode"
        >
          <option value="create">Create new container</option>
          <option value="attach">Attach to existing container</option>
        </select>
      </div>

      {dockerMode === "create" ? (
        <>
          <div className={styles.section}>
            <label className={styles.label} htmlFor="env-create-image">
              Image
            </label>
            <input
              id="env-create-image"
              type="text"
              value={image}
              onChange={(e) => onImageChange(e.target.value)}
              placeholder="Image (optional)..."
              className={styles.fieldInput}
              data-testid="env-create-image"
            />
          </div>
          <div className={styles.section}>
            <label className={styles.label} htmlFor="env-create-repo">
              Repo
            </label>
            <input
              id="env-create-repo"
              type="text"
              value={repo}
              onChange={(e) => onRepoChange(e.target.value)}
              placeholder="Repo (optional)..."
              className={styles.fieldInput}
              data-testid="env-create-repo"
            />
          </div>
        </>
      ) : (
        <div className={styles.section}>
          <label className={styles.label}>Container</label>
          {!dockerContainersError && dockerContainers.length > 0 && (
            <select
              value={attachContainer}
              onChange={(e) => {
                onAttachContainerChange(e.target.value);
                if (e.target.value && !envName.trim()) {
                  onEnvNameChange(e.target.value);
                }
              }}
              className={styles.adapterSelect}
              data-testid="env-docker-container-select"
            >
              <option value="">Select a container...</option>
              {dockerContainers.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name} ({c.image}) {c.status}
                </option>
              ))}
            </select>
          )}
          {/* Manual entry fallback: shown on listing error OR when no running
              containers were found, so the user is never stuck with an empty picker. */}
          {(dockerContainersError || dockerContainers.length === 0) && (
            <>
              {dockerContainersError ? (
                <span className={styles.errorHint}>{dockerContainersError}</span>
              ) : (
                <span className={styles.creatingHint}>No running containers found.</span>
              )}
              <input
                type="text"
                value={attachContainer}
                onChange={(e) => {
                  onAttachContainerChange(e.target.value);
                  if (e.target.value && !envName.trim()) {
                    onEnvNameChange(e.target.value);
                  }
                }}
                placeholder="Enter container name/ID..."
                className={styles.fieldInput}
                data-testid="env-docker-container-manual"
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
