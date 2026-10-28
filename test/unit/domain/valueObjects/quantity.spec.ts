import { describe, expect, test } from 'vitest';
import { InvalidOrderDataError } from '../../../../src/domain/errors.js';
import { Quantity } from '../../../../src/domain/valueObjects/quantity.js';

describe('Quantity', () => {
  test('Should accept an order quantity up to 1 000 000', () => {
    expect(Quantity.ofOrder('1000000').toString()).toBe('1000000.00000000');
    expect(Quantity.ofOrder('0.00001').toString()).toBe('0.00001000');
  });

  test('Should reject an order quantity above 1 000 000', () => {
    expect(() => Quantity.ofOrder('1000000.00000001')).toThrow(InvalidOrderDataError);
    expect(() => Quantity.ofOrder('99999999999999999999')).toThrow('quantity: cannot exceed 1000000');
  });

  test('Should still apply the decimal rules to an order quantity', () => {
    expect(() => Quantity.ofOrder('-1')).toThrow(InvalidOrderDataError);
    expect(() => Quantity.ofOrder('1e3')).toThrow(InvalidOrderDataError);
  });

  test('Should not cap amounts that are not an order quantity, such as a fill value', () => {
    expect(Quantity.from('5000000000').toString()).toBe('5000000000.00000000');
  });
});
