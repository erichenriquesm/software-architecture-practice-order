import type { OrderStatus } from '../../domain/valueObjects/orderStatus.js';

export interface OrderView {
  readonly orderId: string;
  readonly accountId: string;
  readonly marketId: string;
  readonly side: string;
  readonly quantity: string;
  readonly price: string;
  readonly fillQuantity: string;
  readonly fillPrice: string | null;
  readonly timestamp: string;
  readonly status: string;
  readonly statusReason: string | null;
}

export interface OrderDao {
  findOwnedBy(orderId: string, accountId: string): Promise<OrderView | undefined>;
  listByAccount(accountId: string, status?: OrderStatus): Promise<OrderView[]>;
  /** Orders still waiting for the wallet that were created before `cutoff` (saga S2 timeout). */
  listPendingCreatedBefore(cutoff: Date): Promise<string[]>;
}
