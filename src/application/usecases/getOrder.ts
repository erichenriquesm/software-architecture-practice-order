import { OrderNotFoundError } from '../../domain/errors.js';
import { AccountId } from '../../domain/valueObjects/accountId.js';
import { OrderId } from '../../domain/valueObjects/orderId.js';
import type { OrderDao, OrderView } from '../contracts/orderDao.js';

/** An order of another account is not found either, so its existence is never revealed. */
export class GetOrder {
  constructor(private readonly orderDao: OrderDao) {}

  async execute(rawOrderId: string, rawAccountId: string): Promise<OrderView> {
    const orderId = OrderId.from(rawOrderId).value;
    const order = await this.orderDao.findOwnedBy(orderId, AccountId.from(rawAccountId).value);
    if (!order) throw new OrderNotFoundError(orderId);
    return order;
  }
}
