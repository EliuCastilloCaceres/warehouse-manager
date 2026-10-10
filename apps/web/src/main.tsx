import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { Providers } from './app/providers';
import { showUpdateToast } from './app/pwaUpdate';
import { routes } from './app/routes';
import './index.css';

const router = createBrowserRouter(routes);

// Con `registerType: 'prompt'` la versión nueva espera a que el usuario toque "Actualizar".
const updateServiceWorker = registerSW({
  onNeedRefresh: () => showUpdateToast(() => updateServiceWorker(true)),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
