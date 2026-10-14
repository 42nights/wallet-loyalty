import { test } from "node:test";
import assert from "node:assert/strict";
import { colorBody, merchantFields, themeHex } from "./merchant";

// The creator admin must not accept an earn rate owner Settings would refuse
// (it once allowed up to 1000 against Settings' 100).
test("admin earn rate uses the Settings range, 0.1 to 100", () => {
  for (const earnRate of [0.1, 1, 100, "12.5"])
    assert.equal(typeof merchantFields({ earnRate }, true), "object", String(earnRate));
  for (const earnRate of [100.01, 1000, 0.09, 0, -5, "", "abc", null, NaN, Infinity])
    assert.match(String(merchantFields({ earnRate }, true)), /between 0\.1 and 100/, String(earnRate));
});

// Theme colours must not be frozen into the row: NULL keeps the card on the
// live theme, so a template switch re-colours it and keeps the default strip.
test("only hand-picked colours are stored; theme colours go in as NULL", () => {
  assert.deepEqual(colorBody(themeHex("cafe"), "cafe"), { bgColor: null, fgColor: null, labelColor: null });
  const cafeOnRetail = colorBody(themeHex("cafe"), "retail");
  assert.ok(cafeOnRetail.bgColor && cafeOnRetail.fgColor && cafeOnRetail.labelColor);
  assert.deepEqual(colorBody({ ...themeHex("retail"), bg: "#FFFFFF" }, "retail"),
    { bgColor: "rgb(255,255,255)", fgColor: null, labelColor: null });
  assert.deepEqual(merchantFields({ bgColor: null, fgColor: null, labelColor: null }, true),
    { bg_color: null, fg_color: null, label_color: null });
  assert.match(String(merchantFields({ bgColor: "#fff" }, true)), /rgb\(12,34,56\)/);
});
