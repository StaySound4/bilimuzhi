export interface BilibiliPageIdentity {
  readonly bvid: string;
  readonly page: number;
}

const BVID_PATH_PATTERN = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/;

export function parseBilibiliPageIdentity(
  value: string | undefined,
): BilibiliPageIdentity | null {
  if (value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const match = BVID_PATH_PATTERN.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.bilibili.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    match === null
  ) {
    return null;
  }
  const pageValues = url.searchParams.getAll("p");
  if (pageValues.length === 0) {
    return Object.freeze({ bvid: match[1], page: 1 });
  }
  if (pageValues.length !== 1 || !/^[1-9]\d*$/.test(pageValues[0])) {
    return null;
  }
  const page = Number(pageValues[0]);
  return Number.isSafeInteger(page)
    ? Object.freeze({ bvid: match[1], page })
    : null;
}

export function isSameBilibiliPage(
  left: BilibiliPageIdentity | null,
  right: BilibiliPageIdentity | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.bvid === right.bvid &&
    left.page === right.page
  );
}
