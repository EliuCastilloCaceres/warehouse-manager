import { toast } from 'sonner';
import { errorMessage } from '@/shared/api/errors';

/** Avisos (*toasts*). `error` acepta un `ApiError`/`NetworkError` y muestra su `message`. */
export const notify = {
  success: (message: string) => toast.success(message),
  info: (message: string) => toast(message),
  error: (error: unknown) => toast.error(typeof error === 'string' ? error : errorMessage(error)),
};
