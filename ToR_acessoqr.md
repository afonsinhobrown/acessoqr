# Termo de Referência: acessoqr
Sistema de pagamentos sem numerário para eventos, com carteira ligada a QR

Versão 1.0 · Documento de trabalho. Os valores marcados **[a validar]** são propostas que precisam de confirmação antes da implementação.

---

## 1. Objectivo

Permitir que um evento funcione sem dinheiro físico no recinto. Cada participante tem uma carteira digital associada a um QR. Compra bilhete, recarrega saldo, consome em bares e barracas e entra na porta, tudo com o mesmo QR. No fim do evento, o saldo não usado é reembolsado ou transferido para o próximo evento, conforme a política do organizador.

## 2. Âmbito

**Dentro do âmbito**
- Venda de bilhetes online e presencial.
- Carteira por bilhete, com saldo recarregável.
- Recarga por M-Pesa, e-Mola, mKesh, cartão e dinheiro no ponto de recarga.
- Vendas nos pontos de venda, com e sem ligação à internet.
- Controlo de acesso na porta, com contagem de lotação.
- Estornos de consumos.
- Reembolso do saldo no fim do evento.
- Painel do organizador com relatórios em tempo real e conciliação.

**Fora do âmbito desta versão**
- Transferência de saldo entre pessoas.
- Cartões físicos NFC (pode ser fase posterior).
- Emissão de facturas fiscais. O sistema deve exportar dados para o software de facturação do organizador.
- Gestão de stock dos produtos vendidos.

## 3. Glossário

| Termo | Significado |
|---|---|
| Carteira (wallet) | Conta de saldo ligada a um bilhete. É o que o QR representa. |
| Bilhete (ticket) | Direito de entrada no evento. Cada bilhete tem exactamente uma carteira. |
| Pedido (ticket order) | Compra de um bilhete. Só se torna bilhete depois de o pagamento ser confirmado. |
| Recarga | Entrada de dinheiro na carteira, sempre após pagamento confirmado. |
| Movimento (transaction) | Registo imutável de qualquer alteração de saldo. |
| Estorno | Movimento novo que anula um movimento anterior. Nunca se apaga nem se altera o original. |
| Ponto de venda | Local com vendedores (bar, barraca). |
| Dispositivo | Telemóvel ou leitor autorizado a ler QR (vendedor ou porta). |
| Modo offline | Funcionamento sem rede, com saldo em cache e sincronização posterior. |

## 4. Actores e perfis

| Actor | O que faz |
|---|---|
| Comprador | Compra bilhete, recarrega, consulta saldo e histórico, pede reembolso. |
| Vendedor | Lê o QR, introduz valor, debita. Fecha o dia no seu ponto de venda. |
| Porta | Lê o QR à entrada. Admite ou recusa. |
| Organizador | Cria eventos e bilhetes, gere vendedores e pontos, vê relatórios, aprova reembolsos, faz conciliação. |
| Gestor de caixa | Recebe o dinheiro físico das recargas presenciais e fecha o caixa. Pode ser o próprio organizador. |
| Prestador de pagamentos | Processa M-Pesa, e-Mola, mKesh e cartão. Envia confirmações por webhook. |
| Sistema | Executa sincronizações, expirações e alertas. |

## 5. Requisitos funcionais

### 5.1 Eventos e bilhetes (módulo do organizador)
- **RF-01** Criar evento com nome, local, data de início e fim, moeda e saldo máximo por carteira.
- **RF-02** Criar tipos de bilhete com nome, preço, carga inicial e limite de vendas. O preço e a carga inicial podem ser diferentes.
- **RF-03** Publicar, cancelar e encerrar um evento. Um evento encerrado não aceita novas vendas nem recargas.
- **RF-04** Criar pontos de venda e vendedores, e associar cada vendedor a um ponto.
- **RF-05** Registar dispositivos (vendedor ou porta) e revogar um dispositivo sem apagar o seu histórico.

### 5.2 Compra de bilhete
- **RF-10** O comprador escolhe o tipo de bilhete e indica email ou telemóvel. Pelo menos um é obrigatório na compra online.
- **RF-11** O sistema cria um pedido pendente e inicia o pagamento no prestador escolhido.
- **RF-12** Quando o prestador confirma o pagamento, o sistema cria a carteira, o bilhete e aplica a carga inicial, numa única transacção.
- **RF-13** O QR do bilhete é enviado por email ou SMS, com um link de acesso à carteira.
- **RF-14** A confirmação de um pedido é idempotente. Confirmar duas vezes o mesmo pedido não cria dois bilhetes nem duas cargas.
- **RF-15** Compra presencial: o gestor de caixa regista o pedido com método `dinheiro`, e o sistema gera o bilhete só depois de o gestor confirmar o recebimento no painel autenticado.

### 5.3 Recarga
- **RF-20** O comprador ou o titular do link escolhe um valor e um método. O valor é positivo e não pode exceder o saldo máximo do evento.
- **RF-21** O saldo só aumenta depois da confirmação do prestador (webhook) ou da confirmação do gestor de caixa (presencial).
- **RF-22** Uma recarga confirmada duas vezes credita uma só vez.
- **RF-23** Uma recarga falhada ou expirada não altera o saldo e fica registada.
- **RF-24** Recarga em ponto presencial: o gestor de caixa confirma o valor recebido em dinheiro e o sistema credita a carteira.

### 5.4 Vendas
- **RF-30** O vendedor lê o QR, o sistema mostra o nome do evento e o saldo disponível, e o vendedor introduz o valor.
- **RF-31** Uma venda só é aceite se o saldo for suficiente. Não existe saldo negativo.
- **RF-32** Cada venda cria um movimento com o vendedor, o ponto e o dispositivo que a fez.
- **RF-33** Uma venda não pode ser feita se a carteira estiver bloqueada ou o evento estiver encerrado.
- **RF-34** O vendedor pode consultar as últimas vendas do seu dispositivo.

### 5.5 Modo offline
- **RF-40** O dispositivo do vendedor guarda o saldo em cache para cada QR que leu, com a hora da última actualização.
- **RF-41** Em modo offline, uma venda é aceite se couber no limite de risco (ver secção 8) e no saldo em cache.
- **RF-42** Cada venda offline recebe um identificador gerado no dispositivo (`client_tx_id`). O servidor usa-o para não aplicar a mesma venda duas vezes.
- **RF-43** Ao voltar a ligação, as vendas em fila são enviadas por ordem de criação.
- **RF-44** Uma venda sincronizada que já não tem saldo vai para a lista de rejeições. Fica visível no painel do organizador para resolução manual.
- **RF-45** O vendedor vê o estado de cada venda: sincronizada, pendente, rejeitada.

### 5.6 Entrada na porta
- **RF-50** O leitor da porta lê o QR e recebe um de quatro resultados: admitido, recusado por duplicado, recusado por bilhete anulado ou QR inválido.
- **RF-51** Um bilhete só pode ser admitido uma vez, mesmo com dois leitores a ler ao mesmo tempo.
- **RF-52** Cada leitura, admitida ou recusada, fica registada.
- **RF-53** O painel mostra a lotação em tempo real por evento.

### 5.7 Estornos
- **RF-60** O estorno só se aplica a consumos (vendas). Não se estornam recargas nem cargas iniciais, excepto por acção do organizador com justificação.
- **RF-61** Um estorno cria um movimento novo do tipo `estorno` que aponta ao movimento original.
- **RF-62** Um movimento só pode ser estornado uma vez.
- **RF-63** O estorno fica registado com o utilizador que o autorizou.

### 5.8 Reembolso do saldo no fim do evento
- **RF-70** O titular pede o reembolso do saldo, indica o método de destino (M-Pesa, e-Mola, mKesh ou banco) e confirma com OTP.
- **RF-71** O organizador aprova ou recusa. O valor aprovado nunca excede o saldo da carteira no momento do pedido.
- **RF-72** Depois de aprovado, o saldo é debitado com um movimento do tipo `reembolso` e o pagamento é enviado ao destino.
- **RF-73** Os reembolsos só ficam disponíveis depois do fim do evento, ou quando o organizador os activar antes.
- **RF-74** O número de destino é guardado cifrado.

### 5.9 Painel do organizador
- **RF-80** Relatório de vendas em tempo real por ponto, vendedor, tipo de bilhete e hora.
- **RF-81** Relatório de recargas por método e estado.
- **RF-82** Conciliação: total de recargas confirmadas, total de saldo em carteiras, total de vendas e total de reembolsos. Os quatro valores têm de bater certo.
- **RF-83** Lista de rejeições de sincronização e de estornos, com acção de resolução.
- **RF-84** Exportação em CSV e XLSX de todos os relatórios.
- **RF-85** Registo de auditoria de todas as acções do organizador.

### 5.10 Área do comprador
- **RF-90** Ver saldo, histórico de movimentos e o QR activo.
- **RF-91** Recarregar a partir da própria página.
- **RF-92** Pedir reembolso (fase de reembolsos).
- **RF-93** Ver as carteiras ligadas à sua conta, se tiver conta.

## 6. Regras de negócio

- **RN-01** O saldo nunca fica negativo. A regra está garantida na base de dados.
- **RN-02** Nenhum saldo muda sem um movimento correspondente. O saldo da carteira é apenas um cache do último movimento.
- **RN-03** A tabela de movimentos é imutável. Não se faz UPDATE nem DELETE. Erros corrigem-se com estorno ou ajuste.
- **RN-04** Nenhum endpoint de cliente credita saldo. Só o webhook do prestador, o gestor de caixa autenticado ou um ajuste do organizador podem fazê-lo.
- **RN-05** Um pedido, uma recarga, uma venda offline e um estorno têm uma chave de idempotência. Repetir a operação não a aplica outra vez.
- **RN-06** Um bilhete tem uma só admissão.
- **RN-07** O saldo máximo por carteira é definido pelo evento. **[a validar: sugestão 50.000 MZN]**
- **RN-08** Um evento encerrado não aceita vendas, recargas nem novas compras.
- **RN-09** A carga inicial é creditada uma única vez, na confirmação do pedido.
- **RN-10** Se uma recarga for paga e o evento tiver sido cancelado, o valor entra no reembolso e não é perdido.

## 7. Modelo de dados

O esquema completo está em **schema.sql**, neste pacote. Resumo das tabelas:

| Tabela | Finalidade |
|---|---|
| organizers | Organizador do evento. |
| events | Evento, com datas, moeda e saldo máximo. |
| ticket_types | Tipos de bilhete, com preço e carga inicial. |
| ticket_orders | Pedidos de compra, desde pendente até pago. |
| wallets | Carteira de saldo, com cache do saldo e número de versão. |
| tickets | Bilhete, com uma carteira e um estado (por usar, admitido, anulado). |
| wallet_contacts | Email ou telefone ligado à carteira, com data de verificação. |
| accounts | Conta opcional do comprador. |
| account_wallets | Liga uma conta às carteiras que lhe pertencem. |
| auth_challenges | Códigos OTP e magic links, sempre guardados como hash. |
| wallet_access_links | Links de acesso rápido à carteira, sem permissão de reembolso. |
| devices | Dispositivos autorizados (vendedor ou porta). |
| sales_points | Pontos de venda do evento. |
| sellers | Vendedores associados a um ponto. |
| recharges | Pedidos de recarga, com estado e referência do prestador. |
| transactions | Ledger imutável de todos os movimentos. |
| entry_scans | Registo de cada leitura na porta. |
| refund_requests | Pedidos de reembolso, com OTP e destino cifrado. |
| sync_rejections | Vendas offline rejeitadas na sincronização. |
| audit_log | Registo de acções administrativas e sensíveis. |

**Funções críticas na base de dados**
- `aplicar_movimento(...)` é o único ponto de escrita de saldo. Actualiza a carteira e cria o movimento na mesma transacção.
- `bloquear_alteracoes()` impede alterações ao ledger, através de um trigger.

## 8. Modo offline e limites de risco

**Princípios**
- Nenhuma venda offline é aceite sem limite de risco.
- O servidor tem a palavra final. A aceitação offline é uma previsão, não uma garantia.

**Limites propostos [a validar]**
- Por venda: máximo 2.000 MZN.
- Por dispositivo, enquanto offline: máximo 20.000 MZN acumulados.
- Duração máxima offline antes de exigir sincronização: 4 horas.
- Saldo em cache máximo por carteira lida offline: igual ao saldo, nunca acima.
- Cada dispositivo tem uma chave própria para assinar as suas vendas.

**Sincronização**
1. Ao reconectar, o dispositivo envia as vendas pendentes em lotes, por ordem de criação.
2. O servidor aplica cada venda com `client_tx_id`. Se já existir, ignora e confirma.
3. Se o saldo não chegar, a venda vai para `sync_rejections` com o motivo.
4. O dispositivo recebe o resultado de cada venda e actualiza o estado.

**Risco aceite**
O organizador aceita que, em caso de rejeição, o vendedor já entregou o produto. O sistema regista a perda para o organizador resolver, em vez de a esconder.

## 9. Segurança e autenticação

**Acesso do comprador**
- Sem palavra-passe. Acesso por código OTP de 6 dígitos (SMS ou WhatsApp) ou magic link por email.
- Validade de 10 minutos e uso único.
- O código é guardado apenas como hash.
- Máximo 5 tentativas por código. Máximo 3 envios por contacto a cada 15 minutos. Máximo 10 envios por IP a cada hora.
- Sessão curta (JWT de 15 minutos com refresh token de 30 dias, revogável por dispositivo).

**Acções sensíveis** (reembolso, mudar contacto, fundir carteiras) pedem novo OTP, mesmo com sessão activa.

**QR rotativo** (fase 1)
- O QR não contém o ID da carteira. Contém um token com validade de 30 a 60 segundos, assinado pelo servidor.
- O token inclui a carteira, o evento e a hora de emissão. A assinatura é verificada pelo leitor.
- Em modo offline, o leitor verifica a assinatura com uma chave pública já instalada e aceita o token dentro de uma janela de tolerância.
- PIN opcional para valores acima de **[a validar: 1.000 MZN]**.

**Autenticação do organizador e dos dispositivos**
- Login do organizador com email e palavra-passe, mais segundo factor.
- Dispositivos de vendedor e porta são emparelhados pelo painel com um código de uso único e recebem uma chave própria.

**Protecção de dados**
- Dados pessoais limitados ao necessário: email ou telemóvel, nome do evento e histórico de movimentos.
- Destino de reembolso cifrado na aplicação, nunca em claro na base de dados.
- Registo de auditoria para todas as acções administrativas.
- Retenção: dados de movimentos guardados pelo prazo fiscal aplicável. Dados pessoais eliminados ou anonimizados após **[a validar: 12 meses]** do fim do evento, salvo obrigação legal.

**Rede e aplicação**
- HTTPS obrigatório. Cabeçalhos de segurança padrão.
- Rate limiting em todas as rotas públicas.
- Segredos sempre em variáveis de ambiente, nunca no código.
- A string de ligação à base de dados deve ser rodada periodicamente.

## 10. Pagamentos e integrações

**Prestadores previstos:** M-Pesa, e-Mola, mKesh e cartão (através de um agregador ou prestador de pagamentos com licença).

**Requisitos de cada integração**
- Iniciar um pagamento com referência ao pedido ou à recarga.
- Receber confirmação por webhook com assinatura verificável.
- Consultar o estado de um pagamento quando o webhook não chega (job de reconciliação a cada 5 minutos para pagamentos pendentes há mais de 10 minutos).
- Reembolsar um pagamento para o destino indicado.

**Trabalho a fazer por integração:** ler a documentação oficial do prestador, obter credenciais de sandbox, implementar o fluxo completo em sandbox e só depois passar a produção. Não está assumido aqui nenhum detalhe técnico de API destes prestadores; deve ser confirmado na documentação de cada um.

**Webhook interno:** a assinatura usa HMAC-SHA256 com segredo partilhado, com verificação em tempo constante. Cada prestador tem o seu método, que deve ser adaptado.

**Email e SMS:** serviço transaccional com registo de entregas. Os envios OTP têm prioridade e não partilham fila com marketing.

## 11. Requisitos não funcionais

| Área | Requisito |
|---|---|
| Disponibilidade | 99,5% fora do período do evento. Durante o evento, o sistema de vendas e porta não pode ficar indisponível. |
| Desempenho | Venda ou admissão em menos de 1 segundo, com 95% das operações abaixo de 500 ms, em carga de pico. |
| Concorrência | Suportar pelo menos 200 vendas por minuto e 100 admissões por minuto por evento, sem dupla aplicação. |
| Escala de referência | Evento de 20.000 participantes, 100 pontos de venda, 30 portas. **[a validar]** |
| Offline | Vendedores e porta funcionam sem rede durante pelo menos 4 horas. |
| Integridade | Zero diferenças entre movimentos e saldos. Verificação automática diária. |
| Auditoria | Toda a acção administrativa e financeira é registada com actor, hora e alvo. |
| Recuperação | Cópias de segurança diárias com retenção de 30 dias. Teste de restauro antes de cada evento grande. |
| Acessibilidade | Interface do comprador usável em telemóveis Android de gama baixa, com ecrã de 5 polegadas. |
| Idioma | Português de Moçambique. |
| Moeda | Metical (MZN), com valores em centavos (inteiros). |

## 12. Aspectos legais e fiscais

Este documento não é aconselhamento jurídico. Os pontos abaixo têm de ser validados com advogado e contabilista antes de qualquer operação real.

- **Licenciamento:** guardar fundos de terceiros pode exigir autorização do Banco de Moçambique. A opção de menor risco é que o dinheiro passe sempre por contas de liquidação de um prestador licenciado, e que o sistema só registe saldos e movimentos.
- **Fundos não utilizados:** definir quem é o titular do saldo não usado e como é devolvido.
- **Impostos:** IVA sobre vendas, retenções e facturação. O sistema deve exportar dados suficientes para o organizador facturar.
- **Termos e condições:** a política de reembolsos, o prazo para pedir reembolso e a responsabilidade por saldo perdido devem estar escritos e aceites pelo comprador antes da compra.
- **Protecção de dados pessoais:** verificar as obrigações aplicáveis em Moçambique e a necessidade de consentimento para comunicações.

## 13. Stack e arquitectura

**Backend:** Node.js 20 com Express e `pg`. Implementado no pacote `acessoqr-api.zip`, que serve de ponto de partida.

**Base de dados:** PostgreSQL no Neon, base `acessoqr`. Lógica crítica de saldo em funções SQL, para que a regra fique garantida mesmo que a aplicação falhe.

**Frontend:**
- Área do comprador: aplicação web responsiva.
- Vendedor e porta: PWA com cache offline (IndexedDB) e leitura de QR pela câmara.
- Painel do organizador: aplicação web com tabelas, filtros e exportação.

**Tempo real:** WebSockets ou actualização por intervalo curto para saldo e lotação. Não é crítico para a correcção do saldo, que está sempre na base de dados.

**Filas:** tarefas de sincronização, envio de emails e reconciliação com pagamentos pendentes.

**Alojamento:** backend num serviço com HTTPS e suporte a processos de longa duração. Base de dados no Neon. Armazenamento de ficheiros exportados com acesso por link temporário.

**Ambientes:** desenvolvimento (branch de laboratório no Neon), homologação (branch de teste com dados sintéticos), produção (branch Default).

## 14. Testes

**Testes unitários e de integração** (já incluídos no pacote, em `test/`):
- Pedido pago cria carteira, bilhete e carga, e webhook repetido não duplica.
- Recarga confirmada duas vezes credita uma só vez.
- Venda acima do saldo é recusada e o saldo não muda.
- Venda offline repetida não é aplicada duas vezes.
- Estorno devolve o valor uma única vez.
- Bilhete só entra uma vez.

**Testes a acrescentar:**
- Cada regra de RN-01 a RN-10, com casos limite.
- Sincronização offline com lotes grandes, interrupções e ordem trocada.
- Dois leitores de porta a ler o mesmo QR ao mesmo tempo.
- Webhook com assinatura inválida, repetido, fora de ordem ou para um pedido inexistente.
- Reembolso acima do saldo e com OTP expirado.

**Testes de carga:** simular o pico do evento de referência (secção 11) em homologação, com vendas, admissões e sincronizações em simultâneo.

**Teste de conciliação:** no fim de cada simulação, verificar que a soma das recargas menos as vendas menos os reembolsos é igual à soma dos saldos das carteiras.

**Teste de restauro:** restaurar a cópia de segurança num ambiente vazio e comparar a conciliação.

## 15. Fases de entrega

Cada fase tem critérios de aceitação. Só se avança quando os critérios da fase anterior estão cumpridos.

**Fase 0: Fundação** (já feita em grande parte)
- Esquema da base de dados aplicado e testado.
- Núcleo de API com testes de integração.
- Critério: testes passam no branch de laboratório.

**Fase 1: Identidade e QR**
- Login por OTP e magic link.
- QR rotativo com assinatura e validação.
- Substituição do `wallet_id` exposto nas rotas de vendedor e porta.
- Critério: nenhuma rota de vendedor ou porta aceita um ID de carteira em bruto. Um QR copiado e colado após 60 segundos é recusado.

**Fase 2: Pagamentos online**
- Integração com M-Pesa e e-Mola em sandbox.
- Webhook por prestador com verificação de assinatura.
- Reconciliação de pagamentos pendentes.
- Critério: 50 pagamentos de teste em sandbox, com webhooks repetidos e atrasados, resultam em saldo correcto.

**Fase 3: Operação presencial e painel**
- Painel do organizador com vendedores, pontos, dispositivos e relatórios.
- Compra e recarga presenciais com confirmação do gestor de caixa.
- Critério: o gestor consegue fechar o caixa e o total bate certo com a conciliação.

**Fase 4: Vendedor e porta**
- PWA do vendedor com modo offline e fila de sincronização.
- Leitor de porta com contagem de lotação.
- Critério: 4 horas offline, 2.000 vendas, sincronização sem diferenças.

**Fase 5: Reembolsos e comprador**
- Área do comprador completa.
- Pedido de reembolso com OTP, aprovação e pagamento.
- Critério: reembolso de 100 carteiras de teste, com conciliação exacta.

**Fase 6: Piloto**
- Evento pequeno real (até 500 participantes), com monitorização reforçada.
- Critério: zero diferenças na conciliação no fim do evento e relatório de incidentes.

**Fase 7: Produção**
- Evento de referência com a equipa completa de suporte.

## 16. Equipa e responsabilidades

| Função | Responsabilidade |
|---|---|
| Product owner | Decisões de negócio, prioridades, aceitação. |
| Backend | API, regras de negócio, integrações de pagamento. |
| Frontend | Aplicação do comprador, PWA do vendedor e porta, painel. |
| Engenharia de dados | Esquema, funções críticas, conciliação e relatórios. |
| Segurança | Revisão de autenticação, QR, cifragem e dependências. |
| Operações | Preparação de eventos, pontos, dispositivos e suporte no dia. |
| Jurídico e financeiro | Licenciamento, termos, impostos e política de reembolsos. |

## 17. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Falha de rede durante o evento | Alta | Alto | Modo offline com limites e fila de sincronização. |
| Captura e reutilização de QR | Média | Alto | QR rotativo de 30 a 60 segundos, assinado. |
| Dupla aplicação de pagamento ou venda | Média | Alto | Chaves de idempotência e funções de saldo na base de dados. |
| Licenciamento financeiro | Média | Muito alto | Fundos em contas de prestador licenciado. Parecer jurídico antes da fase 2. |
| Atraso das integrações com prestadores | Alta | Médio | Começar a fase 2 cedo, em paralelo com a fase 1. |
| Reclamações sobre reembolsos | Alta | Médio | Política escrita, aceite na compra, e prazo claro. |
| Perda de dados | Baixa | Muito alto | Cópias diárias, teste de restauro e ledger imutável. |
| Vendedor a vender sem registo | Média | Médio | Limites offline, auditoria e relatórios por dispositivo. |
| Fraude por contas de teste em produção | Baixa | Médio | Separação estrita de ambientes e dados sintéticos. |

## 18. Decisões assumidas por omissão

Os valores abaixo são os que o sistema aplica enquanto o product owner não decidir
outra coisa. Ficam configuráveis por organizador no painel (`/organizadores/configuracoes`)
e algumas chaves podem ser sobrepostas por evento (`/organizadores/eventos/:id/configuracoes`).
Valores monetários em centavos; 100 centavos = 1 MZN.

| # | Decisão | Valor por omissão | Configurável |
|---|---|---|---|
| 1 | Limite de uma venda offline | 2.000,00 MZN (`offline_venda_max`) | organizador + evento |
| 1 | Limite acumulado offline por dispositivo | 20.000,00 MZN (`offline_dispositivo_max`) | organizador + evento |
| 1 | Janela offline antes de exigir sincronização | 4 horas (`offline_duracao_horas`) | organizador + evento |
| 2 | Saldo máximo por carteira | 50.000,00 MZN (`saldo_maximo_padrao`) | organizador; o evento pode fixar outro |
| 3 | Retenção de dados pessoais | 12 meses após o fim (`retencao_dados_meses`) | organizador |
| 4 | Prazo para pedir reembolso | 30 dias após o fim (`reembolso_prazo_dias`) | organizador + evento |
| 4 | Taxa de reembolso | 0% (`reembolso_taxa_pct`) | organizador + evento |
| 4 | Reembolso parcial | permitido (`reembolso_parcial`) | organizador + evento |
| 4 | Reembolsos antes do fim | não permitidos (`reembolsos_antes_fim`) | organizador + evento |
| 4 | Valor mínimo de reembolso | 100,00 MZN (`reembolso_minimo`) | organizador + evento |
| 5 | Comissão sobre recarga | 0% (`modelo_receita.comissao_recarga_pct`) | organizador |
| 5 | Comissão sobre venda | 0% (`modelo_receita.comissao_venda_pct`) | organizador |
| 5 | Taxa fixa ao organizador | 0 (`modelo_receita.taxa_fixa_organizador`) | organizador |
| 6 | Saldo não usado | devolvido ao comprador (`saldo_nao_usado=reembolso`) | organizador + evento |
| 7 | Prestador de pagamentos | PaySuite, como agregador (`prestador_pagamentos`) | organizador |
| 8 | Licenciamento | prestador licenciado (`licenciamento`) | organizador |
| 9 | PIN a partir de | 1.000,00 MZN (`pin_limite`) | organizador + evento |
| 10 | Canal de OTP | email (`otp_canal`) | organizador |

Notas:
- Em eventos cancelados, o saldo é sempre devolvido, independentemente de
  `saldo_nao_usado`.
- Se `saldo_nao_usado` for `transita` ou `organizador`, novos pedidos de reembolso
  são recusados com `reembolso_indisponivel`.
- A comissão da plataforma é apenas configurada e exposta nos relatórios; ainda não
  é debitada automaticamente no ledger.

## 19. Critérios de aceitação gerais

O sistema é aceite para operação real quando:
1. Todos os testes automáticos passam em homologação.
2. A conciliação de um evento simulado de referência fecha com diferença zero.
3. O modo offline aguenta 4 horas com pico de vendas, sem perda nem dupla aplicação.
4. Um QR copiado não funciona depois da janela de validade.
5. O webhook de cada prestador foi testado com falhas, repetições e atrasos.
6. Existe plano de cópias de segurança testado.
7. O jurídico validou o modelo de licenciamento e os termos.
8. O organizador consegue exportar todos os relatórios sem apoio técnico.

## 20. Anexos

- **acessoqr-api.zip**: código do núcleo do backend, com testes de integração e README.
- **schema.sql**: esquema completo da base de dados, pronto a aplicar numa base vazia.
