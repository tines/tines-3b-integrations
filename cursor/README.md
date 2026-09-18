# Tines 3B

Cursor plugin that connects agents to [Tines 3B](https://www.tines.com/3b/) through your tenant's own [Model Context Protocol](https://modelcontextprotocol.io/) server at `https://<tenant>/mcp`.

Explore spaces and workflows, inspect runs and executions, author steps, and publish changes — all as the signed-in 3B user, under that user's own permissions.

## Install

1. Open **Cursor Settings → Plugins**.
2. Search for **Tines 3B**.
3. Click **Install**, set your tenant MCP URL (below), then complete the 3B sign-in prompt.

Or run `/add-plugin tines-3b` in chat.

## MCP

```json
{
  "mcpServers": {
    "tines-3b": {
      "type": "http",
      "url": "${TINES_3B_MCP_URL}"
    }
  }
}
```

3B supports OAuth dynamic client registration and PKCE, so there is no client ID or secret to create. Cursor registers itself and opens the 3B sign-in page on first use.

## Setup

Set **3B tenant MCP URL** to your 3B sign-in origin plus `/mcp`. Sign in to 3B and copy the origin from your browser's address bar:

| Your 3B tenant | MCP URL |
|:---------------|:--------|
| `https://acme.3b.dev` | `https://acme.3b.dev/mcp` |

On a team marketplace an admin sets this value once for the whole team. Each member still signs in individually, so tools run with that member's own 3B permissions.

### OAuth vs. service accounts

Complete the **OAuth** sign-in when prompted. A service-account token can explore, run, and ask the 3B AI to build, but it cannot write files or publish, so direct step editing will fail.

## Skills

The bundled `tines-3b-skills` skill installs the [`tines/skills`](https://github.com/tines/skills) collection (`npx skills add tines/skills`) on first use, so workflow-building guidance stays on `main` rather than being pinned inside this plugin.

## Troubleshooting

| Symptom | Cause |
|:--------|:------|
| No `tines-3b` tools in chat | The tenant MCP URL is unset or missing the `/mcp` suffix. |
| Sign-in succeeds but writes and publishes fail | You authenticated with a service-account token instead of OAuth. |
| `push_live` is refused | The space syncs with a git repository. Use `sync_git` and open a pull request instead. |

## Docs

- [Connect an AI client to Tines 3B with MCP](https://docs.3b.tines.com/en/articles/16050745-connect-an-ai-client-to-tines-3b-with-mcp)
- [Agent Plugins standard](https://agent-plugins.org/)

## Standards

This directory is an [Agent Plugin](https://agent-plugins.org/): `plugin.json` and `skills/` follow the 1.0.0 specification and are portable to any client that implements it.

Everything Cursor-specific lives in `.cursor-plugin/plugin.json` — the logo, the marketplace category, and the `TINES_3B_MCP_URL` variable with its `mcpServers` config. Those parts cannot be expressed portably: the standard's manifest schema has no logo field, and it forbids placeholder expansion in remote MCP URLs, which a per-tenant 3B origin requires. Keeping them in the Cursor namespace leaves the portable core conformant, so a non-Cursor client reading this directory gets a valid plugin with the skill.
