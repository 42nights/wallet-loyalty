import { test } from "node:test";
import assert from "node:assert/strict";
import { FOOTER_MISSING, MERGE_KEYS, SCRIPTS, mergeFields, renderScript } from "./scripts";

// The marketing-plan §1 "never claim" list and the no-prices-in-writing rule
// (sales-kit §5), checked over every script (admin-sales spec §3.1).
const BANNED = ["instantly", "in seconds", "android card", "text your customers", "nfc", "pos integration"];

test("no script names a price, a Planned feature or a speed claim", () => {
  for (const s of SCRIPTS) {
    const text = `${s.title}\n${s.body}`;
    assert.doesNotMatch(text, /\$|\d\s*\/\s*mo/i, s.id);
    for (const phrase of BANNED) assert.ok(!text.toLowerCase().includes(phrase), `${s.id}: "${phrase}"`);
  }
});

test("every email script ends with the CAN-SPAM footer and uses only known merge fields", () => {
  for (const s of SCRIPTS) {
    if (s.channel === "email") assert.ok(s.body.trimEnd().endsWith("{{footer}}"), s.id);
    for (const [, k] of s.body.matchAll(/\{\{(\w+)\}\}/g)) assert.ok((MERGE_KEYS as readonly string[]).includes(k), `${s.id}: {{${k}}}`);
  }
});

const lead = {
  id: "0d3c1a52-1111-4222-8333-944455556666", business_name: "Bean & Bun", owner_name: "Maria Lopez",
  address: "12 Elm St", cluster: "Elm A", segment: "cafe" as const, source: "walk_in",
  next_action_at: null, recipient_tz: "America/New_York", state: "NY",
};

test("email scripts are disabled until SALES_POSTAL_ADDRESS is set", () => {
  const off = mergeFields(lead, null, { postalAddress: null, referenceShop: null, baseUrl: "https://x.test" });
  const on = mergeFields(lead, null, { postalAddress: "PO Box 1, Austin, TX 78701", referenceShop: null, baseUrl: "https://x.test" });
  for (const s of SCRIPTS.filter((s) => s.channel === "email")) {
    assert.equal(renderScript(s, off).disabled, FOOTER_MISSING, s.id);
    const ready = renderScript(s, on);
    assert.equal(ready.disabled, null, s.id);
    assert.ok(ready.text.includes("PO Box 1, Austin, TX 78701") && ready.text.includes('Reply "no thanks"'), s.id);
  }
});

test("the line naming the pilot shop is omitted until SALES_REFERENCE_SHOP is set", () => {
  const counter = SCRIPTS.find((s) => s.id === "counter_opener")!;
  const none = renderScript(counter, mergeFields(lead, "Sam", { postalAddress: null, referenceShop: null, baseUrl: "" })).text;
  assert.ok(none.startsWith(`"Hi! Quick one. I'm Sam, I'm local. Who decides`), none);
  const named = renderScript(counter, mergeFields(lead, null, { postalAddress: null, referenceShop: "Bean & Bun, Elm St", baseUrl: "" })).text;
  assert.ok(named.includes("I'm Ayaan, I'm local. I set up the loyalty card at Bean & Bun on Elm St. Who"), named);
});
