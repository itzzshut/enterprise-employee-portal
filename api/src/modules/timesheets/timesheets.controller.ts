import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { asyncHandler } from '@utils/asyncHandler';
import { timesheetsService } from './timesheets.service';

export const timesheetsController = {
  projects: asyncHandler(async (_req: Request, res: Response) => {
    const data = await timesheetsService.listProjects();
    res.status(200).json({ data });
  }),

  getWeek: asyncHandler(async (req: Request, res: Response) => {
    const timesheet = await timesheetsService.getWeek(
      currentUser(req),
      String(req.query.weekStart),
      req.query.employeeId ? Number(req.query.employeeId) : undefined,
    );
    res.status(200).json({ timesheet });
  }),

  saveWeek: asyncHandler(async (req: Request, res: Response) => {
    const timesheet = await timesheetsService.saveWeek(currentUser(req), req.body);
    res.status(200).json({ timesheet });
  }),

  submitWeek: asyncHandler(async (req: Request, res: Response) => {
    const timesheet = await timesheetsService.submitWeek(currentUser(req), String(req.body.weekStart));
    res.status(200).json({ timesheet });
  }),

  pending: asyncHandler(async (req: Request, res: Response) => {
    const data = await timesheetsService.listPending(currentUser(req));
    res.status(200).json({ data });
  }),

  decide: asyncHandler(async (req: Request, res: Response) => {
    const timesheet = await timesheetsService.decide(
      currentUser(req),
      Number(req.params.id),
      req.body,
    );
    res.status(200).json({ timesheet });
  }),

  summary: asyncHandler(async (req: Request, res: Response) => {
    const summary = await timesheetsService.summary(currentUser(req), req.query as never);
    res.status(200).json(summary);
  }),
};
