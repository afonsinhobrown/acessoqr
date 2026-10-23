# AcessoQR · Frontend Moderno & Completo

Frontend web de alta performance para o ecossistema **AcessoQR** (Sistema de Pagamentos Sem Numerário e Bilheteira Inteligente para eventos em Moçambique).

---

## 🌟 Módulos Implementados

### 1. 🎟️ Vitrine de Eventos & Bilheteira Pública (`/`)
- Apresentação visual imersiva do evento em destaque (*Festival Maputo Sound 2026*).
- Catálogo de Bilhetes (*Geral*, *VIP Frontstage*, *Mesa Lounge 4 Pax*) com destaque para o **saldo de consumo incluído** (Carga Inicial).
- **Checkout Rápido Integrado**:
  - Dados do comprador (Nome, Email, Telemóvel +258).
  - Métodos de pagamento: **M-Pesa** (Vodacom), **e-Mola** (Movitel), **Cartão Visa/Mastercard**, **Dinheiro no Balcão**.
  - Simulação interativa de prompt USSD M-Pesa com aprovação instantânea.
  - Emissão automática do Bilhete Digital com código do bilhete, confirmação de carga inicial e redirecionamento direto para a carteira.

### 2. 💳 Carteira Digital do Participante (`/carteira`)
- **Cartão Virtual Interativo**:
  - Design premium estilo fintech com chip metálico, gradiente escuro, titular, tipo de bilhete e saldo em Meticais (**MT**).
  - Botão de ocultar/mostrar saldo (privacidade em locais públicos).
- **QR Code Rotativo Criptográfico (Ed25519)**:
  - Anel animado SVG com contagem regressiva de **30 segundos**.
  - Rotação automática de token a cada 30 segundos ou por clique manual.
  - Linha de escaneamento laser dinâmica e relógio em tempo real com milissegundos (**proteção anti-printscreen / anti-fraude**).
- **Recarga Express de Saldo**:
  - Atalhos rápidos (+100 MT, +250 MT, +500 MT, +1.000 MT) e valor personalizado.
  - Efeito sonoro sintético de moedas (*Web Audio API*) e confetis de celebração.
- **Extrato & Histórico de Movimentos**:
  - Timeline completa com recargas, débitos em bares/barracas, estornos e entradas no portão.
- **Pedido de Reembolso do Saldo Restante**:
  - Modal com validação OTP para devolução do saldo pós-evento diretamente para conta M-Pesa ou e-Mola.

### 3. 🛒 Terminal de Vendas POS do Vendedor (`/pos`)
- **Painel do Ponto de Venda**:
  - Identificação do ponto (*Bar Central - Balcão Principal*), operador (*Carlos Macuácua*) e dispositivo.
  - Indicador de estado de rede (**🟢 Online** / **🟠 Modo Offline Ativo**).
- **Catálogo Rápido de Produtos**:
  - Itens com preços em Meticais: Cerveja 2M (120 MT), Laurentina Preta (140 MT), Água Vumba (60 MT), Gin Tónico (350 MT), Red Bull (150 MT), Hambúrguer (320 MT), Espetada (280 MT), Combo Festa (700 MT).
- **Teclado Numérico Tátil (Numpad)** para digitação de valores livres.
- **Leitor de QR Code**:
  - Suporte a leitura via câmara do dispositivo ou seletor de simulação instantânea de participantes.
  - Validação em tempo real de saldo disponível antes do débito.
  - Feedback sonoro de caixa registadora (*Web Audio API*).
- **Resiliência e Modo Offline**:
  - Armazenamento em fila local (*IndexedDB / LocalStorage*) com identificador único `client_tx_id` (UUIDv4).
  - Botão de sincronização em lote (*"Sincronizar Vendas"*) ao recuperar a ligação à internet.
- **Histórico do Turno & Estorno Imediato**:
  - Lista das últimas transações do terminal e botão de estorno com confirmação de segurança.

### 4. 🚪 Terminal de Controlo de Acesso & Portaria (`/portaria`)
- **Visor Tático de Portaria**:
  - Visor com mira laser animada e leitor de câmara de vídeo.
  - Simulador de leituras com 1 clique:
    - 🟢 **ADMITIDO**: Ecrã fluorescente verde com sinal sonoro agudo duplo, nome do participante, tipo de bilhete e validação da 1ª entrada.
    - 🔴 **RECUSADO - DUPLICADO**: Ecrã vermelho pulsante com sirene de aviso, indicando o horário exato e o portão onde o bilhete já entrou.
    - 🟡 **RECUSADO - INVÁLIDO**: Alerta de código não reconhecido ou expirado.
- **Medidor de Lotação em Tempo Real**:
  - Barra de progresso e contagem de pessoas no recinto vs capacidade máxima (ex: *1.842 / 3.000 pessoas*).

### 5. 📊 Painel do Organizador & Gestão Financeira (`/organizador`)
- **KPIs Executivos em Tempo Real**:
  - Faturação Global (MT).
  - Saldo Ativo nas Carteiras dos Participantes.
  - Total Consumido nos Bares e Barracas.
  - **Conciliação Financeira Matemática**: `Saldo das Carteiras = Carga Inicial + Recargas - Vendas = 100% Auditado`.
- **Gráficos Visuais Interativos**:
  - Vendas por hora ao longo da noite (com identificação de hora de pico).
  - Divisão percentual dos métodos de pagamento (M-Pesa 68%, e-Mola 22%, Dinheiro 7%, Cartão 3%).
- **Gestão Operacional de Dispositivos (Staff)**:
  - Lista de terminais POS e leitores de porta.
  - Criação de novo dispositivo com emissão de **Código de Pareamento de 6 caracteres** (válido por 15 min) e **QR Code de ativação**.
  - Botão de revogação imediata com 1 clique para dispositivos perdidos.
- **Gestor de Caixa (Dinheiro Vivo)**:
  - Terminal de recargas presenciais em dinheiro físico com crédito instantâneo na carteira digital.
- **Gestão de Reembolsos Pós-Evento**:
  - Lista de pedidos de devolução com botões de aprovação de payout PaySuite ou rejeição com motivo.
- **Ciclo de Vida do Evento**:
  - Transição entre estados: *Rascunho → Publicado → Em Curso → Encerrado*.

---

## 🚀 Como Executar

O servidor de desenvolvimento já se encontra ativo na porta 5173:

```bash
# Na pasta acessoqr-frontend:
npm run dev
```

Aceda no navegador a:
👉 **`http://localhost:5173/`**

Para compilar para produção:
```bash
npm run build
```

---

## 🎨 Design System & Estética
- **Tipografia**: `Plus Jakarta Sans` (interface moderna e limpa), `Outfit` (títulos e branding) e `JetBrains Mono` (valores monetários MT, tokens criptográficos e numpads).
- **Paleta de Cores**: Dark mode profundo (`#070A11`, `#0D1322`), Néon Esmeralda (`#05F292`), Ciano Elétrico (`#06B6D4`), Índigo/Violeta (`#6366F1`), Rosa Alerta (`#F43F5E`) e Âmbar (`#F59E0B`).
- **Áudio Sintetizado**: Sintetizador Web Audio API puro (sem ficheiros `.mp3` pesados, latência zero).
