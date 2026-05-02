import type { Application } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from '@config/env';

/**
 * Hand-written OpenAPI 3.1 description.
 *
 * Kept as a TypeScript object rather than generated from decorators so it can
 * be reviewed in a pull request like any other code, and so the same document
 * can be exported to `docs/api/openapi.yaml` for Postman and client codegen.
 */
const bearerAuth = [{ bearerAuth: [] }];

const errorResponse = {
  description: 'Error envelope',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorEnvelope' },
    },
  },
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Enterprise Employee Portal API',
    version: '1.4.0',
    description:
      'HR self-service REST API: authentication, employee directory, leave management with a '
      + 'two-stage approval workflow, weekly timesheets, documents, announcements and an org chart '
      + 'backed by a MySQL recursive CTE.',
    license: { name: 'MIT' },
  },
  servers: [
    { url: `http://localhost:${env.PORT}${env.API_PREFIX}`, description: 'Local development' },
    { url: `https://staging.employee-portal.internal${env.API_PREFIX}`, description: 'Staging' },
    { url: `https://portal.example.com${env.API_PREFIX}`, description: 'Production' },
  ],
  tags: [
    { name: 'Auth', description: 'Login, refresh-token rotation and session introspection' },
    { name: 'Employees', description: 'Directory search, profiles and avatars' },
    { name: 'Departments', description: 'Department reference data' },
    { name: 'Leave', description: 'Balances, requests, approvals and calendar' },
    { name: 'Timesheets', description: 'Weekly time entry and approval' },
    { name: 'Documents', description: 'Document vault with per-record access control' },
    { name: 'Announcements', description: 'Company announcements and read receipts' },
    { name: 'Org Chart', description: 'Recursive reporting hierarchy' },
    { name: 'Dashboard', description: 'Role-aware KPI summary' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ErrorEnvelope: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'FORBIDDEN' },
              message: { type: 'string', example: 'Role EMPLOYEE cannot access this resource' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { field: { type: 'string' }, message: { type: 'string' } },
                },
              },
            },
          },
          requestId: { type: 'string', example: '8f1c9a2e-6f4b-4a1e-9f0d-7c2b5d3a1e44' },
        },
      },
      PageMeta: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          pageSize: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 12 },
          totalPages: { type: 'integer', example: 1 },
          hasPrevious: { type: 'boolean' },
          hasNext: { type: 'boolean' },
        },
      },
      SessionUser: {
        type: 'object',
        properties: {
          userId: { type: 'integer', example: 4 },
          employeeId: { type: 'integer', nullable: true, example: 4 },
          email: { type: 'string', example: 'employee@portal.dev' },
          role: { type: 'string', enum: ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'] },
          fullName: { type: 'string', example: 'Priya Raman' },
          jobTitle: { type: 'string', nullable: true, example: 'Senior Software Engineer' },
          departmentName: { type: 'string', nullable: true, example: 'Engineering' },
        },
      },
      AuthResult: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/SessionUser' },
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          expiresIn: { type: 'string', example: '15m' },
        },
      },
      Employee: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          employeeCode: { type: 'string', example: 'EMP-1004' },
          fullName: { type: 'string', example: 'Priya Raman' },
          workEmail: { type: 'string' },
          jobTitle: { type: 'string' },
          departmentName: { type: 'string', nullable: true },
          managerName: { type: 'string', nullable: true },
          hireDate: { type: 'string', format: 'date' },
          employmentType: { type: 'string', enum: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] },
          status: { type: 'string', enum: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] },
          avatarUrl: { type: 'string', nullable: true },
        },
      },
      LeaveBalance: {
        type: 'object',
        properties: {
          leaveTypeId: { type: 'integer' },
          code: { type: 'string', example: 'ANNUAL' },
          name: { type: 'string', example: 'Annual Leave' },
          entitledDays: { type: 'number', example: 20 },
          carriedOverDays: { type: 'number', example: 3 },
          usedDays: { type: 'number', example: 4 },
          pendingDays: { type: 'number', example: 5 },
          availableDays: { type: 'number', example: 14 },
        },
      },
      LeaveRequest: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          employeeId: { type: 'integer' },
          employeeName: { type: 'string' },
          leaveTypeCode: { type: 'string', example: 'ANNUAL' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          totalDays: { type: 'number', example: 5 },
          halfDay: { type: 'boolean' },
          reason: { type: 'string' },
          status: {
            type: 'string',
            enum: ['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED'],
          },
          currentApproverName: { type: 'string', nullable: true },
          submittedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateLeaveRequest: {
        type: 'object',
        required: ['leaveTypeId', 'startDate', 'endDate', 'reason'],
        properties: {
          leaveTypeId: { type: 'integer', example: 1 },
          startDate: { type: 'string', format: 'date', example: '2026-10-12' },
          endDate: { type: 'string', format: 'date', example: '2026-10-16' },
          reason: { type: 'string', minLength: 10, example: 'Family wedding in Chennai.' },
          halfDay: { type: 'boolean', default: false },
        },
      },
      Decision: {
        type: 'object',
        required: ['decision'],
        properties: {
          decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
          comments: { type: 'string', example: 'Coverage confirmed with the team.' },
        },
      },
      OrgNode: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          fullName: { type: 'string' },
          jobTitle: { type: 'string' },
          departmentName: { type: 'string', nullable: true },
          directReports: { type: 'integer' },
          totalReports: { type: 'integer' },
          children: { type: 'array', items: { $ref: '#/components/schemas/OrgNode' } },
        },
      },
    },
    responses: {
      Unauthorized: errorResponse,
      Forbidden: errorResponse,
      NotFound: errorResponse,
      Conflict: errorResponse,
      ValidationError: errorResponse,
    },
  },
  security: bearerAuth,
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange credentials for an access and refresh token pair',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'employee@portal.dev' },
                  password: { type: 'string', example: 'Employee@12345' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authenticated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResult' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          429: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate a refresh token',
        description:
          'Consumes the supplied refresh token and issues a new pair. Reuse of an already-consumed '
          + 'token revokes every session for that user.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Rotated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResult' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the supplied refresh token',
        responses: { 204: { description: 'Session revoked' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current session user',
        responses: {
          200: {
            description: 'Session user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { user: { $ref: '#/components/schemas/SessionUser' } },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/employees': {
      get: {
        tags: ['Employees'],
        summary: 'Search the employee directory',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Name, title, email or code' },
          { name: 'departmentId', in: 'query', schema: { type: 'integer' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['last_name', 'first_name', 'job_title', 'hire_date'] } },
        ],
        responses: {
          200: {
            description: 'Paginated directory',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Employee' } },
                    meta: { $ref: '#/components/schemas/PageMeta' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Employees'],
        summary: 'Create an employee record (HR_ADMIN, SUPER_ADMIN)',
        responses: {
          201: { description: 'Created' },
          400: { $ref: '#/components/responses/ValidationError' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/employees/me': {
      get: {
        tags: ['Employees'],
        summary: "The signed-in user's own profile",
        responses: { 200: { description: 'Profile' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      patch: {
        tags: ['Employees'],
        summary: 'Update your own contact details',
        responses: { 200: { description: 'Updated' }, 400: { $ref: '#/components/responses/ValidationError' } },
      },
    },
    '/employees/{id}': {
      get: {
        tags: ['Employees'],
        summary: 'Fetch one employee',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Employee' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      patch: {
        tags: ['Employees'],
        summary: 'Update an employee (MANAGER limited to direct reports, HR unrestricted)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'Updated' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/leave/balances': {
      get: {
        tags: ['Leave'],
        summary: 'Leave balances by type for a year',
        parameters: [
          { name: 'employeeId', in: 'query', schema: { type: 'integer' } },
          { name: 'year', in: 'query', schema: { type: 'integer', example: 2026 } },
        ],
        responses: {
          200: {
            description: 'Balances',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/LeaveBalance' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/leave/requests': {
      get: {
        tags: ['Leave'],
        summary: 'My leave requests',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Paginated requests' } },
      },
      post: {
        tags: ['Leave'],
        summary: 'Submit a leave request',
        description:
          'Validates the date range, rejects overlaps against PENDING / MANAGER_APPROVED / APPROVED '
          + 'requests, and reserves the days against the balance inside a single transaction.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateLeaveRequest' } },
          },
        },
        responses: {
          201: {
            description: 'Submitted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { request: { $ref: '#/components/schemas/LeaveRequest' } },
                },
              },
            },
          },
          409: { $ref: '#/components/responses/Conflict' },
          422: { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/leave/approvals': {
      get: {
        tags: ['Leave'],
        summary: 'Approval inbox (MANAGER, HR_ADMIN, SUPER_ADMIN)',
        responses: {
          200: { description: 'Requests awaiting the caller' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/leave/requests/{id}/decision': {
      post: {
        tags: ['Leave'],
        summary: 'Approve or reject a request',
        description:
          'The stage (MANAGER or HR) is derived from the current status and validated against the '
          + 'transition guard, so an out-of-order decision returns 409 rather than corrupting state.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Decision' } } },
        },
        responses: {
          200: { description: 'Decision recorded' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },
    '/leave/requests/{id}/cancel': {
      post: {
        tags: ['Leave'],
        summary: 'Withdraw a request',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Cancelled' }, 409: { $ref: '#/components/responses/Conflict' } },
      },
    },
    '/leave/calendar': {
      get: {
        tags: ['Leave'],
        summary: 'Absence calendar for a date range',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'scope', in: 'query', schema: { type: 'string', enum: ['ME', 'TEAM', 'COMPANY'] } },
        ],
        responses: { 200: { description: 'Calendar entries' } },
      },
    },
    '/timesheets/week': {
      get: {
        tags: ['Timesheets'],
        summary: 'Weekly grid for an employee',
        parameters: [
          { name: 'weekStart', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'employeeId', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Weekly timesheet' } },
      },
      put: {
        tags: ['Timesheets'],
        summary: 'Save the whole week as a draft',
        responses: { 200: { description: 'Saved' }, 409: { $ref: '#/components/responses/Conflict' } },
      },
    },
    '/timesheets/{id}/decision': {
      post: {
        tags: ['Timesheets'],
        summary: 'Approve or reject a submitted timesheet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Decision recorded' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/documents': {
      get: { tags: ['Documents'], summary: 'List accessible documents', responses: { 200: { description: 'Documents' } } },
      post: {
        tags: ['Documents'],
        summary: 'Upload a document (multipart/form-data)',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                  title: { type: 'string' },
                  category: { type: 'string' },
                  visibility: { type: 'string', enum: ['PRIVATE', 'MANAGER', 'HR', 'COMPANY'] },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Uploaded' }, 400: { $ref: '#/components/responses/ValidationError' } },
      },
    },
    '/announcements': {
      get: { tags: ['Announcements'], summary: 'Announcement feed with read state', responses: { 200: { description: 'Feed' } } },
      post: {
        tags: ['Announcements'],
        summary: 'Publish an announcement (HR_ADMIN, SUPER_ADMIN)',
        responses: { 201: { description: 'Created' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/org-chart': {
      get: {
        tags: ['Org Chart'],
        summary: 'Reporting hierarchy as a tree',
        description: 'Built with a MySQL 8 `WITH RECURSIVE` CTE — one query for the whole subtree.',
        parameters: [
          { name: 'rootEmployeeId', in: 'query', schema: { type: 'integer' } },
          { name: 'maxDepth', in: 'query', schema: { type: 'integer', default: 8, maximum: 10 } },
        ],
        responses: {
          200: {
            description: 'Org tree',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { tree: { $ref: '#/components/schemas/OrgNode' } },
                },
              },
            },
          },
        },
      },
    },
    '/dashboard/summary': {
      get: {
        tags: ['Dashboard'],
        summary: 'Role-aware KPI summary for the landing page',
        responses: { 200: { description: 'Dashboard payload' } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Dashboard'],
        summary: 'Readiness probe including a database round trip',
        security: [],
        responses: { 200: { description: 'Ready' }, 503: { description: 'Degraded' } },
      },
    },
  },
} as const;

/** Mounts Swagger UI at /api-docs and the raw document at /api-docs.json. */
export function mountSwagger(app: Application): void {
  app.get('/api-docs.json', (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument as unknown as swaggerUi.JsonObject, {
      customSiteTitle: 'Employee Portal API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }),
  );
}
