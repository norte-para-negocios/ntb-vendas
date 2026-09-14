// Desvio do brief: app/acesso/page.tsx (raiz) não exporta `metadata` (só
// `export default function HomePage()`), então re-exportar `metadata` daqui
// quebraria o build ("has no exported member 'metadata'"). Reexportamos só
// o default, igual ao padrão de mobile/webapp/app/page.tsx.
export { default } from '@/app/acesso/page';
