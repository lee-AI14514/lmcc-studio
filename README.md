<div align="center">
  <a href="https://electronjs.org/" target="_blank"><img src="https://electronjs.org/images/electron-logo.svg" width="200" alt="Electron 标志" /></a>
</div>
<h3 align="center">LMCC Studio</h3>
<p align="center">
基于 Electron + Monaco 的现代脚本工作区，采用深靛蓝色主题，内置 Inter / JetBrains Mono 字体，并重新设计了资源管理器、标签栏和对话框。
<br />

## 项目介绍

lmcc-studio 是一款基于 Electron 的应用，使用 Monaco Editor 提供代码编辑功能，并结合 React 构建用户界面、使用 @emotion/react 编写组件样式等现代 Web 技术进行开发。

## 技术栈

- Electron
- React
- Monaco Editor
- Recoil
- @emotion/react
- Material-UI

## 快速开始

按照以下步骤获取项目并在本地运行。

### 准备工作

克隆仓库：
```bash
git clone https://github.com/lee-AI14514/lmcc-studio.git
```

使用 npm 安装依赖：
```bash
$ npm install
```
启动应用：
```bash
npm start
```
## 使用方法

此处用于展示项目的实用使用示例，也可以补充截图、代码示例和演示。

## 试卷与本地试卷库

LMCC Studio 将 `~/.lmcc-studio` 下的每个文件夹视为一份试卷。启动时，应用会在资源管理器中打开首个识别到的试卷文件夹，并显示试卷概览标签页，而不是打开应用源代码文件夹。

### 试卷识别

- `~/.lmcc-studio` 下的每个直接子目录均视为一份试卷。
- 试卷根目录必须至少包含一个 `*.lmcc` 文件。如果文件夹中只有一个子目录，也会接受该结构，并将该子目录作为试卷根目录（与试卷导入器采用的单一顶层目录规则一致）。
- 如果存在 `.lmcc/runtime.json` 和 `.lmcc/contest.json`，界面会显示它们。缺少运行时配置时会提示“本地评测不可用”；缺少竞赛配置文件时仅显示提示信息。
- 试卷中任意位置的 `session.json` 以及旧版 `.lmcc-contest.json` 都会触发警告（本地应用可以创建这些文件，但不应随试卷分发）。
- 不接受通过符号链接引用的试卷文件夹、`.lmcc` 文件和元数据文件。
- 试卷概览会列出所有题目及其类型、ID、声明的作答文件和试卷级检查结果。点击题目卡片即可打开题目阅读器。
- 使用资源管理器顶部的试卷选择器切换试卷，或点击刷新按钮重新扫描 `~/.lmcc-studio`。
- 示例试卷（`~/.lmcc-studio/example`）包含四道完整的示例题，类型分别为 `files`、`prompt`、`training` 和 `agent`。

### 试卷限制

- 最多支持 200 份试卷，每份试卷最多包含 500 个 `.lmcc` 文件；每个题目文件最大为 32 MiB，每份试卷的题目文件总大小最大为 64 MiB。
- 题目元数据文件（`.lmcc/runtime.json`、`.lmcc/contest.json`）的大小上限为 1 MiB。
- 不提供 ZIP 导入功能；请将试卷压缩包解压到 `~/.lmcc-studio` 下的文件夹中，然后点击刷新。

## 阅读 `.lmcc` 题目

LMCC Studio 可以打开 `.lmcc` 题目文件，并在专用阅读器中展示，而非使用纯文本编辑器。解析器遵循 LMCC 文件格式：以 `LMCC/1` 作为文件头，后接 JSON 格式的题目声明。

### 打开题目

- 点击试卷概览中的题目卡片。
- 点击资源管理器顶部的**打开题目**并选择 `.lmcc` 文件，或按下 `Ctrl/Cmd+O`。
- 也可以在资源管理器工作区中双击任意 `*.lmcc` 文件。
- `.lmcc` 标签页默认显示题目视图；切换到**原文**后，可以查看带有 `LMCC/1` 和 JSON 语法高亮的原始文件。

### 阅读器展示内容

- 安全渲染的 Markdown 题面（禁用原始 HTML，链接仅允许使用 `http:`、`https:` 和 `mailto:`，本地图片相对于题目根目录解析）。
- 题目类型、ID、根目录、题目主目录、题面路径和声明的配置。
- 作答文件表格，包括必需或可选标记、长度限制和文件在磁盘上的状态。
- 可配置的 `inputs`、提示词长度检查和训练文件检查。
- 校验面板，其错误信息与格式规范保持一致。

### 已实现的规则

- 严格按照以下流程解析：移除 BOM、规范化 CRLF 换行符、要求以 `LMCC/1\n` 开头，然后调用 `JSON.parse`。
- 校验顶层结构、`files[]`、题目类型（`files` / `prompt` / `training` / `agent`）、`inputs[]`、`promptLimit`、`localTest`、`remoteDebug`、`evaluationCode` 和 `submission`。
- 实现 `safeName` / `answerPath` 路径规则（包括 `.lmcc/{git,history,tmp}` 和 `session.json` / `runtime.json` 保留区域），并在主进程中通过 `checkedPath` 拒绝符号链接。
- 识别 `.lmcc/<id>/statement.md` 对应的题目主目录。
- 实施 1000 个文件、100 个输入项、100 个字段以及 10 MiB 作答大小的限制。
- 通过 Electron 主进程读取作答文件、题面和图片，并限制文件大小（题目文件 32 MiB、题面 4 MiB、图片 16 MiB）。

### 注意事项

- 提示词的 Token 计数需要内置的 GLM-4 分词器；阅读器会显示配置的 `maxTokens` / `maxLength` 限制，但不会统计 Token 数量。
- `submission.endpoints` 使用 AES-256-GCM 加密；阅读器仅显示其已配置，不会解密。
- `LMCC/1` 后紧接一个空行是允许的，因为 `JSON.parse` 会跳过开头的空白字符（格式说明声称这种情况会失败，此处以运行时实际行为为准）。
- 使用 `CI=true npx react-scripts test --watchAll=false` 运行单元测试。

## 本地评测

题目阅读器可以运行题目声明的 Python 评测脚本，并将输出实时显示在右侧的**评测机**面板中。

- 实际执行的脚本由 `localTest.script` 指定；`evaluationCode` 保持只读，不会执行。脚本通过 Python 调用，因此应为 Python 源文件（通常为 `.py` 文件）。
- 评测程序以声明的脚本所在目录作为工作目录，与原版 IDE 保持一致。调用方式为 `<python> -u <script> --mode grading`（也可通过面板的模式选择器切换为 `--mode demo`）。当前题目信息通过 `LMCC_QUESTION_ID`、`LMCC_QUESTION_TYPE`、`LMCC_QUESTION_FILE` / `LMCC_PROBLEM_FILE`、`LMCC_QUESTION_ROOT`、`LMCC_EVALUATION_SCRIPT` 和 `LMCC_RUNTIME_ID` 环境变量提供。
- Python 的查找顺序为：`LMCC_PYTHON`、根据 `runtimeId` 推导出的指定版本解释器（例如 `lmcc-python-3.12` 对应 `python3.12`）、`python3`，最后是 `python`。
- 标准输出和标准错误分别实时传入面板。点击**停止**按钮会终止整个进程组；关闭题目标签页或窗口也会停止评测程序。
- 单次运行最长为 10 分钟，输出上限为 4 MiB。可以通过 `LMCC_EVALUATION_TIMEOUT_MS`（单位为毫秒）覆盖超时时间。面板仅保留最近的 1,000,000 个字符；应用仍会解析原始标准输出，以提取最终的 `{"ok": true|false}` 结果对象。
- 本地评测必须提供 `.lmcc/runtime.json`：文件缺失、缺少 `runtimeId`、JSON 无效或文件不可读时，评测按钮都会被禁用。`capabilities.localEvaluation: false` 也会禁用该按钮。指定版本的解释器根据 `runtimeId` 推导，但本应用未附带原版 `lmcc-runtimes.json` 注册表，因此任意运行时 ID 最终仍可回退到本地 Python。
- 脚本必须位于题目根目录内；不接受通过符号链接引用的评测脚本路径。评测程序以当前用户的权限运行，且**不在沙箱中执行**，因此请仅运行可信试卷。
- 内置示例试卷 `~/.lmcc-studio/example` 中的 T1/T3 共用 `evaluate.py`，该脚本会忽略额外的 `--mode` 参数。T1 可以通过评测，而 T3 会有意在输出中报告重复行和指令为空的行。
- 真实的 2025 年 T 试卷安装在 `~/.lmcc-studio/paper-2025-T`。其中的 `evaluate.py` 要求提供 `--mode demo|grading` 参数和 `MODEL_NAME` 目录；使用兼容的 Python 和模型运行时，两份已完成的 `submission.py` 均可通过公开的 10 道题测试。

## 开发路线

请查看尚未关闭的 Issue，了解计划中的功能和已知问题。

## 参与贡献

开源社区因每一份贡献而成为学习、启发与创造的美好平台。我们衷心感谢你的任何贡献。

## 许可证

本项目采用 MIT 许可证分发。详见 LICENSE 文件。

## 联系方式

项目链接：https://github.com/jihwankim97/electron-monacoEditor

<!-- Markdown 链接与图片 -->

## 参与贡献

开源社区因每一份贡献而成为学习、启发与创造的美好平台。我们衷心感谢你的任何贡献。

如果你有改进建议，请先 Fork 本仓库，再提交 Pull Request。你也可以直接创建带有 `enhancement` 标签的 Issue。别忘了为项目点亮 Star，再次感谢！

1. Fork 本项目。
2. 创建功能分支（`git checkout -b feature/AmazingFeature`）。
3. 提交修改（`git commit -m 'Add some AmazingFeature'`）。
4. 推送到分支（`git push origin feature/AmazingFeature`）。
5. 提交 Pull Request。

## 许可证

本项目采用 MIT 许可证分发。详见 LICENSE 文件。

项目链接：https://github.com/jihwankim97/electron-monacoEditor
