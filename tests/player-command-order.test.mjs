import assert from "node:assert/strict";
import { backgroundHarness, deferred } from "./helpers/background-harness.mjs";

const app = await backgroundHarness({ settings: {}, player: { queue: [] } });
const contexts = deferred();
const playing = deferred();
let calls = 0;
const commands = [];
app.context.chrome.runtime.getContexts = async () => ++calls === 1 ? contexts.promise : [{}];
app.context.chrome.runtime.sendMessage = async message => {
  if (message.command === "status") return { ok: true, data: { hydrated: true } };
  commands.push(message.command);
  if (message.command === "playQueue") return playing.promise;
  return { ok: true, data: { queue: [], playing: false } };
};
const first = app.run('handleMessage({type:MESSAGE.playerCommand,command:"playQueue",payload:{queue:[{id:"A"}]}})');
await new Promise(resolve => setImmediate(resolve));
const clear = app.run('handleMessage({type:MESSAGE.playerCommand,command:"clearQueue"})');
await new Promise(resolve => setImmediate(resolve));
contexts.resolve([{}]);
await clear;
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(commands, ["playQueue", "clearQueue"], "异步预处理不能将旧播放排到清空之后");
playing.resolve({ ok: true });
await first;
console.log("播放器命令：预处理保持收到顺序，清空不等待旧音源加载完成通过");
