import { InvalidOrderDataError } from '../../domain/errors.js';
import { AccountId } from '../../domain/valueObjects/accountId.js';
import type { OrderStatus } from '../../domain/valueObjects/orderStatus.js';
import { orderStatuses } from '../../domain/valueObjects/orderStatus.js';
import type { OrderDao, OrderView } from '../contracts/orderDao.js';

export class GetOrders {
  constructor(private readonly orderDao: OrderDao) {}

  async execute(rawAccountId: string, status?: string): Promise<OrderView[]> {
    const accountId = AccountId.from(rawAccountId).value;
    if (status === undefined) return this.orderDao.listByAccount(accountId);
    const filter = orderStatuses.find((candidate): candidate is OrderStatus => candidate === status);
    if (!filter) throw new InvalidOrderDataError('status', `must be one of ${orderStatuses.join(', ')}`);
    return this.orderDao.listByAccount(accountId, filter);
  }
}
