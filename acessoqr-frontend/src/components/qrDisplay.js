import QRCode from 'qrcode';
import { api } from '../services/api.js';

export class QRDisplayComponent {
  constructor(containerId, walletId) {
    this.containerId = containerId;
    this.walletId = walletId;
    this.intervalId = null;
    this.currentSeconds = 30;
    this.totalSeconds = 30;
    this.currentToken = '';
  }

  mount() {
    this.refreshQR();
    this.startTimer();
  }

  unmount() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async refreshQR() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    try {
      const qrData = api.generateRotatingQR(this.walletId);
      this.currentToken = qrData.token;
      this.currentSeconds = this.totalSeconds;

      // Render outer markup if not yet present
      if (!container.querySelector('.qr-box')) {
        container.innerHTML = `
          <div class="qr-container">
            <div style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">
              QR Dinâmico de Pagamento & Entrada
            </div>
            
            <div class="qr-box" id="${this.containerId}-box" title="Clique para atualizar o código">
              <canvas id="${this.containerId}-canvas"></canvas>
              <div class="qr-scan-line"></div>
            </div>

            <!-- Anti-screenshot live timestamp -->
            <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted); margin-top:8px;" id="${this.containerId}-clock">
              --:--:--
            </div>

            <div class="qr-timer-wrapper">
              <svg class="qr-progress-ring" viewBox="0 0 36 36">
                <path class="qr-progress-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path class="qr-progress-ring-fill" id="${this.containerId}-ring" stroke-dasharray="100, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <div style="text-align:left;">
                <div style="font-size:0.85rem; font-weight:700; color:var(--text-primary);">
                  Roda em <span id="${this.containerId}-sec" style="color:var(--accent-neon);">30</span>s
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted);">Assinado Ed25519</div>
              </div>
            </div>

            <div class="qr-hash-badge" id="${this.containerId}-hash">
              Token: ${this.currentToken.slice(0, 14)}...
            </div>

            <div style="margin-top:14px; font-size:0.82rem; color:var(--text-secondary); max-width:260px;">
              Apresente este código nos bares e portões para débito ou entrada instantânea.
            </div>
          </div>
        `;

        const box = document.getElementById(`${this.containerId}-box`);
        if (box) {
          box.style.cursor = 'pointer';
          box.addEventListener('click', () => this.refreshQR());
        }
      }

      // Draw canvas
      const canvas = document.getElementById(`${this.containerId}-canvas`);
      if (canvas) {
        await QRCode.toCanvas(canvas, this.currentToken, {
          width: 208,
          margin: 1,
          color: {
            dark: '#070A11',
            light: '#FFFFFF'
          }
        });
      }

      const hashEl = document.getElementById(`${this.containerId}-hash`);
      if (hashEl) {
        hashEl.textContent = `Token: ${this.currentToken.slice(0, 14)}...`;
      }
    } catch (err) {
      console.error('Error generating QR', err);
    }
  }

  startTimer() {
    this.intervalId = setInterval(() => {
      this.currentSeconds--;

      const secEl = document.getElementById(`${this.containerId}-sec`);
      if (secEl) {
        secEl.textContent = this.currentSeconds;
      }

      const clockEl = document.getElementById(`${this.containerId}-clock`);
      if (clockEl) {
        const d = new Date();
        clockEl.textContent = `● VÁLIDO • ${d.toLocaleTimeString()} .${Math.floor(d.getMilliseconds() / 100)}`;
      }

      const ringEl = document.getElementById(`${this.containerId}-ring`);
      if (ringEl) {
        const percent = (this.currentSeconds / this.totalSeconds) * 100;
        ringEl.setAttribute('stroke-dasharray', `${percent}, 100`);
      }

      if (this.currentSeconds <= 0) {
        this.refreshQR();
      }
    }, 1000);
  }
}
