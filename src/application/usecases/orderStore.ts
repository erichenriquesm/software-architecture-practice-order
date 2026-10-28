import type { Order } from '../../domain/entities/order.js';
import { OrderNotFoundError } from '../../domain/errors.js';
import type { OrderId } from '../../domain/valueObjects/orderId.js';
import type { EventPublisher } from '../contracts/eventPublisher.js';
import type { OrderRepository } from '../contracts/orderRepository.js';
import type { TransactionRunner } from '../contracts/transactionRunner.js';

/** The steps every order command shares: load the order, then save it and publish its events atomically. */
export class OrderStore {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly transactionRunner: TransactionRunner,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async load(orderId: OrderId): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId.value);
    return order;
  }

  persist(order: Order): Promise<void> {
    return this.transactionRunner.run(async () => {
      await this.orderRepository.save(order);
      await this.eventPublisher.publish(order.pullEvents());
    });
  }

  /** Load → change → save, reloading when another event changed the same order first. */
  async change(orderId: OrderId, work: (order: Order) => void): Promise<Order> {
    const order = await this.load(orderId);
    work(order);
    await this.persist(order);
    return order;
  }
}
