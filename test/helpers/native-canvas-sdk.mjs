import assert from "node:assert/strict";

export const registration = { calls: 0, metadataCalls: 0, canvas: null };
let metadata;

export function setMetadata(value) {
  metadata = value;
}

export class CanvasError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createCanvas(options) {
  assert.equal(registration.canvas, null, "Register one native canvas");
  registration.canvas = options;
  return options;
}

export async function joinSession(config) {
  registration.calls++;
  // Hooks would reproduce the reported host bootstrap failure, even if empty.
  assert.deepEqual(Object.keys(config), ["canvases"]);
  assert.deepEqual(config.canvases, [registration.canvas]);
  return {
    sessionId: "observatory-session",
    rpc: {
      metadata: {
        snapshot: async () => {
          registration.metadataCalls++;
          if (metadata instanceof Error) throw metadata;
          return metadata;
        },
      },
    },
  };
}
