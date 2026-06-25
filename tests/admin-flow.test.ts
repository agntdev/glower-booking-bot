// Admin-flow tests. Sets ADMIN_ID so seedDefaults promotes that user id to
// admin, then exercises the admin callbacks (ad:m, ad:sv, ad:bkg, ad:rv, ad:st,
// ad:pf) to confirm the gate passes AND the admin pages render.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildBot } from "../src/bot.js";
import { runSpecs, parseBotSpec } from "../src/toolkit/index.js";

const ADMIN = 999_001;
let prevAdmin: string | undefined;

beforeAll(() => {
  prevAdmin = process.env.ADMIN_ID;
  process.env.ADMIN_ID = String(ADMIN);
});
afterAll(() => {
  if (prevAdmin === undefined) delete process.env.ADMIN_ID;
  else process.env.ADMIN_ID = prevAdmin;
});

const specs = [
  parseBotSpec({
    name: "admin /admin opens the admin menu",
    steps: [
      { send: { text: "/admin", userId: ADMIN }, expect: [{ method: "sendMessage" }] },
    ],
  }),
  parseBotSpec({
    name: "admin ad:m renders the admin menu",
    steps: [
      { send: { callback: "ad:m", userId: ADMIN }, expect: [{ method: "editMessageText" }] },
    ],
  }),
  parseBotSpec({
    name: "admin ad:sv renders the services list",
    steps: [
      { send: { callback: "ad:sv", userId: ADMIN }, expect: [{ method: "editMessageText" }] },
    ],
  }),
  parseBotSpec({
    name: "admin ad:pf renders the portfolio admin list",
    steps: [
      { send: { callback: "ad:pf", userId: ADMIN }, expect: [{ method: "editMessageText" }] },
    ],
  }),
  parseBotSpec({
    name: "admin ad:bkg renders the bookings list",
    steps: [
      { send: { callback: "ad:bkg", userId: ADMIN }, expect: [{ method: "editMessageText" }] },
    ],
  }),
  parseBotSpec({
    name: "admin ad:rv renders the reviews list",
    steps: [
      { send: { callback: "ad:rv", userId: ADMIN }, expect: [{ method: "editMessageText" }] },
    ],
  }),
  parseBotSpec({
    name: "admin ad:st renders the settings menu",
    steps: [
      { send: { callback: "ad:st", userId: ADMIN }, expect: [{ method: "editMessageText" }] },
    ],
  }),
  parseBotSpec({
    name: "admin ad:sv:e:1 renders the edit-service view",
    steps: [
      { send: { callback: "ad:sv:e:1", userId: ADMIN }, expect: [{ method: "editMessageText" }] },
    ],
  }),
];

describe("admin flow", () => {
  it("admin pages render after ADMIN_ID is promoted", async () => {
    const suite = await runSpecs(() => buildBot("test-token"), specs);
    if (suite.failed > 0) {
      // eslint-disable-next-line no-console
      console.error(suite.results.flatMap((r) => r.steps.flatMap((s) => s.failures)).join("\n"));
    }
    expect(suite.failed).toBe(0);
  });
});