import { OrderId } from '../../domain/valueObjects/orderId.js';
import type { OrderStore } from './orderStore.js';
import { retryOnConflict } from './retryOnConflict.js';

/** Saga S4 compensation: the order was no longer in the book, so the cancel request is undone. */
export class RevertCancelRequest {
  constructor(
    private readonly orderStore: OrderStore,
  ) {}

  async execute(rawOrderId: string): Promise<void> {
    const orderId = OrderId.from(rawOrderId);
    await retryOnConflict(() => this.orderStore.change(orderId, (order) => order.cancelRejected()));
  }
}
