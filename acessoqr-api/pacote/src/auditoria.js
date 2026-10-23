// Registo de auditoria de acções administrativas.
async function registar(c, { actorTipo = 'organizador', actorId, acao, alvo = null, metadados = null }) {
  await c.query(
    `INSERT INTO audit_log (actor_tipo, actor_id, acao, alvo, metadados)
     VALUES ($1,$2,$3,$4,$5)`,
    [actorTipo, actorId, acao, alvo === null ? null : String(alvo),
     metadados === null ? null : JSON.stringify(metadados)]
  );
}

module.exports = { registar };
