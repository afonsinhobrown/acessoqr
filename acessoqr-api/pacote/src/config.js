// Configuração por omissão das decisões em aberto do ToR (§18).
// Cada organizador pode alterar os seus valores no painel; cada evento pode
// sobrepor os valores que fazem sentido por evento. Sem linha na base de
// dados, vale sempre o valor definido aqui.
const { httpErr } = require('./errors');
const { registar } = require('./auditoria');

// Valores monetários em centavos (inteiros). MZN = 100 centavos.
const DEFAULTS = {
  saldo_maximo_padrao: 5_000_000, // 50.000,00 MZN
  offline_venda_max: 200_000, // 2.000,00 MZN
  offline_dispositivo_max: 2_000_000, // 20.000,00 MZN
  offline_duracao_horas: 4,
  retencao_dados_meses: 12,
  reembolso_prazo_dias: 30,
  reembolso_taxa_pct: 0,
  reembolso_minimo: 10_000, // 100,00 MZN
  reembolso_parcial: true,
  reembolsos_antes_fim: false,
  saldo_nao_usado: 'reembolso',
  modelo_receita: {
    comissao_recarga_pct: 0,
    comissao_venda_pct: 0,
    taxa_fixa_organizador: 0,
  },
  prestador_pagamentos: 'paysuite',
  licenciamento: 'prestador_licenciado',
  pin_limite: 100_000, // 1.000,00 MZN
  otp_canal: 'email',
  moeda: 'MZN',
};

const DESCRICOES = {
  saldo_maximo_padrao: 'Saldo máximo por carteira quando o evento não define outro (centavos).',
  offline_venda_max: 'Valor máximo de uma venda offline (centavos).',
  offline_dispositivo_max: 'Total máximo acumulado por dispositivo offline (centavos).',
  offline_duracao_horas: 'Horas máximas offline antes de exigir sincronização.',
  retencao_dados_meses: 'Meses de retenção de dados pessoais após o fim do evento.',
  reembolso_prazo_dias: 'Dias após o fim do evento para pedir reembolso.',
  reembolso_taxa_pct: 'Taxa de reembolso aplicada ao valor pedido (0 a 100).',
  reembolso_minimo: 'Valor mínimo de um pedido de reembolso (centavos).',
  reembolso_parcial: 'Permitir reembolso parcial do saldo.',
  reembolsos_antes_fim: 'Permitir reembolsos antes do fim do evento.',
  saldo_nao_usado: 'Destino do saldo não usado: reembolso, transita ou organizador.',
  modelo_receita: 'Comissões da plataforma (percentagens e taxa fixa em centavos).',
  prestador_pagamentos: 'Prestador/agregador de pagamentos usado.',
  licenciamento: 'Modelo de licenciamento: prestador_licenciado ou proprio.',
  pin_limite: 'Valor a partir do qual é exigido PIN (centavos).',
  otp_canal: 'Canal por omissão para OTP: email, sms ou whatsapp.',
  moeda: 'Moeda do evento.',
};

const TIPOS = {
  saldo_maximo_padrao: 'inteiro_positivo',
  offline_venda_max: 'inteiro_positivo',
  offline_dispositivo_max: 'inteiro_positivo',
  offline_duracao_horas: 'inteiro_positivo',
  retencao_dados_meses: 'inteiro_nao_negativo',
  reembolso_prazo_dias: 'inteiro_nao_negativo',
  reembolso_taxa_pct: 'percentagem',
  reembolso_minimo: 'inteiro_nao_negativo',
  reembolso_parcial: 'booleano',
  reembolsos_antes_fim: 'booleano',
  saldo_nao_usado: ['reembolso', 'transita', 'organizador'],
  modelo_receita: 'modelo_receita',
  prestador_pagamentos: ['paysuite', 'agregador'],
  licenciamento: ['prestador_licenciado', 'proprio'],
  pin_limite: 'inteiro_nao_negativo',
  otp_canal: ['email', 'sms', 'whatsapp'],
  moeda: 'moeda',
};

// Chaves que podem ser sobrepostas por evento.
const CHAVES_EVENTO = [
  'offline_venda_max',
  'offline_dispositivo_max',
  'offline_duracao_horas',
  'reembolso_prazo_dias',
  'reembolso_taxa_pct',
  'reembolso_minimo',
  'reembolso_parcial',
  'reembolsos_antes_fim',
  'saldo_nao_usado',
  'pin_limite',
];

function validarValor(chave, valor) {
  const regra = TIPOS[chave];
  if (!regra) throw httpErr(400, 'configuracao_desconhecida');

  const inteiro = (min) => {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < min) throw httpErr(400, `${chave}_invalido`);
    return n;
  };

  switch (regra) {
    case 'inteiro_positivo':
      return inteiro(1);
    case 'inteiro_nao_negativo':
      return inteiro(0);
    case 'percentagem': {
      const n = inteiro(0);
      if (n > 100) throw httpErr(400, `${chave}_invalido`);
      return n;
    }
    case 'booleano':
      if (typeof valor !== 'boolean') throw httpErr(400, `${chave}_invalido`);
      return valor;
    case 'moeda':
      if (typeof valor !== 'string' || !/^[A-Z]{3}$/.test(valor))
        throw httpErr(400, `${chave}_invalido`);
      return valor;
    case 'modelo_receita': {
      if (!valor || typeof valor !== 'object' || Array.isArray(valor))
        throw httpErr(400, 'modelo_receita_invalido');
      const out = {};
      for (const k of ['comissao_recarga_pct', 'comissao_venda_pct']) {
        const n = Number(valor[k] ?? 0);
        if (!Number.isInteger(n) || n < 0 || n > 100)
          throw httpErr(400, `${k}_invalido`);
        out[k] = n;
      }
      const t = Number(valor.taxa_fixa_organizador ?? 0);
      if (!Number.isInteger(t) || t < 0) throw httpErr(400, 'taxa_fixa_organizador_invalida');
      out.taxa_fixa_organizador = t;
      return out;
    }
    default:
      if (Array.isArray(regra)) {
        if (!regra.includes(valor)) throw httpErr(400, `${chave}_invalido`);
        return valor;
      }
      throw httpErr(400, `${chave}_invalido`);
  }
}

function validarConfigEvento(config) {
  if (config === undefined || config === null) return {};
  if (typeof config !== 'object' || Array.isArray(config))
    throw httpErr(400, 'config_invalida');
  const out = {};
  for (const [chave, valor] of Object.entries(config)) {
    if (!CHAVES_EVENTO.includes(chave)) throw httpErr(400, 'configuracao_desconhecida');
    out[chave] = validarValor(chave, valor);
  }
  return out;
}

function definicoes() {
  return Object.keys(DEFAULTS).map((chave) => ({
    chave,
    descricao: DESCRICOES[chave],
    valor_padrao: DEFAULTS[chave],
    tipo: Array.isArray(TIPOS[chave]) ? 'enum' : TIPOS[chave],
    opcoes: Array.isArray(TIPOS[chave]) ? TIPOS[chave] : undefined,
    por_evento: CHAVES_EVENTO.includes(chave),
  }));
}

async function valores(c, organizadorId) {
  const { rows } = await c.query(
    'SELECT chave, valor FROM organizer_settings WHERE organizer_id=$1',
    [organizadorId]
  );
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.chave] = r.valor;
  return out;
}

async function valor(c, organizadorId, chave) {
  const v = await valores(c, organizadorId);
  return v[chave];
}

function aplicarEvento(base, configEvento) {
  if (!configEvento || typeof configEvento !== 'object') return { ...base };
  return { ...base, ...configEvento };
}

async function configuracaoEvento(c, evento) {
  const base = await valores(c, evento.organizer_id);
  return aplicarEvento(base, evento.config);
}

async function actualizar(c, { organizadorId, valores: novos }) {
  if (!novos || typeof novos !== 'object' || Array.isArray(novos))
    throw httpErr(400, 'configuracao_invalida');
  const aplicados = {};
  for (const [chave, valor] of Object.entries(novos)) {
    aplicados[chave] = validarValor(chave, valor);
  }
  for (const [chave, valor] of Object.entries(aplicados)) {
    await c.query(
      `INSERT INTO organizer_settings (organizer_id, chave, valor)
       VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (organizer_id, chave)
       DO UPDATE SET valor=EXCLUDED.valor, actualizado_em=now()`,
      [organizadorId, chave, JSON.stringify(valor)]
    );
  }
  await registar(c, {
    actorId: organizadorId,
    acao: 'configuracoes.actualizar',
    metadados: aplicados,
  });
  return valores(c, organizadorId);
}

module.exports = {
  DEFAULTS,
  DESCRICOES,
  CHAVES_EVENTO,
  definicoes,
  valores,
  valor,
  validarValor,
  validarConfigEvento,
  aplicarEvento,
  configuracaoEvento,
  actualizar,
};
