/**
 * Application-level database seeding — creates default personas, root task,
 * optional plugin rows, and backfills settings for fresh installs and upgrades.
 *
 * Separated from {@link initDatabase} (which owns schema migrations) so that
 * the persistence layer stays free of business/domain knowledge.
 */
import type Database from "better-sqlite3";
import { SYSTEM_PERSONA_ID, ROOT_TASK_ID } from "@grackle-ai/common";

/**
 * Seed the database with application-level defaults.
 * Call once at startup after {@link initDatabase} has applied schema migrations.
 *
 * @param conn - The raw better-sqlite3 connection to seed.
 */
export function seedDatabase(conn: InstanceType<typeof Database>): void {
  // Capture persona count BEFORE any seed inserts so we can distinguish
  // fresh installs from upgrades in the onboarding backfill below.
  const personaCount = conn
    .prepare("SELECT COUNT(*) as cnt FROM personas")
    .get() as { cnt: number };

  // Seed: create default "Claude Code" persona if no personas exist
  if (personaCount.cnt === 0) {
    conn.exec(`
      INSERT INTO personas (id, name, description, system_prompt, runtime, model, max_turns)
      VALUES (
        'claude-code',
        'Claude Code',
        'Default agent persona using Claude Code runtime',
        '',
        'claude-code',
        'sonnet',
        0
      )
    `);
    conn.exec(`
      INSERT OR IGNORE INTO settings (key, value)
      VALUES ('default_persona_id', 'claude-code')
    `);
  }

  // Migration: update the seed persona with the completion checklist and clearer name.
  // Guards: only run when the system_prompt is still empty and name is still "Claude Code"
  // so we don't overwrite user customizations.
  conn.exec(`
    UPDATE personas SET system_prompt = 'When you have finished implementing the task, you MUST complete ALL steps below in order. Do NOT stop early or go to "waiting for input" until every step is done.

### Phase 1: Implement & Test
1. **Implement** the task requirements.
2. **Write tests**: Write unit tests, integration tests, or E2E specs as appropriate. Every implementation MUST include tests unless the change is purely cosmetic or untestable (state why if skipping).
3. **Build**: Run the repository''s build command and fix any errors.
4. **Run tests**: Run relevant tests and ensure they pass.
5. **Manual test**: If the change affects UI, visually verify. If it affects CLI or API, run the commands manually. State explicitly if skipping and why.

### Phase 2: Create PR
6. **Sync with main**: Fetch and merge the main branch. If merge conflicts arise, resolve them, stage, and commit the merge. NEVER rebase.
7. **Rebuild after merge**: If the merge brought in new commits, rebuild to catch integration conflicts.
8. **Commit**: Stage your changed files and create a descriptive git commit. Use a conventional commit message (e.g., fix: ..., feat: ...).
9. **Push**: Push your branch to the remote.
10. **Create PR**: Create a pull request that links back to the issue (e.g., "Closes #ISSUE").

### Phase 3: PR Readiness (you MUST complete this — do NOT skip)
After creating the PR, you must ensure it is ready to merge.

11. **Check for merge conflicts**: Verify the PR has no merge conflicts. If it does, fetch and merge the main branch, resolve conflicts, rebuild, commit, and push.
12. **Wait for CI**: Wait for all CI checks to complete. If any check fails, read the logs, fix the issue, commit, push, and repeat.
13. **Address code review comments**: Check for automated code review comments. For each unresolved comment: read the suggestion, fix the code or dismiss with an explanation, reply to the comment, and resolve the thread. After fixing, commit, push, and check again. Repeat until all review threads are resolved.
14. **Post finding**: Use finding_post to summarize what you did and any key decisions.

IMPORTANT: The PR is the deliverable, but a PR with failing CI or unresolved review comments is NOT done. You MUST complete Phase 3. Do NOT go to "waiting for input" until CI is green AND all review threads are resolved.'
    WHERE id = 'claude-code' AND system_prompt = '' AND name = 'Claude Code'
  `);
  conn.exec(`
    UPDATE personas
    SET name = 'Software Engineer',
        description = 'Default agent persona for software engineering tasks'
    WHERE id = 'claude-code'
      AND name = 'Claude Code'
      AND NOT EXISTS (
        SELECT 1 FROM personas
        WHERE name = 'Software Engineer'
          AND id != 'claude-code'
      )
  `);

  // Seed: ensure a System persona exists with the canonical SYSTEM_PERSONA_ID.
  // Copies runtime + model from the seed persona so the FRE choice propagates.
  // Handles name collisions: if a user-created persona named "System" already
  // exists under a different id, reassign it to SYSTEM_PERSONA_ID.
  {
    const existingSystemById = conn
      .prepare("SELECT id FROM personas WHERE id = ?")
      .get(SYSTEM_PERSONA_ID) as { id: string } | undefined;

    if (!existingSystemById) {
      const seedRow = conn
        .prepare("SELECT runtime, model FROM personas WHERE id = 'claude-code'")
        .get() as { runtime: string; model: string } | undefined;
      const systemRuntime = seedRow?.runtime || "claude-code";
      const systemModel = seedRow?.model || "sonnet";

      const existingSystemByName = conn
        .prepare("SELECT id FROM personas WHERE name = 'System'")
        .get() as { id: string } | undefined;

      if (existingSystemByName && existingSystemByName.id !== SYSTEM_PERSONA_ID) {
        // Reassign existing "System" persona to the canonical id and update
        // all stored references atomically so a crash can't leave dangling refs.
        const reassignSystemPersona = conn.transaction((oldId: string) => {
          conn.prepare("UPDATE personas SET id = ? WHERE id = ?").run(SYSTEM_PERSONA_ID, oldId);
          conn.prepare("UPDATE settings SET value = ? WHERE key = 'default_persona_id' AND value = ?").run(SYSTEM_PERSONA_ID, oldId);
          conn.prepare("UPDATE sessions SET persona_id = ? WHERE persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
          conn.prepare("UPDATE tasks SET default_persona_id = ? WHERE default_persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
          conn.prepare("UPDATE workspaces SET default_persona_id = ? WHERE default_persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
        });
        reassignSystemPersona(existingSystemByName.id);
      } else if (!existingSystemByName) {
        conn
          .prepare(`
            INSERT INTO personas (id, name, description, system_prompt, runtime, model, max_turns, type)
            VALUES (?, 'System', 'Central orchestrator persona', ?, ?, ?, 0, 'agent')
          `)
          .run(
            SYSTEM_PERSONA_ID,
            [
              "You are the System — the central orchestrator for Grackle, an agent kernel that manages AI coding agents.",
              "",
              "You help the user coordinate work across their development environments. You can:",
              "- Answer questions and have conversations",
              "- Help plan and break down work into tasks",
              "- Create and manage workspaces (project containers tied to environments)",
              "- Create, assign, and monitor tasks executed by AI coding agents",
              "- Share and query findings (knowledge shared between agents)",
              "",
              "When the user describes work to be done:",
              "1. Help them think through the approach",
              "2. Break complex work into discrete, well-scoped tasks",
              "3. Create tasks with clear titles and descriptions that an AI agent can execute independently",
              "4. Start tasks on appropriate environments",
              "5. Monitor progress and report results",
              "",
              "You are always available for conversation. Think of yourself as the user's AI project manager — you coordinate the agents, track progress, and ensure work is organized effectively.",
              "",
              "Keep responses concise and action-oriented. When the user wants something done, bias toward creating and starting tasks rather than lengthy discussion.",
            ].join("\n"),
            systemRuntime,
            systemModel,
          );
      }
    }
  }

  // Seed: create root task (well-known "system" task) if it doesn't exist.
  conn
    .prepare(`
      INSERT OR IGNORE INTO tasks (id, workspace_id, title, description, status, branch, parent_task_id, depth, can_decompose, default_persona_id)
      VALUES (?, NULL, 'System', '', 'not_started', 'system', '', 0, 1, ?)
    `)
    .run(ROOT_TASK_ID, SYSTEM_PERSONA_ID);

  // Backfill: ensure default_persona_id setting exists for upgrades.
  // Existing installations may have personas but no default_persona_id setting,
  // which would cause resolvePersona() to fail when no persona is explicitly specified.
  const existingDefault = conn
    .prepare("SELECT value FROM settings WHERE key = 'default_persona_id'")
    .get() as { value: string } | undefined;
  if (!existingDefault) {
    // Prefer the seed persona 'claude-code' if it exists; otherwise fall back
    // to the first persona alphabetically.
    const fallback = (
      conn.prepare("SELECT id FROM personas WHERE id = 'claude-code'").get() ??
      conn.prepare("SELECT id FROM personas ORDER BY name LIMIT 1").get()
    ) as { id: string } | undefined;
    if (fallback) {
      conn
        .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_persona_id', ?)")
        .run(fallback.id);
    }
  }

  // Seed: ensure optional plugin rows exist with correct initial enabled state.
  // Uses INSERT OR IGNORE so existing DB rows are never overwritten (DB is authoritative after first run).
  // On first run, env vars can override the default (all plugins default to enabled=true).
  const orchestrationEnabled = process.env["GRACKLE_SKIP_ORCHESTRATION"] === "1" ? 0 : 1;
  const schedulingEnabled = process.env["GRACKLE_SKIP_SCHEDULING"] === "1" ? 0 : 1;
  // GRACKLE_KNOWLEDGE_ENABLED defaults true; only false when explicitly set to "false"
  const knowledgeEnabled = process.env["GRACKLE_KNOWLEDGE_ENABLED"] === "false" ? 0 : 1;

  conn
    .prepare("INSERT OR IGNORE INTO plugins (name, enabled) VALUES (?, ?)")
    .run("orchestration", orchestrationEnabled);
  conn
    .prepare("INSERT OR IGNORE INTO plugins (name, enabled) VALUES (?, ?)")
    .run("scheduling", schedulingEnabled);
  conn
    .prepare("INSERT OR IGNORE INTO plugins (name, enabled) VALUES (?, ?)")
    .run("knowledge", knowledgeEnabled);

  // Backfill: ensure onboarding_completed setting exists.
  // Fresh installs (no pre-existing environments or personas) get "false" to trigger
  // the setup wizard. Upgrades (pre-existing data) get "true" to skip it.
  // personaCount was captured before the seed insert, so it reflects user-created personas.
  const existingOnboarding = conn
    .prepare("SELECT value FROM settings WHERE key = 'onboarding_completed'")
    .get() as { value: string } | undefined;
  if (!existingOnboarding) {
    const environmentCount = conn
      .prepare("SELECT COUNT(*) as cnt FROM environments")
      .get() as { cnt: number };
    const isFreshInstall = environmentCount.cnt === 0 && personaCount.cnt === 0;
    conn
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_completed', ?)")
      .run(isFreshInstall ? "false" : "true");
  }
}
