const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/config');

test('todos os valores por omissao tem descricao e tipo', () => {
  for (const d of C.definicoes()) {
    assert.ok(d.descricao, `${d.chave} sem descricao`);
    assert.ok(d.tipo, `${d.chave} sem tipo`);
  }
});

test('defaults do ToR 18 estao definidos', () => {
  assert.equal(C.DEFAULTS.offline_venda_max, 200_000);
  assert.equal(C.DEFAULTS.offline_dispositivo_max, 2_000_000);
  assert.equal(C.DEFAULTS.offline_duracao_horas, 4);
  assert.equal(C.DEFAULTS.saldo_maximo_padrao, 5_000_000);
  assert.equal(C.DEFAULTS.retencao_dados_meses, 12);
  assert.equal(C.DEFAULTS.reembolso_prazo_dias, 30);
  assert.equal(C.DEFAULTS.reembolso_parcial, true);
  assert.equal(C.DEFAULTS.saldo_nao_usado, 'reembolso');
  assert.equal(C.DEFAULTS.prestador_pagamentos, 'paysuite');
  assert.equal(C.DEFAULTS.pin_limite, 100_000);
  assert.equal(C.DEFAULTS.otp_canal, 'email');
});

test('valida tipos e limites', () => {
  assert.equal(C.validarValor('offline_venda_max', 1000), 1000);
  assert.throws(() => C.validarValor('offline_venda_max', 0), /offline_venda_max_invalido/);
  assert.throws(() => C.validarValor('offline_venda_max', 'x'), /offline_venda_max_invalido/);
  assert.throws(() => C.validarValor('reembolso_taxa_pct', 101), /reembolso_taxa_pct_invalido/);
  assert.throws(() => C.validarValor('saldo_nao_usado', 'outro'), /saldo_nao_usado_invalido/);
  assert.throws(() => C.validarValor('reembolso_parcial', 'sim'), /reembolso_parcial_invalido/);
  assert.throws(() => C.validarValor('moeda', 'meticais'), /moeda_invalido/);
  assert.deepEqual(
    C.validarValor('modelo_receita', { comissao_recarga_pct: 2, comissao_venda_pct: 1 }),
    { comissao_recarga_pct: 2, comissao_venda_pct: 1, taxa_fixa_organizador: 0 }
  );
});

test('overrides por evento recusam chaves globais', () => {
  assert.deepEqual(C.validarConfigEvento({ offline_venda_max: 50_000 }), { offline_venda_max: 50_000 });
  assert.throws(() => C.validarConfigEvento({ retencao_dados_meses: 6 }), /configuracao_desconhecida/);
  assert.throws(() => C.validarConfigEvento({ moeda: 'USD' }), /configuracao_desconhecida/);
  assert.deepEqual(C.validarConfigEvento(null), {});
});

test('aplicarEvento sobrepoe apenas as chaves do evento', () => {
  const base = { ...C.DEFAULTS };
  const r = C.aplicarEvento(base, { offline_venda_max: 1, saldo_nao_usado: 'organizador' });
  assert.equal(r.offline_venda_max, 1);
  assert.equal(r.saldo_nao_usado, 'organizador');
  assert.equal(r.reembolso_prazo_dias, C.DEFAULTS.reembolso_prazo_dias);
  assert.equal(base.offline_venda_max, C.DEFAULTS.offline_venda_max);
});
