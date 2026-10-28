import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestDatabase } from '../../../support/database.js';
import { createTestDatabase } from '../../../support/database.js';
import type { OrderCancelRequested } from '../../../../src/domain/events/orderCancelRequested.js';
import type { Database } from '../../../../src/infra/database/database.js';
import { KyselyTransactionRunner } from '../../../../src/infra/database/kyselyTransactionRunner.js';
import { OutboxEventPublisher } from '../../../../src/infra/messaging/outboxEventPublisher.js';

let database: TestDatabase;
let runner: KyselyTransactionRunner<Database>;
let publisher: OutboxEventPublisher;

beforeAll(async () => {
  database = await createTestDatabase();
  runner = new KyselyTransactionRunner(database.db);
  publisher = new OutboxEventPublisher(runner);
});

afterAll(() => database.destroy());

const writeAndPublish = (key: string, orderId: string, fail: boolean) =>
  runner.run(async () => {
    await runner.executor().insertInto('inbox').values({ consumer: 'repository', message_key: key }).execute();
    const event: OrderCancelRequested = { type: 'OrderCancelRequested', occurredAt: new Date(), orderId, marketId: 'BTC-USD' };
    await publisher.publish([event]);
    if (fail) throw new Error('use case failed after publishing');
  });

const writes = async (key: string, orderId: string) => ({
  inbox: await database.db.selectFrom('inbox').select('message_key').where('message_key', '=', key).execute(),
  outbox: await database.db.selectFrom('outbox').select('routing_key').where('envelope', '@>', JSON.stringify({ payload: { orderId } })).execute(),
});

describe('KyselyTransactionRunner with the outbox event publisher', () => {
  test('Should roll back the repository write and the outbox write together when the use case fails', async () => {
    // Given
    const orderId = randomUUID();

    // When
    await expect(writeAndPublish('failed', orderId, true)).rejects.toThrowError('use case failed after publishing');

    // Then
    expect(await writes('failed', orderId)).toEqual({ inbox: [], outbox: [] });
  });

  test('Should commit both writes in one transaction when the use case succeeds', async () => {
    // Given
    const orderId = randomUUID();

    // When
    await writeAndPublish('committed', orderId, false);

    // Then
    expect(await writes('committed', orderId)).toEqual({
      inbox: [{ message_key: 'committed' }],
      outbox: [{ routing_key: 'order.cancelRequested.BTC-USD' }],
    });
  });

  test('Should refuse a domain event that has no integration event', async () => {
    await expect(runner.run(() => publisher.publish([{ type: 'SomethingElse', occurredAt: new Date() }]))).rejects.toThrowError(
      'No integration event for domain event SomethingElse',
    );
  });
});
