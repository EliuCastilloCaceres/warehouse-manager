import { Outlet, type RouteObject } from 'react-router';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import {
  RequireAuth,
  RequireBranch,
  RequirePasswordChanged,
  RequirePermission,
} from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { BranchProvider } from '@/features/branch/BranchProvider';
import { SelectBranchPage } from '@/features/branch/SelectBranchPage';
import { ScannerTestPage } from '@/features/dev/ScannerTestPage';
import { HomePage } from '@/features/home/HomePage';
import { ComingSoonPage } from '@/shared/ComingSoonPage';
import { NotFoundPage } from '@/shared/NotFoundPage';
import { AppLayout } from './AppLayout';
import { MODULES } from './modules';

/** Sesión y sucursal viven dentro del router para poder navegar. */
function AppRoot() {
  return (
    <AuthProvider>
      <BranchProvider>
        <Outlet />
      </BranchProvider>
    </AuthProvider>
  );
}

export const routes: RouteObject[] = [
  {
    element: <AppRoot />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/change-password', element: <ChangePasswordPage /> },
          {
            element: <RequirePasswordChanged />,
            children: [
              { path: '/select-branch', element: <SelectBranchPage /> },
              {
                element: <RequireBranch />,
                children: [
                  {
                    path: '/',
                    element: <AppLayout />,
                    children: [
                      { index: true, element: <HomePage /> },
                      ...MODULES.map(({ path, label, permissions }) => ({
                        path,
                        element: (
                          <RequirePermission anyOf={permissions}>
                            <ComingSoonPage title={label} />
                          </RequirePermission>
                        ),
                      })),
                      { path: 'dev/scanner', element: <ScannerTestPage /> },
                      { path: '*', element: <NotFoundPage /> },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
