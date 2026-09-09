import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BILIBILI_AUDIO_REFERER_RULE_ID,
  createBilibiliAudioRefererRule
} from "../services/cdn-request-rules.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const rule = createBilibiliAudioRefererRule(extensionId);
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

assert.equal(rule.id, BILIBILI_AUDIO_REFERER_RULE_ID);
assert.deepEqual(rule.action.requestHeaders, [{
  header: "Referer",
  operation: "set",
  value: "https://www.bilibili.com/"
}]);
assert.deepEqual(rule.condition.initiatorDomains, [extensionId]);
assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest"]);
assert.deepEqual(rule.condition.requestDomains.sort(), [
  "bilivideo.cn",
  "bilivideo.com",
  "mountaintoys.cn"
]);
assert.throws(() => createBilibiliAudioRefererRule(""), /扩展 ID/);
assert.ok(manifest.permissions.includes("declarativeNetRequestWithHostAccess"));
assert.ok(manifest.host_permissions.includes("https://*.mountaintoys.cn/*"));

console.log("CDN 请求规则：权限、来源头、目标域名和扩展来源限制通过");
