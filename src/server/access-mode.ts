export type WorldModelAccessMode = "proxy" | "standalone";

type EnvLike = Record<string, string | undefined>;

export function getWorldModelAccessMode(env: EnvLike = process.env): WorldModelAccessMode {
  return env.WORLDMODEL_ACCESS_MODE === "standalone" ? "standalone" : "proxy";
}

export function shouldBypassProxyAuth(env: EnvLike = process.env) {
  return getWorldModelAccessMode(env) === "standalone";
}
