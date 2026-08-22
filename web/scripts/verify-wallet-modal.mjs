import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = join(process.cwd(), "_verify", "wallet-modal");
mkdirSync(OUT, { recursive: true });

const MM_ICON = readFileSync(join(process.cwd(), "public", "wallets", "metamask.svg"), "utf8");
const CB_ICON = readFileSync(join(process.cwd(), "public", "wallets", "coinbase.svg"), "utf8");

function dataUri(svg) {
  return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : "";
}

const browser = await chromium.launch({ headless: true });

async function openModal(page) {
  await page.goto(`${BASE}/how-verdicts-work`, { waitUntil: "commit", timeout: 30000 });
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("heading", { name: /connect wallet/i }).waitFor({ timeout: 15000 });
}

function mockAnnounce(page, wallets) {
  return page.addInitScript((list) => {
    window.addEventListener("eip6963:requestProvider", () => {
      for (const w of list) {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: { uuid: w.uuid, name: w.name, icon: w.icon, rdns: w.rdns },
              provider: {
                request: async ({ method }) => {
                  if (method === "eth_accounts") return [];
                  if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
                  if (method === "eth_chainId") return "0xf22f";
                  return null;
                },
                on() {},
                removeListener() {},
              },
            },
          })
        );
      }
    });
  }, wallets);
}

const none = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await openModal(none);
await none.screenshot({ path: join(OUT, "01-no-extension.png") });
const noneText = await none.locator("button").filter({ has: none.locator("img, svg") }).allTextContents();
await none.close();

const multi = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await mockAnnounce(multi, [
  { uuid: "mm", name: "MetaMask", rdns: "io.metamask", icon: dataUri(MM_ICON) },
  { uuid: "rabby", name: "Rabby", rdns: "io.rabby", icon: "" },
  { uuid: "cb", name: "Coinbase Wallet", rdns: "com.coinbase.wallet", icon: dataUri(CB_ICON) },
]);
await openModal(multi);
await multi.screenshot({ path: join(OUT, "02-eip6963-wallets.png") });
const labels = await multi.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => ({
    text: b.innerText.replace(/\s+/g, " ").trim(),
    disabled: b.disabled,
    imgs: [...b.querySelectorAll("img")].map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 48) })),
  }))
);
await multi.close();
await browser.close();

const report = { noneText, labels };
writeFileSync(join(OUT, "result.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
