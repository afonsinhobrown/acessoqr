import { api } from '../services/api.js';
import { formatMT } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';
import { playBeepSuccess, playBeepError } from '../utils/audio.js';

export async function renderPosView() {
  if (!api.isDevicePaired()) {
    return renderPairingScreen('vendedor');
  }

  const devInfo = api.deviceInfo || {};

  return `
    <div class="pos-page" style="max-width:960px; margin:0 auto; padding-bottom:50px;">
      <!-- TOP POS DEVICE BAR -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:16px 22px; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:40px; height:40px; border-radius:var(--radius-md); background:var(--accent-neon-dim); color:var(--accent-neon); display:flex; align-items:center; justify-content:center; font-size:1.3rem;">
            🛒
          </div>
          <div>
            <div style="font-weight:700; font-size:1.1rem;">${devInfo.nome || 'Terminal POS'}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">
              Função: <strong style="color:var(--accent-neon);">VENDEDOR</strong> · Dispositivo Autenticado no PostgreSQL
            </div>
          </div>
        </div>

        <div>
          <button class="btn btn-secondary btn-sm" id="btn-unpair-pos" title="Desemparelhar este dispositivo">
            Desemparelhar
          </button>
        </div>
      </div>

      <!-- MAIN POS INTERFACE -->
      <div class="card" style="padding:28px; max-width:600px; margin:0 auto;">
        <h3 style="font-size:1.3rem; margin-bottom:16px;">Efetuar Cobrança de Venda</h3>
        
        <form id="pos-sale-form">
          <div class="form-group">
            <label class="form-label">Valor do Consumo (MT)</label>
            <input type="number" class="form-input" id="pos-sale-amount" required placeholder="Ex: 250" min="1" style="font-size:1.5rem; font-family:var(--font-mono); font-weight:700; color:var(--accent-neon);" />
          </div>

          <div class="form-group">
            <label class="form-label">Token do QR Code do Comprador</label>
            <textarea class="form-textarea" id="pos-qr-token" required rows="3" placeholder="Aponte a câmara ou cole o token Ed25519 do comprador aqui..." style="font-family:var(--font-mono); font-size:0.8rem;"></textarea>
          </div>

          <button type="submit" class="btn btn-neon btn-full btn-lg" id="btn-submit-pos-sale" style="margin-top:16px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Validar Assinatura Ed25519 & Debitar</span>
          </button>
        </form>

        <div id="pos-last-result" style="display:none; margin-top:20px; padding:16px; border-radius:var(--radius-md);"></div>
      </div>
    </div>
  `;
}

function renderPairingScreen(tipoEsperado) {
  return `
    <div style="max-width:440px; margin:50px auto; padding:0 20px;">
      <div class="card" style="padding:32px; text-align:center;">
        <div style="width:52px; height:52px; border-radius:14px; background:var(--accent-neon-dim); color:var(--accent-neon); display:flex; align-items:center; justify-content:center; margin:0 auto 12px auto; font-size:1.5rem;">
          📱
        </div>
        <h2 style="font-size:1.4rem;">Emparelhar Terminal POS</h2>
        <p style="color:var(--text-secondary); font-size:0.88rem; margin-top:6px;">
          Insira o código de 6 caracteres criado no painel do organizador para autorizar este telemóvel.
        </p>

        <form id="pairing-form" style="margin-top:20px; text-align:left;">
          <div class="form-group">
            <label class="form-label">Código de Pareamento (15 min)</label>
            <input type="text" class="form-input" id="pairing-code-input" required placeholder="Ex: A9B2C4" maxlength="12" style="font-family:var(--font-mono); font-size:1.4rem; font-weight:800; text-align:center; text-transform:uppercase; letter-spacing:0.1em;" />
          </div>

          <button type="submit" class="btn btn-neon btn-full btn-lg" id="btn-pair-submit">
            Autorizar Dispositivo
          </button>
        </form>
      </div>
    </div>
  `;
}

export function setupPosEvents(onReload) {
  const pairForm = document.getElementById('pairing-form');
  if (pairForm) {
    pairForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('pairing-code-input').value.trim();
      const submitBtn = document.getElementById('btn-pair-submit');

      submitBtn.disabled = true;
      submitBtn.textContent = 'A trocar chaves com a API...';

      try {
        await api.pairDevice(code);
        showToast('Dispositivo emparelhado com sucesso na API!', 'success');
        onReload();
      } catch (err) {
        showToast(err.message || 'Código inválido ou expirado', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Tentar Novamente';
      }
    });
    return;
  }

  // Unpair
  const unpairBtn = document.getElementById('btn-unpair-pos');
  if (unpairBtn) {
    unpairBtn.addEventListener('click', () => {
      if (confirm('Deseja desemparelhar este terminal?')) {
        api.unpairDevice();
        showToast('Dispositivo desemparelhado.', 'info');
        onReload();
      }
    });
  }

  // Submit Sale
  const saleForm = document.getElementById('pos-sale-form');
  if (saleForm) {
    saleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const valor = document.getElementById('pos-sale-amount').value;
      const qrToken = document.getElementById('pos-qr-token').value.trim();
      const resultBox = document.getElementById('pos-last-result');
      const submitBtn = document.getElementById('btn-submit-pos-sale');

      submitBtn.disabled = true;
      submitBtn.textContent = 'A validar assinatura no PostgreSQL...';

      try {
        const res = await api.processPosSale(qrToken, valor);
        playBeepSuccess();
        showToast('Venda aprovada com sucesso!', 'success');

        resultBox.style.display = 'block';
        resultBox.style.background = 'rgba(5, 242, 146, 0.1)';
        resultBox.style.border = '1px solid var(--accent-neon)';
        resultBox.innerHTML = `
          <div style="font-weight:700; color:var(--accent-neon); font-size:1.1rem;">✓ Débito Concluído</div>
          <div style="font-size:0.85rem; color:#fff; margin-top:4px;">
            Valor: <strong>${formatMT(valor)}</strong> · ID Transação: <code style="color:var(--accent-neon);">${res.id || res.transacao_id || 'OK'}</code>
          </div>
          <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:4px;">
            Saldo restante na carteira do cliente: <strong>${formatMT(res.saldo || res.novo_saldo || 0)}</strong>
          </div>
        `;

        document.getElementById('pos-sale-amount').value = '';
        document.getElementById('pos-qr-token').value = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Validar Assinatura Ed25519 & Debitar';
      } catch (err) {
        playBeepError();
        showToast(err.message || 'Venda recusada pelo servidor', 'error');

        resultBox.style.display = 'block';
        resultBox.style.background = 'rgba(244, 63, 94, 0.1)';
        resultBox.style.border = '1px solid var(--accent-rose)';
        resultBox.innerHTML = `
          <div style="font-weight:700; color:var(--accent-rose);">✕ Venda Recusada</div>
          <div style="font-size:0.85rem; color:#FDA4AF; margin-top:4px;">${err.message}</div>
        `;

        submitBtn.disabled = false;
        submitBtn.textContent = 'Validar Assinatura Ed25519 & Debitar';
      }
    });
  }
}
