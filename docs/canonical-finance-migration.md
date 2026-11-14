# Migração do financeiro para as rotas canônicas do SimIntPay

Hoje o back-ebook fala com a API legada ("API Machine": `API_MACHINE_URL`, header `x-internal-token`,
rotas `/internal/ebook/finance/*`, consulta por `?cpf=`, valores em R$). O SimIntPay está migrando para rotas
canônicas por comerciante (`/platforms/EBOOK/merchants/:externalMerchantId/...`, header `x-access-token`,
valores em centavos). Esta migração é feita por etapas e **atrás de uma flag**.

## Escopo

Tudo abaixo só vale com `EBOOK_CANONICAL_FINANCE=true`; o formato de resposta ao frontend continua em R$.

| Fluxo do back-ebook                                  | Rota canônica                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /payments/summary`                              | `finance/summary` (saldo da plataforma EBOOK) + `finance/fees`                    |
| `POST /payments/withdraw/quote` (novo)               | `finance/withdrawals/quote` + `finance/fees`                                      |
| `POST /payments/withdraw`                            | `finance/fees` (mínimo), `quote`, `finance/withdrawals`                           |
| `GET /payments/withdrawals`                          | `finance/withdrawals`                                                             |
| histórico, dashboard, excel, receita mensal          | `finance/transactions` (200 por página, o back-ebook pagina até 5000)             |
| taxas do checkout (`seller-fees.ts`)                 | `finance/fees`; sem comerciante/erro, cai no legado                               |
| venda pendente (`checkout.service.notifyPending...`) | `POST finance/entries` `kind: pending` (sem `netAmountCents`: o líquido é calculado pelo SimIntPay); com a flag ligada não há fallback legado: a falha entra na fila durável `ebook_pending_entry_deliveries` e é reenviada (ver "Entrada pendente: reenvio durável") |
| config de líquido/taxa fixa (checkout)               | `GET /platforms/EBOOK/finance/config`                                             |
| comissão de afiliado (`commission-delivery.ts`)      | `POST finance/entries` `kind: commission` com `orderNumber` (credita a carteira; afiliado precisa estar provisionado; 404/400 vira RETRY com erro `SimIntPay HTTP n`; `skipped: SETTLEMENT_CREDITS_AFFILIATE` = sucesso) |
| confirmação de pedido pago (checkout / relatórios)   | `GET finance/transactions?status=COMPLETED&description=<orderNumber>` (substitui a heurística de `/admin/transacoes-dom`) |
| conta do vendedor/afiliado                           | `PUT /platforms/EBOOK/merchants/:id` com `{cnpj, legalName, email}` (cria a conta SimIntPay se necessário) |

**Removidos (fase 2):** `syncUserWithApiDom` e as rotas `/auth/sync-tokens`, `get-api-dom-tokens` (era pública e devolvia tokens para qualquer e-mail/senha), `force-sync-user`, `force-sync-by-email`, `test-sync`, `test-connection`, `test-custom-fees`; `/admin/tokens*` e `GET /checkout/test/admin-token/:bookId`; o `adminToken` da URL de checkout e do corpo de `/checkout/ebook-url`; `/custom-fees`; `/auth/register`, `/auth/generate-token`, `/auth/list-tokens` (esses três nem existem no SimIntPay: eram de um serviço legado separado).

**Mantidos (sem substituto canônico):** `POST /checkout/ebook-url` (matrícula da liquidação) e o recebimento de recibos (`settlements/receipts`, sentido inverso).

## Variáveis de ambiente

| Variável                    | Descrição                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `SIMINTPAY_URL`             | Base do SimIntPay (fallback: `API_MACHINE_URL` / `API_MACHINE_INTERNAL_URL`, mesmo host).      |
| `SIMINTPAY_PLATFORM_TOKEN`  | `INBOUND_TOKEN` da plataforma EBOOK, enviado em `x-access-token`. Nunca é logado.              |
| `EBOOK_CANONICAL_FINANCE`   | `true` liga as rotas canônicas. Qualquer outro valor/ausente = caminho legado (padrão).        |

`INBOUND_OPERATIONS` do token (no SimIntPay) deve listar explicitamente: `merchants:manage,finance:read,finance:withdraw,ledger:write`.

- `merchants:manage` — provisionamento (script e auto-provisionamento).
- `finance:read` — summary, fees, transactions, config, quote, listagem de saques.
- `finance:withdraw` — criação de saque.
- `ledger:write` — venda pendente e comissão de afiliado.

## Regras

- `externalMerchantId` = CPF/CNPJ só dígitos (CNPJ válido tem precedência, igual ao `getCpfFromUser`).
- **Saldo exibido:** `availableBalanceCents` do summary canônico, já atribuído à plataforma EBOOK (o total do vendedor no EBOOK, não a carteira inteira).
- **Taxas:** `pixFeePercent` = taxa de processamento real (`pix.processingRatePpm / 10000`, ex.: 14,99), não os 6,99 do legado; `transactionFeeBrl` = `transaction.serviceFeeCents / 100`; `withdrawalFeeBrl` e `minimumWithdrawalAmount` vêm de `withdrawal`. Vendedor sem comerciante: `accountExists:false` (saldo estimado local continua) e taxas pela config da plataforma (`liquidityRate` é só aproximação).
- **Saque:** `amount` é o valor **BRUTO** retirado do saldo; a taxa é subtraída (semântica canônica; o legado somava a taxa por cima). Antes de confirmar, o frontend chama `POST /payments/withdraw/quote {amount}` e mostra `{grossAmount, fee, netAmount, minimumWithdrawalAmount}`. O saque valida o mínimo e responde `{success, id, status, grossAmount, fee, amount(líquido)}`.
- **Histórico de saques** (`GET /payments/withdrawals`): cada item traz `grossAmount`, `fee` e `netAmount`; `amount` = líquido (o efetivamente sacado = bruto − taxa).
- **Idempotência do saque:** `idempotencyKey` do corpo (ou header `Idempotency-Key`); sem ela, `ebook-` + sha256(usuário | bruto | chave PIX | bucket de 1 minuto). Recomendado: o frontend enviar uma chave por tentativa de formulário.
- **Transações:** `PAID` é enviado como `COMPLETED`; campos mapeados para o formato legado (`fee` = taxa da plataforma, `dom_fee` = custo da adquirente, `taxa_fixa_transacao`, `amountWithoutAllFee` = `sellerNetCents`). `paymentId` passa a ser o id da transação (a deduplicação com pedidos locais usa o número do pedido na descrição).
- **Venda pendente / comissão:** `amountCents` = o que o comprador pagou (juros incluídos); **nunca** enviamos `netAmountCents` (o SimIntPay calcula o líquido; divergência seria 409 `LEDGER_NET_MISMATCH`). Limitação conhecida: o pedido nasce antes de o comprador escolher PIX/cartão e parcelas no app de checkout, e o `Order` do back-ebook não guarda parcelas nem juros; por isso a entrada pendente sai como `PIX`, `installments: 1`, com o valor do dono (total do pedido menos a comissão do afiliado, como antes, **sem juros**). **Juros do cartão:** são registrados pelo SimIntPay quando o pagamento real é confirmado (webhook DOM que conclui `EBOOK_PENDING_<pedido>`): ele recota o líquido do dono com as parcelas pagas e grava método, parcelas, valor pago e custo dos juros na `Transaction` do vendedor (plano 0026, Fase A4). O back-ebook não precisa enviar método/parcelas (não os conhece) e **não deve** reenviar a entrada com outro valor (mesma referência com valor diferente é 409). **Rateio dos juros:** o juro do comprador pertence ao modelo de taxas/custo da adquirente da faixa, não à base da comissão; a comissão do afiliado continua `valor do pedido × taxa` (sem juros) e o juro é aplicado só sobre a base do dono. Se o SimIntPay não conseguir recotar (faixa indisponível), mantém o líquido PIX gravado (aviso no log).
- **Comissão:** exige `orderNumber`; credita a carteira (`BalanceLog EBOOK_COMMISSION`). Só é enviada para pedidos SEM manifesto de liquidação (`retryCommissionDeliveries` filtra `NOT EXISTS ebook_settlement_manifests` e `prepareSettlement` recusa pedido com comissão legada existente: essa trava impede crédito duplo e deve ser mantida). Se mesmo assim o SimIntPay responder `{skipped: 'SETTLEMENT_CREDITS_AFFILIATE'}`, a entrega é marcada como concluída.

## Provisionamento de comerciantes

O `PUT /platforms/EBOOK/merchants/:id` (idempotente) recebe `{cnpj, legalName, email, adoptByEmail?}` e **cria a conta SimIntPay**
quando nenhuma possui o documento: senha aleatória inutilizável; o titular define a senha por `POST /auth/forgot-password` com o
mesmo e-mail. Resposta: `{id, externalMerchantId, cnpj, legalName, accountCreated}`. `adoptByEmail: true` vincula o documento a uma
conta ativa `USER` **sem documento** que já usa o e-mail (mantém senha e carteira). Conta existente nunca é assumida por e-mail sem
essa opção (409). O back-ebook **nunca** envia `adoptByEmail` automaticamente (o e-mail do cadastro não é verificado).

### Auto-provisionamento (best-effort)

Roda sem bloquear nem falhar o fluxo, apenas se `SIMINTPAY_URL` e `SIMINTPAY_PLATFORM_TOKEN` estiverem definidos (independe da flag),
para vendedores **e afiliados** (papéis ADMIN e USER) com CPF/CNPJ válido **e e-mail**:

- ao final do registro (`auth.service`) quando há documento;
- na criação de usuário (`user.service.createUser`) e quando `document` é definido/alterado em `updateUser`;
- como rede de segurança em `prepareSettlement` (antes de matricular a liquidação, fora da transação): dono e afiliado de cada item.

Erros são logados sem token (apenas status e final do documento).

### Script `provision:merchants`

```
bun run provision:merchants                        # DRY-RUN (padrão): lista, não chama a API
bun run provision:merchants -- --apply             # chama a API (cria contas que faltam)
bun run provision:merchants -- --apply --adopt-by-email   # só se os e-mails forem verificados
bun run provision:merchants -- --roles=ADMIN --delay-ms=500 --limit=50
```

- Seleciona usuários ativos com CPF/CNPJ que sejam **ADMIN** ou **USER** (vendedores e afiliados) **ou** que, em qualquer papel
  (inclusive CUSTOMER), sejam donos de livros ou tenham comissões de afiliado (`affiliate_commissions`).
- `--adopt-by-email` (padrão **desligado**): vincula contas SimIntPay antigas (cadastradas pelo `/auth/register` legado, que não
  enviava documento) pelo e-mail. **Só é seguro quando os e-mails são verificados**; do contrário quem digitou o e-mail de
  outra pessoa reivindicaria a conta. Sem a flag, e-mail já usado por outra conta resulta em erro (409) no relatório.
- Idempotente: com `--apply`, `GET summary` detecta comerciantes existentes (`already-ok`) e não refaz o PUT.
- Rate-limit simples (`--delay-ms`, padrão 250 ms), tabela por usuário com documento mascarado, resumo
  (provisioned / already-ok / no-account / invalid-document / errors) e exit code 1 se houver erros. Usuário sem e-mail é `invalid-document`.
- Não grava no banco local e não imprime tokens. Precisa de `DATABASE_URL` (leitura) e, com `--apply`, do token com `merchants:manage` + `finance:read`.

## Chamadas `API_MACHINE_*` restantes

Com `EBOOK_CANONICAL_FINANCE=true` **e** `SIMINTPAY_URL`/`SIMINTPAY_PLATFORM_TOKEN` definidos, o back-ebook só usa `API_MACHINE_*` em:

1. `POST {API_MACHINE_URL}/checkout/ebook-url` com `x-internal-token` = `API_MACHINE_INTERNAL_TOKEN` (matrícula da liquidação; `checkout.service.buildCheckoutUrl`).
2. Recebimento de recibos de liquidação / webhook `payment-confirmation` (sentido inverso: SimIntPay chama o back-ebook, validado com `API_MACHINE_INTERNAL_TOKEN`/`INTERNAL_SERVICE_TOKEN`/`WEBHOOK_SECRET`; também `internal-stats.controller`).
3. `API_MACHINE_URL` ainda serve de fallback de **base URL** para `SIMINTPAY_URL` (mesmo host); defina `SIMINTPAY_URL` e dispensa isso.

Nenhuma chamada a `/internal/ebook/finance/*`, `/admin/transacoes-dom`, `/auth/*` ou `/custom-fees` sobra com a flag ligada: fallbacks legados de taxas do vendedor, de config da plataforma e de venda pendente só valem com a flag desligada (rollback). Com a flag ligada e falha do SimIntPay, a entrada pendente vai para a fila durável (abaixo); o pedido segue.

## Entrada pendente: reenvio durável

Com a flag ligada, se `POST finance/entries` (`kind: pending`) falhar (rede, 5xx, 4xx, vendedor sem conta), `checkout.service.notifyPendingTransaction` grava uma linha em `ebook_pending_entry_deliveries` (migration aditiva `20261114120000_pending_entry_delivery`, **não aplicada**: aplicar com `prisma migrate deploy` no deploy; sem a tabela o enfileiramento só loga erro e o pedido segue). Uma linha por pedido (`order_number` único, enfileirar de novo é no-op) com o snapshot (valor do dono, documento, comprador). O mesmo timer de 60 s do `AffiliateService` (`retryPendingEntryDeliveries`, padrão de `retryCommissionDeliveries`: lease de 1 min por linha, `FOR UPDATE SKIP LOCKED`) reenvia: sucesso = `ACKNOWLEDGED`; falha = `RETRY` com backoff de 5 min x tentativa (máx. 60 min), até 24 tentativas e então `SKIPPED` (reconciliação manual, `last_error`). Só reenvia enquanto o pedido está `pending`: pedido pago/cancelado vira `SKIPPED` (evita criar uma entrada pendente órfã depois que o webhook já registrou a venda paga). O SimIntPay é idempotente por `EBOOK_PENDING_<pedido>` (reenvio idêntico devolve `created: false`). Sem documento válido do dono ou com a flag desligada nada é enfileirado (caminho legado inalterado).

## Confirmação de pedido pago

`tryReconcileEbookOrderPaid` (checkout) e a listagem de transações locais (`payments.controller`, até 50 pedidos pendentes por consulta)
consultam `GET .../merchants/<dono>/finance/transactions?status=COMPLETED&description=<orderNumber>` e marcam o pedido como pago quando há
transação concluída. Pedidos com **liquidação** não aparecem nessa consulta: são confirmados pelos recibos/webhook (caminho preservado).
Funciona sempre que o SimIntPay está configurado (independe da flag); erro/404 = não confirma (oportunista).

## Tokens de admin (`admin_tokens`)

O código não lê nem grava mais `admin_tokens` (nem `adminToken` na URL/corpo do checkout). O app de checkout só usa `adminToken` em
fluxos de link de pagamento/planos/cupom (pagatg); o checkout de ebook (`store=ebook`) paga cartão por endpoint próprio sem `x-access-token`,
então a ausência do parâmetro é segura (o SimIntPay trata `adminToken` como opcional). **A tabela `admin_tokens` e o model Prisma
`AdminToken` foram mantidos** (sem migração destrutiva); podem ser removidos depois em migração própria. O front admin-ebook
(`src/services/api/admin/tokens.ts`) chamava `/admin/tokens*` e deve parar de usar.

## Ordem de rollout

1. Confirmar `INBOUND_OPERATIONS=merchants:manage,finance:read,finance:withdraw,ledger:write` no token da plataforma EBOOK (SimIntPay).
2. Rodar `provision:merchants` em **dry-run** e revisar a lista (documentos inválidos, usuários sem e-mail, papéis).
3. Definir `SIMINTPAY_URL` e `SIMINTPAY_PLATFORM_TOKEN` e rodar `provision:merchants -- --apply` (cria as contas que faltam; os titulares definem a senha por "esqueci minha senha"). Só use `--adopt-by-email` se os e-mails forem verificados. Repetir até `errors=0`.
4. Deploy com `EBOOK_CANONICAL_FINANCE` ausente/`false` (sem mudança de comportamento financeiro) e depois `EBOOK_CANONICAL_FINANCE=true`.
5. Verificar: `GET /payments/summary` (saldo, `accountExists: true`), `GET /payments/withdrawals`, um saque de teste de baixo valor, uma venda PIX (entrada pendente criada e concluída), uma comissão sem liquidação (saldo do afiliado) e a ausência de 4xx/5xx do SimIntPay e de chamadas legadas nos logs.
6. Avisar o admin-ebook para remover o uso de `/admin/tokens*` e as telas de token.

## O que ainda resta

- Juros do cartão na entrada pendente: resolvidos no SimIntPay ao confirmar o pagamento (ver "Venda pendente / comissão"); pendente de decisão do dono: o checkout do SimIntPay (`/checkout/card|pix`) cria uma `Transaction` própria do dono da plataforma em vez de reaproveitar a entrada pendente (plano 0026, Fase A4).
- Remover a tabela `admin_tokens` / model `AdminToken` (migração própria, fora desta etapa).
- Remover `API_MACHINE_*` do deploy depois que `/checkout/ebook-url` e os recibos migrarem para rota canônica (hoje não existe).
- Comissões legadas já gravadas sem crédito (record-only): decisão de backfill é do SimIntPay/dono.
- Teste ponta a ponta contra o SimIntPay local.

## Rollback

Desligar a flag (`EBOOK_CANONICAL_FINANCE=false` ou remover a variável) e reiniciar: os três endpoints voltam imediatamente ao
caminho legado. Comerciantes provisionados e saques já criados no canônico permanecem no SimIntPay (aparecem na carteira do
usuário e, conforme o SimIntPay, no legado). O provisionamento é idempotente e pode ser repetido.

## Riscos conhecidos

- O saldo canônico é da carteira do usuário SimIntPay (`walletScope: merchant-user`), não escopado à plataforma EBOOK como
  o saldo legado; pode divergir se o usuário tiver outras plataformas. O saldo escopado por plataforma está sendo adicionado
  ao contrato do SimIntPay (não depender dele ainda).
- `pendingWithdraws` canônico é o bruto pendente da plataforma; o legado devolvia o líquido.
- A mudança de semântica do saque (bruto em vez de líquido) exige o frontend mostrar a cotação (`/payments/withdraw/quote`) antes de confirmar.
- `paymentMethod` de lançamentos só aceita PIX/CREDIT_CARD; parcelas de cartão usam a taxa da modalidade à vista (installments=1).
