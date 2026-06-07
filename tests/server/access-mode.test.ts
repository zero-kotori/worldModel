import { getWorldModelAccessMode, shouldBypassProxyAuth } from "@/server/access-mode";

describe("world model access mode", () => {
  it("uses standalone mode when configured for independent local hosting", () => {
    expect(getWorldModelAccessMode({ WORLDMODEL_ACCESS_MODE: "standalone" })).toBe("standalone");
    expect(shouldBypassProxyAuth({ WORLDMODEL_ACCESS_MODE: "standalone" })).toBe(true);
  });

  it("keeps proxy mode when configured behind myWeb", () => {
    expect(getWorldModelAccessMode({ WORLDMODEL_ACCESS_MODE: "proxy" })).toBe("proxy");
    expect(shouldBypassProxyAuth({ WORLDMODEL_ACCESS_MODE: "proxy" })).toBe(false);
  });

  it("defaults to proxy mode for unknown or missing values", () => {
    expect(getWorldModelAccessMode({})).toBe("proxy");
    expect(getWorldModelAccessMode({ WORLDMODEL_ACCESS_MODE: "anything-else" })).toBe("proxy");
  });
});
