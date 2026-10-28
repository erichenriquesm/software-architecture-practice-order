import { describe, expect, test } from 'vitest';
import { InvalidOrderDataError } from '../../../../src/domain/errors.js';
import { Price } from '../../../../src/domain/valueObjects/price.js';

describe('Price', () => {
  test('Should accept a price up to 1 000 000 000', () => {
    expect(Price.from('1000000000').toString()).toBe('1000000000.00000000');
  });

  test('Should reject a price above 1 000 000 000', () => {
    expect(() => Price.from('1000000000.00000001')).toThrow(InvalidOrderDataError);
    expect(() => Price.from('99999999999999999999')).toThrow('price: cannot exceed 1000000000');
  });

  test('Should still reject zero and malformed prices', () => {
    expect(() => Price.from('0')).toThrow(InvalidOrderDataError);
    expect(() => Price.from('1.123456789')).toThrow(InvalidOrderDataError);
  });
});
