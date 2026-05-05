import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { asyncHandler } from '@utils/asyncHandler';
import { orgChartService } from './orgchart.service';

export const orgChartController = {
  getChart: asyncHandler(async (req: Request, res: Response) => {
    const result = await orgChartService.getChart(
      currentUser(req),
      req.query.rootEmployeeId ? Number(req.query.rootEmployeeId) : undefined,
      req.query.maxDepth ? Number(req.query.maxDepth) : undefined,
    );
    // The chart changes rarely; a short private cache keeps re-renders snappy
    // without risking a stale tree after a reorg.
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.status(200).json(result);
  }),
};
