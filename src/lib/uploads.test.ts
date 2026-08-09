import { describe, expect, it } from "vitest";
import {
  checkUpload,
  filenameFromKey,
  fileUrl,
  isServableKey,
  keyFromFileUrl,
  MAX_UPLOAD_BYTES,
  safeFilename,
  uploadKey,
} from "@/lib/uploads";

describe("checkUpload", () => {
  it("accepts a normal headshot", () => {
    expect(checkUpload({ size: 250_000, type: "image/jpeg" })).toBeNull();
  });

  it("rejects empty, oversized, and unsupported files", () => {
    expect(checkUpload({ size: 0, type: "image/jpeg" })).toBe("empty");
    expect(checkUpload({ size: MAX_UPLOAD_BYTES + 1, type: "image/jpeg" })).toBe("too-large");
    expect(checkUpload({ size: 100, type: "application/x-msdownload" })).toBe("unsupported-type");
  });

  it("accepts exactly the maximum size", () => {
    expect(checkUpload({ size: MAX_UPLOAD_BYTES, type: "application/pdf" })).toBeNull();
  });
});

describe("safeFilename", () => {
  it("strips path separators, spaces, and punctuation", () => {
    expect(safeFilename("../../etc/My Headshot (final).JPG")).toBe("etc-my-headshot-final-.jpg");
  });

  it("never returns an empty name", () => {
    expect(safeFilename("///")).toBe("file");
  });
});

describe("uploadKey", () => {
  it("namespaces under the uploads prefix and stays unique", () => {
    const a = uploadKey("ai-summit-cfp", "headshot.png");
    const b = uploadKey("ai-summit-cfp", "headshot.png");
    expect(a).toMatch(/^uploads\/ai-summit-cfp\/[0-9a-f]{8}-headshot\.png$/);
    expect(a).not.toBe(b);
    expect(isServableKey(a)).toBe(true);
  });
});

describe("isServableKey", () => {
  it("only serves keys under the uploads prefix", () => {
    expect(isServableKey("uploads/cfp/abc-headshot.png")).toBe(true);
    expect(isServableKey("__next-cache/some-page")).toBe(false);
    expect(isServableKey("uploads/../__next-cache/x")).toBe(false);
    expect(isServableKey("/uploads/x")).toBe(false);
  });
});

describe("fileUrl round trip", () => {
  it("maps a key to a URL and back", () => {
    const key = "uploads/cfp/abcd1234-my headshot.png";
    expect(keyFromFileUrl(fileUrl(key))).toBe(key);
  });

  it("returns null for anything that isn't one of our file URLs", () => {
    expect(keyFromFileUrl("https://files.greenroom.dev/demo/priya.jpg")).toBeNull();
    expect(keyFromFileUrl("/files/../secret")).toBeNull();
  });
});

describe("filenameFromKey", () => {
  it("drops the uniqueness segment for display", () => {
    expect(filenameFromKey("uploads/cfp/abcd1234-headshot.png")).toBe("headshot.png");
  });
});
