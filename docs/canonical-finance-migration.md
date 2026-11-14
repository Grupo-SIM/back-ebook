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
| venda pendente (`checkout.service.notifyPending...`) | `POST finance/entries` `kind: pending` (net calculado com `finance/fees`); erro cai no legado (mesmo `domPaymentId`) |
| config de líquido/taxa fixa (checkout)               | `GET /platforms/EBOOK/finance/config`                                             |
| comissão de afiliado (`commission-delivery.ts`)      | `POST finance/entries` `kind: commission` (afiliado precisa estar provisionado; 404/400 vira RETRY com erro `SimIntPay HTTP n`) |

**Não alterados (sem substituto canônico):** `/admin/transacoes-dom`, `/checkout/ebook-url`, `/auth/*`, `/custom-fees`, conciliação de pedido pago.

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
- **Venda pendente:** `netAmountCents` = bruto − bruto × taxa de processamento da modalidade (PIX ou cartão); a taxa fixa por venda é aplicada pelo SimIntPay na leitura.

## Provisionamento de comerciantes

O SimIntPay só cria o comerciante (`PUT .../merchants/:id`, idempotente) se **já existir um usuário SimIntPay ativo com esse
CPF/CNPJ**; senão responde 400 "Comerciante exige conta ativa previamente cadastrada".

### Como o CPF chega (ou não) ao usuário SimIntPay

O back-ebook registra o usuário no SimIntPay legado (`syncUserWithApiDom` -> `POST /auth/register`) enviando **apenas
nome, e-mail e senha**. O CPF/CNPJ **não é enviado** em nenhum momento (nem no cadastro, nem em `updateUser`/perfil). Portanto,
o documento só entra no usuário SimIntPay por fora do back-ebook (vínculo/cadastro feito no próprio SimIntPay, ex.: portal do
cliente ou operação), e é isso que hoje permite o legado achar a conta por `?cpf=`.

Consequência: o auto-provisionamento logo após o cadastro **só terá sucesso se a conta SimIntPay já tiver o documento**; no
fluxo atual ele normalmente retornará 400 ("no-account") e será apenas logado. **Dependência (em andamento no SimIntPay):** fazer o `PUT /platforms/EBOOK/merchants/:id` criar a conta SimIntPay quando ela ainda
não existir; até lá mantém-se a chamada best-effort e o provisionamento automático no cadastro só funciona para quem já tem conta
com o documento. Lacuna a resolver no SimIntPay: aceitar/gravar
o documento no register (o use case do SimIntPay tem `cpf`/`cnpj` opcionais, mas o nome do campo no DTO precisa ser confirmado
antes de o back-ebook enviá-lo) ou expor um endpoint de vínculo de documento.

### Auto-provisionamento (best-effort)

Roda sem bloquear nem falhar o fluxo, apenas se `SIMINTPAY_URL` e `SIMINTPAY_PLATFORM_TOKEN` estiverem definidos (independe
da flag), para vendedores **e afiliados** (papéis ADMIN e USER) com CPF/CNPJ válido:

- ao final do registro (`auth.service`) quando há documento;
- na criação de usuário e quando `document` é definido/alterado em `updateUser`.

Erros são logados sem token (apenas status e final do documento).

### Script `provision:merchants`

```
bun run provision:merchants                        # DRY-RUN (padrão): lista, não chama a API
bun run provision:merchants -- --apply             # chama a API
bun run provision:merchants -- --roles=ADMIN --delay-ms=500 --limit=50
```

- Seleciona usuários ativos com CPF/CNPJ que sejam **ADMIN** ou **USER** (vendedores e afiliados) **ou** que, em qualquer papel
  (inclusive CUSTOMER), sejam donos de livros ou tenham comissões de afiliado (`affiliate_commissions`). Não se limita a donos de livros.
- Idempotente: com `--apply`, `GET summary` detecta comerciantes existentes (`already-ok`) e não refaz o PUT (que também
  atualiza o nome do usuário SimIntPay).
- Rate-limit simples (`--delay-ms`, padrão 250 ms), tabela por usuário com documento mascarado, resumo
  (provisioned / already-ok / no-account / invalid-document / errors) e exit code 1 se houver erros.
- Não grava no banco local e não imprime tokens. Precisa de `DATABASE_URL` (leitura) e, com `--apply`, do token com `merchants:manage` + `finance:read`.

## Ordem de rollout

1. Garantir que cada vendedor tenha conta SimIntPay ativa com o mesmo CPF/CNPJ (resolver a lacuna acima; `no-account` no relatório indica quem falta).
2. Rodar `provision:merchants` em **dry-run** e revisar a lista (documentos inválidos, papéis).
3. Definir `SIMINTPAY_URL` e `SIMINTPAY_PLATFORM_TOKEN` (escopos acima) e rodar `provision:merchants -- --apply`; repetir até `no-account=0` e `errors=0`.
4. Garantir `ledger:write` no `INBOUND_OPERATIONS` e afiliados provisionados (comissões). Fazer deploy com `EBOOK_CANONICAL_FINANCE` ausente/`false` (nenhuma mudança de comportamento) e depois definir `EBOOK_CANONICAL_FINANCE=true`.
5. Verificar: `GET /payments/summary` (saldo, `accountExists: true`), `GET /payments/withdrawals`, um saque de teste de baixo valor
   e a ausência de erros 4xx/5xx do SimIntPay nos logs.

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
