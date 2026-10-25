import { hash, verify } from '@node-rs/argon2';

const OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error('密码至少 8 位');
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
