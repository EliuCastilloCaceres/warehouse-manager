import type { RouteObject } from 'react-router';
import { HomePage } from '@/features/home/HomePage';
import { ComingSoonPage } from '@/shared/ComingSoonPage';
import { NotFoundPage } from '@/shared/NotFoundPage';
import { AppLayout } from './AppLayout';
import { MODULES } from './modules';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      ...MODULES.map(({ path, label }) => ({
        path,
        element: <ComingSoonPage title={label} />,
      })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
