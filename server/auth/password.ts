import { hash, verify } from '@node-rs/argon2';

// Library defaults are argon2id with the OWASP baseline parameters
export const hashPassword = (password: string) => hash(password);

let dummyHash: Promise<string> | undefined;

// Unknown usernames still pay for one verification, so response time does not reveal them
export async function verifyPassword(passwordHash: string | undefined, password: string) {
  if (!passwordHash) {
    dummyHash ??= hash('dummy-password-for-timing');
    await verify(await dummyHash, password);
    return false;
  }
  return verify(passwordHash, password);
}
