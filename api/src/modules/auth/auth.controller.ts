import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { asyncHandler } from '@utils/asyncHandler';
import { authService, type RequestMeta } from './auth.service';

function meta(req: Request): RequestMeta {
  return { userAgent: req.header('user-agent'), ipAddress: req.ip };
}

export const authController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body, meta(req));
    res.status(200).json(result);
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.refresh(req.body.refreshToken, meta(req));
    res.status(200).json(result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(req.body?.refreshToken ?? '', req.user?.userId ?? null, meta(req));
    res.status(204).send();
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.me(currentUser(req).userId);
    res.status(200).json({ user });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.changePassword(currentUser(req).userId, req.body);
    res.status(200).json({ message: 'Password updated. Please sign in again on your other devices.' });
  }),
};
