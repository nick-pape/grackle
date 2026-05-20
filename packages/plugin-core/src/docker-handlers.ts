import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { exec, logger } from "@grackle-ai/core";

/** Timeout for `docker ps` in milliseconds. */
const DOCKER_PS_TIMEOUT_MS: number = 15_000;

/**
 * List running Docker containers the user can attach an environment to
 * (issue #1223). Returns a non-fatal `error` string when the `docker` CLI is
 * unavailable, mirroring {@link listCodespaces}.
 */
export async function listDockerContainers(
  _req: grackle.ListDockerContainersRequest,
): Promise<grackle.DockerContainerList> {
  try {
    const result = await exec(
      "docker",
      ["ps", "--no-trunc", "--format", "{{json .}}"],
      { timeout: DOCKER_PS_TIMEOUT_MS },
    );
    const lines = (result.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const containers = lines.map((line) => {
      const entry = JSON.parse(line) as Record<string, unknown>;
      return create(grackle.DockerContainerInfoSchema, {
        id: String(entry.ID ?? ""),
        name: String(entry.Names ?? ""),
        image: String(entry.Image ?? ""),
        state: String(entry.State ?? ""),
        status: String(entry.Status ?? ""),
      });
    });
    return create(grackle.DockerContainerListSchema, { containers });
  } catch (err) {
    logger.warn({ err }, "Failed to list docker containers");
    return create(grackle.DockerContainerListSchema, {
      containers: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
