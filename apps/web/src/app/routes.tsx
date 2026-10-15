import type { PermissionCode } from '@warehouse-manager/shared';
import type { ReactNode } from 'react';
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
import { BranchCartsPage } from '@/features/pos/BranchCartsPage';
import { CheckoutPage } from '@/features/pos/CheckoutPage';
import { CloseSessionPage } from '@/features/pos/CloseSessionPage';
import { PosHomePage } from '@/features/pos/PosHomePage';
import { PosRegisterPage } from '@/features/pos/PosRegisterPage';
import { PosSalePage } from '@/features/pos/PosSalePage';
import { SessionSalesPage } from '@/features/pos/SessionSalesPage';
import { BulkImportPage } from '@/features/products/BulkImportPage';
import { LabelsPage } from '@/features/products/LabelsPage';
import { ProductFormPage } from '@/features/products/ProductFormPage';
import { ProductsListPage } from '@/features/products/ProductsListPage';
import { BranchSettingsForm } from '@/features/settings/BranchSettingsForm';
import { CashRegistersTab } from '@/features/settings/CashRegistersTab';
import { SettingsIndex, SettingsPage } from '@/features/settings/SettingsPage';
import { UserFormPage } from '@/features/users/UserFormPage';
import { UsersListPage } from '@/features/users/UsersListPage';
import { LocationLabelsPage } from '@/features/warehouse/LocationLabelsPage';
import { MovementsPage } from '@/features/warehouse/MovementsPage';
import { PutawayPage } from '@/features/warehouse/PutawayPage';
import { RelocatePage } from '@/features/warehouse/RelocatePage';
import { SearchPage } from '@/features/warehouse/SearchPage';
import { SetupPage } from '@/features/warehouse/SetupPage';
import { StagingPage } from '@/features/warehouse/StagingPage';
import { WarehouseHomePage } from '@/features/warehouse/WarehouseHomePage';
import { WarehouseMapPage } from '@/features/warehouse/WarehouseMapPage';
import { ComingSoonPage } from '@/shared/ComingSoonPage';
import { NotFoundPage } from '@/shared/NotFoundPage';
import { AppLayout } from './AppLayout';
import { MODULES } from './modules';

/** Módulos con pantallas propias; los demás siguen como "Próximamente". */
const IMPLEMENTED = new Set(['/users', '/settings', '/products', '/warehouse', '/pos']);

/** `/warehouse/*`: cada pantalla con su permiso (spec F7 §3). */
const WAREHOUSE_PAGES: readonly (readonly [path: string, PermissionCode, ReactNode])[] = [
  ['warehouse', 'warehouse.read', <WarehouseHomePage />],
  ['warehouse/map', 'warehouse.read', <WarehouseMapPage />],
  ['warehouse/search', 'warehouse.read', <SearchPage />],
  ['warehouse/putaway', 'inventory.putaway', <PutawayPage />],
  ['warehouse/relocate', 'inventory.relocate', <RelocatePage />],
  ['warehouse/staging', 'inventory.putaway', <StagingPage />],
  ['warehouse/movements', 'inventory.movements.read', <MovementsPage />],
  ['warehouse/setup', 'warehouse.manage', <SetupPage />],
  ['warehouse/labels', 'warehouse.labels', <LocationLabelsPage />],
];

/** `/pos/*` (spec F8 §3): todo con `pos.sell`; el corte, además, con `pos.session.close`. */
const POS_PAGES: readonly (readonly [path: string, PermissionCode, ReactNode])[] = [
  ['pos', 'pos.sell', <PosHomePage />],
  ['pos/sell', 'pos.sell', <PosSalePage />],
  ['pos/carts', 'pos.sell', <BranchCartsPage />],
  ['pos/register', 'pos.sell', <PosRegisterPage />],
  ['pos/checkout/:cartId', 'pos.sell', <CheckoutPage />],
  ['pos/sales', 'pos.sell', <SessionSalesPage />],
  ['pos/close', 'pos.session.close', <CloseSessionPage />],
];

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
                        path: 'products',
                        element: (
                          <RequirePermission perm="products.read">
                            <ProductsListPage />
                          </RequirePermission>
                        ),
                      },
                      {
                        path: 'products/new',
                        element: (
                          <RequirePermission perm="products.manage">
                            <ProductFormPage />
                          </RequirePermission>
                        ),
                      },
                      {
                        path: 'products/import',
                        element: (
                          <RequirePermission perm="products.import">
                            <BulkImportPage />
                          </RequirePermission>
                        ),
                      },
                      {
                        path: 'products/labels',
                        element: (
                          <RequirePermission perm="products.labels">
                            <LabelsPage />
                          </RequirePermission>
                        ),
                      },
                      {
                        path: 'products/:id',
                        element: (
                          <RequirePermission perm="products.read">
                            <ProductFormPage />
                          </RequirePermission>
                        ),
                      },
                      ...[...WAREHOUSE_PAGES, ...POS_PAGES].map(([path, perm, element]) => ({
                        path,
                        element: <RequirePermission perm={perm}>{element}</RequirePermission>,
                      })),
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
