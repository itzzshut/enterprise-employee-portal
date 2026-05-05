import { ApiError } from '@utils/ApiError';
import { orgChartRepository, type OrgChartFlatRow } from './orgchart.repository';
import type { AuthenticatedUser } from '@/types/express';

export interface OrgNode {
  id: number;
  managerId: number | null;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  departmentName: string | null;
  location: string | null;
  avatarUrl: string | null;
  depth: number;
  directReports: number;
  totalReports: number;
  children: OrgNode[];
}

/**
 * Turns the flat CTE result into a nested tree in a single pass.
 *
 * Rows arrive ordered by their materialised `path`, so a parent is always seen
 * before its children — which means one map lookup per row is enough and no
 * recursion is needed here.
 */
export function buildTree(rows: OrgChartFlatRow[]): OrgNode | null {
  if (!rows.length) return null;

  const byId = new Map<number, OrgNode>();
  const roots: OrgNode[] = [];

  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      managerId: row.manager_id,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      jobTitle: row.job_title,
      departmentName: row.department_name,
      location: row.location,
      avatarUrl: row.avatar_url,
      depth: row.depth,
      directReports: 0,
      totalReports: 0,
      children: [],
    });
  }

  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.manager_id === null ? undefined : byId.get(row.manager_id);
    if (parent) {
      parent.children.push(node);
      parent.directReports += 1;
    } else {
      roots.push(node);
    }
  }

  // Roll the subtree sizes up from the leaves; reversing the path-ordered rows
  // guarantees children are counted before their parent.
  for (const row of [...rows].reverse()) {
    const node = byId.get(row.id)!;
    node.totalReports = node.children.reduce(
      (sum, child) => sum + 1 + child.totalReports,
      0,
    );
  }

  if (roots.length === 1) return roots[0];

  // Multiple top-level employees (no single CEO row) — wrap them so the client
  // always receives exactly one root to render.
  return {
    id: 0,
    managerId: null,
    employeeCode: 'ORG',
    fullName: 'Organisation',
    jobTitle: 'All reporting lines',
    departmentName: null,
    location: null,
    avatarUrl: null,
    depth: 0,
    directReports: roots.length,
    totalReports: rows.length,
    children: roots,
  };
}

export const orgChartService = {
  async getChart(_actor: AuthenticatedUser, rootEmployeeId?: number, maxDepth = 8) {
    const rows = await orgChartRepository.subtree(rootEmployeeId ?? null, maxDepth);
    if (!rows.length) {
      throw ApiError.notFound(rootEmployeeId ? `Employee ${rootEmployeeId}` : 'Organisation root');
    }

    const [tree, ancestors, stats] = await Promise.all([
      Promise.resolve(buildTree(rows)),
      rootEmployeeId ? orgChartRepository.ancestors(rootEmployeeId) : Promise.resolve([]),
      orgChartRepository.stats(),
    ]);

    return {
      tree,
      breadcrumb: ancestors.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        jobTitle: row.job_title,
      })),
      stats: {
        ...stats,
        nodesReturned: rows.length,
        depthLimit: maxDepth,
      },
    };
  },
};
