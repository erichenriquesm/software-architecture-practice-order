import { generateKeyPairSync } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { InvalidUserTokenError, registerUserTokenGuard, userAccountIdOf, userTokenPublicKey, verifyUserToken } from '../../../../../src/infra/platform/security/userToken.js';
import { createUserTokens } from '../../../../support/userTokens.js';

const accountId = '0192f0c1-7e2a-7b3c-8d4e-5f6a7b8c9d0e';
const now = 1_800_000_000;
const tokens = createUserTokens();
const validClaims = { sub: accountId, iat: now, exp: now + 60 };

const refusalOf = (token: string, nowSeconds = now): string => {
  try {
    verifyUserToken(token, tokens.publicKey, 'order', nowSeconds);
    return 'accepted';
  } catch (error) {
    if (!(error instanceof InvalidUserTokenError)) throw error;
    return error.message;
  }
};

describe('verifyUserToken', () => {
  test('Should return the claims of a token signed for this audience', () => {
    // Given
    const token = tokens.sign(validClaims);

    // When
    const claims = verifyUserToken(token, tokens.publicKey, 'order', now);

    // Then
    expect(claims).toMatchObject({ iss: 'account', sub: accountId, aud: 'order', exp: now + 60 });
  });

  test('Should accept a token expired by up to 5 seconds of clock skew and refuse one past it', () => {
    // Given
    const token = tokens.sign(validClaims);

    // When & Then
    expect(refusalOf(token, now + 65)).toBe('accepted');
    expect(refusalOf(token, now + 66)).toBe('invalid user token: expired');
  });

  test.each([
    ['another alg', tokens.sign(validClaims, { alg: 'none' }), 'unexpected alg'],
    ['another issuer', tokens.sign({ ...validClaims, iss: 'wallet' }), 'unexpected issuer'],
    ['another audience', tokens.sign({ ...validClaims, aud: 'wallet' }), 'unexpected audience'],
    ['another private key', tokens.sign(validClaims, { privateKey: generateKeyPairSync('ed25519').privateKey }), 'bad signature'],
    ['two segments', 'a.b', 'malformed'],
    ['segments that are not JSON', 'a.b.c', 'malformed'],
    ['claims missing sub', `${tokens.sign(validClaims).split('.')[0]}.${Buffer.from('{"iss":"account"}').toString('base64url')}.c`, 'missing claims'],
  ])('Should refuse a token with %s', (_case, token, reason) => {
    // When & Then
    expect(refusalOf(token)).toBe(`invalid user token: ${reason}`);
  });

  test('Should refuse a token whose claims were changed after signing', () => {
    // Given
    const [header, , signature] = tokens.sign(validClaims).split('.');
    const forged = Buffer.from(JSON.stringify({ ...validClaims, iss: 'account', aud: 'order', jti: 'x', sub: '0192f0c1-0000-7000-8000-000000000000' })).toString('base64url');

    // When & Then
    expect(refusalOf(`${header}.${forged}.${signature}`)).toBe('invalid user token: bad signature');
  });
});

describe('userTokenPublicKey', () => {
  test('Should read a PEM written on one line with literal \\n', () => {
    // Given
    const pem = '-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEALxCEnICerfG52kOtFCaYrwczs5XMniydqmd9Si/Pf2I=\\n-----END PUBLIC KEY-----\\n';

    // When
    const key = userTokenPublicKey(pem);

    // Then
    expect(key.asymmetricKeyType).toBe('ed25519');
  });
});

describe('registerUserTokenGuard', () => {
  const buildApp = () => {
    const app = Fastify();
    registerUserTokenGuard(app, { publicKey: tokens.publicKey, audience: 'order', publicRoutes: new Set(['/health']) });
    app.get('/health', async () => ({ status: 'up' }));
    app.get('/me', async (request) => ({ accountId: userAccountIdOf(request) }));
    return app;
  };

  test('Should hand the token subject to the handler as the account', async () => {
    // When
    const response = await buildApp().inject({ method: 'GET', url: '/me', headers: tokens.bearer(accountId) });

    // Then
    expect(response.json()).toEqual({ accountId });
  });

  test.each([
    ['no Authorization header', {}],
    ['a scheme other than Bearer', { authorization: `Basic ${tokens.sign({ sub: accountId })}` }],
    ['a token for another audience', { authorization: `Bearer ${tokens.sign({ sub: accountId, aud: 'wallet' })}` }],
    ['an expired token', { authorization: `Bearer ${tokens.sign({ sub: accountId, iat: 1, exp: 61 })}` }],
    ['a token signed by another key', { authorization: `Bearer ${tokens.sign({ sub: accountId }, { privateKey: generateKeyPairSync('ed25519').privateKey })}` }],
  ])('Should answer 401 unauthenticated for %s', async (_case, headers) => {
    // When
    const response = await buildApp().inject({ method: 'GET', url: '/me', headers });

    // Then
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'unauthenticated' });
  });

  test('Should let a public route through without a token', async () => {
    // When
    const response = await buildApp().inject({ method: 'GET', url: '/health' });

    // Then
    expect(response.statusCode).toBe(200);
  });
});
