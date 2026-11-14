# Migração do financeiro para as rotas canônicas do SimIntPay

Hoje o back-ebook fala com a API legada ("API Machine": `API_MACHINE_URL`, header `x-internal-token`,
rotas `/internal/ebook/finance/*`, consulta por `?cpf=`, valores em R$). O SimIntPay está migrando para rotas
canônicas por comerciante (`/platforms/EBOOK/merchants/:externalMerchantId/...`, header `x-access-token`,
valores em centavos). Esta migração é feita por etapas e **atrás de uma flag**.

## Escopo desta etapa

Migrados (somente com a flag ligada), mantendo exatamente o formato de resposta que o frontend recebe hoje (R$):

| Endpoint do back-ebook      | Rota canônica                                                                 |
| --------------------------- | ----------------------------------------------------------------------------- |
| `GET /payments/summary`     | `GET .../finance/summary` (+ campos de taxa ainda vindos do legado, ver abaixo) |
| `GET /payments/withdrawals` | `GET .../finance/withdrawals?page&limit`                                      |
| `POST /payments/withdraw`   | `GET .../finance/summary`, `POST .../finance/withdrawals/quote`, `POST .../finance/withdrawals` |

**Continuam no caminho legado, sem alteração:** transações/histórico, relatórios, configuração, pending-transaction,
credit-commission e o restante de `/internal/ebook/finance/*`.

## Variáveis de ambiente

| Variável                    | Descrição                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `SIMINTPAY_URL`             | Base do SimIntPay (fallback: `API_MACHINE_URL` / `API_MACHINE_INTERNAL_URL`, mesmo host).      |
| `SIMINTPAY_PLATFORM_TOKEN`  | `INBOUND_TOKEN` da plataforma EBOOK, enviado em `x-access-token`. Nunca é logado.              |
| `EBOOK_CANONICAL_FINANCE`   | `true` liga as rotas canônicas acima. Qualquer outro valor/ausente = caminho legado (padrão).  |

Escopos exigidos no INBOUND_TOKEN:

- `merchants:manage` — provisionamento (script `provision:merchants` e auto-provisionamento no cadastro).
- `finance:read` — summary, listagem de saques e quote.
- `finance:withdraw` — criação de saque.

## Como funciona

- `externalMerchantId` = CPF/CNPJ do vendedor, só dígitos (CNPJ válido tem precedência sobre CPF, igual ao `getCpfFromUser`).
- Cliente: `src/common/simintpay-platform.ts`. Mapeamento e idempotência: `src/payments/canonical-finance.ts`.
- **Summary:** centavos -> reais (`availableBalance`, `lockedBalance`, `pendingWithdraws`); `withdrawalFeeBrl` vem de
  `feePolicy.fixedCents`. `minimumWithdrawalAmount`, `pixFeePercent` e `transactionFeeBrl` **ainda não existem no contrato
  canônico** e são lidos do summary legado (best-effort; se o legado falhar, os campos ficam ausentes).
  `TODO(plano "taxas por modalidade")`: remover essa dependência quando o canônico expuser taxas por modalidade.
- **404 "Comerciante não associado"** (ou 400 "conta ativa"): responde `accountExists: false`, e o saldo estimado local
  (`estimatedLocalBalance`) continua funcionando. Saque nesse estado falha com "Nenhuma conta encontrada para este CPF".
- **Saque:** `amount` do frontend é o valor **líquido** que o vendedor quer receber (semântica legada: taxa somada por cima).
  O canônico recebe o **bruto**; ele é calculado pela `feePolicy` do summary (taxa = fixa + bruto × percentual) e conferido
  com `/withdrawals/quote`.
- **Idempotência do saque:** usa `idempotencyKey` do corpo (ou header `Idempotency-Key`) se o frontend enviar. Sem ela, a chave
  é `ebook-` + sha256(usuário | bruto | chave PIX | bucket de 1 minuto): duplo clique/retry no mesmo minuto vira um único saque;
  um saque idêntico e proposital depois do minuto gera nova chave. Recomendado: o frontend enviar uma chave por tentativa de formulário.
- **Paginação:** o canônico limita `limit` a 100 (legado: 200); o back-ebook limita a 100 quando a flag está ligada.

## Provisionamento de comerciantes

O SimIntPay só cria o comerciante (`PUT .../merchants/:id`, idempotente) se **já existir um usuário SimIntPay ativo com esse
CPF/CNPJ**; senão responde 400 "Comerciante exige conta ativa previamente cadastrada".

### Como o CPF chega (ou não) ao usuário SimIntPay

O back-ebook registra o usuário no SimIntPay legado (`syncUserWithApiDom` -> `POST /auth/register`) enviando **apenas
nome, e-mail e senha**. O CPF/CNPJ **não é enviado** em nenhum momento (nem no cadastro, nem em `updateUser`/perfil). Portanto,
o documento só entra no usuário SimIntPay por fora do back-ebook (vínculo/cadastro feito no próprio SimIntPay, ex.: portal do
cliente ou operação), e é isso que hoje permite o legado achar a conta por `?cpf=`.

Consequência: o auto-provisionamento logo após o cadastro **só terá sucesso se a conta SimIntPay já tiver o documento**; no
fluxo atual ele normalmente retornará 400 ("no-account") e será apenas logado. Lacuna a resolver no SimIntPay: aceitar/gravar
o documento no register (o use case do SimIntPay tem `cpf`/`cnpj` opcionais, mas o nome do campo no DTO precisa ser confirmado
antes de o back-ebook enviá-lo) ou expor um endpoint de vínculo de documento.

### Auto-provisionamento (best-effort)

Roda sem bloquear nem falhar o fluxo, apenas se `SIMINTPAY_URL` e `SIMINTPAY_PLATFORM_TOKEN` estiverem definidos (independe
da flag), para papéis ADMIN e USER com CPF/CNPJ válido:

- ao final do registro (`auth.service`) quando há documento;
- na criação de usuário e quando `document` é definido/alterado em `updateUser`.

Erros são logados sem token (apenas status e final do documento).

### Script `provision:merchants`

```
bun run provision:merchants                        # DRY-RUN (padrão): lista, não chama a API
bun run provision:merchants -- --apply             # chama a API
bun run provision:merchants -- --roles=ADMIN --delay-ms=500 --limit=50
```

- Seleciona usuários ativos com CPF/CNPJ de papéis **ADMIN** (donos dos livros; único papel que acessa `/payments`) e **USER**
  (afiliados que recebem comissão na carteira por CPF). **CUSTOMER** é comprador/gestor e não recebe repasse.
- Idempotente: com `--apply`, `GET summary` detecta comerciantes existentes (`already-ok`) e não refaz o PUT (que também
  atualiza o nome do usuário SimIntPay).
- Rate-limit simples (`--delay-ms`, padrão 250 ms), tabela por usuário com documento mascarado, resumo
  (provisioned / already-ok / no-account / invalid-document / errors) e exit code 1 se houver erros.
- Não grava no banco local e não imprime tokens. Precisa de `DATABASE_URL` (leitura) e, com `--apply`, do token com `merchants:manage` + `finance:read`.

## Ordem de rollout

1. Garantir que cada vendedor tenha conta SimIntPay ativa com o mesmo CPF/CNPJ (resolver a lacuna acima; `no-account` no relatório indica quem falta).
2. Rodar `provision:merchants` em **dry-run** e revisar a lista (documentos inválidos, papéis).
3. Definir `SIMINTPAY_URL` e `SIMINTPAY_PLATFORM_TOKEN` (escopos acima) e rodar `provision:merchants -- --apply`; repetir até `no-account=0` e `errors=0`.
4. Fazer deploy com `EBOOK_CANONICAL_FINANCE` ausente/`false` (nenhuma mudança de comportamento) e depois definir `EBOOK_CANONICAL_FINANCE=true`.
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
