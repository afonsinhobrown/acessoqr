// Envio de email. Sem provider configurado, em desenvolvimento imprime no
// stdout. Em produção recusa-se a fingir que enviou.
async function enviar({ para, assunto, texto }) {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (url) {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN || ''}`,
      },
      body: JSON.stringify({ para, assunto, texto }),
    });
    if (!r.ok) throw new Error(`email_falhou_${r.status}`);
    return { enviado: true };
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('email_nao_configurado');
  console.log(`[email dev] para=${para}\nassunto=${assunto}\n${texto}`);
  return { enviado: false, dev: true };
}

module.exports = { enviar };
