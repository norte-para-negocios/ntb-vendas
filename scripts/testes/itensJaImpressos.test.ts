// rodar com: npx tsx scripts/testes/itensJaImpressos.test.ts
// Incidente 08/10/2026 (Sertão, mesa 24): grupo de 4 itens impresso; 1 cancelado; outro computador montou o grupo com os 3
// que sobraram (chave nova) e a cozinha recebeu de novo. Item que aparece em QUALQUER chave já impressa não sai de novo.
import assert from 'node:assert/strict';
import { itensDasChavesDeImpressao } from '../../lib/api';

const chaves = ['grupo:kitchen:pk1:a,b,c,d', 'item:e:kitchen:pk1', 'item:f:bar:pb1', 'grupo:bar:pb1:g,h', 'cancel:b:pk1', 'pre-conta:x:y:z'];
const k = itensDasChavesDeImpressao(chaves, 'kitchen');
assert.deepEqual([...k].sort(), ['a', 'b', 'c', 'd', 'e']);
assert.ok(['a', 'c', 'd'].every((id) => k.has(id)), 'grupo remontado sem o cancelado é reconhecido como já impresso');
assert.deepEqual([...itensDasChavesDeImpressao(chaves, 'bar')].sort(), ['f', 'g', 'h']);
console.log('itensJaImpressos: ok');
