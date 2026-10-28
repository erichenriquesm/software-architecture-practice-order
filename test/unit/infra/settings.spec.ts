import { describe, expect, test } from 'vitest';
import { rateLimitSetting, userTokenPublicKeySetting } from '../../../src/infra/settings.js';

describe('rateLimitSetting', () => {
  test.each([
    ['5/1h', { limit: 5, windowMs: 3_600_000 }],
    ['600/1m', { limit: 600, windowMs: 60_000 }],
    ['50/10s', { limit: 50, windowMs: 10_000 }],
  ])('Should read %j', (value, expected) => {
    // When & Then
    expect(rateLimitSetting('RATE_LIMITS_TEST', '1/1s', { RATE_LIMITS_TEST: value })).toEqual(expected);
  });

  test('Should use the fallback when the variable is absent, and reject a malformed value', () => {
    // When & Then
    expect(rateLimitSetting('RATE_LIMITS_TEST', '3/1h', {})).toEqual({ limit: 3, windowMs: 3_600_000 });
    expect(() => rateLimitSetting('RATE_LIMITS_TEST', '3/1h', { RATE_LIMITS_TEST: 'many' })).toThrowError('RATE_LIMITS_TEST');
  });
});

describe('userTokenPublicKeySetting', () => {
  test('Should read the one-line PEM and refuse to start without it', () => {
    // Given
    const pem = '-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEALxCEnICerfG52kOtFCaYrwczs5XMniydqmd9Si/Pf2I=\\n-----END PUBLIC KEY-----\\n';

    // When & Then
    expect(userTokenPublicKeySetting({ USER_TOKEN_PUBLIC_KEY: pem }).asymmetricKeyType).toBe('ed25519');
    expect(() => userTokenPublicKeySetting({})).toThrowError('USER_TOKEN_PUBLIC_KEY');
  });
});
