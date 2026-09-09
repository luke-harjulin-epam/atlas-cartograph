const sdk = new URL("./native-canvas-sdk.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "@github/copilot-sdk/extension") return { url: sdk, shortCircuit: true };
  return nextResolve(specifier, context);
}
