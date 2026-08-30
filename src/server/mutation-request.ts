export function isSameOriginMutation(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin")?.trim();
  if (!suppliedOrigin) return false;

  try {
    const parsedOrigin = new URL(suppliedOrigin);
    if (
      (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search ||
      parsedOrigin.hash ||
      suppliedOrigin !== parsedOrigin.origin
    ) {
      return false;
    }

    const configured = process.env.RETURNSPLIT_APP_ORIGIN?.trim();
    if (configured) {
      const configuredUrl = new URL(configured);
      if (
        (configuredUrl.protocol !== "http:" && configuredUrl.protocol !== "https:") ||
        configuredUrl.username ||
        configuredUrl.password ||
        configuredUrl.pathname !== "/" ||
        configuredUrl.search ||
        configuredUrl.hash ||
        (configured !== configuredUrl.origin && configured !== `${configuredUrl.origin}/`)
      ) {
        return false;
      }
      return parsedOrigin.origin === configuredUrl.origin;
    }

    // Local development and unit tests remain zero-config. Production fails
    // closed instead of trusting a caller-controlled Host header.
    if (process.env.NODE_ENV === "production") return false;
    return parsedOrigin.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function mutationRequestId(request: Request, prefix: string): string {
  const supplied = request.headers.get("x-returnsplit-request-id")?.trim();
  if (supplied && /^[a-zA-Z0-9_-]{1,100}$/.test(supplied)) return supplied;
  return `${prefix}_${crypto.randomUUID()}`;
}
