import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPage,
  parsePagination,
  parseSort,
} from './paginate';

describe('parsePagination', () => {
  it('falls back to sensible defaults when nothing is supplied', () => {
    expect(parsePagination({})).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      offset: 0,
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it('computes the offset from page and pageSize', () => {
    expect(parsePagination({ page: '3', pageSize: '25' })).toEqual({
      page: 3,
      pageSize: 25,
      offset: 50,
      limit: 25,
    });
  });

  it('caps pageSize so a crafted query cannot trigger a full table scan', () => {
    const result = parsePagination({ pageSize: '100000' });
    expect(result.pageSize).toBe(MAX_PAGE_SIZE);
    expect(result.limit).toBe(MAX_PAGE_SIZE);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-4'],
    ['non-numeric', 'DROP TABLE employees'],
    ['empty', ''],
  ])('ignores a %s page value', (_label, page) => {
    expect(parsePagination({ page }).page).toBe(1);
  });

  it('ignores a non-numeric pageSize', () => {
    expect(parsePagination({ pageSize: 'all' }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('buildPage', () => {
  it('derives page metadata for a middle page', () => {
    const params = parsePagination({ page: '2', pageSize: '10' });
    const page = buildPage([1, 2, 3], 35, params);

    expect(page.data).toHaveLength(3);
    expect(page.meta).toEqual({
      page: 2,
      pageSize: 10,
      total: 35,
      totalPages: 4,
      hasPrevious: true,
      hasNext: true,
    });
  });

  it('reports no pages for an empty result set', () => {
    const page = buildPage([], 0, parsePagination({}));
    expect(page.meta.totalPages).toBe(0);
    expect(page.meta.hasNext).toBe(false);
    expect(page.meta.hasPrevious).toBe(false);
  });

  it('marks the final page as having no next', () => {
    const page = buildPage([1], 21, parsePagination({ page: '3', pageSize: '10' }));
    expect(page.meta.totalPages).toBe(3);
    expect(page.meta.hasNext).toBe(false);
    expect(page.meta.hasPrevious).toBe(true);
  });

  it('treats a non-finite total as zero rather than producing NaN pages', () => {
    const page = buildPage([], Number.NaN, parsePagination({}));
    expect(page.meta.total).toBe(0);
    expect(page.meta.totalPages).toBe(0);
  });
});

describe('parseSort', () => {
  const allowed = ['last_name', 'hire_date'] as const;

  it('accepts a whitelisted column and direction', () => {
    expect(parseSort({ sortBy: 'hire_date', sortDir: 'desc' }, allowed, 'last_name')).toEqual({
      column: 'hire_date',
      direction: 'desc',
    });
  });

  it('rejects an unlisted column so it can never reach ORDER BY', () => {
    expect(parseSort({ sortBy: 'password_hash' }, allowed, 'last_name').column).toBe('last_name');
  });

  it('defaults to ascending for an unrecognised direction', () => {
    expect(parseSort({ sortDir: 'sideways' }, allowed, 'last_name').direction).toBe('asc');
  });
});
