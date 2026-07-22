---
summary: "Set up Codex Computer Use for Codex-mode OpenClaw agents"
title: "Codex Computer Use"
read_when:
  - You want Codex-mode OpenClaw agents to use Codex Computer Use
  - You are deciding between Codex Computer Use, PeekabooBridge, and direct cua-driver MCP
  - You are deciding between Codex Computer Use and a direct cua-driver MCP setup
  - You are troubleshooting the managed Codex Computer Use plugin
---

Computer Use is a Codex-native MCP plugin for local desktop control. OpenClaw
does not vendor the desktop app, execute desktop actions itself, or bypass
Codex permissions. The bundled `codex` plugin installs the fixed sky-cua
Computer Use plugin before the first app-server thread, then lets Codex own
the native MCP tool calls during Codex-mode turns.

Use this page when OpenClaw is already using the native Codex harness. For the
runtime setup itself, see [Codex harness](/plugins/codex-harness).

## OpenClaw.app and Peekaboo

OpenClaw.app's Peekaboo integration is separate from Codex Computer Use. The
macOS app can host a PeekabooBridge socket so the `peekaboo` CLI can reuse the
app's local Accessibility and Screen Recording grants for Peekaboo's own
automation tools. That bridge does not install or proxy Codex Computer Use, and
Codex Computer Use does not call through the PeekabooBridge socket.

Use [Peekaboo bridge](/platforms/mac/peekaboo) when you want OpenClaw.app to be
a permission-aware host for Peekaboo CLI automation. Use this page when a
Codex-mode OpenClaw agent should have Codex's native `computer-use` MCP plugin
available before the turn starts.

## iOS app

The iOS app is separate from Codex Computer Use. It does not install or proxy
the Codex `computer-use` MCP server and it is not a desktop-control backend.
Instead, the iOS app connects as an OpenClaw node and exposes mobile
capabilities through node commands such as `canvas.*`, `camera.*`, `screen.*`,
`location.*`, and `talk.*`.

Use [iOS](/platforms/ios) when you want an agent to drive an iPhone node
through the gateway. Use this page when a Codex-mode agent should control the
local macOS desktop through Codex's native Computer Use plugin.

## Direct cua-driver MCP

Codex Computer Use is not the only way to expose desktop control. If you want
OpenClaw-managed runtimes to call TryCua's driver directly, use the upstream
`cua-driver mcp` server through OpenClaw's MCP registry instead of the
Codex-specific marketplace flow.

After installing `cua-driver`, either ask it for the OpenClaw command:

```bash
cua-driver mcp-config --client openclaw
```

or register the stdio server directly:

```bash
openclaw mcp set cua-driver '{"command":"cua-driver","args":["mcp"]}'
```

That path keeps the upstream MCP tool surface intact, including the driver
schemas and structured MCP responses. Use it when you want the CUA driver
available as a normal OpenClaw MCP server. Use the Codex Computer Use setup on
this page when Codex app-server should own plugin installation, MCP reloads,
and native tool calls inside Codex-mode turns.

CUA's driver is macOS-specific and still requires the local macOS permissions
its app prompts for, such as Accessibility and Screen Recording. OpenClaw does
not install `cua-driver`, grant those permissions, or bypass the upstream
driver's safety model.

## Quick setup

Install sky-cua into its fixed data root and enable the bundled `codex` plugin.
OpenClaw installs Computer Use and Browser Use from that marketplace before
the first Codex thread for each app-server client. Start a new Codex thread or
restart the app-server client after replacing the sky-cua installation.

On macOS managed stdio startup, OpenClaw prefers the signed desktop Codex app
bundle at `/Applications/Codex.app/Contents/Resources/codex` when it exists.
That keeps Computer Use under the app bundle that owns the local
desktop-control permissions. If the desktop app is not installed, OpenClaw
falls back to the managed Codex binary installed beside the plugin. If an
installed desktop app initializes with an unsupported app-server version,
OpenClaw closes that child and retries the next managed binary candidate
instead of letting a stale desktop app shadow the plugin-local fallback.
Explicit `appServer.command` config or `OPENCLAW_CODEX_APP_SERVER_BIN` still
overrides this managed selection.

## Managed Codex installation

OpenClaw installs Computer Use automatically before the first native Codex
thread for each app-server client. It uses the fixed sky-cua marketplace:

```text
${XDG_DATA_HOME:-~/.local/share}/sky-cua/codex/openai-bundled/.agents/plugins/marketplace.json
```

There is no `/codex computer-use` install or status command and no marketplace
override. OpenClaw installs `computer-use@openai-bundled`, then verifies the
effective Codex configured-plugin map so no enabled `computer-use@*` entry
from another marketplace can shadow it. A conflict fails the thread
explicitly; disable the legacy Codex plugin before retrying.

## What OpenClaw checks

OpenClaw fails the first thread if the fixed install fails or another enabled
Computer Use plugin could shadow `computer-use@openai-bundled`.

## macOS permissions

Computer Use is macOS-specific. The Codex-owned MCP server may need local OS
permissions before it can inspect or control apps. If OpenClaw says Computer
Use is installed but the MCP server is unavailable, verify the Codex-side
Computer Use setup first:

- Codex app-server is running on the same host where desktop control should
  happen.
- The Computer Use plugin is enabled in Codex config.
- The `computer-use` MCP server appears in Codex app-server MCP status.
- macOS has granted the required permissions for the desktop-control app.
- The current host session can access the desktop being controlled.

OpenClaw intentionally fails closed before a Codex-mode turn can proceed
without the managed native desktop tools.

## Troubleshooting

**The managed install fails.** Verify that sky-cua is installed at the fixed
data root and that its marketplace manifest exists. Restart the Codex
app-server client after repairing the producer installation so OpenClaw runs
the managed installs again.

**A conflicting plugin is enabled.** Disable the reported legacy
`computer-use@<marketplace>` entry in Codex config. OpenClaw does not
automatically uninstall Codex plugins.

**Status or a probe times out on `computer-use.list_apps`.** The plugin and
MCP server are present, but the local Computer Use bridge did not answer.
Quit or restart Codex Computer Use, relaunch Codex Desktop if needed, then
retry in a fresh OpenClaw session. Restart the Codex app-server client to
refresh the plugin from the fixed sky-cua marketplace.

**A Computer Use tool says `Native hook relay unavailable`.** The
Codex-native tool hook could not reach an active OpenClaw relay through the
local bridge or Gateway fallback. Start a fresh OpenClaw session with `/new`
or `/reset`. If it works once and then fails again on a later tool call,
`/new` is only clearing the current attempt; restart the Codex app-server or
OpenClaw Gateway so old threads and hook registrations are dropped, then
retry in a fresh session.

## Related

- [Codex harness](/plugins/codex-harness)
- [Peekaboo bridge](/platforms/mac/peekaboo)
- [iOS app](/platforms/ios)
