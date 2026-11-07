#!/usr/bin/env python3
# Conferência diária Norte Vendas x Omie (07/11/2026). Para cada loja do Vendas em modo Omie que emitiu NFC-e ontem:
#  - toda nota autorizada de ontem tem título no contas a receber do Omie (pela chave) com o mesmo valor;
#  - nenhuma nota recente parada em erro / na fila;
#  - nenhum produto à venda sem código do Omie (nem no produto nem nas opções): a nota com ele seria recusada para sempre.
# Só lê (Omie e bancos). Se achar problema, manda WhatsApp para o dono; se estiver tudo certo, só grava no log.
# Uso: conferencia-omie.py [AAAA-MM-DD] [--sem-zap]
import datetime, json, subprocess, sys, time, urllib.request, urllib.error, re, os

ZAP_PARA = '557196591404'
ZAP_URL = 'http://127.0.0.1:8095/message/sendText/joaquim-main'


def sql(db, q):
    out = subprocess.run(['docker', 'exec', 'supabase-db', 'psql', '-U', 'supabase_admin', '-d', db, '-v', 'ON_ERROR_STOP=1',
                          '-qAt', '-F', '\t', '-c', q], check=True, capture_output=True, text=True).stdout
    return [l.split('\t') for l in out.splitlines() if l]


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def omie_listar(key, secret, dia):
    d = dia.strftime('%d/%m/%Y')
    hoje = datetime.date.today().strftime('%d/%m/%Y')
    titulos, pagina = [], 1
    while True:
        body = {'call': 'ListarContasReceber', 'app_key': key, 'app_secret': secret,
                'param': [{'pagina': pagina, 'registros_por_pagina': 500, 'apenas_importado_api': 'N',
                           'filtrar_apenas_inclusao': 'S', 'filtrar_por_data_de': d, 'filtrar_por_data_ate': hoje}]}
        req = urllib.request.Request('https://app.omie.com.br/api/v1/financas/contareceber/', data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json'})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=90))
        except urllib.error.HTTPError as e:
            r = json.load(e)
        if r.get('faultstring'):
            if 'Não existem registros' in r['faultstring']:
                return titulos
            raise RuntimeError('Omie: ' + r['faultstring'][:200])
        titulos += r.get('conta_receber_cadastro', [])
        if pagina >= int(r.get('total_de_paginas') or 1):
            return titulos
        pagina += 1
        time.sleep(3)


def brl(v):
    return f'R$ {v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dia = datetime.date.fromisoformat(args[0]) if args else datetime.date.today() - datetime.timedelta(days=1)
    sem_zap = '--sem-zap' in sys.argv
    ds = dia.isoformat()
    lojas = sql('ntb_vendas', f"""
        select s.id, s.name, e.ntb_estoque_api_key from stores s join store_ntb_estoque_secrets e on e.store_id = s.id and e.ativo
        where s.stock_mode = 'omie' and exists (select 1 from fiscal_notas f where f.store_id = s.id and f.status = 'autorizada'
          and (f.created_at at time zone 'America/Bahia')::date = {lit(ds)})""")
    problemas = []
    for store_id, nome, chave_int in lojas:
        loja = sql('postgres', f"select id, omie_app_key, omie_app_secret from lojas where integracao_api_key = {lit(chave_int)} and omie_app_key is not null")
        if not loja:
            problemas.append(f'*{nome}*: não achei a loja do Estoque ligada ao Vendas.')
            continue
        _, key, secret = loja[0]
        notas = sql('ntb_vendas', f"""
            select chave_acesso, serie, numero, valor_total, coalesce(omie_status, '-'), coalesce(omie_erro, ''),
                   to_char(created_at at time zone 'America/Bahia', 'HH24:MI')
            from fiscal_notas where store_id = {lit(store_id)} and status = 'autorizada'
              and (created_at at time zone 'America/Bahia')::date = {lit(ds)}""")
        try:
            titulos = omie_listar(key, secret, dia)
        except Exception as e:  # Omie fora do ar / bloqueado: avisa, não inventa resultado
            problemas.append(f'*{nome}*: não consegui ler o Omie ({str(e)[:150]}).')
            continue
        por_chave = {}
        for t in titulos:
            if t.get('chave_nfe'):
                por_chave.setdefault(t['chave_nfe'], []).append(t)
        faltam, diferentes = [], []
        for ch, serie, num, val, ost, oerro, hora in notas:
            ts = por_chave.get(ch)
            if not ts:
                motivo = oerro or ('na fila do Estoque' if ost == 'na_fila' else 'sem título no Omie')
                faltam.append(f'• nº {num} (série {serie}) {hora} {brl(float(val))}: {motivo[:120]}')
            elif abs(sum(t['valor_documento'] for t in ts) - float(val)) > 0.05:
                diferentes.append(f'• nº {num} (série {serie}): nota {brl(float(val))}, Omie {brl(sum(t["valor_documento"] for t in ts))}')
        produtos = sql('ntb_vendas', f"""
            select p.name from products p where p.store_id = {lit(store_id)} and p.available and p.omie_codigo is null
              and not exists (select 1 from product_option_groups g join product_options o on o.group_id = g.id
                              where g.product_id = p.id and o.omie_codigo is not null)
            order by p.name""")
        bloco = []
        if faltam:
            bloco.append(f'{len(faltam)} nota(s) de {dia:%d/%m} *fora do Omie*:\n' + '\n'.join(faltam[:15]))
        if diferentes:
            bloco.append(f'{len(diferentes)} nota(s) com *valor diferente* no Omie:\n' + '\n'.join(diferentes[:10]))
        if produtos:
            bloco.append(f'{len(produtos)} produto(s) à venda *sem código do Omie* (nota com eles é recusada):\n'
                         + '\n'.join('• ' + p[0] for p in produtos[:15]))
        print(f'{datetime.datetime.now():%F %T} {nome} {ds}: {len(notas)} notas, {len(titulos)} títulos lidos, '
              f'{len(faltam)} faltando, {len(diferentes)} diferentes, {len(produtos)} produtos sem código')
        if bloco:
            problemas.append(f'*{nome}* ({len(notas)} notas de {dia:%d/%m}):\n' + '\n\n'.join(bloco))
    if not lojas:
        print(f'{datetime.datetime.now():%F %T} {ds}: nenhuma loja Omie com nota')
    if problemas:
        texto = 'Conferência Norte Vendas x Omie\n\n' + '\n\n'.join(problemas)
        print(texto)
        if not sem_zap:
            env = open('/opt/whatsapp-bridge/.env').read() + '\n' + (open('/opt/whatsapp-bridge/wrapper/.env').read()
                                                                     if os.path.exists('/opt/whatsapp-bridge/wrapper/.env') else '')
            m = re.search(r'^(?:AUTHENTICATION_API_KEY|EVOLUTION_API_KEY|API_KEY)=["\']?([^"\'\n]+)', env, re.M)
            req = urllib.request.Request(ZAP_URL, data=json.dumps({'number': ZAP_PARA, 'text': texto}).encode(),
                                         headers={'Content-Type': 'application/json', 'apikey': m.group(1)})
            urllib.request.urlopen(req, timeout=30).read()


if __name__ == '__main__':
    main()
