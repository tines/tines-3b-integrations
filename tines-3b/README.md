# Tines 3B

An [Agent Plugin](https://agent-plugins.org/) for Tines 3B.

## Connect

1. Install this plugin.
2. Add a Streamable HTTP MCP server at `https://<tenant>/mcp` (your sign-in origin, for example `https://acme.3b.dev/mcp`).
3. Complete **OAuth**. A service-account token can explore, run, and ask 3B to build, but cannot write or publish.

The bundled `tines-3b-skills` skill installs [`tines/skills`](https://github.com/tines/skills) (`npx skills add tines/skills`) so that collection stays on `main`.

See [Connect an AI client to Tines 3B with MCP](https://docs.3b.tines.com/en/articles/16050745-connect-an-ai-client-to-tines-3b-with-mcp).
