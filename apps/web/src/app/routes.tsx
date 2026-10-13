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
import { BranchSettingsForm } from '@/features/settings/BranchSettingsForm';
import { CashRegistersTab } from '@/features/settings/CashRegistersTab';
import { SettingsIndex, SettingsPage } from '@/features/settings/SettingsPage';
import { UserFormPage } from '@/features/users/UserFormPage';
import { UsersListPage } from '@/features/users/UsersListPage';
import { ComingSoonPage } from '@/shared/ComingSoonPage';
import { NotFoundPage } from '@/shared/NotFoundPage';
import { AppLayout } from './AppLayout';
import { MODULES } from './modules';

/** Módulos con pantallas propias; los demás siguen como "Próximamente". */
const IMPLEMENTED = new Set(['/users', '/settings']);

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
                      ...MODULES.filter(({ path }) => !IMPLEMENTED.has(path)).map(
                        ({ path, label, permissions }) => ({
                          path,
                          element: (
                            <RequirePermission anyOf={permissions}>
                              <ComingSoonPage title={label} />
                            </RequirePermission>
                          ),
                        }),
                      ),
                      {
                        path: 'settings',
                        element: (
                          <RequirePermission anyOf={['settings.branch', 'settings.registers']}>
                            <SettingsPage />
                          </RequirePermission>
                        ),
                        children: [
                          { index: true, element: <SettingsIndex /> },
                          {
                            path: 'branch',
                            element: (
                              <RequirePermission perm="settings.branch">
                                <BranchSettingsForm />
                              </RequirePermission>
                            ),
                          },
                          {
                            path: 'registers',
                            element: (
                              <RequirePermission perm="settings.registers">
                                <CashRegistersTab />
                              </RequirePermission>
                            ),
                          },
                        ],
                      },
                      {
                        path: 'users',
                        element: (
                          <RequirePermission perm="users.read">
                            <UsersListPage />
                          </RequirePermission>
                        ),
                      },
                      {
                        path: 'users/new',
                        element: (
                          <RequirePermission perm="users.manage">
                            <UserFormPage />
                          </RequirePermission>
                        ),
                      },
                      {
                        path: 'users/:id',
                        element: (
                          <RequirePermission perm="users.read">
                            <UserFormPage />
                          </RequirePermission>
                        ),
                      },
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
