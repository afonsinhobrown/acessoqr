import confetti from 'canvas-confetti';
import { api } from '../services/api.js';
import { formatMT } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';

export async function renderLandingView(onNavigateToWallet) {
  let events = [];
  try {
    events = await api.getPublicEvents();
  } catch (err) {
    console.error('Erro ao buscar eventos públicos:', err);
  }

  const activeEvent = events.length > 0 ? events[0] : null;
  let ticketTypes = [];
  if (activeEvent) {
    try {
      ticketTypes = await api.getPublicTicketTypes(activeEvent.id);
    } catch (err) {
      console.error('Erro ao buscar tipos de bilhete:', err);
    }
  }

  return `
    <div class="landing-page">
      <!-- HERO SECTION -->
      <section class="hero-section">
        <div class="hero-badge">
          <span class="dot-live"></span>
          <span>SISTEMA OFICIAL CASHLESS & TICKETING · MOÇAMBIQUE</span>
        </div>

        <h1 class="hero-title">
          O teu bilhete, carteira e consumos no <span class="text-gradient">mesmo QR</span>.
        </h1>

        <p class="hero-subtitle">
          Entra na porta, consome nos bares e barracas sem notas nem moedas físicas.
          Carrega saldo via <strong>M-Pesa</strong> ou <strong>e-Mola</strong> em segundos e recebe o reembolso do saldo que sobrar.
        </p>

        <!-- Live Event Showcase Card -->
        ${!activeEvent ? `
          <div class="event-showcase-card" style="text-align:center; padding:36px;">
            <div style="font-size:2.5rem; margin-bottom:12px;">🎟️</div>
            <h2 style="font-size:1.6rem;">Nenhum Evento Publicado de Momento</h2>
            <p style="color:var(--text-secondary); margin-top:8px; max-width:520px; margin-left:auto; margin-right:auto;">
              Aceda à aba <strong>"Organizador"</strong> para fazer login, criar o seu evento e publicar os tipos de bilhete na base de dados PostgreSQL.
            </p>
          </div>
        ` : `
          <div class="event-showcase-card">
            <div class="event-glow"></div>
            <div class="event-header-info">
              <div>
                <span class="badge badge-neon">${activeEvent.estado.toUpperCase()}</span>
                <h2 style="font-size:1.8rem; margin-top:8px;">${activeEvent.nome}</h2>
                <div style="display:flex; align-items:center; gap:16px; margin-top:6px; color:var(--text-secondary); font-size:0.92rem; flex-wrap:wrap;">
                  <span>📍 ${activeEvent.local || 'Recinto Oficial'}</span>
                  <span>📅 Início: ${new Date(activeEvent.inicio).toLocaleDateString('pt-MZ')}</span>
                  <span>🔒 Moeda: ${activeEvent.moeda}</span>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">Saldo Máximo</div>
                <div style="font-family:var(--font-display); font-size:1.4rem; font-weight:800; color:var(--accent-neon);">${formatMT(activeEvent.saldo_maximo)}</div>
              </div>
            </div>
          </div>
        `}
      </section>

      <!-- TICKETS SECTION -->
      ${activeEvent ? `
        <section class="tickets-section" style="margin-top:40px;">
          <div style="text-align:center; margin-bottom:30px;">
            <h2 style="font-size:1.8rem;">Bilhetes Disponíveis</h2>
            <p style="color:var(--text-secondary); font-size:0.95rem; margin-top:4px;">
              Cada bilhete cria uma carteira digital com <strong>carga inicial incluída</strong> diretamente no PostgreSQL!
            </p>
          </div>

          ${ticketTypes.length === 0 ? `
            <div class="card" style="text-align:center; padding:30px; color:var(--text-muted);">
              O organizador ainda não publicou tipos de bilhete para este evento.
            </div>
          ` : `
            <div class="grid-3">
              ${ticketTypes.map(t => `
                <div class="ticket-card card">
                  <div class="ticket-type-name">${t.nome}</div>
                  <div class="ticket-price-box">
                    <div class="ticket-price">${formatMT(t.preco)}</div>
                    <div class="ticket-preload-badge">
                      🎁 Inclui <strong>${formatMT(t.carga_inicial)}</strong> em consumo
                    </div>
                  </div>

                  <button class="btn btn-neon btn-full btn-buy-ticket" data-event-id="${activeEvent.id}" data-ticket-id="${t.id}" data-ticket-name="${t.nome}" data-ticket-price="${t.preco}" data-ticket-preload="${t.carga_inicial}">
                    Comprar Bilhete Real
                  </button>
                </div>
              `).join('')}
            </div>
          `}
        </section>
      ` : ''}

      <!-- CHECKOUT MODAL PLACEHOLDER -->
      <div id="checkout-modal-container"></div>
    </div>
  `;
}

export function setupLandingEvents(onNavigateToWallet) {
  const buyButtons = document.querySelectorAll('.btn-buy-ticket');
  const modalContainer = document.getElementById('checkout-modal-container');

  buyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const eventId = btn.dataset.eventId;
      const ticketId = btn.dataset.ticketId;
      const ticketName = btn.dataset.ticketName;
      const ticketPrice = btn.dataset.ticketPrice;
      const ticketPreload = btn.dataset.ticketPreload;

      openCheckoutModal(modalContainer, {
        eventId,
        ticketId,
        ticketName,
        ticketPrice,
        ticketPreload
      }, onNavigateToWallet);
    });
  });
}

function openCheckoutModal(container, ticket, onNavigateToWallet) {
  container.innerHTML = `
    <div class="modal-overlay" id="checkout-overlay">
      <div class="modal-content" style="max-width:500px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <div>
            <span class="badge badge-neon">CHECKOUT REAL</span>
            <h3 style="font-size:1.4rem; margin-top:4px;">${ticket.ticketName}</h3>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-close-modal" style="font-size:1.4rem; padding:4px 8px;">✕</button>
        </div>

        <form id="checkout-form-real">
          <div class="form-group">
            <label class="form-label">Email do Comprador</label>
            <input type="email" class="form-input" id="buyer-email" required placeholder="comprador@exemplo.mz" />
          </div>

          <div class="form-group">
            <label class="form-label">Telemóvel (+258 M-Pesa / e-Mola)</label>
            <input type="tel" class="form-input" id="buyer-phone" required placeholder="+258 84 000 0000" />
          </div>

          <div class="form-group">
            <label class="form-label">Método</label>
            <select class="form-select" id="buyer-method">
              <option value="mpesa">M-Pesa (Vodacom)</option>
              <option value="emola">e-Mola (Movitel)</option>
              <option value="dinheiro">Dinheiro (Balcão)</option>
            </select>
          </div>

          <button type="submit" class="btn btn-neon btn-full btn-lg" id="btn-pay-submit" style="margin-top:14px;">
            <span>Pagar ${formatMT(ticket.ticketPrice)} & Criar Carteira</span>
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('btn-close-modal').addEventListener('click', () => container.innerHTML = '');

  document.getElementById('checkout-form-real').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('buyer-email').value.trim();
    const telefone = document.getElementById('buyer-phone').value.trim();
    const metodo = document.getElementById('buyer-method').value;
    const submitBtn = document.getElementById('btn-pay-submit');

    submitBtn.disabled = true;
    submitBtn.textContent = 'A processar na API e PostgreSQL...';

    try {
      const order = await api.createTicketOrder(ticket.eventId, {
        ticket_type_id: ticket.ticketId,
        email,
        telefone,
        metodo
      });

      confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
      showToast('Bilhete pago com sucesso na base de dados!', 'success');

      container.querySelector('.modal-content').innerHTML = `
        <div style="text-align:center; padding:10px 0;">
          <div style="width:60px; height:60px; border-radius:50%; background:var(--accent-neon-dim); color:var(--accent-neon); display:flex; align-items:center; justify-content:center; margin:0 auto 16px auto; font-size:1.8rem;">
            ✓
          </div>
          <h3 style="font-size:1.5rem;">Pedido Registado no PostgreSQL!</h3>
          <p style="color:var(--text-secondary); font-size:0.9rem; margin-top:6px;">
            ID do Pedido: <code style="color:var(--accent-neon);">${order.pedido ? order.pedido.id : 'OK'}</code>
          </p>
          <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:12px;">
            Faça login na aba <strong>"Minha Carteira"</strong> com o seu email (<strong>${email}</strong>) para ver o seu QR rotativo Ed25519 e gastar o seu saldo nos bares.
          </p>
          <button class="btn btn-neon btn-full" id="btn-go-wallet-pass" style="margin-top:20px;">
            Ir Para Minha Carteira
          </button>
        </div>
      `;

      document.getElementById('btn-go-wallet-pass').addEventListener('click', () => {
        container.innerHTML = '';
        onNavigateToWallet(null);
      });
    } catch (err) {
      showToast(err.message || 'Erro ao processar bilhete', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Tentar Novamente';
    }
  });
}
