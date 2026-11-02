import { readJsonBody } from '../../http/request-body.js';
import { sendData } from '../../http/response.js';
import { requireAuthentication, requireRole } from '../auth/auth-guard.js';

export function registerSchoolClassRoutes(router, { authService, schoolClassService }) {
  router.get(
    '/api/v1/school-classes',
    requireAuthentication(authService, async ({ response, requestId, searchParams }) => {
      const classes = await schoolClassService.list(searchParams);
      sendData(response, 200, classes, requestId);
    }),
  );

  router.post(
    '/api/v1/school-classes',
    requireRole(authService, ['manager'], async ({ request, response, requestId }) => {
      const schoolClass = await schoolClassService.create(await readJsonBody(request));
      sendData(response, 201, schoolClass, requestId);
    }),
  );

  router.patch(
    '/api/v1/school-classes/:classId',
    requireRole(authService, ['manager'], async ({ request, response, requestId, params }) => {
      const schoolClass = await schoolClassService.rename(
        params.classId,
        await readJsonBody(request),
      );
      sendData(response, 200, schoolClass, requestId);
    }),
  );

  router.patch(
    '/api/v1/school-classes/:classId/activity',
    requireRole(authService, ['manager'], async ({ request, response, requestId, params }) => {
      const schoolClass = await schoolClassService.setActive(
        params.classId,
        await readJsonBody(request),
      );
      sendData(response, 200, schoolClass, requestId);
    }),
  );
}
