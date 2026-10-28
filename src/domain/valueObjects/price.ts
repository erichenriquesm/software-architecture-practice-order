import { Decimal } from 'decimal.js';
import { InvalidOrderDataError } from '../errors.js';

const decimalText = /^\d+(\.\d{1,8})?$/;
const maxPrice = new Decimal('1000000000');

/** A positive price up to 1 000 000 000, exact up to 8 decimal places. */
export class Price {
  private constructor(readonly value: Decimal) {}

  static from(value: string): Price {
    if (!decimalText.test(value) || new Decimal(value).isZero()) {
      throw new InvalidOrderDataError('price', 'must be a positive decimal string with up to 8 decimal places');
    }
    const price = new Decimal(value);
    if (price.greaterThan(maxPrice)) throw new InvalidOrderDataError('price', `cannot exceed ${maxPrice.toString()}`);
    return new Price(price);
  }

  isMultipleOf(tick: Price): boolean {
    return this.value.mod(tick.value).isZero();
  }

  isGreaterThan(other: Price): boolean {
    return this.value.greaterThan(other.value);
  }

  toString(): string {
    return this.value.toFixed(8);
  }
}
