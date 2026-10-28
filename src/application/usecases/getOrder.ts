import { OrderNotFoundError } from '../../domain/errors.js';
import { OrderId } from '../../domain/valueObjects/orderId.js';
import type { OrderDao, OrderView } from '../contracts/orderDao.js';

export class GetOrder {
  constructor(private readonly orderDao: OrderDao) {}

  async execute(rawOrderId: string): Promise<OrderView> {
    const orderId = OrderId.from(rawOrderId).value;
    const order = await this.orderDao.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    return order;
  }
}
