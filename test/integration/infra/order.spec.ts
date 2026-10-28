import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestDatabase } from '../../support/database.js';
import { createTestDatabase } from '../../support/database.js';
import { fixedClock } from '../../fakes/fixedSystem.js';
import { Order } from '../../../src/domain/entities/order.js';
import { AccountId } from '../../../src/domain/valueObjects/accountId.js';
import { MarketFilters } from '../../../src/domain/valueObjects/marketFilters.js';
import { MarketId } from '../../../src/domain/valueObjects/marketId.js';
import { OrderId } from '../../../src/domain/valueObjects/orderId.js';
import { Price } from '../../../src/domain/valueObjects/price.js';
import { Quantity } from '../../../src/domain/valueObjects/quantity.js';
import { Side } from '../../../src/domain/valueObjects/side.js';
import type { OrderCore } from '../../../src/infra/composition.js';
import { buildOrderApi, buildOrderCore } from '../../../src/infra/composition.js';
import { KyselyOrderRepository } from '../../../src/infra/database/kyselyOrderRepository.js';
import type { RateLimiter } from '../../../src/infra/platform/http/rateLimit/rateLimiter.js';
import { loadEnvelopeValidator } from '../../../src/infra/platform/messaging/envelope.js';
import { loadSchemaValidator } from '../../../src/infra/platform/messaging/schemas.js';
import { createUserTokens } from '../../support/userTokens.js';
import { ExpirePendingOrders } from '../../../src/infra/scheduler/expirePendingOrders.js';

const unlimited: RateLimiter = {
  check: async (check) => ({ allowed: true, remaining: check.policy.limit, resetSeconds: 0, retryAfterSeconds: 0, policy: check.policy }),
};

const tokens = createUserTokens();
let database: TestDatabase;
let app: FastifyInstance;
let core: OrderCore;

beforeAll(async () => {
  database = await createTestDatabase();
  ({ app, core } = buildOrderApi({ db: database.db, rateLimiter: unlimited, userTokenPublicKey: tokens.publicKey }));
});

afterAll(async () => {
  await app.close();
  await database.destroy();
});

const placeOrder = (accountId: string, quantity = '0.01', price = '50000') =>
  app.inject({ method: 'POST', url: '/place_order', headers: tokens.bearer(accountId), payload: { marketId: 'BTC-USD', side: 'buy', quantity, price } });

const getAs = (accountId: string, url: string) => app.inject({ method: 'GET', url, headers: tokens.bearer(accountId) });

const cancelAs = (accountId: string, orderId: string) =>
  app.inject({ method: 'POST', url: '/cancel_order', headers: tokens.bearer(accountId), payload: { orderId } });

const outboxOf = async (orderId: string) =>
  database.db
    .selectFrom('outbox')
    .select(['routing_key', 'envelope'])
    .where(sql<string>`envelope->'payload'->>'orderId'`, '=', orderId)
    .orderBy('id')
    .execute();

describe('POST /place_order and the read model', () => {
  test('Should answer 202 pending, write the order and publish a valid order.placed', async () => {
    // Given
    const accountId = randomUUID();

    // When
    const response = await placeOrder(accountId);

    // Then
    expect(response.statusCode).toBe(202);
    const { orderId, status } = response.json();
    expect(status).toBe('pending');
    const view = await getAs(accountId, `/orders/${orderId}`);
    expect(view.json()).toMatchObject({ orderId, accountId, status: 'pending', quantity: '0.01000000', fillQuantity: '0.00000000', fillPrice: null });
    const [placed] = await outboxOf(orderId);
    expect(placed?.routing_key).toBe('order.placed');
    const envelope = loadEnvelopeValidator()(placed?.envelope);
    expect(loadSchemaValidator('src/infra/schemas/published/events/order.placed.v1.schema.json')(envelope.payload)).toMatchObject({ orderId, accountId });
  });

  test('Should answer 422 for a price off the tick, 404 for an unknown order and filter the list by status', async () => {
    // Given
    const accountId = randomUUID();
    const { orderId } = (await placeOrder(accountId)).json();
    await placeOrder(accountId);
    await core.acceptOrder.execute(orderId);

    // When
    const offTick = await placeOrder(accountId, '0.01', '50000.001');
    const unknown = await getAs(accountId, `/orders/${randomUUID()}`);
    const openOnly = await getAs(accountId, `/accounts/${accountId}/orders?status=open`);
    const all = await getAs(accountId, `/accounts/${accountId}/orders`);

    // Then
    expect([offTick.statusCode, unknown.statusCode]).toEqual([422, 404]);
    expect(openOnly.json().map((order: { orderId: string }) => order.orderId)).toEqual([orderId]);
    expect(all.json()).toHaveLength(2);
  });
});

describe('POST /cancel_order', () => {
  test('Should cancel a pending order at once (order.voided) and refuse another account with 403', async () => {
    // Given
    const accountId = randomUUID();
    const { orderId } = (await placeOrder(accountId)).json();

    // When
    const foreign = await cancelAs(randomUUID(), orderId);
    const own = await cancelAs(accountId, orderId);
    const again = await cancelAs(accountId, orderId);

    // Then
    expect([foreign.statusCode, own.statusCode, again.statusCode]).toEqual([403, 202, 409]);
    expect(own.json()).toEqual({ orderId, status: 'cancelled' });
    expect((await outboxOf(orderId)).map((row) => row.routing_key)).toEqual(['order.placed', 'order.voided']);
  });

  test('Should publish order.accepted before order.cancelRequested, both keyed by market', async () => {
    // Given
    const accountId = randomUUID();
    const { orderId } = (await placeOrder(accountId)).json();
    await core.acceptOrder.execute(orderId);

    // When
    const response = await cancelAs(accountId, orderId);

    // Then
    expect(response.json()).toEqual({ orderId, status: 'cancelling' });
    expect((await outboxOf(orderId)).map((row) => row.routing_key)).toEqual(['order.placed', 'order.accepted.BTC-USD', 'order.cancelRequested.BTC-USD']);
  });
});

describe('User token', () => {
  test('Should answer 401 unauthenticated without a token, and let /health through', async () => {
    // When
    const anonymous = await app.inject({ method: 'POST', url: '/place_order', payload: { marketId: 'BTC-USD', side: 'buy', quantity: '0.01', price: '50000' } });
    const health = await app.inject({ method: 'GET', url: '/health' });

    // Then
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: 'unauthenticated' });
    expect(health.statusCode).toBe(200);
  });

  test.each([
    ['another audience', () => tokens.sign({ sub: randomUUID(), aud: 'wallet' })],
    ['an expired token', () => tokens.sign({ sub: randomUUID(), iat: 1, exp: 61 })],
    ['a bad signature', () => `${tokens.sign({ sub: randomUUID() }).slice(0, -4)}AAAA`],
  ])('Should answer 401 for %s', async (_case, token) => {
    // When
    const response = await app.inject({ method: 'GET', url: `/orders/${randomUUID()}`, headers: { authorization: `Bearer ${token()}` } });

    // Then
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'unauthenticated' });
  });

  test('Should answer 422 when the body still carries an accountId', async () => {
    // Given
    const accountId = randomUUID();

    // When
    const response = await app.inject({
      method: 'POST',
      url: '/place_order',
      headers: tokens.bearer(accountId),
      payload: { marketId: 'BTC-USD', accountId: randomUUID(), side: 'buy', quantity: '0.01', price: '50000' },
    });

    // Then
    expect(response.statusCode).toBe(422);
    expect(await getAs(accountId, `/accounts/${accountId}/orders`).then((list) => list.json())).toEqual([]);
  });

  test("Should answer 403 for another account's list and 404 for another account's order", async () => {
    // Given
    const owner = randomUUID();
    const stranger = randomUUID();
    const { orderId } = (await placeOrder(owner)).json();

    // When
    const list = await getAs(stranger, `/accounts/${owner}/orders`);
    const order = await getAs(stranger, `/orders/${orderId}`);

    // Then
    expect(list.statusCode).toBe(403);
    expect(list.json()).toEqual({ error: 'forbidden' });
    expect(order.statusCode).toBe(404);
    expect(order.json()).toMatchObject({ error: 'orderNotFound' });
  });

  test('Should keep idempotency keys apart per account', async () => {
    // Given
    const headers = { 'idempotency-key': randomUUID() };
    const payload = { marketId: 'BTC-USD', side: 'buy', quantity: '0.01', price: '50000' };
    const [first, second] = [randomUUID(), randomUUID()];

    // When
    const mine = await app.inject({ method: 'POST', url: '/place_order', headers: { ...headers, ...tokens.bearer(first) }, payload });
    const theirs = await app.inject({ method: 'POST', url: '/place_order', headers: { ...headers, ...tokens.bearer(second) }, payload });

    // Then
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
    expect(theirs.json().orderId).not.toBe(mine.json().orderId);
  });
});

describe('Persistence', () => {
  test('Should write nothing when the transaction fails after saving the order', async () => {
    // Given
    const repository = new KyselyOrderRepository(core.runner);
    const order = Order.place({
      orderId: OrderId.from(randomUUID()),
      accountId: AccountId.from(randomUUID()),
      marketId: MarketId.from('BTC-USD'),
      side: Side.from('sell'),
      quantity: Quantity.from('1'),
      price: Price.from('100'),
      filters: new MarketFilters(Price.from('0.01'), Quantity.from('0.00001'), Quantity.from('0.00001'), Quantity.from('5')),
      now: new Date(),
    });
    const orderId = order.snapshot.orderId.value;

    // When
    await expect(
      core.runner.run(async () => {
        await repository.save(order);
        throw new Error('failure after saving');
      }),
    ).rejects.toThrowError('failure after saving');

    // Then
    expect(await database.db.selectFrom('order').select('order_id').where('order_id', '=', orderId).execute()).toEqual([]);
    expect(await core.orderDao.findOwnedBy(orderId, order.snapshot.accountId.value)).toBeUndefined();
  });
});

describe('Saga S2 timeout job', () => {
  test('Should expire pending orders older than the timeout and publish order.voided', async () => {
    // Given
    const accountId = randomUUID();
    const { orderId } = (await placeOrder(accountId)).json();
    const later = buildOrderCore({ db: database.db, clock: fixedClock(new Date(Date.now() + 121_000)), pendingTimeoutMs: 120_000 });
    const job = new ExpirePendingOrders({ orderDao: later.orderDao, expireOrder: later.expireOrder, clock: later.clock, pendingTimeoutMs: 120_000, intervalMs: 1_000 });

    // When
    await job.runOnce();

    // Then
    expect((await core.getOrder.execute(orderId, accountId)).status).toBe('expired');
    expect((await core.getOrder.execute(orderId, accountId)).statusReason).toBe('EXPIRED');
    expect((await outboxOf(orderId)).at(-1)?.routing_key).toBe('order.voided');
  });
});
