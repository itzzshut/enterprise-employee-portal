import { db } from '@config/knex';

export interface OrgChartFlatRow {
  id: number;
  manager_id: number | null;
  employee_code: string;
  full_name: string;
  job_title: string;
  avatar_url: string | null;
  department_name: string | null;
  location: string | null;
  status: string;
  depth: number;
  /** Materialised ancestor path, e.g. "1/3/4" — used for stable sorting. */
  path: string;
}

/**
 * Org chart traversal with a MySQL 8 recursive CTE.
 *
 * Why a CTE rather than repeated queries:
 *
 *   - The naive approach ("fetch my reports, then each of their reports…") is
 *     O(nodes) round trips. For our 12-person demo that is fine; for a 4,000
 *     person tree it is thousands of sequential queries and a page that takes
 *     seconds to render.
 *   - Fetching the whole `employees` table and building the tree in Node moves
 *     every row over the wire — including the 95% of the org the viewer did not
 *     ask for — and cannot be filtered or depth-limited by the database.
 *   - The CTE walks the adjacency list *inside* MySQL using
 *     idx_employees_manager, returns exactly the requested subtree in one round
 *     trip, and computes `depth` and `path` on the way down so the API layer
 *     only has to assemble the nesting.
 *
 * `depth < ?` is a hard recursion bound. Without it a cycle introduced by bad
 * data (A manages B manages A) would spin until `cte_max_recursion_depth`
 * aborts the query with an error; the guard turns that into a truncated tree
 * instead of a 500. The application also refuses to create such a cycle —
 * see employees.service.update.
 */
export const orgChartRepository = {
  async subtree(rootEmployeeId: number | null, maxDepth = 8): Promise<OrgChartFlatRow[]> {
    const rootPredicate = rootEmployeeId === null ? 'e.manager_id IS NULL' : 'e.id = ?';
    const bindings: Array<number | string> = rootEmployeeId === null ? [] : [rootEmployeeId];

    const sql = `
      WITH RECURSIVE org_tree AS (
        -- Anchor: the requested root (or every top-level employee).
        SELECT
          e.id,
          e.manager_id,
          e.employee_code,
          CONCAT_WS(' ', e.first_name, e.last_name) AS full_name,
          e.job_title,
          e.avatar_url,
          e.location,
          e.status,
          e.department_id,
          0 AS depth,
          CAST(e.id AS CHAR(200)) AS path
        FROM employees e
        WHERE ${rootPredicate}
          AND e.status <> 'TERMINATED'

        UNION ALL

        -- Recursive step: everyone reporting to a node already in the tree.
        SELECT
          e.id,
          e.manager_id,
          e.employee_code,
          CONCAT_WS(' ', e.first_name, e.last_name) AS full_name,
          e.job_title,
          e.avatar_url,
          e.location,
          e.status,
          e.department_id,
          t.depth + 1 AS depth,
          CONCAT(t.path, '/', e.id) AS path
        FROM employees e
        INNER JOIN org_tree t ON e.manager_id = t.id
        WHERE t.depth + 1 < ?
          AND e.status <> 'TERMINATED'
      )
      SELECT
        t.id,
        t.manager_id,
        t.employee_code,
        t.full_name,
        t.job_title,
        t.avatar_url,
        t.location,
        t.status,
        t.depth,
        t.path,
        d.name AS department_name
      FROM org_tree t
      LEFT JOIN departments d ON d.id = t.department_id
      ORDER BY t.path
    `;

    const result = await db.raw(sql, [...bindings, maxDepth]);
    return (result?.[0] ?? []) as OrgChartFlatRow[];
  },

  /** Ancestor chain for the breadcrumb above a focused subtree. */
  async ancestors(employeeId: number, maxDepth = 8): Promise<OrgChartFlatRow[]> {
    const result = await db.raw(
      `
      WITH RECURSIVE chain AS (
        SELECT
          e.id, e.manager_id, e.employee_code,
          CONCAT_WS(' ', e.first_name, e.last_name) AS full_name,
          e.job_title, e.avatar_url, e.location, e.status, e.department_id,
          0 AS depth, CAST(e.id AS CHAR(200)) AS path
        FROM employees e
        WHERE e.id = ?

        UNION ALL

        SELECT
          m.id, m.manager_id, m.employee_code,
          CONCAT_WS(' ', m.first_name, m.last_name) AS full_name,
          m.job_title, m.avatar_url, m.location, m.status, m.department_id,
          c.depth + 1, CAST(m.id AS CHAR(200))
        FROM employees m
        INNER JOIN chain c ON m.id = c.manager_id
        WHERE c.depth + 1 < ?
      )
      SELECT
        c.id, c.manager_id, c.employee_code, c.full_name, c.job_title,
        c.avatar_url, c.location, c.status, c.depth, c.path,
        d.name AS department_name
      FROM chain c
      LEFT JOIN departments d ON d.id = c.department_id
      WHERE c.id <> ?
      ORDER BY c.depth DESC
      `,
      [employeeId, maxDepth, employeeId],
    );
    return (result?.[0] ?? []) as OrgChartFlatRow[];
  },

  /** Aggregate stats rendered alongside the chart. */
  async stats(): Promise<{ totalActive: number; managers: number; maxDepth: number }> {
    const result = await db.raw(`
      WITH RECURSIVE org_tree AS (
        SELECT id, manager_id, 1 AS depth
          FROM employees
         WHERE manager_id IS NULL AND status <> 'TERMINATED'
        UNION ALL
        SELECT e.id, e.manager_id, t.depth + 1
          FROM employees e
          JOIN org_tree t ON e.manager_id = t.id
         WHERE t.depth < 12 AND e.status <> 'TERMINATED'
      )
      SELECT
        (SELECT COUNT(*) FROM employees WHERE status <> 'TERMINATED') AS total_active,
        (SELECT COUNT(DISTINCT manager_id) FROM employees WHERE manager_id IS NOT NULL) AS managers,
        (SELECT MAX(depth) FROM org_tree) AS max_depth
    `);
    const row = (result?.[0] ?? [])[0] as
      | { total_active: number; managers: number; max_depth: number | null }
      | undefined;
    return {
      totalActive: Number(row?.total_active ?? 0),
      managers: Number(row?.managers ?? 0),
      maxDepth: Number(row?.max_depth ?? 0),
    };
  },
};
