import type { ColumnType, Generated } from 'kysely';

type Numeric = ColumnType<string, string, string>;
type NullableNumeric = ColumnType<string | null, string | null, string | null>;
type BigInt = ColumnType<string, number, number>;

export interface Database {
  order: OrderTable;
  outbox: OutboxTable;
  inbox: InboxTable;
  idempotency_key: IdempotencyKeyTable;
}

export interface OrderTable {
  order_id: string;
  market_id: string;
  account_id: string;
  side: string;
  quantity: Numeric;
  price: Numeric;
  fill_quantity: Numeric;
  fill_value: Numeric;
  reservation: string;
  void_reason: string | null;
  reject_reason: string | null;
  removal_reason: string | null;
  cancel_requested: boolean;
  removed_quantity: NullableNumeric;
  /** Derived by the domain on every save, stored only so the reads can filter by it. */
  status: string;
  status_reason: string | null;
  created_at: Date;
  version: BigInt;
}

export interface OutboxTable {
  id: Generated<string>;
  event_id: string;
  type: string;
  routing_key: string;
  envelope: ColumnType<unknown, string, string>;
  created_at: Generated<Date>;
  published_at: Date | null;
}

export interface InboxTable {
  consumer: string;
  message_key: string;
  processed_at: Generated<Date>;
}

export interface IdempotencyKeyTable {
  scope: string;
  key: string;
  request_hash: string;
  state: string;
  status_code: number | null;
  response_body: ColumnType<unknown, string | null, string | null>;
  created_at: Generated<Date>;
  expires_at: Date;
}
