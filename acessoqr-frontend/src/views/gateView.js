import { api } from '../services/api.js';
import { showToast } from '../utils/toast.js';
import { playBeepSuccess, playBeepError } from '../utils/audio.js';

export async function renderGateView() {
  if (!api.isDevicePaired()) {
    return renderGatePairingScreen();
  }

  const devInfo = api.deviceInfo || {};

  return `
    <div class="gate-page" style="max-width:820px; margin:0 auto; padding-bottom:50px;">
      <!-- TOP STATUS BAR -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:16px 22px; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:40px; height:40px; border-radius:var(--radius-md); background:var(--accent-cyan-dim); color:var(--accent-cyan); display:flex; align-items:center; justify-content:center; font-size:1.3rem;">
            🚪
          </div>
          <div>
            <div style="font-weight:700; font-size:1.1rem;">${devInfo.nome || 'Scanner Portaria'}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">
              Função: <strong style="color:var(--accent-cyan);">PORTA / CHECK-IN</strong> · Ligado ao PostgreSQL
            </div>
          </div>
        </div>

        <div>
          <button class="btn btn-secondary btn-sm" id="btn-unpair-gate">
            Desemparelhar
          </button>
        </div>
      </div>

      <!-- SCANNER INPUT & ADMISSION FORM -->
      <div class="card" style="padding:28px; text-align:center;">
        <div class="scanner-viewport" id="scanner-box" style="margin:0 auto 20px auto;">
          <div class="scanner-overlay">
            <div class="scanner-crosshair">
              <div class="scanner-laser"></div>
            </div>
          </div>
        </div>

        <form id="gate-scan-form" style="max-width:480px; margin:0 auto; text-align:left;">
          <div class="form-group">
            <label class="form-label">Token QR do Participante (Ed25519)</label>
            <textarea class="form-textarea" id="gate-qr-input" required rows="3" placeholder="Cole aqui o token do QR Code para validar entrada..." style="font-family:var(--font-mono); font-size:0.82rem;"></textarea>
          </div>

          <button type="submit" class="btn btn-neon btn-full btn-lg" id="btn-submit-gate-entry">
            Validar Entrada no PostgreSQL
          </button>
        </form>
      </div>

      <!-- FLASH OVERLAY CONTAINER -->
      <div id="gate-admission-flash"></div>
    </div>
  `;
}

function renderGatePairingScreen() {
  return `
    <div style="max-width:440px; margin:50px auto; padding:0 20px;">
      <div class="card" style="padding:32px; text-align:center;">
        <div style="width:52px; height:52px; border-radius:14px; background:var(--accent-cyan-dim); color:var(--accent-cyan); display:flex; align-items:center; justify-content:center; margin:0 auto 12px auto; font-size:1.5rem;">
          🚪
        </div>
        <h2 style="font-size:1.4rem;">Emparelhar Leitor de Portaria</h2>
        <p style="color:var(--text-secondary); font-size:0.88rem; margin-top:6px;">
          Insira o código de pareamento gerado pelo organizador para este leitor de acesso.
        </p>

        <form id="gate-pairing-form" style="margin-top:20px; text-align:left;">
          <div class="form-group">
            <label class="form-label">Código de Pareamento</label>
            <input type="text" class="form-input" id="gate-code-input" required placeholder="Ex: G1E8T2" maxlength="12" style="font-family:var(--font-mono); font-size:1.4rem; font-weight:800; text-align:center; text-transform:uppercase;" />
          </div>

          <button type="submit" class="btn btn-neon btn-full btn-lg" id="btn-gate-pair-submit">
            Autorizar Leitor de Porta
          </button>
        </form>
      </div>
    </div>
  `;
}

export function setupGateEvents(onReload) {
  const pairForm = document.getElementById('gate-pairing-form');
  if (pairForm) {
    pairForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('gate-code-input').value.trim();
      const submitBtn = document.getElementById('btn-gate-pair-submit');

      submitBtn.disabled = true;
      submitBtn.textContent = 'A emparelhar leitor...';

      try {
        await api.pairDevice(code);
        showToast('Leitor de porta emparelhado com sucesso!', 'success');
        onReload();
      } catch (err) {
        showToast(err.message || 'Código inválido ou expirado', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Tentar Novamente';
      }
    });
    return;
  }

  const unpairBtn = document.getElementById('btn-unpair-gate');
  if (unpairBtn) {
    unpairBtn.addEventListener('click', () => {
      if (confirm('Deseja desemparelhar este leitor de portaria?')) {
        api.unpairDevice();
        showToast('Leitor desemparelhado.', 'info');
        onReload();
      }
    });
  }

  const scanForm = document.getElementById('gate-scan-form');
  const flashContainer = document.getElementById('gate-admission-flash');

  if (scanForm && flashContainer) {
    scanForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('gate-qr-input').value.trim();
      const submitBtn = document.getElementById('btn-submit-gate-entry');

      submitBtn.disabled = true;
      submitBtn.textContent = 'A verificar no banco...';

      try {
        const res = await api.processGateAdmission(token);
        playBeepSuccess();

        flashContainer.innerHTML = `
          <div class="admission-banner admission-admitted">
            <div style="font-size:4rem; margin-bottom:12px;">✓</div>
            <div style="font-size:1.8rem; font-weight:800; text-transform:uppercase;">ENTRADA ADMITIDA</div>
            <div style="font-size:1rem; margin-top:8px; opacity:0.9;">Primeira entrada autorizada no PostgreSQL.</div>
          </div>
        `;

        document.getElementById('gate-qr-input').value = '';
        setTimeout(() => {
          flashContainer.innerHTML = '';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Validar Entrada no PostgreSQL';
        }, 2200);

      } catch (err) {
        playBeepError();

        flashContainer.innerHTML = `
          <div class="admission-banner admission-rejected">
            <div style="font-size:4rem; margin-bottom:12px;">✕</div>
            <div style="font-size:1.8rem; font-weight:800; text-transform:uppercase;">ENTRADA RECUSADA</div>
            <div style="font-size:1.1rem; font-weight:600; margin-top:8px;">${err.message}</div>
          </div>
        `;

        setTimeout(() => {
          flashContainer.innerHTML = '';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Validar Entrada no PostgreSQL';
        }, 2500);
      }
    });
  }
}
