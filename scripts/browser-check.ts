import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { config } from "dotenv";
import { createBodyHash, createProxySignature, proxyHeaderNames } from "../src/server/proxy-auth";

config({ path: ".env.local" });
config();

const baseUrl = process.env.WORLDMODEL_CHECK_BASE_URL ?? "http://127.0.0.1:3100";
const proxySecret = process.env.WORLDMODEL_PROXY_SECRET ?? "browser-check-secret-32-characters";
const pages = [
  { path: "/admin/world-model", texts: ["最近更新"] },
  { path: "/admin/world-model/graph", texts: ["证据影响图谱", "图谱工作区"] },
  { path: "/admin/world-model/beliefs", texts: ["创建信念"] },
  { path: "/admin/world-model/observations", texts: ["未知证据队列", "重复候选", "观察池"] },
  { path: "/admin/world-model/evidence", texts: ["从观察确认为证据", "证据库"] },
  { path: "/admin/world-model/sources", texts: ["自动证据闭环", "来源列表"] },
  { path: "/admin/world-model/models", texts: ["模型状态", "LLM 评估运行"] }
];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 }
];
const fatalPageTexts = ["数据加载失败", "数据库未配置或不可用", "Application error"];

function findBrowserExecutable() {
  const candidates = [
    process.env.WORLDMODEL_BROWSER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

async function checkPage(browser: Browser, route: (typeof pages)[number], viewport: (typeof viewports)[number]) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createBodyHash("");
  const signature = createProxySignature({
    secret: proxySecret,
    method: "GET",
    path: route.path,
    timestamp,
    bodyHash
  });
  const page: Page = await browser.newPage({
    viewport,
    extraHTTPHeaders: {
      [proxyHeaderNames.timestamp]: timestamp,
      [proxyHeaderNames.bodyHash]: bodyHash,
      [proxyHeaderNames.signature]: signature
    }
  });
  const url = new URL(route.path, baseUrl).toString();
  await page.goto(url, { waitUntil: "networkidle" });
  const bodyText = await page.locator("body").innerText();
  assertWorldModelPageBody(route.path, viewport.name, bodyText, route.texts);
  const bodyBox = await page.locator("body").boundingBox();
  if (!bodyBox || bodyBox.width < viewport.width * 0.9 || bodyBox.height < 200) {
    throw new Error(`${route.path} rendered with an invalid body box for ${viewport.name}`);
  }
  const graphContainer = page.locator("[data-graph-pan-active]").first();
  if ((await graphContainer.count()) > 0) {
    assertGraphCanvasState(route.path, viewport.name, {
      emptyGraph: bodyText.includes("暂无图谱数据"),
      nodeCount: await page.locator(".react-flow__node").count(),
      canvasBox: await graphContainer.boundingBox()
    });
  }
  const screenshotPath = path.join(
    process.cwd(),
    "output",
    "playwright",
    `${route.path.replaceAll("/", "_").replace(/^_/, "")}-${viewport.name}.png`
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.close();
  return { path: route.path, viewport: viewport.name, screenshotPath };
}

export function assertWorldModelPageBody(routePath: string, viewportName: string, bodyText: string, expectedTexts?: string[]) {
  const route = pages.find((page) => page.path === routePath);
  const requiredTexts = expectedTexts ?? route?.texts ?? [];
  if (fatalPageTexts.some((text) => bodyText.includes(text))) {
    throw new Error(`${routePath} rendered a data loading error for ${viewportName}`);
  }
  if (!bodyText.includes("世界模型") || !requiredTexts.every((text) => bodyText.includes(text))) {
    throw new Error(`${routePath} missing expected text for ${viewportName}`);
  }
}

export function assertGraphCanvasState(
  routePath: string,
  viewportName: string,
  state: {
    emptyGraph: boolean;
    nodeCount: number;
    canvasBox: { width: number; height: number } | null;
  }
) {
  if (state.emptyGraph) return;
  if (!state.canvasBox || state.canvasBox.width < 200 || state.canvasBox.height < 200) {
    throw new Error(`${routePath} rendered with an invalid graph canvas for ${viewportName}`);
  }
  if (state.nodeCount < 1) {
    throw new Error(`${routePath} rendered without graph nodes for ${viewportName}`);
  }
}

async function main() {
  await mkdir(path.join(process.cwd(), "output", "playwright"), { recursive: true });
  const executablePath = findBrowserExecutable();
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
  try {
    const results = [];
    for (const viewport of viewports) {
      for (const route of pages) {
        results.push(await checkPage(browser, route, viewport));
      }
    }
    console.log(JSON.stringify({ checked: results.length, results }, null, 2));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
