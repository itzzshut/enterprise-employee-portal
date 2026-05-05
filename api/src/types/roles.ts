export const ROLES = ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'] as const;

export type Role = (typeof ROLES)[number];

/**
 * Privilege ordering used by `authorize()` when a route wants "this role or
 * above". Explicit numbers keep the comparison readable and make it obvious
 * that HR_ADMIN outranks MANAGER for cross-team operations.
 */
export const ROLE_RANK: Record<Role, number> = {
  EMPLOYEE: 10,
  MANAGER: 20,
  HR_ADMIN: 30,
  SUPER_ADMIN: 40,
};

export function hasAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** HR and above may read and mutate any employee record. */
export function isHrOrAbove(role: Role): boolean {
  return hasAtLeast(role, 'HR_ADMIN');
}
