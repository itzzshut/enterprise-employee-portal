import fs from 'node:fs';
import path from 'node:path';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { recordAudit } from '@utils/audit';
import { parsePagination, type Paginated } from '@utils/paginate';
import { employeesRepository } from '@modules/employees/employees.repository';
import { documentsRepository, type DocumentRow } from './documents.repository';
import type { ListDocumentsQuery, UploadDocumentInput } from './documents.schema';
import type { AuthenticatedUser } from '@/types/express';
import { isHrOrAbove } from '@/types/roles';

export interface DocumentDto {
  id: number;
  employeeId: number | null;
  employeeName: string | null;
  uploadedById: number;
  uploadedByName: string;
  title: string;
  category: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  visibility: DocumentRow['visibility'];
  expiresOn: string | null;
  createdAt: string;
  downloadUrl: string;
}

function toDto(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name?.trim() || null,
    uploadedById: row.uploaded_by_id,
    uploadedByName: row.uploaded_by_name,
    title: row.title,
    category: row.category,
    filename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    visibility: row.visibility,
    expiresOn: row.expires_on,
    createdAt: new Date(row.created_at).toISOString(),
    downloadUrl: `${env.API_PREFIX}/documents/${row.id}/download`,
  };
}

/**
 * Read authority for a single document.
 *
 * COMPANY  — anyone signed in.
 * PRIVATE  — the owner and HR only.
 * MANAGER  — additionally the owner's reporting line.
 * HR       — HR and above only, whoever the owner is.
 */
async function assertCanRead(actor: AuthenticatedUser, row: DocumentRow): Promise<void> {
  if (row.visibility === 'COMPANY') return;
  if (isHrOrAbove(actor.role)) return;
  if (row.employee_id && row.employee_id === actor.employeeId) return;

  if (row.visibility === 'MANAGER' && actor.role === 'MANAGER' && actor.employeeId && row.employee_id) {
    const inLine = await employeesRepository.isInReportingLine(actor.employeeId, row.employee_id);
    if (inLine) return;
  }

  throw ApiError.forbidden('You do not have access to this document');
}

export const documentsService = {
  async list(actor: AuthenticatedUser, filters: ListDocumentsQuery): Promise<Paginated<DocumentDto>> {
    const pagination = parsePagination(filters as Record<string, unknown>);

    if (filters.employeeId && filters.employeeId !== actor.employeeId && !isHrOrAbove(actor.role)) {
      if (actor.role !== 'MANAGER' || !actor.employeeId) {
        throw ApiError.forbidden("You cannot browse another employee's documents");
      }
      const inLine = await employeesRepository.isInReportingLine(actor.employeeId, filters.employeeId);
      if (!inLine) throw ApiError.forbidden("You cannot browse another employee's documents");
    }

    const page = await documentsRepository.search(filters, pagination, {
      visibleTo: actor.employeeId,
      includeCompanyWide: true,
      unrestricted: isHrOrAbove(actor.role),
    });

    return { data: page.data.map(toDto), meta: page.meta };
  },

  async upload(
    actor: AuthenticatedUser,
    input: UploadDocumentInput,
    file: Express.Multer.File,
  ): Promise<DocumentDto> {
    if (!actor.employeeId) throw ApiError.forbidden('Only employees can upload documents');

    const ownerId = input.employeeId ?? actor.employeeId;
    if (ownerId !== actor.employeeId && !isHrOrAbove(actor.role)) {
      throw ApiError.forbidden("Only People Operations can file documents against another employee");
    }
    // Company-wide publishing is an HR action; an employee uploading their own
    // certificate cannot make it visible to everyone.
    if (input.visibility === 'COMPANY' && !isHrOrAbove(actor.role)) {
      throw ApiError.forbidden('Only People Operations can publish company-wide documents');
    }

    const id = await documentsRepository.create({
      employee_id: input.visibility === 'COMPANY' ? null : ownerId,
      uploaded_by_id: actor.employeeId,
      title: input.title,
      category: input.category,
      original_filename: file.originalname,
      storage_key: path.join('documents', file.filename),
      mime_type: file.mimetype,
      size_bytes: file.size,
      visibility: input.visibility,
      expires_on: input.expiresOn ?? null,
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'document',
      entityId: id,
      metadata: { category: input.category, visibility: input.visibility, sizeBytes: file.size },
    });

    const row = await documentsRepository.findById(id);
    return toDto(row!);
  },

  /**
   * Resolves a document to an absolute path for streaming.
   *
   * The path is rebuilt from the stored key and then re-checked against the
   * upload root, so even a corrupted `storage_key` cannot escape the directory.
   */
  async resolveForDownload(
    actor: AuthenticatedUser,
    id: number,
  ): Promise<{ absolutePath: string; filename: string; mimeType: string }> {
    const row = await documentsRepository.findById(id);
    if (!row) throw ApiError.notFound('Document');
    await assertCanRead(actor, row);

    const absolutePath = path.resolve(env.uploadDir, row.storage_key);
    if (!absolutePath.startsWith(path.resolve(env.uploadDir))) {
      throw ApiError.forbidden('Invalid document path');
    }
    if (!fs.existsSync(absolutePath)) {
      throw ApiError.notFound('Document file');
    }

    await recordAudit({
      actorUserId: actor.userId,
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'document',
      entityId: id,
    });

    return { absolutePath, filename: row.original_filename, mimeType: row.mime_type };
  },

  async remove(actor: AuthenticatedUser, id: number): Promise<void> {
    const row = await documentsRepository.findById(id);
    if (!row) throw ApiError.notFound('Document');

    const isOwner = row.employee_id === actor.employeeId;
    if (!isOwner && !isHrOrAbove(actor.role)) {
      throw ApiError.forbidden('Only the owner or People Operations can delete this document');
    }

    await documentsRepository.delete(id);

    // The row is the source of truth; an orphaned blob is swept up by a
    // scheduled job rather than deleted inline, so a failed unlink cannot leave
    // a dangling database reference.
    await recordAudit({
      actorUserId: actor.userId,
      action: 'DOCUMENT_DELETED',
      entityType: 'document',
      entityId: id,
      metadata: { storageKey: row.storage_key },
    });
  },
};
