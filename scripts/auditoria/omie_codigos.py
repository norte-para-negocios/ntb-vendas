#!/usr/bin/env python3
"""Confere os códigos do Omie de UMA loja do Norte Vendas, só leitura, com poucas chamadas.
Roda no servidor Contabo (precisa de cardapio.py na mesma pasta).
  python3 omie_codigos.py <trecho_do_nome_da_loja_vendas> <id_da_loja_no_estoque> [max_chamadas=10] > relatorio.md
Estratégia: pega a página 1 (descobre o total), depois lê de TRÁS PARA FRENTE (códigos novos ficam no fim) e
para assim que acha todos os códigos da loja ou ao atingir max_chamadas. 3s entre chamadas. Para no 1º erro do Omie.
Nunca escreve no banco nem no Omie, nunca usa ConsultarEstrutura. Não imprime segredos."""
import json, sys, time, re, urllib.request, urllib.error
from cardapio import psql_json, nomes_divergem

trecho, loja_estoque = sys.argv[1], sys.argv[2]
MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 10

loja = psql_json(f"select id, name from stores where name ilike '%{trecho}%' and is_active limit 2")
if len(loja) != 1:
    sys.exit(f'loja ambígua ou não achada: {loja}')
sid = loja[0]['id']
prods = psql_json(f"select p.id, p.name, p.price, p.omie_codigo, p.ncm, p.fee_type, not exists(select 1 from product_option_groups g where g.product_id=p.id) as sem_grupo from products p where p.store_id='{sid}' and p.available and p.omie_codigo is not null")
ops = psql_json(f"select p.name||' > '||o.name as n, o.omie_codigo as c from product_options o join product_option_groups g on g.id=o.group_id join products p on p.id=g.product_id where p.store_id='{sid}' and p.available and o.available and o.omie_codigo is not null")
var = psql_json(f"select p.name||' > '||o.name as n, v.value->>'omie_codigo' as c from product_options o join product_option_groups g on g.id=o.group_id join products p on p.id=g.product_id, jsonb_each(coalesce(o.variants,'{{}}'::jsonb)) v where p.store_id='{sid}' and p.available and o.available and v.value->>'omie_codigo' is not null")
alvos = {str(p['omie_codigo']) for p in prods} | {str(o['c']) for o in ops} | {str(v['c']) for v in var}

env = dict(l.strip().split('=', 1) for l in open('/opt/ntb-estoque/.env.local') if '=' in l and not l.startswith('#'))
url, svc = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'), env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
rq = urllib.request.Request(url + f'/rest/v1/lojas?select=omie_app_key,omie_app_secret&id=eq.{loja_estoque}', headers={'apikey': svc, 'Authorization': 'Bearer ' + svc})
lj = json.loads(urllib.request.urlopen(rq, timeout=30).read())[0]
key, sec = lj['omie_app_key'], lj['omie_app_secret']

omie, chamadas, erro = {}, 0, None

def pagina(n):
    global chamadas, erro
    body = json.dumps({'call': 'ListarProdutos', 'app_key': key, 'app_secret': sec, 'param': [{'pagina': n, 'registros_por_pagina': 100, 'apenas_importado_api': 'N', 'filtrar_apenas_omiepdv': 'N'}]}).encode()
    r = urllib.request.Request('https://app.omie.com.br/api/v1/geral/produtos/', body, {'Content-Type': 'application/json'})
    try:
        d = json.loads(urllib.request.urlopen(r, timeout=90).read())
    except urllib.error.HTTPError as e:
        d = json.loads(e.read() or b'{}')
    chamadas += 1
    if 'faultstring' in d:
        erro = d['faultstring'][:160]
        return None
    for x in d.get('produto_servico_cadastro', []):
        omie[str(x['codigo'])] = x
    return d

d1 = pagina(1)
total_pag = d1.get('total_de_paginas', 1) if d1 else 0
total_reg = d1.get('total_de_registros', 0) if d1 else 0
n = total_pag
while d1 and n > 1 and chamadas < MAX and not (alvos <= set(omie)) and not erro:
    time.sleep(3)
    pagina(n)
    n -= 1

achados = sorted(alvos & set(omie))
faltam = sorted(alvos - set(omie))
completo = (n <= 1) and not erro
print(f'# Conferência de códigos do Omie: {loja[0]["name"]}\n')
print(f'- Códigos usados na loja (produtos, opções e variantes): {len(alvos)}')
print(f'- Omie: {total_reg} produtos em {total_pag} páginas; chamadas feitas: {chamadas} (limite {MAX}); erro: {erro or "nenhum"}')
print(f'- Encontrados no Omie: {len(achados)}; não encontrados: {len(faltam)}' + ('' if completo or not faltam else ' (leitura PARCIAL: os não encontrados podem estar em páginas não lidas)'))
inativos = [c for c in achados if omie[c].get('inativo') == 'S']
print(f'- Inativos no Omie: {len(inativos)}\n')
if erro:
    print(f'> O Omie respondeu erro: {erro}. Parei na hora.\n')
nome_por_cod = {str(p['omie_codigo']): p for p in prods}
if inativos:
    print('## Inativos no Omie (a venda não baixa estoque desses)')
    for c in inativos:
        print(f'- {c}: {omie[c].get("descricao")} (aqui: {nome_por_cod[c]["name"] if c in nome_por_cod else "opção/variante"})')
div, preco, ncm = [], [], []
for c, p in nome_por_cod.items():
    o = omie.get(c)
    if not o:
        continue
    if nomes_divergem(o.get('descricao'), p['name']):
        div.append(f'- {c}: aqui "{p["name"]}", no Omie "{o.get("descricao")}"')
    if p['sem_grupo'] and not p['fee_type'] and abs(float(o.get('valor_unitario') or 0) - float(p['price'] or 0)) > 0.005:
        preco.append(f'- {c} "{p["name"]}": R$ {float(p["price"]):.2f} aqui, R$ {float(o.get("valor_unitario") or 0):.2f} no Omie')
    a, b = re.sub(r'\D', '', o.get('ncm') or ''), re.sub(r'\D', '', p['ncm'] or '')
    if a and b and a != b:
        ncm.append(f'- {c} "{p["name"]}": NCM {b} aqui, {a} no Omie')
for t, l in (('Nomes diferentes', div), ('Preço diferente do Omie', preco), ('NCM diferente', ncm)):
    if l:
        print(f'\n## {t} ({len(l)})'); print('\n'.join(l))
if faltam:
    print(f'\n## Códigos não encontrados ({len(faltam)})' + ('' if completo else ' (leitura parcial, podem existir)'))
    for c in faltam:
        print(f'- {c}: {nome_por_cod[c]["name"] if c in nome_por_cod else "opção/variante"}')
