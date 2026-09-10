import { ACCESS_KINDS, MAX_MESSAGE_LENGTH } from "../protocol.mjs";
import { esloggerProvider } from "./eslogger.mjs";

/**
 * @typedef {object} MonitorProvider
 * @property {{id:string,label:string,description:string,permissions:string[],operations:string[],processScopes?:("all"|"session")[],setup:{title:string,description:string,steps:string[],notice:string,diagnostics?:string}}} metadata Public, secret-free UI metadata; optional setup diagnostics are plain text, never markup.
 * @property {(platform:string) => {supported:boolean,message:string}} availability
 * @property {string} waitingMessage
 * @property {(context:{endpoint:string,token:string,collectorPath:string,scope:object}) => {command:string|null}|Promise<{command:string|null}>} createConnection Null command means a component reports directly to the normalized HTTP API.
 * @property {{parseLine:Function,createParser?:Function,messages:{limitations:string,waiting:string,ended:string,emptyEnd:string,inputError:string,closed:string,oversizedLine:string}}} [stream] Optional adapter for the shared line-oriented collector.
 */

export const DEFAULT_MONITOR_PROVIDER = "macos-eslogger";
const text = (value) => typeof value === "string" && value.trim().length > 0;
const texts = (value) => Array.isArray(value) && value.every(text);

export function validateMonitorProvider(provider) {
  const meta = provider?.metadata;
  if (!meta || typeof meta.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(meta.id) ||
      !text(meta.label) || !text(meta.description) || !texts(meta.permissions) ||
      !Array.isArray(meta.operations) || !meta.operations.length ||
      !meta.operations.every((kind) => ACCESS_KINDS.has(kind)) ||
      (meta.processScopes !== undefined && (!Array.isArray(meta.processScopes) || !meta.processScopes.length ||
        !meta.processScopes.every((scope) => scope === "all" || scope === "session"))) ||
      !text(meta.setup?.title) || !text(meta.setup.description) ||
      !texts(meta.setup.steps) || !text(meta.setup.notice) ||
      (meta.setup.diagnostics !== undefined && !text(meta.setup.diagnostics)) ||
      typeof provider.availability !== "function" || typeof provider.createConnection !== "function" ||
      !text(provider.waitingMessage) || provider.waitingMessage.length > MAX_MESSAGE_LENGTH) {
    throw new TypeError("Invalid monitor provider contract.");
  }
  if (provider.stream) {
    const messages = provider.stream.messages;
    if (typeof provider.stream.parseLine !== "function" ||
        (provider.stream.createParser !== undefined && typeof provider.stream.createParser !== "function") ||
        !["limitations", "waiting", "ended", "emptyEnd", "inputError", "closed", "oversizedLine"]
          .every((key) => text(messages?.[key]) && messages[key].length <= MAX_MESSAGE_LENGTH)) {
      throw new TypeError(`Invalid stream adapter for monitor provider ${meta.id}.`);
    }
  }
  return provider;
}

export function monitorMetadata(provider) {
  const { id, label, description, permissions, operations, setup } = provider.metadata;
  return {
    id, label, description, permissions: [...permissions], operations: [...operations],
    processScopes: [...(provider.metadata.processScopes ?? ["all"])],
    setup: {
      title: setup.title, description: setup.description,
      steps: [...setup.steps], notice: setup.notice,
      ...(setup.diagnostics !== undefined ? { diagnostics: setup.diagnostics } : {}),
    },
  };
}

export function createMonitorRegistry(providers, defaultId) {
  const byId = new Map();
  for (const provider of providers) {
    validateMonitorProvider(provider);
    const id = provider.metadata.id;
    if (byId.has(id)) throw new Error(`Duplicate monitor provider: ${id}`);
    byId.set(id, provider);
  }
  if (!byId.has(defaultId)) throw new Error(`Unknown default monitor provider: ${defaultId}`);
  return {
    defaultId,
    ids: () => [...byId.keys()],
    get(id = defaultId) {
      const provider = byId.get(id);
      if (!provider) throw new Error(`Unknown monitor provider: ${id}`);
      return provider;
    },
  };
}

export const monitorProviders = createMonitorRegistry([esloggerProvider], DEFAULT_MONITOR_PROVIDER);
