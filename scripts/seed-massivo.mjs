// Popula o banco com um catálogo grande e realista (várias lojas, milhares de produtos,
// funcionários, mesas) para teste de carga / teste manual em tempo real.
// Uso: node scripts/seed-massivo.mjs
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const u = new URL(env.SUPABASE_DB_URL)
const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')

let host = 'aws-1-sa-east-1.pooler.supabase.com'
let port = 5432
try {
  const saved = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim()
  const [h, p] = saved.split(':')
  if (h) host = h
  if (p) port = Number(p)
} catch {}

const client = new pg.Client({
  host, port, user: `postgres.${ref}`, password: senha,
  database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rnd = (min, max) => Math.random() * (max - min) + min
const rndInt = (min, max) => Math.floor(rnd(min, max + 1))
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const money = (n) => Math.round(n * 100) / 100
const img = (seed, w = 480, h = 360) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`

async function bulkInsert(table, columns, rows, returning = null) {
  if (rows.length === 0) return []
  const out = []
  const chunkSize = 200
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const values = []
    const placeholders = chunk.map((row, ri) => {
      const base = ri * columns.length
      const ph = columns.map((_, ci) => `$${base + ci + 1}`).join(',')
      values.push(...row)
      return `(${ph})`
    }).join(',')
    const sql = `insert into ${table} (${columns.join(',')}) values ${placeholders}${returning ? ` returning ${returning}` : ''}`
    const r = await client.query(sql, values)
    if (returning) out.push(...r.rows)
  }
  return out
}

// ─── Catálogo de nomes por categoria (combinados para gerar centenas de variações) ──

const SIZES_SALGADO = ['Pequena', 'Média', 'Grande', 'Família', 'Individual']
const ESTILOS = ['Tradicional', 'Especial', 'da Casa', 'Premium', 'Artesanal', 'Clássico(a)', 'Caseiro(a)', 'Gourmet']

const CATALOGS = {
  pizza_salgada: { base: ['Calabresa', 'Mussarela', 'Margherita', 'Frango com Catupiry', 'Portuguesa', 'Quatro Queijos', 'Pepperoni', 'Bacon', 'Vegetariana', 'Carne Seca', 'Atum', 'Palmito', 'Brócolis com Bacon', 'Lombo Canadense', 'Napolitana', 'Toscana', 'Camarão', 'Strogonoff de Frango', 'Alho e Óleo', 'Rúcula com Tomate Seco'], price: [42, 78], desc: 'Massa fina, molho de tomate artesanal e ingredientes selecionados' },
  pizza_doce: { base: ['Chocolate', 'Banana com Canela', 'Brigadeiro', 'Romeu e Julieta', 'Doce de Leite', 'Morango com Chocolate', 'Nutella', 'Prestígio', 'Beijinho'], price: [38, 58], desc: 'Massa fina coberta com recheio doce e finalização especial' },
  borda: { base: ['Borda Catupiry', 'Borda Cheddar', 'Borda Chocolate', 'Borda Cream Cheese', 'Borda Provolone'], price: [6, 14], desc: 'Adicional de borda recheada' },
  hamburguer: { base: ['Smash Clássico', 'Cheddar Bacon', 'Duplo Smash', 'Barbecue', 'Picanha', 'Veggie', 'Frango Crispy', 'Costela Desfiada', 'Onion Burger', 'Triplo Cheddar', 'Smash Brasileiro', 'Burger da Casa', 'Smoke House', 'Chicken Crispy', 'Black Burger', 'Smash Bacon Egg'], price: [22, 48], desc: 'Pão brioche, blend artesanal grelhado na chapa e molho especial' },
  acompanhamento: { base: ['Batata Frita', 'Batata Rústica', 'Onion Rings', 'Nuggets', 'Polenta Frita', 'Mandioca Frita', 'Anéis de Cebola Empanados', 'Batata com Cheddar e Bacon'], price: [14, 32], desc: 'Porção crocante, servida quente' },
  milkshake: { base: ['Chocolate', 'Morango', 'Baunilha', 'Ovomaltine', 'Nutella', 'Doce de Leite', 'Cookies and Cream', 'Paçoca'], price: [16, 26], desc: 'Cremoso, feito na hora com sorvete artesanal' },
  sushi: { base: ['Salmão', 'Atum', 'Skin', 'Uramaki Filadélfia', 'Hot Roll Salmão', 'Niguiri Salmão', 'Sashimi de Salmão', 'Joy Salmão', 'Uramaki California', 'Niguiri Atum', 'Hossomaki Kani', 'Uramaki Furay', 'Temaki Salmão', 'Temaki Atum', 'Temaki Camarão', 'Gunkan Salmão', 'Sushi Especial da Casa'], price: [12, 45], desc: 'Peixe fresco selecionado diariamente, preparo tradicional' },
  yakisoba: { base: ['Yakisoba de Carne', 'Yakisoba de Frango', 'Yakisoba Misto', 'Yakisoba Vegetariano', 'Yakisoba de Camarão'], price: [28, 45], desc: 'Macarrão oriental salteado com legumes frescos' },
  pao: { base: ['Pão Francês', 'Pão de Queijo', 'Pão de Forma Integral', 'Pão Italiano', 'Pão Australiano', 'Pão na Chapa', 'Croissant', 'Pão Doce', 'Pão de Leite', 'Baguete', 'Pão Sírio', 'Pão Sovado', 'Pão Caseiro', 'Pão Multigrãos', 'Pão de Centeio'], price: [0.6, 14], desc: 'Assado fresco diariamente em forno de lenha' },
  salgado: { base: ['Coxinha', 'Esfiha de Carne', 'Esfiha de Queijo', 'Risoles de Frango', 'Pastel de Carne', 'Pastel de Queijo', 'Empada de Frango', 'Quibe', 'Bolinha de Queijo', 'Croquete', 'Kibe Assado', 'Folhado de Frango', 'Enroladinho de Salsicha'], price: [5, 12], desc: 'Massa crocante e recheio generoso, assado/frito na hora' },
  doce_padaria: { base: ['Brigadeiro', 'Beijinho', 'Sonho', 'Bomba de Chocolate', 'Camafeu', 'Palha Italiana', 'Brownie', 'Cheesecake', 'Mousse de Maracujá', 'Torta de Limão', 'Pudim'], price: [6, 18], desc: 'Doce caseiro, feito com ingredientes selecionados' },
  bolo: { base: ['Bolo de Chocolate', 'Bolo de Cenoura', 'Bolo Red Velvet', 'Bolo de Fubá', 'Bolo Formigueiro', 'Bolo de Laranja', 'Bolo Prestígio', 'Bolo de Milho'], price: [8, 22], desc: 'Fatia generosa de bolo caseiro' },
  cafe: { base: ['Espresso', 'Cappuccino', 'Latte', 'Mocaccino', 'Café Coado', 'Café com Leite', 'Macchiato', 'Affogato', 'Café Gelado', 'Flat White', 'Cortado'], price: [6, 18], desc: 'Grãos selecionados, torra artesanal' },
  cha: { base: ['Chá Verde', 'Chá de Camomila', 'Chá de Hibisco', 'Chá Mate', 'Chá de Frutas Vermelhas', 'Chá Gelado de Pêssego'], price: [6, 12], desc: 'Infusão natural servida quente ou gelada' },
  sanduiche: { base: ['Sanduíche Natural de Frango', 'Misto Quente', 'Sanduíche de Atum', 'Croque Monsieur', 'Sanduíche Vegetariano', 'Baguete Recheada', 'Club Sandwich'], price: [12, 28], desc: 'Pão fresco com recheio generoso' },
  acai: { base: ['Açaí 300ml', 'Açaí 500ml', 'Açaí 700ml', 'Açaí 1L', 'Açaí no Copo Pequeno', 'Açaí Bowl', 'Açaí Fit'], price: [12, 32], desc: 'Açaí cremoso 100% natural, polpa selecionada' },
  complemento_acai: { base: ['Granola', 'Leite Condensado', 'Morango', 'Banana', 'Paçoca', 'Leite em Pó', 'Mel', 'Castanha', 'Chocolate Granulado', 'Kiwi', 'Confete'], price: [1.5, 5], desc: 'Adicional para montar seu açaí' },
  suco: { base: ['Suco de Laranja', 'Suco de Abacaxi', 'Suco de Maracujá', 'Suco de Manga', 'Suco de Melancia', 'Suco Verde', 'Suco de Uva', 'Limonada'], price: [7, 14], desc: 'Suco natural, feito na hora' },
  vitamina: { base: ['Vitamina de Banana', 'Vitamina de Morango', 'Vitamina de Abacate', 'Vitamina Mista', 'Vitamina de Mamão'], price: [9, 16], desc: 'Vitamina cremosa feita com fruta fresca e leite' },
  petisco: { base: ['Batata Frita', 'Frango a Passarinho', 'Calabresa Acebolada', 'Bolinho de Bacalhau', 'Isca de Peixe', 'Anel de Cebola', 'Pastel', 'Torresmo', 'Camarão Empanado', 'Provolone na Chapa', 'Bolinho de Carne Seca'], price: [22, 58], desc: 'Porção para compartilhar, ideal para acompanhar bebida' },
  cerveja: { base: ['Pilsen', 'IPA', 'Weiss', 'Stout', 'Lager', 'Vinho Branco Taça', 'Vinho Tinto Taça', 'Chopp Claro', 'Chopp Escuro'], price: [8, 22], desc: 'Gelada na medida certa' },
  drink: { base: ['Caipirinha', 'Caipiroska', 'Gin Tônica', 'Moscow Mule', 'Mojito', 'Negroni', 'Aperol Spritz', 'Margarita', 'Cuba Libre'], price: [18, 32], desc: 'Drink autoral preparado pelo bartender' },
  prato_executivo: { base: ['Filé com Fritas', 'Frango Grelhado', 'Strogonoff de Carne', 'Feijoada', 'Parmegiana de Frango', 'Bife à Role', 'Peixe Grelhado'], price: [28, 52], desc: 'Prato completo, serve uma pessoa' },
  carne_nobre: { base: ['Picanha', 'Fraldinha', 'Maminha', 'Costela', 'Alcatra', 'Cupim', 'Filé Mignon', 'Linguiça Artesanal', 'Coração de Frango'], price: [38, 95], desc: 'Corte nobre grelhado no ponto, temperado com sal grosso' },
  espetinho: { base: ['Espetinho de Carne', 'Espetinho de Frango', 'Espetinho de Linguiça', 'Espetinho de Queijo Coalho', 'Espetinho Misto', 'Espetinho de Coração'], price: [9, 16], desc: 'Espetinho grelhado na brasa' },
  salada: { base: ['Salada Caesar', 'Salada Caprese', 'Salada Tropical', 'Salada de Folhas', 'Salada de Grão de Bico', 'Salada Mista'], price: [16, 30], desc: 'Folhas frescas e ingredientes selecionados' },
  sorvete: { base: ['Sorvete de Chocolate', 'Sorvete de Morango', 'Sorvete de Creme', 'Sorvete de Flocos', 'Picolé de Frutas'], price: [7, 16], desc: 'Sorvete artesanal cremoso' },
  agua_refri: { base: ['Água Mineral', 'Água com Gás', 'Refrigerante Lata', 'Refrigerante 600ml', 'Energético', 'Água de Coco'], price: [5, 12], desc: 'Bebida gelada' },
}

function genProducts(catalogKey, count, destination = 'kitchen') {
  const cat = CATALOGS[catalogKey]
  const out = []
  const nameCount = new Map()
  while (out.length < count) {
    const base = pick(cat.base)
    const useVariant = Math.random() < 0.65
    const variant = useVariant ? pick(ESTILOS) : null
    const name = variant ? `${base} ${variant}` : base
    const seen = nameCount.get(name) || 0
    nameCount.set(name, seen + 1)
    const finalName = seen > 0 ? `${name} ${seen + 1}` : name
    const price = money(rnd(cat.price[0], cat.price[1]))
    out.push({ name: finalName, description: cat.desc, price, destination })
  }
  return out
}

// ─── Definição das lojas ─────────────────────────────────────────────────────

const STORES = [
  {
    name: 'Pizzaria Bella Napoli', cnpj: '11.222.333/0001-44', tables: 18,
    categories: [
      { name: 'Pizzas Salgadas', gen: () => genProducts('pizza_salgada', 140) },
      { name: 'Pizzas Doces', gen: () => genProducts('pizza_doce', 50) },
      { name: 'Bordas Recheadas', gen: () => genProducts('borda', 15) },
      { name: 'Bebidas', gen: () => genProducts('agua_refri', 25, 'bar') },
      { name: 'Sobremesas', gen: () => genProducts('doce_padaria', 35) },
    ],
  },
  {
    name: 'Hamburgueria Smash House', cnpj: '22.333.444/0001-55', tables: 14,
    categories: [
      { name: 'Hambúrgueres', gen: () => genProducts('hamburguer', 160) },
      { name: 'Acompanhamentos', gen: () => genProducts('acompanhamento', 55) },
      { name: 'Milkshakes', gen: () => genProducts('milkshake', 35, 'bar') },
      { name: 'Bebidas', gen: () => genProducts('agua_refri', 25, 'bar') },
    ],
  },
  {
    name: 'Sushi Yama', cnpj: '33.444.555/0001-66', tables: 16,
    categories: [
      { name: 'Sushis e Sashimis', gen: () => genProducts('sushi', 200) },
      { name: 'Yakisoba', gen: () => genProducts('yakisoba', 25) },
      { name: 'Bebidas', gen: () => genProducts('agua_refri', 25, 'bar') },
      { name: 'Sobremesas', gen: () => genProducts('sorvete', 20) },
    ],
  },
  {
    name: 'Padaria Sol Nascente', cnpj: '44.555.666/0001-77', tables: 10,
    categories: [
      { name: 'Pães', gen: () => genProducts('pao', 120) },
      { name: 'Salgados', gen: () => genProducts('salgado', 100) },
      { name: 'Doces', gen: () => genProducts('doce_padaria', 70) },
      { name: 'Bolos', gen: () => genProducts('bolo', 50) },
      { name: 'Bebidas', gen: () => genProducts('agua_refri', 20, 'bar') },
    ],
  },
  {
    name: 'Cafeteria Grão Especial', cnpj: '55.666.777/0001-88', tables: 12,
    categories: [
      { name: 'Cafés Especiais', gen: () => genProducts('cafe', 90, 'bar') },
      { name: 'Chás', gen: () => genProducts('cha', 30, 'bar') },
      { name: 'Doces', gen: () => genProducts('doce_padaria', 60) },
      { name: 'Sanduíches', gen: () => genProducts('sanduiche', 50) },
    ],
  },
  {
    name: 'Açaiteria Tropical', cnpj: '66.777.888/0001-99', tables: 8,
    categories: [
      { name: 'Açaí', gen: () => genProducts('acai', 50) },
      { name: 'Complementos', gen: () => genProducts('complemento_acai', 70) },
      { name: 'Sucos Naturais', gen: () => genProducts('suco', 40, 'bar') },
      { name: 'Vitaminas', gen: () => genProducts('vitamina', 25, 'bar') },
      { name: 'Sorvetes', gen: () => genProducts('sorvete', 25) },
    ],
  },
  {
    name: 'Bar do Zé', cnpj: '77.888.999/0001-10', tables: 20,
    categories: [
      { name: 'Petiscos', gen: () => genProducts('petisco', 100) },
      { name: 'Cervejas e Vinhos', gen: () => genProducts('cerveja', 45, 'bar') },
      { name: 'Drinks', gen: () => genProducts('drink', 45, 'bar') },
      { name: 'Pratos Executivos', gen: () => genProducts('prato_executivo', 35) },
    ],
  },
  {
    name: 'Churrascaria Fogo de Chão Lite', cnpj: '88.999.000/0001-21', tables: 22,
    categories: [
      { name: 'Carnes Nobres', gen: () => genProducts('carne_nobre', 100) },
      { name: 'Espetinhos', gen: () => genProducts('espetinho', 40) },
      { name: 'Saladas', gen: () => genProducts('salada', 35) },
      { name: 'Bebidas', gen: () => genProducts('agua_refri', 25, 'bar') },
      { name: 'Sobremesas', gen: () => genProducts('doce_padaria', 30) },
    ],
  },
]

const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Fábio', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nelson', 'Otávio', 'Patrícia', 'Rafael', 'Sabrina', 'Thiago', 'Vanessa']
const SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Lima', 'Carvalho']

function genFuncionarios(storeSlug) {
  const used = new Set()
  const pickNome = () => {
    let n
    do { n = `${pick(NOMES)} ${pick(SOBRENOMES)}` } while (used.has(n))
    used.add(n)
    return n
  }
  const mk = (nome, role, permissions) => {
    const email = `${slugify(nome)}@${storeSlug}.com`
    return { nome, email, role, permissions }
  }
  const all = (over = {}) => ({ tables: true, counter: true, kitchen: true, bar: true, menu: true, admin: true, ...over })
  return [
    mk(pickNome(), 'owner', all()),
    mk(pickNome(), 'manager', all({ admin: false })),
    mk(pickNome(), 'kitchen', { tables: false, counter: false, kitchen: true, bar: false, menu: false, admin: false }),
    mk(pickNome(), 'bar', { tables: false, counter: false, kitchen: false, bar: true, menu: false, admin: false }),
    mk(pickNome(), 'waiter', { tables: true, counter: true, kitchen: false, bar: false, menu: false, admin: false }),
  ]
}

// ─── Execução ────────────────────────────────────────────────────────────────

async function main() {
  await client.connect()
  await client.query('SET default_transaction_read_only = off')

  let totalProdutos = 0, totalCategorias = 0, totalMesas = 0, totalFuncionarios = 0
  const resumoLojas = []

  for (const storeDef of STORES) {
    const slug = slugify(storeDef.name)
    const logoSeed = `logo-${slug}`

    const [store] = await bulkInsert(
      'stores',
      ['name', 'slug', 'cnpj', 'logo_url', 'is_active', 'contract_type', 'contract_period_months', 'config'],
      [[
        storeDef.name, slug, storeDef.cnpj, img(logoSeed, 200, 200), true, 'balcao_mesas', 12,
        JSON.stringify({ use_pin: false, allow_client_open: true, require_pin_for_open: false, charge_service_fee: true }),
      ]],
      'id'
    )
    const storeId = store.id

    // categorias
    const catRows = storeDef.categories.map((c, idx) => [storeId, c.name, idx])
    const cats = await bulkInsert('categories', ['store_id', 'name', '"order"'], catRows, 'id, name')
    totalCategorias += cats.length

    // produtos
    let prodCount = 0
    for (const catDef of storeDef.categories) {
      const catRow = cats.find(c => c.name === catDef.name)
      const produtos = catDef.gen()
      const rows = produtos.map((p, idx) => [
        catRow.id, storeId, p.name, p.description, p.price,
        img(`${slug}-${slugify(catDef.name)}-${idx}-${slugify(p.name)}`),
        true, rndInt(5, 35), idx, p.destination,
      ])
      await bulkInsert(
        'products',
        ['category_id', 'store_id', 'name', 'description', 'price', 'image_url', 'available', 'prep_time_minutes', '"order"', 'destination'],
        rows
      )
      prodCount += rows.length
    }
    totalProdutos += prodCount

    // mesas
    const tableRows = []
    for (let n = 1; n <= storeDef.tables; n++) {
      tableRows.push([storeId, n, String(rndInt(1000, 9999)), 'available', 0])
    }
    await bulkInsert('tables', ['store_id', 'number', 'pin', 'status', 'guest_count'], tableRows)
    totalMesas += tableRows.length

    // funcionários
    const funcionarios = genFuncionarios(slug)
    const funcRows = funcionarios.map(f => [
      storeId, f.nome, f.email, 'demo123', f.role, false, JSON.stringify(f.permissions),
    ])
    await bulkInsert(
      'store_users',
      ['store_id', 'name', 'email', 'password', 'role', 'must_change_password', 'permissions'],
      funcRows
    )
    totalFuncionarios += funcRows.length

    resumoLojas.push({ nome: storeDef.name, slug, produtos: prodCount, mesas: storeDef.tables, funcionarios: funcionarios.map(f => `${f.email} (${f.role})`) })
    console.log(`OK: ${storeDef.name} -> ${prodCount} produtos, ${storeDef.tables} mesas, ${funcionarios.length} funcionários`)
  }

  console.log('\n=== RESUMO ===')
  console.log(`Lojas: ${STORES.length}`)
  console.log(`Categorias: ${totalCategorias}`)
  console.log(`Produtos: ${totalProdutos}`)
  console.log(`Mesas: ${totalMesas}`)
  console.log(`Funcionários: ${totalFuncionarios}`)
  console.log('\nSenha de todos os funcionários novos: demo123')
  console.log(JSON.stringify(resumoLojas, null, 2))

  await client.end()
}

main().catch(async (e) => {
  console.error('ERRO:', e)
  try { await client.end() } catch {}
  process.exit(1)
})
