<img width="1094" height="722" alt="屏幕截图 2026-08-06 130850" src="https://github.com/user-attachments/assets/75299bbd-2bbd-4430-9fb1-01ebae3da9e5" />
# LaTeX Input

> LaTeX 公式输入面板 — 妈妈再也不用担心我遇到不认识的希腊字母了~

一个为 Obsidian 设计的 LaTeX 公式输入插件。点选符号面板自动生成源码、实时预览、插入到当前笔记；支持**屏幕选区截图识别**和**剪贴板图片识别**，公式录入快人一步。

![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?style=flat-square&logo=obsidian&logoColor=white)
![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Desktop-lightgrey?style=flat-square)
![License](https://img.shields.io/badge/license-GPL--3.0-orange?style=flat-square)

---

## ✨ 特性

- 🎯 **点选符号** — 10 个分类、~250 条符号，点击即插入到光标位置
- 👀 **实时预览** — 所见即所得，所写即所得
- ⌨️ **可编辑源码** — 源码框支持 LaTeX 微调
- 📸 **截图识别公式** — `Ctrl+Shift+S` 拖拽选区，OCR 自动转 LaTeX
- 📋 **剪贴板识别** — 截图后 `Ctrl+Shift+R` 直接读图
- 🕘 **历史记录** — 自动持久化，可载入继续编辑
- 🌗 **暗色适配** — 完美跟随 Obsidian 主题
- 📦 **零外部依赖** — MathLive 已内联进 `main.js`

---

## 🚀 快速开始

### 方式一：从 Release 下载（推荐）

1. 前往 [Releases](../../releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 在 vault 下创建路径：`.obsidian/plugins/latex-input/`
3. 把上面三个文件放进去
4. **设置 → 第三方插件 → 已安装插件** → 启用 **LaTeX Input**

### 方式二：源码构建

```bash
git clone <this-repo>
cd latex-input
npm install
npm run build
```

构建产物 `main.js` 在仓库根目录，连同 `manifest.json` / `styles.css` 一起部署到 `.obsidian/plugins/latex-input/`。

---

## ⌨️ 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 插入行内公式 `$...$` | `Ctrl + Shift + L` |
| 插入行间公式 `$$...$$` | `Ctrl + Shift + M` |
| 截图识别（选区，行内） | `Ctrl + Shift + S` |
| 截图识别（选区，行间） | `Alt + Shift + S` |
| 剪贴板识别（行内） | `Ctrl + Shift + R` |
| 剪贴板识别（行间） | `Alt + Shift + R` |
| 面板内插入到笔记 | `Ctrl + Enter` |
| 关闭面板 | `Esc` |

> 也可点击左侧栏 **σ** 图标打开面板。`设置 → 快捷键` 可重新绑定。

---

## 📸 截图识别

https://github.com/user-attachments/assets/da416d31-9908-4a8f-b58d-0f04f32faa7d

按 `Ctrl+Shift+S`（行内）/ `Alt+Shift+S`（行间）：

1. **屏幕共享可用时** — 弹出全屏遮罩，**拖拽框选公式区域** → 释放后自动 OCR 并插入
2. **屏幕共享不可用时** — 自动切到「剪贴板轮询」模式，右下角小浮窗提示；任意方式截图后**自动检测 + 自动识别 + 自动插入**

按 `Ctrl+Shift+R` / `Alt+Shift+R` 直接读取剪贴板中的图片。

> 首次使用需在插件设置里配置 OCR 服务（API 地址、Key、模型名）。

---

## 🧩 面板布局
<img width="1094" height="722" alt="屏幕截图 2026-08-06 130850" src="https://github.com/user-attachments/assets/4776dae5-77ff-43ee-8668-9d5be4aab068" />

---

## 🛠 自定义符号

打开 `symbols.ts`，按格式添加：

```ts
{ display: "∑", insert: "\\sum_{i=1}^{n} " }
```

- `display` — 按钮上显示的文字
- `insert` — 点击后插入的 LaTeX 源码
- 需光标定位时，在 `insert` 里放 `{cursor}`

```bash
npm run build   # 重新编译
```

---

## 📁 文件结构

```
latex-input/
├── manifest.json       # Obsidian 插件元数据
├── main.js             # 编译产物（运行时加载）
├── main.ts             # 入口源码
├── symbols.ts          # 符号库（10 分类、~250 条）
├── styles.css          # 样式
├── package.json        # npm 配置
├── esbuild.config.mjs  # 构建脚本（esbuild + MathLive 虚拟模块）
├── tsconfig.json       # TypeScript 配置
└── versions.json       # 版本兼容映射
```

---

## 📄 许可

Copyright © 2026 Sun · Licensed under [GPL-3.0](./LICENSE)
