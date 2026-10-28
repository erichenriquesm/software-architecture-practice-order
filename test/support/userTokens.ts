import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { UserTokenClaims } from '../../src/infra/platform/security/userToken.js';
import { userTokenIssuer } from '../../src/infra/platform/security/userToken.js';

/** Plays the account service: only tests sign user tokens, the order service just verifies them. */
export interface UserTokens {
  readonly publicKey: KeyObject;
  sign(claims: Partial<UserTokenClaims> & Pick<UserTokenClaims, 'sub'>, options?: { readonly alg?: string; readonly privateKey?: KeyObject }): string;
  bearer(accountId: string): { readonly authorization: string };
}

const base64Url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

export const createUserTokens = (audience = 'order'): UserTokens => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signToken: UserTokens['sign'] = (claims, options = {}) => {
    const iat = Math.floor(Date.now() / 1_000);
    const fullClaims: UserTokenClaims = { iss: userTokenIssuer, aud: audience, iat, exp: iat + 60, jti: randomUUID(), ...claims };
    const header = { alg: options.alg ?? 'EdDSA', typ: 'JWT' };
    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(fullClaims))}`;
    return `${signingInput}.${base64Url(sign(null, Buffer.from(signingInput), options.privateKey ?? privateKey))}`;
  };
  return {
    publicKey,
    sign: signToken,
    bearer: (accountId) => ({ authorization: `Bearer ${signToken({ sub: accountId })}` }),
  };
};
