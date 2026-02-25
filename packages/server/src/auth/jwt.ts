import { SignJWT, jwtVerify } from 'jose';

const ALGORITHM = 'HS256';
const ISSUER = 'ordinex-server';
const EXPIRATION = '7d';

export interface JwtPayload {
  sub: string;
  email: string;
  plan: string;
}

export async function signJwt(
  payload: JwtPayload,
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret);

  return new SignJWT({ email: payload.email, plan: payload.plan })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRATION)
    .sign(key);
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtPayload> {
  const key = new TextEncoder().encode(secret);

  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER,
    algorithms: [ALGORITHM],
  });

  return {
    sub: payload.sub as string,
    email: payload.email as string,
    plan: payload.plan as string,
  };
}
