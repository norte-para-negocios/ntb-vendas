// Aplica um patch ao config da loja sem mutar. Valor `undefined` REMOVE a chave
// (é como o "Desfazer" volta uma chave que não existia).
export function aplicarPatch(config: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(config ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k]; else out[k] = v;
  }
  return out;
}
