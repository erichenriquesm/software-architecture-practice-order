# software-architecture-practice-order

Serviço `order` da [plataforma de trading](https://github.com/erichenriquesm/software-architecture-practice) (projeto de prática de arquitetura de software).

Gestão de Ordens: criação e cancelamento de ordens limitadas, máquina de estados e histórico por conta. Dono das sagas de ordem.

## O que faz

Recebe ordens limitadas de compra e venda e pedidos de cancelamento, conduz a saga até a ordem entrar no livro (espera a reserva do `wallet`, expira as que ficam paradas), aplica os fills e mantém o histórico por conta com status sempre derivado.

A especificação completa (modelo, casos de uso, dados, testes) está na spec do serviço: [`sdd/services/order.md`](https://github.com/erichenriquesm/software-architecture-practice/blob/main/sdd/services/order.md). As regras de arquitetura valem para todos os serviços: [`sdd/01-principios.md`](https://github.com/erichenriquesm/software-architecture-practice/blob/main/sdd/01-principios.md).

## Comece por aqui

Uma ordem, de ponta a ponta:

1. `src/infra/http/orderRoutes.ts`: a rota `POST /place_order` recebe a ordem e chama o caso de uso.
2. `src/application/usecases/placeOrder.ts`: valida contra o catálogo do mercado e cria a ordem.
3. `src/domain/entities/order.ts`: a ordem, com a máquina de estados e os eventos.
4. `src/infra/database/kyselyOrderRepository.ts`: grava a ordem (e a visão de leitura) no Postgres.
5. `src/infra/messaging/orderIntegrationEvents.ts`: transforma o evento em `order.placed` e grava no outbox; o worker publica.

Depois, a resposta do `wallet` chega em `src/infra/messaging/consumers/fundsReservationConsumer.ts` (aceita ou rejeita a ordem) e os fills do `matching` em `matchingResultsConsumer.ts`.

## API

| Rota | O que faz |
|---|---|
| `POST /place_order` | `202 { orderId, status: "pending" }` · `422` fora dos filtros do mercado |
| `POST /cancel_order` | `202 { orderId, status }` · `403` não é dono · `409` |
| `GET /accounts/:accountId/orders?status=` | histórico da conta |
| `GET /orders/:orderId` | uma ordem |

**gRPC interno:** Não tem.

## Eventos (RabbitMQ)

- **Publica:** `order.placed`, `order.accepted.<mercado>`, `order.cancelRequested.<mercado>`, `order.voided`
- **Consome:** `wallet.fundsReserved`, `wallet.fundsReservationRejected`, `matching.tradeExecuted`, `matching.orderRemoved`, `matching.orderCancelRejected`

Os contratos ficam em `src/infra/schemas/`: `published/` (este serviço é o dono) e `consumed/` (cópias do que ele consome, conferidas pelo `make check` do repositório guarda-chuva).

## Como rodar

Este serviço roda junto com a plataforma, a partir do [repositório guarda-chuva](https://github.com/erichenriquesm/software-architecture-practice), que tem a infra compartilhada (RabbitMQ, Redis, edge) e clona todos os serviços:

```bash
git clone https://github.com/erichenriquesm/software-architecture-practice.git
cd software-architecture-practice/backend
make clone
make up
```

Containers: `order-api` · `order-worker` (consumers, outbox e job de expiração) · `order-db`. Portas no host (só para depurar): REST 3003 · Postgres 5435.

Dentro da pasta do serviço (`backend/order/`):

| Comando | O que faz |
|---|---|
| `make test` | typecheck, lint, regras de arquitetura, testes de unidade e de integração (tudo em container) |
| `make migrate` · `make migrate-status` · `make migrate-rollback` · `make migration name=...` | migrações no estilo Laravel |
| `make deps` | instala o `node_modules` na sua máquina, só para o editor |

## Estrutura

```
src/
  domain/        regras de negócio (entities, valueObjects, events)
  application/   casos de uso, DTOs e contratos (interfaces)
  infra/         HTTP, mensageria, banco, plataforma técnica, schemas de eventos
test/
  unit/  integration/  fakes/  support/
docker/          Dockerfile e composes (só para ambiente local)
```
