import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireRole } from '../auth/auth-guard.js';

export function registerStaffRoutes(router, { authService, staffService }) {
  const managerOnly = (handler) => requireRole(authService, ['manager'], handler);

  router.get(
    '/api/v1/staff',
    managerOnly(async ({ response, requestId, searchParams }) => {
      const result = await staffService.listStaff(searchParams);
      sendData(response, 200, result.items, requestId, result.meta);
    }),
  );

  router.post(
    '/api/v1/staff',
    managerOnly(async ({ request, response, requestId }) => {
      const staff = await staffService.createLibrarian(await readJsonBody(request));
      sendData(response, 201, staff, requestId);
    }),
  );

  router.patch(
    '/api/v1/staff/me',
    managerOnly(async ({ request, response, requestId, actor }) => {
      const staff = await staffService.updateOwnProfile(actor, await readJsonBody(request));
      sendData(response, 200, staff, requestId);
    }),
  );

  router.patch(
    '/api/v1/staff/me/password',
    managerOnly(async ({ request, response, requestId, actor }) => {
      const result = await staffService.changeOwnPassword(actor, await readJsonBody(request));
      sendData(response, 200, result, requestId);
    }),
  );

  router.patch(
    '/api/v1/staff/:staffId/activity',
    managerOnly(async ({ request, response, requestId, params }) => {
      const staff = await staffService.setLibrarianActivity(
        params.staffId,
        await readJsonBody(request),
      );
      sendData(response, 200, staff, requestId);
    }),
  );

  router.patch(
    '/api/v1/staff/:staffId/password',
    managerOnly(async ({ request, response, requestId, params }) => {
      const result = await staffService.changeLibrarianPassword(
        params.staffId,
        await readJsonBody(request),
      );
      sendData(response, 200, result, requestId);
    }),
  );
}
