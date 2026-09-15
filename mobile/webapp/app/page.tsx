// Revisão final 2026-09-14: a Home do APK NÃO pode ser a landing privada
// /acesso (mostra os botões "Painel Master" + "Área do Lojista" — pensada
// só pra acesso interno por link direto, nunca linkada publicamente, ver
// AGENTS.md seção "Landing pages"). Um funcionário de loja com o APK
// instalado no celular não pode ver botão de Master Admin ao abrir o app.
// Reexporta o mesmo conteúdo de app/loja/page.tsx (que já exporta
// `metadata`), igual ao padrão usado em mobile/webapp/app/loja/page.tsx.
export { metadata, default } from '@/app/loja/page';
