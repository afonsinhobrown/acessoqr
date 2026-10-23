import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import { api } from '../services/api.js';
import { formatMT } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';
import { playCoinSound } from '../utils/audio.js';

let selectedWalletIndex = 0;
let qrInterval = null;

export async function renderWalletView() {
  if (!api.isBuyerLoggedIn()) {
    return renderBuyerLogin();
  }

  let profile = null;
  try {
    profile = await api.getBuyerProfile();
  } catch (err) {
    api.buyerLogout();
    return renderBuyerLogin();
  }

  const { conta, carteiras = [] } = profile;

  if (carteiras.length === 0) {
    return `
      <div class="card" style="max-width:540px; margin:40px auto; padding:36px; text-align:center;">
        <div style="font-size:2.5rem; margin-bottom:12px;">🎟️</div>
        <h3>Olá, ${conta.email}</h3>
        <p style="color:var(--text-secondary); margin-top:8px;">
          A sua conta não tem nenhuma carteira associada ainda.
        </p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">
          Compre um bilhete na aba <strong>"Bilhetes"</strong> usando este mesmo email para que a sua carteira apareça aqui automaticamente.
        </p>
        <button class="btn btn-secondary btn-sm" id="btn-buyer-logout" style="margin-top:20px;">Terminar Sessão</button>
      </div>
    `;
  }

  const activeWallet = carteiras[selectedWalletIndex] || carteiras[0];

  return `
    <div class="wallet-page" style="max-width:880px; margin:0 auto; padding-bottom:50px;">
      
      <!-- TOP USER BAR -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:16px 22px; margin-bottom:24px; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:40px; height:40px; border-radius:50%; background:var(--accent-neon-dim); color:var(--accent-neon); display:flex; align-items:center; justify-content:center; font-weight:700;">
            👤
          </div>
          <div>
            <div style="font-weight:700;">${conta.email}</div>
            <div style="font-size:0.78rem; color:var(--text-muted);">Sessão Autenticada no PostgreSQL</div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
          ${carteiras.length > 1 ? `
            <select class="form-select" id="wallet-picker" style="width:auto; font-size:0.85rem;">
              ${carteiras.map((w, idx) => `
                <option value="${idx}" ${idx === selectedWalletIndex ? 'selected' : ''}>
                  Carteira #${w.id.slice(0, 8)} (${w.event_nome || 'Evento'})
                </option>
              `).join('')}
            </select>
          ` : ''}
          <button class="btn btn-secondary btn-sm" id="btn-buyer-logout">Sair</button>
        </div>
      </div>

      <!-- MAIN 2-COL: VIRTUAL CARD + ROTATING QR (Ed25519) -->
      <div style="display:grid; grid-template-columns: 1fr 340px; gap:24px;">
        
        <!-- Virtual Card & Balance -->
        <div>
          <div class="virtual-card">
            <div class="virtual-card-top">
              <div class="virtual-chip"></div>
              <span class="virtual-badge">
                <span class="dot-live"></span>
                CARTEIRA ATIVA
              </span>
            </div>

            <div class="virtual-balance-label">Saldo em Carteira (PostgreSQL)</div>
            <div class="virtual-balance-amount">
              <span id="real-balance-text">${formatMT(activeWallet.saldo)}</span>
            </div>

            <div class="virtual-card-bottom">
              <div>
                <div style="font-size:0.75rem; color:var(--text-muted);">CARTEIRA ID</div>
                <div style="font-family:var(--font-mono); font-size:0.82rem; color:#fff;">${activeWallet.id}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:0.75rem; color:var(--text-muted);">ESTADO</div>
                <div style="font-weight:700; color:var(--accent-neon);">${activeWallet.estado.toUpperCase()}</div>
              </div>
            </div>
          </div>

          <!-- Real Recharge Bar -->
          <div class="card" style="margin-top:20px; padding:20px;">
            <div style="font-size:1.05rem; font-weight:700; margin-bottom:12px;">Recarregar Saldo Real</div>
            
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:14px;">
              <button class="btn btn-secondary btn-real-recharge" data-val="100">+100 MT</button>
              <button class="btn btn-secondary btn-real-recharge" data-val="250">+250 MT</button>
              <button class="btn btn-secondary btn-real-recharge" data-val="500">+500 MT</button>
              <button class="btn btn-secondary btn-real-recharge" data-val="1000">+1.000 MT</button>
            </div>

            <div style="display:flex; gap:10px;">
              <input type="number" id="custom-recharge-val" class="form-input" placeholder="Valor livre em Meticais" min="10" />
              <button class="btn btn-neon" id="btn-submit-custom-recharge" style="flex-shrink:0;">Recarregar</button>
            </div>
          </div>
        </div>

        <!-- Real Rotating QR (Ed25519 from Backend) -->
        <div>
          <div class="card" style="padding:22px; text-align:center;">
            <div style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:12px;">
              QR Code Criptográfico (Ed25519)
            </div>

            <div class="qr-box" style="margin:0 auto; width:220px; height:220px; background:#fff; padding:12px; border-radius:var(--radius-lg); position:relative;">
              <canvas id="real-qr-canvas" style="width:100%; height:100%;"></canvas>
              <div class="qr-scan-line"></div>
            </div>

            <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--accent-cyan); margin-top:10px;" id="qr-token-preview">
              A obter token assinado do backend...
            </div>

            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:14px;">
              Renova automaticamente a cada 30 segundos. Apresente este código nos bares e portarias.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBuyerLogin() {
  return `
    <div style="max-width:440px; margin:50px auto; padding:0 20px;">
      <div class="card" style="padding:32px;">
        <div style="text-align:center; margin-bottom:24px;">
          <div style="width:52px; height:52px; border-radius:14px; background:var(--accent-neon-dim); color:var(--accent-neon); display:flex; align-items:center; justify-content:center; margin:0 auto 12px auto; font-size:1.5rem; font-weight:800;">
            💳
          </div>
          <h2 style="font-size:1.5rem;">Aceder à Minha Carteira</h2>
          <p style="color:var(--text-secondary); font-size:0.88rem; margin-top:4px;">
            Autenticação sem palavra-passe. Receba um código de 6 dígitos no seu email.
          </p>
        </div>

        <form id="buyer-login-form">
          <div class="form-group">
            <label class="form-label">Email do Comprador</label>
            <input type="email" class="form-input" id="buyer-login-email" required placeholder="comprador@exemplo.mz" />
          </div>

          <div id="buyer-otp-field" style="display:none; margin-top:14px; padding:16px; background:var(--bg-tertiary); border:1px solid var(--accent-neon); border-radius:var(--radius-md);">
            <label class="form-label" style="color:var(--accent-neon);">Código OTP de 6 Dígitos</label>
            <input type="text" class="form-input" id="buyer-login-code" placeholder="000000" maxlength="6" />
            <div id="otp-hint-dev" style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;"></div>
          </div>

          <button type="submit" class="btn btn-neon btn-full btn-lg" id="btn-buyer-login-submit" style="margin-top:18px;">
            <span>Pedir Código OTP</span>
          </button>
        </form>
      </div>
    </div>
  `;
}

export function setupWalletEvents(onReload) {
  // Login flow
  const form = document.getElementById('buyer-login-form');
  if (form) {
    let awaitingOtp = false;
    let emailSaved = '';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('buyer-login-email').value.trim();
      const codeInput = document.getElementById('buyer-login-code');
      const submitBtn = document.getElementById('btn-buyer-login-submit');

      try {
        if (!awaitingOtp) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'A gerar desafio OTP no PostgreSQL...';
          const r = await api.sendBuyerOtp(email);
          awaitingOtp = true;
          emailSaved = email;
          document.getElementById('buyer-otp-field').style.display = 'block';
          if (r.dev_codigo) {
            document.getElementById('otp-hint-dev').innerHTML = `Código gerado no backend: <strong style="color:var(--accent-neon);">${r.dev_codigo}</strong>`;
            codeInput.value = r.dev_codigo;
          }
          submitBtn.disabled = false;
          submitBtn.textContent = 'Verificar Código & Entrar';
          showToast('Código OTP gerado!', 'info');
        } else {
          submitBtn.disabled = true;
          submitBtn.textContent = 'A validar sessão no backend...';
          await api.verifyBuyerOtp(emailSaved, codeInput.value.trim());
          showToast('Sessão iniciada com sucesso!', 'success');
          onReload();
        }
      } catch (err) {
        showToast(err.message || 'Erro ao processar OTP', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = awaitingOtp ? 'Verificar Código & Entrar' : 'Pedir Código OTP';
      }
    });
    return;
  }

  // Logout
  const logoutBtn = document.getElementById('btn-buyer-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (qrInterval) clearInterval(qrInterval);
      api.buyerLogout();
      showToast('Sessão terminada.', 'info');
      onReload();
    });
  }

  // Wallet Picker
  const picker = document.getElementById('wallet-picker');
  if (picker) {
    picker.addEventListener('change', (e) => {
      selectedWalletIndex = Number(e.target.value);
      onReload();
    });
  }

  // Real Rotating QR Loop
  loadRealQR(onReload);

  // Recharge buttons
  const rechargeBtns = document.querySelectorAll('.btn-real-recharge');
  rechargeBtns.forEach(b => {
    b.addEventListener('click', async () => {
      const val = Number(b.dataset.val);
      await executeRealRecharge(val, onReload);
    });
  });

  const customBtn = document.getElementById('btn-submit-custom-recharge');
  const customInput = document.getElementById('custom-recharge-val');
  if (customBtn && customInput) {
    customBtn.addEventListener('click', async () => {
      const val = Number(customInput.value);
      if (isNaN(val) || val <= 0) {
        showToast('Insira um valor válido', 'error');
        return;
      }
      await executeRealRecharge(val, onReload);
    });
  }
}

async function loadRealQR() {
  if (qrInterval) clearInterval(qrInterval);

  const fetchAndDraw = async () => {
    try {
      const profile = await api.getBuyerProfile();
      const wallet = profile.carteiras[selectedWalletIndex] || profile.carteiras[0];
      if (!wallet) return;

      const qrData = await api.getWalletQR(wallet.id);
      const canvas = document.getElementById('real-qr-canvas');
      const preview = document.getElementById('qr-token-preview');

      if (canvas && qrData.token) {
        await QRCode.toCanvas(canvas, qrData.token, { width: 196, margin: 1 });
      }
      if (preview && qrData.token) {
        preview.textContent = `Token Ed25519: ${qrData.token.slice(0, 16)}... (TTL ${qrData.ttl}s)`;
      }
    } catch (err) {
      console.warn('Erro ao atualizar QR:', err);
    }
  };

  await fetchAndDraw();
  qrInterval = setInterval(fetchAndDraw, 25000); // refresh every 25s
}

async function executeRealRecharge(amount, onReload) {
  try {
    const profile = await api.getBuyerProfile();
    const wallet = profile.carteiras[selectedWalletIndex] || profile.carteiras[0];
    showToast(`A processar recarga de ${formatMT(amount)} no PostgreSQL...`, 'info');
    await api.rechargeWallet(wallet.id, amount, 'mpesa');
    playCoinSound();
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    showToast(`Recarga confirmada! +${formatMT(amount)} creditados.`, 'success');
    onReload();
  } catch (err) {
    showToast(err.message || 'Erro na recarga', 'error');
  }
}
