# Moment · 短视频工作室

**在浏览器中完成视频剪辑、字幕制作和导出，让素材成为短视频。**

[English](README.md) · [한국어](README.ko.md) · **简体中文**

[![CI](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml/badge.svg)](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Moment 是本地优先的视频编辑器，提供韩语、英语和简体中文界面。无需把媒体上传到应用服务器，即可剪辑片段、应用模板、添加字幕或旁白并导出短视频。无需账户或 API 密钥。

编辑器也提供共享编辑命令、可导出 SRT/VTT/TXT 的项目 JSON CLI，以及供 AI 客户端使用的本地 stdio MCP 服务器。项目仍处于早期阶段；依赖特定浏览器或编解码器前，请查看[已验证行为和剩余限制](docs/BROWSER_QA.md)。

![Moment 编辑器：模板库、竖屏视频预览和编辑时间线](docs/editor-desktop.png)

[快速开始](#快速开始) · [功能](#功能) · [示例成片](#示例成片) · [CLI 与集成](#cli-与集成) · [隐私和限制](#隐私和限制) · [开发](#开发)

## 快速开始

需要 **Git 和 Node.js 20 或更高版本**，包括 npm。没有需要安装的 npm 依赖，也没有构建步骤。

```sh
git clone https://github.com/bugtype/moment-shorts-cut.git
cd moment-shorts-cut
npm start
```

打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)。编辑器自带 **12 秒动态图形示例**，不导入素材也能体验模板和导出。示例字幕仅供编辑演示；示例没有可转写的语音。

编辑时保持服务器运行；按 `Ctrl+C` 停止。服务器绑定到 `127.0.0.1`，只提供 `dist/` 下的文件。应用使用 JavaScript 模块、Worker 和浏览器存储，因此应打开 HTTP 地址，不要直接双击 `dist/index.html`。

### 界面语言

在语言选择器中选择 **한국어**、**English** 或 **简体中文**。已保存的选择优先于受支持的浏览器语言；两者均不可用时使用韩语。若浏览器存储不可用，当前会话仍可切换语言，但刷新后可能无法保留选择。

切换界面语言**不会翻译**项目名称、字幕、标题、署名、说话人名称、导入文件或已保存的自定义模板内容。现有韩语演示和内置模板的示例文字仍保留韩语；应用示例内容仍需明确执行编辑操作。界面语言也不会改变语音识别语言，请根据原始音频另行选择。下方截图和成片保留原始韩语内容。

### 制作第一个短视频

1. **媒体：** 导入视频，或继续使用示例。在**画面**中选择 9:16、1:1 或 16:9 并调整构图；在时间线上裁剪、分割和排列片段。
2. **模板：** 选择构图。**仅应用样式**保留现有文字；**应用示例内容**会替换标题、署名和定时文字，但保留视频及对白字幕。
3. **字幕：** 导入 SRT/VTT、手动编写，或从语音在本地生成字幕。检查文字和时间。在**标题**和**效果**中设置大标题及定时文字。
4. **音频：** 添加音频文件，或授权麦克风后录制旁白。调整起始位置和音量，与原始音频配合。
5. **导出：** 选择可用的 MP4/WebM 格式以及 720p 或 1080p。**导出完成前保持标签页可见**，之后播放下载的文件检查结果。

通过**使用指南 → 保存编辑设置**备份项目 JSON。保存和恢复文件均不得超过 **10 MiB（10,485,760 个 UTF-8 字节）**；超限会被拒绝，不会截断内容。另行保留原始视频和音频：**JSON 不包含媒体文件**。

**预览快捷键：** 不按修饰键时，`,` / `.` 按输出时间的 1/30 秒后退/前进，用于查看剪辑或字幕边界。方向键仍按变速前的时间线时间移动 1 秒。细步移动参考 30 fps 输出，不代表源视频逐帧精度，也不会吸附到帧网格；原有的帧间偏移会保留。在编辑输入框、输入法组字期间、使用修饰键或忙碌时会忽略这些快捷键。

**跳转到输出时间：** 点击预览时间显示，输入 `2.5`、`01:02.5` 或 `00:01:02.5`，然后选择**跳转**。该值是**变速后的输出时间**，允许零到输出结束位置。确认后暂停并跳转；取消不改变播放状态。不会编辑、保存或添加撤销记录。项目或媒体源发生变化后请重新打开窗口；忙碌和恢复保护仍然有效。这是时间跳转，不保证帧或音频采样级精度。

## 功能

| 工作内容 | 可用工具 | 重要边界 |
|---|---|---|
| 视频和时间 | 裁剪、分割、排序、删除、变速、平移/缩放、撤销/重做；亮度、对比度、饱和度、暗角、缓慢缩放及进度条 | 一个源视频、一条视频轨道；片段边界淡入淡出/闪光不重叠片段 |
| 构图和文字 | 10 个内置模板、搜索/收藏、最多 20 个可单独导入/导出 JSON 的本地自定义模板、标题/署名样式及 12 个定时文字层 | 仅应用样式保留文字；示例内容替换标题、署名和定时卡片 |
| 字幕和音频 | SRT/VTT 导入，编辑后 SRT/VTT/TXT 导出，字面查找/全部替换，高亮、动画、两个手动说话人；一个附加音频文件或麦克风旁白 | 设备端 ASR 使用 Transformers.js 3.8.1 和 `Xenova/whisper-tiny`；识别及分割后的估计时间需要检查 |
| 保存和自动化 | 浏览器存储、项目 JSON、CLI、仓库技能及 stdio MCP；Canvas/Web Audio → MediaRecorder 导出 | 项目 JSON 不含媒体；CLI/MCP 不编码视频 |

内置模板覆盖评论故事、醒目开场、日常 vlog、讲解、访谈、食谱、排名、产品评测、测验及电影感片段。可以观看各模板的动画预览。测验选项和倒计时是视频图形，不是可交互的投票。

**复用卡片样式：** 在选中的定时卡片上选择**复制样式**，选中另一张卡片，再选择**粘贴样式**。只复制颜色、字号/描边、背景样式、呈现方式和动画；文字、时间、位置/宽度、角色、类型和启用状态保持不变。副本只存在于编辑器内存中，不使用系统剪贴板或持久存储；之后修改或删除源卡片不会改变副本。实际粘贴更改可一次撤销；样式相同则不改变任何内容。

### 分享自定义模板

在模板库的单张自定义模板卡片中导出文件，再在另一浏览器通过模板库导入。导入会以新 ID 在**我的模板**下添加**新副本**，不会覆盖已有模板、更改收藏或自动应用到当前项目。预览后再选择仅应用样式或应用示例内容。

**重命名已有模板**无需再创建副本。名称会去掉首尾空白，不能为空，最多 40 个 UTF-16 代码单元。ID、收藏、已保存样式/内容及当前项目保持不变；即使 20 个位置都已占满也能重命名。名称不必唯一；搜索及导出文件名使用新名称。取消或保存失败会保留原项；保存失败后窗口保持打开，允许重试。

**用当前配置更新已有自定义模板：** 在模板卡片上选择**用当前配置更新**，再确认**更新**。系统在确认时读取当前构图，替换已保存的样式和内容，同时保留模板 ID、名称、类别和收藏。已有 20 个模板也可使用，因为它替换一项而非追加副本。不会修改当前项目、媒体或其他项目，也不会自动应用模板。如需保留旧版本，请先导出文件；此操作是覆盖，不提供版本历史。取消或保存失败会保留原项，并允许在保存失败后重试。

| 文件 | 包含什么 | 不会做什么 |
|---|---|---|
| 项目 JSON | 编辑设置、时间线和字幕 | 嵌入源媒体 |
| 单个模板 JSON | 已保存的样式、标题/署名/卡片文字、关键词及说话人名称 | 备份整个模板库或当前项目 |
| SRT/VTT | 编辑后的字幕文字及时间 | 保留视觉样式或媒体 |
| TXT | 按输出顺序排列的字幕文字 | 恢复时间或充当项目备份 |

**分享模板前请检查已保存文字。** 文件不包含视频/音频，但标题、署名、卡片、全局关键词和说话人名称可能包含私人信息。导入接受最多 256 KiB 的 UTF-8 JSON，包括可选的文件开头 BOM；最多 20 项的模板库必须有空位。无效文件或保存失败不改变模板库及当前项目。[文件契约和恢复](INTEGRATIONS.md#개별-사용자-템플릿-파일)说明格式/版本检查及连续选择文件的规则。浏览器模板库与 CLI/MCP 分离：后者可以[将导出的模板文档应用到当前项目](INTEGRATIONS.md#내보낸-템플릿을-climcp로-적용)，但不能列出或保存浏览器的自定义模板库。

## 示例成片

以下四个 1080×1920 竖屏短视频由 Moment 的 Canvas 合成引擎和内置模板制作。点击缩略图打开 MP4。

<table>
<tr>
<td width="50%" align="center">
<a href="docs/examples/cinema-sunset.mp4"><img src="docs/examples/cinema-sunset-thumb.jpg" width="260" alt="落日前方：电影感片段示例"></a><br>
<strong>落日前方</strong><br><sub>电影感片段 · 11.5 秒</sub>
</td>
<td width="50%" align="center">
<a href="docs/examples/city-night.mp4"><img src="docs/examples/city-night-thumb.jpg" width="260" alt="城市夜景：醒目开场示例"></a><br>
<strong>城市夜景</strong><br><sub>醒目开场 · 10.3 秒</sub>
</td>
</tr>
<tr>
<td width="50%" align="center">
<a href="docs/examples/coffee-recipe.mp4"><img src="docs/examples/coffee-recipe-thumb.jpg" width="260" alt="今天的一杯：食谱示例"></a><br>
<strong>今天的一杯</strong><br><sub>一目了然的食谱 · 11.5 秒</sub>
</td>
<td width="50%" align="center">
<a href="docs/examples/forest-top3.mp4"><img src="docs/examples/forest-top3-thumb.jpg" width="260" alt="忙碌一天需要的三件事：前三名示例"></a><br>
<strong>忙碌一天需要的三件事</strong><br><sub>TOP 3 清单 · 10.9 秒</sub>
</td>
</tr>
</table>

应用的**导出**通过 MediaRecorder 实时录制相同构图。以上示例使用同一渲染器逐帧绘制，再以 30 fps H.264 编码以获得较高最终质量。素材、音乐署名及制作说明见 [docs/examples/README.md](docs/examples/README.md)。

## CLI 与集成

CLI 编辑**项目设置和字幕**。在仓库根目录运行：

```sh
# Create a sample project.
node cli/moment.mjs init --out project.json

# Apply the included explainer composition.
node cli/moment.mjs exec template.apply --project project.json --args-file examples/explainer.json --out edited.json

# Export captions with edits and playback speed reflected in the timestamps.
node cli/moment.mjs exec captions.export --project edited.json --out captions.srt
node cli/moment.mjs exec captions.export --project edited.json --json '{"format":"vtt"}' --out captions.vtt
node cli/moment.mjs exec captions.export --project edited.json --json '{"format":"txt"}' --out captions.txt

# Replace matching caption text without changing timing or speaker metadata.
node cli/moment.mjs exec captions.text.replace --project edited.json --json '{"find":"하루","replacement":"하루의 기록"}' --out corrected.json

# Make all captions larger without replacing their text or timing.
node cli/moment.mjs exec captions.style.update --project corrected.json --json '{"patch":{"captionSize":48}}' --out styled.json

# List commands and their input schemas.
node cli/moment.mjs commands
```

现有输出文件默认受保护；仅在确定替换时使用 `--overwrite`。对 `exec` 添加 `--dry-run` 可预览结果而不写文件。JSON 输入不得超过 10 MiB（10,485,760 字节）。

### 选择工作流程

**字幕**

| 任务 | 使用方式 | 注意事项 |
|---|---|---|
| 按页读取原始字幕 | [`captions.list`](INTEGRATIONS.md#저장된-자막을-나눠-조회) | 每页最多 50 条原始字幕，再用当前索引调用 `captions.update`。时间为变速前；实时页面不是快照或项目备份。 |
| 插入或删除单条字幕 | [`captions.insert` / `captions.remove`](INTEGRATIONS.md#자막-하나를-추가하거나-삭제) | 使用当前原始数组索引，不排序或调整其他字幕时间。结果不确定时先重新读取；盲目重试可能影响错误的字幕。 |
| 编辑单条字幕 | [`captions.update`](INTEGRATIONS.md#자막-하나만-수정) | 不必重传所有字幕，即可修改文字、时间、说话人或关键词。先查询当前数组位置；时间基准和估计时间标记保留。 |
| 修正重复用语 | [`captions.text.replace`](INTEGRATIONS.md#자막-문구-일괄-교정) | 区分大小写、非重叠的字面匹配；无正则表达式或 Unicode 归一化。时间、说话人/关键词和顺序不变。空白或过长结果使整次编辑失败。浏览器预览出现次数，实际更改可一次撤销。 |
| 先查看匹配项 | 浏览器上一项/下一项搜索控件 | 循环检查所有已编写行，包括被裁剪排除的字幕；滚动、聚焦并选中每行首个匹配，显示当前/总行数。一行只算一次；全部替换统计出现次数。不跳转播放、不编辑或保存。 |
| 修正固定字幕延迟 | [`captions.timing.shift`](INTEGRATIONS.md#자막-시간을-앞뒤로-이동) | 选择 source/timeline 及**变速前**有符号秒数。该基准下所有字幕一起移动；任一结果越界即全部拒绝。浏览器实际更改可一次撤销。 |
| 检查字幕显示密度 | 浏览器**检查阅读速度**或 [`captions.inspect`](INTEGRATIONS.md#편집-후-자막-표시-속도-점검) | 对剪辑、重复及变速后的非空白字素/秒按自选阈值排序，只读。不代表语言规范、语音对齐或导出有效性检查。 |
| 在光标处分割一条字幕 | [`captions.split`](INTEGRATIONS.md#자막-하나를-커서-위치에서-분할) 或行内分割操作 | 保留原文和元数据；按字素数估算时间，不做语音对齐。不能在表情符号/组合字符内部切分。与批量分割长字幕不同。 |
| 合并相邻字幕 | [`captions.merge`](INTEGRATIONS.md#인접한-자막-합치기) 或**与下一条字幕合并** | 合并下一条已编写行，可跨页。时间基准、说话人、关键词必须相同，时间按顺序且不重叠；间隙也显示合并文字。浏览器可一次撤销。 |
| 改变外观 | [`captions.style.update`](INTEGRATIONS.md#자막-스타일-수정) | 只修改指定的字号、位置、颜色及动画，无需重传项目。普通 SRT/VTT 不含视觉样式。 |
| 导入字幕文字 | [`captions.import`](INTEGRATIONS.md#srtvtt-본문을-명령으로-가져오기) | 替换全部字幕。传入内容而非路径，并明确 source/timeline 的**变速前**时间，而非输出时间。API：100,000 个 UTF-16 代码单元；浏览器文件：2 MiB。 |

在**检查阅读速度**中输入自己的正数阈值；没有预选标准。报告最多显示速度最高的 20 个出现区间，以及全部、超标和省略数量。**字幕**只聚焦原始编写行，不跳转；**查看区间**暂停并跳到指定输出出现位置，再聚焦该行。检查后项目或阈值发生变化时请重新检查。检查和导航不会编辑、保存或添加撤销记录。

字幕编辑器**每页显示 50 行**，提供上一页/下一页及可见范围。超过 50 条时，输入**从 1 开始的页码**并按**跳转**或 Enter，将焦点移至该页第一条字幕。可输入 1 到显示的末页，最多 200 页；无效输入保留焦点以便修正。切换界面语言会保留页码输入草稿和焦点。仅翻页不会编辑、保存、创建撤销记录或跳转播放。搜索、时间线选择、导入及新增字幕会打开目标行所在页。搜索、全部替换及长字幕分割仍覆盖整个编写列表；导出遵循整个项目的剪辑/变速规则，不局限于当前页。原有 10,000 条字幕和 2 MiB 限制不变。

**片段和构图**

| 任务 | 使用方式 | 注意事项 |
|---|---|---|
| 一起应用相关编辑 | [`project.batch`](INTEGRATIONS.md#여러-편집을-한-번에-반영) | 顺序验证 1–20 个支持的编辑，再提交一次；任一步被拒绝则项目不变。不是 JSON-RPC 批处理或跨主机存储事务。 |
| 重复片段 | [`timeline.duplicate`](INTEGRATIONS.md#클립-구간-복제) | 在选中的出现位置后紧接插入同一源区间，不复制媒体文件。源字幕重复，输出文字层时间按比例调整。 |
| 分割一个片段 | [`timeline.split`](INTEGRATIONS.md#클립-구간-분할) | 使用源视频时间而非输出时间；确认要修改的出现位置及边界。不替换整个时间线。 |
| 调整视频效果 | [`effects.update`](INTEGRATIONS.md#영상-효과-수정) | 在不替换内容或时间的情况下修改亮度、对比度、运动、边界叠加及进度样式。边界叠加不是交叉淡化。 |
| 设置来源署名 | [`credit.update`](INTEGRATIONS.md#출처-크레딧-수정) | 修改文字、外观和输出时间可见性，保留标题/字幕/卡片。最多 100 个 UTF-16 代码单元；不包含在字幕文件中。 |
| 编排定时卡片 | [`overlays.add`、`overlays.update`、`overlays.remove`](INTEGRATIONS.md#스크립트에-맞춰-카드-추가삭제) | 使用各自 ID 和**变速后**输出时间，无需替换项目。新增项追加到末尾；`overlays.move` 调整堆叠。UI 的**置于顶层 / 置于底层**只调整卡片间顺序。 |

### 选择集成方式

| 需求 | 使用方式 | 入口 |
|---|---|---|
| 编辑项目 JSON 或导出字幕文件 | Node CLI，保护现有输出 | [命令契约和文件流程](INTEGRATIONS.md) |
| 为 AI 提供项目指引 | 仓库技能，无需全局安装 | [Moment 编辑器技能](.agents/skills/moment-editor/SKILL.md) |
| 连接 AI 客户端 | 本地 stdio MCP：`node cli/mcp.mjs` | [客户端设置、工具、错误和恢复](docs/MCP.md) |
| 接入自己的代码 | 同页面 `window.moment` 或可复用服务/适配器 | `node examples/use-editor-service.mjs` |

运行 `node examples/use-mcp-client.mjs` 可执行握手 → 导入 → 编辑 → SRT → 重启/重新导入示例。它启动本地 Node 进程，并把导出的文档保存在内存；不会写入用户文件或连接浏览器。

**MCP 进程退出后，修改会丢失。** 调用 `moment_project_get`，通过客户端获准的文件流程保存 `structuredContent.data`。内置服务器只有一个临时 `session` 项目，不是当前浏览器项目。

**`render.plan` 不会生成 MP4。** CLI 和内置 MCP 都不上传媒体或编码视频。自定义远程主机需自行提供传输、身份验证和存储。外部 AI 客户端可能把项目文字发送到其提供商；分享私人字幕前请检查该客户端的隐私设置。

## 隐私和限制

**媒体留在设备上，但应用并非完全离线。** 字体从 Google Fonts 加载；自动字幕从 jsDelivr 下载代码，并从 Hugging Face 及相关运行时来源下载模型/运行时资源。语音推理在浏览器 Worker 中进行。网络请求和信任边界见 [SECURITY.md](SECURITY.md)。

| 输入或项目限制 | 上限 |
|---|---|
| 视频 / 附加音频 | 500 MiB / 100 MiB |
| 项目设置 JSON 保存/恢复 / SRT 或 VTT 输入 | 10 MiB / 2 MiB，UTF-8 |
| 片段 / 源字幕条目 | 1,000 / 10,000；每条 2,000 个 UTF-16 代码单元 |
| 自定义模板 / 定时文字层 | 20 / 12 |

已有 1,000 个片段时，必须先删除片段才能继续分割。

**这些是验证上限，不保证内存或编解码器能力。** 浏览器存储不是备份：媒体和设置分别写入，保存失败后可能失去同步。请保留原始媒体并定期导出项目 JSON。

**自动字幕：** 原始视频必须为 **180 秒或更短**，即使裁剪后更短也不能绕过原始时长限制。所选音频最多处理 180 秒。识别、手动说话人标签及估计的分割时间需要检查。

**视频导出：** 保持标签页可见；隐藏标签页会取消录制。MP4/WebM 支持取决于浏览器。录制实时进行，目标为 30 fps，不保证固定帧率。历史 4 秒 Chromium 测试平均约 21.7 fps；参见[实测报告](docs/BROWSER_QA.md)。

<details>
<summary>存储、待处理导入和转写冲突</summary>

**存储：** 媒体保存在 IndexedDB，编辑状态保存在 localStorage。二者分别写入，保存失败可能不一致。存储属于当前浏览器和源；更改主机名或端口会打开不同存储区。清除浏览器数据、隐私模式或空间不足可能导致丢失工作。没有云同步或远程备份。

**待处理导入：** 读取文本文件或等待应用期间，如果项目发生变化，会拒绝导入；请重新选择文件以应用到当前项目。选择另一个 JSON/SRT/VTT 会使之前的待处理导入失效，即使新文件随后失败。这些检查保护已应用状态，不涵盖尚未提交的输入框草稿。

**待处理转写：** 如果源媒体或现有字幕发生变化，或项目已被替换，结果不会应用；附加音频结果还要求音频偏移和编辑时长不变。请针对新输入重新生成。外观更改仍可使用。保护对象是已应用编辑，不是未提交的输入草稿；检测到冲突不保证停止模型计算。

</details>

<details>
<summary>UTF-8、字幕格式和时间规则</summary>

**文本导入：** 项目 JSON 和 SRT/VTT 应保存为 UTF-8，支持开头的 UTF-8 BOM。字幕的 LF、CRLF、CR 换行会归一为 LF，同时保留正文中的换行。无效 UTF-8 被拒绝，不替换当前项目或字幕。不会自动检测或转换其他编码。

**字幕文件：** 选择 **SRT**、**VTT** 或 **TXT**，使用字幕面板唯一的保存按钮。默认 SRT；翻页后保留格式选择。

**普通 WebVTT：** 选择 **VTT**，或给 CLI/MCP 导出命令传入 `format: "vtt"`。不传 `format` 仍导出 SRT；仅把文件名改成 `.vtt` 不会选择 VTT。VTT 使用 `WEBVTT` 文件头和点分隔的毫秒，编辑后时间与文字转义规则相同。不导出丰富样式、区域或说话人元数据。VTT 拒绝 NUL 字符。无字幕时 CLI/MCP 返回 `WEBVTT\n\n`；浏览器不下载空字幕文件。

**普通 TXT：** 每个派生字幕区间一个段落，按片段、重复及 source/timeline 字幕在变速后的输出顺序排列。重复或分割片段可能重复词句；不是去重或逐词准确的转录。不含时间戳、ID、说话人、标题、卡片或样式。原样保留 `<>&`、空白和多行文字，使用 LF 换行，区间间一个空行，末尾一个换行。允许空行和小于毫秒的字幕，拒绝 NUL。空结果返回 `""`。SRT/VTT 导入不能导入这种 TXT，也无法恢复其时间。

**SRT/VTT 文字：** 空行用于分隔字幕。导出拒绝空字幕或字幕内部空行，不会丢弃段落或重新分配时间。若要导出 SRT/VTT，请移除空行；项目 JSON 保留原始文字。支持普通多行字幕，输出中 CRLF/CR 归一为 LF。播放器对标记的支持各异，不保证通用兼容性。

**SRT/VTT 时间：** 裁剪和变速后，时间戳舍入到毫秒。若一条字幕舍入后的起止相同，则拒绝导出；请调整区间或播放速度。不会自动延长、删除或移动字幕，项目仍保留精确时间。

</details>

<details>
<summary>派生字幕预算和长字幕分割</summary>

**派生字幕限制：** 时间线字幕轨道和 SRT/VTT/TXT 导出最多支持 10,000 个编辑后出现区间及 2 MiB UTF-8 字幕文字；每次片段重复都计入。每个完整字幕文件另有 2 MiB 上限，包括转义、时间、分隔符、VTT 文件头和实际写入的 BOM（浏览器 SRT 含 BOM；浏览器 VTT/TXT 和 CLI/服务输出不含）。超限时拒绝整个派生输出，旧项目也同样适用；减少重复片段或字幕后可恢复。原始字幕编辑、项目 JSON、撤销和保存仍可使用。这些预算不保证界面响应速度或可用内存。

**长字幕分割：** 12/18/24 字目标及估计时间权重按字素簇计算，组合附加符号和连接表情保持完整，不做 Unicode 归一化。分割边界的空白按完整字素簇移除。此操作需要原生 `Intl.Segmenter`；不支持的运行时会报错并保持字幕不变。独立的 2,000 UTF-16 代码单元输入限制和 UTF-8 字节预算仍适用。分词取决于运行时的 Unicode 数据；估计时间仍需对照音频检查。

</details>

### 故障排查

- **页面无法加载：** 确认 `npm start` 仍在运行。4173 端口被占用时，停止另一服务器或把 `PORT` 环境变量设置为可用端口；使用服务器输出的地址。
- **视频无法打开或不能导出：** 尝试 H.264 MP4 或 WebM 输入，以及支持所需媒体 API 的其他浏览器。MOV 支持取决于内部编解码器。导出失败时也可尝试 720p。
- **自动字幕失败：** 使用有清晰语音的短原始素材，检查识别语言和网络，或导入 SRT/VTT 后手动编辑。内置示例不能转写。
- **项目似乎为空：** 回到相同浏览器、主机和端口。跨浏览器恢复 JSON 时，先重新连接原始视频和附加音频，再通过使用指南导入设置。
- **已保存模板无法读取：** 格式错误的自定义模板或收藏会在当前会话中隔离；为保留原存储值，会阻止模板库保存、删除和收藏更改。项目本身能加载时，仍可使用内置模板及项目编辑。刷新只重试读取，不会修复模板库；不会自动删除或抢救条目。
- **恢复失败：** 编辑器暂停项目保存、媒体替换、录音和重置，以保留已存数据。如果设置可读，可在内存中编辑并在刷新前通过使用指南保存编辑设置；这些编辑不会保存在浏览器中。刷新只重试加载，不能恢复缺失媒体或保证编解码器支持。未保存更改可能触发离开警告，但浏览器可能省略警告。

## 开发

```sh
npm test
node examples/use-editor-service.mjs
node examples/use-mcp-client.mjs
```

`npm test` 执行语法检查、编辑器回归检查，以及 CLI 文件 I/O、项目验证、MCP 生命周期/Schema/请求隔离、交互式 MCP 示例、字幕解析及本地 HTTP 服务器的 Node 测试。每个 `tests/app-*.test.mjs` 使用独立的模拟应用 VM 和 DOM；`verify.mjs` 保留合成与手势检查。完整回归集请运行 `npm test`。CI 配置包括 Linux 的 Node 20/22/24 和 Windows 的 Node 24；徽章链接到实际结果。

存储测试通过注入模拟事务失败检查取消、排队重试和保存状态，不验证真实浏览器配额不足、存储驱逐或崩溃恢复。

`dist/` 包含**维护中的应用源代码**，不是生成的构建输出：

```text
dist/               Browser UI, rendering, captions, and local persistence
  core/             DOM-free project model, validation, and editing commands
  integration/      Editor service and MCP adapter
cli/                Node.js project/caption CLI, stdio MCP session and transport
scripts/            Local preview server
examples/           Command arguments and runnable service/MCP examples
tests/              Node test suites
verify.mjs          Composition and preview-gesture regression checks
```

修改和问题报告参见 [CONTRIBUTING.md](CONTRIBUTING.md)，计划见 [ROADMAP.md](ROADMAP.md)，私密安全问题报告见 [SECURITY.md](SECURITY.md)。部分配套文档为韩语，MCP 设置和技能参考也提供英语内容。

[浏览器验证报告](docs/BROWSER_QA.md)记录 Chromium/macOS 对上传、字幕、持久存储和 MP4 导出的测试及性能边界。[QA.md](QA.md)说明回归覆盖。自动测试在必要时模拟浏览器 API，不证明麦克风、语音识别或跨浏览器兼容性。

## 许可证

项目代码和文档采用 [MIT](LICENSE) 许可证。下载的字体、库和模型遵循各自条款；参见 [THIRD_PARTY.md](THIRD_PARTY.md)。
