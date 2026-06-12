import axios, { AxiosError } from "axios";
import { APIService } from "./APIService";
import { ServerError } from "./ServerError";
import { setHttpLogger } from "./httpLogger";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockInstance = () => ({
  get: jest.fn().mockResolvedValue({ data: { ok: true } }),
  post: jest.fn().mockResolvedValue({ data: { ok: true } }),
  put: jest.fn().mockResolvedValue({ data: { ok: true } }),
  patch: jest.fn().mockResolvedValue({ data: { ok: true } }),
  delete: jest.fn().mockResolvedValue({ data: { ok: true } }),
});

describe("APIService verbs", () => {
  let instance: ReturnType<typeof mockInstance>;

  beforeEach(() => {
    instance = mockInstance();
    mockedAxios.create.mockReturnValue(instance as any);
    setHttpLogger(null);
  });

  it("get returns response.data and passes query as params", async () => {
    const result = await APIService.get({ baseURL: "http://x", url: "/a", query: { q: 1 } });
    expect(result).toEqual({ ok: true });
    expect(instance.get).toHaveBeenCalledWith("/a", { params: { q: 1 } });
  });

  it("post sends body", async () => {
    await APIService.post({ baseURL: "http://x", url: "/a", body: { name: "n" } });
    expect(instance.post).toHaveBeenCalledWith("/a", { name: "n" }, { params: undefined });
  });

  it("put and patch send body", async () => {
    await APIService.put({ baseURL: "http://x", url: "/a", body: { v: 1 } });
    expect(instance.put).toHaveBeenCalledWith("/a", { v: 1 }, { params: undefined });
    await APIService.patch({ baseURL: "http://x", url: "/a", body: { v: 2 } });
    expect(instance.patch).toHaveBeenCalledWith("/a", { v: 2 }, { params: undefined });
  });

  it("delete forwards body as data when present", async () => {
    await APIService.delete({ baseURL: "http://x", url: "/a", body: { ids: [1] } });
    expect(instance.delete).toHaveBeenCalledWith("/a", { params: undefined, data: { ids: [1] } });
  });

  it("delete omits data when no body", async () => {
    await APIService.delete({ baseURL: "http://x", url: "/a" });
    expect(instance.delete).toHaveBeenCalledWith("/a", { params: undefined });
  });

  it("builds the instance with bearer token, custom headers and timeout", async () => {
    await APIService.get({
      baseURL: "http://x",
      url: "/a",
      token: "t0k3n",
      headers: { "x-extra": "1" },
      timeout: 5000,
    });
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://x",
        timeout: 5000,
        headers: expect.objectContaining({
          Authorization: "Bearer t0k3n",
          "x-extra": "1",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("defaults timeout to 1000ms", async () => {
    await APIService.get({ baseURL: "http://x", url: "/a" });
    expect(mockedAxios.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 1000 }));
  });

  it("exposes throttledPromises for batch call sites", () => {
    expect(typeof APIService.throttledPromises).toBe("function");
  });
});

describe("injected logger", () => {
  let instance: ReturnType<typeof mockInstance>;

  beforeEach(() => {
    instance = mockInstance();
    mockedAxios.create.mockReturnValue(instance as any);
  });

  afterEach(() => setHttpLogger(null));

  it("logs the benchmark through the injected logger", async () => {
    const info = jest.fn();
    setHttpLogger({ info });
    await APIService.get({ baseURL: "http://x", url: "/a" });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "APISERVICE TIME:",
        description: expect.stringMatching(/^\[GET\] \/a took \d+(\.\d+)?ms$/),
      })
    );
  });

  it("silent: true skips the benchmark on any verb", async () => {
    const info = jest.fn();
    setHttpLogger({ info });
    await APIService.post({ baseURL: "http://x", url: "/a", silent: true });
    await APIService.get({ baseURL: "http://x", url: "/a", silent: true });
    expect(info).not.toHaveBeenCalled();
  });

  it("without a logger it stays silent and does not throw", async () => {
    setHttpLogger(null);
    await expect(APIService.get({ baseURL: "http://x", url: "/a" })).resolves.toEqual({ ok: true });
  });
});

describe("handleError", () => {
  const axiosError = (overrides: Partial<AxiosError>): AxiosError =>
    ({
      message: "Request failed",
      config: { url: "/a", baseURL: "http://x", method: "get" },
      ...overrides,
    } as AxiosError);

  it("null/undefined → UNKNOWN", () => {
    const error = APIService.handleError(null);
    expect(error.type).toBe("UNKNOWN");
    expect(error.origin).toBe("SERVICE");
    expect(error.message).toBe("Unknown error occurred");
  });

  it("4xx response → RULE with full serviceContext and chained cause", () => {
    const original = axiosError({
      response: {
        status: 404,
        statusText: "Not Found",
        data: { message: "patient not found" },
        headers: { "x-h": "1" },
      } as any,
    });
    const error = APIService.handleError(original, "HIS");
    expect(error.type).toBe("RULE");
    expect(error.message).toBe('Error from HIS - "patient not found"');
    expect(error.cause).toBe(original);
    expect(error.serviceContext).toEqual(
      expect.objectContaining({
        service: "HIS",
        url: "/a",
        baseURL: "http://x",
        method: "get",
        status: 404,
        statusText: "Not Found",
        responseData: { message: "patient not found" },
      })
    );
  });

  it("5xx response → API (external failure, distinguishable from our own bugs)", () => {
    const error = APIService.handleError(
      axiosError({ response: { status: 503, statusText: "down", data: "maintenance", headers: {} } as any })
    );
    expect(error.type).toBe("API");
    expect(error.status).toBe(500);
    expect(ServerError.isSignal(error)).toBe(true);
    expect(error.message).toBe('Error from API - "maintenance"');
  });

  it("code travels in serviceContext also when there IS a response", () => {
    const error = APIService.handleError(
      axiosError({
        code: "ERR_BAD_RESPONSE",
        response: { status: 502, statusText: "bad gateway", data: "", headers: {} } as any,
      })
    );
    expect(error.serviceContext?.code).toBe("ERR_BAD_RESPONSE");
  });

  it("object responseData without message gets serialized, not [object Object]", () => {
    const error = APIService.handleError(
      axiosError({ response: { status: 400, statusText: "bad", data: { code: 7 }, headers: {} } as any })
    );
    expect(error.message).toContain('{"code":7}');
    expect(error.message).not.toContain("[object Object]");
  });

  it("no response (timeout/DNS) → API with request context and code", () => {
    const original = axiosError({ message: "timeout of 1000ms exceeded", code: "ECONNABORTED" });
    const error = APIService.handleError(original, "OCA");
    expect(error.type).toBe("API");
    expect(error.message).toBe("timeout of 1000ms exceeded");
    expect(error.cause).toBe(original);
    expect(error.serviceContext).toEqual(
      expect.objectContaining({ service: "OCA", url: "/a", code: "ECONNABORTED" })
    );
  });

  it("defaults service to API in serviceContext", () => {
    const error = APIService.handleError(axiosError({ message: "boom" }));
    expect(error.serviceContext?.service).toBe("API");
  });

  it("unserializable response payloads degrade safely", () => {
    const circular: any = {};
    circular.self = circular;
    const error = APIService.handleError(
      axiosError({ response: { status: 500, statusText: "err", data: circular, headers: {} } as any })
    );
    expect(error.serviceContext?.responseData).toEqual({ unserializable: true });
  });
});
