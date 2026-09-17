# Changelog

All notable changes to this plugin will be documented here.

## 1.0.0 — initial release

- Added the `tines-3b` MCP server pointing at the user's own tenant, configured through the `TINES_3B_MCP_URL` plugin variable. 3B tenants are per-customer origins, so there is no shared URL to hard-code.
- Relies on 3B's OAuth dynamic client registration and PKCE, so no client ID or secret is required. Installing the plugin and signing in is enough.
- Added the `tines-3b-skills` skill, which installs the [`tines/skills`](https://github.com/tines/skills) collection on first use so workflow-building guidance tracks `main`.
- Logo: the Tines mark.
