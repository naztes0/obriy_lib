import { AppError } from './app-error.js';

function compilePath(pattern) {
  const parameterNames = [];
  const segments = pattern.split('/').filter(Boolean);
  const source = segments
    .map((segment) => {
      if (segment.startsWith(':')) {
        parameterNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return {
    expression: new RegExp(`^/${source}/?$`),
    parameterNames,
  };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const { expression, parameterNames } = compilePath(pattern);
    this.routes.push({ method: method.toUpperCase(), pattern, expression, parameterNames, handler });
    return this;
  }

  get(pattern, handler) {
    return this.add('GET', pattern, handler);
  }

  post(pattern, handler) {
    return this.add('POST', pattern, handler);
  }

  patch(pattern, handler) {
    return this.add('PATCH', pattern, handler);
  }

  async handle(request, response, context) {
    const url = new URL(request.url, 'http://localhost');
    const pathMatches = [];

    for (const route of this.routes) {
      const match = route.expression.exec(url.pathname);
      if (!match) continue;

      pathMatches.push(route);
      if (route.method !== request.method) continue;

      let params;
      try {
        params = Object.fromEntries(
          route.parameterNames.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
        );
      } catch {
        throw new AppError(400, 'INVALID_PATH', 'Некоректний параметр у адресі запиту.');
      }

      await route.handler({ ...context, request, response, params, searchParams: url.searchParams });
      return;
    }

    if (pathMatches.length > 0) {
      const allowedMethods = [...new Set(pathMatches.map((route) => route.method))].sort();
      throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Цей метод не підтримується для вказаного маршруту.', {
        allowedMethods,
      });
    }

    throw new AppError(404, 'NOT_FOUND', 'Маршрут не знайдено.');
  }
}
