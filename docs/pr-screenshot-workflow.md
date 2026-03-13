# PR Screenshot Workflow

This document explains how to capture detailed screenshots for a Grackle PR and attach them to the PR description in a way that is reproducible from the CLI.

It is written for any contributor who needs to document visual changes without relying on manual browser drag-and-drop.

## When to use this

Use this workflow when:

- a PR changes the web UI or any reviewer-visible screen state
- you need screenshots in the PR description, not just local files
- you want a repeatable CLI-driven process that works from a clean checkout

## What we actually do

The workflow has five parts:

1. Identify every UI state that changed on the branch.
2. Start an isolated local Grackle stack on non-default ports.
3. Use Playwright to create the right state and save PNG screenshots.
4. Upload those screenshots to a secret gist by wrapping each PNG in an SVG file.
5. Update the PR description with markdown image links that point at the gist raw URLs.

The SVG wrapper step is important: `gh gist create` rejects binary image files, so raw PNG upload does not work.

## Prerequisites

- repo is built locally (`rush build` or targeted package builds)
- `gh auth status` succeeds
- GitHub token includes `gist` scope
- the PR already exists
- Playwright can launch Chromium locally

## 1. Identify every visible UI change

Start from the branch diff, not from memory.

Useful commands:

```bash
git diff --name-only origin/main...HEAD
git diff origin/main...HEAD -- packages/web
gh pr view <PR_NUMBER> --json body,title,url
```

Then inspect the affected UI code and tests so you do not miss variant states.

For example, if the diff adds a new selector and a new sidebar badge, you usually need screenshots for:

- the default state
- the selected/filled state
- the downstream rendered result

## 2. Start an isolated local stack

Do not reuse default ports if another session may already be running.

Use a temporary `GRACKLE_HOME` and your own ports:

```bash
GRACKLE_HOME="$(mktemp -d)"
POWERLINE_PORT=7501
SERVER_PORT=7502
WEB_PORT=7503
```

Build what you need first:

```bash
rush build -t @grackle-ai/web -t @grackle-ai/server -t @grackle-ai/powerline -t @grackle-ai/cli
```

Start PowerLine and the server:

```bash
node packages/powerline/dist/index.js --port "$POWERLINE_PORT"

GRACKLE_HOME="$GRACKLE_HOME" \
GRACKLE_PORT="$SERVER_PORT" \
GRACKLE_WEB_PORT="$WEB_PORT" \
GRACKLE_WEB_DIR="$(pwd)/packages/web/dist" \
node packages/server/dist/index.js
```

Then point the CLI at that server and provision a local environment:

```bash
API_KEY="$(cat "$GRACKLE_HOME/.grackle/api-key")"

GRACKLE_HOME="$GRACKLE_HOME" \
GRACKLE_URL="http://127.0.0.1:$SERVER_PORT" \
GRACKLE_API_KEY="$API_KEY" \
node packages/cli/dist/index.js env add test-local --local --port "$POWERLINE_PORT" --runtime stub

GRACKLE_HOME="$GRACKLE_HOME" \
GRACKLE_URL="http://127.0.0.1:$SERVER_PORT" \
GRACKLE_API_KEY="$API_KEY" \
node packages/cli/dist/index.js env provision test-local
```

At this point the web app is available at `http://127.0.0.1:$WEB_PORT`.

## 3. Capture the screenshots with Playwright

Use Playwright to drive the app into the exact state you want to show.

Recommended rules:

- use stable locators (`getByRole`, `getByTestId`, named buttons)
- create fixture data inside the script instead of relying on old local state
- capture one screenshot per reviewer-relevant state
- crop to the important region when possible

Example skeleton:

```js
import playwrightCore from "../common/temp/node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/index.js";

const { chromium } = playwrightCore;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await context.newPage();

await page.goto("http://127.0.0.1:7503");
await page.waitForFunction(() => document.body.innerText.includes("Connected"));

await page.locator('button[title="Settings"]').click();
await page.locator('button[title="New chat"]').click();

const runtimeSelect = page.getByTestId("new-chat-runtime-select");
await runtimeSelect.selectOption("copilot");

await page.screenshot({ path: "docs/screenshots/example-runtime.png" });

await browser.close();
```

If the state is hard to reach through the UI, use the app WebSocket helpers or direct UI setup code to create projects, tasks, personas, and sessions first.

## 4. Upload the screenshots

### Why we use a gist

PR descriptions need a public-ish URL for markdown image embedding.

For CLI automation, a secret gist is the easiest option because:

- `gh pr edit` can reference normal markdown image URLs
- `gh gist create` works with standard token auth
- raw gist URLs are stable enough for PR descriptions

### Why we do not upload PNG directly

This does not work:

```bash
gh gist create docs/screenshots/example-runtime.png
```

`gh gist create` rejects binary files.

### The workaround: wrap PNG in SVG

Convert each PNG into a text SVG that embeds the PNG as base64 data. Gists accept the SVG file because it is text.

Example Python helper:

```python
from pathlib import Path
import base64

png_path = Path("docs/screenshots/example-runtime.png")
svg_path = Path("/tmp/example-runtime.svg")

data = png_path.read_bytes()
width = int.from_bytes(data[16:20], "big")
height = int.from_bytes(data[20:24], "big")

svg_path.write_text("\n".join([
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
    f'  <image width="{width}" height="{height}" href="data:image/png;base64,{base64.b64encode(data).decode()}" />',
    '</svg>',
    '',
]))
```

Then create the gist:

```bash
gh gist create /tmp/example-runtime.svg /tmp/example-sidebar.svg -d "PR 392 screenshots"
```

Fetch the raw URLs:

```bash
gh api gists/<GIST_ID> --jq '.files | to_entries[] | [.key,.value.raw_url] | @tsv'
```

Important: if you later replace a gist file, GitHub generates a new raw URL hash. Update the PR body to use the new raw URL values.

## 5. Attach the screenshots to the PR description

Prepare a markdown body file and then update the PR:

```md
## Screenshots

1. **Runtime selector**
![Runtime selector](https://gist.githubusercontent.com/.../raw/.../example-runtime.svg)

2. **Sidebar badge**
![Sidebar badge](https://gist.githubusercontent.com/.../raw/.../example-sidebar.svg)
```

```bash
gh pr edit <PR_NUMBER> --body-file /tmp/pr-body.md
```

This updates the remote PR immediately. No `git push` is needed for the PR description itself.

## Verification checklist

After editing the PR, verify all of the following:

- the PR body renders images inline on GitHub
- every changed UI state is represented
- the images match the current branch, not an older local run
- the raw gist URLs in the body match the latest gist revision

Helpful commands:

```bash
gh pr view <PR_NUMBER> --json body,url
gh api gists/<GIST_ID> --jq '.files | to_entries[] | [.key,.value.raw_url] | @tsv'
```

## Cleanup

After capture:

- stop only the server processes you started
- remove the temporary `GRACKLE_HOME`
- keep only screenshots that are intentionally part of the repo
- delete helper artifacts if they were created only for one-off upload automation

## Common pitfalls

- `page.locator("select")` can break after UI changes add another dropdown; prefer `getByTestId` or a named locator.
- `gh gist create` cannot upload PNG files directly.
- replacing a gist file changes the raw URL hash; stale PR markdown will keep pointing at the old asset.
- updating the PR description is a remote GitHub action, not a git commit.
- if another local Grackle session is already using the default ports, use different ports instead of reusing or killing it.

## Suggested reusable output layout

For one-off runs, this layout works well:

```text
docs/screenshots/                       # screenshots intentionally kept in git
common/temp/screenshot-helper/output/  # temporary generated artifacts and logs
```

Use `docs/screenshots/` for durable images and keep generated upload helpers under `common/temp/` so they are easy to delete later.
