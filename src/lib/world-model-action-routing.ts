const allowedWorldModelReturnPaths = new Set([
  "/admin/world-model",
  "/admin/world-model/beliefs",
  "/admin/world-model/graph",
  "/admin/world-model/observations",
  "/admin/world-model/evidence",
  "/admin/world-model/sources",
  "/admin/world-model/models"
]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export function worldModelActionReturnPath(formData: FormData, defaultPath: string) {
  const value = text(formData, "returnPath");
  if (!value || value.startsWith("//") || value.includes("://") || value.includes("\\")) {
    return defaultPath;
  }

  const [valueWithoutHash] = value.split("#", 1);
  const [path] = valueWithoutHash.split("?", 1);
  if (!allowedWorldModelReturnPaths.has(path)) return defaultPath;
  return value;
}
