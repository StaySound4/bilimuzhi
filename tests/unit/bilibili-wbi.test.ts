import { describe, expect, it } from "vitest";
import {
  createBilibiliWbiUrlSigner,
  extractBilibiliWbiKeys,
  signBilibiliWbiParameters,
} from "../../src/infrastructure/bilibili-wbi";

const keys = {
  imgKey: "7cd084941338484aae1ad9425b84077c",
  subKey: "4932caff0ff746eab6f01bf08b70ac45",
} as const;

describe("Bilibili WBI signing", () => {
  it("extracts bounded keys only from the expected Bilibili image hosts", () => {
    expect(
      extractBilibiliWbiKeys({
        code: 0,
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
          },
        },
      }),
    ).toEqual(keys);
  });

  it("sorts and filters parameters before producing the deterministic WBI signature", () => {
    expect(
      signBilibiliWbiParameters(
        { bar: 1_919_810, baz: 1_919_810, foo: 114_514 },
        keys,
        1_702_204_169,
      ),
    ).toBe(
      "bar=1919810&baz=1919810&foo=114514&wts=1702204169&w_rid=365419fe87a2682c541200c42130ef55",
    );
    expect(
      signBilibiliWbiParameters(
        { a: "(test)*", b: "hello!world" },
        keys,
        1_702_204_169,
      ),
    ).toBe(
      "a=test&b=helloworld&wts=1702204169&w_rid=830d1d795fdf3888c614eede0d7ecb22",
    );
  });

  it.each([
    {
      img_url:
        "https://evil.example/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
      sub_url:
        "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    },
    {
      img_url: "https://i0.hdslb.com/bfs/wbi/not-a-key.png",
      sub_url:
        "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    },
  ])("rejects malformed or cross-host key material", (wbi_img) => {
    expect(() =>
      extractBilibiliWbiKeys({ code: 0, data: { wbi_img } }),
    ).toThrow("The Bilibili WBI response is invalid");
  });

  it("fetches WBI keys with the browser login context and reuses the bounded cache", async () => {
    const fetch = async () => ({
      json: async () => ({
        code: 0,
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${keys.imgKey}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${keys.subKey}.png`,
          },
        },
      }),
      ok: true,
      status: 200,
    });
    const fetchSpy = Object.assign(fetch, { calls: 0 });
    const trackedFetch: typeof fetch = async (...args) => {
      fetchSpy.calls += 1;
      return fetch(...args);
    };
    const signer = createBilibiliWbiUrlSigner({
      fetch: trackedFetch,
      now: () => 1_702_204_169_000,
    });

    await expect(
      signer.sign(
        "/x/player/wbi/v2",
        { aid: 100, cid: 30_000_000_001 },
        "https://www.bilibili.com/video/BV1Q541167Qg",
      ),
    ).resolves.toBe(
      "https://api.bilibili.com/x/player/wbi/v2?aid=100&cid=30000000001&wts=1702204169&w_rid=0baa0ce2e6815a0de0a57e5124dc3b3d",
    );
    await signer.sign(
      "/x/web-interface/wbi/view/detail",
      { bvid: "BV1Q541167Qg", need_elec: 1 },
      "https://www.bilibili.com/video/BV1Q541167Qg",
    );
    expect(fetchSpy.calls).toBe(1);
  });
});
