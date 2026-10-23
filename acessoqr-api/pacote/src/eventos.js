// Eventos e catálogo operacional do organizador: tipos de bilhete, pontos de
// venda e vendedores. Todas as acções ficam no audit_log.
const { httpErr } = require('./errors');
const { registar } = require('./auditoria');
const C = require('./config');

const ESTADOS = ['rascunho', 'publicado', 'em_curso', 'encerrado', 'cancelado'];
const TRANSICOES = {
  rascunho: ['publicado', 'cancelado'],
  publicado: ['em_curso', 'encerrado', 'cancelado'],
  em_curso: ['encerrado', 'cancelado'],
  encerrado: [],
  cancelado: [],
};

function inteiroNaoNegativo(v, nome) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw httpErr(400, `${nome}_invalido`);
  return n;
}

function inteiroPositivo(v, nome) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw httpErr(400, `${nome}_invalido`);
  return n;
}

function dataValida(v, nome) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw httpErr(400, `${nome}_invalido`);
  return d;
}

function textoObrigatorio(v, nome) {
  if (typeof v !== 'string' || !v.trim()) throw httpErr(400, `${nome}_obrigatorio`);
  return v.trim();
}

async function eventoDoOrganizador(c, organizadorId, eventoId) {
  const ev = (await c.query(
    'SELECT * FROM events WHERE id=$1 AND organizer_id=$2',
    [eventoId, organizadorId]
  )).rows[0];
  if (!ev) throw httpErr(403, 'evento_sem_acesso');
  return ev;
}

function validarDatas(inicio, fim) {
  if (fim <= inicio) throw httpErr(400, 'fim_deve_ser_depois_do_inicio');
}

function validarMoeda(moeda) {
  if (moeda === undefined) return 'MZN';
  if (typeof moeda !== 'string' || !/^[A-Z]{3}$/.test(moeda))
    throw httpErr(400, 'moeda_invalida');
  return moeda;
}

async function criarEvento(c, { organizadorId, dados }) {
  const nome = textoObrigatorio(dados.nome, 'nome');
  const inicio = dataValida(dados.inicio, 'inicio');
  const fim = dataValida(dados.fim, 'fim');
  validarDatas(inicio, fim);
  const moeda = validarMoeda(dados.moeda);
  const saldoMaximo = dados.saldo_maximo === undefined || dados.saldo_maximo === null
    ? await C.valor(c, organizadorId, 'saldo_maximo_padrao')
    : inteiroPositivo(dados.saldo_maximo, 'saldo_maximo');
  const configEvento = C.validarConfigEvento(dados.config);

  const { rows } = await c.query(
    `INSERT INTO events (organizer_id, nome, local, inicio, fim, moeda, saldo_maximo, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
    [organizadorId, nome, dados.local || null, inicio, fim, moeda, saldoMaximo,
     JSON.stringify(configEvento)]
  );
  const ev = rows[0];
  await registar(c, { actorId: organizadorId, acao: 'evento.criar', alvo: ev.id, metadados: { nome } });
  return ev;
}

async function actualizarEvento(c, { organizadorId, eventoId, dados }) {
  const ev = await eventoDoOrganizador(c, organizadorId, eventoId);
  if (ev.estado === 'encerrado' || ev.estado === 'cancelado')
    throw httpErr(409, 'evento_ja_fechado');

  const nome = dados.nome === undefined ? ev.nome : textoObrigatorio(dados.nome, 'nome');
  const inicio = dados.inicio === undefined ? ev.inicio : dataValida(dados.inicio, 'inicio');
  const fim = dados.fim === undefined ? ev.fim : dataValida(dados.fim, 'fim');
  validarDatas(inicio, fim);
  const moeda = dados.moeda === undefined ? ev.moeda : validarMoeda(dados.moeda);
  const saldoMaximo = dados.saldo_maximo === undefined
    ? ev.saldo_maximo
    : dados.saldo_maximo === null
      ? await C.valor(c, organizadorId, 'saldo_maximo_padrao')
      : inteiroPositivo(dados.saldo_maximo, 'saldo_maximo');
  const configEvento = dados.config === undefined
    ? ev.config
    : { ...ev.config, ...C.validarConfigEvento(dados.config) };

  const { rows } = await c.query(
    `UPDATE events SET nome=$2, local=$3, inicio=$4, fim=$5, moeda=$6,
            saldo_maximo=$7, config=$8::jsonb
      WHERE id=$1 RETURNING *`,
    [eventoId, nome, dados.local === undefined ? ev.local : dados.local, inicio, fim, moeda,
     saldoMaximo, JSON.stringify(configEvento)]
  );
  await registar(c, { actorId: organizadorId, acao: 'evento.actualizar', alvo: eventoId });
  return rows[0];
}

async function mudarEstadoEvento(c, { organizadorId, eventoId, estado }) {
  if (!ESTADOS.includes(estado)) throw httpErr(400, 'estado_invalido');
  const ev = await eventoDoOrganizador(c, organizadorId, eventoId);
  const permitidos = TRANSICOES[ev.estado] || [];
  if (!permitidos.includes(estado))
    throw httpErr(409, 'transicao_de_estado_invalida');

  const { rows } = await c.query(
    'UPDATE events SET estado=$2 WHERE id=$1 RETURNING *',
    [eventoId, estado]
  );
  await registar(c, {
    actorId: organizadorId,
    acao: 'evento.estado',
    alvo: eventoId,
    metadados: { de: ev.estado, para: estado },
  });
  return rows[0];
}

async function criarTipoBilhete(c, { organizadorId, eventoId, dados }) {
  const ev = await eventoDoOrganizador(c, organizadorId, eventoId);
  if (ev.estado === 'encerrado' || ev.estado === 'cancelado')
    throw httpErr(409, 'evento_ja_fechado');

  const nome = textoObrigatorio(dados.nome, 'nome');
  const preco = inteiroNaoNegativo(dados.preco, 'preco');
  const cargaInicial = dados.carga_inicial === undefined
    ? 0
    : inteiroNaoNegativo(dados.carga_inicial, 'carga_inicial');
  const limite = dados.limite_vendas === undefined || dados.limite_vendas === null
    ? null
    : inteiroPositivo(dados.limite_vendas, 'limite_vendas');

  const { rows } = await c.query(
    `INSERT INTO ticket_types (event_id, nome, preco, carga_inicial, limite_vendas)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ev.id, nome, preco, cargaInicial, limite]
  );
  await registar(c, {
    actorId: organizadorId, acao: 'tipo_bilhete.criar', alvo: rows[0].id, metadados: { nome },
  });
  return rows[0];
}

async function listarTiposBilhete(c, { organizadorId, eventoId }) {
  await eventoDoOrganizador(c, organizadorId, eventoId);
  const { rows } = await c.query(
    'SELECT * FROM ticket_types WHERE event_id=$1 ORDER BY nome',
    [eventoId]
  );
  return rows;
}

async function actualizarTipoBilhete(c, { organizadorId, tipoId, dados }) {
  const tt = (await c.query(
    `SELECT tt.* FROM ticket_types tt JOIN events e ON e.id=tt.event_id
      WHERE tt.id=$1 AND e.organizer_id=$2`,
    [tipoId, organizadorId]
  )).rows[0];
  if (!tt) throw httpErr(404, 'tipo_de_bilhete_inexistente');

  const nome = dados.nome === undefined ? tt.nome : textoObrigatorio(dados.nome, 'nome');
  const preco = dados.preco === undefined ? tt.preco : inteiroNaoNegativo(dados.preco, 'preco');
  const cargaInicial = dados.carga_inicial === undefined
    ? tt.carga_inicial
    : inteiroNaoNegativo(dados.carga_inicial, 'carga_inicial');
  const limite = dados.limite_vendas === undefined
    ? tt.limite_vendas
    : dados.limite_vendas === null
      ? null
      : inteiroPositivo(dados.limite_vendas, 'limite_vendas');
  const activo = dados.activo === undefined ? tt.activo : Boolean(dados.activo);

  const { rows } = await c.query(
    `UPDATE ticket_types SET nome=$2, preco=$3, carga_inicial=$4, limite_vendas=$5, activo=$6
      WHERE id=$1 RETURNING *`,
    [tipoId, nome, preco, cargaInicial, limite, activo]
  );
  await registar(c, { actorId: organizadorId, acao: 'tipo_bilhete.actualizar', alvo: tipoId });
  return rows[0];
}

async function criarPontoVenda(c, { organizadorId, eventoId, dados }) {
  await eventoDoOrganizador(c, organizadorId, eventoId);
  const nome = textoObrigatorio(dados.nome, 'nome');
  const { rows } = await c.query(
    'INSERT INTO sales_points (event_id, nome) VALUES ($1,$2) RETURNING *',
    [eventoId, nome]
  );
  await registar(c, {
    actorId: organizadorId, acao: 'ponto_venda.criar', alvo: rows[0].id, metadados: { nome },
  });
  return rows[0];
}

async function listarPontosVenda(c, { organizadorId, eventoId }) {
  await eventoDoOrganizador(c, organizadorId, eventoId);
  const { rows } = await c.query(
    'SELECT * FROM sales_points WHERE event_id=$1 ORDER BY nome',
    [eventoId]
  );
  return rows;
}

async function criarVendedor(c, { organizadorId, eventoId, dados }) {
  await eventoDoOrganizador(c, organizadorId, eventoId);
  const nome = textoObrigatorio(dados.nome, 'nome');
  let pontoId = null;
  if (dados.sales_point_id) {
    const p = (await c.query(
      'SELECT id FROM sales_points WHERE id=$1 AND event_id=$2',
      [dados.sales_point_id, eventoId]
    )).rows[0];
    if (!p) throw httpErr(400, 'ponto_de_venda_invalido');
    pontoId = p.id;
  }
  const { rows } = await c.query(
    'INSERT INTO sellers (event_id, sales_point_id, nome) VALUES ($1,$2,$3) RETURNING *',
    [eventoId, pontoId, nome]
  );
  await registar(c, {
    actorId: organizadorId, acao: 'vendedor.criar', alvo: rows[0].id, metadados: { nome },
  });
  return rows[0];
}

async function listarVendedores(c, { organizadorId, eventoId }) {
  await eventoDoOrganizador(c, organizadorId, eventoId);
  const { rows } = await c.query(
    `SELECT s.*, sp.nome AS ponto_nome
       FROM sellers s LEFT JOIN sales_points sp ON sp.id = s.sales_point_id
      WHERE s.event_id=$1 ORDER BY s.nome`,
    [eventoId]
  );
  return rows;
}

async function actualizarVendedor(c, { organizadorId, vendedorId, dados }) {
  const v = (await c.query(
    `SELECT s.* FROM sellers s JOIN events e ON e.id=s.event_id
      WHERE s.id=$1 AND e.organizer_id=$2`,
    [vendedorId, organizadorId]
  )).rows[0];
  if (!v) throw httpErr(404, 'vendedor_inexistente');

  const nome = dados.nome === undefined ? v.nome : textoObrigatorio(dados.nome, 'nome');
  let pontoId = v.sales_point_id;
  if (dados.sales_point_id !== undefined) {
    if (dados.sales_point_id === null) pontoId = null;
    else {
      const p = (await c.query(
        'SELECT id FROM sales_points WHERE id=$1 AND event_id=$2',
        [dados.sales_point_id, v.event_id]
      )).rows[0];
      if (!p) throw httpErr(400, 'ponto_de_venda_invalido');
      pontoId = p.id;
    }
  }
  const activo = dados.activo === undefined ? v.activo : Boolean(dados.activo);

  const { rows } = await c.query(
    'UPDATE sellers SET nome=$2, sales_point_id=$3, activo=$4 WHERE id=$1 RETURNING *',
    [vendedorId, nome, pontoId, activo]
  );
  await registar(c, { actorId: organizadorId, acao: 'vendedor.actualizar', alvo: vendedorId });
  return rows[0];
}

module.exports = {
  criarEvento,
  actualizarEvento,
  mudarEstadoEvento,
  eventoDoOrganizador,
  criarTipoBilhete,
  listarTiposBilhete,
  actualizarTipoBilhete,
  criarPontoVenda,
  listarPontosVenda,
  criarVendedor,
  listarVendedores,
  actualizarVendedor,
  ESTADOS,
};
