import type { DomainEvent } from '../../domain/events/domainEvent.js';

/** Delivers the domain events of a saved aggregate; called inside the transaction that saved it. */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
