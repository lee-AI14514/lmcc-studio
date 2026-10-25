<div align="center">
  <a href="https://electronjs.org/" target="_blank"><img src="https://electronjs.org/images/electron-logo.svg" width="200" alt="Electron Logo" /></a>
</div>
<h3 align="center">LMCC Studio</h3>
<p align="center">
A modern Electron + Monaco scripting workspace — dark indigo theme, bundled Inter / JetBrains Mono type, and a redesigned explorer, tab bar and dialogs.
<br />
Explore the docs »
<br />
<a href="https://github.com/jihwankim97/electron-monacoEditor/issues">Report Bug</a>
·
<a href="https://github.com/jihwankim97/electron-monacoEditor/issues">Request Feature</a>
</p>
<div align="center">
  <img src="/public/EditorScreenshot.png" alt="LMCC Studio — modern dark UI">
</div>

About The Project
electron-monaco-editor is an Electron-based application designed  with a code editor using Monaco Editor. It incorporates modern web technologies such as React for UI, and @emotion/react for styled components, making development.

Built With
Electron
React
Monaco Editor
Recoil
@emotion/react
Material-UI
Getting Started
To get a local copy up and running follow these simple steps.

Prerequisites

clone
```bash
git clone https://github.com/jihwankim97/electron-monacoEditor.git
```

npm
```bash
$ npm install
```
start
```bash
npm start
```
Usage
Use this space to show useful examples of how a project can be used. Additional screenshots, code examples, and demos work well in this space.

Papers and the local paper library
LMCC Studio treats a folder under `~/.lmcc-studio` as one paper (试卷). At startup it opens the first recognized paper folder in the Explorer and shows a paper overview tab — not the application source folder.

Paper recognition

- Each immediate directory under `~/.lmcc-studio` is a paper.
- A paper must contain at least one root-level `*.lmcc` file. A folder with exactly one child directory is also accepted and treated using that child as its root (the same single-top-level rule used by the paper importer).
- `.lmcc/runtime.json` and `.lmcc/contest.json` are displayed when present. A missing runtime is reported as “本地评测不可用”; a missing contest file is informational.
- `session.json` anywhere in the paper and the legacy `.lmcc-contest.json` are reported as warnings (the local app can create them, but they should not be distributed).
- Symlinked paper folders, `.lmcc` files and metadata files are refused.
- The paper overview lists every question, type, id, declared answer files and paper-level checks. Click a question card to open the normal question reader.
- Use the paper selector in the Explorer header to switch papers, or the refresh button to rescan `~/.lmcc-studio`.
- The example paper (`~/.lmcc-studio/example`) is a complete four-question example: `files`, `prompt`, `training` and `agent`.

Paper limits

- at most 200 papers, 500 `.lmcc` files per paper, 32 MiB per question file and 64 MiB of question files per paper;
- question metadata files (`.lmcc/runtime.json`, `.lmcc/contest.json`) are capped at 1 MiB;
- ZIP import is not performed; extract a paper package into a folder under `~/.lmcc-studio` and click refresh.

Reading `.lmcc` questions
LMCC Studio can open `.lmcc` question files and show them in a dedicated reader instead of the plain text editor. The parser follows the LMCC file format (`LMCC/1` header followed by a JSON question declaration).

Open a question

- Click a question card in the paper overview.
- Click **打开题目** in the Explorer header and pick a `.lmcc` file, or press `Ctrl/Cmd+O`.
- Or double-click any `*.lmcc` file in the Explorer workspace.
- `.lmcc` tabs show the question view; the **原文** switch shows the raw file with `LMCC/1` + JSON highlighting.

What the reader shows

- the statement Markdown rendered safely (raw HTML disabled, links limited to `http:`, `https:` and `mailto:`, local images resolved against the question root);
- the question type, id, root, question home, statement path and declared configuration;
- the answer-file table with required/optional flags, length limits and on-disk status;
- configurable `inputs`, prompt length checks and training-file checks;
- a validation panel with the same error messages as the format specification.

Rules implemented

- the exact parse pipeline: strip BOM, normalise CRLF, require `LMCC/1\n`, then `JSON.parse`;
- top-level, `files[]`, question-type (`files` / `prompt` / `training` / `agent`), `inputs[]`, `promptLimit`, `localTest`, `remoteDebug`, `evaluationCode` and `submission` validation;
- `safeName` / `answerPath` path rules (including the `.lmcc/{git,history,tmp}` and `session.json` / `runtime.json` reserved areas) and `checkedPath` symlink rejection in the main process;
- question home detection for `.lmcc/<id>/statement.md`;
- the 1000-file, 100-input, 100-field and 10 MiB answer limits;
- answer files, statements and images are read through the Electron main process with size caps (32 MiB question file, 4 MiB statement, 16 MiB image).

Notes

- prompt Token counting requires the built-in GLM-4 tokenizer; the reader displays the configured `maxTokens` / `maxLength` limits but does not count tokens.
- `submission.endpoints` is encrypted with AES-256-GCM; the reader reports it as configured without decrypting it.
- a blank line directly after `LMCC/1` is accepted because `JSON.parse` skips leading whitespace (the format notes claim it fails; the runtime behaviour wins).
- run the unit tests with `CI=true npx react-scripts test --watchAll=false`.

Local evaluation

The question reader can run the Python evaluator declared by the question and stream its output into the right-hand **评测机** panel.

- The executable script is `localTest.script`; `evaluationCode` remains read-only and is not run. The script is invoked with Python, so it should be a Python source file (typically `.py`).
- The evaluator runs with the declared script's directory as its working directory, matching the original IDE. It is invoked as `<python> -u <script> --mode grading` (or `--mode demo` via the panel's mode selector). The current question is exposed as `LMCC_QUESTION_ID`, `LMCC_QUESTION_TYPE`, `LMCC_QUESTION_FILE` / `LMCC_PROBLEM_FILE`, `LMCC_QUESTION_ROOT`, `LMCC_EVALUATION_SCRIPT` and `LMCC_RUNTIME_ID`.
- Python lookup order is `LMCC_PYTHON`, a versioned interpreter derived from `runtimeId` (for example `lmcc-python-3.12` → `python3.12`), then `python3`, then `python`.
- stdout and stderr are streamed separately into the panel. The **停止** button terminates the process group. Closing the question tab or the window also stops the evaluator.
- A run is limited to 10 minutes and 4 MiB of output. Override the timeout with `LMCC_EVALUATION_TIMEOUT_MS` (milliseconds). The panel keeps the most recent 1,000,000 characters on screen; the raw stdout is still parsed for a final `{"ok": true|false}` result envelope.
- `.lmcc/runtime.json` is required for local evaluation: a missing file, missing `runtimeId`, invalid JSON or unreadable file disables the button. `capabilities.localEvaluation: false` also disables it. The versioned interpreter is derived from `runtimeId`, but this app does not ship the original `lmcc-runtimes.json` registry, so an arbitrary runtime id still falls back to the local Python.
- The script must stay inside the question root; symlinked evaluator paths are rejected. The evaluator itself runs with the current user's permissions and is **not** sandboxed, so only run trusted papers.
- The bundled `~/.lmcc-studio/example` T1/T3 questions share `evaluate.py`; it ignores the extra `--mode` argument. T1 passes, while T3 intentionally reports the duplicate and empty-instruction lines in its output.
- The real 2025 T paper is installed at `~/.lmcc-studio/paper-2025-T`. Its `evaluate.py` expects `--mode demo|grading` and a `MODEL_NAME` directory; both solved `submission.py` files pass the public 10-question tests when run with a compatible Python/model.

Roadmap
See the open issues for a list of proposed features (and known issues).

Contributing
Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

License
Distributed under the MIT License. See LICENSE for more information.

Contact
Project Link: https://github.com/jihwankim97/electron-monacoEditor

<!-- Markdown links & images -->


Contributing
Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

If you have a suggestion that would make this better, please fork the repository and create a pull request. You can also simply open an issue with the tag "enhancement". Don't forget to give the project a star! Thanks again!

Fork the Project
Create your Feature Branch (git checkout -b feature/AmazingFeature)
Commit your Changes (git commit -m 'Add some AmazingFeature')
Push to the Branch (git push origin feature/AmazingFeature)
Open a Pull Request
License
Distributed under the MIT License. See LICENSE file for more information.

Project Link: https://github.com/jihwankim97/electron-monacoEditor
