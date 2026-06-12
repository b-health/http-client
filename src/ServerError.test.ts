import { ServerError, ErrorT } from "./ServerError";

describe("ServerError", () => {
  describe("status mapping (single source of truth)", () => {
    const cases: [ErrorT, number][] = [
      ["RULE", 400],
      ["SCHEMA", 400],
      ["UNAUTHORIZED", 401],
      ["NOT-FOUND", 404],
      ["INVALID-TYPE", 500],
      ["API", 500],
      ["UNKNOWN", 500],
    ];

    it.each(cases)("%s → %i", (type, expected) => {
      const error = new ServerError({ message: "x", type, origin: "ENTITY" });
      expect(error.status).toBe(expected);
    });
  });

  describe("isExpected / isSignal capture policy", () => {
    it("4xx types are expected and not a signal", () => {
      for (const type of ["RULE", "SCHEMA", "UNAUTHORIZED", "NOT-FOUND"] as ErrorT[]) {
        const error = new ServerError({ message: "x", type, origin: "ENTITY" });
        expect(error.isExpected()).toBe(true);
        expect(ServerError.isSignal(error)).toBe(false);
      }
    });

    it("5xx types are a signal", () => {
      for (const type of ["UNKNOWN", "API", "INVALID-TYPE"] as ErrorT[]) {
        const error = new ServerError({ message: "x", type, origin: "ENTITY" });
        expect(error.isExpected()).toBe(false);
        expect(ServerError.isSignal(error)).toBe(true);
      }
    });

    it("native errors and loose values are always a signal", () => {
      expect(ServerError.isSignal(new Error("boom"))).toBe(true);
      expect(ServerError.isSignal("loose string")).toBe(true);
      expect(ServerError.isSignal(undefined)).toBe(true);
    });
  });

  describe("cause chaining", () => {
    it("uses the explicit cause when provided", () => {
      const original = new Error("axios timeout");
      const error = new ServerError({
        message: "x",
        type: "UNKNOWN",
        origin: "SERVICE",
        error: { body: "response data" },
        cause: original,
      });
      expect(error.cause).toBe(original);
      expect(error.error).toEqual({ body: "response data" });
    });

    it("falls back to error as cause when no explicit cause is given", () => {
      const original = new Error("db down");
      const error = new ServerError({ message: "x", type: "UNKNOWN", origin: "DB", error: original });
      expect(error.cause).toBe(original);
    });

    it("leaves cause undefined when neither is given", () => {
      const error = new ServerError({ message: "x", type: "RULE", origin: "ENTITY" });
      expect(error.cause).toBeUndefined();
    });
  });

  it("stores serviceContext", () => {
    const error = new ServerError({
      message: "x",
      type: "UNKNOWN",
      origin: "SERVICE",
      serviceContext: { service: "HIS", url: "/patients", status: 503 },
    });
    expect(error.serviceContext).toEqual({ service: "HIS", url: "/patients", status: 503 });
  });

  it("defaults origin to ENTITY", () => {
    const error = new ServerError({ message: "x", type: "RULE" } as any);
    expect(error.origin).toBe("ENTITY");
  });

  it("type predicates", () => {
    expect(new ServerError({ type: "UNKNOWN", origin: "ENTITY" }).isUnknown()).toBe(true);
    expect(new ServerError({ type: "SCHEMA", origin: "ENTITY" }).isSchema()).toBe(true);
    expect(new ServerError({ type: "UNAUTHORIZED", origin: "ENTITY" }).isUnauthorized()).toBe(true);
    expect(new ServerError({ type: "RULE", origin: "DB" }).isFromDB()).toBe(true);
  });

  it("isServerError narrows the type", () => {
    const error: unknown = new ServerError({ message: "x", type: "RULE", origin: "ENTITY" });
    expect(ServerError.isServerError(error)).toBe(true);
    expect(ServerError.isServerError(new Error("x"))).toBe(false);
  });

  it("hasMessage", () => {
    expect(new ServerError({ message: "x", type: "RULE", origin: "ENTITY" }).hasMessage()).toBe(true);
    expect(new ServerError({ type: "RULE", origin: "ENTITY" }).hasMessage()).toBe(false);
  });

  describe("signal override (4xx machine-to-machine)", () => {
    it("signal=true turns a 4xx into a signal without changing its status", () => {
      const error = new ServerError({ type: "UNAUTHORIZED", origin: "MIDDLEWARE", signal: true });
      expect(error.status).toBe(401);
      expect(error.isExpected()).toBe(false);
      expect(ServerError.isSignal(error)).toBe(true);
    });

    it("signal=false silences a 5xx type explicitly", () => {
      const error = new ServerError({ type: "API", origin: "SERVICE", signal: false });
      expect(error.status).toBe(500);
      expect(error.isExpected()).toBe(true);
      expect(ServerError.isSignal(error)).toBe(false);
    });

    it("signal can be set after construction (middleware marking pattern)", () => {
      const error = new ServerError({ type: "UNAUTHORIZED", origin: "MIDDLEWARE" });
      expect(ServerError.isSignal(error)).toBe(false);
      error.signal = true;
      expect(ServerError.isSignal(error)).toBe(true);
    });

    it("without signal, the status-derived policy applies untouched", () => {
      expect(new ServerError({ type: "RULE", origin: "ENTITY" }).isExpected()).toBe(true);
      expect(new ServerError({ type: "UNKNOWN", origin: "ENTITY" }).isExpected()).toBe(false);
    });
  });

  it("statics are inherited by subclasses (consumer extension pattern)", () => {
    class DomainError extends ServerError {}
    const error = new DomainError({ message: "x", type: "RULE", origin: "ENTITY" });
    expect(DomainError.isSignal(error)).toBe(false);
    expect(ServerError.isServerError(error)).toBe(true);
  });
});
