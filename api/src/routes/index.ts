import { Router } from 'express';
import { pingDatabase } from '@config/knex';
import { asyncHandler } from '@utils/asyncHandler';
import { apiRateLimiter } from '@middleware/rateLimiter';
import { authRoutes } from '@modules/auth/auth.routes';
import { employeesRoutes } from '@modules/employees/employees.routes';
import { departmentsRoutes } from '@modules/departments/departments.routes';
import { leaveRoutes } from '@modules/leave/leave.routes';
import { timesheetsRoutes } from '@modules/timesheets/timesheets.routes';
import { documentsRoutes } from '@modules/documents/documents.routes';
import { announcementsRoutes } from '@modules/announcements/announcements.routes';
import { orgChartRoutes } from '@modules/orgchart/orgchart.routes';
import { dashboardRoutes } from '@modules/dashboard/dashboard.routes';

const router = Router();

/**
 * Readiness probe.
 *
 * Distinct from the liveness endpoint in `app.ts`: this one touches MySQL, so
 * an orchestrator can stop routing traffic to a pod whose database connection
 * has gone away without also restarting the container. The smoke-test stage of
 * the Jenkins pipeline polls exactly this path.
 */
router.get(
  '/health/ready',
  asyncHandler(async (_req, res) => {
    const databaseUp = await pingDatabase();
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? 'ready' : 'degraded',
      checks: { database: databaseUp ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    });
  }),
);

// Rate limiting applies to every business endpoint but not to the probes, so a
// noisy orchestrator cannot exhaust the budget for real users.
router.use(apiRateLimiter);

router.use('/auth', authRoutes);
router.use('/employees', employeesRoutes);
router.use('/departments', departmentsRoutes);
router.use('/leave', leaveRoutes);
router.use('/timesheets', timesheetsRoutes);
router.use('/documents', documentsRoutes);
router.use('/announcements', announcementsRoutes);
router.use('/org-chart', orgChartRoutes);
router.use('/dashboard', dashboardRoutes);

export const apiRouter = router;
