import './style.css';
import { renderNavbar, setupNavbarEvents } from './components/navbar.js';
import { renderLandingView, setupLandingEvents } from './views/landingView.js';
import { renderWalletView, setupWalletEvents } from './views/walletView.js';
import { renderPosView, setupPosEvents } from './views/posView.js';
import { renderGateView, setupGateEvents } from './views/gateView.js';
import { renderOrganizerView, setupOrganizerEvents } from './views/organizerView.js';

class App {
  constructor() {
    this.activeTab = 'landing';
    this.selectedWalletId = null;
    this.appEl = document.getElementById('app');
  }

  async init() {
    this.render();
  }

  async switchTab(tabName, walletId = null) {
    this.activeTab = tabName;
    if (walletId) {
      this.selectedWalletId = walletId;
    }
    await this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async render() {
    // 1. Build Base Skeleton
    this.appEl.innerHTML = `
      ${renderNavbar(this.activeTab, (tab) => this.switchTab(tab))}
      <main class="main-content" id="view-content">
        <div style="text-align:center; padding:60px; color:var(--text-muted);">
          A carregar...
        </div>
      </main>
      <footer class="app-footer">
        <div class="footer-inner">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-weight:700; color:#fff;">AcessoQR Moçambique</span>
            <span>· Sistema Cashless & Ticketing</span>
          </div>
          <div style="display:flex; gap:16px;">
            <span>M-Pesa · e-Mola · mKesh · Cartões</span>
            <span>Segurança Criptográfica Ed25519</span>
          </div>
        </div>
      </footer>
    `;

    // 2. Setup Navbar Events
    setupNavbarEvents((tab) => this.switchTab(tab));

    // 3. Render Current View
    const contentEl = document.getElementById('view-content');

    switch (this.activeTab) {
      case 'landing':
        contentEl.innerHTML = await renderLandingView((walletId) => this.switchTab('wallet', walletId));
        setupLandingEvents((walletId) => this.switchTab('wallet', walletId));
        break;

      case 'wallet':
        contentEl.innerHTML = await renderWalletView(this.selectedWalletId);
        setupWalletEvents(this.selectedWalletId || 'w-maria', (newWalletId) => {
          this.selectedWalletId = newWalletId;
          this.render();
        });
        break;

      case 'pos':
        contentEl.innerHTML = await renderPosView();
        setupPosEvents(() => this.render());
        break;

      case 'gate':
        contentEl.innerHTML = await renderGateView();
        setupGateEvents(() => this.render());
        break;

      case 'organizer':
        contentEl.innerHTML = await renderOrganizerView();
        setupOrganizerEvents(() => this.render());
        break;

      default:
        contentEl.innerHTML = await renderLandingView((walletId) => this.switchTab('wallet', walletId));
        setupLandingEvents((walletId) => this.switchTab('wallet', walletId));
        break;
    }
  }
}

// Bootstrap Application
const app = new App();
app.init();
