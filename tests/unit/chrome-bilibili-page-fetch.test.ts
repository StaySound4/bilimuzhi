import { describe, expect, it, vi } from "vitest";

import { createChromeBilibiliPageFetch } from "../../src/infrastructure/chrome-bilibili-page-fetch";

const REFERER = "https://www.bilibili.com/video/BV1zt4y1z72D?p=7";

function requestInit(accept = "application/json, text/plain, */*") {
  return {
    credentials: "include" as const,
    headers: { Accept: accept, Referer: REFERER },
    method: "GET" as const,
  };
}

describe("Chrome Bilibili page fetch", () => {
  it("uses the exact active Bilibili page MAIN world so the browser carries its existing login session", async () => {
    const executeScript = vi.fn(async () => [
      {
        frameId: 0,
        result: {
          body: { code: 0, data: { subtitle: { subtitles: [] } } },
          bodyKind: "json",
          marker: "muzhi.bilibili.page-fetch.v1",
          ok: true,
          status: 200,
        },
      },
    ]);
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: {
        query: vi.fn(async () => [
          {
            id: 41,
            url: "https://www.bilibili.com/video/BV1zt4y1z72D?vd_source=x&spm_id_from=y&p=7",
          },
        ]),
      },
    });

    const response = await pageFetch(
      "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
      requestInit(),
    );

    await expect(response.json()).resolves.toMatchObject({ code: 0 });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
          "application/json, text/plain, */*",
          false,
          "BV1zt4y1z72D",
          7,
          "include",
        ],
        target: { tabId: 41 },
        world: "MAIN",
      }),
    );
    const [injection] = executeScript.mock.calls[0] as unknown as [
      { readonly func: (...args: unknown[]) => unknown },
    ];
    const injectedSource = String(injection.func);
    expect(injectedSource).toMatch(/credentials,/);
    expect(injectedSource).toMatch(/referrer:\s*window\.location\.href/);
    expect(injectedSource).not.toMatch(/\bCookie\b|SESSDATA/i);
  });

  it("finds the exact video tab even when the focused tab is not the Bilibili page", async () => {
    const executeScript = vi.fn(async () => [
      {
        frameId: 0,
        result: {
          body: { code: 0, data: { subtitle: { subtitles: [] } } },
          bodyKind: "json",
          marker: "muzhi.bilibili.page-fetch.v1",
          ok: true,
          status: 200,
        },
      },
    ]);
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 9, url: "chrome://extensions" }])
      .mockResolvedValueOnce([
        {
          id: 41,
          url: "https://www.bilibili.com/video/BV1zt4y1z72D?vd_source=x&p=7",
        },
      ]);
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: { query },
    });

    const response = await pageFetch(
      "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
      requestInit(),
    );
    await expect(response.json()).resolves.toMatchObject({ code: 0 });
    expect(query).toHaveBeenNthCalledWith(1, {
      active: true,
      lastFocusedWindow: true,
    });
    expect(query).toHaveBeenNthCalledWith(2, {
      url: ["https://www.bilibili.com/video/*"],
    });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 41 }, world: "MAIN" }),
    );
  });

  it("fails closed when the page changes part before or during the MAIN-world request", async () => {
    const executeScript = vi.fn(async () => [
      {
        frameId: 0,
        result: {
          body: { code: 0 },
          bodyKind: "json",
          marker: "muzhi.bilibili.page-fetch.v1",
          ok: true,
          status: 200,
        },
      },
    ]);
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: { query: vi.fn(async () => [{ id: 41, url: REFERER }]) },
    });

    await pageFetch(
      "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
      requestInit(),
    );

    const [injection] = executeScript.mock.calls[0] as unknown as [
      {
        readonly func: (
          url: string,
          accept: string,
          binary: boolean,
          expectedBvid: string,
          expectedPage: number,
        ) => Promise<unknown>;
      },
    ];
    const fetch = vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1]).buffer,
      ok: true,
      status: 200,
      text: async () => '{"code":0}',
      url: "https://api.bilibili.com/x/player/v2",
    }));
    vi.stubGlobal("window", {
      btoa: globalThis.btoa,
      fetch,
      location: { href: "https://www.bilibili.com/video/BV1zt4y1z72D?p=6" },
    });

    await expect(
      injection.func(
        "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
        "application/json, text/plain, */*",
        false,
        "BV1zt4y1z72D",
        7,
      ),
    ).resolves.toMatchObject({ bodyKind: "failed", ok: false, status: 0 });
    expect(fetch).not.toHaveBeenCalled();

    const location = {
      href: "https://www.bilibili.com/video/BV1zt4y1z72D?p=7",
    };
    fetch.mockImplementationOnce(async () => {
      location.href = "https://www.bilibili.com/video/BV1zt4y1z72D?p=8";
      return {
        arrayBuffer: async () => new Uint8Array([1]).buffer,
        ok: true,
        status: 200,
        text: async () => '{"code":0}',
        url: "https://api.bilibili.com/x/player/v2",
      };
    });
    vi.stubGlobal("window", {
      btoa: globalThis.btoa,
      fetch,
      location,
    });

    await expect(
      injection.func(
        "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
        "application/json, text/plain, */*",
        false,
        "BV1zt4y1z72D",
        7,
      ),
    ).resolves.toMatchObject({ bodyKind: "failed", ok: false, status: 0 });

    vi.unstubAllGlobals();
  });

  it("fails closed when an allowed request redirects to an unrelated host", async () => {
    const executeScript = vi.fn(async () => [
      {
        frameId: 0,
        result: {
          body: { code: 0 },
          bodyKind: "json",
          marker: "muzhi.bilibili.page-fetch.v1",
          ok: true,
          status: 200,
        },
      },
    ]);
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: { query: vi.fn(async () => [{ id: 41, url: REFERER }]) },
    });
    await pageFetch(
      "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
      requestInit(),
    );
    const [injection] = executeScript.mock.calls[0] as unknown as [
      {
        readonly func: (
          url: string,
          accept: string,
          binary: boolean,
          expectedBvid: string,
          expectedPage: number,
        ) => Promise<unknown>;
      },
    ];
    vi.stubGlobal("window", {
      btoa: globalThis.btoa,
      fetch: vi.fn(async () => ({
        arrayBuffer: async () => new Uint8Array([1]).buffer,
        ok: true,
        status: 200,
        text: async () => '{"code":0}',
        url: "https://example.com/redirected",
      })),
      location: { href: REFERER },
    });

    await expect(
      injection.func(
        "https://api.bilibili.com/x/player/v2?bvid=BV1zt4y1z72D&cid=30000000007",
        "application/json, text/plain, */*",
        false,
        "BV1zt4y1z72D",
        7,
      ),
    ).resolves.toMatchObject({ bodyKind: "failed", ok: false, status: 0 });
    vi.unstubAllGlobals();
  });

  it("rejects a different part before exposing a signed request URL to the page", async () => {
    const executeScript = vi.fn();
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: {
        query: vi.fn(async () => [
          {
            id: 41,
            url: "https://www.bilibili.com/video/BV1zt4y1z72D?p=6",
          },
        ]),
      },
    });

    await expect(
      pageFetch(
        "https://api.bilibili.com/x/web-interface/wbi/view/detail?bvid=BV1zt4y1z72D&need_elec=1&w_rid=signed&wts=1",
        requestInit(),
      ),
    ).rejects.toThrow("exact Bilibili page");
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("rejects arbitrary hosts and credential headers instead of becoming a general page proxy", async () => {
    const executeScript = vi.fn();
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: {
        query: vi.fn(async () => [{ id: 41, url: REFERER }]),
      },
    });

    await expect(
      pageFetch("https://example.com/private", requestInit()),
    ).rejects.toThrow("not allowed");
    await expect(
      pageFetch("https://api.bilibili.com/x/web-interface/nav", {
        ...requestInit(),
        headers: {
          Accept: "application/json",
          Cookie: "forbidden",
          Referer: REFERER,
        },
      }),
    ).rejects.toThrow("headers are invalid");
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("decodes the bounded protobuf response without exposing browser credentials", async () => {
    const executeScript = vi.fn(async () => [
      {
        frameId: 0,
        result: {
          body: "AQIDBA==",
          bodyKind: "binary",
          marker: "muzhi.bilibili.page-fetch.v1",
          ok: true,
          status: 200,
        },
      },
    ]);
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: { query: vi.fn(async () => [{ id: 41, url: REFERER }]) },
    });

    const response = await pageFetch(
      "https://api.bilibili.com/x/v2/subtitle/web/view?type=1&oid=30000000007&pid=100",
      requestInit("application/x-protobuf, application/octet-stream, */*"),
    );

    await expect(response.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]).buffer,
    );
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "https://api.bilibili.com/x/v2/subtitle/web/view?type=1&oid=30000000007&pid=100",
          "application/x-protobuf, application/octet-stream, */*",
          true,
          "BV1zt4y1z72D",
          7,
          "include",
        ],
      }),
    );
  });

  it("allows the exact media metadata endpoint needed by speech acquisition", async () => {
    const executeScript = vi.fn(async () => [
      {
        frameId: 0,
        result: {
          body: { code: 0, data: { dash: { audio: [] } } },
          bodyKind: "json",
          marker: "muzhi.bilibili.page-fetch.v1",
          ok: true,
          status: 200,
        },
      },
    ]);
    const pageFetch = createChromeBilibiliPageFetch({
      scripting: { executeScript },
      tabs: { query: vi.fn(async () => [{ id: 41, url: REFERER }]) },
    });

    await expect(
      pageFetch(
        "https://api.bilibili.com/x/player/playurl?bvid=BV1zt4y1z72D&cid=30000000007&fnval=16&fourk=1",
        requestInit("application/json, */*"),
      ).then((response) => response.json()),
    ).resolves.toMatchObject({ code: 0 });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ world: "MAIN" }),
    );
  });
});
