import { describe, expect, it } from "vitest";
import { isPublicAddress, safeFetch, validateUrl } from "../../fetcher/safe-fetch";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1",
    "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "224.0.0.1", "255.255.255.255",
  ])("rejects %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])("accepts %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("validateUrl", () => {
  it.each([
    "file:///etc/passwd", "ftp://example.com/x", "http://user:pw@example.com", "http://example.com:8080/",
    "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data",
    "http://intranet/", "http://printer.local/",
  ])("blocks %s", (u) => expect(() => validateUrl(u)).toThrow());
  it("allows public https", () => expect(validateUrl("https://example.com/apply").hostname).toBe("example.com"));
});

describe("safeFetch DNS checks", () => {
  it("blocks a hostname that resolves to a private address", async () => {
    const r = await safeFetch("https://looks-public.example.com/", { resolver: async () => [{ address: "10.0.0.5", family: 4 }] });
    expect(r.outcome).toBe("denied_by_policy");
  });
  it("blocks a mixed public/private answer (rebinding signal)", async () => {
    const r = await safeFetch("https://mixed.example.com/", {
      resolver: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }],
    });
    expect(r.outcome).toBe("denied_by_policy");
  });
});
