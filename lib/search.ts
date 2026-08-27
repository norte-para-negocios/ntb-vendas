// Achado real (reuniao com o Ramon, 2026-08-25): buscar "muqueca" no
// cardapio nao achava "Moqueca" por causa do acento -- sem normalizacao, a
// busca exige que o cliente/garcom digite o acento exato. Remove
// diacriticos (NFD + strip dos combining marks, faixa Unicode
// U+0300-U+036F) antes de comparar, nos dois lados (termo digitado e nome
// do produto) -- nunca so' de um lado, senao "moqueca" (sem acento, o termo
// mais comum de digitar rapido) deixaria de bater com "Moqueca" (o nome
// cadastrado, com acento).
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
