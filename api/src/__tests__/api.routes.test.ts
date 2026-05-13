import request from 'supertest';
import type { Application } from 'express';

/**
 * Route-wiring test against an in-memory stand-in for knex.
 *
 * Every query builder call returns the same chainable object; awaiting it
 * yields a single "universal" row that carries the columns the repositories
 * select. This is not a behavioural test of the SQL (the leave state machine
 * and auth service have their own unit tests) — it proves that each endpoint
 * is mounted, passes validation, reaches its controller, service and
 * repository, and serialises a response in the documented envelope.
 */
jest.mock('@config/knex', () => {
  const ROW: Record<string, unknown> = {
    id: 1,
    user_id: 1,
    email: 'admin@portal.dev',
    work_email: 'admin@portal.dev',
    role: 'SUPER_ADMIN',
    is_active: 1,
    employee_id: 1,
    employee_code: 'EMP-1001',
    first_name: 'Ada',
    last_name: 'Admin',
    employee_name: 'Ada Admin',
    job_title: 'Engineer',
    status: 'PENDING',
    manager_id: null,
    department_id: 1,
    department_name: 'Engineering',
    code: 'ENG',
    name: 'Engineering',
    description: 'Engineering department',
    headcount: 3,
    requests: 2,
    days: 4,
    month: '2026-10',
    total: 3,
    count: 3,
    unread: 1,
    total_days: '2.0',
    total_hours: '8.0',
    entry_count: 1,
    start_date: '2026-11-02',
    end_date: '2026-11-03',
    week_start_date: '2026-11-02',
    work_date: '2026-11-02',
    hours: '8.0',
    leave_type_id: 1,
    leave_type_name: 'Annual Leave',
    leave_type_code: 'ANNUAL',
    color_hex: '#2563eb',
    entitled_days: '20.0',
    used_days: '2.0',
    pending_days: '1.0',
    carried_over_days: '0.0',
    year: 2026,
    project_id: 1,
    project_code: 'PRJ',
    project_name: 'Project',
    is_billable: 1,
    title: 'Notice',
    body: 'A body long enough to pass validation.',
    audience: 'ALL',
    is_pinned: 0,
    is_read: 0,
    visibility: 'COMPANY',
    file_name: 'a.pdf',
    original_name: 'a.pdf',
    storage_path: 'does-not-exist.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
    hire_date: '2026-01-05',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    submitted_at: '2026-10-01T00:00:00.000Z',
    password_hash: '$2a$10$invalid',
    depth: 0,
    read_at: '2026-10-02T00:00:00.000Z',
    decided_at: '2026-10-02T00:00:00.000Z',
    published_at: '2026-10-01T00:00:00.000Z',
    is_active_flag: 1,
  };

  const makeChain = (): unknown => {
    const proxy: unknown = new Proxy(function chain() {}, {
      get(_target, property) {
        if (property === 'first') return () => Promise.resolve(ROW);
        if (property === 'then') {
          return (resolve: (value: unknown) => unknown) => resolve([ROW]);
        }
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  };

  const now = (): Date => new Date();
  const trx = Object.assign(
    jest.fn(() => makeChain()),
    { raw: (sql: string) => sql, fn: { now }, ref: (v: string) => ({ as: () => v }) },
  );
  const db = Object.assign(
    jest.fn(() => makeChain()),
    {
      raw: (sql: string) => sql,
      ref: (value: string) => ({ as: () => value }),
      fn: { now },
      transaction: (callback: (t: unknown) => unknown) => callback(trx),
    },
  );

  return {
    db,
    pingDatabase: jest.fn().mockResolvedValue(true),
    closeDatabase: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('@utils/audit', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

import { createApp } from '@/app';
import { signAccessToken } from '@utils/jwt';

const PREFIX = '/api/v1';

let app: Application;
let auth: string;

beforeAll(() => {
  app = createApp();
  auth = `Bearer ${signAccessToken({
    userId: 1,
    role: 'SUPER_ADMIN',
    employeeId: 1,
    email: 'admin@portal.dev',
  })}`;
});

const get = (path: string): request.Test =>
  request(app).get(`${PREFIX}${path}`).set('Authorization', auth);

describe('read endpoints return the success envelope', () => {
  const paths = [
    '/auth/me',
    '/dashboard/summary',
    '/employees',
    '/employees?q=ada&sortBy=last_name&sortDir=asc&page=1&pageSize=10',
    '/employees/me',
    '/employees/me/team',
    '/employees/1',
    '/employees/1/reports',
    '/departments',
    '/departments/1',
    '/org-chart',
    '/org-chart?rootId=1',
    '/leave/types',
    '/leave/balances',
    '/leave/calendar?from=2026-11-01&to=2026-11-30',
    '/leave/requests',
    '/leave/requests/1',
    '/leave/team',
    '/leave/approvals',
    '/timesheets/projects',
    '/timesheets/summary?from=2026-11-01&to=2026-11-30',
    '/timesheets/week?weekStart=2026-11-02',
    '/timesheets/pending',
    '/announcements',
    '/announcements/unread-count',
    '/announcements/1',
    '/announcements/1/receipts',
    '/documents',
  ];

  it.each(paths)('GET %s', async (path) => {
    const response = await get(path);
    expect(response.status).toBe(200);
  });
});

describe('write endpoints are mounted and validated', () => {
  it('rejects an invalid leave request body', async () => {
    const response = await request(app)
      .post(`${PREFIX}/leave/requests`)
      .set('Authorization', auth)
      .send({ leaveTypeId: 'x' })
      .expect(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects an invalid timesheet body', async () => {
    await request(app)
      .put(`${PREFIX}/timesheets/week`)
      .set('Authorization', auth)
      .send({ weekStart: 'nope' })
      .expect(400);
  });

  it('rejects an invalid announcement body', async () => {
    await request(app)
      .post(`${PREFIX}/announcements`)
      .set('Authorization', auth)
      .send({ title: '' })
      .expect(400);
  });

  it('rejects an invalid department body', async () => {
    await request(app)
      .post(`${PREFIX}/departments`)
      .set('Authorization', auth)
      .send({})
      .expect(400);
  });

  it('rejects an invalid employee patch', async () => {
    await request(app)
      .patch(`${PREFIX}/employees/me`)
      .set('Authorization', auth)
      .send({ phone: 12345 })
      .expect(400);
  });

  it('rejects a login with no credentials', async () => {
    await request(app).post(`${PREFIX}/auth/login`).send({}).expect(400);
  });

  it('answers unknown routes with the 404 envelope', async () => {
    const response = await get('/nope').expect(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('write endpoints reach the service layer', () => {
  const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object): request.Test =>
    request(app)[method](`${PREFIX}${path}`).set('Authorization', auth).send(body);

  const cases: Array<[string, 'post' | 'put' | 'patch' | 'delete', string, object | undefined]> = [
    ['create announcement', 'post', '/announcements', { title: 'Company update', body: 'A body long enough to pass validation.' }],
    ['mark announcement read', 'post', '/announcements/1/read', undefined],
    ['create department', 'post', '/departments', { code: 'OPS', name: 'Operations' }],
    ['update department', 'patch', '/departments/1', { name: 'Platform' }],
    ['update own profile', 'patch', '/employees/me', { phone: '+44 20 7946 0000' }],
    ['update employee', 'patch', '/employees/2', { jobTitle: 'Senior Engineer' }],
    ['submit leave', 'post', '/leave/requests', { leaveTypeId: 1, startDate: '2026-11-02', endDate: '2026-11-04', reason: 'Family visit.' }],
    ['decide leave', 'post', '/leave/requests/1/decision', { decision: 'APPROVED' }],
    ['cancel leave', 'post', '/leave/requests/1/cancel', {}],
    ['save timesheet week', 'put', '/timesheets/week', { weekStart: '2026-11-02', entries: [{ projectId: 1, workDate: '2026-11-02', hours: 8 }] }],
    ['submit timesheet week', 'post', '/timesheets/week/submit', { weekStart: '2026-11-02' }],
    ['decide timesheet', 'post', '/timesheets/1/decision', { decision: 'APPROVED' }],
    ['delete document', 'delete', '/documents/1', undefined],
    ['change password', 'post', '/auth/change-password', { currentPassword: 'OldPassw0rd!', newPassword: 'NewPassw0rd!42' }],
    ['refresh with a bad token', 'post', '/auth/refresh', { refreshToken: 'not-a-real-token' }],
    ['log in with unknown credentials', 'post', '/auth/login', { email: 'nobody@portal.dev', password: 'wrong-password' }],
    ['log out', 'post', '/auth/logout', {}],
  ];

  it.each(cases)('%s answers without a server error', async (_name, method, path, body) => {
    const response = await send(method, path, body);
    expect(response.status).toBeLessThan(500);
  });
});
