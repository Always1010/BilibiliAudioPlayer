export const BILIBILI_AUDIO_REFERER_RULE_ID = 1001;

const BILIBILI_AUDIO_CDN_DOMAINS = [
  "bilivideo.com",
  "bilivideo.cn",
  "mountaintoys.cn"
];

export function createBilibiliAudioRefererRule(extensionId) {
  if (!extensionId) throw new Error("无法取得扩展 ID，不能配置音频 CDN 请求规则");
  return {
    id: BILIBILI_AUDIO_REFERER_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{
        header: "Referer",
        operation: "set",
        value: "https://www.bilibili.com/"
      }]
    },
    condition: {
      requestDomains: BILIBILI_AUDIO_CDN_DOMAINS,
      initiatorDomains: [extensionId],
      resourceTypes: ["xmlhttprequest"]
    }
  };
}

export async function configureBilibiliAudioRequestRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [BILIBILI_AUDIO_REFERER_RULE_ID],
    addRules: [createBilibiliAudioRefererRule(chrome.runtime.id)]
  });
}
