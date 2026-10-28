import { Decimal } from 'decimal.js';
import type { OrderDao, OrderView } from '../../application/contracts/orderDao.js';
import type { OrderStatus } from '../../domain/valueObjects/orderStatus.js';
import type { Database } from './database.js';
import type { KyselyTransactionRunner } from './kyselyTransactionRunner.js';

const columns = [
  'order_id as orderId',
  'account_id as accountId',
  'market_id as marketId',
  'side',
  'quantity',
  'price',
  'fill_quantity as fillQuantity',
  'fill_value as fillValue',
  'created_at as timestamp',
  'status',
  'status_reason as statusReason',
] as const;

/** The only inexact number of the service: the average price, rounded half-even to 8 places for reading. */
export const averagePrice = (fillValue: string, fillQuantity: string): string | null => {
  const quantity = new Decimal(fillQuantity);
  if (quantity.isZero()) return null;
  return new Decimal(fillValue).dividedBy(quantity).toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed(8);
};

type Row = Omit<OrderView, 'timestamp' | 'fillPrice'> & { readonly fillValue: string; readonly timestamp: Date };

const viewOf = ({ fillValue, timestamp, ...row }: Row): OrderView => ({
  orderId: row.orderId,
  accountId: row.accountId,
  marketId: row.marketId,
  side: row.side,
  quantity: row.quantity,
  price: row.price,
  fillQuantity: row.fillQuantity,
  fillPrice: averagePrice(fillValue, row.fillQuantity),
  timestamp: timestamp.toISOString(),
  status: row.status,
  statusReason: row.statusReason,
});

/** Reads the order table directly; the status was derived by the domain and stored on save. */
export class KyselyOrderDao implements OrderDao {
  constructor(private readonly runner: KyselyTransactionRunner<Database>) {}

  async findById(orderId: string): Promise<OrderView | undefined> {
    const row = await this.runner.executor().selectFrom('order').select(columns).where('order_id', '=', orderId).executeTakeFirst();
    return row ? viewOf(row) : undefined;
  }

  async listByAccount(accountId: string, status?: OrderStatus): Promise<OrderView[]> {
    let query = this.runner.executor().selectFrom('order').select(columns).where('account_id', '=', accountId);
    if (status) query = query.where('status', '=', status);
    const rows = await query.orderBy('created_at', 'desc').limit(500).execute();
    return rows.map(viewOf);
  }

  async listPendingCreatedBefore(cutoff: Date): Promise<string[]> {
    const rows = await this.runner
      .executor()
      .selectFrom('order')
      .select('order_id')
      .where('reservation', '=', 'pending')
      .where('created_at', '<', cutoff)
      .orderBy('created_at')
      .limit(100)
      .execute();
    return rows.map((row) => row.order_id);
  }
}
