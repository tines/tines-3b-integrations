#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];
const warnings = [];

const pluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const marketplaceNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const AGENT_PLUGINS_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const PLUGIN_MANIFEST_FIELDS = new Set([
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
const AUTHOR_FIELDS = new Set(["name", "email", "url"]);

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(targetPath, context) {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      addError(`${context} exists but is not a directory: ${targetPath}`);
      return false;
    }
    return true;
  } catch {
    addError(`${context} directory is missing: ${targetPath}`);
    return false;
  }
}

async function readJsonFile(filePath, context) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    addError(`${context} is missing: ${filePath}`);
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    addError(`${context} contains invalid JSON (${filePath}): ${error.message}`);
    return null;
  }
}

function normalizeNewlines(content) {
  return content.replace(/\r\n/g, "\n");
}

function parseFrontmatter(content) {
  const normalized = normalizeNewlines(content);
  if (!normalized.startsWith("---\n")) {
    return null;
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return null;
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const fields = {};

  for (const line of frontmatterBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    fields[key] = value;
  }

  return fields;
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

async function validateReferencedPath(pluginDir, fieldName, pathValue, pluginName) {
  if (pathValue.startsWith("http://") || pathValue.startsWith("https://")) {
    return;
  }

  if (!isSafeRelativePath(pathValue)) {
    addError(
      `${pluginName}: field "${fieldName}" has invalid path "${pathValue}". Use a relative path without ".." or absolute prefixes.`
    );
    return;
  }

  const resolved = path.resolve(pluginDir, pathValue);
  const exists = await pathExists(resolved);
  if (!exists) {
    addError(`${pluginName}: field "${fieldName}" references missing path "${pathValue}".`);
  }
}

async function validateFrontmatterFile(filePath, componentName, requiredKeys, pluginName) {
  const content = await fs.readFile(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  const relativeFile = path.relative(repoRoot, filePath);

  if (!parsed) {
    addError(`${pluginName}: ${componentName} file missing YAML frontmatter: ${relativeFile}`);
    return;
  }

  for (const key of requiredKeys) {
    if (!parsed[key] || parsed[key].length === 0) {
      addError(`${pluginName}: ${componentName} file missing "${key}" in frontmatter: ${relativeFile}`);
    }
  }
}

async function validateSkills(pluginDir, pluginName) {
  const skillsDir = path.join(pluginDir, "skills");
  let lstat;
  try {
    lstat = await fs.lstat(skillsDir);
  } catch {
    return;
  }

  let stat;
  try {
    stat = await fs.stat(skillsDir);
  } catch {
    addError(
      lstat.isSymbolicLink()
        ? `${pluginName}: skills/ is a symlink that does not resolve.`
        : `${pluginName}: skills/ exists but does not resolve.`
    );
    return;
  }

  if (!stat.isDirectory()) {
    addError(`${pluginName}: skills/ must be a directory.`);
    return;
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  let skillCount = 0;

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry.name);
    let entryStat;
    try {
      entryStat = await fs.stat(entryPath);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) {
      continue;
    }

    const skillFile = path.join(entryPath, "SKILL.md");
    if (!(await pathExists(skillFile))) {
      addWarning(`${pluginName}: skills/${entry.name}/ has no SKILL.md (skipped).`);
      continue;
    }
    skillCount += 1;
    await validateFrontmatterFile(skillFile, "skill", ["name", "description"], pluginName);
  }

  if (skillCount === 0) {
    addError(`${pluginName}: skills/ has no immediate child directories with SKILL.md.`);
  }
}

async function validateMcpJson(pluginDir, pluginName) {
  const mcpPath = path.join(pluginDir, "mcp.json");
  if (!(await pathExists(mcpPath))) {
    return;
  }

  const mcp = await readJsonFile(mcpPath, `${pluginName} mcp.json`);
  if (!mcp) {
    return;
  }

  if (mcp.$schema !== AGENT_PLUGINS_MCP_SCHEMA) {
    addError(`${pluginName}: mcp.json "$schema" must be ${AGENT_PLUGINS_MCP_SCHEMA}.`);
  }

  const extraKeys = Object.keys(mcp).filter((key) => key !== "$schema" && key !== "mcpServers");
  for (const key of extraKeys) {
    addError(`${pluginName}: mcp.json has unknown top-level field "${key}".`);
  }

  if (!mcp.mcpServers || typeof mcp.mcpServers !== "object" || Array.isArray(mcp.mcpServers)) {
    addError(`${pluginName}: mcp.json "mcpServers" must be an object.`);
    return;
  }

  for (const [serverName, server] of Object.entries(mcp.mcpServers)) {
    if (!server || typeof server !== "object") {
      addError(`${pluginName}: mcp.json server "${serverName}" must be an object.`);
      continue;
    }
    if (server.type === "streamable-http" || server.type === "sse") {
      if (typeof server.url !== "string" || !/^https?:\/\//.test(server.url)) {
        addError(`${pluginName}: mcp.json server "${serverName}" needs an absolute HTTP(S) url.`);
      } else if (server.url.includes("${")) {
        addError(
          `${pluginName}: mcp.json server "${serverName}" url must not contain placeholders (Agent Plugins forbids expansion in remote URLs).`
        );
      }
    } else if (server.type !== "stdio") {
      addError(`${pluginName}: mcp.json server "${serverName}" has unknown type "${server.type}".`);
    }
  }
}

function validatePluginManifest(pluginManifest, pluginName, marketplaceName) {
  if (pluginManifest.$schema !== AGENT_PLUGINS_SCHEMA) {
    addError(`${pluginName}: plugin.json "$schema" must be ${AGENT_PLUGINS_SCHEMA}.`);
  }

  for (const key of Object.keys(pluginManifest)) {
    if (!PLUGIN_MANIFEST_FIELDS.has(key)) {
      addError(`${pluginName}: plugin.json has unknown top-level field "${key}".`);
    }
  }

  if (typeof pluginManifest.name !== "string" || !pluginNamePattern.test(pluginManifest.name)) {
    addError(
      `${pluginName}: "name" in plugin.json must be lowercase and use only alphanumerics, hyphens, and periods.`
    );
  }

  if (pluginManifest.name && pluginManifest.name !== marketplaceName) {
    addError(
      `${pluginName}: marketplace entry name does not match plugin.json name ("${pluginManifest.name}").`
    );
  }

  if (pluginManifest.author != null) {
    if (typeof pluginManifest.author !== "object" || Array.isArray(pluginManifest.author)) {
      addError(`${pluginName}: plugin.json "author" must be an object.`);
    } else {
      for (const key of Object.keys(pluginManifest.author)) {
        if (!AUTHOR_FIELDS.has(key)) {
          addError(`${pluginName}: plugin.json author has unknown field "${key}".`);
        } else if (typeof pluginManifest.author[key] !== "string") {
          addError(`${pluginName}: plugin.json author.${key} must be a string.`);
        }
      }
    }
  }

  if (pluginManifest.keywords != null && !Array.isArray(pluginManifest.keywords)) {
    addError(`${pluginName}: plugin.json "keywords" must be an array of strings.`);
  }

  if (pluginManifest.extensions != null) {
    if (typeof pluginManifest.extensions !== "object" || Array.isArray(pluginManifest.extensions)) {
      addError(`${pluginName}: plugin.json "extensions" must be an object.`);
    }
  }
}

function resolveMarketplaceSource(source, pluginRoot) {
  if (typeof source !== "string" || source.length === 0) {
    return null;
  }
  if (!pluginRoot) {
    return source;
  }
  const normalizedRoot = pluginRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedSource = source.replace(/\\/g, "/");
  if (normalizedSource === normalizedRoot || normalizedSource.startsWith(`${normalizedRoot}/`)) {
    return normalizedSource;
  }
  return `${normalizedRoot}/${normalizedSource}`;
}

async function main() {
  const marketplacePath = path.join(repoRoot, ".cursor-plugin", "marketplace.json");
  const marketplace = await readJsonFile(marketplacePath, "Marketplace manifest");
  if (!marketplace) {
    summarizeAndExit();
    return;
  }

  if (typeof marketplace.name !== "string" || !marketplaceNamePattern.test(marketplace.name)) {
    addError(
      'Marketplace "name" must be lowercase kebab-case and start/end with an alphanumeric character.'
    );
  }

  if (!marketplace.owner || typeof marketplace.owner.name !== "string" || marketplace.owner.name.length === 0) {
    addError('Marketplace "owner.name" is required.');
  }

  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    addError('Marketplace "plugins" must be a non-empty array.');
    summarizeAndExit();
    return;
  }

  const pluginRoot = marketplace.metadata?.pluginRoot;
  if (pluginRoot !== undefined) {
    if (typeof pluginRoot !== "string" || !isSafeRelativePath(pluginRoot)) {
      addError('Marketplace "metadata.pluginRoot" must be a safe relative path.');
    } else {
      const pluginRootAbs = path.join(repoRoot, pluginRoot);
      await ensureDirectory(pluginRootAbs, 'Marketplace "metadata.pluginRoot"');
    }
  }

  const seenNames = new Set();
  for (const [index, entry] of marketplace.plugins.entries()) {
    const label = `plugins[${index}]`;

    if (!entry || typeof entry !== "object") {
      addError(`${label} must be an object.`);
      continue;
    }

    if (typeof entry.name !== "string" || !pluginNamePattern.test(entry.name)) {
      addError(`${label}.name must be lowercase and use only alphanumerics, hyphens, and periods.`);
      continue;
    }

    if (seenNames.has(entry.name)) {
      addError(`Duplicate plugin name in marketplace manifest: "${entry.name}"`);
    }
    seenNames.add(entry.name);

    const sourcePath = resolveMarketplaceSource(entry.source, pluginRoot ?? "");
    if (!sourcePath) {
      addError(`${label}.source must be a string path.`);
      continue;
    }
    if (!isSafeRelativePath(sourcePath)) {
      addError(`${label}.source is not a safe relative path: "${sourcePath}"`);
      continue;
    }

    const pluginDir = path.join(repoRoot, sourcePath);
    const pluginDirExists = await ensureDirectory(pluginDir, `${label}.source`);
    if (!pluginDirExists) {
      continue;
    }

    if (entry.logo) {
      const logoBase = pluginRoot ? path.join(repoRoot, pluginRoot) : repoRoot;
      await validateReferencedPath(logoBase, "logo", entry.logo, entry.name);
    }

    const manifestPath = path.join(pluginDir, "plugin.json");
    const pluginManifest = await readJsonFile(manifestPath, `${entry.name} plugin manifest`);
    if (!pluginManifest) {
      continue;
    }

    validatePluginManifest(pluginManifest, entry.name, entry.name);
    await validateSkills(pluginDir, entry.name);
    await validateMcpJson(pluginDir, entry.name);
  }

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
