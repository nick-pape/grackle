/**
 * `grackle agent` command group — manage standing agents (#1417).
 *
 * Distinct from the top-level agent-session verbs (`spawn`, `status`, `kill`,
 * …) in `session-verbs.ts`: this group is CRUD over the standing-Agent entity.
 * Phase 0 — the Agent has no lifecycle yet, so these are plain create / list /
 * show / edit / delete commands.
 *
 * @module
 */

import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { createGrackleClients } from "../client.js";

/** Max characters of an avatar to inline in `agent list`. */
const INLINE_AVATAR_MAX_CHARS: number = 6;

/**
 * Return the avatar string when it's a short inline glyph (emoji / monogram),
 * or `""` when it's a URL / `data:` URI that would spam the terminal. The
 * full value is always available via `agent show`.
 */
function renderInlineAvatar(avatar: string): string {
  if (!avatar) {
    return "";
  }
  if (
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    avatar.startsWith("/") ||
    avatar.startsWith("data:")
  ) {
    return "";
  }
  // Multi-codepoint emoji can be > 1 character; cap at a small ceiling.
  if ([...avatar].length > INLINE_AVATAR_MAX_CHARS) {
    return "";
  }
  return avatar;
}

/**
 * Register the `agent` command group on the root program.
 *
 * @param program - The root Commander program.
 */
export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("Create and manage standing agents");

  agent
    .command("list")
    .description("List all agents")
    .action(async () => {
      const { orchestration } = createGrackleClients();
      const res = await orchestration.listAgents({});
      if (res.agents.length === 0) {
        console.log(chalk.yellow("No agents found."));
        return;
      }
      for (const a of res.agents) {
        // Inline only short glyphs (emoji / monogram). URLs and base64
        // data URIs would wrap and spam the terminal — `show` is where
        // the full value belongs.
        const inlineAvatar = renderInlineAvatar(a.avatar);
        const prefix = inlineAvatar ? `${inlineAvatar} ` : "";
        console.log(`${prefix}${chalk.bold(a.name)} ${chalk.dim(`(${a.id})`)}`);
        console.log(`  persona: ${a.primaryPersonaId || "(none)"}`);
      }
    });

  agent
    .command("show <id>")
    .description("Show details for an agent")
    .action(async (id: string) => {
      const { orchestration } = createGrackleClients();
      const a = await orchestration.getAgent({ id });
      console.log(`ID:       ${a.id}`);
      console.log(`Name:     ${a.name}`);
      console.log(`Avatar:   ${a.avatar || "-"}`);
      console.log(`Persona:  ${a.primaryPersonaId || "-"}`);
      console.log(`Env:      ${a.environmentId || "-"}`);
      console.log(`Created:  ${a.createdAt}`);
      console.log(`Updated:  ${a.updatedAt}`);
      // Heartbeat block (#1438). Empty heartbeat → one-line "-"; populated →
      // block of cadence / rules / next / last / enabled lines.
      if (a.heartbeat && a.heartbeat.id) {
        const hb = a.heartbeat;
        console.log("Heartbeat:");
        console.log(`  Cadence:   ${hb.scheduleExpression}`);
        console.log(`  Rules:     ${hb.description || "(none)"}`);
        console.log(`  Next wake: ${hb.nextRunAt || "-"}`);
        console.log(`  Last wake: ${hb.lastRunAt || "-"}`);
        console.log(`  Enabled:   ${hb.enabled ? "yes" : "no"}`);
      } else {
        console.log("Heartbeat: -");
      }
    });

  agent
    .command("create <name>")
    .description("Create an agent")
    .requiredOption("--environment <id>", "Home environment id (where the agent lives)")
    .option("--avatar <value>", "Avatar: emoji, URL, or base64 data URI", "")
    .option("--persona <id>", "Primary persona id", "")
    .action(
      async (name: string, opts: { avatar: string; persona: string; environment: string }) => {
        const { orchestration } = createGrackleClients();
        const res = await orchestration.createAgent({
          name,
          avatar: opts.avatar,
          primaryPersonaId: opts.persona,
          environmentId: opts.environment,
        });
        console.log(chalk.green(`Created agent ${chalk.bold(res.name)} (${res.id})`));
      },
    );

  agent
    .command("edit <id>")
    .description("Update an agent")
    .option("--name <name>", "New name")
    .option("--avatar <value>", "New avatar: emoji, URL, or base64 data URI")
    .option("--persona <id>", "New primary persona id")
    // ── Heartbeat (#1438) ──
    .option(
      "--heartbeat <expr>",
      'Set heartbeat cadence: interval shorthand ("30s", "5m") or 5-field cron ("0 9 * * MON")',
    )
    .option("--heartbeat-clear", "Delete the heartbeat schedule entirely")
    .option("--heartbeat-rules <text>", "Set heartbeat rules (the prompt piped in per wake)")
    .option("--heartbeat-rules-file <path>", "Set heartbeat rules from a file")
    .option("--heartbeat-pause", "Pause the heartbeat (sets enabled=false)")
    .option("--heartbeat-resume", "Resume the heartbeat (sets enabled=true)")
    .action(
      async (
        id: string,
        opts: {
          name?: string;
          avatar?: string;
          persona?: string;
          heartbeat?: string;
          heartbeatClear?: boolean;
          heartbeatRules?: string;
          heartbeatRulesFile?: string;
          heartbeatPause?: boolean;
          heartbeatResume?: boolean;
        },
      ) => {
        if (opts.heartbeatPause && opts.heartbeatResume) {
          throw new Error("Cannot pass both --heartbeat-pause and --heartbeat-resume");
        }
        if (opts.heartbeatRules !== undefined && opts.heartbeatRulesFile !== undefined) {
          throw new Error("Cannot pass both --heartbeat-rules and --heartbeat-rules-file");
        }
        const { orchestration } = createGrackleClients();

        // Identity / avatar / persona edits → UpdateAgent
        if (opts.name !== undefined || opts.avatar !== undefined || opts.persona !== undefined) {
          const res = await orchestration.updateAgent({
            id,
            name: opts.name,
            avatar: opts.avatar,
            primaryPersonaId: opts.persona,
          });
          console.log(chalk.green(`Updated agent ${chalk.bold(res.name)} (${res.id})`));
        }

        // Heartbeat edits → SetAgentHeartbeat. Presence semantics: omitted
        // fields keep their existing value; --heartbeat-clear deletes the
        // schedule outright; --heartbeat-pause / --heartbeat-resume toggle
        // enabled without re-sending cadence.
        const hasHeartbeatOpt =
          opts.heartbeat !== undefined ||
          opts.heartbeatClear === true ||
          opts.heartbeatRules !== undefined ||
          opts.heartbeatRulesFile !== undefined ||
          opts.heartbeatPause === true ||
          opts.heartbeatResume === true;
        if (!hasHeartbeatOpt) {
          return;
        }
        const rulesText =
          opts.heartbeatRulesFile !== undefined
            ? readFileSync(opts.heartbeatRulesFile, "utf8")
            : opts.heartbeatRules;
        const enabled = opts.heartbeatPause ? false : opts.heartbeatResume ? true : undefined;
        const cadence = opts.heartbeatClear ? "" : opts.heartbeat;

        const sched = await orchestration.setAgentHeartbeat({
          agentId: id,
          cadence,
          rules: rulesText,
          enabled,
        });
        if (opts.heartbeatClear) {
          console.log(chalk.green(`Cleared heartbeat for agent ${id}`));
        } else {
          console.log(
            chalk.green(
              `Updated heartbeat for agent ${id}: cadence=${sched.scheduleExpression}, enabled=${sched.enabled}`,
            ),
          );
        }
      },
    );

  agent
    .command("delete <id>")
    .description("Delete an agent")
    .action(async (id: string) => {
      const { orchestration } = createGrackleClients();
      await orchestration.deleteAgent({ id });
      console.log(chalk.green(`Deleted agent ${id}`));
    });
}
