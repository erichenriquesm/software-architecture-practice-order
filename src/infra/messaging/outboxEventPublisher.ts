import type { EventPublisher } from '../../application/contracts/eventPublisher.js';
import type { DomainEvent } from '../../domain/events/domainEvent.js';
import type { OrderAccepted } from '../../domain/events/orderAccepted.js';
import type { OrderCancelRequested } from '../../domain/events/orderCancelRequested.js';
import type { OrderPlaced } from '../../domain/events/orderPlaced.js';
import type { OrderVoided } from '../../domain/events/orderVoided.js';
import type { Database } from '../database/database.js';
import type { KyselyTransactionRunner } from '../database/kyselyTransactionRunner.js';
import { createEnvelope } from '../platform/messaging/envelope.js';
import { appendToOutbox } from '../platform/messaging/outbox.js';
import type { SchemaValidator } from '../platform/messaging/schemas.js';
import { loadSchemaValidator } from '../platform/messaging/schemas.js';
import { currentCorrelation } from '../platform/observability/correlation.js';

export const orderEventsExchange = 'order.events';

type OrderEvent = OrderPlaced | OrderAccepted | OrderCancelRequested | OrderVoided;

type PublishedType = 'order.placed' | 'order.accepted' | 'order.cancelRequested' | 'order.voided';

interface IntegrationEvent {
  readonly type: PublishedType;
  readonly routingKey: string;
  readonly payload: Record<string, unknown>;
}

const orderPayload = (event: OrderPlaced | OrderAccepted | OrderVoided) => ({
  orderId: event.orderId,
  accountId: event.accountId,
  marketId: event.marketId,
  side: event.side,
  quantity: event.quantity,
  price: event.price,
});

/** Maps a domain event to its published contract (type, routing key and payload). */
const integrationEventOf = (event: OrderEvent): IntegrationEvent => {
  switch (event.type) {
    case 'OrderPlaced':
      return { type: 'order.placed', routingKey: 'order.placed', payload: orderPayload(event) };
    case 'OrderAccepted':
      return {
        type: 'order.accepted',
        routingKey: `order.accepted.${event.marketId}`,
        payload: { ...orderPayload(event), acceptedAt: event.occurredAt.toISOString() },
      };
    case 'OrderCancelRequested':
      return {
        type: 'order.cancelRequested',
        routingKey: `order.cancelRequested.${event.marketId}`,
        payload: { orderId: event.orderId, marketId: event.marketId },
      };
    case 'OrderVoided':
      return { type: 'order.voided', routingKey: 'order.voided', payload: { ...orderPayload(event), reason: event.reason } };
  }
};

const isOrderEvent = (event: DomainEvent): event is OrderEvent =>
  ['OrderPlaced', 'OrderAccepted', 'OrderCancelRequested', 'OrderVoided'].includes(event.type);

const schemaOf = (type: PublishedType) =>
  loadSchemaValidator<Record<string, unknown>>(`src/infra/schemas/published/events/${type}.v1.schema.json`);

/** Writes each domain event as its integration event to the outbox, in the transaction that saved the order. */
export class OutboxEventPublisher implements EventPublisher {
  private readonly validators: Record<PublishedType, SchemaValidator<Record<string, unknown>>> = {
    'order.placed': schemaOf('order.placed'),
    'order.accepted': schemaOf('order.accepted'),
    'order.cancelRequested': schemaOf('order.cancelRequested'),
    'order.voided': schemaOf('order.voided'),
  };

  constructor(private readonly runner: KyselyTransactionRunner<Database>) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) await this.append(event);
  }

  private async append(event: DomainEvent): Promise<void> {
    if (!isOrderEvent(event)) throw new Error(`No integration event for domain event ${event.type}`);
    const { type, routingKey, payload } = integrationEventOf(event);
    const validate = this.validators[type];
    const correlation = currentCorrelation();
    const envelope = createEnvelope(
      { type, version: 1, producer: 'order', correlationId: correlation.correlationId, causationId: correlation.causationId, payload: validate(payload) },
      () => event.occurredAt,
    );
    await appendToOutbox(this.runner.transaction(), { routingKey, envelope });
  }
}
