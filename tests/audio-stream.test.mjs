import assert from "node:assert/strict";
import {
  audioStreamCandidates,
  mediaErrorText,
  mediaSourceType
} from "../services/audio-stream.js";

assert.deepEqual(audioStreamCandidates({
  url: "https://cdn.example/main",
  backupUrls: ["https://cdn.example/backup", "https://cdn.example/main", ""]
}), ["https://cdn.example/main", "https://cdn.example/backup"]);
assert.equal(mediaSourceType({ mimeType: "audio/mp4", codec: "mp4a.40.2" }), 'audio/mp4; codecs="mp4a.40.2"');
assert.equal(mediaSourceType({ mimeType: "audio/webm", codec: "opus" }), 'audio/webm; codecs="opus"');
assert.equal(mediaSourceType({ mimeType: "application/octet-stream", codec: "mp4a.40.2" }), "");
assert.equal(mediaSourceType({ mimeType: "audio/mp4", codec: 'mp4a.40.2"' }), 'audio/mp4; codecs="mp4a.40.2"');
assert.equal(mediaErrorText({ code: 2 }), "媒体网络请求失败");
assert.equal(mediaErrorText({ code: 3 }), "浏览器无法解码该音频");
console.log("音频流：候选地址、MSE 类型和媒体错误说明通过");
