import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Migration } from '../migrator.js';

/** The order table answers the reads itself: it keeps the derived status, and order_view goes away. */
export default class implements Migration {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('order').addColumn('status', 'text').addColumn('status_reason', 'text').execute();
    await sql`
      update "order" set status = order_view.status, status_reason = order_view.status_reason
      from order_view where order_view.order_id = "order".order_id`.execute(db);
    await db.schema.alterTable('order').alterColumn('status', (column) => column.setNotNull()).execute();
    await db.schema
      .createIndex('order_account')
      .on('order')
      .columns(['account_id', 'status', 'created_at desc'])
      .execute();
    await db.schema.dropTable('order_view').execute();
  }

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('order_view')
      .addColumn('order_id', 'uuid', (column) => column.primaryKey())
      .addColumn('account_id', 'uuid', (column) => column.notNull())
      .addColumn('market_id', 'text', (column) => column.notNull())
      .addColumn('side', 'text', (column) => column.notNull())
      .addColumn('quantity', sql`numeric(36, 8)`, (column) => column.notNull())
      .addColumn('price', sql`numeric(36, 8)`, (column) => column.notNull())
      .addColumn('fill_quantity', sql`numeric(36, 8)`, (column) => column.notNull())
      .addColumn('fill_price', sql`numeric(36, 8)`)
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('status_reason', 'text')
      .addColumn('timestamp', 'timestamptz', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .execute();
    await db.schema
      .createIndex('order_view_account')
      .on('order_view')
      .columns(['account_id', 'status', 'timestamp desc'])
      .execute();
    await sql`
      insert into order_view
        (order_id, account_id, market_id, side, quantity, price, fill_quantity, fill_price, status, status_reason, timestamp, updated_at)
      select order_id, account_id, market_id, side, quantity, price, fill_quantity,
        case when fill_quantity = 0 then null else round(fill_value / fill_quantity, 8) end,
        status, status_reason, created_at, now()
      from "order"`.execute(db);
    await db.schema.dropIndex('order_account').execute();
    await db.schema.alterTable('order').dropColumn('status').dropColumn('status_reason').execute();
  }
}
