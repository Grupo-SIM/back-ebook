# Combos de Ebook — Design

## Intenção

Permitir que o vendedor venda um conjunto dos seus próprios ebooks por preço único. O cliente compra o combo como um item, recebe todos os ebooks em um e-mail e vê um card de combo na Biblioteca que abre seus livros para leitura ou download.

## Escopo

- `Book` passa a ter `type: SINGLE | COMBO`; os dados comerciais atuais continuam servindo aos dois tipos.
- Um combo tem os mesmos recursos comerciais de um ebook: capa, título, descrição, preço, preço original, categoria, status, destaque, afiliados, taxa de comissão, favoritos, avaliações, carrinho, vendas e relatórios.
- Um combo contém ao menos dois ebooks `SINGLE`, ativos e pertencentes ao mesmo `createdById`.
- A Biblioteca exibe a compra como um card de combo; o clique revela os ebooks recebidos e cada um reutiliza leitura/download existentes.

## Fora de escopo

- Combos com ebooks de outro vendedor.
- Combos dentro de combos.
- Alterar compras históricas de ebooks individuais.

## Abordagens consideradas

1. Entidade `Combo` independente — descartada, pois duplicaria carrinho, afiliados, favoritos, avaliações, catálogo e relatórios.
2. Um único modelo `Book` com `type: SINGLE | COMBO` e relação de itens — escolhida. Reaproveita integralmente os recursos comerciais do ebook e adiciona apenas regras de conteúdo e entrega.

## Modelo e regras de negócio

Adicionar `BookType` e `Book.type`, com padrão `SINGLE`, preservando todos os livros existentes. `BookComboItem` relaciona um `COMBO` a ebooks `SINGLE`, com ordem de exibição e unicidade por par.

Arquivo e leitor são obrigatórios para `SINGLE` e não usados por `COMBO`. Criação/edição bloqueia arquivo no combo, itens repetidos, menos de dois itens, ebook inexistente/inativo, item que seja combo e qualquer item cujo criador não seja o dono do combo.

Carrinho, pedido, preço, favoritos, avaliações, destaque, links de afiliado, comissão, dashboards e relatórios tratam combo como qualquer outro `Book`. A comissão usa o `commissionRate` do combo e incide sobre o preço pago do combo.

Na confirmação de pagamento, o pedido grava uma fotografia imutável dos ebooks internos de cada combo. Ela é a fonte de verdade para Biblioteca, anexos e acesso futuro: editar o combo depois não muda uma compra já paga. A autorização de leitura/download reconhece compra direta ou ebook recebido por essa fotografia.

## Interfaces

No admin, o formulário de livro ganha o seletor “Livro individual”/“Combo”. Combo esconde upload de arquivo e mostra seletor de ebooks próprios e ativos, capa obrigatória e todos os campos comerciais existentes. As listagens exibem e filtram o tipo. Não se exclui ebook individual referenciado por combo ativo.

Catálogo, busca, detalhe e carrinho mostram selo “Combo” e contagem de ebooks. A página de combo mantém compra, favorito, avaliação e afiliado. A Biblioteca mostra o card de combo e, dentro dele, os ebooks fotografados no pedido.

Após pagamento idempotente, os ebooks fotografados de combos são expandidos para a coleta atual de anexos. Cada pedido envia só um e-mail, remove arquivos duplicados e respeita o limite de anexos existente.

## Testes de aceitação

- A migração marca livros existentes como `SINGLE` e preserva seus fluxos atuais.
- Vendedor não pode incluir livro de outro vendedor, inativo, repetido, combo ou menos de dois itens.
- Combo tem link/atribuição de afiliado e comissão próprios, calculados pelo seu preço pago.
- Checkout usa preço do servidor e pagamento pago grava a fotografia do conteúdo.
- Editar combo posterior não altera compra, e-mail ou Biblioteca já entregues.
- Um pedido com avulsos e combos produz um único e-mail, sem anexo duplicado.
- Biblioteca exibe o combo e seus livros podem ser lidos/baixados quando recebidos apenas por ele.
