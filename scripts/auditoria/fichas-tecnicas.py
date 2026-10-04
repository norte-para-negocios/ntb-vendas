#!/usr/bin/env python3
"""Auditoria SOMENTE LEITURA das fichas técnicas (estrutura/BOM) do Sertão no Omie.
Roda no servidor (tem as chaves do Omie da loja 4 do estoque). Nunca escreve no Omie nem no banco.
Uso: python3 fichas-tecnicas.py
Saída: contagens e a lista de produtos SEM estrutura. Não imprime segredos."""
import json, re, subprocess, time, urllib.request

def psql(sql):
    return subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'ntb_vendas', '-At', '-c', sql], capture_output=True, text=True).stdout.strip()

env = dict(l.strip().split('=', 1) for l in open('/opt/ntb-estoque/.env.local') if '=' in l and not l.startswith('#'))
url, svc = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'), env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
req = urllib.request.Request(url + '/rest/v1/lojas?select=omie_app_key,omie_app_secret&id=eq.4', headers={'apikey': svc, 'Authorization': 'Bearer ' + svc})
loja = json.loads(urllib.request.urlopen(req, timeout=30).read())[0]
KEY, SEC = loja['omie_app_key'], loja['omie_app_secret']

def omie(endpoint, call, param):
    body = json.dumps({'call': call, 'app_key': KEY, 'app_secret': SEC, 'param': [param]}).encode()
    r = urllib.request.Request('https://app.omie.com.br/api/v1/' + endpoint + '/', body, {'Content-Type': 'application/json'})
    try:
        return json.loads(urllib.request.urlopen(r, timeout=60).read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b'{}')

# id interno do Omie por código (SKU)
interno, pagina = {}, 1
while True:
    d = omie('geral/produtos', 'ListarProdutos', {'pagina': pagina, 'registros_por_pagina': 500, 'apenas_importado_api': 'N', 'filtrar_apenas_omiepdv': 'N'})
    for x in d.get('produto_servico_cadastro', []):
        interno[str(x['codigo'])] = (x.get('codigo_produto'), x.get('descricao'))
    if pagina >= d.get('total_de_paginas', 1):
        break
    pagina += 1

sid = psql("select id from stores where name ilike '%sert%' limit 1")
linhas = psql(f"""select 'P|'||name||'|'||coalesce(omie_codigo,'')||'|'||coalesce(fee_type,'') from products where store_id='{sid}' and available
  union all select 'O|'||p.name||' > '||o.name||'|'||coalesce(o.omie_codigo,'')||'|' from product_options o join product_option_groups g on g.id=o.group_id join products p on p.id=g.product_id where p.store_id='{sid}' and p.available and o.available and o.omie_codigo is not null""").split('\n')

vistos, com, sem, sem_vinculo, taxas, nao_achado = {}, [], [], [], 0, []
for linha in linhas:
    tipo, nome, cod, fee = linha.split('|', 3)
    if fee:
        taxas += 1
        continue
    if not cod:
        if tipo == 'P':
            sem_vinculo.append(nome)  # pode ser produto-pai de variações (código nas opções)
        continue
    if cod in vistos:
        continue
    vistos[cod] = nome
    if cod not in interno:
        nao_achado.append((nome, cod))
        continue
    r = omie('geral/malha', 'ConsultarEstrutura', {'idProduto': interno[cod][0]})
    itens = r.get('itens') or []
    (com if (r.get('ident') or itens) and 'faultstring' not in r else sem).append((nome, cod, len(itens)))
    time.sleep(0.45)  # respeita o limite de chamadas do Omie

print(f'códigos únicos conferidos: {len(vistos)} | taxas ignoradas: {taxas}')
print(f'COM estrutura: {len(com)} | SEM estrutura: {len(sem)} | código não existe no Omie: {len(nao_achado)} | produtos sem código (pais de variação ou sem vínculo): {len(sem_vinculo)}')
print('\n== SEM ESTRUTURA (venda baixa o produto acabado, não os ingredientes)')
for n, c, _ in sorted(sem):
    print(f'  {c:>8}  {n}')
if nao_achado:
    print('\n== CÓDIGO QUE NÃO EXISTE NO OMIE')
    for n, c in nao_achado:
        print(f'  {c:>8}  {n}')
