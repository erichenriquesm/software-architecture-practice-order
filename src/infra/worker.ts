import Fastify from 'fastify';
import { buildOrderCore, serviceName } from './composition.js';
import { createDatabase, PostgresProbe } from './database/postgres.js';
import { registerHealthRoutes } from './http/health.js';
import { classifyOrderFailure } from './messaging/consumers/consumedEvent.js';
import { fundsReservationHandler, fundsReservationQueue } from './messaging/consumers/fundsReservationConsumer.js';
import { matchingResultsHandler, matchingResultsQueue, matchingResultsUnits } from './messaging/consumers/matchingResultsConsumer.js';
import { orderEventsExchange } from './messaging/outboxEventPublisher.js';
import { KyselyIdempotencyStore } from './platform/http/idempotency/idempotencyStore.js';
import type { AmqpConnection } from './platform/messaging/connection.js';
import { connectRabbitMq, rabbitMqUrlFromEnv } from './platform/messaging/connection.js';
import type { ConsumerOptions } from './platform/messaging/consumer.js';
import { Consumer } from './platform/messaging/consumer.js';
import { loadEnvelopeValidator } from './platform/messaging/envelope.js';
import { OutboxRelay } from './platform/messaging/outbox.js';
import { declareConsumerQueue } from './platform/messaging/topology.js';
import { ExpirePendingOrders } from './scheduler/expirePendingOrders.js';
import { durationSetting, healthPortSetting, postgresSettings } from './settings.js';

const outboxLockKey = 7_003;
const purgeIntervalMs = 60 * 60 * 1_000;

const db = createDatabase(postgresSettings());
const pendingTimeoutMs = durationSetting('ORDER_PENDING_TIMEOUT', '2m');
const core = buildOrderCore({ db, pendingTimeoutMs });
const validate = loadEnvelopeValidator();
const log = Fastify({ logger: true }).log;

const consumerOptions: readonly Omit<ConsumerOptions, 'validate' | 'classify'>[] = [
  { definition: fundsReservationQueue, handler: fundsReservationHandler(core) },
  { definition: matchingResultsQueue, handler: matchingResultsHandler(core), units: matchingResultsUnits },
];

const startConsumer = async (connection: AmqpConnection, options: Omit<ConsumerOptions, 'validate' | 'classify'>): Promise<Consumer> => {
  const channel = await connection.createChannel();
  for (const binding of options.definition.bindings) await channel.checkExchange(binding.exchange);
  await declareConsumerQueue(channel, options.definition);
  const consumer = new Consumer(core.runner, channel, { ...options, validate, classify: classifyOrderFailure });
  await consumer.start();
  return consumer;
};

const expirePendingOrders = new ExpirePendingOrders({
  orderDao: core.orderDao,
  expireOrder: core.expireOrder,
  clock: core.clock,
  pendingTimeoutMs,
  intervalMs: durationSetting('EXPIRE_PENDING_ORDERS_INTERVAL', '10s'),
  onError: (orderId, error) => log.warn({ orderId, error: error instanceof Error ? error.message : error }, 'could not expire order'),
});
expirePendingOrders.start();

const idempotencyStore = new KyselyIdempotencyStore(db);
const purge = setInterval(() => void idempotencyStore.purgeExpired(new Date()).catch(() => undefined), purgeIntervalMs);

let connection: AmqpConnection | undefined;
let stopping = false;
let detach = async (): Promise<void> => undefined;

const healthServer = Fastify({ logger: false });
registerHealthRoutes(healthServer, serviceName, [
  new PostgresProbe(db),
  { dependency: 'rabbitmq', isHealthy: async () => connection !== undefined },
]);
await healthServer.listen({ host: '0.0.0.0', port: healthPortSetting() });

const shutdown = async (): Promise<void> => {
  stopping = true;
  clearInterval(purge);
  expirePendingOrders.stop();
  await detach();
  await connection?.close().catch(() => undefined);
  await healthServer.close();
  await db.destroy();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

/** No in-process reconnect: when the broker connection drops the worker exits and the container restarts it (outbox + inbox make it lossless). */
const exitOnBrokerLoss = (reason: unknown): void => {
  if (stopping) return;
  stopping = true;
  connection = undefined;
  log.error({ reason: reason instanceof Error ? reason.message : reason }, 'rabbitmq connection lost, exiting');
  // Exit at once: closing channels on a dead connection can hang, and the outbox + inbox make a hard exit safe.
  process.exit(1);
};

const broker = await connectRabbitMq(rabbitMqUrlFromEnv());
broker.on('error', exitOnBrokerLoss);
broker.on('close', exitOnBrokerLoss);
const relay = new OutboxRelay(db, await broker.createConfirmChannel(), { exchange: orderEventsExchange, lockKey: outboxLockKey });
relay.start();
const consumers = await Promise.all(consumerOptions.map((options) => startConsumer(broker, options)));
detach = async () => {
  relay.stop();
  await Promise.all(consumers.map((consumer) => consumer.stop().catch(() => undefined)));
};
connection = broker;
log.info('rabbitmq connected');
