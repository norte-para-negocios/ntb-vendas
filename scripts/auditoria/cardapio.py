#!/usr/bin/env python3
"""Auditoria SOMENTE LEITURA do cardápio (Norte Vendas). Espelha lib/cardapioIntegridade.ts.
Roda no servidor Contabo. Nunca escreve no banco (sessão read-only) nem no Omie.

Uso (no servidor):
  python3 cardapio.py [--lojas sert,donana] [--omie sert=4] > relatorio.md
  --lojas  trechos do nome das lojas (padrão: sert,donana)
  --omie   trecho_do_nome=id_da_loja_no_estoque; compara com o Omie via ListarProdutos
           (NO MÁXIMO 3 chamadas por loja; nunca ConsultarEstrutura). Sem esta opção, não consulta o Omie.
Saída: relatório em Markdown. Não imprime segredos."""
import difflib, json, re, subprocess, sys, time, unicodedata, urllib.request, urllib.error, os
from collections import defaultdict

MAX_CHAMADAS_OMIE = 3
PESO = {'alta': 0, 'media': 1, 'baixa': 2}


def psql_json(sql):
    env = dict(os.environ, PGOPTIONS='-c default_transaction_read_only=on')
    cmd = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', 'supabase-db',
           'psql', '-U', 'supabase_admin', '-d', 'ntb_vendas', '-At', '-c',
           f"select coalesce(json_agg(t),'[]'::json) from ({sql}) t"]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        sys.exit('erro psql: ' + r.stderr[:300])
    return json.loads(r.stdout.strip() or '[]')


def norm(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', re.sub(r'&[a-z]+;', ' ', s)).strip()


def _chave(s):
    s = norm(s)
    s = re.sub(r'\b(ml|gr|g|und|unid|unids|un)\b', ' ', s)
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    s = re.sub(r'\b(de|do|da|com|c|e)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def nomes_divergem(a, b):
    ka, kb = _chave(a), _chave(b)
    if ka == kb or ka.replace(' ', '') == kb.replace(' ', ''):
        return False
    return difflib.SequenceMatcher(None, ka, kb).ratio() < 0.75


def auditar(cats, prods, grupos_por_prod):
    out = []
    add = lambda tipo, sev, texto: out.append({'tipo': tipo, 'sev': sev, 'texto': texto})
    ids_cat = {c['id'] for c in cats}
    ativos = [p for p in prods if p['available']]
    for p in ativos:
        if not p['category_id']:
            add('sem_categoria', 'alta', f'"{p["name"]}" está ativo mas sem categoria.')
        elif p['category_id'] not in ids_cat:
            add('categoria_de_outra_loja', 'alta', f'"{p["name"]}" aponta para categoria que não é desta loja.')
    for c in cats:
        if not any(p['category_id'] == c['id'] for p in ativos):
            add('categoria_vazia', 'baixa', f'A categoria "{c["name"]}" não tem nenhum produto ativo.')
    for p in ativos:
        g = grupos_por_prod.get(p['id'], [])
        if not p['fee_type'] and not g and float(p['price'] or 0) <= 0:
            add('preco_zero', 'alta', f'"{p["name"]}" está com preço zero.')
    por_nome = defaultdict(list)
    for p in ativos:
        por_nome[p['name'].strip().lower()].append(p)
    for l in por_nome.values():
        if len(l) > 1:
            add('nome_duplicado', 'media', f'Nome repetido: "{l[0]["name"]}" ({len(l)} produtos).')
    por_pos = defaultdict(list)
    for p in ativos:
        if p['order'] is not None:
            por_pos[(p['category_id'], p['order'])].append(p)
    for l in por_pos.values():
        if len(l) > 1:
            add('ordem_repetida', 'baixa', 'Mesma posição na categoria: ' + ', '.join(f'"{p["name"]}"' for p in l) + '.')
    for p in ativos:
        if p['order'] is None:
            add('sem_posicao', 'baixa', f'"{p["name"]}" não tem posição definida na categoria.')
    pos_cat = defaultdict(list)
    for c in cats:
        if c['order'] is not None:
            pos_cat[c['order']].append(c['name'])
    for l in pos_cat.values():
        if len(l) > 1:
            add('ordem_repetida', 'baixa', 'Categorias na mesma posição: ' + ', '.join(f'"{n}"' for n in l) + '.')
    for p in ativos:
        for g in grupos_por_prod.get(p['id'], []):
            if g['required'] and g['opcoes'] == 0:
                add('grupo_obrigatorio_vazio', 'alta', f'"{p["name"]}": o grupo obrigatório "{g["name"]}" não tem opções disponíveis (a venda trava).')
    sem_cod = [p for p in ativos if not p['fee_type'] and not p['omie_codigo'] and not any(x['tem_codigo'] for x in grupos_por_prod.get(p['id'], []))]
    com_cod = sum(1 for p in ativos if not p['fee_type']) - len(sem_cod)
    if sem_cod and com_cod == 0:
        add('sem_codigo_omie', 'baixa', f'Nenhum produto tem código do Omie ({len(sem_cod)} produtos): a loja não está ligada ao estoque, a venda não baixa estoque.')
    else:
        for p in sem_cod:
            add('sem_codigo_omie', 'media', f'"{p["name"]}" não tem código do Omie (a venda não baixa estoque).')
    return out


def comparar_omie(loja_id, prods, opcoes_cod):
    env = dict(l.strip().split('=', 1) for l in open('/opt/ntb-estoque/.env.local') if '=' in l and not l.startswith('#'))
    url, svc = env['NEXT_PUBLIC_SUPABASE_URL'].strip('"'), env['SUPABASE_SERVICE_ROLE_KEY'].strip('"')
    req = urllib.request.Request(url + f'/rest/v1/lojas?select=omie_app_key,omie_app_secret&id=eq.{loja_id}', headers={'apikey': svc, 'Authorization': 'Bearer ' + svc})
    loja = json.loads(urllib.request.urlopen(req, timeout=30).read())[0]
    key, sec = loja['omie_app_key'], loja['omie_app_secret']
    omie, chamadas, total_pag, total_reg = {}, 0, 1, 0
    pagina = 1
    while pagina <= total_pag and chamadas < MAX_CHAMADAS_OMIE:
        body = json.dumps({'call': 'ListarProdutos', 'app_key': key, 'app_secret': sec, 'param': [{'pagina': pagina, 'registros_por_pagina': 500, 'apenas_importado_api': 'N', 'filtrar_apenas_omiepdv': 'N'}]}).encode()
        r = urllib.request.Request('https://app.omie.com.br/api/v1/geral/produtos/', body, {'Content-Type': 'application/json'})
        try:
            d = json.loads(urllib.request.urlopen(r, timeout=90).read())
        except urllib.error.HTTPError as e:
            d = json.loads(e.read() or b'{}')
        chamadas += 1
        if 'faultstring' in d:
            return [], {'chamadas': chamadas, 'erro': d['faultstring'][:160]}
        total_pag, total_reg = d.get('total_de_paginas', 1), d.get('total_de_registros', 0)
        for x in d.get('produto_servico_cadastro', []):
            omie[str(x['codigo'])] = x
        pagina += 1
        time.sleep(1.2)
    completo = pagina > total_pag
    out = []
    add = lambda tipo, sev, texto: out.append({'tipo': tipo, 'sev': sev, 'texto': texto})
    for p in prods:
        if not p['available'] or not p['omie_codigo']:
            continue
        o = omie.get(str(p['omie_codigo']))
        if o is None:
            if completo:
                add('omie_codigo_inexistente', 'alta', f'"{p["name"]}" usa o código {p["omie_codigo"]}, que não existe no Omie.')
            continue
        if o.get('inativo') == 'S':
            add('omie_produto_inativo', 'alta', f'"{p["name"]}" ({p["omie_codigo"]}) está inativo no Omie.')
        if nomes_divergem(o.get('descricao'), p['name']):
            add('omie_nome_diferente', 'baixa', f'"{p["name"]}" ({p["omie_codigo"]}) no Omie se chama "{o.get("descricao")}".')
        if p['tem_grupo'] is False and not p['fee_type']:
            vu = float(o.get('valor_unitario') or 0)
            if abs(vu - float(p['price'] or 0)) > 0.005:
                add('omie_preco_diferente', 'media', f'"{p["name"]}" ({p["omie_codigo"]}): preço R$ {float(p["price"]):.2f} aqui, R$ {vu:.2f} no Omie.')
        ncm_o, ncm_p = re.sub(r'\D', '', o.get('ncm') or ''), re.sub(r'\D', '', p['ncm'] or '')
        if ncm_o and ncm_p and ncm_o != ncm_p:
            add('omie_ncm_diferente', 'media', f'"{p["name"]}" ({p["omie_codigo"]}): NCM {ncm_p} aqui, {ncm_o} no Omie.')
    for nome, cod in opcoes_cod:
        o = omie.get(str(cod))
        if o is None:
            if completo:
                add('omie_codigo_inexistente', 'alta', f'Opção "{nome}" usa o código {cod}, que não existe no Omie.')
        elif o.get('inativo') == 'S':
            add('omie_produto_inativo', 'alta', f'Opção "{nome}" ({cod}) está inativa no Omie.')
    return out, {'chamadas': chamadas, 'registros': total_reg, 'completo': completo, 'paginas': total_pag}


def main():
    a = sys.argv[1:]
    lojas = (a[a.index('--lojas') + 1] if '--lojas' in a else 'sert,donana').split(',')
    omie_map = dict(x.split('=') for x in (a[a.index('--omie') + 1].split(',') if '--omie' in a else []))
    cond = ' or '.join(f"name ilike '%{t.strip()}%'" for t in lojas if re.fullmatch(r'[\w ]+', t.strip()))
    stores = psql_json(f"select id, name, is_test from stores where is_active and ({cond}) order by name")
    print(f'# Auditoria do cardápio (somente leitura)\n\nGerada em {time.strftime("%Y-%m-%d %H:%M")}. Nada foi alterado.\n')
    resumo = []
    for s in stores:
        sid = s['id']
        cats = psql_json(f"select id, name, \"order\" from categories where store_id='{sid}'")
        prods = psql_json(f"select id, name, price, category_id, available, \"order\", omie_codigo, fee_type, ncm from products where store_id='{sid}'")
        gr = psql_json(f"""select g.product_id, g.name, g.required,
            count(o.id) filter (where o.available) as opcoes,
            bool_or(o.omie_codigo is not null or o.variants::text like '%omie_codigo%') as tem_codigo
            from product_option_groups g join products p on p.id=g.product_id left join product_options o on o.group_id=g.id
            where p.store_id='{sid}' group by g.id""")
        grupos = defaultdict(list)
        for g in gr:
            grupos[g['product_id']].append({'name': g['name'], 'required': g['required'], 'opcoes': g['opcoes'], 'tem_codigo': bool(g['tem_codigo'])})
        for p in prods:
            p['tem_grupo'] = bool(grupos.get(p['id']))
        achados = auditar(cats, prods, grupos)
        info_omie = None
        chave = next((v for k, v in omie_map.items() if k.lower() in s['name'].lower()), None)
        if chave:
            ops = psql_json(f"select p.name||' > '||o.name as n, o.omie_codigo as c from product_options o join product_option_groups g on g.id=o.group_id join products p on p.id=g.product_id where p.store_id='{sid}' and p.available and o.available and o.omie_codigo is not null")
            extra, info_omie = comparar_omie(chave, prods, [(x['n'], x['c']) for x in ops])
            achados += extra
        achados.sort(key=lambda x: PESO[x['sev']])
        por_tipo = defaultdict(int)
        for x in achados:
            por_tipo[x['tipo']] += 1
        print(f'## {s["name"]}\n')
        print(f'- Categorias: {len(cats)} | produtos ativos: {sum(1 for p in prods if p["available"])} de {len(prods)}')
        if chave:
            print(f'- Omie (loja {chave} do estoque): {info_omie}')
        else:
            print('- Comparação com o Omie: não feita para esta loja.')
        print('\n### Contagem por tipo\n')
        for t, n in sorted(por_tipo.items(), key=lambda kv: -kv[1]):
            print(f'- {t}: {n}')
        for sev, tit in (('alta', 'Precisa corrigir'), ('media', 'Vale conferir'), ('baixa', 'Detalhe')):
            l = [x for x in achados if x['sev'] == sev]
            if l:
                print(f'\n### {tit} ({len(l)})\n')
                for x in l:
                    print(f'- [{x["tipo"]}] {x["texto"]}')
        print()
        resumo.append((s['name'], len(achados)))


main()
