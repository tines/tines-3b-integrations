# tines-3b-integrations

Integrations that add [Tines 3B](https://www.tines.com/3b/) functionality to other agent platforms and marketplaces. One directory per platform.

| Platform | Directory | Notes |
|:---------|:----------|:------|
| Cursor | [`cursor/`](cursor/) | [Agent Plugin](https://agent-plugins.org/) with a Cursor manifest overlay. Listed via [`.cursor-plugin/marketplace.json`](.cursor-plugin/marketplace.json). |

## Adding a platform

Create a directory for it. If the platform discovers plugins through a manifest at the repository root, add that manifest alongside `.cursor-plugin/` rather than moving anything into the root — each integration stays self-contained in its own directory.

For Cursor specifically, add an entry to `.cursor-plugin/marketplace.json` whose `source` is the new directory, and give that directory a `.cursor-plugin/plugin.json`. Cursor resolves a marketplace entry's `source` to `<source>/.cursor-plugin/plugin.json`.

## Validating

From the repository root:

```bash
node scripts/validate-integrations.mjs
```

This discovers every integration directory by its manifest, so new platforms are covered as soon as they're added. For each one it validates whichever manifests are present — `plugin.json` against the Agent Plugins schema, `.cursor-plugin/plugin.json` against Cursor's — checks the two agree where they overlap, and validates skill frontmatter, referenced paths, and MCP config. It also confirms every directory carrying a Cursor manifest has a `marketplace.json` entry that resolves the way Cursor expects.
