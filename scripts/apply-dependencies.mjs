#!/usr/bin/env node
/**
 * Apply dependency edges to all tasks in the grackle-github-backlog project.
 *
 * Usage:
 *   node scripts/apply-dependencies.mjs [--dry-run]
 *
 * This script:
 * 1. Lists all tasks via the Grackle CLI
 * 2. Builds an issue# → taskId mapping
 * 3. Validates the dependency graph
 * 4. Applies dependencies via `grackle task update --depends-on`
 * 5. Prints a summary
 */

import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "packages", "cli", "dist", "index.js");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PROJECT_ID = "grackle-github-backlog";

// ---------------------------------------------------------------------------
// Dependency graph: issue# → [issue# dependencies]
// Only direct dependencies (not transitive).
// ---------------------------------------------------------------------------

const DEPENDENCY_GRAPH = {
  // === ORCHESTRATION: Agent Subtasks (#149 group) ===
  186: [185],           // Server depends on Proto
  187: [186],           // PowerLine depends on Server
  188: [187, 381],      // System context depends on PowerLine + orchestrator prompt
  189: [186, 187, 188], // Integration tests depend on all pieces
  343: [186],           // MCP orchestrator tools depend on Server

  // === ORCHESTRATION: Waiting State (#150 group) ===
  192: [191],           // Server depends on Proto
  193: [192],           // CLI depends on Server
  194: [192],           // Web UI depends on Server
  195: [192, 193, 194], // Tests depend on all pieces

  // === ORCHESTRATION: Escalation (#151 group) ===
  197: [196],                  // Database depends on Proto
  198: [196, 197],             // Server depends on Proto + Database
  199: [198],                  // PowerLine depends on Server
  200: [198],                  // CLI depends on Server
  201: [198],                  // Web UI depends on Server
  202: [198, 199, 200, 201],   // Tests depend on all pieces

  // === ORCHESTRATION: Reconciliation (#152 group) ===
  204: [203],                  // Stall detection depends on Core loop
  205: [203],                  // Consistency depends on Core loop
  206: [203, 204, 205],        // Auto-dispatch depends on Core + stall + consistency
  207: [203, 204, 205, 206],   // Config depends on all core pieces
  208: [207],                  // Web UI depends on Config
  209: [204, 205, 206],        // Tests depend on feature pieces

  // === ORCHESTRATION: Environment Affinity (#229 group) ===
  231: [230],           // Lease depends on Paused state
  232: [230, 231],      // inheritEnvironment depends on paused + lease
  233: [231, 232, 203], // Reconciliation lease expiry depends on lease + inheritEnv + core loop

  // === ORCHESTRATION: Event Bus & Triggers ===
  346: [345],           // External triggers depend on Event bus
  344: [343, 345],      // Long-lived sessions depend on MCP tools + Event bus
  347: [198, 199, 345], // Structured escalation depends on escalation server + PL + event bus

  // === ORCHESTRATION: Orchestrator Prompt & Persona ===
  381: [146, 185],      // Orchestrator prompt depends on Persona system + subtask proto
  173: [146],           // Persona Web UI selector depends on Persona system
  174: [146],           // Persona Web UI management depends on Persona system
  175: [146, 173, 174], // Persona integration tests depend on system + UIs

  // === ORCHESTRATION: Advanced Features ===
  382: [192, 345],      // Auto-resume parent depends on Waiting server + Event bus
  153: [192, 345],      // Event triggers depends on Waiting server + Event bus
  158: [206, 231],      // Environment scheduling depends on Auto-dispatch + Lease
  383: [206],           // Concurrency limits depends on Auto-dispatch
  384: [146, 343],      // Persona auto-selection depends on Persona + MCP tools
  385: [343, 381],      // Decomposition budget depends on MCP tools + prompt
  387: [203],           // Agent heartbeat depends on Reconciliation core loop
  261: [158],           // Workspace hygiene depends on Environment scheduling

  // === ORCHESTRATION: Late-Stage Features ===
  154: [153, 345],      // Scheduled triggers depend on Event triggers + Event bus
  155: [346, 345],      // Webhook triggers depend on External triggers + Event bus
  156: [188, 381],      // Hierarchical context depends on System context + prompt
  157: [382, 153],      // Failure propagation depends on Auto-resume + Event triggers
  159: [192],           // Task tree visualization depends on Waiting server
  160: [189],           // Finding scoping depends on Subtask integration
  161: [344],           // Conversation history depends on Long-lived sessions
  162: [189, 382],      // Artifacts depends on Subtask integration + Auto-resume
  163: [188, 381],      // Decomposition heuristics depends on System context + prompt
  246: [153, 346],      // CI/Copilot auto-trigger depends on Event triggers + External triggers

  // === ORCHESTRATION: Future/Research ===
  386: [188, 381, 385], // Swarm dry-run depends on System context + prompt + budget
  164: [189],           // Cross-branch deps depends on Subtask integration
  165: [347, 161],      // Style mimic depends on Structured escalation + History
  166: [146, 384],      // Recruiter persona depends on Persona + Auto-selection
  167: [162, 385],      // Self-improvement depends on Artifacts + Budget

  // === UX AUDIT: Task Workflows ===
  297: [295],           // Dependency management UI depends on Unified create/edit
  299: [295],           // Environment at start time depends on Unified create/edit
  298: [296],           // Project creation depends on Project detail view

  // === UX AUDIT: Cross-epic (orchestration → UX) ===
  113: [192],           // Resume suspended session depends on Waiting server

  // === BRANDING ===
  276: [275],           // Documentation website depends on Logo
  277: [275],           // GitHub social preview depends on Logo
  278: [275],           // Package READMEs depends on Logo
  279: [280],           // CLI banner depends on Color palette
};

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/** Run Grackle CLI and return stdout. */
function grackle(...args) {
  const cmd = `node "${CLI}" ${args.join(" ")}`;
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

/** Strip ANSI escape codes. */
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("Fetching tasks from Grackle...");
  const rawOutput = grackle("task", "list", PROJECT_ID);
  const clean = stripAnsi(rawOutput);

  // Parse issue# → taskId from CLI table output
  // Each row looks like: │ <taskId>  │ #<issue>: <title>... │ ...
  const issueToTaskId = new Map();
  const lines = clean.split("\n");
  for (const line of lines) {
    const cells = line.split("│").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const taskId = cells[0];
    const titleCell = cells[1];
    const issueMatch = titleCell.match(/^#(\d+):/);
    if (issueMatch && /^[0-9a-f]{8}$/.test(taskId)) {
      issueToTaskId.set(parseInt(issueMatch[1], 10), taskId);
    }
  }

  console.log(`Mapped ${issueToTaskId.size} issues to task IDs.`);

  // Validate
  let errors = 0;
  for (const [issue, deps] of Object.entries(DEPENDENCY_GRAPH)) {
    const issueNum = parseInt(issue, 10);
    if (!issueToTaskId.has(issueNum)) {
      console.error(`ERROR: Issue #${issueNum} not found in Grackle tasks`);
      errors++;
    }
    for (const dep of deps) {
      if (!issueToTaskId.has(dep)) {
        console.error(
          `ERROR: Dependency #${dep} (required by #${issueNum}) not found`,
        );
        errors++;
      }
    }
  }

  if (errors > 0) {
    console.error(`\n${errors} validation errors. Aborting.`);
    process.exit(1);
  }
  console.log("Validation passed.\n");

  // Apply dependencies
  let applied = 0;
  let failed = 0;
  const total = Object.keys(DEPENDENCY_GRAPH).length;

  for (const [issue, deps] of Object.entries(DEPENDENCY_GRAPH)) {
    const issueNum = parseInt(issue, 10);
    const taskId = issueToTaskId.get(issueNum);
    const depTaskIds = deps.map((d) => issueToTaskId.get(d));
    const depLabels = deps.map((d) => `#${d}`).join(", ");

    console.log(`[${applied + failed + 1}/${total}] #${issueNum} (${taskId}) → [${depLabels}]`);

    if (!DRY_RUN) {
      try {
        grackle("task", "update", taskId, "--depends-on", depTaskIds.join(","));
        applied++;
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        failed++;
      }
    } else {
      applied++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total rules:  ${total}`);
  console.log(`Applied:      ${applied}`);
  console.log(`Failed:       ${failed}`);
  if (DRY_RUN) {
    console.log("(DRY RUN — no changes were made)");
  }
}

main();
