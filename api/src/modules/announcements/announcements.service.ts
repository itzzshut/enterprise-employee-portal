import { db } from '@config/knex';
import { ApiError } from '@utils/ApiError';
import { recordAudit } from '@utils/audit';
import { parsePagination, type Paginated } from '@utils/paginate';
import { announcementsRepository, type AnnouncementRow, type FeedScope } from './announcements.repository';
import type { CreateAnnouncementInput, ListAnnouncementsQuery } from './announcements.schema';
import type { AuthenticatedUser } from '@/types/express';
import { isHrOrAbove } from '@/types/roles';

export interface AnnouncementDto {
  id: number;
  title: string;
  body: string;
  audience: AnnouncementRow['audience'];
  departmentId: number | null;
  departmentName: string | null;
  authorId: number;
  authorName: string;
  isPinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  isRead: boolean;
  readCount: number;
}

function toDto(row: AnnouncementRow): AnnouncementDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    departmentId: row.department_id,
    departmentName: row.department_name,
    authorId: row.author_id,
    authorName: row.author_name,
    isPinned: Boolean(row.is_pinned),
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    isRead: Boolean(row.read_at),
    readCount: Number(row.read_count),
  };
}

async function buildScope(
  actor: AuthenticatedUser,
  query: ListAnnouncementsQuery = {},
): Promise<FeedScope> {
  let departmentId: number | null = null;
  if (actor.employeeId) {
    const row = await db('employees').select('department_id').where('id', actor.employeeId).first();
    departmentId = (row?.department_id as number | null) ?? null;
  }
  return {
    employeeId: actor.employeeId,
    departmentId,
    isManager: actor.role !== 'EMPLOYEE',
    unreadOnly: Boolean(query.unreadOnly),
    includeExpired: Boolean(query.includeExpired),
  };
}

export const announcementsService = {
  async feed(actor: AuthenticatedUser, query: ListAnnouncementsQuery): Promise<Paginated<AnnouncementDto>> {
    const pagination = parsePagination(query as Record<string, unknown>);
    const scope = await buildScope(actor, query);
    const page = await announcementsRepository.feed(scope, pagination);
    return { data: page.data.map(toDto), meta: page.meta };
  },

  async unreadCount(actor: AuthenticatedUser): Promise<number> {
    const scope = await buildScope(actor);
    return announcementsRepository.unreadCount(scope);
  },

  async getById(actor: AuthenticatedUser, id: number): Promise<AnnouncementDto> {
    const row = await announcementsRepository.findById(id, actor.employeeId);
    if (!row) throw ApiError.notFound('Announcement');
    return toDto(row);
  },

  /** Opening an announcement is what marks it read — no separate user action. */
  async markRead(actor: AuthenticatedUser, id: number): Promise<AnnouncementDto> {
    if (!actor.employeeId) throw ApiError.forbidden('Only employees can acknowledge announcements');
    await this.getById(actor, id);
    await announcementsRepository.markRead(id, actor.employeeId);
    return this.getById(actor, id);
  },

  async create(actor: AuthenticatedUser, input: CreateAnnouncementInput): Promise<AnnouncementDto> {
    if (!actor.employeeId) throw ApiError.forbidden('Announcements must be authored by an employee');

    const id = await announcementsRepository.create({
      author_id: actor.employeeId,
      title: input.title,
      body: input.body,
      audience: input.audience,
      department_id: input.audience === 'DEPARTMENT' ? input.departmentId : null,
      is_pinned: input.isPinned,
      // Leaving `published_at` null keeps the announcement as an invisible draft.
      published_at: input.publishNow ? db.fn.now() : null,
      expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: 'ANNOUNCEMENT_CREATED',
      entityType: 'announcement',
      entityId: id,
      metadata: { audience: input.audience, published: input.publishNow },
    });

    return this.getById(actor, id);
  },

  /** Read receipts are an HR reporting feature, not visible to authors at large. */
  async receipts(actor: AuthenticatedUser, id: number) {
    if (!isHrOrAbove(actor.role)) {
      throw ApiError.forbidden('Only People Operations can review read receipts');
    }
    const rows = await announcementsRepository.readReceipts(id);
    return rows.map((row) => ({
      employeeId: row.employee_id as number,
      employeeName: row.employee_name as string,
      readAt: new Date(row.read_at as Date).toISOString(),
    }));
  },
};
