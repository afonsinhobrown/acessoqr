const { Pool } = require('pg');
const { hmac } = require('../src/hash');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const org = (await c.query("SELECT id FROM organizers WHERE email='org@acessoqr.mz'")).rows[0];
    if (!org) {
      console.log('Organizador nao encontrado');
      return;
    }

    const { count } = (await c.query('SELECT count(*) FROM events WHERE organizer_id=$1', [org.id])).rows[0];
    if (parseInt(count, 10) > 0) {
      console.log('Eventos ja existem:', count);
      return;
    }

    await c.query('BEGIN');

    const agora = new Date();
    const fim = new Date(Date.now() + 4 * 24 * 3600 * 1000);
    const evRes = await c.query(
      "INSERT INTO events (organizer_id, nome, local, inicio, fim, moeda, estado, saldo_maximo, config) VALUES ($1, $2, $3, $4, $5, 'MZNE', 'em_curso', 5000000, $6) RETURNING id, nome",
      [
        org.id,
        'Festival Vibras de Moçambique 2026',
        'Campo do Maxaquene, Av. 24 de Julho, Maputo',
        agora,
        fim,
        JSON.stringify({ comissao_padrao_pct: 15, recarga_minima: 5000 })
      ]
    );
    const evId = evRes.rows[0].id;
    console.log('Evento criado:', evId);

    const tt1 = (await c.query(
      "INSERT INTO ticket_types (event_id, nome, preco, carga_inicial, limite_vendas, activo) VALUES ($1, 'Geral - Acesso 1 Dia', 80000, 15000, 500, true) RETURNING id",
      [evId]
    )).rows[0].id;

    const tt2 = (await c.query(
      "INSERT INTO ticket_types (event_id, nome, preco, carga_inicial, limite_vendas, activo) VALUES ($1, 'VIP Frontstage & Lounge', 250000, 50000, 150, true) RETURNING id",
      [evId]
    )).rows[0].id;

    const tt3 = (await c.query(
      "INSERT INTO ticket_types (event_id, nome, preco, carga_inicial, limite_vendas, activo) VALUES ($1, 'Passe 2 Dias Weekend', 140000, 30000, 300, true) RETURNING id",
      [evId]
    )).rows[0].id;
    console.log('3 Tipos de bilhete criados');

    const sp1 = (await c.query(
      "INSERT INTO sales_points (event_id, nome) VALUES ($1, 'Bar Central da Cerveja 2M') RETURNING id", [evId]
    )).rows[0].id;

    const sp2 = (await c.query(
      "INSERT INTO sales_points (event_id, nome) VALUES ($1, 'Hamburgueria & Grelhados do Carlos') RETURNING id", [evId]
    )).rows[0].id;

    const sp3 = (await c.query(
      "INSERT INTO sales_points (event_id, nome) VALUES ($1, 'Barraca de Cocktails da Ana') RETURNING id", [evId]
    )).rows[0].id;
    console.log('3 Pontos de venda criados');

    const s1 = (await c.query(
      "INSERT INTO sellers (event_id, sales_point_id, nome) VALUES ($1, $2, 'Marta Sitoe') RETURNING id", [evId, sp1]
    )).rows[0].id;

    const s2 = (await c.query(
      "INSERT INTO sellers (event_id, sales_point_id, nome) VALUES ($1, $2, 'Carlos Tembe') RETURNING id", [evId, sp2]
    )).rows[0].id;

    const s3 = (await c.query(
      "INSERT INTO sellers (event_id, sales_point_id, nome) VALUES ($1, $2, 'Ana Macuácua') RETURNING id", [evId, sp3]
    )).rows[0].id;
    console.log('y�܄endedores criados');

    await c.query(
      "INSERT INTO devices (event_id, tipo, nome, seller_id, pairing_hash, pairing_expira_em, activo) VALUES  +
      "($1, 'vendedor', 'POS Bar 2M', $2, $5, now() + interval '30 days', true), " +
      "($1, 'vendedor', 'POS Hamburgueria Carlos', $3, $6, now() + interval '30 days', true), " +
      "($1, 'porta', 'Portaria Principal - Leitor 01', NULL, $7, now() + interval '30 days', true)",
      [
        evId, s1, s2,
        hmac("pareamento", "DEVMO1"),
        hmac("pareamento", "DEVHAM"),
        hmac("pareamento", "GATE01")
      ]
    );
    console.log('Dispositivos criados');

    const wRes = await c.query(
      "INSERT INTO wallets (event_id, saldo, estado) VALUES ($1, 250000, 'ativa') RETURNING id",
      [evId]
    );
    const walId = wRes.rows[0].id;

    await c.query(
      "INSERT INTO wallet_contacts (wallet_id, tipo, valor_normalizado, verificado_em) VALUES ($1, 'email', 'maria.mabote@gmail.com', now())",
      [walId]
    );

    await c.query(
      "INSERT INTO tickets (event_id, ticket_type_id, wallet_id) VALUES ($1, $2, $3)",
      [evId, tt2, walId]
    );

    await c.query(
      "INSERT INTO transactions (wallet_id, tipo, valor, origem, criado_em) VALUES " +
      "($1, 'carga_inicial', 50000, 'online', now() - interval '2 hours'), " +
      "($1, 'recarga', 200000, 'online', now() - interval '1 hour')",
      [walId]
    );

    const accRes = await c.query(
      "INSERT INTO accounts (email) VALUES ('maria.mabote@gmail.com') ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
    );
    await c.query(
      "INSERT INTO account_wallets (account_id, wallet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [accRes.rows[0].id, walId]
    );

    await c.query('COMMIT');
    console.log('SEED_SUCESSO:', evId, walId);
  } catch (e) {
    await c.query('ROLLBACK');
    console.log('SEED_ERRO:', e.message);
  } finally {
    c.release();
    await pool.end();
  }
})();
