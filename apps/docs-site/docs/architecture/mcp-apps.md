---
id: mcp-apps
title: MCP Apps
sidebar_position: 5
---

# MCP Apps

An agent does not have to answer in text. With **MCP Apps**, a tool result can carry a piece of UI — an interactive widget that renders inline in the web UI — instead of, or alongside, the words.

MCP Apps is the UI extension to the Model Context Protocol. A tool result carries a render descriptor; Grackle's web UI turns it into a live, sandboxed widget. The how-to for authoring widgets lives in [Generative UX (Widgets)](../features/widgets); this page is the protocol underneath.

## The render descriptor

A tool result becomes a widget through a small piece of metadata — the **render descriptor**, attached under a reserved `_meta` key (`io.grackle/widget-render`). The descriptor names a renderer and carries the payload that renderer needs.

Two renderer kinds exist:

| Kind            | What it renders                                                            | Trust                 |
| --------------- | -------------------------------------------------------------------------- | --------------------- |
| `mcp-app-html`  | A self-contained HTML document the agent supplies                          | Untrusted — sandboxed |
| `grackle-react` | A named, pre-registered React component rendered with agent-supplied props | Trusted — built in    |

## The render path

A widget goes from tool call to pixels in four hops:

1. **Author.** The agent calls a component/widget tool. The result carries the `_meta` render descriptor.
2. **Capture.** The MCP broker reads the descriptor in-process and emits a `widget` session event.
3. **Stream.** The event flows down the session stream to the web UI, like any other event.
4. **Render.** The web UI mounts the widget in a sandboxed, cross-origin iframe — a separate origin from the app, so untrusted agent HTML can't touch your session.

The descriptor and the `widget` event are the contract. Everything else — which tool, which renderer, what props — rides on top.

## Sandboxing untrusted HTML

`mcp-app-html` widgets are agent-authored documents. They render in a locked-down iframe on a **separate sandbox origin** (a dedicated port), so a malicious or careless document is walled off from the app, the session, and your credentials. The sandbox is the price of letting an agent draw whatever it wants.

`grackle-react` widgets are different: a fixed set of components built into the UI, named by the descriptor and fed agent-supplied props. No arbitrary code — just data into a known component.

## See also

- [Generative UX (Widgets)](../features/widgets) — the tools that produce these descriptors, and how to author a widget.
- [MCP](./mcp) — the protocol MCP Apps extends.
- [Web UI](../features/web-ui) — where widgets render.
