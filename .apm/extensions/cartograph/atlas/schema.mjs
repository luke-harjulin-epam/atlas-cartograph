import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPathWithin } from "../paths.mjs";

const MAX_SCHEMA_BYTES = 1024 * 1024;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value) => typeof value === "string" && value.trim().length > 0;
const keyFor = (...parts) => `schema:${JSON.stringify(parts)}`;

// Only visualization metadata is retained. Template paths, constraints and extensions
// are neither followed nor interpreted as placement rules or executable content.
export function readSchemaCatalog(root) {
  const scope = createHash("sha256").update(root).digest("hex");
  const catalog = { scope, schemas: [], diagnostics: [] };
  const canonicalRoot = realpathSync(root);
  const diagnostic = (source, code, message) => catalog.diagnostics.push({ scope, source, code, message });
  function read(source, optional = false) {
    try {
      const target = realpathSync(join(root, source));
      if (!isPathWithin(canonicalRoot, target)) {
        diagnostic(source, "outside-store", "Schema metadata points outside its mounted store.");
        return null;
      }
      const info = statSync(target);
      if (!info.isFile() || info.size > MAX_SCHEMA_BYTES) {
        diagnostic(source, "invalid-file", "Schema metadata must be a regular JSON file of at most 1 MiB.");
        return null;
      }
      const data = JSON.parse(readFileSync(target, "utf8"));
      if (!object(data)) {
        diagnostic(source, "invalid-object", "Schema metadata must be a JSON object.");
        return null;
      }
      return data;
    } catch (error) {
      if (optional && error.code === "ENOENT") return null;
      diagnostic(source, "unreadable", "Schema metadata could not be read or parsed.");
      return null;
    }
  }
  const candidates = [];
  function add(data, source, contributionId = null) {
    const byType = data.templates?.by_type;
    if (data.templates !== undefined && (!object(data.templates) || !object(byType))) {
      diagnostic(source, "invalid-types", "Schema templates.by_type must be an object.");
      return;
    }
    const types = [];
    for (const id of Object.keys(byType ?? {}).sort()) {
      if (!identifier(id) || !object(byType[id])) {
        diagnostic(source, "invalid-type", "A type declaration is invalid and has been omitted.");
        continue;
      }
      types.push(id);
    }
    candidates.push({ source, contributionId, types });
  }
  const core = read("SCHEMA.json", true);
  if (identifier(core?.atlas_id)) catalog.atlasId = core.atlas_id;
  if (core) add(core, "SCHEMA.json");
  let names = [];
  try {
    const directory = realpathSync(join(root, "schema.d"));
    if (!isPathWithin(canonicalRoot, directory)) {
      diagnostic("schema.d", "outside-store", "Schema directory points outside its mounted store.");
    } else {
      names = readdirSync(directory).filter((name) =>
        !name.startsWith(".") && name.endsWith(".json") && !name.endsWith(".receipt.json")).sort();
    }
  } catch (error) {
    if (error.code !== "ENOENT") diagnostic("schema.d", "unreadable", "Schema directory could not be read.");
  }
  for (const name of names) {
    const source = `schema.d/${name}`;
    const data = read(source);
    if (!data) continue;
    if (!identifier(data.contribution_id)) {
      diagnostic(source, "invalid-contribution", "Schema contribution_id must be a nonempty string.");
      continue;
    }
    add(data, source, data.contribution_id);
  }
  const contributions = new Map();
  const owners = new Map();
  for (const entry of candidates) {
    if (entry.contributionId !== null) {
      contributions.set(entry.contributionId, (contributions.get(entry.contributionId) ?? 0) + 1);
    }
    for (const id of entry.types) owners.set(id, (owners.get(id) ?? 0) + 1);
  }
  for (const entry of candidates) {
    if ((contributions.get(entry.contributionId) ?? 0) > 1) {
      diagnostic(entry.source, "duplicate-contribution", "Duplicate contribution identity; its declarations are unavailable.");
      continue;
    }
    const key = keyFor(scope, entry.contributionId === null ? "core" : "contribution", entry.contributionId);
    const types = entry.types.filter((id) => owners.get(id) === 1);
    if (types.length !== entry.types.length) {
      diagnostic(entry.source, "conflicting-type", "Conflicting type ownership; ambiguous declarations are unavailable.");
    }
    catalog.schemas.push({
      key, scope, source: entry.source,
      origin: entry.contributionId === null ? "core" : "contribution",
      contributionId: entry.contributionId,
      label: entry.contributionId ?? "Core",
      types: types.map((id) => ({ id, key: keyFor(scope, key, id) })),
    });
  }
  return catalog;
}

export function schemaTypes(catalog) {
  return new Map((catalog?.schemas ?? []).flatMap((schema) =>
    schema.types.map((type) => [type.id, {
      typeKey: type.key, schemaKey: schema.key, schemaLabel: schema.label,
    }])));
}

export function graphSchemas(stores) {
  return {
    schemas: stores.flatMap((store) => (store.schemaCatalog?.schemas ?? []).map((schema) => ({
      ...schema, atlasKey: store.atlasId || store.label, atlasLabel: store.label,
    }))),
    schemaDiagnostics: stores.flatMap((store) => (store.schemaCatalog?.diagnostics ?? []).map((item) => ({
      ...item, atlasKey: store.atlasId || store.label, atlasLabel: store.label,
    }))),
  };
}
