import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing — NFR-3.2.
 *
 * Argon2id: memory-hard, so GPU and ASIC attacks gain far less than they do
 * against SHA-family or bcrypt. Parameters follow the OWASP recommendation
 * (19 MiB, 2 iterations, parallelism 1), which resists offline cracking while
 * staying fast enough to sit inside a request.
 *
 * The cost parameters are encoded in the resulting hash string, so raising them
 * later does not invalidate existing hashes — old ones keep verifying, and can
 * be re-hashed on next successful sign-in.
 */
const OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash
    // that distinguishes this account from any other.
    return false;
  }
}
