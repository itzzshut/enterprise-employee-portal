import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { authRateLimiter } from '@middleware/rateLimiter';
import { validate } from '@middleware/validate';
import { authController } from './auth.controller';
import { changePasswordSchema, loginSchema, refreshSchema } from './auth.schema';

const router = Router();

router.post('/login', authRateLimiter, validate({ body: loginSchema }), authController.login);
router.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), authController.refresh);
router.post('/logout', authController.logout);

router.get('/me', authenticate, authController.me);
router.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);

export const authRoutes = router;
