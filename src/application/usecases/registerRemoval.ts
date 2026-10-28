import { InvalidOrderDataError } from '../../domain/errors.js';
import { OrderId } from '../../domain/valueObjects/orderId.js';
import type { RemovalReason } from '../../domain/valueObjects/orderStatus.js';
import { Quantity } from '../../domain/valueObjects/quantity.js';
import type { OrderStore } from './orderStore.js';
import { retryOnConflict } from './retryOnConflict.js';

export interface RegisterRemovalInput {
  readonly orderId: string;
  readonly remainingQuantity: string;
  readonly reason: string;
}

const removalReasons: readonly RemovalReason[] = ['CANCELLED', 'SELF_TRADE_PREVENTION'];

/** Saga S4 (or self-trade prevention): the order left the book with part of it not executed. */
export class RegisterRemoval {
  constructor(private readonly orderStore: OrderStore) {}

  async execute(input: RegisterRemovalInput): Promise<void> {
    const orderId = OrderId.from(input.orderId);
    const remainingQuantity = Quantity.from(input.remainingQuantity);
    const reason = removalReasons.find((candidate) => candidate === input.reason);
    if (!reason) throw new InvalidOrderDataError('reason', `unknown removal ${input.reason}`);
    await retryOnConflict(() => this.orderStore.change(orderId, (order) => order.markRemoved(remainingQuantity, reason)));
  }
}
