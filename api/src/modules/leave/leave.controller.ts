import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { asyncHandler } from '@utils/asyncHandler';
import { leaveService } from './leave.service';

export const leaveController = {
  listTypes: asyncHandler(async (_req: Request, res: Response) => {
    const data = await leaveService.listLeaveTypes();
    res.status(200).json({ data });
  }),

  myRequests: asyncHandler(async (req: Request, res: Response) => {
    const page = await leaveService.listMyRequests(currentUser(req), req.query as never);
    res.status(200).json(page);
  }),

  teamRequests: asyncHandler(async (req: Request, res: Response) => {
    const page = await leaveService.listTeamRequests(currentUser(req), req.query as never);
    res.status(200).json(page);
  }),

  approvalQueue: asyncHandler(async (req: Request, res: Response) => {
    const page = await leaveService.listForApproval(currentUser(req), req.query as never);
    res.status(200).json(page);
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const result = await leaveService.getById(currentUser(req), Number(req.params.id));
    res.status(200).json(result);
  }),

  balances: asyncHandler(async (req: Request, res: Response) => {
    const data = await leaveService.getBalances(
      currentUser(req),
      req.query.employeeId ? Number(req.query.employeeId) : undefined,
      req.query.year ? Number(req.query.year) : undefined,
    );
    res.status(200).json({ data });
  }),

  submit: asyncHandler(async (req: Request, res: Response) => {
    const request = await leaveService.submit(currentUser(req), req.body);
    res.status(201).json({ request });
  }),

  decide: asyncHandler(async (req: Request, res: Response) => {
    const request = await leaveService.decide(currentUser(req), Number(req.params.id), req.body);
    res.status(200).json({ request });
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    const request = await leaveService.cancel(
      currentUser(req),
      Number(req.params.id),
      req.body?.reason,
    );
    res.status(200).json({ request });
  }),

  calendar: asyncHandler(async (req: Request, res: Response) => {
    const data = await leaveService.calendar(currentUser(req), req.query as never);
    res.status(200).json({ data });
  }),
};
