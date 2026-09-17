#!/usr/bin/env node

// Validates every integration directory in this repository.
//
// An integration is any top-level directory holding a plugin manifest:
//
//   plugin.json                  an Agent Plugin (agent-plugins.org 1.0.0)
//   .cursor-plugin/plugin.json   a Cursor Plugin
//
// A directory may have both, in which case the Agent Plugins manifest is the
// portable core and the Cursor one carries what the standard cannot express.
// Directories carrying a Cursor manifest must also be listed in the repository
// root's .cursor-plugin/marketplace.json, which is how Cursor locates a plugin
// that does not sit at the repository root.

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];
const warnings = [];

const IGNORED_DIRS = new Set([".git", ".github", ".cursor-plugin", "scripts", "node_modules"]);

const pluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const marketplaceNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const AGENT_PLUGINS_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const CURSOR_MANIFEST_FIELDS = new Set([
  "name",
  "displayName",
  "description",
  "version",
  "minClientVersions",
  "author",
  "publisher",
  "homepage",
  "repository",
  "license",
  "logo",
  "keywords",
  "category",
  "tags",
  "commands",
  "agents",
  "skills",
  "rules",
  "hooks",
  "variables",
  "mcpServers",
]);
const CURSOR_AUTHOR_FIELDS = new Set(["name", "email"]);

const AGENT_MANIFEST_FIELDS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);
const AGENT_AUTHOR_FIELDS = new Set(["name", "email", "url"]);

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function readJsonFile(filePath, context, { optional = false } = {}) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    if (!optional) {
      addError(`${context} is missing: ${path.relative(repoRoot, filePath)}`);
    }
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    addError(`${context} contains invalid JSON: ${error.message}`);
    return null;
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return true;
  }
  if (path.isAbsolute(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  return !normalized.startsWith("../") && normalized !== "..";
}

async function validateReferencedPath(baseDir, field, value, label) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return;
  }
  if (!isSafeRelativePath(value)) {
    addError(
      `${label}: "${field}" has invalid path "${value}". Use a relative path without ".." or absolute prefixes.`
    );
    return;
  }
  if (!(await pathExists(path.resolve(baseDir, value)))) {
    addError(`${label}: "${field}" references missing path "${value}".`);
  }
}

function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing === -1) {
    return null;
  }

  const fields = {};
  for (const line of normalized.slice(4, closing).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

function validateCursorManifest(manifest, label) {
  for (const key of Object.keys(manifest)) {
    if (!CURSOR_MANIFEST_FIELDS.has(key)) {
      addError(`${label}: .cursor-plugin/plugin.json has unknown field "${key}".`);
    }
  }

  if (typeof manifest.name !== "string" || !pluginNamePattern.test(manifest.name)) {
    addError(`${label}: "name" must be lowercase and use only alphanumerics, hyphens, and periods.`);
  }
  if (!manifest.description) {
    addWarning(`${label}: no "description"; a marketplace listing needs one.`);
  }
  if (!manifest.logo) {
    addWarning(`${label}: no "logo"; the listing will fall back to a placeholder.`);
  }

  if (manifest.author != null) {
    if (typeof manifest.author !== "object" || Array.isArray(manifest.author)) {
      addError(`${label}: "author" must be an object.`);
    } else {
      if (!manifest.author.name) {
        addError(`${label}: "author.name" is required when "author" is set.`);
      }
      for (const key of Object.keys(manifest.author)) {
        if (!CURSOR_AUTHOR_FIELDS.has(key)) {
          addError(
            `${label}: "author.${key}" is not allowed in a Cursor manifest (only name and email).`
          );
        }
      }
    }
  }

  for (const field of ["keywords", "tags"]) {
    if (manifest[field] != null && !Array.isArray(manifest[field])) {
      addError(`${label}: "${field}" must be an array of strings.`);
    }
  }
}

function validateAgentManifest(manifest, label) {
  if (manifest.$schema !== AGENT_PLUGINS_SCHEMA) {
    addError(`${label}: plugin.json "$schema" must be ${AGENT_PLUGINS_SCHEMA}.`);
  }
  for (const key of Object.keys(manifest)) {
    if (!AGENT_MANIFEST_FIELDS.has(key)) {
      addError(
        `${label}: plugin.json has field "${key}", which the Agent Plugins schema rejects. Client-specific data belongs in that client's namespace.`
      );
    }
  }
  if (typeof manifest.name !== "string" || !pluginNamePattern.test(manifest.name)) {
    addError(`${label}: plugin.json "name" must be lowercase kebab-case.`);
  }
  if (manifest.author != null) {
    if (typeof manifest.author !== "object" || Array.isArray(manifest.author)) {
      addError(`${label}: plugin.json "author" must be an object.`);
    } else {
      for (const key of Object.keys(manifest.author)) {
        if (!AGENT_AUTHOR_FIELDS.has(key)) {
          addError(`${label}: plugin.json author has unknown field "${key}".`);
        }
      }
    }
  }
}

function validateManifestAgreement(agent, cursor, label) {
  // Both describe the same plugin, so drift ships something that identifies
  // itself differently depending on which client reads it.
  for (const field of ["name", "version", "description", "license"]) {
    if (agent[field] != null && cursor[field] != null && agent[field] !== cursor[field]) {
      addError(
        `${label}: "${field}" differs between plugin.json ("${agent[field]}") and .cursor-plugin/plugin.json ("${cursor[field]}").`
      );
    }
  }
}

async function validateSkills(pluginDir, skillsField, label) {
  const skillsDir = path.resolve(pluginDir, typeof skillsField === "string" ? skillsField : "skills");

  if (!(await isDirectory(skillsDir))) {
    if (skillsField) {
      addError(`${label}: "skills" references missing directory "${skillsField}".`);
    }
    return;
  }

  let skillCount = 0;
  for (const entry of await fs.readdir(skillsDir, { withFileTypes: true })) {
    const entryPath = path.join(skillsDir, entry.name);
    if (!(await isDirectory(entryPath))) {
      continue;
    }
    const skillFile = path.join(entryPath, "SKILL.md");
    if (!(await pathExists(skillFile))) {
      addWarning(`${label}: skills/${entry.name}/ has no SKILL.md (skipped).`);
      continue;
    }
    skillCount += 1;

    const parsed = parseFrontmatter(await fs.readFile(skillFile, "utf8"));
    if (!parsed) {
      addError(`${label}: skills/${entry.name}/SKILL.md is missing YAML frontmatter.`);
      continue;
    }
    for (const key of ["name", "description"]) {
      if (!parsed[key]) {
        addError(`${label}: skills/${entry.name}/SKILL.md is missing "${key}" in frontmatter.`);
      }
    }
  }

  if (skillCount === 0) {
    addError(`${label}: skills/ has no child directories containing a SKILL.md.`);
  }
}

function collectPlaceholders(value) {
  return new Set(
    [...JSON.stringify(value ?? {}).matchAll(/\$\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1])
  );
}

function validateServers(servers, label, origin) {
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    addError(`${label}: ${origin} "mcpServers" must be an object.`);
    return false;
  }
  for (const [name, server] of Object.entries(servers)) {
    if (!server || typeof server !== "object") {
      addError(`${label}: ${origin} server "${name}" must be an object.`);
      continue;
    }
    const hasUrl = typeof server.url === "string";
    if (!hasUrl && typeof server.command !== "string") {
      addError(`${label}: ${origin} server "${name}" needs either "url" or "command".`);
    }
    if (hasUrl && !/^(https?:\/\/|\$\{)/.test(server.url)) {
      addError(
        `${label}: ${origin} server "${name}" needs an absolute HTTP(S) url or a "\${VAR}" placeholder.`
      );
    }
  }
  return true;
}

async function validateMcp(pluginDir, cursorManifest, label) {
  // An mcp.json at the plugin root is a standard location, so anything there
  // must satisfy the standard. Placeholder expansion in remote URLs does not.
  const rootMcpPath = path.join(pluginDir, "mcp.json");
  if (await pathExists(rootMcpPath)) {
    const rootMcp = await readJsonFile(rootMcpPath, `${label}: mcp.json`);
    if (rootMcp) {
      if (rootMcp.$schema !== AGENT_PLUGINS_MCP_SCHEMA) {
        addWarning(`${label}: mcp.json "$schema" is not ${AGENT_PLUGINS_MCP_SCHEMA}.`);
      }
      if (validateServers(rootMcp.mcpServers, label, "mcp.json")) {
        for (const [name, server] of Object.entries(rootMcp.mcpServers)) {
          if (typeof server?.url === "string" && server.url.includes("${")) {
            addError(
              `${label}: mcp.json server "${name}" uses a placeholder URL, which Agent Plugins forbids in remote URLs. Move it into a client namespace, such as .cursor-plugin/plugin.json under "mcpServers".`
            );
          }
        }
      }
    }
  }

  if (!cursorManifest) {
    return;
  }

  const { mcpServers } = cursorManifest;
  let servers = null;

  if (typeof mcpServers === "string") {
    if (!isSafeRelativePath(mcpServers)) {
      addError(`${label}: "mcpServers" path "${mcpServers}" is not a safe relative path.`);
      return;
    }
    const config = await readJsonFile(
      path.resolve(pluginDir, mcpServers),
      `${label}: ${mcpServers}`
    );
    servers = config?.mcpServers ?? null;
  } else if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
    servers = mcpServers;
  } else if (mcpServers != null) {
    addError(`${label}: "mcpServers" must be a path string or an object.`);
    return;
  }

  if (servers && !validateServers(servers, label, "mcpServers")) {
    return;
  }

  // Cursor's submission checklist requires every ${VAR} used in plugin config
  // to be declared, or it silently resolves to nothing at install time.
  const declared = new Set(Object.keys(cursorManifest.variables?.properties ?? {}));
  const used = collectPlaceholders(servers);

  for (const name of used) {
    if (name.startsWith("CURSOR_") || name.startsWith("CLAUDE_")) {
      continue;
    }
    if (!declared.has(name)) {
      addError(`${label}: MCP config uses "\${${name}}" but it is not declared under "variables".`);
    }
  }
  for (const name of declared) {
    if (!used.has(name)) {
      addWarning(`${label}: variable "${name}" is declared but nothing references it.`);
    }
  }
}

async function validateLicense(pluginDir, manifest, label) {
  if (!manifest?.license) {
    return;
  }
  const inPlugin = await pathExists(path.join(pluginDir, "LICENSE"));
  const inRepo = await pathExists(path.join(repoRoot, "LICENSE"));
  if (!inPlugin && !inRepo) {
    addError(
      `${label}: declares "license": "${manifest.license}" but there is no LICENSE file. Marketplace plugins must be open source.`
    );
  } else if (!inPlugin) {
    addWarning(`${label}: no LICENSE in the integration directory; relying on the repository root.`);
  }
}

async function discoverIntegrations() {
  const found = [];
  for (const entry of await fs.readdir(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    const dir = path.join(repoRoot, entry.name);
    const hasAgent = await pathExists(path.join(dir, "plugin.json"));
    const hasCursor = await pathExists(path.join(dir, ".cursor-plugin", "plugin.json"));
    if (hasAgent || hasCursor) {
      found.push({ name: entry.name, dir, hasAgent, hasCursor });
    }
  }
  return found;
}

async function validateIntegration(integration) {
  const { name, dir, hasAgent, hasCursor } = integration;
  const label = name;

  const agentManifest = hasAgent
    ? await readJsonFile(path.join(dir, "plugin.json"), `${label}: Agent Plugins manifest`)
    : null;
  const cursorManifest = hasCursor
    ? await readJsonFile(path.join(dir, ".cursor-plugin", "plugin.json"), `${label}: Cursor manifest`)
    : null;

  if (agentManifest) {
    validateAgentManifest(agentManifest, label);
  }
  if (cursorManifest) {
    validateCursorManifest(cursorManifest, label);
  }
  if (agentManifest && cursorManifest) {
    validateManifestAgreement(agentManifest, cursorManifest, label);
  }
  if (!agentManifest) {
    addWarning(
      `${label}: no Agent Plugins plugin.json, so this integration is client-specific and not portable.`
    );
  }

  if (cursorManifest) {
    for (const field of ["logo", "rules", "agents", "commands"]) {
      if (typeof cursorManifest[field] === "string") {
        await validateReferencedPath(dir, field, cursorManifest[field], label);
      }
    }
  }

  await validateSkills(dir, cursorManifest?.skills, label);
  await validateMcp(dir, cursorManifest, label);
  await validateLicense(dir, cursorManifest ?? agentManifest, label);

  if (!(await pathExists(path.join(dir, "README.md")))) {
    addError(`${label}: README.md is required; it documents usage and configuration.`);
  }

  integration.manifestName = (cursorManifest ?? agentManifest)?.name;
}

async function validateMarketplaceCoverage(integrations) {
  const cursorIntegrations = integrations.filter((i) => i.hasCursor);
  const manifestPath = path.join(repoRoot, ".cursor-plugin", "marketplace.json");
  const exists = await pathExists(manifestPath);

  if (!exists) {
    if (cursorIntegrations.length > 0) {
      addError(
        `.cursor-plugin/marketplace.json is missing. Cursor needs it to locate plugins that do not sit at the repository root: ${cursorIntegrations
          .map((i) => i.name)
          .join(", ")}.`
      );
    }
    return;
  }

  const marketplace = await readJsonFile(manifestPath, "Marketplace manifest");
  if (!marketplace) {
    return;
  }

  if (typeof marketplace.name !== "string" || !marketplaceNamePattern.test(marketplace.name)) {
    addError('Marketplace "name" must be lowercase kebab-case.');
  }
  if (!marketplace.owner?.name) {
    addError('Marketplace "owner.name" is required.');
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    addError('Marketplace "plugins" must be a non-empty array.');
    return;
  }

  const pluginRoot = marketplace.metadata?.pluginRoot;
  if (pluginRoot !== undefined && !isSafeRelativePath(pluginRoot)) {
    addError('Marketplace "metadata.pluginRoot" must be a safe relative path.');
  }

  const listedSources = new Set();
  const seenNames = new Set();

  for (const [index, entry] of marketplace.plugins.entries()) {
    if (!entry || typeof entry !== "object") {
      addError(`plugins[${index}] must be an object.`);
      continue;
    }
    if (typeof entry.name !== "string" || !pluginNamePattern.test(entry.name)) {
      addError(`plugins[${index}].name must be lowercase kebab-case.`);
      continue;
    }
    if (seenNames.has(entry.name)) {
      addError(`Duplicate plugin name in marketplace manifest: "${entry.name}".`);
      continue;
    }
    seenNames.add(entry.name);

    const source = typeof entry.source === "string" ? entry.source : entry.source?.path;
    if (typeof source !== "string" || !isSafeRelativePath(source)) {
      addError(`${entry.name}: marketplace "source" must be a safe relative path.`);
      continue;
    }
    const relativeSource = pluginRoot ? path.posix.join(pluginRoot, source) : source;
    listedSources.add(relativeSource);

    // Cursor resolves a marketplace entry's source to
    // <source>/.cursor-plugin/plugin.json, so anything else is unreachable.
    const resolved = path.join(repoRoot, relativeSource, ".cursor-plugin", "plugin.json");
    if (!(await pathExists(resolved))) {
      addError(
        `${entry.name}: marketplace "source" is "${relativeSource}", but ${relativeSource}/.cursor-plugin/plugin.json does not exist. Cursor resolves a source to that path.`
      );
      continue;
    }

    const integration = integrations.find((i) => i.name === relativeSource);
    if (integration?.manifestName && integration.manifestName !== entry.name) {
      addError(
        `${entry.name}: marketplace entry name does not match the manifest name "${integration.manifestName}".`
      );
    }
  }

  for (const integration of cursorIntegrations) {
    if (!listedSources.has(integration.name)) {
      addError(
        `${integration.name}: has a Cursor manifest but no .cursor-plugin/marketplace.json entry, so Cursor cannot find it.`
      );
    }
  }
}

async function main() {
  const integrations = await discoverIntegrations();

  if (integrations.length === 0) {
    addError("No integration directories found. Each one needs a plugin manifest.");
    summarizeAndExit();
    return;
  }

  for (const integration of integrations) {
    await validateIntegration(integration);
  }
  await validateMarketplaceCoverage(integrations);

  console.log(
    `Checked ${integrations.length} integration(s): ${integrations
      .map((i) => `${i.name} [${[i.hasAgent && "agent-plugins", i.hasCursor && "cursor"].filter(Boolean).join(", ")}]`)
      .join(", ")}\n`
  );

  summarizeAndExit();
}

function summarizeAndExit() {
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
    console.log("");
  }

  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Validation passed.");
}

await main();
