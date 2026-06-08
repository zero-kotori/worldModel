import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
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
  { path: "/admin/world-model/models", texts: ["模型状态"] }
];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 }
];

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
  if (!bodyText.includes("世界模型") || !route.texts.every((text) => bodyText.includes(text))) {
    throw new Error(`${route.path} missing expected text for ${viewport.name}`);
  }
  const bodyBox = await page.locator("body").boundingBox();
  if (!bodyBox || bodyBox.width < viewport.width * 0.9 || bodyBox.height < 200) {
    throw new Error(`${route.path} rendered with an invalid body box for ${viewport.name}`);
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

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
