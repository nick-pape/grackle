import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies before importing ──────────────

vi.mock("@grackle-ai/core", () => ({
  registerAdapter: vi.fn(),
  exec: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@grackle-ai/database", () => ({
  credentialProviders: {
    getCredentialProviders: vi.fn(() => ({ github: "oauth" })),
  },
}));

vi.mock("@grackle-ai/adapter-docker", () => ({
  DockerAdapter: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-local", () => ({
  LocalAdapter: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-ssh", () => ({
  SshAdapter: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-codespace", () => ({
  CodespaceAdapter: vi.fn(),
}));

import { registerAllAdapters } from "./adapter-registry.js";
import { registerAdapter } from "@grackle-ai/core";
import { credentialProviders } from "@grackle-ai/database";
import { DockerAdapter } from "@grackle-ai/adapter-docker";
import { LocalAdapter } from "@grackle-ai/adapter-local";
import { SshAdapter } from "@grackle-ai/adapter-ssh";
import { CodespaceAdapter } from "@grackle-ai/adapter-codespace";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerAllAdapters", () => {
  it("registers exactly 4 adapters", () => {
    registerAllAdapters();
    expect(registerAdapter).toHaveBeenCalledTimes(4);
  });

  it("registers a DockerAdapter", () => {
    registerAllAdapters();
    expect(DockerAdapter).toHaveBeenCalledOnce();
    expect(registerAdapter).toHaveBeenCalledWith(expect.any(DockerAdapter as unknown as Function));
  });

  it("registers a LocalAdapter", () => {
    registerAllAdapters();
    expect(LocalAdapter).toHaveBeenCalledOnce();
    expect(registerAdapter).toHaveBeenCalledWith(expect.any(LocalAdapter as unknown as Function));
  });

  it("registers an SshAdapter", () => {
    registerAllAdapters();
    expect(SshAdapter).toHaveBeenCalledOnce();
    expect(registerAdapter).toHaveBeenCalledWith(expect.any(SshAdapter as unknown as Function));
  });

  it("registers a CodespaceAdapter", () => {
    registerAllAdapters();
    expect(CodespaceAdapter).toHaveBeenCalledOnce();
    expect(registerAdapter).toHaveBeenCalledWith(expect.any(CodespaceAdapter as unknown as Function));
  });

  it("passes exec and logger to Docker, SSH, and Codespace adapter deps", () => {
    registerAllAdapters();
    // Docker, SSH, Codespace all receive adapterDeps with exec, logger, isGitHubProviderEnabled
    for (const AdapterClass of [DockerAdapter, SshAdapter, CodespaceAdapter]) {
      const call = (AdapterClass as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toHaveProperty("exec");
      expect(call[0]).toHaveProperty("logger");
      expect(call[0]).toHaveProperty("isGitHubProviderEnabled");
    }
  });

  it("isGitHubProviderEnabled returns true when github provider is not off", () => {
    registerAllAdapters();
    const adapterDeps = (DockerAdapter as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(adapterDeps.isGitHubProviderEnabled()).toBe(true);
  });

  it("isGitHubProviderEnabled returns false when github provider is off", () => {
    registerAllAdapters();
    const adapterDeps = (DockerAdapter as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Change the mock to return "off"
    (credentialProviders.getCredentialProviders as ReturnType<typeof vi.fn>).mockReturnValue({ github: "off" });
    expect(adapterDeps.isGitHubProviderEnabled()).toBe(false);
  });

  it("does not pass adapterDeps to LocalAdapter", () => {
    registerAllAdapters();
    expect(LocalAdapter).toHaveBeenCalledWith();
  });
});
