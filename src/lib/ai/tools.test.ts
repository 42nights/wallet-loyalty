import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TOOL_DEFS } from "./tools";

// These tests pin the LLM-safety boundary: the model can pick a tool and supply
// args, but it can NEVER override the merchant, escape the enum/int/date
// coercion, or reach a non-whitelisted RPC. p_merchant must always equal the
// trusted session value passed to build(), regardless of what the model sends.

const M = "11111111-1111-1111-1111-111111111111";
const DAY = 86_400_000;

function tool(name: string) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) {
    assert.fail(`tool ${name} not found`);
  }
  return t;
}
function str(v: unknown): string {
  if (typeof v !== "string") assert.fail(`expected string, got ${typeof v}`);
  return v;
}
function ageDays(v: unknown): number {
  return (Date.now() - Date.parse(str(v))) / DAY;
}

test("every tool forces the trusted p_merchant and ignores model-supplied merchant", () => {
  for (const t of TOOLS) {
    const args = t.build(
      { p_merchant: "EVIL", merchant: "EVIL", p_serial: "x", merchantId: "EVIL" },
      M
    );
    assert.equal(args.p_merchant, M, `${t.name} must inject the trusted merchant`);
  }
});

test("no-arg tools return only p_merchant (junk args dropped)", () => {
  for (const name of ["merchant_stats", "merchant_segments", "redemption_funnel"]) {
    assert.deepEqual(tool(name).build({ days: 9999, junk: true }, M), { p_merchant: M });
  }
});

test("merchant_timeseries whitelists bucket and clamps days", () => {
  const t = tool("merchant_timeseries");

  const bad = t.build({ bucket: "year", days: 0 }, M);
  assert.equal(bad.p_merchant, M);
  assert.equal(bad.p_bucket, "day"); // 'year' not allowed → default
  assert.ok(Math.abs(ageDays(bad.p_from) - 1) <= 0.1, "days=0 clamps to 1");

  const big = t.build({ bucket: "week", days: 99999 }, M);
  assert.equal(big.p_bucket, "week");
  assert.ok(Math.abs(ageDays(big.p_from) - 365) <= 1, "days clamps to 365");

  const dflt = t.build({}, M);
  assert.equal(dflt.p_bucket, "day");
  assert.ok(Math.abs(ageDays(dflt.p_from) - 30) <= 1, "default 30 days");
});

test("merchant_customers sanitizes search, whitelists sort, clamps limit, pins offset 0", () => {
  const t = tool("merchant_customers");

  const a = t.build({ search: "a".repeat(200), sort: "evil", limit: 9999, p_offset: 50 }, M);
  assert.equal(a.p_merchant, M);
  assert.equal(str(a.p_search).length, 60, "search truncated to 60");
  assert.equal(a.p_sort, "recent", "bad sort → default");
  assert.equal(a.p_limit, 50, "limit clamps to 50");
  assert.equal(a.p_offset, 0, "model cannot paginate");

  const b = t.build({ search: "   ", sort: "points", limit: 0 }, M);
  assert.equal(b.p_search, null, "whitespace search → null");
  assert.equal(b.p_sort, "points");
  assert.equal(b.p_limit, 1, "limit clamps to 1");

  assert.equal(tool("merchant_customers").build({ search: 123 }, M).p_search, null, "non-string → null");
});

test("windowed tools clamp days against their own defaults", () => {
  const cases: Array<[string, number]> = [
    ["activity_heatmap", 90],
    ["staff_activity", 30],
    ["detect_anomalies", 30],
  ];
  for (const [name, dflt] of cases) {
    const t = tool(name);
    const def = t.build({}, M);
    assert.equal(def.p_merchant, M);
    assert.ok(Math.abs(ageDays(def.p_from) - dflt) <= 1, `${name} default ~${dflt}d`);
    assert.ok(Math.abs(ageDays(t.build({ days: 100000 }, M).p_from) - 365) <= 1, `${name} clamps to 365`);
    assert.ok(Math.abs(ageDays(t.build({ days: -5 }, M).p_from) - 1) <= 0.1, `${name} negative → 1`);
  }
});

test("TOOL_DEFS mirror TOOLS and never leak rpc/build internals", () => {
  assert.equal(TOOL_DEFS.length, TOOLS.length);
  const names = new Set(TOOLS.map((t) => t.name));
  for (const d of TOOL_DEFS) {
    assert.ok(names.has(d.name), `${d.name} is a real tool`);
    assert.ok(d.description.length > 0, `${d.name} has a description`);
    assert.equal(d.input_schema.type, "object");
    assert.ok(!("rpc" in d), "rpc not exposed to the model");
    assert.ok(!("build" in d), "build not exposed to the model");
  }
});

test("every tool maps to a whitelisted RPC", () => {
  const allowed = new Set([
    "merchant_stats", "merchant_segments", "redemption_funnel", "merchant_timeseries",
    "activity_heatmap", "staff_activity", "detect_anomalies", "merchant_customers",
  ]);
  for (const t of TOOLS) assert.ok(allowed.has(t.rpc), `${t.rpc} is whitelisted`);
});
