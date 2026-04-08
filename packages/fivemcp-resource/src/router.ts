export type RouteMethod = "GET" | "POST";

export interface RouteMatch {
  params: Record<string, string>;
}

export interface RouteDefinition<TContext> {
  method: RouteMethod;
  path: string;
  handler: (
    context: TContext,
    match: RouteMatch,
  ) => Promise<void> | void;
}

function normalizePath(path: string): string[] {
  const withoutQuery = path.split("?")[0] ?? path;
  return withoutQuery
    .split("/")
    .filter(Boolean);
}

export class Router<TContext> {
  private readonly routes: RouteDefinition<TContext>[] = [];

  get(path: string, handler: RouteDefinition<TContext>["handler"]): void {
    this.routes.push({ method: "GET", path, handler });
  }

  post(path: string, handler: RouteDefinition<TContext>["handler"]): void {
    this.routes.push({ method: "POST", path, handler });
  }

  async handle(method: string, path: string, context: TContext): Promise<boolean> {
    const normalizedMethod = method.toUpperCase() as RouteMethod;
    const actualSegments = normalizePath(path);

    for (const route of this.routes) {
      if (route.method !== normalizedMethod) {
        continue;
      }

      const expectedSegments = normalizePath(route.path);
      if (expectedSegments.length !== actualSegments.length) {
        continue;
      }

      const params: Record<string, string> = {};
      let matched = true;

      for (let index = 0; index < expectedSegments.length; index += 1) {
        const expected = expectedSegments[index];
        const actual = actualSegments[index];

        if (!expected || !actual) {
          matched = false;
          break;
        }

        if (expected.startsWith(":")) {
          params[expected.slice(1)] = decodeURIComponent(actual);
          continue;
        }

        if (expected !== actual) {
          matched = false;
          break;
        }
      }

      if (!matched) {
        continue;
      }

      await route.handler(context, { params });
      return true;
    }

    return false;
  }
}
