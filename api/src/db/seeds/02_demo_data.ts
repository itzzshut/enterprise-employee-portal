import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import type { Knex } from 'knex';
import { env } from '../../config/env';

/**
 * Demo dataset: 12 employees across a three-level management hierarchy, four
 * projects, a full year of leave balances and a spread of leave requests in
 * every workflow state so the approvals inbox and calendar are not empty on a
 * fresh clone.
 *
 * Destructive by design — only run against development / staging databases.
 */
type EmployeeSeed = {
  code: string;
  first: string;
  last: string;
  title: string;
  dept: 'ENG' | 'HR' | 'FIN' | 'SALES' | 'OPS';
  managerCode: string | null;
  hire: string;
  location: string;
  login?: { email: string; password: string; role: 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'SUPER_ADMIN' };
};

const PEOPLE: EmployeeSeed[] = [
  {
    code: 'EMP-1001',
    first: 'Daniel',
    last: 'Okafor',
    title: 'Chief Technology Officer',
    dept: 'ENG',
    managerCode: null,
    hire: '2017-02-06',
    location: 'Buffalo, NY',
    login: { email: 'admin@portal.dev', password: 'Admin@12345', role: 'SUPER_ADMIN' },
  },
  {
    code: 'EMP-1002',
    first: 'Sofia',
    last: 'Marino',
    title: 'Director of People Operations',
    dept: 'HR',
    managerCode: 'EMP-1001',
    hire: '2018-07-16',
    location: 'Buffalo, NY',
    login: { email: 'hr@portal.dev', password: 'HrAdmin@12345', role: 'HR_ADMIN' },
  },
  {
    code: 'EMP-1003',
    first: 'Marcus',
    last: 'Lee',
    title: 'Engineering Manager',
    dept: 'ENG',
    managerCode: 'EMP-1001',
    hire: '2019-03-11',
    location: 'Buffalo, NY',
    login: { email: 'manager@portal.dev', password: 'Manager@12345', role: 'MANAGER' },
  },
  {
    code: 'EMP-1004',
    first: 'Priya',
    last: 'Raman',
    title: 'Senior Software Engineer',
    dept: 'ENG',
    managerCode: 'EMP-1003',
    hire: '2021-01-18',
    location: 'Buffalo, NY',
    login: { email: 'employee@portal.dev', password: 'Employee@12345', role: 'EMPLOYEE' },
  },
  {
    code: 'EMP-1005',
    first: 'Tomas',
    last: 'Bauer',
    title: 'Software Engineer',
    dept: 'ENG',
    managerCode: 'EMP-1003',
    hire: '2022-05-09',
    location: 'Remote (US)',
    login: { email: 'tomas.bauer@portal.dev', password: 'Employee@12345', role: 'EMPLOYEE' },
  },
  {
    code: 'EMP-1006',
    first: 'Aisha',
    last: 'Khan',
    title: 'QA Automation Engineer',
    dept: 'ENG',
    managerCode: 'EMP-1003',
    hire: '2022-09-26',
    location: 'Buffalo, NY',
    login: { email: 'aisha.khan@portal.dev', password: 'Employee@12345', role: 'EMPLOYEE' },
  },
  {
    code: 'EMP-1007',
    first: 'Liam',
    last: 'Byrne',
    title: 'DevOps Engineer',
    dept: 'ENG',
    managerCode: 'EMP-1003',
    hire: '2023-02-13',
    location: 'Remote (US)',
    login: { email: 'liam.byrne@portal.dev', password: 'Employee@12345', role: 'EMPLOYEE' },
  },
  {
    code: 'EMP-1008',
    first: 'Elena',
    last: 'Petrova',
    title: 'Finance Manager',
    dept: 'FIN',
    managerCode: 'EMP-1001',
    hire: '2019-11-04',
    location: 'New York, NY',
    login: { email: 'elena.petrova@portal.dev', password: 'Manager@12345', role: 'MANAGER' },
  },
  {
    code: 'EMP-1009',
    first: 'Hiro',
    last: 'Tanaka',
    title: 'Financial Analyst',
    dept: 'FIN',
    managerCode: 'EMP-1008',
    hire: '2023-06-05',
    location: 'New York, NY',
    login: { email: 'hiro.tanaka@portal.dev', password: 'Employee@12345', role: 'EMPLOYEE' },
  },
  {
    code: 'EMP-1010',
    first: 'Grace',
    last: 'Wu',
    title: 'HR Generalist',
    dept: 'HR',
    managerCode: 'EMP-1002',
    hire: '2023-08-21',
    location: 'Buffalo, NY',
    login: { email: 'grace.wu@portal.dev', password: 'Employee@12345', role: 'EMPLOYEE' },
  },
  {
    code: 'EMP-1011',
    first: 'Noah',
    last: 'Bennett',
    title: 'Regional Sales Manager',
    dept: 'SALES',
    managerCode: 'EMP-1001',
    hire: '2020-04-20',
    location: 'Chicago, IL',
    login: { email: 'noah.bennett@portal.dev', password: 'Manager@12345', role: 'MANAGER' },
  },
  {
    code: 'EMP-1012',
    first: 'Fatima',
    last: 'Nasser',
    title: 'Account Executive',
    dept: 'SALES',
    managerCode: 'EMP-1011',
    hire: '2024-01-15',
    location: 'Chicago, IL',
    login: { email: 'fatima.nasser@portal.dev', password: 'Employee@12345', role: 'EMPLOYEE' },
  },
];

export async function seed(knex: Knex): Promise<void> {
  // Child-first truncation; FK checks are toggled because employees.manager_id
  // is self-referencing and departments.head_employee_id points back at it.
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [
    'announcement_reads',
    'announcements',
    'documents',
    'timesheet_entries',
    'timesheets',
    'projects',
    'leave_approvals',
    'leave_requests',
    'leave_balances',
    'audit_logs',
    'refresh_tokens',
    'employees',
    'users',
  ]) {
    await knex(table).truncate();
  }
  await knex.raw('SET FOREIGN_KEY_CHECKS = 1');

  const departments = await knex('departments').select('id', 'code');
  const departmentId = new Map(departments.map((d) => [d.code as string, d.id as number]));

  const employeeId = new Map<string, number>();

  // Pass 1: create login + employee rows without manager links.
  for (const person of PEOPLE) {
    let userId: number | null = null;
    if (person.login) {
      const passwordHash = await bcrypt.hash(person.login.password, env.BCRYPT_ROUNDS);
      const [insertedUserId] = await knex('users').insert({
        email: person.login.email,
        password_hash: passwordHash,
        role: person.login.role,
        is_active: true,
      });
      userId = insertedUserId as number;
    }

    const [insertedEmployeeId] = await knex('employees').insert({
      user_id: userId,
      employee_code: person.code,
      first_name: person.first,
      last_name: person.last,
      work_email: person.login?.email ?? `${person.first}.${person.last}@portal.dev`.toLowerCase(),
      phone: `+1-716-555-${1000 + employeeId.size}`,
      job_title: person.title,
      department_id: departmentId.get(person.dept) ?? null,
      hire_date: person.hire,
      employment_type: 'FULL_TIME',
      status: 'ACTIVE',
      location: person.location,
    });
    employeeId.set(person.code, insertedEmployeeId as number);
  }

  // Pass 2: wire the hierarchy now that every id exists.
  for (const person of PEOPLE) {
    if (!person.managerCode) continue;
    await knex('employees')
      .where('id', employeeId.get(person.code)!)
      .update({ manager_id: employeeId.get(person.managerCode)! });
  }

  await knex('departments').where('code', 'ENG').update({ head_employee_id: employeeId.get('EMP-1003')! });
  await knex('departments').where('code', 'HR').update({ head_employee_id: employeeId.get('EMP-1002')! });
  await knex('departments').where('code', 'FIN').update({ head_employee_id: employeeId.get('EMP-1008')! });
  await knex('departments').where('code', 'SALES').update({ head_employee_id: employeeId.get('EMP-1011')! });

  // --- Projects -------------------------------------------------------------
  const projects = [
    {
      code: 'ATLAS',
      name: 'Atlas Data Platform',
      client_name: 'Northwind Logistics',
      department_id: departmentId.get('ENG')!,
      lead_employee_id: employeeId.get('EMP-1004')!,
      is_billable: true,
      start_date: '2025-09-01',
    },
    {
      code: 'PORTAL',
      name: 'Employee Portal Rebuild',
      client_name: 'Internal',
      department_id: departmentId.get('ENG')!,
      lead_employee_id: employeeId.get('EMP-1003')!,
      is_billable: false,
      start_date: '2026-01-05',
    },
    {
      code: 'CLOSE',
      name: 'Quarterly Close Automation',
      client_name: 'Internal',
      department_id: departmentId.get('FIN')!,
      lead_employee_id: employeeId.get('EMP-1008')!,
      is_billable: false,
      start_date: '2025-10-01',
    },
    {
      code: 'MIDWEST',
      name: 'Midwest Enterprise Expansion',
      client_name: 'Crestline Group',
      department_id: departmentId.get('SALES')!,
      lead_employee_id: employeeId.get('EMP-1011')!,
      is_billable: true,
      start_date: '2026-02-02',
    },
  ];
  await knex('projects').insert(projects);
  const projectRows = await knex('projects').select('id', 'code');
  const projectId = new Map(projectRows.map((p) => [p.code as string, p.id as number]));

  // --- Leave balances -------------------------------------------------------
  const year = dayjs().year();
  const leaveTypes = await knex('leave_types').select('id', 'code', 'default_annual_days');
  const leaveTypeId = new Map(leaveTypes.map((t) => [t.code as string, t.id as number]));

  const balances = [...employeeId.values()].flatMap((empId) =>
    leaveTypes.map((type) => ({
      employee_id: empId,
      leave_type_id: type.id as number,
      year,
      entitled_days: type.default_annual_days as number,
      used_days: 0,
      pending_days: 0,
      carried_over_days: type.code === 'ANNUAL' ? 3 : 0,
    })),
  );
  await knex('leave_balances').insert(balances);

  // --- Leave requests in every workflow state -------------------------------
  const today = dayjs();
  const requests = [
    {
      employee_id: employeeId.get('EMP-1004')!,
      leave_type_id: leaveTypeId.get('ANNUAL')!,
      start_date: today.add(18, 'day').format('YYYY-MM-DD'),
      end_date: today.add(22, 'day').format('YYYY-MM-DD'),
      total_days: 5,
      reason: 'Family wedding in Chennai.',
      status: 'PENDING',
      current_approver_id: employeeId.get('EMP-1003')!,
    },
    {
      employee_id: employeeId.get('EMP-1005')!,
      leave_type_id: leaveTypeId.get('ANNUAL')!,
      start_date: today.add(30, 'day').format('YYYY-MM-DD'),
      end_date: today.add(37, 'day').format('YYYY-MM-DD'),
      total_days: 6,
      reason: 'Hiking trip, flights already booked.',
      status: 'MANAGER_APPROVED',
      current_approver_id: employeeId.get('EMP-1002')!,
    },
    {
      employee_id: employeeId.get('EMP-1006')!,
      leave_type_id: leaveTypeId.get('SICK')!,
      start_date: today.subtract(9, 'day').format('YYYY-MM-DD'),
      end_date: today.subtract(8, 'day').format('YYYY-MM-DD'),
      total_days: 2,
      reason: 'Flu, doctor advised rest.',
      status: 'APPROVED',
      current_approver_id: null,
      decided_at: today.subtract(9, 'day').toDate(),
    },
    {
      employee_id: employeeId.get('EMP-1007')!,
      leave_type_id: leaveTypeId.get('ANNUAL')!,
      start_date: today.add(3, 'day').format('YYYY-MM-DD'),
      end_date: today.add(12, 'day').format('YYYY-MM-DD'),
      total_days: 8,
      reason: 'Requested during the release freeze window.',
      status: 'REJECTED',
      current_approver_id: null,
      decided_at: today.subtract(2, 'day').toDate(),
    },
    {
      employee_id: employeeId.get('EMP-1009')!,
      leave_type_id: leaveTypeId.get('ANNUAL')!,
      start_date: today.add(45, 'day').format('YYYY-MM-DD'),
      end_date: today.add(46, 'day').format('YYYY-MM-DD'),
      total_days: 2,
      reason: 'Plans changed, withdrawing the request.',
      status: 'CANCELLED',
      current_approver_id: null,
    },
    {
      employee_id: employeeId.get('EMP-1012')!,
      leave_type_id: leaveTypeId.get('ANNUAL')!,
      start_date: today.add(6, 'day').format('YYYY-MM-DD'),
      end_date: today.add(6, 'day').format('YYYY-MM-DD'),
      total_days: 1,
      half_day: true,
      reason: 'Afternoon off for a house closing.',
      status: 'PENDING',
      current_approver_id: employeeId.get('EMP-1011')!,
    },
    {
      employee_id: employeeId.get('EMP-1010')!,
      leave_type_id: leaveTypeId.get('BEREAVEMENT')!,
      start_date: today.subtract(25, 'day').format('YYYY-MM-DD'),
      end_date: today.subtract(23, 'day').format('YYYY-MM-DD'),
      total_days: 3,
      reason: 'Family bereavement.',
      status: 'APPROVED',
      current_approver_id: null,
      decided_at: today.subtract(26, 'day').toDate(),
    },
  ];
  await knex('leave_requests').insert(requests);

  const stored = await knex('leave_requests').select('id', 'employee_id', 'status', 'total_days', 'leave_type_id');

  // Mirror the balance side-effects the service would have applied.
  for (const request of stored) {
    const column = request.status === 'APPROVED' ? 'used_days' : 'pending_days';
    if (request.status === 'REJECTED' || request.status === 'CANCELLED') continue;
    await knex('leave_balances')
      .where({ employee_id: request.employee_id, leave_type_id: request.leave_type_id, year })
      .increment(column, Number(request.total_days));
  }

  const approvalRows = stored
    .filter((r) => ['MANAGER_APPROVED', 'APPROVED', 'REJECTED'].includes(r.status as string))
    .map((r) => ({
      leave_request_id: r.id as number,
      approver_id: employeeId.get('EMP-1003')!,
      stage: 'MANAGER' as const,
      decision: (r.status === 'REJECTED' ? 'REJECTED' : 'APPROVED') as 'APPROVED' | 'REJECTED',
      comments:
        r.status === 'REJECTED'
          ? 'Overlaps the 1.4 release freeze — please resubmit for the following week.'
          : 'Coverage confirmed with the team.',
    }));
  if (approvalRows.length) await knex('leave_approvals').insert(approvalRows);

  const hrApprovals = stored
    .filter((r) => r.status === 'APPROVED')
    .map((r) => ({
      leave_request_id: r.id as number,
      approver_id: employeeId.get('EMP-1002')!,
      stage: 'HR' as const,
      decision: 'APPROVED' as const,
      comments: 'Balance verified, payroll notified.',
    }));
  if (hrApprovals.length) await knex('leave_approvals').insert(hrApprovals);

  // --- Timesheets -----------------------------------------------------------
  const weekStart = today.startOf('week').add(1, 'day'); // ISO Monday
  const [timesheetId] = await knex('timesheets').insert({
    employee_id: employeeId.get('EMP-1004')!,
    week_start_date: weekStart.format('YYYY-MM-DD'),
    status: 'SUBMITTED',
    total_hours: 38,
    submitted_at: today.toDate(),
  });

  const entries = [0, 1, 2, 3, 4].flatMap((dayOffset) => [
    {
      timesheet_id: timesheetId as number,
      project_id: projectId.get('ATLAS')!,
      work_date: weekStart.add(dayOffset, 'day').format('YYYY-MM-DD'),
      hours: dayOffset === 4 ? 4 : 5,
      notes: 'Ingestion pipeline hardening.',
    },
    {
      timesheet_id: timesheetId as number,
      project_id: projectId.get('PORTAL')!,
      work_date: weekStart.add(dayOffset, 'day').format('YYYY-MM-DD'),
      hours: dayOffset === 4 ? 2 : 3,
      notes: 'Leave approval workflow.',
    },
  ]);
  await knex('timesheet_entries').insert(entries);

  // --- Announcements --------------------------------------------------------
  const [benefitsId] = await knex('announcements').insert({
    author_id: employeeId.get('EMP-1002')!,
    title: 'Open enrolment for 2026 benefits closes on the 30th',
    body:
      'Medical, dental and vision elections for the 2026 plan year must be submitted before the end of the month. '
      + 'Review the updated plan comparison in Documents, then confirm your elections with People Operations.',
    audience: 'ALL',
    is_pinned: true,
    published_at: today.subtract(4, 'day').toDate(),
    expires_at: today.add(20, 'day').toDate(),
  });

  await knex('announcements').insert([
    {
      author_id: employeeId.get('EMP-1002')!,
      title: 'Quarterly all-hands moved to Thursday 3pm ET',
      body: 'The Q1 all-hands has shifted by one day. Calendar invites have been updated automatically.',
      audience: 'ALL',
      published_at: today.subtract(1, 'day').toDate(),
    },
    {
      author_id: employeeId.get('EMP-1002')!,
      title: 'Reminder: approve outstanding timesheets before payroll cut-off',
      body: 'Managers, please clear your approval queue by Friday 12pm ET so payroll can be finalised.',
      audience: 'MANAGERS',
      published_at: today.subtract(2, 'day').toDate(),
    },
  ]);

  await knex('announcement_reads').insert([
    { announcement_id: benefitsId as number, employee_id: employeeId.get('EMP-1004')! },
    { announcement_id: benefitsId as number, employee_id: employeeId.get('EMP-1003')! },
  ]);

  // --- Documents ------------------------------------------------------------
  await knex('documents').insert([
    {
      employee_id: employeeId.get('EMP-1004')!,
      uploaded_by_id: employeeId.get('EMP-1002')!,
      title: 'Offer Letter — Senior Software Engineer',
      category: 'CONTRACT',
      original_filename: 'offer-letter-priya-raman.pdf',
      storage_key: 'documents/seed-offer-letter-1004.pdf',
      mime_type: 'application/pdf',
      size_bytes: 184_320,
      visibility: 'PRIVATE',
    },
    {
      employee_id: null,
      uploaded_by_id: employeeId.get('EMP-1002')!,
      title: '2026 Employee Handbook',
      category: 'POLICY',
      original_filename: 'employee-handbook-2026.pdf',
      storage_key: 'documents/seed-handbook-2026.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2_310_144,
      visibility: 'COMPANY',
    },
  ]);
}
