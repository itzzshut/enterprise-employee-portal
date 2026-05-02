import type { Knex } from 'knex';
import { db } from '@config/knex';
import { buildPage, type Paginated, type PaginationParams } from '@utils/paginate';
import type { AnnouncementAudience } from '@/types';

export interface AnnouncementRow {
  id: number;
  author_id: number;
  author_name: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  department_id: number | null;
  department_name: string | null;
  is_pinned: number | boolean;
  published_at: Date | null;
  expires_at: Date | null;
  read_at: Date | null;
  read_count: number;
}

export interface FeedScope {
  employeeId: number | null;
  departmentId: number | null;
  isManager: boolean;
  unreadOnly: boolean;
  includeExpired: boolean;
}

/**
 * Feed projection.
 *
 * The read receipt is joined per-viewer (`read_at`) while `read_count` is a
 * correlated aggregate, so one query answers both "have I read this?" and
 * "how many people have?" without a second round trip.
 */
function selectFeed(employeeId: number | null) {
  return db('announcements as a')
    .select(
      'a.id',
      'a.author_id',
      'a.title',
      'a.body',
      'a.audience',
      'a.department_id',
      'a.is_pinned',
      'a.published_at',
      'a.expires_at',
    )
    .select(db.raw("CONCAT_WS(' ', au.first_name, au.last_name) AS author_name"))
    .select(db.ref('d.name').as('department_name'))
    .select(db.ref('ar.read_at').as('read_at'))
    .select(
      db.raw('(SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count'),
    )
    .join('employees as au', 'au.id', 'a.author_id')
    .leftJoin('departments as d', 'd.id', 'a.department_id')
    .leftJoin('announcement_reads as ar', function joinReads() {
      this.on('ar.announcement_id', '=', 'a.id').andOn(
        'ar.employee_id',
        '=',
        db.raw('?', [employeeId ?? 0]),
      );
    });
}

function applyAudience(query: Knex.QueryBuilder, scope: FeedScope): Knex.QueryBuilder {
  query.whereNotNull('a.published_at').where('a.published_at', '<=', db.fn.now());

  if (!scope.includeExpired) {
    query.where((builder) => builder.whereNull('a.expires_at').orWhere('a.expires_at', '>', db.fn.now()));
  }

  query.where((builder) => {
    builder.orWhere('a.audience', 'ALL');
    if (scope.departmentId) {
      builder.orWhere((sub) =>
        sub.where('a.audience', 'DEPARTMENT').andWhere('a.department_id', scope.departmentId),
      );
    }
    if (scope.isManager) builder.orWhere('a.audience', 'MANAGERS');
  });

  return query;
}

export const announcementsRepository = {
  async feed(scope: FeedScope, pagination: PaginationParams): Promise<Paginated<AnnouncementRow>> {
    const countQuery = applyAudience(db('announcements as a'), scope);
    if (scope.unreadOnly && scope.employeeId) {
      countQuery.whereNotExists((sub) =>
        sub
          .select('*')
          .from('announcement_reads as r')
          .whereRaw('r.announcement_id = a.id')
          .where('r.employee_id', scope.employeeId),
      );
    }
    const countRow = await countQuery.count<{ total: number }>({ total: 'a.id' }).first();

    const query = applyAudience(selectFeed(scope.employeeId), scope);
    if (scope.unreadOnly) query.whereNull('ar.read_at');

    const rows = await query
      .orderBy('a.is_pinned', 'desc')
      .orderBy('a.published_at', 'desc')
      .limit(pagination.limit)
      .offset(pagination.offset);

    return buildPage(rows as AnnouncementRow[], Number(countRow?.total ?? 0), pagination);
  },

  findById(id: number, employeeId: number | null): Promise<AnnouncementRow | undefined> {
    return selectFeed(employeeId).where('a.id', id).first<AnnouncementRow | undefined>();
  },

  async create(payload: Record<string, unknown>): Promise<number> {
    const [id] = await db('announcements').insert(payload);
    return id as number;
  },

  /** Idempotent read receipt — leans on uq_announcement_reads. */
  async markRead(announcementId: number, employeeId: number): Promise<void> {
    await db('announcement_reads')
      .insert({ announcement_id: announcementId, employee_id: employeeId })
      .onConflict(['announcement_id', 'employee_id'])
      .ignore();
  },

  async unreadCount(scope: FeedScope): Promise<number> {
    if (!scope.employeeId) return 0;
    const row = await applyAudience(db('announcements as a'), { ...scope, unreadOnly: true })
      .whereNotExists((sub) =>
        sub
          .select('*')
          .from('announcement_reads as r')
          .whereRaw('r.announcement_id = a.id')
          .where('r.employee_id', scope.employeeId),
      )
      .count<{ total: number }>({ total: 'a.id' })
      .first();
    return Number(row?.total ?? 0);
  },

  readReceipts(announcementId: number) {
    return db('announcement_reads as ar')
      .select('ar.read_at', 'e.id as employee_id')
      .select(db.raw("CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name"))
      .join('employees as e', 'e.id', 'ar.employee_id')
      .where('ar.announcement_id', announcementId)
      .orderBy('ar.read_at', 'desc');
  },
};
