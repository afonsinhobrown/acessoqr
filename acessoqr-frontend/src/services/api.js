// Real API Client connecting to acessoqr-api (Express + Neon PostgreSQL)

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://acessoqr-api.onrender.com';

class RealApiService {
  constructor() {
    this.orgToken = localStorage.getItem('acessoqr_org_token') || null;
    this.buyerToken = localStorage.getItem('acessoqr_buyer_token') || null;
    this.deviceToken = localStorage.getItem('acessoqr_device_token') || null;
    this.deviceInfo = null;
    try {
      this.deviceInfo = JSON.parse(localStorage.getItem('acessoqr_device_info') || 'null');
    } catch {}
  }

  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (options.auth === 'org' && this.orgToken) {
      headers['Authorization'] = `Bearer ${this.orgToken}`;
    } else if (options.auth === 'buyer' && this.buyerToken) {
      headers['Authorization'] = `Bearer ${this.buyerToken}`;
    } else if (options.auth === 'device' && this.deviceToken) {
      headers['Authorization'] = `Bearer ${this.deviceToken}`;
    }

    const res = await fetch(url, {
      ...options,
      headers
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.erro || `Erro HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ==================== ORGANIZER AUTH ====================
  async organizerLogin(email, senha) {
    return this.request('/organizador/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha })
    });
  }

  async organizerVerify2fa(email, codigo, dispositivo = 'Web Dashboard') {
    const data = await this.request('/organizador/auth/2fa', {
      method: 'POST',
      body: JSON.stringify({ email, codigo, dispositivo })
    });
    const token = data.access_token || data.token_acesso;
    if (token) {
      this.orgToken = token;
      localStorage.setItem('acessoqr_org_token', token);
    }
    return data;
  }

  organizerLogout() {
    this.orgToken = null;
    localStorage.removeItem('acessoqr_org_token');
  }

  isOrganizerLoggedIn() {
    return Boolean(this.orgToken);
  }

  async getOrganizerProfile() {
    return this.request('/organizador/eu', { auth: 'org' });
  }

  // ==================== EVENTS (ORGANIZER) ====================
  async createEvent(eventData) {
    return this.request('/organizadores/eventos', {
      method: 'POST',
      auth: 'org',
      body: JSON.stringify(eventData)
    });
  }

  async getEvent(eventId) {
    return this.request(`/organizadores/eventos/${eventId}`, { auth: 'org' });
  }

  async updateEventState(eventId, estado) {
    return this.request(`/organizadores/eventos/${eventId}/estado`, {
      method: 'POST',
      auth: 'org',
      body: JSON.stringify({ estado })
    });
  }

  // ==================== TICKET TYPES ====================
  async createTicketType(eventId, ticketData) {
    return this.request(`/organizadores/eventos/${eventId}/tipos-bilhete`, {
      method: 'POST',
      auth: 'org',
      body: JSON.stringify(ticketData)
    });
  }

  async getTicketTypes(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/tipos-bilhete`, { auth: 'org' });
  }

  // ==================== POINTS OF SALE & SELLERS ====================
  async createPointOfSale(eventId, nome) {
    return this.request(`/organizadores/eventos/${eventId}/pontos-venda`, {
      method: 'POST',
      auth: 'org',
      body: JSON.stringify({ nome })
    });
  }

  async getPointsOfSale(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/pontos-venda`, { auth: 'org' });
  }

  async createSeller(eventId, pontoVendaId, nome) {
    return this.request(`/organizadores/eventos/${eventId}/vendedores`, {
      method: 'POST',
      auth: 'org',
      body: JSON.stringify({ ponto_venda_id: pontoVendaId, nome })
    });
  }

  async getSellers(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/vendedores`, { auth: 'org' });
  }

  // ==================== DEVICES & PAIRING ====================
  async createDevice(eventId, { tipo, nome, seller_id }) {
    return this.request(`/organizadores/eventos/${eventId}/dispositivos`, {
      method: 'POST',
      auth: 'org',
      body: JSON.stringify({ tipo, nome, seller_id })
    });
  }

  async getDevices(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/dispositivos`, { auth: 'org' });
  }

  async revokeDevice(deviceId) {
    return this.request(`/organizadores/dispositivos/${deviceId}/revogar`, {
      method: 'POST',
      auth: 'org'
    });
  }

  async pairDevice(codigo, chavePublica = 'DEV_KEY_' + Math.random().toString(36).substring(2)) {
    const data = await this.request('/dispositivos/parear', {
      method: 'POST',
      body: JSON.stringify({ codigo, chave_publica: chavePublica })
    });
    if (data.token) {
      this.deviceToken = data.token;
      this.deviceInfo = data.dispositivo;
      localStorage.setItem('acessoqr_device_token', data.token);
      localStorage.setItem('acessoqr_device_info', JSON.stringify(data.dispositivo));
    }
    return data;
  }

  unpairDevice() {
    this.deviceToken = null;
    this.deviceInfo = null;
    localStorage.removeItem('acessoqr_device_token');
    localStorage.removeItem('acessoqr_device_info');
  }

  isDevicePaired() {
    return Boolean(this.deviceToken);
  }

  // ==================== REPORTS & FINANCIALS ====================
  async getSummaryReport(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/relatorios/resumo`, { auth: 'org' });
  }

  async getSalesReport(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/relatorios/vendas`, { auth: 'org' });
  }

  async getRechargesReport(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/relatorios/recargas`, { auth: 'org' });
  }

  async getReconciliationReport(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/relatorios/conciliacao`, { auth: 'org' });
  }

  async getRefunds(eventId) {
    return this.request(`/organizadores/eventos/${eventId}/reembolsos`, { auth: 'org' });
  }

  async decideRefund(refundId, aprovar, motivo = null) {
    return this.request(`/organizadores/reembolsos/${refundId}/decidir`, {
      method: 'POST',
      auth: 'org',
      body: JSON.stringify({ aprovar, motivo })
    });
  }

  // ==================== PUBLIC VITRINE & BUYER TICKETING ====================
  async getPublicEvents() {
    return this.request('/public/eventos');
  }

  async getPublicTicketTypes(eventId) {
    return this.request(`/public/eventos/${eventId}/bilhetes`);
  }

  async createTicketOrder(eventId, { ticket_type_id, email, telefone, metodo = 'mpesa' }) {
    const orderData = await this.request(`/eventos/${eventId}/pedidos`, {
      method: 'POST',
      body: JSON.stringify({ ticket_type_id, email, telefone, metodo, canal: 'online' })
    });

    // Em modo de testes / dev, confirmamos imediatamente via helper real
    if (orderData.pedido && orderData.pedido.id) {
      await this.request('/dev/confirmar-pedido', {
        method: 'POST',
        body: JSON.stringify({ id: orderData.pedido.id })
      }).catch(err => console.warn('Aviso: Dev confirmar-pedido falhou', err));
    }

    return orderData;
  }

  // ==================== BUYER AUTH (PASSWORDLESS OTP) ====================
  async sendBuyerOtp(email) {
    return this.request('/auth/otp', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  async verifyBuyerOtp(email, codigo, dispositivo = 'Navegador Web') {
    const data = await this.request('/auth/otp/verificar', {
      method: 'POST',
      body: JSON.stringify({ email, codigo, dispositivo })
    });
    const token = data.access_token || data.token_acesso;
    if (token) {
      this.buyerToken = token;
      localStorage.setItem('acessoqr_buyer_token', token);
    }
    return data;
  }

  buyerLogout() {
    this.buyerToken = null;
    localStorage.removeItem('acessoqr_buyer_token');
  }

  isBuyerLoggedIn() {
    return Boolean(this.buyerToken);
  }

  async getBuyerProfile() {
    return this.request('/auth/eu', { auth: 'buyer' });
  }

  // ==================== WALLET & ROTATING QR ====================
  async getWalletBalance(walletId) {
    return this.request(`/carteiras/${walletId}`, { auth: 'buyer' });
  }

  async getWalletQR(walletId) {
    return this.request(`/carteiras/${walletId}/qr`, {
      method: 'POST',
      auth: 'buyer'
    });
  }

  async rechargeWallet(walletId, valor, metodo = 'mpesa') {
    const recharge = await this.request(`/carteiras/${walletId}/recargas`, {
      method: 'POST',
      auth: 'buyer',
      body: JSON.stringify({ valor, metodo })
    });

    if (recharge.recarga && recharge.recarga.id) {
      await this.request('/dev/confirmar-recarga', {
        method: 'POST',
        body: JSON.stringify({ id: recharge.recarga.id })
      }).catch(err => console.warn('Aviso dev confirmar-recarga:', err));
    }

    return recharge;
  }

  async requestRefund(walletId, { valor, metodo_destino, destino, codigo }) {
    return this.request(`/carteiras/${walletId}/reembolsos`, {
      method: 'POST',
      auth: 'buyer',
      body: JSON.stringify({ valor, metodo_destino, destino, codigo })
    });
  }

  // ==================== VENDOR POS TERMINAL (DEVICE AUTH) ====================
  async processPosSale(qrToken, valor, clientTxId = null) {
    return this.request('/vendas', {
      method: 'POST',
      auth: 'device',
      body: JSON.stringify({
        qr: qrToken,
        valor: Number(valor),
        client_tx_id: clientTxId || ('cl-tx-' + Math.random().toString(36).substring(2, 9))
      })
    });
  }

  async processReversal(transacaoId) {
    return this.request(`/transacoes/${transacaoId}/estorno`, {
      method: 'POST',
      auth: 'device'
    });
  }

  // ==================== GATE TERMINAL (DEVICE AUTH) ====================
  async processGateAdmission(qrToken) {
    return this.request('/entradas', {
      method: 'POST',
      auth: 'device',
      body: JSON.stringify({ qr: qrToken })
    });
  }
}

export const api = new RealApiService();
