export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/**
 * Normalises untrusted `?page=` / `?pageSize=` query values.
 *
 * Offset pagination is deliberate for the directory and request lists: users
 * jump to arbitrary pages and sort by arbitrary columns, which a cursor cannot
 * express. Page sizes are hard-capped so a crafted `?pageSize=100000` cannot
 * turn one request into a full table scan.
 */
export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const rawPage = Number.parseInt(String(query.page ?? '1'), 10);
  const rawSize = Number.parseInt(String(query.pageSize ?? DEFAULT_PAGE_SIZE), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const requested = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requested, MAX_PAGE_SIZE);

  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function buildPage<T>(data: T[], total: number, params: PaginationParams): Paginated<T> {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / params.pageSize);

  return {
    data,
    meta: {
      page: params.page,
      pageSize: params.pageSize,
      total: safeTotal,
      totalPages,
      hasPrevious: params.page > 1,
      hasNext: params.page < totalPages,
    },
  };
}

/** Whitelist-based sort parsing — never interpolate a client string into ORDER BY. */
export function parseSort<TColumn extends string>(
  query: Record<string, unknown>,
  allowed: readonly TColumn[],
  fallback: TColumn,
): { column: TColumn; direction: 'asc' | 'desc' } {
  const requested = String(query.sortBy ?? '');
  const column = (allowed as readonly string[]).includes(requested)
    ? (requested as TColumn)
    : fallback;
  const direction = String(query.sortDir ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  return { column, direction };
}
