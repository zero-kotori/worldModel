import {
  createBodyHash,
  createProxySignature,
  proxyHeaderNames,
  verifyProxySignature
} from "@/server/proxy-auth";

describe("proxy request authentication", () => {
  it("accepts a valid method/path/timestamp/body signature", () => {
    const timestamp = "1780833600";
    const body = JSON.stringify({ title: "AI trend" });
    const bodyHash = createBodyHash(body);
    const signature = createProxySignature({
      secret: "a".repeat(32),
      method: "POST",
      path: "/api/beliefs",
      timestamp,
      bodyHash
    });

    expect(
      verifyProxySignature({
        secret: "a".repeat(32),
        method: "POST",
        path: "/api/beliefs",
        bodyHash,
        nowSeconds: 1780833610,
        headers: new Headers({
          [proxyHeaderNames.timestamp]: timestamp,
          [proxyHeaderNames.bodyHash]: bodyHash,
          [proxyHeaderNames.signature]: signature
        })
      })
    ).toEqual({ ok: true });
  });

  it("rejects a changed path", () => {
    const timestamp = "1780833600";
    const bodyHash = createBodyHash("");
    const signature = createProxySignature({
      secret: "a".repeat(32),
      method: "GET",
      path: "/admin/world-model",
      timestamp,
      bodyHash
    });

    expect(
      verifyProxySignature({
        secret: "a".repeat(32),
        method: "GET",
        path: "/admin/world-model/evidence",
        bodyHash,
        nowSeconds: 1780833610,
        headers: new Headers({
          [proxyHeaderNames.timestamp]: timestamp,
          [proxyHeaderNames.bodyHash]: bodyHash,
          [proxyHeaderNames.signature]: signature
        })
      })
    ).toEqual({ ok: false, reason: "SIGNATURE" });
  });

  it("rejects expired timestamps and body hash mismatch", () => {
    const timestamp = "1780830000";
    const bodyHash = createBodyHash("old");
    const signature = createProxySignature({
      secret: "a".repeat(32),
      method: "POST",
      path: "/api/observations",
      timestamp,
      bodyHash
    });
    const headers = new Headers({
      [proxyHeaderNames.timestamp]: timestamp,
      [proxyHeaderNames.bodyHash]: bodyHash,
      [proxyHeaderNames.signature]: signature
    });

    expect(
      verifyProxySignature({
        secret: "a".repeat(32),
        method: "POST",
        path: "/api/observations",
        bodyHash,
        nowSeconds: 1780833600,
        headers
      })
    ).toEqual({ ok: false, reason: "TIMESTAMP" });

    expect(
      verifyProxySignature({
        secret: "a".repeat(32),
        method: "POST",
        path: "/api/observations",
        bodyHash: createBodyHash("new"),
        nowSeconds: 1780830001,
        headers
      })
    ).toEqual({ ok: false, reason: "BODY_HASH" });
  });
});
