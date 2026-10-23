import QRCode from 'qrcode';
import { api } from '../services/api.js';
import { formatMT, formatDateTime } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';

let activeOrganizerTab = 'events'; // events | tickets | points | devices | reports | refunds
let selectedEventId = null;

export async function renderOrganizerView() {
  // If not logged in, render real Login + 2FA Screen
  if (!api.isOrganizerLoggedIn()) {
    return renderLoginScreen();
  }

  // Fetch real organizer profile & events from PostgreSQL
  let profile = null;
  try {
    profile = await api.getOrganizerProfile();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      api.organizerLogout();
      return renderLoginScreen();
    }
    return `
      <div class="card" style="max-width:600px; margin:40px auto; padding:30px; text-align:center;">
        <h3 style="color:var(--accent-rose);">Erro de Ligação à API</h3>
        <p style="color:var(--text-secondary); margin-top:8px;">${err.message}</p>
        <button class="btn btn-primary btn-sm" id="btn-org-retry" style="margin-top:16px;">Tentar Novamente</button>
      </div>
    `;
  }

  const { organizador, eventos = [] } = profile;
  if (!selectedEventId && eventos.length > 0) {
    selectedEventId = eventos[0].id;
  }
  const currentEvent = eventos.find(e => e.id === selectedEventId) || eventos[0];

  return `
    <div class="organizer-page" style="max-width:1180px; margin:0 auto; padding-bottom:60px;">
      
      <!-- TOP ORGANIZER BAR -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px 24px; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; align-items:center; gap:14px;">
          <div style="width:44px; height:44px; border-radius:var(--radius-md); background:var(--accent-neon-dim); color:var(--accent-neon); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:1.2rem;">
            ORG
          </div>
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h2 style="font-size:1.2rem;">${organizador.nome}</h2>
              <span class="badge badge-neon">CONTA VERIFICADA</span>
            </div>
            <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:2px;">
              ${organizador.email} · Sessão Segura 2FA
            </div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:12px;">
          <button class="btn btn-neon btn-sm" id="btn-modal-create-event">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Novo Evento</span>
          </button>
          
          <button class="btn btn-secondary btn-sm" id="btn-org-logout" title="Terminar Sessão">
            <span>Sair</span>
          </button>
        </div>
      </div>

      <!-- EVENT SELECTOR & LIFECYCLE BAR -->
      ${eventos.length === 0 ? `
        <div class="card" style="padding:40px; text-align:center; margin-bottom:24px;">
          <div style="font-size:2.5rem; margin-bottom:12px;">🎪</div>
          <h3 style="font-size:1.3rem;">Nenhum evento criado ainda</h3>
          <p style="color:var(--text-secondary); margin-top:6px; max-width:480px; margin-left:auto; margin-right:auto;">
            Crie o seu primeiro evento para configurar bilhetes, pontos de venda (prestadores) e dispositivos de acesso.
          </p>
          <button class="btn btn-neon" id="btn-empty-create-event" style="margin-top:18px;">
            Criar Primeiro Evento
          </button>
        </div>
      ` : `
        <div class="card" style="padding:18px 24px; margin-bottom:24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <label style="font-size:0.85rem; color:var(--text-secondary); font-weight:600;">Evento Ativo:</label>
            <select id="select-active-event" class="form-select" style="width:auto; font-weight:700;">
              ${eventos.map(e => `
                <option value="${e.id}" ${e.id === currentEvent.id ? 'selected' : ''}>
                  ${e.nome} (${e.estado.toUpperCase()})
                </option>
              `).join('')}
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:0.85rem; color:var(--text-secondary);">Mudar Estado:</span>
            <select id="select-event-state" class="form-select" style="width:auto; font-size:0.85rem; padding:6px 12px;">
              <option value="rascunho" ${currentEvent.estado === 'rascunho' ? 'selected' : ''}>Rascunho</option>
              <option value="publicado" ${currentEvent.estado === 'publicado' ? 'selected' : ''}>Publicado (Vendas Abertas)</option>
              <option value="em_curso" ${currentEvent.estado === 'em_curso' ? 'selected' : ''}>Em Curso (Portas & Bares Ativos)</option>
              <option value="encerrado" ${currentEvent.estado === 'encerrado' ? 'selected' : ''}>Encerrado</option>
            </select>
          </div>
        </div>

        <!-- TABS BAR -->
        <div style="display:flex; gap:10px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px; margin-bottom:24px; overflow-x:auto;">
          <button class="btn btn-sm ${activeOrganizerTab === 'events' ? 'btn-primary' : 'btn-ghost'} org-nav-tab" data-tab="events">
            📋 Detalhes do Evento
          </button>
          <button class="btn btn-sm ${activeOrganizerTab === 'tickets' ? 'btn-primary' : 'btn-ghost'} org-nav-tab" data-tab="tickets">
            🎟️ Tipos de Bilhete
          </button>
          <button class="btn btn-sm ${activeOrganizerTab === 'points' ? 'btn-primary' : 'btn-ghost'} org-nav-tab" data-tab="points">
            🏪 Prestadores & Bares
          </button>
          <button class="btn btn-sm ${activeOrganizerTab === 'devices' ? 'btn-primary' : 'btn-ghost'} org-nav-tab" data-tab="devices">
            📱 Dispositivos & Pareamento
          </button>
          <button class="btn btn-sm ${activeOrganizerTab === 'reports' ? 'btn-primary' : 'btn-ghost'} org-nav-tab" data-tab="reports">
            📊 Relatórios & Conciliação
          </button>
          <button class="btn btn-sm ${activeOrganizerTab === 'refunds' ? 'btn-primary' : 'btn-ghost'} org-nav-tab" data-tab="refunds">
            💸 Reembolsos
          </button>
        </div>

        <!-- TAB CONTENT CONTAINER -->
        <div id="org-tab-content-container">
          ${renderTabContent(currentEvent)}
        </div>
      `}

      <!-- MODALS CONTAINER -->
      <div id="org-modals-container"></div>
    </div>
  `;
}

function renderLoginScreen() {
  return `
    <div style="max-width:440px; margin:50px auto; padding:0 20px;">
      <div class="card" style="padding:32px;">
        <div style="text-align:center; margin-bottom:24px;">
          <div style="width:52px; height:52px; border-radius:14px; background:var(--gradient-neon); color:#070A11; display:flex; align-items:center; justify-content:center; margin:0 auto 12px auto; font-size:1.5rem; font-weight:800;">
            AQ
          </div>
          <h2 style="font-size:1.5rem;">Acesso do Organizador</h2>
          <p style="color:var(--text-secondary); font-size:0.88rem; margin-top:4px;">
            Introduza as suas credenciais para aceder ao painel oficial
          </p>
        </div>

        <!-- Credentials Info Box -->
        <div style="background:rgba(5,242,146,0.08); border:1px solid var(--accent-neon); border-radius:var(--radius-md); padding:14px; margin-bottom:20px; font-size:0.85rem;">
          <div style="font-weight:700; color:var(--accent-neon); margin-bottom:6px; display:flex; align-items:center; gap:6px;">
            <span>🔑</span> Credenciais Oficiais de Acesso:
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="color:var(--text-muted);">Email:</span>
            <code style="color:#fff; font-weight:700;">org@acessoqr.mz</code>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="color:var(--text-muted);">Senha:</span>
            <code style="color:#fff; font-weight:700;">mudar123</code>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-muted);">Código 2FA / TOTP:</span>
            <code style="color:var(--accent-neon); font-weight:700;">123456</code>
          </div>
        </div>

        <form id="org-login-form">
          <div class="form-group">
            <label class="form-label">Email do Organizador</label>
            <input type="email" class="form-input" id="org-email" required placeholder="org@exemplo.mz" value="org@acessoqr.mz" />
          </div>

          <div class="form-group">
            <label class="form-label">Palavra-passe</label>
            <input type="password" class="form-input" id="org-password" required placeholder="••••••••" value="mudar123" />
          </div>

          <div id="totp-field-group" style="display:none; margin-top:16px; padding:16px; background:var(--bg-tertiary); border:1px solid var(--accent-neon); border-radius:var(--radius-md);">
            <label class="form-label" style="color:var(--accent-neon);">Código 2FA / TOTP</label>
            <input type="text" class="form-input" id="org-totp" placeholder="123456" maxlength="6" value="123456" />
          </div>

          <button type="submit" class="btn btn-neon btn-full btn-lg" id="btn-org-login-submit" style="margin-top:18px;">
            <span>Entrar com Segurança</span>
          </button>
        </form>
      </div>
    </div>
  `;
}

function renderTabContent(event) {
  switch (activeOrganizerTab) {
    case 'events':
      return `
        <div class="card" style="padding:24px;">
          <h3 style="font-size:1.2rem; margin-bottom:16px;">Detalhes do Evento</h3>
          <div class="grid-2">
            <div>
              <div style="font-size:0.8rem; color:var(--text-muted);">NOME DO EVENTO</div>
              <div style="font-size:1.1rem; font-weight:700; margin-top:2px;">${event.nome}</div>
            </div>
            <div>
              <div style="font-size:0.8rem; color:var(--text-muted);">LOCAL / RECINTO</div>
              <div style="font-size:1.1rem; font-weight:700; margin-top:2px;">${event.local || 'Não especificado'}</div>
            </div>
            <div>
              <div style="font-size:0.8rem; color:var(--text-muted);">DATA DE INÍCIO</div>
              <div style="font-size:1rem; font-weight:600; margin-top:2px;">${formatDateTime(event.inicio)}</div>
            </div>
            <div>
              <div style="font-size:0.8rem; color:var(--text-muted);">DATA DE FIM</div>
              <div style="font-size:1rem; font-weight:600; margin-top:2px;">${formatDateTime(event.fim)}</div>
            </div>
            <div>
              <div style="font-size:0.8rem; color:var(--text-muted);">MOEDA</div>
              <div style="font-size:1.1rem; font-weight:700; color:var(--accent-neon); margin-top:2px;">${event.moeda}</div>
            </div>
            <div>
              <div style="font-size:0.8rem; color:var(--text-muted);">SALDO MÁXIMO POR CARTEIRA</div>
              <div style="font-size:1.1rem; font-weight:700; margin-top:2px;">${formatMT(event.saldo_maximo)}</div>
            </div>
          </div>
        </div>
      `;

    case 'tickets':
      return `
        <div class="card" style="padding:24px;">
          <div class="card-header">
            <div>
              <div class="card-title">Tipos de Bilhete Configurados</div>
              <div class="card-subtitle">Bilhetes reais cadastrados no PostgreSQL para este evento</div>
            </div>
            <button class="btn btn-neon btn-sm" id="btn-modal-add-ticket">
              + Adicionar Tipo de Bilhete
            </button>
          </div>
          <div id="tickets-list-container">
            <div style="text-align:center; padding:20px; color:var(--text-muted);">A carregar bilhetes da base de dados...</div>
          </div>
        </div>
      `;

    case 'points':
      return `
        <div class="card" style="padding:24px;">
          <div class="card-header">
            <div>
              <div class="card-title">Pontos de Venda & Vendedores (Prestadores de Serviço)</div>
              <div class="card-subtitle">Bares, barracas de comida e equipa comercial</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-primary btn-sm" id="btn-modal-add-point">+ Novo Ponto de Venda</button>
              <button class="btn btn-neon btn-sm" id="btn-modal-add-seller">+ Novo Vendedor</button>
            </div>
          </div>
          <div id="points-list-container">
            <div style="text-align:center; padding:20px; color:var(--text-muted);">A carregar pontos e vendedores...</div>
          </div>
        </div>
      `;

    case 'devices':
      return `
        <div class="card" style="padding:24px;">
          <div class="card-header">
            <div>
              <div class="card-title">Dispositivos Emparelhados (Terminais POS & Portaria)</div>
              <div class="card-subtitle">Gere códigos de pareamento e autorize telemóveis do staff</div>
            </div>
            <button class="btn btn-neon btn-sm" id="btn-modal-add-device">
              + Emparelhar Novo Dispositivo
            </button>
          </div>
          <div id="devices-list-container">
            <div style="text-align:center; padding:20px; color:var(--text-muted);">A carregar dispositivos...</div>
          </div>
        </div>
      `;

    case 'reports':
      return `
        <div class="card" style="padding:24px;">
          <div class="card-header">
            <div class="card-title">Relatórios e Conciliação Financeira (PostgreSQL)</div>
            <span class="badge badge-neon">Em Tempo Real</span>
          </div>
          <div id="reports-content-container">
            <div style="text-align:center; padding:20px; color:var(--text-muted);">A calcular relatórios da base de dados...</div>
          </div>
        </div>
      `;

    case 'refunds':
      return `
        <div class="card" style="padding:24px;">
          <div class="card-header">
            <div class="card-title">Pedidos de Reembolso do Saldo Restante</div>
          </div>
          <div id="refunds-content-container">
            <div style="text-align:center; padding:20px; color:var(--text-muted);">A carregar pedidos de reembolso...</div>
          </div>
        </div>
      `;

    default:
      return '';
  }
}

export function setupOrganizerEvents(onReload) {
  // Login Form
  const loginForm = document.getElementById('org-login-form');
  if (loginForm) {
    let awaitingTotp = false;
    let savedEmail = '';

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('org-email').value;
      const senha = document.getElementById('org-password').value;
      const totpField = document.getElementById('org-totp');
      const submitBtn = document.getElementById('btn-org-login-submit');

      try {
        if (!awaitingTotp) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'A validar senha...';
          const r = await api.organizerLogin(email, senha);
          awaitingTotp = true;
          savedEmail = email;
          document.getElementById('totp-field-group').style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirmar Código 2FA';
          showToast('Senha válida! Insira o código TOTP do seu telemóvel.', 'info');
        } else {
          submitBtn.disabled = true;
          submitBtn.textContent = 'A autenticar...';
          await api.organizerVerify2fa(savedEmail, totpField.value.trim());
          showToast('Sessão iniciada com sucesso!', 'success');
          onReload();
        }
      } catch (err) {
        showToast(err.message || 'Erro ao autenticar', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = awaitingTotp ? 'Confirmar Código 2FA' : 'Entrar com Segurança';
      }
    });
    return;
  }

  // Logout
  const logoutBtn = document.getElementById('btn-org-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      api.organizerLogout();
      showToast('Sessão terminada.', 'info');
      onReload();
    });
  }

  // Switch Active Event
  const eventSelect = document.getElementById('select-active-event');
  if (eventSelect) {
    eventSelect.addEventListener('change', (e) => {
      selectedEventId = e.target.value;
      onReload();
    });
  }

  // Change Event State
  const stateSelect = document.getElementById('select-event-state');
  if (stateSelect && selectedEventId) {
    stateSelect.addEventListener('change', async (e) => {
      try {
        await api.updateEventState(selectedEventId, e.target.value);
        showToast(`Estado atualizado para: ${e.target.value.toUpperCase()}`, 'success');
        onReload();
      } catch (err) {
        showToast(err.message || 'Erro ao mudar estado', 'error');
        onReload();
      }
    });
  }

  // Nav Tabs
  const tabs = document.querySelectorAll('.org-nav-tab');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      activeOrganizerTab = t.dataset.tab;
      onReload();
    });
  });

  // Modal: Create Event
  const createEventBtn = document.getElementById('btn-modal-create-event');
  const emptyCreateBtn = document.getElementById('btn-empty-create-event');
  const modalsContainer = document.getElementById('org-modals-container');

  const openCreateModal = () => {
    modalsContainer.innerHTML = `
      <div class="modal-overlay" id="create-event-overlay">
        <div class="modal-content" style="max-width:540px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
            <h3 style="font-size:1.3rem;">Criar Novo Evento (PostgreSQL)</h3>
            <button class="btn btn-ghost btn-sm" id="btn-close-modal">✕</button>
          </div>

          <form id="create-event-real-form">
            <div class="form-group">
              <label class="form-label">Nome do Evento</label>
              <input type="text" class="form-input" id="ev-nome" required placeholder="Ex: Festival Maputo Sound 2026" />
            </div>

            <div class="form-group">
              <label class="form-label">Local / Recinto</label>
              <input type="text" class="form-input" id="ev-local" required placeholder="Ex: Arena Costa do Sol, Maputo" />
            </div>

            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Data e Hora de Início</label>
                <input type="datetime-local" class="form-input" id="ev-inicio" required />
              </div>
              <div class="form-group">
                <label class="form-label">Data e Hora de Fim</label>
                <input type="datetime-local" class="form-input" id="ev-fim" required />
              </div>
            </div>

            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Moeda</label>
                <input type="text" class="form-input" id="ev-moeda" value="MZN" readonly />
              </div>
              <div class="form-group">
                <label class="form-label">Saldo Máximo p/ Carteira (MT)</label>
                <input type="number" class="form-input" id="ev-saldo-max" value="25000" min="500" />
              </div>
            </div>

            <button type="submit" class="btn btn-neon btn-full" style="margin-top:14px;">
              Gravar Evento no PostgreSQL
            </button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal').addEventListener('click', () => modalsContainer.innerHTML = '');

    // Set default dates (tomorrow and day after)
    const now = new Date();
    const d1 = new Date(now.getTime() + 86400000);
    const d2 = new Date(now.getTime() + 172800000);
    document.getElementById('ev-inicio').value = d1.toISOString().slice(0, 16);
    document.getElementById('ev-fim').value = d2.toISOString().slice(0, 16);

    document.getElementById('create-event-real-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const ev = await api.createEvent({
          nome: document.getElementById('ev-nome').value,
          local: document.getElementById('ev-local').value,
          inicio: new Date(document.getElementById('ev-inicio').value).toISOString(),
          fim: new Date(document.getElementById('ev-fim').value).toISOString(),
          moeda: 'MZN',
          saldo_maximo: Number(document.getElementById('ev-saldo-max').value)
        });
        showToast(`Evento "${ev.nome}" gravado com sucesso!`, 'success');
        selectedEventId = ev.id;
        modalsContainer.innerHTML = '';
        onReload();
      } catch (err) {
        showToast(err.message || 'Erro ao criar evento', 'error');
      }
    });
  };

  if (createEventBtn) createEventBtn.addEventListener('click', openCreateModal);
  if (emptyCreateBtn) emptyCreateBtn.addEventListener('click', openCreateModal);

  // Lazy-load active tab contents from backend
  if (selectedEventId) {
    loadTabAsync(selectedEventId, modalsContainer, onReload);
  }
}

async function loadTabAsync(eventId, modalsContainer, onReload) {
  if (activeOrganizerTab === 'tickets') {
    const listEl = document.getElementById('tickets-list-container');
    if (listEl) {
      try {
        const tickets = await api.getTicketTypes(eventId);
        if (tickets.length === 0) {
          listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum tipo de bilhete cadastrado ainda neste evento.</div>';
        } else {
          listEl.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${tickets.map(t => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:var(--bg-tertiary); border-radius:var(--radius-sm);">
                  <div>
                    <div style="font-weight:700;">${t.nome}</div>
                    <div style="font-size:0.8rem; color:var(--text-secondary);">
                      Preço: <strong>${formatMT(t.preco)}</strong> · Carga Inicial no QR: <strong style="color:var(--accent-neon);">${formatMT(t.carga_inicial)}</strong>
                    </div>
                  </div>
                  <div>
                    <span class="badge ${t.activo ? 'badge-neon' : 'badge-rose'}">${t.activo ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `;
        }

        // Add Ticket Button
        const addTicketBtn = document.getElementById('btn-modal-add-ticket');
        if (addTicketBtn) {
          addTicketBtn.onclick = () => {
            modalsContainer.innerHTML = `
              <div class="modal-overlay">
                <div class="modal-content" style="max-width:440px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h3 style="font-size:1.2rem;">Adicionar Tipo de Bilhete</h3>
                    <button class="btn btn-ghost btn-sm" id="btn-close-ticket-modal">✕</button>
                  </div>
                  <form id="add-ticket-form">
                    <div class="form-group">
                      <label class="form-label">Nome do Bilhete</label>
                      <input type="text" class="form-input" id="tkt-nome" required placeholder="Ex: VIP Frontstage" />
                    </div>
                    <div class="grid-2">
                      <div class="form-group">
                        <label class="form-label">Preço de Venda (MT)</label>
                        <input type="number" class="form-input" id="tkt-preco" required placeholder="Ex: 2500" min="0" />
                      </div>
                      <div class="form-group">
                        <label class="form-label">Carga Inicial (MT)</label>
                        <input type="number" class="form-input" id="tkt-carga" value="500" min="0" />
                      </div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">Limite de Vendas (Quota)</label>
                      <input type="number" class="form-input" id="tkt-limite" placeholder="Opcional (ex: 500)" />
                    </div>
                    <button type="submit" class="btn btn-neon btn-full" style="margin-top:10px;">Gravar no PostgreSQL</button>
                  </form>
                </div>
              </div>
            `;
            document.getElementById('btn-close-ticket-modal').onclick = () => modalsContainer.innerHTML = '';
            document.getElementById('add-ticket-form').onsubmit = async (e) => {
              e.preventDefault();
              try {
                await api.createTicketType(eventId, {
                  nome: document.getElementById('tkt-nome').value,
                  preco: Number(document.getElementById('tkt-preco').value),
                  carga_inicial: Number(document.getElementById('tkt-carga').value),
                  limite_vendas: document.getElementById('tkt-limite').value ? Number(document.getElementById('tkt-limite').value) : null
                });
                showToast('Tipo de bilhete criado com sucesso!', 'success');
                modalsContainer.innerHTML = '';
                onReload();
              } catch (err) {
                showToast(err.message || 'Erro ao criar bilhete', 'error');
              }
            };
          };
        }
      } catch (e) {
        listEl.innerHTML = `<div style="color:var(--accent-rose);">${e.message}</div>`;
      }
    }
  } else if (activeOrganizerTab === 'points') {
    const pointsEl = document.getElementById('points-list-container');
    if (pointsEl) {
      try {
        const [points, sellers] = await Promise.all([
          api.getPointsOfSale(eventId),
          api.getSellers(eventId)
        ]);

        pointsEl.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:16px;">
            ${points.length === 0 ? '<div style="color:var(--text-muted); text-align:center;">Nenhum ponto de venda criado ainda.</div>' : points.map(p => {
              const pointSellers = sellers.filter(s => s.point_id === p.id);
              return `
                <div style="background:var(--bg-tertiary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:16px;">
                  <div style="font-weight:700; font-size:1.1rem; color:#fff;">🏪 ${p.nome}</div>
                  <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">ID: ${p.id}</div>
                  <div style="margin-top:10px; border-top:1px solid var(--border-subtle); padding-top:10px;">
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:6px;">VENDEDORES ASSOCIADOS:</div>
                    ${pointSellers.length === 0 ? '<span style="font-size:0.8rem; color:var(--text-muted);">Nenhum vendedor associado a este ponto.</span>' : pointSellers.map(s => `
                      <span class="badge badge-cyan" style="margin-right:6px;">👤 ${s.nome}</span>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        // Modals for Add Point and Add Seller
        const addPointBtn = document.getElementById('btn-modal-add-point');
        if (addPointBtn) {
          addPointBtn.onclick = () => {
            const nome = prompt('Nome do Ponto de Venda (ex: Bar Central, Barraca do Carlos):');
            if (nome) {
              api.createPointOfSale(eventId, nome).then(() => {
                showToast('Ponto de venda criado!', 'success');
                onReload();
              }).catch(e => showToast(e.message, 'error'));
            }
          };
        }

        const addSellerBtn = document.getElementById('btn-modal-add-seller');
        if (addSellerBtn) {
          addSellerBtn.onclick = () => {
            if (points.length === 0) {
              showToast('Crie primeiro um ponto de venda.', 'error');
              return;
            }
            const nome = prompt('Nome do Vendedor / Prestador:');
            if (nome) {
              api.createSeller(eventId, points[0].id, nome).then(() => {
                showToast('Vendedor adicionado!', 'success');
                onReload();
              }).catch(e => showToast(e.message, 'error'));
            }
          };
        }
      } catch (err) {
        pointsEl.innerHTML = `<div style="color:var(--accent-rose);">${err.message}</div>`;
      }
    }
  } else if (activeOrganizerTab === 'devices') {
    const devEl = document.getElementById('devices-list-container');
    if (devEl) {
      try {
        const [devices, sellers] = await Promise.all([
          api.getDevices(eventId),
          api.getSellers(eventId)
        ]);

        devEl.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${devices.length === 0 ? '<div style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum dispositivo emparelhado.</div>' : devices.map(d => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:14px; background:var(--bg-tertiary); border-radius:var(--radius-md);">
                <div>
                  <div style="font-weight:700;">${d.nome} (${d.tipo.toUpperCase()})</div>
                  <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">
                    Código: <code style="color:var(--accent-neon); font-family:var(--font-mono); font-weight:700;">${d.codigo_pareamento || 'Pareado'}</code>
                  </div>
                </div>
                <div>
                  <span class="badge ${d.activo ? 'badge-neon' : 'badge-rose'}">${d.activo ? 'Ativo' : 'Revogado'}</span>
                </div>
              </div>
            `).join('')}
          </div>
        `;

        const addDevBtn = document.getElementById('btn-modal-add-device');
        if (addDevBtn) {
          addDevBtn.onclick = () => {
            const nome = prompt('Nome do Dispositivo (ex: Telemóvel Bar 01):');
            if (nome) {
              const tipo = confirm('Clique OK para VENDEDOR (POS) ou CANCELAR para PORTA (Scanner)?') ? 'vendedor' : 'porta';
              api.createDevice(eventId, {
                nome,
                tipo,
                seller_id: tipo === 'vendedor' && sellers[0] ? sellers[0].id : null
              }).then(d => {
                alert(`Dispositivo Criado!\n\nCÓDIGO DE PAREAMENTO: ${d.codigo_pareamento}\n\nAbra o terminal e introduza este código no prazo de 15 minutos.`);
                onReload();
              }).catch(e => showToast(e.message, 'error'));
            }
          };
        }
      } catch (err) {
        devEl.innerHTML = `<div style="color:var(--accent-rose);">${err.message}</div>`;
      }
    }
  } else if (activeOrganizerTab === 'reports') {
    const repEl = document.getElementById('reports-content-container');
    if (repEl) {
      try {
        const [resumo, concil] = await Promise.all([
          api.getSummaryReport(eventId),
          api.getReconciliationReport(eventId)
        ]);

        repEl.innerHTML = `
          <div class="grid-3" style="margin-bottom:20px;">
            <div style="background:var(--bg-tertiary); padding:16px; border-radius:var(--radius-md);">
              <div style="font-size:0.8rem; color:var(--text-muted);">SALDO ATUAL CARTEIRAS</div>
              <div style="font-size:1.5rem; font-weight:800; color:var(--accent-cyan);">${formatMT(concil.saldo_carteiras)}</div>
            </div>
            <div style="background:var(--bg-tertiary); padding:16px; border-radius:var(--radius-md);">
              <div style="font-size:0.8rem; color:var(--text-muted);">MOVIMENTOS TOTAIS</div>
              <div style="font-size:1.5rem; font-weight:800; color:var(--accent-neon);">${formatMT(concil.soma_movimentos)}</div>
            </div>
            <div style="background:var(--bg-tertiary); padding:16px; border-radius:var(--radius-md);">
              <div style="font-size:0.8rem; color:var(--text-muted);">ESTADO CONCILIAÇÃO</div>
              <div style="font-size:1.2rem; font-weight:800; color:${concil.conciliado ? 'var(--accent-neon)' : 'var(--accent-rose)'};">
                ${concil.conciliado ? '● 100% CONCILIADO' : '● DESCONCILIADO'}
              </div>
            </div>
          </div>
        `;
      } catch (err) {
        repEl.innerHTML = `<div style="color:var(--accent-rose);">${err.message}</div>`;
      }
    }
  }
}
