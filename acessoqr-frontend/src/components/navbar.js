export function renderNavbar(activeTab = 'landing', onTabChange) {
  return `
    <header class="app-header">
      <div class="header-inner">
        <!-- Logo -->
        <div class="brand" id="brand-logo" style="cursor:pointer;">
          <div class="brand-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
              <path d="M14 14h3v3h-3z"></path>
              <path d="M17 17h4v4h-4z"></path>
              <path d="M14 20h3"></path>
              <path d="M20 14v3"></path>
            </svg>
          </div>
          <div class="brand-text">
            <span class="brand-name">acesso<span class="text-gradient">qr</span></span>
            <span class="brand-tag">SISTEMA REAL · NEON POSTGRESQL</span>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <nav class="nav-links" id="main-nav">
          <button class="nav-item ${activeTab === 'landing' ? 'active' : ''}" data-tab="landing">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path><path d="M13 5v2"></path><path d="M13 17v2"></path><path d="M13 11v2"></path></svg>
            <span>Bilhetes (Vitrine)</span>
          </button>
          
          <button class="nav-item ${activeTab === 'wallet' ? 'active' : ''}" data-tab="wallet">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line></svg>
            <span>Minha Carteira</span>
          </button>

          <button class="nav-item ${activeTab === 'pos' ? 'active' : ''}" data-tab="pos">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path></svg>
            <span>Terminal POS (Vendedor)</span>
          </button>

          <button class="nav-item ${activeTab === 'gate' ? 'active' : ''}" data-tab="gate">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"></path><path d="m9 12 2 2 4-4"></path></svg>
            <span>Portaria (Acesso)</span>
          </button>

          <button class="nav-item ${activeTab === 'organizer' ? 'active' : ''}" data-tab="organizer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>
            <span>Painel do Organizador</span>
          </button>
        </nav>

        <!-- Right System Indicators -->
        <div class="header-actions">
          <div class="status-pill" title="API e Base de Dados Conectadas">
            <span class="dot-live"></span>
            <span class="status-text">API :3000 Online</span>
          </div>
        </div>
      </div>
    </header>
  `;
}

export function setupNavbarEvents(onTabChange) {
  const nav = document.getElementById('main-nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (btn && btn.dataset.tab) {
        onTabChange(btn.dataset.tab);
      }
    });
  }

  const logo = document.getElementById('brand-logo');
  if (logo) {
    logo.addEventListener('click', () => onTabChange('landing'));
  }
}
