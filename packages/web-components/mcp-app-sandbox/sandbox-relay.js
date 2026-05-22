// Externalized relay for the MCP Apps outer sandbox proxy (loaded by sandbox.html).
//
// Kept as a separate module — served from the sandbox origin and loaded as
// `script-src 'self'` — so the proxy CSP does NOT need `script-src 'unsafe-inline'`.
// Implements the double-iframe relay between the host and the inner untrusted
// widget per the MCP Apps spec (SEP-1865). Adapted from
// modelcontextprotocol/ext-apps examples/basic-host/src/sandbox.ts (commit 9a37ad7).

const RESOURCE_READY = "ui/notifications/sandbox-resource-ready";
const PROXY_READY = "ui/notifications/sandbox-proxy-ready";
const DEFAULT_SANDBOX = "allow-scripts allow-same-origin allow-forms";

// Must run inside an iframe on a different origin than the host.
if (window.self === window.top) {
  throw new Error("sandbox.html must be loaded inside an iframe.");
}
if (!document.referrer) {
  throw new Error("No referrer; cannot validate the embedding host origin.");
}
const EXPECTED_HOST_ORIGIN = new URL(document.referrer).origin;
const OWN_ORIGIN = new URL(window.location.href).origin;

// Security self-test: confirm we cannot reach the top window. Reading a property
// on a cross-origin window.top throws a SecurityError without any visible side
// effect (unlike alert()). If it does NOT throw, isolation is broken and we must
// refuse to run.
try {
  const probe = window.top.location.href;
  void probe;
  throw "FAIL";
} catch (e) {
  if (e === "FAIL") {
    throw new Error("Sandbox is not isolated (host and sandbox share an origin?).");
  }
}

// Minimal copy of ext-apps buildAllowAttribute: maps requested permissions to an
// iframe Permissions-Policy `allow` attribute.
function buildAllowAttribute(permissions) {
  if (!permissions || typeof permissions !== "object") {
    return "";
  }
  const map = {
    camera: "camera",
    microphone: "microphone",
    geolocation: "geolocation",
    clipboardWrite: "clipboard-write",
    clipboardRead: "clipboard-read",
    displayCapture: "display-capture",
  };
  const out = [];
  for (const key of Object.keys(permissions)) {
    if (map[key]) {
      out.push(`${map[key]} 'self'`);
    }
  }
  return out.join("; ");
}

// Target origin for host -> inner messages. When the inner iframe keeps
// `allow-same-origin`, its document shares OWN_ORIGIN, so we post to that exact
// origin — if the widget navigates the frame elsewhere, delivery stops, which
// prevents it from continuing to receive host-sent tool data. Opaque frames (no
// `allow-same-origin`) have an unnameable null origin, so "*" is the only option.
function innerTargetOrigin(sandboxValue) {
  return /\ballow-same-origin\b/.test(sandboxValue) ? OWN_ORIGIN : "*";
}

const inner = document.createElement("iframe");
inner.setAttribute("sandbox", DEFAULT_SANDBOX);
let innerOrigin = innerTargetOrigin(DEFAULT_SANDBOX);
document.body.appendChild(inner);

window.addEventListener("message", (event) => {
  if (event.source === window.parent) {
    if (event.origin !== EXPECTED_HOST_ORIGIN) {
      console.error("[sandbox] dropping parent message from", event.origin);
      return;
    }
    if (event.data && event.data.method === RESOURCE_READY) {
      const { html, sandbox, permissions } = event.data.params ?? {};
      if (typeof sandbox === "string") {
        inner.setAttribute("sandbox", sandbox);
        innerOrigin = innerTargetOrigin(sandbox);
      }
      const allow = buildAllowAttribute(permissions);
      if (allow) {
        inner.setAttribute("allow", allow);
      }
      if (typeof html === "string") {
        const doc = inner.contentDocument || inner.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();
        } else {
          inner.srcdoc = html;
        }
      }
      return;
    }
    // Relay everything else host -> inner widget, scoped to the inner origin.
    inner.contentWindow?.postMessage(event.data, innerOrigin);
  } else if (event.source === inner.contentWindow) {
    if (event.origin !== OWN_ORIGIN && event.origin !== "null") {
      console.error("[sandbox] dropping inner message from", event.origin);
      return;
    }
    // Relay inner widget -> host.
    window.parent.postMessage(event.data, EXPECTED_HOST_ORIGIN);
  }
});

window.parent.postMessage({ jsonrpc: "2.0", method: PROXY_READY, params: {} }, EXPECTED_HOST_ORIGIN);
