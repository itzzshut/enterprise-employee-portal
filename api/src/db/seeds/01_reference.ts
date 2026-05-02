import type { Knex } from 'knex';

/**
 * Reference data — idempotent.
 *
 * Runs on every environment including production bootstrap, so it upserts by
 * natural key (`code`) instead of truncating. Demo people live in 02_demo_data.
 */
export async function seed(knex: Knex): Promise<void> {
  const departments = [
    {
      code: 'ENG',
      name: 'Engineering',
      description: 'Platform, product and infrastructure engineering.',
      location: 'Buffalo, NY',
      annual_budget: 4_250_000,
    },
    {
      code: 'HR',
      name: 'People Operations',
      description: 'Hiring, onboarding, benefits and employee relations.',
      location: 'Buffalo, NY',
      annual_budget: 890_000,
    },
    {
      code: 'FIN',
      name: 'Finance',
      description: 'Accounting, payroll, planning and procurement.',
      location: 'New York, NY',
      annual_budget: 1_120_000,
    },
    {
      code: 'SALES',
      name: 'Revenue',
      description: 'Enterprise sales, solution consulting and renewals.',
      location: 'Chicago, IL',
      annual_budget: 2_400_000,
    },
    {
      code: 'OPS',
      name: 'Business Operations',
      description: 'Facilities, IT support and internal tooling.',
      location: 'Remote (US)',
      annual_budget: 640_000,
    },
  ];

  for (const department of departments) {
    await knex('departments')
      .insert(department)
      .onConflict('code')
      .merge(['name', 'description', 'location', 'annual_budget']);
  }

  const leaveTypes = [
    {
      code: 'ANNUAL',
      name: 'Annual Leave',
      default_annual_days: 20,
      requires_attachment: false,
      is_paid: true,
      carry_forward_allowed: true,
      color_hex: '#2563eb',
    },
    {
      code: 'SICK',
      name: 'Sick Leave',
      default_annual_days: 10,
      requires_attachment: false,
      is_paid: true,
      carry_forward_allowed: false,
      color_hex: '#dc2626',
    },
    {
      code: 'PARENTAL',
      name: 'Parental Leave',
      default_annual_days: 60,
      requires_attachment: true,
      is_paid: true,
      carry_forward_allowed: false,
      color_hex: '#7c3aed',
    },
    {
      code: 'BEREAVEMENT',
      name: 'Bereavement Leave',
      default_annual_days: 5,
      requires_attachment: false,
      is_paid: true,
      carry_forward_allowed: false,
      color_hex: '#475569',
    },
    {
      code: 'UNPAID',
      name: 'Unpaid Leave',
      default_annual_days: 0,
      requires_attachment: false,
      is_paid: false,
      carry_forward_allowed: false,
      color_hex: '#ca8a04',
    },
  ];

  for (const leaveType of leaveTypes) {
    await knex('leave_types')
      .insert(leaveType)
      .onConflict('code')
      .merge([
        'name',
        'default_annual_days',
        'requires_attachment',
        'is_paid',
        'carry_forward_allowed',
        'color_hex',
      ]);
  }
}
