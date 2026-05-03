import type { Knex } from 'knex';
import { db } from '@config/knex';
import { buildPage, type Paginated, type PaginationParams } from '@utils/paginate';
import type { DocumentVisibility } from '@/types';
import type { ListDocumentsQuery } from './documents.schema';

export interface DocumentRow {
  id: number;
  employee_id: number | null;
  employee_name: string | null;
  uploaded_by_id: number;
  uploaded_by_name: string;
  title: string;
  category: string;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  visibility: DocumentVisibility;
  expires_on: string | null;
  created_at: Date;
}

function selectDocuments() {
  return db('documents as doc')
    .select(
      'doc.id',
      'doc.employee_id',
      'doc.uploaded_by_id',
      'doc.title',
      'doc.category',
      'doc.original_filename',
      'doc.storage_key',
      'doc.mime_type',
      'doc.size_bytes',
      'doc.visibility',
      'doc.expires_on',
      'doc.created_at',
    )
    .select(db.raw("CONCAT_WS(' ', owner.first_name, owner.last_name) AS employee_name"))
    .select(db.raw("CONCAT_WS(' ', uploader.first_name, uploader.last_name) AS uploaded_by_name"))
    .leftJoin('employees as owner', 'owner.id', 'doc.employee_id')
    .join('employees as uploader', 'uploader.id', 'doc.uploaded_by_id');
}

export const documentsRepository = {
  async search(
    filters: ListDocumentsQuery,
    pagination: PaginationParams,
    scope: { visibleTo: number | null; includeCompanyWide: boolean; unrestricted: boolean },
  ): Promise<Paginated<DocumentRow>> {
    /**
     * Visibility is enforced in the WHERE clause rather than by filtering rows
     * after the fact — otherwise the pagination totals would leak how many
     * documents the caller is *not* allowed to see.
     */
    const applyScope = (query: Knex.QueryBuilder): Knex.QueryBuilder => {
      if (scope.unrestricted) return query;
      return query.where((builder) => {
        if (scope.visibleTo) builder.orWhere('doc.employee_id', scope.visibleTo);
        if (scope.includeCompanyWide) builder.orWhere('doc.visibility', 'COMPANY');
      });
    };

    const applyFilters = (query: Knex.QueryBuilder): Knex.QueryBuilder => {
      if (filters.employeeId) query.where('doc.employee_id', filters.employeeId);
      if (filters.category) query.where('doc.category', filters.category);
      if (filters.visibility) query.where('doc.visibility', filters.visibility);
      return query;
    };

    const countRow = await applyScope(applyFilters(db('documents as doc')))
      .count<{ total: number }>({ total: 'doc.id' })
      .first();

    const rows = await applyScope(applyFilters(selectDocuments()))
      .orderBy('doc.created_at', 'desc')
      .limit(pagination.limit)
      .offset(pagination.offset);

    return buildPage(rows as DocumentRow[], Number(countRow?.total ?? 0), pagination);
  },

  findById(id: number): Promise<DocumentRow | undefined> {
    return selectDocuments().where('doc.id', id).first<DocumentRow | undefined>();
  },

  async create(payload: Record<string, unknown>): Promise<number> {
    const [id] = await db('documents').insert(payload);
    return id as number;
  },

  async delete(id: number): Promise<number> {
    return db('documents').where('id', id).delete();
  },
};
