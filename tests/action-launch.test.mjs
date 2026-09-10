import assert from "node:assert/strict";
import {
  ACTION_LAUNCH_MODE,
  actionLaunchConfiguration,
  normalizeActionLaunchMode
} from "../services/action-launch.js";

assert.equal(normalizeActionLaunchMode(undefined), ACTION_LAUNCH_MODE.sidePanel);
assert.equal(normalizeActionLaunchMode("unexpected"), ACTION_LAUNCH_MODE.sidePanel);
assert.equal(normalizeActionLaunchMode(ACTION_LAUNCH_MODE.page), ACTION_LAUNCH_MODE.page);

assert.deepEqual(actionLaunchConfiguration(ACTION_LAUNCH_MODE.sidePanel), {
  mode: ACTION_LAUNCH_MODE.sidePanel,
  opensSidePanel: true,
  title: "打开哔哩音频侧边栏"
});
assert.deepEqual(actionLaunchConfiguration(ACTION_LAUNCH_MODE.page), {
  mode: ACTION_LAUNCH_MODE.page,
  opensSidePanel: false,
  title: "打开哔哩音频完整页面"
});

console.log("Action launch: passed");
