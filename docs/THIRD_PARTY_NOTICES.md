# 第三方组件说明

## @breezystack/lamejs 1.2.7

- 用途：在浏览器本地把已解码的 PCM 音频编码为 MP3。
- 上游项目：<https://github.com/shijinyu/lamejs>
- 原始项目：<https://github.com/zhuker/lamejs>
- LAME 项目：<https://lame.sourceforge.io/>
- npm 包：<https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7>
- 许可证：GNU Lesser General Public License 3.0（LGPL-3.0）。包内许可证原文保存在 `vendor/lamejs/LICENSE`。
- 使用方式：`vendor/lamejs/lamejs.js` 作为独立 ES Module 随扩展分发，未对该文件进行修改；应用代码通过公开的 `Mp3Encoder` 接口调用它。
- 替换方式：可使用相同 ES Module 导出接口的兼容版本替换 `vendor/lamejs/lamejs.js`，无需修改其他应用代码。
- npm 归档 SHA-1：`c4779f7f0b6b685da675ebbaaff85e52187a51ad`
- `vendor/lamejs/lamejs.js` SHA-256：`1C5F944911CCF2F6E29AB36C2E568363210AB16F50C0D76077060F40ECF91D28`
- `vendor/lamejs/LICENSE` SHA-256：`CD144CA132E3842B01F5ED2D6F3A32141E24A1CC15E115AA5F19A2294CE0A379`
