export interface ChromeHostPermissions {
  contains(origin: string): Promise<boolean>;
  request(origin: string): Promise<boolean>;
}

interface ChromePermissionsApi {
  contains(input: { readonly origins: readonly string[] }): Promise<boolean>;
  request(input: { readonly origins: readonly string[] }): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Converts a provider base URL into the narrowest Chrome origin pattern that
 * still covers its API paths. Only https (and loopback http) are accepted so a
 * custom endpoint can never downgrade transport for a stored API key.
 */
export function hostPermissionPattern(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  const isLoopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && !isLoopback) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.protocol}//${url.host}/*`;
}

export function createChromeHostPermissions(
  chromeValue: unknown,
): ChromeHostPermissions {
  const permissions = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "permissions") as unknown)
    : null;
  const contains = isRecord(permissions)
    ? Reflect.get(permissions, "contains")
    : null;
  const request = isRecord(permissions)
    ? Reflect.get(permissions, "request")
    : null;
  if (
    !isRecord(permissions) ||
    typeof contains !== "function" ||
    typeof request !== "function"
  ) {
    throw new Error("Chrome optional permissions are unavailable");
  }
  const api: ChromePermissionsApi = {
    contains: (input) =>
      Reflect.apply(contains, permissions, [input]) as Promise<boolean>,
    request: (input) =>
      Reflect.apply(request, permissions, [input]) as Promise<boolean>,
  };
  return Object.freeze({
    async contains(origin: string): Promise<boolean> {
      const pattern = hostPermissionPattern(origin);
      if (pattern === null) return false;
      try {
        return await api.contains({ origins: [pattern] });
      } catch {
        return false;
      }
    },
    async request(origin: string): Promise<boolean> {
      const pattern = hostPermissionPattern(origin);
      if (pattern === null) return false;
      return api.request({ origins: [pattern] });
    },
  });
}
