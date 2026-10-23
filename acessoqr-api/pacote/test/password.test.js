const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/password');

test('scrypt guarda hash com sal e verifica a palavra-passe', async () => {
  const h = await P.hash('senha-forte-123');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(h, 'senha-forte-123');
  assert.equal(await P.verificar('senha-forte-123', h), true);
  assert.equal(await P.verificar('errada', h), false);
});

test('hashes da mesma palavra-passe sao diferentes', async () => {
  const a = await P.hash('senha-forte-123');
  const b = await P.hash('senha-forte-123');
  assert.notEqual(a, b);
  assert.equal(await P.verificar('senha-forte-123', b), true);
});

test('formato invalido nao autentica', async () => {
  assert.equal(await P.verificar('x', 'nada'), false);
  assert.equal(await P.verificar('x', 'scrypt$zz$zz'), false);
});
