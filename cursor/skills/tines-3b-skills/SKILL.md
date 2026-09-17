---
name: tines-3b-skills
description: Use whenever the user works with Tines 3B — connecting MCP, listing spaces or workflows, building or publishing steps, or anything involving a 3B tenant. Ensures Tines Agent Skills from github.com/tines/skills are installed and then follow those skills.
---

# Tines 3B skills

If skills from [tines/skills](https://github.com/tines/skills) are not already available (for example `building-workflows` is missing), install them:

```bash
npx skills add tines/skills
```

If you cannot run that, show it to the user once. Then follow those skills. Do not restate them here.

MCP is `https://<tenant>/mcp` (the sign-in origin plus `/mcp`). Prefer OAuth. A service-account token cannot write or publish.
