import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ASSET_NAMES, defaultAssetBuffer, withDefaultArt } from "./passDefaults";

const own = (s: string) => Buffer.from(s);

test("a merchant with no uploads gets every default image, @2x and @3x included", () => {
  assert.deepEqual(Object.keys(withDefaultArt({})).sort(), [...DEFAULT_ASSET_NAMES].sort());
  assert.equal(DEFAULT_ASSET_NAMES.length, 9);
});

test("an uploaded base image is never mixed with default variants", () => {
  const art = withDefaultArt({ "logo.png": own("l1"), "logo@2x.png": own("l2") });
  assert.equal(art["logo.png"].toString(), "l1");
  assert.equal(art["logo@2x.png"].toString(), "l2");
  assert.equal(art["logo@3x.png"], undefined);
  assert.equal(art["icon@3x.png"], defaultAssetBuffer("icon@3x.png"));
  assert.equal(art["strip@2x.png"], defaultAssetBuffer("strip@2x.png"));
});

test("icon.png is always present, even when only a variant was uploaded", () => {
  const art = withDefaultArt({ "icon@2x.png": own("i2") });
  assert.equal(art["icon.png"], defaultAssetBuffer("icon.png"));
  assert.equal(art["icon@2x.png"].toString(), "i2");
});
