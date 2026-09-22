// Versão exibida do app desktop. O número interno (desktop/package.json)
// continua semver crescente (1.x) porque o electron-updater só instala
// versão MAIOR que a instalada — baixar pra 0.x deixaria os PCs das lojas
// presos. Pra quem usa, o produto é beta: mostramos 0.<minor>.<patch>.
export const formatAppVersion = (v?: string | null): string => {
  if (!v) return '';
  const [, minor = '0', patch = '0'] = v.split('.');
  return `v0.${minor}.${patch} (beta)`;
};
