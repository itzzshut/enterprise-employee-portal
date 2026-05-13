import request from 'supertest';
import type { Application } from 'express';

/**
 * HTTP-level integration test.
 *
 * The whole Express pipeline runs — helmet, CORS, requestId, authenticate,
 * authorize, validate, errorHandler — with only the database layer replaced.
 * That is the point: these tests assert the *contract* (status codes, error
 * envelope, RBAC) rather than any single unit.
 *
 * The knex module is mocked with a chainable proxy that always resolves to the
 * same EMPLOYEE user, which is exactly what `authenticate` needs to build a
 * session without a live MySQL instance.
 */
jest.mock('@config/knex', () => {
  const EMPLOYEE_ROW = {
    id: 4,
    email: 'employee@portal.dev',
    role: 'EMPLOYEE',
    is_active: 1,
    employee_id: 4,
  };

  const makeChain = (): unknown => {
    const chain: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(chain, {
      get(_target, property) {
        if (property === 'first') return () => Promise.resolve(EMPLOYEE_ROW);
        if (property === 'then') return undefined;
        return () => proxy;
      },
    });
    return proxy;
  };

  const db = Object.assign(jest.fn(() => makeChain()), {
    ref: (value: string) => ({ as: () => value }),
    raw: (sql: string) => sql,
    fn: { now: () => new Date() },
    transaction: (callback: (t: unknown) => unknown) => callback({ fn: { now: () => new Date() } }),
  });

  return {
    db,
    pingDatabase: jest.fn().mockResolvedValue(true),
    closeDatabase: jest.fn().mockResolvedValue(undefined),
  };
});

// Imported after the mock so the module graph picks up the fake knex.
import { createApp } from '@/app';
import { signAccessToken } from '@utils/jwt';

const PREFIX = '/api/v1';

let app: Application;
let employeeToken: string;

beforeAll(() => {
  app = createApp();
  employeeToken = signAccessToken({
    userId: 4,
    role: 'EMPLOYEE',
    employeeId: 4,
    email: 'employee@portal.dev',
  });
});

describe('probes', () => {
  it('answers the liveness probe without authentication', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'employee-portal-api' });
  });

  it('answers the readiness probe with the database check', async () => {
    const response = await request(app).get(`${PREFIX}/health/ready`).expect(200);
    expect(response.body).toMatchObject({ status: 'ready', checks: { database: 'up' } });
  });

  it('echoes a correlation id on every response', async () => {
    const response = await request(app).get('/health').set('X-Request-Id', 'trace-abc-123');
    expect(response.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('generates a correlation id when the client does not send one', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('authentication (401)', () => {
  it('rejects the directory with no Authorization header', async () => {
    const response = await request(app).get(`${PREFIX}/employees`).expect(401);
    expect(response.body.error).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Missing bearer token',
    });
    expect(response.body.requestId).toBeDefined();
  });

  it('rejects a malformed Authorization header', async () => {
    await request(app)
      .get(`${PREFIX}/employees`)
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);
  });

  it('rejects a forged bearer token', async () => {
    const response = await request(app)
      .get(`${PREFIX}/employees`)
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI5OTkifQ.not-a-real-signature')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unauthenticated leave submission', async () => {
    await request(app)
      .post(`${PREFIX}/leave/requests`)
      .send({ leaveTypeId: 1, startDate: '2026-10-12', endDate: '2026-10-16', reason: 'Holiday plans.' })
      .expect(401);
  });
});

describe('role-based access control (403)', () => {
  it('forbids an EMPLOYEE from creating employee records', async () => {
    const response = await request(app)
      .post(`${PREFIX}/employees`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        employeeCode: 'EMP-2001',
        firstName: 'New',
        lastName: 'Joiner',
        workEmail: 'new.joiner@portal.dev',
        jobTitle: 'Software Engineer',
        hireDate: '2026-10-01',
      })
      .expect(403);

    expect(response.body.error).toMatchObject({ code: 'FORBIDDEN' });
    expect(response.body.error.message).toContain('EMPLOYEE');
  });

  it('forbids an EMPLOYEE from listing a management team', async () => {
    await request(app)
      .get(`${PREFIX}/employees/me/team`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
  });

  it('forbids an EMPLOYEE from opening the approvals inbox', async () => {
    await request(app)
      .get(`${PREFIX}/leave/approvals`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
  });

  it('forbids an EMPLOYEE from publishing announcements', async () => {
    await request(app)
      .post(`${PREFIX}/announcements`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ title: 'Company update', body: 'A body long enough to pass validation.' })
      .expect(403);
  });

  it('forbids an EMPLOYEE from creating departments', async () => {
    await request(app)
      .post(`${PREFIX}/departments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ code: 'NEW', name: 'New Department' })
      .expect(403);
  });
});

describe('validation (400)', () => {
  it('rejects an out-of-range directory sort column', async () => {
    const response = await request(app)
      .get(`${PREFIX}/employees?sortBy=password_hash`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(400);

    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.error.details[0].field).toBe('sortBy');
  });

  it('rejects a non-numeric employee id in the path', async () => {
    await request(app)
      .get(`${PREFIX}/employees/not-a-number`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(400);
  });

  it('rejects a calendar range longer than six months', async () => {
    await request(app)
      .get(`${PREFIX}/leave/calendar?from=2026-01-01&to=2026-12-31`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(400);
  });
});

describe('routing', () => {
  it('returns a structured 404 for an unknown path', async () => {
    const response = await request(app).get(`${PREFIX}/does-not-exist`).expect(404);
    expect(response.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });

  it('serves the OpenAPI document', async () => {
    const response = await request(app).get('/api-docs.json').expect(200);
    expect(response.body.info.title).toBe('Enterprise Employee Portal API');
    expect(Object.keys(response.body.paths)).toContain('/auth/login');
  });
});
