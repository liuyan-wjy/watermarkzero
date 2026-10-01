# WatermarkZero SEO、移动体验与 GEO 交付复核

日期：2026-10-01。状态：代码与本地构建完成，尚未部署；未向 Google 提交新的索引请求。

## 本次完成

| 搜索需求 | 承接页面与处理 |
|---|---|
| remove Gemini watermark on iPhone / Android | 新增 `/blog/remove-gemini-watermark-on-iphone-android/`：保存原图、手机选择文件、比较结果、下载位置、格式和内存限制 |
| check AI image metadata / EXIF / C2PA / SynthID | 新增 `/blog/check-ai-image-metadata/`：区分类别报告与字段读取、像素水印与文件元数据、下载后复检 |
| turn off Gemini watermark / missing watermark setting | 更新 `/turn-off-gemini-watermark/`，直接回答设置路径、地区与账号限制、找不到开关、已有文件如何处理，附官方来源 |
| Nano Banana watermark remover / Nano Banana 2 Lite | 更新现有 Nano 页面，区分模型名称与已验证兼容性，明确 2 Lite 尚未实测，不另造重复工具页 |
| batch Gemini watermark remover | 更新批量页，使用真实前后样本，解释 20 MB、PNG 输出、ZIP 中跳过项、手机解压与结果检查 |
| lossless / not working / test results / GitHub | 更新原有指南：解释尺寸与像素恢复边界、截图和损坏文件排查、实际样本基准、可运行 CLI 示例 |
| 意大利语与希伯来语需求 | 改善相应首页文案及意大利语教程，保留独立语言 URL；17 语言同步新增操作提示和重点指南入口 |

这些是基于已有 GSC 信号、产品能力和官方新信息选择的主题，并非来自付费关键词工具的搜索量或难度数据。未批量新增仅替换关键词的近似页面。

## 技术 SEO 与产品修复

- 首页和 blog 入口链接至设置、手机、元数据工具及检查指南。两篇新指南加入 sitemap 和 `llms.txt`。
- 已知页面的 HTTP、www、`index.html` 和缺少尾斜杠版本尽量一次 301 到规范 URL，保留查询参数。
- 保留真实 HTTP 错误状态，并对错误页面加 `noindex`，不为错误响应改写可索引 canonical。
- `/` 固定输出英语，各语言路径固定相应语言，避免浏览器偏好和历史选择令同一 URL 改换语言。
- 生成的本地化 SoftwareApplication 数据使用对应语言、URL 和描述；移除首页重复英语 FAQPage 数据，保留可见 FAQ。品牌使用 WatermarkZero。
- 上传选择、拖放和粘贴共用格式及 20 MB 校验，错误提示在可见区域，以 live region 提供辅助技术反馈。拒绝无效文件时继续处理有效文件。
- 损坏文件单独报错，正常文件继续；进度包含完成和失败的尝试。批量 ZIP 用序号避免相同基本文件名互相覆盖。
- 手机导航可收缩，修复语言选择器在 320px RTL 和 375px 英语界面裁切。文章表格局部横滚，图片保留尺寸。
- `llms.txt` 原来已存在；本次更新了能力限制、文件格式和两篇新指南链接。

## GEO：可公开说明的判断依据

这里说明可验证的检索机制和实施理由，不涉及模型内部思考过程或未公开排序权重。

1. **页面可被发现和抓取。** OpenAI 将 OAI-SearchBot 用于搜索发现，与训练用途的 GPTBot 区分。当前生产站 Worker 的 robots 规则为 `User-agent: * / Allow: /`，已经允许抓取；没有为了 GEO 额外改变训练偏好。还需部署后确认 CDN/WAF 没有拦截真实爬虫，仅 robots 允许不足以证明能抓到。[OpenAI 爬虫文档](https://developers.openai.com/api/docs/bots)
2. **让具体问题有直接答案。** 手机下载、找不到开关、元数据与 SynthID 区别分别有对应章节或页面。页面首段直接解释适用范围和动作，链接到实际工具；不靠机械重复 “best/free/AI” 获得相关性。
3. **给回答提供可核验的依据。** 测试页写明 18 个仓库样本的实际启发式检查结果、日期和限制；没有把 18/18 解释成所有 Gemini 图片的成功率。设置和模型信息引用官方来源，2 Lite 明确未验证。
4. **名称、能力和结构化信息一致。** WatermarkZero、可见 Gemini 角标、本地处理、PNG 输出和独立元数据工具的边界保持一致；避免被引用成“删除 SynthID”或“保证无法检测 AI”的工具。
5. **把 llms.txt 当补充目录。** Google 明确表示它不用于影响 Google 搜索排名，也没有专用 GEO 文件或特殊结构化数据要求。因此保留和维护它，但不把它作为增长承诺。[Google AI 优化说明](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

以上改动提高内容的可检索性、清晰度和可引用性，不能保证 ChatGPT 推荐或 Google 收录。后续效果应看实际搜索展示、目标页面点击和来自 ChatGPT 的引荐流量，而不是询问几次模型后得出排名结论。

## SEO audit 与 AI slop review

按用户指定的 `seo-audit` 和 `ai-slop-cleaner` 完成独立复核，并另做核心代码安全与架构检查。先确认基线，再用失败回归覆盖上传和 ZIP 问题，然后进行最小修复。

已修复审查发现：

- 超限提示曾建议“换电脑处理”，但浏览器在所有设备均限制 20 MB；现仅说明真实限制。
- 首页元数据卡片曾错误列出 WebP；现全部 17 语言只列 PNG/JPEG。
- 损坏文件曾使整个批次中止；现独立失败、正常项继续。
- 混合错误批次曾停在 1/2；现所有文件尝试结束后显示 2/2。
- 删除 “Proof near the top” 等面向编辑者的文案，压缩重复段落、无依据营销和过度兼容性承诺。

简化：复用现有入口、卡片和提示组件；删除批次全量预解码；移除测试中“必须达到 1500 词”的任意门槛，保留意图、metadata、canonical 和内容事实检查；没有新增依赖。

## 验证证据

| 检查 | 结果 |
|---|---|
| 生产构建 | `npm run build` 通过，生成 17 语言首页 |
| 本轮定向回归 | 46/46 通过：路由/SEO、i18n、上传与 ZIP、文件名安全、metadata、样本基准测试 |
| 全套测试 | 588 项：567 通过、19 失败、2 跳过；不宣称全绿 |
| 失败基线对照 | 修改前 HEAD 的相关 44 项也产生完全相同的 19 个失败名称；16 项 Chromium 启动受 macOS 沙箱限制，2 项旧目录守卫失败，1 项旧 CLI 临时路径/权限测试缺陷 |
| 实际样本基准 | 仓库 18 个样本全部通过当前启发式检查；不代表模型普适兼容率 |
| Chrome 窄屏检查 | 两篇新指南、blog、五个重点落地页、测试/排障/lossless/GitHub 指南在 320px 未发现页面横向溢出或破图 |
| 首页与 RTL | 英语 320/375px、希伯来语 320px 导航修复后未见横向溢出；桌面 1440px 批量页可正常阅读 |
| 实际上传流程 | 本地 Chrome：PDF 显示格式提示；损坏 PNG + `debug1-source.png` 混合选择后，错误项独立提示、正常项显示已移除及下载按钮，进度 2/2 |

浏览器使用的是桌面 Chrome 视口模拟，未宣称已在真实 iPhone、Android 或 Safari 硬件验收。Worker 规则通过单元测试验证，本地静态预览不等于 Cloudflare 生产环境。没有重新测量线上 Core Web Vitals。

日志保存在本机临时目录：`/tmp/watermarkzero-targeted.log`、`/tmp/watermarkzero-tests-final.log`、`/tmp/watermarkzero-head-tests.log`；临时目录清理后可能不再保留。

## 主要改动文件

- `worker.mjs`、`scripts/generate-localized-pages.js`、`src/i18n.js`：规范化路由、错误响应和语言一致性。
- `src/app.js`、`public/index.html`、`src/i18n/translations.js` 及 17 个生成 JSON：上传、批量、窄屏导航、入口与多语言文案。
- `public/llms.txt`、`public/blog/index.html`、上表涉及的静态页面与两篇新指南。
- `tests/project/seoRoutesAndContent.test.js`、`tests/regression/i18nRuntime.test.js`、`tests/regression/uploadValidation.test.js`：可运行回归。

## 部署后的验证

部署后再检查线上 200/301/404、canonical/hreflang、sitemap 新 URL 和 CDN/WAF 抓取。GSC 中原来“已发现未编入索引”的设置和 metadata 页需要等重新抓取；`/zh-cn/` 的 Google-selected canonical 仍需 URL Inspection 复查。本轮语言和规范化改动不构成已查明旧 canonical 异常根因的证据。

核心内容来源：[Gemini Media watermark 设置](https://support.google.com/gemini/answer/17405358?hl=en-GB)、[Nano Banana 2 Lite 官方公告](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-omni-flash-nano-banana-2-lite/)、[Google 规范网址说明](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)。
