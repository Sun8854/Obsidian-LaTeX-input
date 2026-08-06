/**
 * LaTeX Input — AxMath 风格的公式输入面板
 *
 * 主要组件：
 *   - LaTeXInputPlugin  —— 注册命令、快捷键、面板生命周期
 *   - LaTeXInputModal   —— 浮层 UI（顶栏 / 预览 / 符号面板 / 历史记录）
 *   - HistoryStore      —— 简单的 localStorage 持久化
 */

import { App, Component, Editor, MarkdownRenderer, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { SYMBOL_CATEGORIES, parseInsert } from "./symbols";
// MathLive JS 由 esbuild 虚拟模块以「ES module」形式 bundle 进 main.js（见 esbuild.config.mjs）。
//   副作用：模块加载时 MathLive 的 UMD body 立即执行，customElements.define("math-field", ...)
//   完成注册，<math-field> 元素即可在 DOM 中使用。这样做既绕开 Obsidian Electron 渲染层
//   相对路径解析问题（base URL 是 Obsidian app 目录而非插件目录），也避免了运行时动态
//   注入 <script> 元素（更安全：不存在从字符串/textContent 注入任意代码的路径）。
//   MathLive 的 CSS 已合并到 styles.css，Obsidian 会自动加载，无需运行时注入。
import "mathlive-js";

/* ===================================================================
 * MathLive 集成 —— https://github.com/arnog/mathlive
 *   MathLive 是成熟的 Web 公式编辑器，<math-field> 元素提供所见即所得的 LaTeX 输入。
 *
 *   资源加载策略（按优先级回退）：
 *     1) main.js 内部 bundle 的 MathLive 模块（side-effect import，UMD body 在模块加载时执行）
 *        —— 零外部依赖、零相对路径问题、零动态 <script> 注入
 *     2) jsdelivr CDN
 *     3) unpkg CDN
 *     失败时 MathLive 元素退化为普通 div，仍可由 renderMath() 渲染（仅预览）
 *
 *   API 速记：
 *     - mathField.value = "x^2"          // 写入 LaTeX
 *     - mathField.getValue('latex')      // 读出 LaTeX
 *     - mathField.insert("y")            // 在光标处插入
 *     - mathField.addEventListener('input', cb)  // 输入事件
 *     - mathField.executeCommand('insertDecimalPlace')  // 键盘命令
 * =================================================================== */
const MATHLIVE_VERSION = "0.103.0";
const MATHLIVE_VERSION_KEY = "__latexInputMathLiveVersion";
const MATHLIVE_CDN_URLS = [
    "https://cdn.jsdelivr.net/npm/mathlive@0.103.0/dist/mathlive.min.js",
    "https://unpkg.com/mathlive@0.103.0/dist/mathlive.min.js",
];
// SRI (Subresource Integrity) 哈希，对应 MATHLIVE_VERSION 的 dist/mathlive.min.js。
//   升级 MathLive 版本时必须同步更新此哈希 —— 浏览器会拒绝加载哈希不匹配的文件。
//   校验命令：Get-FileHash -Algorithm SHA384 vendor/mathlive.min.js
//             然后把 hex 转 base64，拼成 "sha384-<base64>"
const MATHLIVE_CDN_SRI = "sha384-mVhrhGPJMkDuAaH2uTAksDyhxMdnM4x/GuBdG6VPMqrl7cliamMDF3ak52uvO0be";

declare global {
    interface Window {
        [MATHLIVE_VERSION_KEY]?: string;
    }
}

function isMathLiveLoaded(): boolean {
    // 1) 我们自己之前加载过（CDN fallback 留下的版本标记）
    // 2) bundled import 已经把 <math-field> custom element 注册到 globalThis
    return !!window[MATHLIVE_VERSION_KEY] || !!customElements.get("math-field");
}

/**
 * 从 CDN 加载 MathLive（带纵深防御）：
 *   - URL 必须在白名单内（不允许任意 https URL）
 *   - 加 SRI integrity 哈希，浏览器校验文件内容
 *   - crossorigin=anonymous + referrerpolicy=no-referrer，减少侧信道泄漏
 *   - 同一 URL 不会重复注入
 *
 * 仅在 bundled import 未能成功注册 <math-field> 时作为兜底使用。
 */
function loadCdnScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!MATHLIVE_CDN_URLS.includes(url)) {
            return reject(new Error("script URL 不在白名单内: " + url));
        }
        const existing = document.querySelector(`script[data-mathlive-cdn-src="${url}"]`);
        if (existing) return resolve();
        const s = document.createElement("script");
        s.src = url;
        s.async = false;
        s.crossOrigin = "anonymous";
        s.referrerPolicy = "no-referrer";
        s.integrity = MATHLIVE_CDN_SRI;
        s.dataset.mathliveCdnSrc = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("script 加载失败: " + url));
        document.head.appendChild(s);
    });
}

/**
 * 加载 MathLive。
 *   bundled 路径：side-effect import 在 main.ts 顶层完成，<math-field> 已在 customElements
 *   注册表里。这里只是确认并补上版本号。
 *   CDN 路径：loadCdnScript 走 SRI + 白名单的兜底。
 * 多次调用复用同一份 Promise。
 * 失败时 reject 让上层走回退逻辑（MathLive 元素退化为普通 div）。
 */
export function loadMathLive(): Promise<void> {
    if (isMathLiveLoaded()) {
        if (!window[MATHLIVE_VERSION_KEY]) window[MATHLIVE_VERSION_KEY] = MATHLIVE_VERSION;
        return Promise.resolve();
    }
    const cacheKey = "__latexInputMathLivePromise";
    const cached = (window as any)[cacheKey] as Promise<void> | undefined;
    if (cached) return cached;

    const p = (async () => {
        // bundled import 应已注册 <math-field>；走到这里说明没有，
        // 退到 CDN。
        let lastErr: any = null;
        for (const url of MATHLIVE_CDN_URLS) {
            try {
                await loadCdnScript(url);
                window[MATHLIVE_VERSION_KEY] = MATHLIVE_VERSION;
                console.log("[LaTeX Input] MathLive 从 CDN 加载 ✓:", url);
                return;
            } catch (e) {
                console.warn("[LaTeX Input] MathLive CDN JS 失败，尝试下一个源:", url, e);
                lastErr = e;
            }
        }
        throw lastErr || new Error("MathLive CDN 都加载失败");
    })();
    (window as any)[cacheKey] = p;
    return p;
}

/**
 * 工具：在已加载 MathLive 的前提下，把任意 string 安全地写到 math-field。
 * 失败（MathLive 未加载 / 元素不是 math-field）时退化为 fallback 函数。
 *
 * 注意：直接 `mf.value = ...` 会触发 MathLive 的 setValue（insertionMode: "replaceAll"），
 *   1) 整段重写 model，selection 被重置（光标跳到末尾）
 *   2) setValue 内部通过 setTimeout(0) 派发合成 `input` 事件到 host
 *   3) 如果同步读 mf.getValue()，可能拿不到最新值（要等下一个 microtask）
 *
 * 调用方在写完之后应该挂一个短期屏蔽标志，阻止合成的 input 事件回写到 buffer。
 * `syncMathFieldFromBuffer` 内部已经包了；`bootstrapMathField` 也是。直接调用本函数要自己处理。
 */
function writeMathField(mf: HTMLElement, latex: string, fallback: () => void) {
    if (isMathLiveLoaded() && mf && (mf as any).tagName?.toLowerCase() === "math-field") {
        try {
            (mf as any).value = latex ?? "";
            return;
        } catch (e) {
            console.warn("[LaTeX Input] writeMathField 失败，回退:", e);
        }
    }
    fallback();
}

function readMathField(mf: HTMLElement, fallback: string): string {
    if (isMathLiveLoaded() && mf && (mf as any).tagName?.toLowerCase() === "math-field") {
        try {
            const v = (mf as any).getValue?.("latex");
            if (typeof v === "string") return v;
        } catch (e) {
            console.warn("[LaTeX Input] readMathField 失败，回退:", e);
        }
    }
    return fallback;
}

function insertToMathField(mf: HTMLElement, latex: string, fallback: () => void) {
    if (isMathLiveLoaded() && mf && (mf as any).tagName?.toLowerCase() === "math-field") {
        try {
            (mf as any).insert(latex ?? "");
            // 注意：mf.insert() 内部用 setTimeout(0) 派发合成的 `input` 事件；
            //   如果我们立即 focus，会和 MathLive 的 onSelectionDidChange 抢焦点，
            //   有概率把 MathLive 的内部 state 搅乱。延迟到下一个 microtask 让它先消化完。
            // 另外：mf.insert() 不传 {silenceNotifications:true}，所以 input 事件会派发，
            //   我们的监听器会同步更新 buffer 和源码框 —— 完美。
            setTimeout(() => {
                try { (mf as any).focus?.(); } catch (_) { /* ignore */ }
            }, 0);
            return;
        } catch (e) {
            console.warn("[LaTeX Input] insertToMathField 失败，回退:", e);
        }
    }
    fallback();
}

/* ===================================================================
 * 插件设置
 *   - 单一引擎：任意 OpenAI 兼容的视觉 API
 *   - baseUrl 可配置，默认指向 MiniMax（保留默认体验）
 *   - 旧版 ocrEngine / minimaxApiKey 会在 loadSettings() 中迁移到 custom* 字段
 * =================================================================== */
type OcrEngine = "custom";

interface LaTeXInputSettings {
    ocrEngine: OcrEngine;
    // 自定义 OpenAI 兼容 API
    customApiKey: string;
    customBaseUrl: string;
    customModel: string;
}

const DEFAULT_SETTINGS: LaTeXInputSettings = {
    ocrEngine: "custom",
    customApiKey: "",
    customBaseUrl: "https://api.minimax.chat/v1",
    customModel: "MiniMax-M2.7-highspeed",
};

/* ===================================================================
 * 截图：从系统剪贴板读取图片
 *   流程：用户在系统层（Win+Shift+S / macOS Cmd+Shift+4 / 各种截图工具）截图
 *   → 截图进入剪贴板 → 我们从剪贴板读取 image/* Blob
 * =================================================================== */
async function readImageFromClipboard(): Promise<Blob | null> {
    // 优先用 navigator.clipboard.read（支持图片）
    if (navigator.clipboard && typeof navigator.clipboard.read === "function") {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                for (const type of item.types) {
                    if (type.startsWith("image/")) {
                        const blob = await item.getType(type);
                        return blob;
                    }
                }
            }
        } catch (e) {
            console.warn("[LaTeX Input] clipboard.read failed, trying paste event", e);
        }
    }
    // 退化方案：暂时不可行（无 paste 事件就拿不到剪贴板图）
    return null;
}

/* ===================================================================
 * OCR 引擎统一返回类型
 *   latex       — 识别出的 LaTeX 字符串
 *   confidence  — 置信度（0~1），部分服务不返回
 *   raw         — 原始返回数据，便于调试
 * =================================================================== */
export interface OcrResult {
    latex: string;
    confidence?: number;
    raw: any;
}

/* ===================================================================
 * 自定义 OpenAI 兼容 OCR
 *   端点：POST {baseUrl}/chat/completions
 *   鉴权：Authorization: Bearer <key>
 *   图片：content 块用 {type: "image_url", image_url: {url: "data:..."}}
 *   响应：{ choices: [{message: {content: "..."}}] }
 *
 *   默认 baseUrl = https://api.minimax.chat/v1
 *   可改成任意 OpenAI 兼容的视觉 API（月之暗面、智谱 GLM-4V、Qwen-VL、Ollama 等）
 *   只要对方支持 chat/completions + image_url 字段
 * =================================================================== */
async function recognizeFormulaWithCustom(blob: Blob, apiKey: string, baseUrl: string, model: string): Promise<OcrResult> {
    if (!apiKey || !apiKey.trim()) {
        throw new Error("未配置 API key，请在「设置 → LaTeX Input → API Key」中填入。");
    }

    // 1) 图像预处理：保证尺寸在 [512, 2048] 区间，加白底
    //    解决：截图过小模型看不清、过大浪费 token
    const dataUri = await prepareImageForOCR(blob);

    // 2) 第一次尝试：标准 prompt
    let raw = await callCustomOCR(
        apiKey,
        baseUrl,
        model,
        "请仔细观察图片，把其中所有的数学公式转换为 LaTeX 源码。",
        dataUri,
    );
    // 提取：剥掉 <think> 块 / ```代码块 / $...$ 包裹
    let latex = extractLatex(raw);

    // 3) 验证：模型经常返回推理文本（"用户没有提供图片..."）
    //    这种"伪 LaTeX"如果直接插入会污染笔记，必须重试
    if (!looksLikeLatex(latex)) {
        raw = await callCustomOCR(
            apiKey,
            baseUrl,
            model,
            "直接输出 LaTeX 源码，不要任何其他文字。即使公式复杂或图片模糊，也请输出你认为最可能的结果。绝不返回空字符串或解释。",
            dataUri,
        );
        latex = extractLatex(raw);
    }

    if (!looksLikeLatex(latex)) {
        const hint = latex
            ? `\n最后一次返回（提取后）的前 200 字符：\n${latex.slice(0, 200)}`
            : `\n最后一次返回（提取后）为空。原始前 200 字符：\n${raw.slice(0, 200)}`;
        throw new Error(
            "AI 两次都未返回有效 LaTeX。\n" +
            "可能原因：\n" +
            "  1) 当前模型「" + (model || "未填") + "」不支持图像（最常见）\n" +
            "  2) 截图模糊或不含公式\n" +
            "  3) API key 无图像调用权限\n" +
            "  4) Base URL 不正确或服务不可达\n" +
            "建议：\n" +
            "  · 到「设置 → LaTeX Input」点「列出可用模型」换一个支持视觉的模型\n" +
            "  · 确认 Base URL 末尾的 /v1 不能少" +
            hint
        );
    }

    return { latex, confidence: undefined, raw: null };
}

/* ===================================================================
 * OCR 系统 prompt —— 重点是"别瞎推理，直接给 LaTeX"
 *   之前版本留了"找不到就返回空"的口子，模型直接拿这个当挡箭牌
 *   现在再加一条：禁止输出 <think> 等推理块（DeepSeek R1 风格）
 * =================================================================== */
const CUSTOM_OCR_SYSTEM_PROMPT =
    "你是一个数学公式 OCR 助手。\n" +
    "\n" +
    "任务：用户会提供一张包含数学公式的图片。请仔细观察图片中的每一个数学公式、表达式、符号，并将其转换为 LaTeX 源码。\n" +
    "\n" +
    "输出规则（必须严格遵守）：\n" +
    "1. 严格只输出 LaTeX 源码本身\n" +
    "2. 多行公式（cases、aligned、矩阵、方程组）使用对应 LaTeX 环境\n" +
    "3. 上下标统一用 ^{}_{} 形式\n" +
    "4. 分数统一用 \\frac{}{}\n" +
    "5. 希腊字母、根号、积分、求和、极限等用标准 LaTeX 命令\n" +
    "6. 即使图片模糊、光照差、角度倾斜，也要尽最大努力推断最可能的 LaTeX 源码\n" +
    "7. 图片中所有的数学公式都要识别出来，不要漏掉\n" +
    "8. 只在图片完全空白或完全不含数学符号时才返回空字符串\n" +
    "\n" +
    "【绝对禁止】\n" +
    "- 不要输出任何解释、思考过程、推理过程\n" +
    "- 不要输出 <think>...</think> 或 <reasoning>...</reasoning> 等标签\n" +
    "- 不要用 Markdown 代码块（```）包裹\n" +
    "- 不要用 $...$ 或 $$...$$ 包裹\n" +
    "- 直接、单独输出 LaTeX 源码，第一行就是答案，最后一行也是答案，中间不要夹杂其他内容\n" +
    "\n" +
    "重要提醒：不要解释、不要分析、不要讨论图像内容、不要谈'用户是否提供了图片'。直接输出 LaTeX 源码。";

/* ===================================================================
 * OCR 实际请求（只发请求 + 提取 content，不做验证）
 *   接受任意 baseUrl（OpenAI 兼容协议）
 *   注意：baseUrl 必须以 /v1 结尾（不强制但建议）
 * =================================================================== */
async function callCustomOCR(apiKey: string, baseUrl: string, model: string, userText: string, dataUri: string): Promise<string> {
    const modelName = (model || "").trim() || "MiniMax-M2.7-highspeed";
    // baseUrl 容错：去掉尾部 /，自动补 /chat/completions
    const base = (baseUrl || "https://api.minimax.chat/v1").trim().replace(/\/+$/, "") || "https://api.minimax.chat/v1";
    const url = `${base}/chat/completions`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
            model: modelName,
            max_tokens: 4096,
            messages: [
                { role: "system", content: CUSTOM_OCR_SYSTEM_PROMPT },
                {
                    role: "user",
                    content: [
                        { type: "image_url", image_url: { url: dataUri } },
                        { type: "text", text: userText },
                    ],
                },
            ],
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        if (res.status === 401) throw new Error("API key 无效或过期（401）");
        if (res.status === 429) throw new Error("触发限流，等一会儿再试（429）");
        if (res.status === 402 || res.status === 403) throw new Error("账户欠费或无权限（" + text.slice(0, 150) + "）");
        // 404/400 经常是模型名不存在（不支持视觉的模型也不会报这个，而是返回空内容）
        if (res.status === 404 || res.status === 400) {
            throw new Error(`模型「${modelName}」在 ${base} 不存在或不可用（HTTP ${res.status}）：${text.slice(0, 200)}`);
        }
        if (res.status === 0 || res.status >= 500) {
            throw new Error(`服务不可达或异常（HTTP ${res.status}）：${text.slice(0, 200)}\n请检查 Base URL 是否正确。`);
        }
        throw new Error(`API ${res.status}：${text.slice(0, 200)}`);
    }

    const json = await res.json();
    // 调试日志：把原始响应打到 console，方便诊断
    console.log("[LaTeX Input] OCR raw response:", JSON.stringify(json).slice(0, 800));

    const choice = json.choices?.[0];
    const message = choice?.message;

    // DeepSeek R1 / 推理模型会在 reasoning_content 里放思考过程
    // （不应作为答案，但记录到 console 方便调试）
    if (message?.reasoning_content) {
        console.log("[LaTeX Input] OCR reasoning_content (ignored):",
            String(message.reasoning_content).slice(0, 400));
    }

    // 取 content（实际答案）
    let latex = "";
    const content = message?.content;
    if (typeof content === "string") {
        latex = content;
    } else if (ArrayIsArray(content)) {
        for (const block of content) {
            if (block?.type === "text" && typeof block.text === "string") {
                latex = block.text;
                break;
            }
        }
    }
    return (latex || "").trim();
}

/* ===================================================================
 * 简易类型守卫（不要引出整个 lodash）
 * =================================================================== */
function ArrayIsArray(x: any): x is any[] {
    return Array.isArray(x);
}

/* ===================================================================
 * 验证返回的字符串是否像 LaTeX
 *   防止模型返回推理文本（"用户没有提供图片..."）被当作公式插入
 * =================================================================== */
function looksLikeLatex(s: string): boolean {
    if (!s) return false;
    const t = s.trim();
    if (t.length < 2) return false;
    // 含中文字符 → 几乎肯定不是 LaTeX
    if (/[\u4e00-\u9fff]/.test(t)) return false;
    // 出现 AI 推理关键词 → 不是 LaTeX
    if (/(用户|图片|没有提供|没有|根据|规则|无法|看不清|抱歉|我是|作为)/.test(t)) return false;
    // 太长但没有任何 LaTeX 特征符号（\ ^ _ { }）→ 不可信
    if (t.length > 30 && !/[\\^_{}]/.test(t)) return false;
    return true;
}

/* ===================================================================
 * 从模型原始输出里"提取" LaTeX —— 处理 3 类常见包装
 *   1) <think>...</think> / <reasoning>...</reasoning> 等推理块
 *   2) Markdown 代码块 ```latex ... ```
 *   3) LaTeX 边界符 $...$ / $$...$$
 *
 *   模型可能还是忍不住输出推理块，所以即使 prompt 改了也要做这步
 * =================================================================== */
function extractLatex(raw: string): string {
    if (!raw) return "";
    let text = raw;

    // 1) 去掉 <think>...</think> 块（DeepSeek R1 风格，可能未闭合）
    text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
    // 2) 其它常见的推理 / 分析 / 反思标签
    text = text.replace(/<(?:reasoning|analysis|reflection|thought|think)>(?:[\s\S]*?<\/(?:reasoning|analysis|reflection|thought|think)>|$)/gi, "");

    text = text.trim();

    // 3) 整段被 ```...``` 包裹 → 取内部
    const codeBlock = text.match(/^```(?:latex|tex|math)?\s*\n?([\s\S]*?)\n?```$/i);
    if (codeBlock) {
        return codeBlock[1].trim();
    }
    // 4) 去掉孤立的 ``` 标记
    text = text.replace(/```(?:latex|tex|math)?/gi, "").replace(/```/g, "").trim();

    // 5) 去掉 $$...$$ 整段包裹
    const dbl = text.match(/^\$\$([\s\S]+?)\$\$$/);
    if (dbl) return dbl[1].trim();
    // 6) 去掉 $...$ 整段包裹
    const sgl = text.match(/^\$([\s\S]+?)\$$/);
    if (sgl) return sgl[1].trim();

    return text;
}

/* ===================================================================
 * 图像预处理：resize 到 [512, 2048] 区间 + 加白底
 *   - 太小（< 512）：模型看不清，向上 resize
 *   - 太大（> 2048）：浪费 token，向下 resize
 *   - 加白底：避免透明 PNG 出现识别异常
 * =================================================================== */
async function prepareImageForOCR(blob: Blob): Promise<string> {
    const MIN_SIZE = 512;
    const MAX_SIZE = 2048;

    // 直接读 data URL（避免再用一次 FileReader）
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

    // 加载图片拿到尺寸
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("图片解码失败"));
        i.src = dataUrl;
    });

    let { width, height } = img;

    // 决定是否需要 resize
    const needResize =
        width > MAX_SIZE || height > MAX_SIZE ||
        width < MIN_SIZE || height < MIN_SIZE;
    if (!needResize) {
        // 尺寸已经在合理范围，加白底以防透明 PNG
        return addWhiteBackground(img, width, height);
    }

    if (width > MAX_SIZE || height > MAX_SIZE) {
        const scale = Math.min(MAX_SIZE / width, MAX_SIZE / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }
    if (width < MIN_SIZE || height < MIN_SIZE) {
        const scale = Math.max(MIN_SIZE / width, MIN_SIZE / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl; // fallback
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
}

function addWhiteBackground(img: HTMLImageElement, width: number, height: number): string {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return img.src;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
}

/* ===================================================================
 * 工具：Blob → base64 字符串（去掉 data:image/xxx;base64, 前缀）
 * =================================================================== */
async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const idx = result.indexOf(",");
            resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/* ===================================================================
 * SimpleTex OCR  —— 已删除（v0.1.0 起不再支持）
 * =================================================================== */

/**
 * 按当前设置分派到对应的 OCR 引擎
 *   现在只剩 custom（任意 OpenAI 兼容 API）
 */
async function recognizeFormula(blob: Blob, settings: LaTeXInputSettings): Promise<OcrResult> {
    return recognizeFormulaWithCustom(
        blob,
        settings.customApiKey,
        settings.customBaseUrl,
        settings.customModel,
    );
}

/* ===================================================================
 * 引擎连通性测试：发一个最小请求验证凭据 / 服务连通性
 *   仅用于设置页的「测试连接」按钮，不读剪贴板、不消耗识别额度
 *   返回 { ok, msg } 给 UI 直接显示
 * =================================================================== */
type EngineTestResult = { ok: boolean; msg: string };

/* ===================================================================
 * 测试连接：发一个最小 chat/completions 请求（baseUrl 可配）
 *   仅用于设置页的「测试连接」按钮，不读图、不消耗识别额度
 *   返回 { ok, msg } 给 UI 直接显示
 * =================================================================== */
async function testCustomConnection(apiKey: string, baseUrl: string, model: string): Promise<EngineTestResult> {
    if (!apiKey || !apiKey.trim()) return { ok: false, msg: "未填写 API key" };
    const base = (baseUrl || "https://api.minimax.chat/v1").trim().replace(/\/+$/, "") || "https://api.minimax.chat/v1";
    const useModel = (model || "").trim() || "MiniMax-M2.7-highspeed";
    try {
        const res = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey.trim()}`,
            },
            body: JSON.stringify({
                model: useModel,
                max_tokens: 4,
                messages: [{ role: "user", content: "ping" }],
            }),
        });
        if (res.ok) return { ok: true, msg: `已连接 ${base} ✓（模型 ${useModel}）` };
        if (res.status === 401) return { ok: false, msg: "API key 无效或过期（401）" };
        if (res.status === 429) return { ok: false, msg: "触发限流（key 有效，等一会儿再试）" };
        if (res.status === 402 || res.status === 403) return { ok: false, msg: "账户欠费或无权限" };
        if (res.status === 404) return { ok: false, msg: `Base URL 或模型不存在（HTTP 404）— 检查 ${base} 是否带 /v1 结尾，或换个模型名` };
        const text = await res.text();
        return { ok: false, msg: `HTTP ${res.status}：${text.slice(0, 120)}` };
    } catch (e: any) {
        return { ok: false, msg: `网络错误（${base}）：${e?.message || e}` };
    }
}

/* ===================================================================
 * 列出 baseUrl 下可用的模型
 *   GET {baseUrl}/models  → { data: [{id, ...}, ...] }
 *   用来判断哪些模型支持视觉（名字常含 vision / multimodal / VL / V ）
 *   注意：不是所有 OpenAI 兼容服务都实现了 /models，失败时给个友好提示
 * =================================================================== */
async function listCustomModels(apiKey: string, baseUrl: string): Promise<EngineTestResult> {
    if (!apiKey || !apiKey.trim()) return { ok: false, msg: "未填写 API key" };
    const base = (baseUrl || "https://api.minimax.chat/v1").trim().replace(/\/+$/, "") || "https://api.minimax.chat/v1";
    try {
        const res = await fetch(`${base}/models`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${apiKey.trim()}` },
        });
        if (!res.ok) {
            const text = await res.text();
            if (res.status === 401) return { ok: false, msg: "API key 无效或过期（401）" };
            if (res.status === 404) return { ok: false, msg: `${base} 不支持 /models 端点（HTTP 404）。该服务可能没实现列出模型功能，请查阅其文档` };
            return { ok: false, msg: `HTTP ${res.status}：${text.slice(0, 200)}` };
        }
        const json = await res.json();
        const list: string[] = [];
        if (Array.isArray(json?.data)) {
            for (const m of json.data) {
                if (m && typeof m.id === "string") list.push(m.id);
            }
        } else if (Array.isArray(json)) {
            for (const m of json) {
                if (m && typeof m.id === "string") list.push(m.id);
                else if (typeof m === "string") list.push(m);
            }
        }
        if (list.length === 0) {
            return { ok: false, msg: "返回了空列表（接口格式可能不一样）" };
        }
        // 视觉模型通常带 vision / vl / multimodal 等关键词
        const visionLike = list.filter(id => /vision|vl\b|multimodal|visual|llava|gpt-4o|claude|gemi/i.test(id));
        const tip = visionLike.length > 0
            ? ` 视觉可能支持的：${visionLike.join("、")}`
            : " 没看到明显的视觉模型名（名字里通常含 vision/vl/multimodal）";
        return {
            ok: true,
            msg: `共 ${list.length} 个模型：\n${list.join("\n")}\n${tip}`,
        };
    } catch (e: any) {
        return { ok: false, msg: `网络错误（${base}）：${e?.message || e}` };
    }
}


const HISTORY_KEY = "latex-input.history.v1";
const MAX_HISTORY = 50;

interface HistoryItem {
    /** 实际写入笔记的完整字符串（带 $...$ 或 $$...$$） */
    full: string;
    /** 纯 LaTeX 源码（用于在面板中重新编辑） */
    src: string;
    /** 行内 / 行间 */
    block: boolean;
    /** 时间戳 */
    ts: number;
}

class HistoryStore {
    private items: HistoryItem[] = [];

    constructor() {
        this.load();
    }

    private load() {
        try {
            const raw = localStorage.getItem(HISTORY_KEY);
            if (raw) this.items = JSON.parse(raw);
        } catch (_) {
            this.items = [];
        }
    }

    private save() {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(this.items.slice(0, MAX_HISTORY)));
        } catch (_) { /* quota / private mode — ignore */ }
    }

    add(item: HistoryItem) {
        // 去重：相同 src + block 的不重复入栈
        this.items = this.items.filter(i => !(i.src === item.src && i.block === item.block));
        this.items.unshift(item);
        if (this.items.length > MAX_HISTORY) this.items.length = MAX_HISTORY;
        this.save();
    }

    list(): HistoryItem[] {
        return this.items.slice();
    }

    clear() {
        this.items = [];
        try { localStorage.removeItem(HISTORY_KEY); } catch (_) { /* ignore */ }
    }
}

/* ===================================================================
 * 预览渲染：使用 Obsidian 内置的 MarkdownRenderer（自带 MathJax）
 *   好处：
 *     - 体积小（不需要打包 KaTeX）
 *     - 离线可用
 *     - 渲染效果与笔记完全一致
 * =================================================================== */
let _previewSeq = 0;
async function renderMath(src: string, el: HTMLElement, block: boolean, app: App, component?: Component) {
    if (!src.trim()) {
        el.empty();
        el.createDiv({ cls: "latex-input-preview-placeholder", text: "在下方点击符号，或在源码框中直接输入 LaTeX" });
        return;
    }
    // 包裹成 markdown 段落
    const wrapped = block ? `$$\n${src}\n$$` : `$${src}$`;
    el.empty();
    const seq = ++_previewSeq;
    // 每次新建一个 Component，调用方负责 unload（避免内存泄漏）
    const comp = component || new Component();
    try {
        await MarkdownRenderer.render(app, wrapped, el, "", comp);
        // 如果在 await 期间已经触发了新的渲染，丢弃旧结果
        if (seq !== _previewSeq) comp.unload();
    } catch (e: any) {
        el.empty();
        el.createDiv({ cls: "latex-input-preview-error", text: e?.message || "渲染失败" });
        comp.unload();
    }
}

/* ===================================================================
 * 主 Modal
 * =================================================================== */
type Mode = "inline" | "block";

class LaTeXInputModal extends Modal {
    private editor: Editor;
    private mode: Mode = "inline";
    private activeCategory: string = SYMBOL_CATEGORIES[0].key;
    private latexBuffer: string = "";

    private mathFieldEl!: HTMLElement;     // <math-field>（MathLive 加载失败时降级为普通 div）
    private sourceEl!: HTMLTextAreaElement; // LaTeX 源码 textarea（默认折叠，可点按钮展开）
    private sourceWrapEl!: HTMLElement;    // 源码外层容器（用于显示/隐藏）
    private toggleSourceBtn!: HTMLButtonElement;
    private panelEl!: HTMLElement;
    private tabsEl!: HTMLElement;
    private historyEl!: HTMLElement;
    private statusEl!: HTMLElement;
    private history: HistoryStore;
    private settings: LaTeXInputSettings;
    private ocrBtn!: HTMLButtonElement;
    private fileOcrBtn!: HTMLButtonElement;
    private sourceVisible = false;          // 源码框是否展开（默认折叠，MathLive 是主编辑）
    private _mathFieldFocused = false;     // MathLive 是否拿到焦点（由 focus/blur 事件维护）
    private _suppressInput = false;        // 屏蔽 input 事件：bootstrap 时写初始值期间为 true
    private _lastUserInputAt = 0;          // 最近一次用户在 MathLive 里敲键盘的时间戳（ms）
    private _modalPointerDown: ((e: PointerEvent) => void) | null = null; // 模态 pointerdown 监听器引用（用于 onClose 清理）

    private pasteHandler = (e: ClipboardEvent) => this.handlePaste(e);

    constructor(app: any, editor: Editor, history: HistoryStore, settings: LaTeXInputSettings, initial?: string, mode?: Mode) {
        super(app);
        this.editor = editor;
        this.history = history;
        this.settings = settings;
        if (typeof initial === "string") this.latexBuffer = initial;
        if (mode) this.mode = mode;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("latex-input-modal");
        this.modalEl.addClass("latex-input-modal-container");

        // 强制 inline style 覆盖 Obsidian Modal 默认行为
        //   原因：Obsidian 1.5+ 的 .modal 有 inline style（max-height: 100vh 等），
        //   CSS class 的优先级不够，必须用 setCssStyles 直接设
        //   min-height: 0 + max-height 硬限制 = 内部 flex 子项能正常收缩
        const m = this.modalEl;
        m.setCssStyles({
            position: "relative",
            top: "auto",
            bottom: "auto",
            left: "auto",
            right: "auto",
            margin: "auto",
            width: "min(1100px, 92vw)",
            maxWidth: "1100px",
            height: "min(720px, 86vh)",
            maxHeight: "86vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
        });
        // contentEl 也加保险
        contentEl.setCssStyles({
            flex: "1 1 auto",
            minHeight: "0",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
        });

        this.buildLayout();
        this.bindGlobalKeys();
        this.renderTabs();
        this.renderPanel();
        this.renderHistory();

        // 模态级别 pointerdown 监听：用户在编辑区"空白处"点击时，强制把焦点送回 MathLive
        //   解决问题：
        //     1) Obsidian 模态打开后焦点可能跑去某个工具按钮，导致用户在 MathLive 上敲键盘不响应
        //     2) 用户点过工具栏/历史/源码区后再回来，需要重新点 MathLive 才有反应
        //   不会影响的元素：button / a / input / textarea / 任何 math-field（包括它的 shadow 子元素）
        this._modalPointerDown = (ev: PointerEvent) => {
            const t = ev.target as HTMLElement | null;
            if (!t) return;
            if (t.closest("button, a, input, textarea, math-field, [data-no-autofocus]")) return;
            // 用户明确点了历史条目（要让它自己处理）；只对"真正的空白"或非交互元素抢焦点
            if (t.closest(".latex-input-history-item")) return;
            // 异步到当前 click 流程之后执行，避免和别的 listener 抢顺序
            setTimeout(() => this.focusMathField(), 0);
        };
        this.contentEl.addEventListener("pointerdown", this._modalPointerDown);

        // MathLive 是异步加载的：先尝试初始化，失败时回退到旧版预览
        this.bootstrapMathField().catch((e) => {
            console.warn("[LaTeX Input] MathLive 初始化失败，使用旧版预览:", e);
        });
    }

    /**
     * 引导 MathLive：
     *   1) 尝试加载内嵌 / CDN
     *   2) 升级 <math-field> 元素 + 绑定事件
     *   3) 同步初始 latexBuffer 到 math-field
     *   4) 任何一步失败都不影响 Modal 使用，源码框 + 旧 preview 仍然可用
     */
    private async bootstrapMathField() {
        if (!this.mathFieldEl) return;
        // 加载前显示占位（已通过 HTML 默认渲染）
        try {
            await loadMathLive();
        } catch (e) {
            // 内嵌 + CDN 都失败：把 math-field 换成普通 div 走旧版渲染
            this.flashMathLiveStatus("MathLive 加载失败，已切换到只读预览模式", "warn");
            this.hidePlaceholder();
            this.fallbackToPlainPreview();
            this.updateSource();
            this.renderPreview();
            return;
        }

        // 防御：custom element 可能晚于我们的 await 解析而被定义（理论上同步，
        //   但保险起见再等一下），等到了再继续 —— 避免对未 upgrade 的 HTMLElement 调 setOptions
        try {
            if ((customElements as any).whenDefined) {
                await (customElements as any).whenDefined("math-field");
            }
        } catch (_) { /* ignore */ }

        // MathLive 加载成功：给 math-field 套主题 + 事件
        try {
            const mf = this.mathFieldEl as any;
            // 主题：跟随 Obsidian 主题（亮/暗）
            const isDark = document.body.classList.contains("theme-dark");
            if (typeof mf.setOptions === "function") {
                mf.setOptions({
                    defaultMode: "math",
                    smartMode: false,
                    smartFence: false,
                    // 浅色主题
                    ...(isDark
                        ? {
                              color: "#e0e0e0",
                              backgroundColor: "#1f1f1f",
                              accentColor: "#7ab060",
                              caretColor: "#e0e0e0",
                          }
                        : {
                              color: "#1a1a1a",
                              backgroundColor: "#fffdf3",
                              accentColor: "#4a6f3a",
                              caretColor: "#1a1a1a",
                          }),
                    virtualKeyboardLayout: "off",
                    virtualKeyboardMode: "manual",
                });
            }
            // 双向同步：math-field → latexBuffer（单向：只让 MathLive 流到 buffer/源码框）
            //   千万不要再写回 MathLive —— 会重置 value 把光标跳走，导致按键被吞
            mf.addEventListener("input", () => {
                // 如果是我们自己 setValue 引发的合成 input 事件，忽略（避免无意义回写）
                if (this._suppressInput) return;
                const v = readMathField(this.mathFieldEl, this.latexBuffer);
                this.latexBuffer = v;
                // 记录用户开始敲键盘的时间 —— 用于"刚写完初始值时短暂屏蔽外部 setValue"
                this._lastUserInputAt = Date.now();
                // 直接同步源码框（programmatic set 不触发 textarea 的 input 事件）
                if (this.sourceEl && this.sourceEl.value !== v) {
                    this.sourceEl.value = v;
                }
                this.updateStatus();
            });

            // 焦点状态跟踪 —— 给"pointerdown 重定向"和"模态外点失焦"判断用
            mf.addEventListener("focus", () => { this._mathFieldFocused = true; });
            mf.addEventListener("blur", () => { this._mathFieldFocused = false; });

            // 点击 math-field 强制拿回焦点 —— 防止 Obsidian 模态开了之后焦点被分走
            //   （比如在初始化阶段 <math-field> 还没完全 upgrade，mf.focus() 是个空方法）
            mf.addEventListener("pointerdown", (ev: Event) => {
                // 不要 preventDefault —— 让 MathLive 自己的 pointerdown handler 跑（它要算光标位置）
                // 只确保：用户松手之后焦点在 math-field 上
                setTimeout(() => this.focusMathField(), 0);
                void ev;
            });

            // 隐藏占位
            this.hidePlaceholder();
        } catch (e) {
            console.warn("[LaTeX Input] math-field 初始化失败:", e);
            this.hidePlaceholder();
            this.fallbackToPlainPreview();
            this.updateSource();
            this.renderPreview();
            return;
        }

        // 加载成功：把初始 latexBuffer 写入 math-field
        //   用 _suppressInput 包住，避免合成 input 事件回写到 buffer 时产生任何视觉抖动
        if (this.latexBuffer) {
            this._suppressInput = true;
            try {
                writeMathField(this.mathFieldEl, this.latexBuffer, () => {});
            } finally {
                // MathLive 内部派发 input 是 setTimeout(0)，我们更晚一点释放屏蔽
                setTimeout(() => { this._suppressInput = false; }, 50);
            }
        }
        this.updateSource();
        this.updateStatus();
        this.flashMathLiveStatus("MathLive ✓ — 可直接输入公式，符号面板插入 LaTeX 模板", "ok");

        // 多次 focus 重试，覆盖 Obsidian 模态打开时焦点管理的不确定性
        //   0ms   ：原版时机
        //   rAF   ：等下一次重绘（layout 完成）
        //   50ms  ：覆盖 modal open animation 期间的 focus 抢占
        //   200ms ：兜底（动画慢的机器上）
        this.focusMathField();
        requestAnimationFrame(() => this.focusMathField());
        setTimeout(() => this.focusMathField(), 50);
        setTimeout(() => this.focusMathField(), 200);
    }

    /**
     * 把焦点放到 MathLive 编辑区。封装成一个方法，bootstrap 和"点击空白区"都复用。
     *   - 如果 MathLive 加载失败或元素被替换，回退到源码框
     *   - 如果当前焦点已经在源码框（用户主动展开源码在编辑），不抢
     */
    private focusMathField() {
        if (!this.mathFieldEl) return;
        // 用户在源码框里编辑时，不要抢焦点
        if (document.activeElement === this.sourceEl) return;
        const tag = (this.mathFieldEl as any).tagName?.toLowerCase?.();
        if (tag === "math-field") {
            try {
                (this.mathFieldEl as any).focus?.();
            } catch (_) { /* ignore */ }
        } else {
            // 已降级为普通 div —— 让源码框拿焦点
            try { this.sourceEl?.focus?.(); } catch (_) { /* ignore */ }
        }
    }

    /**
     * MathLive 加载失败时把 <math-field> 元素降级为普通 div，走旧版 MarkdownRenderer 渲染
     */
    private fallbackToPlainPreview() {
        if (!this.mathFieldEl) return;
        const div = document.createElement("div");
        div.className = "latex-input-preview";
        this.mathFieldEl.replaceWith(div);
        this.mathFieldEl = div;
    }

    /** 隐藏加载占位 */
    private hidePlaceholder() {
        if (!this.mathFieldEl) return;
        const ph = (this.mathFieldEl as any)._placeholder as HTMLElement | undefined;
        if (ph) ph.classList.add("is-hidden");
    }

    private flashMathLiveStatus(msg: string, kind: "ok" | "warn" = "ok") {
        if (!this.statusEl) return;
        const orig = this.statusEl.textContent;
        this.statusEl.setText(msg);
        this.statusEl.addClass(kind === "warn" ? "is-warn" : "is-flash");
        setTimeout(() => {
            this.statusEl.removeClass("is-flash");
            this.statusEl.removeClass("is-warn");
            this.statusEl.setText(orig || "");
        }, 2400);
    }

    onClose() {
        if (this._modalPointerDown) {
            this.contentEl.removeEventListener("pointerdown", this._modalPointerDown);
            this._modalPointerDown = null;
        }
        this.contentEl.empty();
        document.removeEventListener("paste", this.pasteHandler);
    }

    /* ----------- DOM 构建 ----------- */
    private buildLayout() {
        const root = this.contentEl;
        root.addClass("latex-input-root");

        // === 顶栏 ===
        const toolbar = root.createDiv({ cls: "latex-input-toolbar" });
        this.buildToolbar(toolbar);

        // === 主体：左侧(预览+源码) / 右侧(历史) ===
        const main = root.createDiv({ cls: "latex-input-main" });
        const left = main.createDiv({ cls: "latex-input-left" });
        const right = main.createDiv({ cls: "latex-input-right" });

        // ===== MathLive 可视化编辑区（替代原"预览"） =====
        const previewWrap = left.createDiv({ cls: "latex-input-preview-wrap" });
        const previewHeader = previewWrap.createDiv({ cls: "latex-input-section-header" });
        const previewLabel = previewHeader.createDiv({ cls: "latex-input-section-label" });
        previewLabel.setText("公式编辑（MathLive）");

        const previewTools = previewHeader.createDiv({ cls: "latex-input-source-tools" });
        // 切换 LaTeX 源码可见
        this.toggleSourceBtn = previewTools.createEl("button", {
            text: "</> 源码",
            cls: "latex-input-mini-btn",
        });
        this.toggleSourceBtn.title = "显示 / 隐藏 LaTeX 源码框";
        this.toggleSourceBtn.addEventListener("click", () => this.toggleSource());

        const clearBtn = previewTools.createEl("button", { text: "清空", cls: "latex-input-mini-btn" });
        clearBtn.addEventListener("click", () => {
            this.latexBuffer = "";
            this.updateSource();
            // 写完之后把焦点送回 MathLive（按钮被点了，焦点跑去 button 上了）
            setTimeout(() => this.focusMathField(), 0);
        });
        const exampleBtn = previewTools.createEl("button", { text: "示例", cls: "latex-input-mini-btn" });
        exampleBtn.addEventListener("click", () => {
            this.latexBuffer = "\\frac{1}{2} \\int_{\\frac{\\pi}{2}}^{0} \\cos 2t\\,d(2t)";
            this.updateSource();
            setTimeout(() => this.focusMathField(), 0);
        });

        // MathLive <math-field> —— 占据原"预览"位置
        const previewInner = previewWrap.createDiv({ cls: "latex-input-preview-inner" });
        // 即使 MathLive 还没加载，也先创建元素（loadMathLive 完成后会自动升级）
        this.mathFieldEl = previewInner.createEl("math-field", { cls: "latex-input-math-field" });
        // 给一个最小尺寸，避免加载前塌陷
        (this.mathFieldEl as HTMLElement).setCssStyles({
            minHeight: "80px",
            display: "block",
        });
        // 加载前的占位提示
        const placeholder = previewInner.createDiv({
            cls: "latex-input-math-field-placeholder",
            text: "正在加载 MathLive…",
        });
        (this.mathFieldEl as any)._placeholder = placeholder;

        // ===== 矩阵/数组行/列操作工具条（光标在矩阵里才生效） =====
        // MathLive 自带 addRowAfter / addRowBefore / removeRow / addColumnAfter / addColumnBefore / removeColumn
        //   + 右键菜单也可调出同样的菜单。但用户不知道，加一排显式按钮降低门槛
        const matrixTools = previewInner.createDiv({ cls: "latex-input-matrix-tools" });
        const mkMatrixBtn = (label: string, title: string, command: string) => {
            const btn = matrixTools.createEl("button", { text: label, cls: "latex-input-mini-btn latex-input-matrix-btn" });
            btn.title = title;
            btn.addEventListener("click", () => {
                if (!this.mathFieldEl) return;
                const mf = this.mathFieldEl as any;
                if (typeof mf.executeCommand !== "function") return;
                try {
                    mf.executeCommand(command);
                } catch (e) {
                    // executeCommand 在光标不在矩阵里时可能抛错 —— 静默忽略
                }
                // 按钮被点了会抢焦点，操作完把焦点送回 MathLive
                setTimeout(() => this.focusMathField(), 0);
            });
            return btn;
        };
        mkMatrixBtn("+ 行", "在光标下方插入一行（等价于 MathLive addRowAfter，右键菜单也有）", "addRowAfter");
        mkMatrixBtn("行 +", "在光标上方插入一行（addRowBefore）", "addRowBefore");
        mkMatrixBtn("− 行", "删除光标所在行（removeRow）", "removeRow");
        mkMatrixBtn("+ 列", "在光标右侧插入一列（addColumnAfter）", "addColumnAfter");
        mkMatrixBtn("列 +", "在光标左侧插入一列（addColumnBefore）", "addColumnBefore");
        mkMatrixBtn("− 列", "删除光标所在列（removeColumn）", "removeColumn");

        // ===== LaTeX 源码框（默认折叠，MathLive 是主编辑） =====
        this.sourceWrapEl = left.createDiv({ cls: "latex-input-source-wrap is-hidden" });
        const sourceHeader = this.sourceWrapEl.createDiv({ cls: "latex-input-section-header" });
        const sourceLabel = sourceHeader.createDiv({ cls: "latex-input-section-label" });
        sourceLabel.setText("LaTeX 源码（同步）");
        const sourceNote = sourceHeader.createDiv({
            cls: "latex-input-source-note",
            text: "与 MathLive 双向同步，编辑后会自动反映到公式区",
        });

        this.sourceEl = this.sourceWrapEl.createEl("textarea", { cls: "latex-input-source" });
        this.sourceEl.spellcheck = false;
        this.sourceEl.rows = 3;
        this.sourceEl.addEventListener("input", () => {
            // 源码 → math-field（MathLive 加载后实时同步；未加载时只更新 buffer）
            this.latexBuffer = this.sourceEl.value;
            this.syncMathFieldFromBuffer();
        });
        this.sourceEl.addEventListener("keydown", (e) => this.handleSourceKeydown(e));

        // 状态/字数
        this.statusEl = left.createDiv({ cls: "latex-input-status" });

        // === 符号面板 ===
        const symbolWrap = left.createDiv({ cls: "latex-input-symbol-wrap" });
        this.tabsEl = symbolWrap.createDiv({ cls: "latex-input-tabs" });
        this.panelEl = symbolWrap.createDiv({ cls: "latex-input-panel" });

        // === 历史 ===
        const historyWrap = right.createDiv({ cls: "latex-input-history-wrap" });
        const historyLabel = historyWrap.createDiv({ cls: "latex-input-section-label" });
        historyLabel.setText("历史记录");
        this.historyEl = historyWrap.createDiv({ cls: "latex-input-history" });
        const histTools = historyWrap.createDiv({ cls: "latex-input-history-tools" });
        const clearHistBtn = histTools.createEl("button", { text: "清空历史", cls: "latex-input-mini-btn" });
        clearHistBtn.addEventListener("click", () => {
            if (confirm("清空全部历史记录？")) {
                this.history.clear();
                this.renderHistory();
                this.flashStatus("已清空历史 ✓");
            }
        });

        // 焦点交给 MathLive —— 延迟到 MathLive 加载完成后再 focus
    }

    /** 切换 LaTeX 源码框的显示状态 */
    private toggleSource() {
        this.sourceVisible = !this.sourceVisible;
        this.sourceWrapEl.toggleClass("is-hidden", !this.sourceVisible);
        this.toggleSourceBtn.toggleClass("is-active", this.sourceVisible);
        if (this.sourceVisible) {
            this.sourceEl.value = this.latexBuffer;
            setTimeout(() => this.sourceEl.focus(), 0);
        }
    }

    /**
     * 把 latexBuffer 同步到 MathLive 字段。
     * - 加载成功：写入 <math-field>
     * - 加载失败：调用旧版 renderPreview() 走 MarkdownRenderer 渲染
     */
    private syncMathFieldFromBuffer() {
        if (!this.mathFieldEl) return;
        if (isMathLiveLoaded() && (this.mathFieldEl as any).tagName?.toLowerCase() === "math-field") {
            // 关键优化：如果新值和 MathLive 当前值一样，跳过写入。
            //   原因：mf.value = ... 会触发 setValue（insertionMode: "replaceAll"），
            //   整段重写 model 会把光标 / selection 重置。哪怕值没变，光标也会跳。
            //   跳过 no-op 写入就能完美避免"buffer 同步导致光标跳走"。
            //   任何"用户刚敲完键盘，buffer 已经被 input 事件同步过"的场景，都会命中这一行。
            try {
                const current = (this.mathFieldEl as any).getValue?.("latex") ?? "";
                if (current === this.latexBuffer) {
                    this.updateStatus();
                    return;
                }
            } catch (_) { /* getValue 失败就当没拿到，按正常流程走 */ }

            // 写之前挂屏蔽标志 —— MathLive 内部会异步派发 input 事件，我们要忽略
            //   （避免 setValue 触发的合成 input 事件再次进入我们的 input handler 引发回环）
            this._suppressInput = true;
            try {
                writeMathField(this.mathFieldEl, this.latexBuffer, () => {
                    this.renderPreview();
                });
            } finally {
                // 50ms 后释放：覆盖 setTimeout(0) 派发 + 微小排程延迟
                setTimeout(() => { this._suppressInput = false; }, 50);
            }
        } else {
            this.renderPreview();
        }
        this.updateStatus();
    }

    private buildToolbar(tb: HTMLElement) {
        const left = tb.createDiv({ cls: "latex-input-toolbar-left" });
        const right = tb.createDiv({ cls: "latex-input-toolbar-right" });

        // 模式切换
        const modeGroup = left.createDiv({ cls: "latex-input-mode-group" });
        const inlineBtn = modeGroup.createEl("button", { text: "行内 $...$", cls: "latex-input-mode-btn" });
        inlineBtn.addEventListener("click", () => {
            this.mode = "inline";
            this.updateModeBtns();
            this.updateStatus();
            // 优先 focus MathLive（切模式后继续在编辑区里敲键盘）
            setTimeout(() => this.focusMathField(), 0);
        });
        const blockBtn = modeGroup.createEl("button", { text: "行间 $$...$$", cls: "latex-input-mode-btn" });
        blockBtn.addEventListener("click", () => {
            this.mode = "block";
            this.updateModeBtns();
            this.updateStatus();
            setTimeout(() => this.focusMathField(), 0);
        });
        (this as any)._inlineBtn = inlineBtn;
        (this as any)._blockBtn = blockBtn;
        this.updateModeBtns();

        // 工具按钮
        const undoBtn = right.createEl("button", { text: "↶ 撤销", cls: "latex-input-tool-btn" });
        undoBtn.title = "撤销当前输入";
        undoBtn.addEventListener("click", () => this.undo());

        const copyBtn = right.createEl("button", { text: "📋 复制", cls: "latex-input-tool-btn" });
        copyBtn.addEventListener("click", () => this.copyOutput());

        // 截图识别按钮
        this.ocrBtn = right.createEl("button", { text: "📷 截图识别", cls: "latex-input-tool-btn latex-input-tool-btn-ocr" });
        this.ocrBtn.title = "读取剪贴板中的截图，识别为 LaTeX（需先在系统层截图）";
        this.ocrBtn.addEventListener("click", () => this.recognizeFromClipboard());
        this.ocrBtn.dataset.defaultText = "📷 截图识别";

        // 从图片文件选择识别
        this.fileOcrBtn = right.createEl("button", { text: "🖼️ 选择图片", cls: "latex-input-tool-btn latex-input-tool-btn-ocr" });
        this.fileOcrBtn.title = "从本地选择一张图片（公式截图、扫描件等），识别为 LaTeX";
        this.fileOcrBtn.addEventListener("click", () => this.recognizeFromFile());
        this.fileOcrBtn.dataset.defaultText = "🖼️ 选择图片";

        const insertBtn = right.createEl("button", { text: "✓ 插入笔记", cls: "latex-input-tool-btn latex-input-tool-btn-primary" });
        insertBtn.addEventListener("click", () => this.insertToEditor());

        const closeBtn = right.createEl("button", { text: "✕", cls: "latex-input-tool-btn latex-input-close-btn" });
        closeBtn.title = "关闭";
        closeBtn.addEventListener("click", () => this.close());
    }

    private updateModeBtns() {
        const inlineBtn = (this as any)._inlineBtn as HTMLButtonElement;
        const blockBtn = (this as any)._blockBtn as HTMLButtonElement;
        if (this.mode === "inline") {
            inlineBtn.addClass("is-active");
            blockBtn.removeClass("is-active");
        } else {
            blockBtn.addClass("is-active");
            inlineBtn.removeClass("is-active");
        }
    }

    /* ----------- tabs + 符号面板 ----------- */
    private renderTabs() {
        this.tabsEl.empty();
        for (const cat of SYMBOL_CATEGORIES) {
            const tab = this.tabsEl.createEl("button", {
                cls: "latex-input-tab" + (cat.key === this.activeCategory ? " is-active" : ""),
            });
            tab.setText(cat.label);
            tab.title = cat.label;
            tab.addEventListener("click", () => {
                this.activeCategory = cat.key;
                this.renderTabs();
                this.renderPanel();
            });
        }
    }

    private renderPanel() {
        this.panelEl.empty();
        const cat = SYMBOL_CATEGORIES.find(c => c.key === this.activeCategory) || SYMBOL_CATEGORIES[0];
        // 矩阵 tab 用大格子（适合缩略图）
        const isMatrix = cat.key === "mat";
        const grid = this.panelEl.createDiv({
            cls: "latex-input-grid" + (isMatrix ? " is-matrix" : ""),
        });
        for (const sym of cat.entries) {
            const btn = grid.createEl("button", {
                cls: "latex-input-sym" + (sym.preview ? " has-preview" : ""),
            });
            if (sym.preview) {
                // 缩略图条目：用 LaTeX 渲染（用 MarkdownRenderer + Obsidian MathJax）
                const previewWrap = btn.createDiv({ cls: "latex-input-sym-preview" });
                // 不 await —— fire-and-forget，UI 不阻塞
                renderMath(sym.preview, previewWrap, true, this.app);
            } else {
                btn.textContent = sym.display;
            }
            btn.title = sym.title ?? sym.insert;
            btn.addEventListener("click", () => this.insertSymbol(sym.insert));
        }
    }

    private renderHistory() {
        this.historyEl.empty();
        const items = this.history.list();
        if (items.length === 0) {
            this.historyEl.createDiv({ cls: "latex-input-history-empty", text: "（暂无记录）" });
            return;
        }
        for (const it of items) {
            const row = this.historyEl.createDiv({ cls: "latex-input-history-item" });
            row.addClass(it.block ? "is-block" : "is-inline");

            const preview = row.createDiv({ cls: "latex-input-history-preview" });
            // 用 Obsidian 内置渲染器（与笔记渲染一致）
            renderMath(it.src, preview, it.block, this.app);

            const meta = row.createDiv({ cls: "latex-input-history-meta" });
            meta.setText(`${it.block ? "$$…$$" : "$…$"} · ${this.formatTime(it.ts)}`);

            const useBtn = row.createEl("button", { text: "↺ 载入", cls: "latex-input-mini-btn" });
            useBtn.addEventListener("click", () => {
                this.latexBuffer = it.src;
                this.mode = it.block ? "block" : "inline";
                this.updateModeBtns();
                this.updateSource(); // 已经会同步到 MathLive
                // 载入历史后焦点送回 MathLive，方便用户继续微调
                setTimeout(() => this.focusMathField(), 0);
            });
        }
    }

    private formatTime(ts: number): string {
        const d = new Date(ts);
        const pad = (n: number) => n.toString().padStart(2, "0");
        return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /* ----------- 输入动作 ----------- */
    private insertSymbol(raw: string) {
        const { text, cursorOffset } = parseInsert(raw);
        // 优先写到 MathLive（光标位置由 MathLive 内部维护）
        // MathLive 未加载时降级：手动操作 buffer + 源码框
        if (isMathLiveLoaded() && this.mathFieldEl && (this.mathFieldEl as any).tagName?.toLowerCase() === "math-field") {
            // cursorOffset 在 MathLive 中定位：用 executeCommand('moveTo') 需要坐标
            // 简化做法：先 insert 再尝试定位到 {cursor} 占位符
            insertToMathField(this.mathFieldEl, text, () => this.fallbackInsert(text, cursorOffset));
            // 由于 parseInsert 把 {cursor} 标记删掉了，MathLive 里会插入在光标处
            // 注：MathLive 不支持外部 cursorOffset（坐标是它内部的 atom index）
            //       → 占位效果由 MathLive 的 selection 自然提供
        } else {
            this.fallbackInsert(text, cursorOffset);
        }
    }

    /** MathLive 不可用时的源码框降级插入（保持旧行为） */
    private fallbackInsert(text: string, cursorOffset: number) {
        const before = this.latexBuffer.slice(0, this.sourceEl.selectionStart);
        const after = this.latexBuffer.slice(this.sourceEl.selectionEnd);
        this.latexBuffer = before + text + after;
        this.updateSource();
        const newPos = before.length + cursorOffset;
        this.sourceEl.setSelectionRange(newPos, newPos);
        this.sourceEl.focus();
        this.renderPreview();
    }

    private updateSource() {
        this.sourceEl.value = this.latexBuffer;
        // buffer → MathLive（如果已加载）
        this.syncMathFieldFromBuffer();
        this.updateStatus();
    }

    private updateStatus() {
        if (!this.statusEl) return;
        this.statusEl.setText(
            `${this.latexBuffer.length} 字符 · ${this.mode === "inline" ? "行内 $" : "行间 $$"}` +
                (isMathLiveLoaded() ? " · MathLive ✓" : ""),
        );
    }

    private renderPreview() {
        // 兼容旧路径（MathLive 加载失败时 fallbackToPlainPreview 替换为 div）
        if (this.mathFieldEl && (this.mathFieldEl as any).tagName?.toLowerCase() === "math-field") {
            // 正常情况不应该走这里，bootstrapMathField 已接管
            writeMathField(this.mathFieldEl, this.latexBuffer, () => {});
            return;
        }
        // Fallback：旧 div 渲染
        if (this.mathFieldEl) {
            renderMath(this.latexBuffer, this.mathFieldEl, this.mode === "block", this.app);
        }
    }

    /**
     * 判断内容是否需要行间模式（$$...$$）
     *   多行结构（矩阵、cases、aligned 等）在 Obsidian 的行内 $...$ 模式里渲染不出来
     *   强制切到行间才能正常显示
     */
    private isMultilineLatex(src: string): boolean {
        // \begin{...} 是 LaTeX 的环境语法，全部都是多行结构（pmatrix/bmatrix/cases/aligned...）
        return /\\begin\{/.test(src);
    }

    private getWrappedOutput(): string {
        const src = this.cleanLatexForExport(this.latexBuffer).trim();
        if (!src) return "";
        // 严格按用户当前选的模式包裹 —— 不做"多行自动 bump 到行间"
        //   原因：用户希望顶栏高亮和实际输出完全一致，自己掌控
        //   代价：行内模式 + 多行结构（矩阵/cases/aligned）在笔记里会渲染失败
        //   用户自己负责：要用矩阵就切到行间
        const useBlock = this.mode === "block";
        return useBlock ? `$$${src}$$` : `$${src}$`;
    }

    /**
     * 把 MathLive 专属的 \placeholder{} 命令从 LaTeX 中剥掉。
     *   背景：矩阵/cases/aligned 模板用 \placeholder{} 当占位符（让用户点击后键入能直接替换），
     *   但 \placeholder 是 MathLive 专属命令，MathJax 不认。
     *   用户没填的 cell 会留下 \placeholder{}，复制到笔记里就渲染报错。
     *   所以在导出时把 \placeholder{} 转成空字符串（cell 留空，矩阵结构仍然存在）。
     *
     *   注意：\placeholder{} 被剥掉后，cell 之间的 & 仍然在，所以矩阵行/列结构保持不变。
     *   比如 `a & \placeholder{} & c` → `a &  & c`（LaTeX 里这就是 a、空、c 三列），MathJax 正常。
     *   不要去合并 `&&` —— 在 LaTeX 里 `&&` 是合法的"空 cell"语法（不是误输入），
     *   合并会破坏矩阵结构。
     */
    private cleanLatexForExport(latex: string): string {
        if (!latex) return latex;
        // \placeholder{} 或 \placeholder{ } （允许花括号内是空白），整段删掉
        // 不要太宽松：比如 \placeholder{abc} 里的 abc 是用户真实内容，不能动
        return latex.replace(/\\placeholder\{\s*\}/g, "");
    }

    private async copyOutput() {
        const out = this.getWrappedOutput();
        if (!out) return;
        try {
            await navigator.clipboard.writeText(out);
            this.flashStatus("已复制到剪贴板 ✓");
        } catch (_) {
            // 退化方案
            this.sourceEl.value = out;
            this.sourceEl.select();
            document.execCommand("copy");
            this.sourceEl.value = this.latexBuffer;
            this.flashStatus("已复制（fallback）");
        }
    }

    private insertToEditor() {
        const out = this.getWrappedOutput();
        if (!out) {
            this.flashStatus("内容为空");
            return;
        }
        // 写入历史（用真实包裹方式，不是用户当前的 mode）
        const usedBlock = out.startsWith("$$") && out.endsWith("$$") && !out.startsWith("$$$");
        this.history.add({
            full: out,
            src: this.latexBuffer.trim(),
            block: usedBlock,
            ts: Date.now(),
        });
        // 插入到笔记
        this.editor.replaceSelection(out);
        this.renderHistory();
        // 输出格式完全按顶栏模式：选了行内就 $...$，选了行间就 $$...$$
        // 如果用户在行内模式插了多行结构（矩阵/cases/aligned），笔记渲染会失败 —— 用户自己负责
        this.flashStatus("已插入 ✓");
        // 不关闭面板，方便连续输入；用户可手动按 Esc 关闭
    }

    /**
     * 模态框内的截图识别：读剪贴板 → 调当前引擎 → 填入源码框
     */
    private async recognizeFromClipboard() {
        this.flashStatus("正在读取剪贴板…");
        const blob = await readImageFromClipboard();
        if (!blob) {
            this.flashStatus("剪贴板里没有图片");
            new Notice("剪贴板里没有图片。请先用系统截图工具（Win+Shift+S / Cmd+Shift+4）截图。", 6000);
            return;
        }
        await this.runOcr(blob, this.ocrBtn);
    }

    /**
     * 模态框内"选择图片"识别：弹原生文件选择器 → 选中后走同一个 OCR 流程
     *   用隐藏 <input type="file" accept="image/*"> 触发，Electron 会显示原生系统对话框
     *   用户取消时 input 会触发 cancel 事件，主动移除 input
     */
    private recognizeFromFile() {
        // 防止连点：上一个 dialog 还没关就点第二次
        if ((this.fileOcrBtn as any)._pickerOpen) return;
        (this.fileOcrBtn as any)._pickerOpen = true;

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*"; // png/jpg/jpeg/webp/bmp/gif
        input.setCssStyles({
            position: "fixed",
            top: "0",
            left: "0",
            opacity: "0",
            pointerEvents: "none",
            width: "1px",
            height: "1px",
        });

        const cleanup = () => {
            (this.fileOcrBtn as any)._pickerOpen = false;
            if (input.parentNode) input.parentNode.removeChild(input);
        };

        // 选中文件
        input.addEventListener("change", async () => {
            const file = input.files && input.files[0];
            cleanup();
            if (!file) {
                this.flashStatus("未选择图片");
                return;
            }
            // File 继承自 Blob，直接复用 OCR 流程
            await this.runOcr(file, this.fileOcrBtn);
        });

        // 某些平台（Firefox）支持 cancel 事件；Chromium / Electron 中用户关闭对话框不会触发 change
        // 用 window focus 兜底：dialog 关闭后窗口重新获得焦点
        const onFocusBack = () => {
            setTimeout(() => {
                // 如果 change 没触发且 input 还在 DOM 里，说明用户取消了
                if (input.parentNode && (!input.files || input.files.length === 0)) {
                    cleanup();
                }
                window.removeEventListener("focus", onFocusBack);
            }, 300);
        };
        window.addEventListener("focus", onFocusBack);

        document.body.appendChild(input);
        input.click();
    }

    /**
     * OCR 核心流程（公共）：前置检查 → loading 态 → 调引擎 → 填入源码框 → 状态/错误
     *   不知道也不关心 blob 是从剪贴板来还是文件来，统一从这里走
     *   @param blob   图片 Blob（File 也行，File extends Blob）
     *   @param ocrBtn 用于显示 loading 态的按钮引用（恢复时用其 dataset.defaultText）
     */
    private async runOcr(blob: Blob, ocrBtn: HTMLButtonElement) {
        // 1) 前置检查：API key 是否已配好（baseUrl 有默认值，model 有默认值，不强制检查）
        if (!this.settings.customApiKey || !this.settings.customApiKey.trim()) {
            this.flashStatus("请先在「设置 → LaTeX Input」中配置 API Key");
            new Notice("未配置 API Key。打开「设置 → LaTeX Input」填入 API Key 即可使用 OCR。", 8000);
            return;
        }

        // 2) 进入 loading 态
        ocrBtn.disabled = true;
        const originalText = ocrBtn.textContent;
        ocrBtn.textContent = "⏳ 识别中…";

        try {
            this.flashStatus("正在调用 AI 识别…");
            const result = await recognizeFormula(blob, this.settings);
            // 填入 MathLive（不直接插入笔记，让用户预览后再决定）
            this.latexBuffer = result.latex;
            this.updateSource();
            // 优先 focus 到 MathLive（用封装好的 focusMathField，回退到源码框）
            setTimeout(() => this.focusMathField(), 0);
            const conf = result.confidence !== undefined
                ? `（置信度 ${(result.confidence * 100).toFixed(1)}%）`
                : "";
            this.flashStatus(`已识别 ${conf} ✓，可继续编辑或点「插入笔记」`);
        } catch (e: any) {
            console.error("[LaTeX Input] OCR failed", e);
            this.flashStatus(`识别失败：${e?.message || e}`);
            new Notice(`识别失败：${e?.message || e}`, 10000);
        } finally {
            ocrBtn.disabled = false;
            ocrBtn.textContent = originalText || ocrBtn.dataset.defaultText || "OCR";
        }
    }

    private undo() {
        // 简单撤销：清空当前 buffer
        this.latexBuffer = "";
        this.updateSource();
    }

    private handlePaste(e: ClipboardEvent) {
        // 允许外部 LaTeX 直接粘贴到源码框：自动剥离 $...$ / $$...$$
        const ta = this.sourceEl;
        if (document.activeElement !== ta) return;
        const text = e.clipboardData?.getData("text") || "";
        if (!text) return;
        e.preventDefault();
        let cleaned = text;
        const m = text.match(/^\$+\s*([\s\S]*?)\s*\$+$/);
        if (m) cleaned = m[1];
        const before = this.latexBuffer.slice(0, ta.selectionStart);
        const after = this.latexBuffer.slice(ta.selectionEnd);
        this.latexBuffer = before + cleaned + after;
        this.updateSource();
        const np = before.length + cleaned.length;
        ta.setSelectionRange(np, np);
    }

    private handleSourceKeydown(e: KeyboardEvent) {
        if (e.key === "Tab") {
            // Tab 在源码框中插入 4 空格
            e.preventDefault();
            const ta = e.target as HTMLTextAreaElement;
            const before = this.latexBuffer.slice(0, ta.selectionStart);
            const after = this.latexBuffer.slice(ta.selectionEnd);
            this.latexBuffer = before + "    " + after;
            this.updateSource();
            const np = before.length + 4;
            ta.setSelectionRange(np, np);
        } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            this.insertToEditor();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
            e.preventDefault();
            this.mode = "inline";
            this.updateModeBtns();
            this.updateStatus();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            // 留空避免和 markdown bold 冲突
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
            e.preventDefault();
            this.mode = "block";
            this.updateModeBtns();
            this.updateStatus();
        }
    }

    private bindGlobalKeys() {
        document.addEventListener("paste", this.pasteHandler);
    }

    private flashStatus(msg: string) {
        const orig = this.statusEl.textContent;
        this.statusEl.setText(msg);
        this.statusEl.addClass("is-flash");
        setTimeout(() => {
            this.statusEl.removeClass("is-flash");
            this.statusEl.setText(orig || "");
        }, 1200);
    }
}


/* ===================================================================
 * 截图 + OCR 一体化会话
 *   流程：按快捷键 → 申请屏幕共享权限 → 弹全屏遮罩 → 鼠标拖拽选区 →
 *        释放后自动截屏 → OCR → 插入笔记
 *
 *   用 getDisplayMedia API（标准 Web API，无需外部库）
 *   第一次会弹系统授权窗口，授权一次后不再询问
 * =================================================================== */
class ScreenshotOcrSession {
    private containerEl: HTMLElement;
    private overlayEl: HTMLElement;
    private selectionEl: HTMLElement;
    private hintEl: HTMLElement;
    private displayStream: MediaStream | null = null;
    private isDragging = false;
    private startX = 0;
    private startY = 0;
    private destroyed = false;

    // 鼠标事件 handler 引用（用于清理）
    private hMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
    private hMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
    private hKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    private hStreamEnded = () => {
        new Notice("屏幕共享已结束", 3000);
        this.destroy();
    };

    constructor(
        private app: App,
        private settings: LaTeXInputSettings,
        private history: HistoryStore,
        private editor: Editor,
        private block: boolean = false,
    ) {
        // 直接挂在 workspace 容器上，z-index 最高
        this.containerEl = this.app.workspace.containerEl.createDiv({ cls: "latex-input-capture-container" });
        this.overlayEl = this.containerEl.createDiv({ cls: "latex-input-capture-overlay" });
        this.hintEl = this.overlayEl.createDiv({ cls: "latex-input-capture-hint" });
        this.hintEl.createSpan({ text: "✂️ 拖拽鼠标选择公式区域", cls: "latex-input-capture-hint-main" });
        this.hintEl.createSpan({ text: "ESC 取消 · Ctrl+Enter 确认", cls: "latex-input-capture-hint-sub" });
        this.selectionEl = this.overlayEl.createDiv({ cls: "latex-input-capture-selection" });
    }

    /** 启动：申请屏幕权限 */
    async start(): Promise<void> {
        // 检查 API 是否可用
        if (!navigator.mediaDevices?.getDisplayMedia) {
            new Notice(
                "📷 当前 Obsidian 版本不支持屏幕截图 API。\n" +
                "自动切到「剪贴板轮询」模式：等截图出现就自动识别。",
                10000,
            );
            this.destroy();
            new QuickOcrSession(this.app, this.settings, this.history, this.editor, this.block).start();
            return;
        }

        // 显示加载提示
        const loadingEl = this.overlayEl.createDiv({ cls: "latex-input-capture-loading" });
        loadingEl.setText("📺 正在申请屏幕共享权限…");

        try {
            this.displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    // @ts-ignore - cursor 选项
                    cursor: "never",
                } as MediaTrackConstraints,
                audio: false,
            });
        } catch (e: any) {
            loadingEl.remove();
            const errName = e?.name || "";

            // 关键：NotSupportedError 时自动降级到剪贴板轮询
            if (errName === "NotSupportedError") {
                console.warn("[LaTeX Input] getDisplayMedia NotSupportedError, fallback to clipboard polling");
                this.destroy();
                new QuickOcrSession(this.app, this.settings, this.history, this.editor, this.block).start();
                return;
            }

            // 其他错误：显示详细信息
            let detail = "";
            let hint = "";
            if (errName === "NotAllowedError") {
                detail = "屏幕共享被拒绝（需要在系统弹窗里点「允许」）";
                hint = "重新按快捷键重试，弹窗出现时点「允许」";
            } else if (errName === "NotFoundError") {
                detail = "没找到可用的屏幕或窗口";
                hint = "确认显示器已连接";
            } else if (errName === "NotReadableError") {
                detail = "屏幕源被其他程序独占（视频会议、录屏软件）";
                hint = "关闭其他程序后重试";
            } else if (errName === "AbortError") {
                detail = "屏幕共享被中止";
                hint = "重新按快捷键";
            } else if (errName === "SecurityError") {
                detail = "安全策略阻止";
                hint = "如果是浏览器版 Obsidian，需要 HTTPS";
            } else {
                detail = `未知错误：${e?.message || e || errName}`;
                hint = "看控制台（Ctrl+Shift+I）获取详细错误";
            }
            console.error("[LaTeX Input] getDisplayMedia failed:", e);
            new Notice(
                `📷 截图启动失败：${detail}\n\n${hint}\n\n` +
                `【兜底】正在自动切到「剪贴板轮询」模式…`,
                10000,
            );
            this.destroy();
            // 也尝试 fallback
            try {
                new QuickOcrSession(this.app, this.settings, this.history, this.editor, this.block).start();
            } catch (_) {
                new Notice("剪贴板轮询模式也启动失败，请用 Ctrl+Shift+R + Win+Shift+S 两步流程", 8000);
            }
            return;
        }

        loadingEl.remove();

        // 用户中途停止共享
        const videoTrack = this.displayStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.addEventListener("ended", this.hStreamEnded);

        // 绑定事件
        this.overlayEl.addEventListener("mousedown", (e) => this.handleMouseDown(e));
        window.addEventListener("mousemove", this.hMouseMove);
        window.addEventListener("mouseup", this.hMouseUp);
        window.addEventListener("keydown", this.hKeyDown);
    }

    /* --------------- 鼠标 / 键盘事件 --------------- */
    private handleMouseDown = (e: MouseEvent) => {
        // 只响应左键
        if (e.button !== 0) return;
        e.preventDefault();
        this.isDragging = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        Object.assign(this.selectionEl.style, {
            left: `${this.startX}px`,
            top: `${this.startY}px`,
            width: "0px",
            height: "0px",
        });
        this.selectionEl.classList.add("is-active");
        this.hintEl.classList.add("is-hidden");
    };

    private handleMouseMove = (e: MouseEvent) => {
        if (!this.isDragging) return;
        const x = Math.min(this.startX, e.clientX);
        const y = Math.min(this.startY, e.clientY);
        const w = Math.abs(e.clientX - this.startX);
        const h = Math.abs(e.clientY - this.startY);
        Object.assign(this.selectionEl.style, {
            left: `${x}px`,
            top: `${y}px`,
            width: `${w}px`,
            height: `${h}px`,
        });
    };

    private handleMouseUp = async (e: MouseEvent) => {
        if (!this.isDragging) return;
        this.isDragging = false;
        const x = Math.min(this.startX, e.clientX);
        const y = Math.min(this.startY, e.clientY);
        const w = Math.abs(e.clientX - this.startX);
        const h = Math.abs(e.clientY - this.startY);

        if (w < 10 || h < 10) {
            // 选区太小，当作取消
            this.destroy();
            return;
        }

        // Ctrl+Enter 不在此路径触发，先不实现
        // 关闭遮罩
        this.destroyUI();

        // 截屏
        new Notice("✂️ 正在截取屏幕…", 2000);
        try {
            const blob = await this.captureRegion(x, y, w, h);
            if (!blob) {
                new Notice("截图失败", 5000);
                return;
            }
            // OCR
            new Notice("🔍 正在识别公式…", 2000);
            const result = await recognizeFormula(blob, this.settings);
            const wrapped = this.block ? `$$${result.latex}$$` : `$${result.latex}$`;
            this.editor.replaceSelection(wrapped);
            // 写入历史
            this.history.add({
                full: wrapped,
                src: result.latex,
                block: this.block,
                ts: Date.now(),
            });
            const conf = result.confidence !== undefined
                ? `（置信度 ${(result.confidence * 100).toFixed(1)}%）`
                : "";
            const preview = result.latex.length > 60
                ? result.latex.slice(0, 60) + "…"
                : result.latex;
            const modeLabel = this.block ? "行间 $$" : "行内 $";
            new Notice(`✓ 已识别并插入（${modeLabel}） ${conf}：${preview}`, 8000);
        } catch (e: any) {
            console.error("[LaTeX Input] Screenshot OCR failed", e);
            new Notice(`识别失败：${e?.message || e}`, 10000);
        }
    };

    private handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            this.destroy();
        }
    };

    /* --------------- 截屏：getDisplayMedia → video → canvas → 裁剪 --------------- */
    private async captureRegion(x: number, y: number, w: number, h: number): Promise<Blob | null> {
        if (!this.displayStream) return null;

        // 创建 video 元素捕获一帧
        const video = document.createElement("video");
        video.srcObject = this.displayStream;
        video.muted = true;
        video.playsInline = true;
        try {
            await video.play();
        } catch (_) { /* ignore */ }

        // 等到有画面
        await new Promise<void>((resolve) => {
            if (video.readyState >= 2) return resolve();
            video.addEventListener("loadeddata", () => resolve(), { once: true });
            // 兜底：500ms 后强制继续
            setTimeout(() => resolve(), 500);
        });

        const screenW = video.videoWidth || window.screen.width;
        const screenH = video.videoHeight || window.screen.height;

        // 画到全屏 canvas
        const fullCanvas = document.createElement("canvas");
        fullCanvas.width = screenW;
        fullCanvas.height = screenH;
        const fullCtx = fullCanvas.getContext("2d");
        if (!fullCtx) return null;
        fullCtx.drawImage(video, 0, 0, screenW, screenH);

        // 停止视频流（节省资源）
        video.pause();
        video.srcObject = null;

        // 选区坐标（视口坐标）→ 屏幕坐标
        // 处理 DPI 缩放 + 多显示器（简单处理：假设选区在主显示器内）
        const scaleX = screenW / window.innerWidth;
        const scaleY = screenH / window.innerHeight;
        const sx = Math.max(0, Math.round(x * scaleX));
        const sy = Math.max(0, Math.round(y * scaleY));
        const sw = Math.min(screenW - sx, Math.round(w * scaleX));
        const sh = Math.min(screenH - sy, Math.round(h * scaleY));
        if (sw <= 0 || sh <= 0) return null;

        // 裁剪
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = sw;
        cropCanvas.height = sh;
        const cropCtx = cropCanvas.getContext("2d");
        if (!cropCtx) return null;
        cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

        return new Promise<Blob | null>((resolve) => {
            cropCanvas.toBlob((b) => resolve(b), "image/png");
        });
    }

    /* --------------- 清理 --------------- */
    private destroyUI() {
        window.removeEventListener("mousemove", this.hMouseMove);
        window.removeEventListener("mouseup", this.hMouseUp);
        window.removeEventListener("keydown", this.hKeyDown);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.destroyUI();
        if (this.displayStream) {
            this.displayStream.getTracks().forEach((t) => t.stop());
            this.displayStream = null;
        }
        this.containerEl.remove();
    }
}

/* ===================================================================
 * 剪贴板轮询 OCR —— getDisplayMedia 不可用时的 fallback
 *   流程：右下角小浮窗 + 轮询剪贴板（每 300ms）→ 检测到新图片就 OCR → 插入
 *   不挡屏幕中央的内容，可以拖动到任意位置
 *
 *   比纯两步流程（Win+Shift+S → Ctrl+Shift+R）好：不用记第二个快捷键
 * =================================================================== */
class QuickOcrSession {
    private containerEl: HTMLElement | null = null;
    private panelEl: HTMLElement | null = null;
    private hintEl: HTMLElement | null = null;
    private pollTimer: any = null;
    private lastImageHash: string = "";
    private isActive = false;
    private hintVisible = false;

    // 拖动相关
    private isDragging = false;
    private dragOffsetX = 0;
    private dragOffsetY = 0;

    // 事件 handler 引用
    private hMouseMove = (e: MouseEvent) => this.onDragMove(e);
    private hMouseUp = () => this.onDragEnd();
    private hKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") this.stop();
    };

    constructor(
        private app: App,
        private settings: LaTeXInputSettings,
        private history: HistoryStore,
        private editor: Editor,
        private block: boolean = false,
    ) {}

    async start() {
        if (this.isActive) return;
        this.isActive = true;

        // 先记下当前剪贴板图片的 hash（用来判断"新"图片）
        try {
            this.lastImageHash = await this.getClipboardImageHash();
        } catch (_) {
            this.lastImageHash = "";
        }

        this.renderPanel();
        this.startPolling();
    }

    /* --------------- 剪贴板读取 --------------- */
    private async getClipboardImageHash(): Promise<string> {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                for (const type of item.types) {
                    if (type.startsWith("image/")) {
                        const blob = await item.getType(type);
                        return await this.hashBlob(blob);
                    }
                }
            }
        } catch (_) { /* 无权限或无图片 */ }
        return "";
    }

    private async hashBlob(blob: Blob): Promise<string> {
        try {
            const buf = await blob.arrayBuffer();
            const hash = await crypto.subtle.digest("SHA-256", buf);
            return Array.from(new Uint8Array(hash))
                .map(b => b.toString(16).padStart(2, "0"))
                .join("")
                .slice(0, 64);
        } catch (_) {
            return `${blob.size}-${blob.type}-${Date.now()}`;
        }
    }

    /* --------------- 浮窗 UI --------------- */
    private renderPanel() {
        // 容器：右下角小浮窗
        this.containerEl = this.app.workspace.containerEl.createDiv({
            cls: "latex-input-quick-ocr-container",
        });
        this.panelEl = this.containerEl.createDiv({ cls: "latex-input-quick-ocr-panel" });

        // 头部
        const header = this.panelEl.createDiv({ cls: "latex-input-quick-ocr-header" });
        const dragHandle = header.createDiv({ cls: "latex-input-quick-ocr-drag" });
        dragHandle.createSpan({ text: "📸", cls: "latex-input-quick-ocr-icon" });
        dragHandle.createSpan({ text: "等待截图", cls: "latex-input-quick-ocr-status" });

        const helpBtn = header.createEl("button", {
            text: "?",
            cls: "latex-input-quick-ocr-btn",
            attr: { title: "显示说明" },
        });
        helpBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleHint();
        });

        const cancelBtn = header.createEl("button", {
            text: "✕",
            cls: "latex-input-quick-ocr-btn latex-input-quick-ocr-cancel",
            attr: { title: "取消（ESC）" },
        });
        cancelBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.stop();
        });

        // 提示（默认折叠）
        this.hintEl = this.panelEl.createDiv({
            cls: "latex-input-quick-ocr-hint",
            text: "用任意方式截图（Win+Shift+S / Snipaste）\n检测到新图片后自动识别并插入",
        });
        this.hintEl.setCssStyles({ display: "none" });

        // 拖动支持
        dragHandle.addEventListener("mousedown", (e) => this.onDragStart(e));

        // 键盘
        window.addEventListener("keydown", this.hKeyDown);
    }

    private toggleHint() {
        this.hintVisible = !this.hintVisible;
        if (this.hintEl) {
            this.hintEl.setCssStyles({ display: this.hintVisible ? "block" : "none" });
        }
    }

    /* --------------- 拖动 --------------- */
    private onDragStart = (e: MouseEvent) => {
        if (!this.panelEl) return;
        // 按钮上不触发拖动
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        this.isDragging = true;
        const rect = this.panelEl.getBoundingClientRect();
        this.dragOffsetX = e.clientX - rect.left;
        this.dragOffsetY = e.clientY - rect.top;
        this.panelEl.classList.add("is-dragging");
        window.addEventListener("mousemove", this.hMouseMove);
        window.addEventListener("mouseup", this.hMouseUp);
        e.preventDefault();
    };

    private onDragMove = (e: MouseEvent) => {
        if (!this.isDragging || !this.panelEl) return;
        const x = Math.max(0, Math.min(window.innerWidth - 50, e.clientX - this.dragOffsetX));
        const y = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - this.dragOffsetY));
        this.panelEl.setCssStyles({
            left: `${x}px`,
            top: `${y}px`,
            right: "auto",
            bottom: "auto",
        });
    };

    private onDragEnd = () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        if (this.panelEl) this.panelEl.classList.remove("is-dragging");
        window.removeEventListener("mousemove", this.hMouseMove);
        window.removeEventListener("mouseup", this.hMouseUp);
    };

    /* --------------- 轮询剪贴板 --------------- */
    private startPolling() {
        this.pollTimer = setInterval(async () => {
            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    for (const type of item.types) {
                        if (type.startsWith("image/")) {
                            const blob = await item.getType(type);
                            const hash = await this.hashBlob(blob);
                            if (hash && hash !== this.lastImageHash) {
                                this.stop();
                                await this.recognize(blob);
                                return;
                            }
                        }
                    }
                }
            } catch (_) {
                // 忽略错误继续轮询
            }
        }, 300);
    }

    /* --------------- OCR + 插入 --------------- */
    private async recognize(blob: Blob) {
        new Notice("🔍 正在识别…", 2000);
        try {
            const result = await recognizeFormula(blob, this.settings);
            const wrapped = this.block ? `$$${result.latex}$$` : `$${result.latex}$`;
            this.editor.replaceSelection(wrapped);
            this.history.add({
                full: wrapped,
                src: result.latex,
                block: this.block,
                ts: Date.now(),
            });
            const preview = result.latex.length > 60
                ? result.latex.slice(0, 60) + "…"
                : result.latex;
            const modeLabel = this.block ? "行间 $$" : "行内 $";
            new Notice(`✓ 已识别并插入（${modeLabel}）：${preview}`, 6000);
        } catch (e: any) {
            console.error("[LaTeX Input] Quick OCR failed", e);
            new Notice(`识别失败：${e?.message || e}`, 10000);
        }
    }

    /* --------------- 清理 --------------- */
    private stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.isActive = false;
        window.removeEventListener("mousemove", this.hMouseMove);
        window.removeEventListener("mouseup", this.hMouseUp);
        window.removeEventListener("keydown", this.hKeyDown);
        if (this.containerEl) {
            this.containerEl.remove();
            this.containerEl = null;
            this.panelEl = null;
            this.hintEl = null;
        }
    }
}

/* ===================================================================
 * 插件主类
 * =================================================================== */
export default class LaTeXInputPlugin extends Plugin {
    private history = new HistoryStore();
    private latexSettings: LaTeXInputSettings = DEFAULT_SETTINGS;

    async onload() {
        await this.loadSettings();

        // 行内公式
        this.addCommand({
            id: "latex-input-inline",
            name: "插入 LaTeX 公式（行内 $...$）",
            hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "l" }],
            editorCallback: (editor, _view) => this.openModal(editor, "inline"),
        });

        // 行间公式
        this.addCommand({
            id: "latex-input-block",
            name: "插入 LaTeX 公式（行间 $$...$$）",
            hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "m" }],
            editorCallback: (editor, _view) => this.openModal(editor, "block"),
        });

        // 截图识别公式：拖拽选区 → 自动 OCR → 插入（行内，推荐）
        // 一次快捷键完成"截图 + 识别 + 插入"全流程，包成 $...$
        this.addCommand({
            id: "latex-input-screenshot-ocr",
            name: "📷 截图识别公式（拖拽选区，行内 $...$）",
            hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "s" }],
            editorCallback: (editor, _view) => this.startScreenshotOcr(editor, false),
        });

        // 截图识别公式：行间版本（包成 $$...$$）
        this.addCommand({
            id: "latex-input-screenshot-ocr-block",
            name: "📷 截图识别公式（拖拽选区，行间 $$...$$）",
            hotkeys: [{ modifiers: ["Alt", "Shift"], key: "s" }],
            editorCallback: (editor, _view) => this.startScreenshotOcr(editor, true),
        });

        // 截图识别公式（备选：从剪贴板读图，行内）
        this.addCommand({
            id: "latex-input-recognize-clipboard",
            name: "📋 截图识别公式（从剪贴板，行内 $...$）",
            hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "r" }],
            editorCallback: (editor, _view) => this.recognizeFromClipboard(editor, true, false),
        });

        // 截图识别公式（备选：从剪贴板读图，行间）
        this.addCommand({
            id: "latex-input-recognize-clipboard-block",
            name: "📋 截图识别公式（从剪贴板，行间 $$...$$）",
            hotkeys: [{ modifiers: ["Alt", "Shift"], key: "r" }],
            editorCallback: (editor, _view) => this.recognizeFromClipboard(editor, true, true),
        });

        // Ribbon 图标
        this.addRibbonIcon("sigma", "LaTeX 公式输入", () => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            const editor = view?.editor;
            if (editor) this.openModal(editor, "inline");
        });

        // Ribbon 截图图标（拖拽选区，行内）
        this.addRibbonIcon("image-file", "📷 截图识别公式（拖拽选区，行内）", () => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            const editor = view?.editor;
            if (editor) this.startScreenshotOcr(editor, false);
        });

        // 设置页
        this.addSettingTab(new LaTeXInputSettingTab(this.app, this));
    }

    async loadSettings() {
        const loaded: any = await this.loadData();
        // 迁移：v1.0/v1.1 的 ocrEngine / minimaxApiKey
        //   → v1.2 的 customApiKey / customBaseUrl / customModel
        //   触发条件：loaded 里有任意旧字段
        if (loaded && typeof loaded === "object") {
            const hasLegacy =
                "minimaxApiKey" in loaded ||
                "simpleTexToken" in loaded ||
                (loaded.ocrEngine && loaded.ocrEngine !== "custom");
            if (hasLegacy) {
                // 1) ocrEngine 归并为 custom
                loaded.ocrEngine = "custom";
                // 2) 旧 MiniMax API key + model → custom（仅在 custom 为空时迁移，避免覆盖用户已填的新值）
                if (loaded.minimaxApiKey && !loaded.customApiKey) {
                    loaded.customApiKey = loaded.minimaxApiKey;
                }
                if (loaded.minimaxModel && (!loaded.customModel || loaded.customModel === DEFAULT_SETTINGS.customModel)) {
                    loaded.customModel = loaded.minimaxModel;
                }
                // 3) 旧字段清掉
                delete loaded.minimaxApiKey;
                delete loaded.minimaxModel;
                delete loaded.simpleTexToken;
                // 4) 立即回写一次，避免下次启动又走迁移分支
                await this.saveData(loaded);
            }
        }
        this.latexSettings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    }

    async saveSettings() {
        await this.saveData(this.latexSettings);
    }

    getSettings(): LaTeXInputSettings {
        return this.latexSettings;
    }

    private openModal(editor: Editor, mode: Mode) {
        // 如果有选中文本，把它当作初始 LaTeX 源码
        let initial: string | undefined = undefined;
        const sel = editor.getSelection();
        if (sel) {
            // 自动剥除外层 $...$ / $$...$$
            const m = sel.match(/^\$+\s*([\s\S]*?)\s*\$+$/);
            initial = m ? m[1] : sel;
        }
        const modal = new LaTeXInputModal(this.app, editor, this.history, this.latexSettings, initial, mode);
        modal.open();
    }

    /**
     * 启动截图 + OCR 一体化会话
     *   一个快捷键完成"选区截图 → OCR → 插入"全程
     *   第一次会请求屏幕共享权限，授权后用起来很顺
     *   @param block true=行间 $$...$$  false=行内 $...$
     */
    private async startScreenshotOcr(editor: Editor, block: boolean = false) {
        const session = new ScreenshotOcrSession(this.app, this.latexSettings, this.history, editor, block);
        await session.start();
    }

    /**
     * 从剪贴板读截图，调用当前引擎识别，识别结果插入到当前笔记。
     * @param openPanelIfFail 识别失败时是否打开主面板（true 适合快捷键场景）
     * @param block true=行间 $$...$$  false=行内 $...$
     */
    private async recognizeFromClipboard(editor: Editor, openPanelIfFail: boolean, block: boolean = false) {
        // 前置检查：API Key
        if (!this.latexSettings.customApiKey || !this.latexSettings.customApiKey.trim()) {
            new Notice("未配置 API Key。打开「设置 → LaTeX Input」填入后重试。", 8000);
            if (openPanelIfFail) this.openModal(editor, block ? "block" : "inline");
            return;
        }
        try {
            const blob = await readImageFromClipboard();
            if (!blob) {
                new Notice("剪贴板里没有图片。请先用系统截图工具（Win+Shift+S / Cmd+Shift+4）截图。", 6000);
                return;
            }
            new Notice("正在用 AI 识别公式…", 3000);
            const result = await recognizeFormula(blob, this.latexSettings);
            const wrapped = block ? `$$${result.latex}$$` : `$${result.latex}$`;
            editor.replaceSelection(wrapped);
            this.history.add({
                full: wrapped,
                src: result.latex,
                block,
                ts: Date.now(),
            });
            const conf = result.confidence !== undefined ? `（置信度 ${(result.confidence * 100).toFixed(1)}%）` : "";
            const modeLabel = block ? "行间 $$" : "行内 $";
            new Notice(`已识别并插入（${modeLabel}） ${conf}：${result.latex.slice(0, 60)}${result.latex.length > 60 ? "…" : ""}`, 8000);
        } catch (e: any) {
            console.error("[LaTeX Input] OCR failed", e);
            new Notice(`识别失败：${e?.message || e}`, 10000);
            if (openPanelIfFail) {
                // 打开主面板让用户手动输入
                this.openModal(editor, block ? "block" : "inline");
            }
        }
    }

    onunload() { /* nothing */ }
}

/* ===================================================================
 * 设置页 — 重组版
 *   结构：📌 基础 / 📸 截图识别 / ⚙️ 高级 / ℹ️ 关于
 *   改进：
 *     - 动态显示当前引擎的配置（其它引擎折叠）
 *     - 每个引擎有「测试连接」+「清空凭据」+ 状态徽章
 *     - 密码字段带「显示/隐藏」切换
 *     - 「怎么用」改为可折叠 info box，不再用 heading 误导
 * =================================================================== */
class LaTeXInputSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: LaTeXInputPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("latex-input-settings");

        containerEl.createEl("p", {
            text: "AxMath 风格的公式输入面板：点选符号拼 LaTeX，或截图转 LaTeX。",
            cls: "latex-input-settings-intro",
        });

        this.renderHotkeySection(containerEl);
        this.renderOcrSection(containerEl);
        this.renderAdvancedSection(containerEl);
        this.renderAboutSection(containerEl);
    }

    /* ============== 📌 基础 ============== */
    private renderHotkeySection(parent: HTMLElement) {
        const section = parent.createDiv({ cls: "latex-input-section" });
        new Setting(section).setName("📌 基础").setHeading();

        new Setting(section)
            .setName("快捷键")
            .setDesc("默认：Ctrl+Shift+L（行内公式）、Ctrl+Shift+M（行间公式）、Ctrl+Shift+S（截图识别）。如需修改请在 Obsidian「设置 → 快捷键」中搜索「LaTeX Input」重新绑定。")
            .addButton(btn => btn.setButtonText("打开快捷键设置").onClick(() => {
                // @ts-ignore
                this.app.setting.open();
                // @ts-ignore
                this.app.setting.openTabById("hotkeys");
            }));

        new Setting(section)
            .setName("符号面板")
            .setDesc("主面板包含 10 个分类：小写希腊 / 大写希腊 / 基本结构 / 微积分 / 关系 / 集合 / 矩阵 / 箭头 / 运算 / 排版。点击符号把对应 LaTeX 插入到源码框光标位置，可继续手写微调。");
    }

    /* ============== 🤖 AI 识别 ============== */
    private renderOcrSection(parent: HTMLElement) {
        const section = parent.createDiv({ cls: "latex-input-section" });
        new Setting(section).setName("🤖 AI 识别").setHeading();

        // 升级提示横幅（仅当检测到旧字段迁移时显示一次，新启动就消失）
        // 这里用一个 always-shown 的小提示说明默认是 MiniMax
        const banner = section.createDiv({ cls: "latex-input-info-box" });
        banner.createEl("div", {
            text: "💡 默认使用 MiniMax 视觉 API（OpenAI 兼容协议），可改成任意兼容服务",
            cls: "latex-input-info-box-title",
        });
        const ul = banner.createEl("ul");
        ul.createEl("li", { text: "月之暗面 Kimi（视觉版本）：https://api.moonshot.cn/v1" });
        ul.createEl("li", { text: "智谱 GLM-4V：https://open.bigmodel.cn/api/paas/v4" });
        ul.createEl("li", { text: "阿里 Qwen-VL（DashScope OpenAI 兼容端点）：https://dashscope.aliyuncs.com/compatible-mode/v1" });
        ul.createEl("li", { text: "本地 Ollama（需支持视觉的模型，如 llava）：http://localhost:11434/v1" });
        ul.createEl("li", { text: "其他任意 OpenAI 兼容服务：填 Base URL + API Key + 模型名" });

        // 直接渲染唯一的 custom 配置卡
        this.renderCustomCard(section);

        // 底部使用说明
        this.makeInfoBox(section, "💡 截图 / 图片识别用法", [
            "用系统截图工具截图（Win+Shift+S / macOS Cmd+Shift+4 / Snipaste 等）→ 截图进入剪贴板",
            "按 Ctrl+Shift+S，或打开主面板点「📷 截图识别」/「🖼️ 选择图片」，或点左侧栏相机图标",
            "识别结果自动填入输入框（面板内可预览后再插入；快捷键模式直接以 $...$ 插入笔记）",
        ]);
    }

    /* ----------- 单一 custom 配置卡 ----------- */
    private renderCustomCard(parent: HTMLElement) {
        const settings = this.plugin.getSettings();
        const card = parent.createDiv({ cls: "latex-input-engine-card is-current" });

        // Header
        const header = card.createDiv({ cls: "latex-input-engine-card-header" });
        const titleArea = header.createDiv({ cls: "latex-input-engine-card-title" });
        titleArea.createEl("strong", { text: "AI 视觉模型（OpenAI 兼容）" });
        titleArea.createSpan({
            text: "默认 MiniMax · 可改成任意 OpenAI 兼容服务",
            cls: "latex-input-engine-card-sub",
        });
        const badgeArea = header.createDiv({ cls: "latex-input-engine-card-badges" });
        badgeArea.createSpan({ text: "当前使用", cls: "latex-input-badge is-current" });
        const badge = badgeArea.createSpan({
            text: settings.customApiKey.trim() ? "✓ 已配置" : "未配置",
            cls: "latex-input-badge " + (settings.customApiKey.trim() ? "is-ok" : "is-warn"),
        });

        const resultEl = card.createDiv({ cls: "latex-input-test-result" });

        // 1) Base URL
        const baseUrlSetting = new Setting(card)
            .setName("Base URL")
            .setDesc("OpenAI 兼容 API 的根地址，必须以 /v1 结尾。默认是 MiniMax。可改成月之暗面 / 智谱 / Qwen-VL / Ollama 等。");
        const baseUrlInput = baseUrlSetting.controlEl.createEl("input", {
            type: "text",
            cls: "latex-input-url-input",
            attr: { placeholder: "https://api.minimax.chat/v1", spellcheck: "false" },
        });
        baseUrlInput.value = settings.customBaseUrl || DEFAULT_SETTINGS.customBaseUrl;
        baseUrlInput.addEventListener("change", async () => {
            const v = baseUrlInput.value.trim() || DEFAULT_SETTINGS.customBaseUrl;
            settings.customBaseUrl = v;
            baseUrlInput.value = v;
            await this.plugin.saveSettings();
        });

        // 2) API Key
        const keySetting = new Setting(card)
            .setName("API Key")
            .setDesc("对应 Base URL 的服务提供的 API key。MiniMax 注册：https://platform.minimax.io/");
        this.attachPasswordInput(keySetting, settings.customApiKey, "sk-...", async (v) => {
            settings.customApiKey = v;
            await this.plugin.saveSettings();
            this.refreshBadge(badge, !!v.trim());
        });

        // 3) 模型名称
        const modelSetting = new Setting(card)
            .setName("模型名称")
            .setDesc("必须选支持视觉的模型（名字含 vision / VL / multimodal）。如果识别一直失败，先点「列出可用模型」看看，或去对应服务文档查支持图像的模型。");
        const modelInput = modelSetting.controlEl.createEl("input", {
            type: "text",
            cls: "latex-input-url-input",
            attr: { placeholder: "如：MiniMax-...-VL / gpt-4o / claude-3.5-sonnet", spellcheck: "false" },
        });
        modelInput.value = settings.customModel || "";
        modelInput.addEventListener("change", async () => {
            settings.customModel = modelInput.value.trim() || DEFAULT_SETTINGS.customModel;
            await this.plugin.saveSettings();
        });

        // 4) 操作行
        new Setting(card)
            .setName("操作")
            .addButton(btn => btn.setButtonText("✓ 测试连接").onClick(async () => {
                btn.setButtonText("测试中…");
                btn.setDisabled(true);
                const r = await testCustomConnection(settings.customApiKey, settings.customBaseUrl, settings.customModel);
                btn.setButtonText("✓ 测试连接");
                btn.setDisabled(false);
                this.showTestResult(resultEl, r);
            }))
            .addButton(btn => btn.setButtonText("📋 列出可用模型").onClick(async () => {
                btn.setButtonText("查询中…");
                btn.setDisabled(true);
                const r = await listCustomModels(settings.customApiKey, settings.customBaseUrl);
                btn.setButtonText("📋 列出可用模型");
                btn.setDisabled(false);
                this.showTestResult(resultEl, r);
            }))
            .addButton(btn => btn.setButtonText("↺ 恢复默认").onClick(async () => {
                if (confirm("恢复 Base URL + 模型名为默认（MiniMax），API Key 保留？")) {
                    settings.customBaseUrl = DEFAULT_SETTINGS.customBaseUrl;
                    settings.customModel = DEFAULT_SETTINGS.customModel;
                    await this.plugin.saveSettings();
                    this.display();
                }
            }))
            .addButton(btn => btn.setButtonText("🗑 清空凭据").setWarning().onClick(async () => {
                if (confirm("清空 API Key / Base URL / 模型名？")) {
                    settings.customApiKey = "";
                    settings.customBaseUrl = DEFAULT_SETTINGS.customBaseUrl;
                    settings.customModel = DEFAULT_SETTINGS.customModel;
                    await this.plugin.saveSettings();
                    this.display();
                }
            }));

        // 怎么用（折叠 info）
        this.makeCollapsibleInfo(card, "💡 怎么用 MiniMax（默认）", [
            "去 platform.minimax.io 注册账号",
            "顶部「API Keys」创建一个 key（建议设置余额提醒）",
            "充值（按 token 计费，新用户可能有免费额度）",
            "复制 key 粘贴到「API Key」",
            "点「📋 列出可用模型」看账号下有哪些，挑一个支持视觉的填到「模型名称」",
            "点「✓ 测试连接」验证可用",
        ]);
        this.makeCollapsibleInfo(card, "💡 怎么改成其他服务", [
            "把 Base URL 改成目标服务的根地址（带 /v1）",
            "把 API Key 改成该服务的 key",
            "把模型名改成该服务支持视觉的模型 ID",
            "点「✓ 测试连接」验证",
            "⚠️ 必须是 OpenAI Chat Completions 兼容协议 + 支持 image_url 字段",
        ]);
    }

    /* ============== ⚙️ 高级 ============== */
    private renderAdvancedSection(parent: HTMLElement) {
        const section = parent.createDiv({ cls: "latex-input-section" });
        new Setting(section).setName("⚙️ 高级").setHeading();

        new Setting(section)
            .setName("清空全部凭据")
            .setDesc("把 API Key 清空（Base URL 和模型名恢复默认）。下次截图识别前需要重新配置。")
            .addButton(btn => btn.setButtonText("清空全部凭据").setWarning().onClick(async () => {
                if (confirm("确定清空所有凭据？此操作不可撤销。")) {
                    const s = this.plugin.getSettings();
                    s.customApiKey = "";
                    s.customBaseUrl = DEFAULT_SETTINGS.customBaseUrl;
                    s.customModel = DEFAULT_SETTINGS.customModel;
                    await this.plugin.saveSettings();
                    this.display();
                }
            }));

        new Setting(section)
            .setName("清空输入历史")
            .setDesc("清空主面板右侧「历史记录」里的全部条目。")
            .addButton(btn => btn.setButtonText("清空历史").setWarning().onClick(() => {
                if (confirm("清空全部历史记录？")) {
                    try { localStorage.removeItem("latex-input.history.v1"); } catch (_) { /* ignore */ }
                    new Notice("历史已清空 ✓");
                }
            }));
    }

    /* ============== ℹ️ 关于 ============== */
    private renderAboutSection(parent: HTMLElement) {
        const section = parent.createDiv({ cls: "latex-input-section" });
        new Setting(section).setName("ℹ️ 关于").setHeading();

        const card = section.createDiv({ cls: "latex-input-about-card" });
        const top = card.createDiv({ cls: "latex-input-about-row" });
        top.createEl("strong", { text: "LaTeX Input" });
        top.createSpan({ text: "  v0.1.0", cls: "latex-input-about-version" });
        card.createEl("div", {
            text: "AxMath 风格的公式输入面板 + 截图识别",
            cls: "latex-input-about-desc",
        });
        card.createEl("div", {
            text: "作者 Sun · GPL-3.0 协议",
            cls: "latex-input-about-meta",
        });
    }

    /* ============== 通用辅助 ============== */

    /** 在一个 Setting 的右侧 control 区里塞一个密码输入 + 眼睛切换 */
    private attachPasswordInput(setting: Setting, value: string, placeholder: string, onChange: (v: string) => Promise<void>) {
        const wrap = setting.controlEl.createDiv({ cls: "latex-input-pwd-wrap" });
        const input = wrap.createEl("input", {
            type: "password",
            cls: "latex-input-pwd-input",
            attr: { spellcheck: "false", autocomplete: "off" },
        });
        input.placeholder = placeholder;
        input.value = value;

        const eye = wrap.createEl("button", {
            text: "👁",
            cls: "latex-input-eye-btn",
            attr: { type: "button", title: "显示 / 隐藏", "aria-label": "显示 / 隐藏" },
        });
        eye.addEventListener("click", (e) => {
            e.preventDefault();
            if (input.type === "password") {
                input.type = "text";
                eye.textContent = "🙈";
            } else {
                input.type = "password";
                eye.textContent = "👁";
            }
        });

        let saveTimer: any = null;
        const debouncedSave = () => {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => onChange(input.value), 400);
        };
        input.addEventListener("input", debouncedSave);
        input.addEventListener("change", () => {
            if (saveTimer) clearTimeout(saveTimer);
            onChange(input.value);
        });
    }

    /** 在容器里追加一个 URL 输入 Setting（URL 不需要眼睛切换）—— v1.2 起未使用，保留以备将来 */
    private _attachUrlInput_unused(parent: HTMLElement, value: string, placeholder: string, onChange: (v: string) => Promise<void>): void {
        const s = new Setting(parent)
            .setName("URL")
            .setDesc("默认 http://127.0.0.1:8000；改端口时同步修改这里。");
        const input = s.controlEl.createEl("input", {
            type: "text",
            cls: "latex-input-url-input",
            attr: { placeholder, spellcheck: "false" },
        });
        input.value = value;
        let timer: any = null;
        const debouncedSave = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => onChange(input.value), 400);
        };
        input.addEventListener("input", debouncedSave);
        input.addEventListener("change", () => {
            if (timer) clearTimeout(timer);
            onChange(input.value);
        });
    }

    private refreshBadge(badge: HTMLElement, configured: boolean) {
        badge.textContent = configured ? "✓ 已配置" : "未配置";
        badge.removeClass("is-ok", "is-warn");
        badge.addClass(configured ? "is-ok" : "is-warn");
    }

    private showTestResult(el: HTMLElement, r: EngineTestResult) {
        el.empty();
        el.setText(r.msg);
        el.removeClass("is-ok", "is-err");
        el.addClass(r.ok ? "is-ok" : "is-err");
    }

    /** 顶部对齐、醒目的提示框（用于"截图识别用法"等） */
    private makeInfoBox(parent: HTMLElement, title: string, items: string[]) {
        const box = parent.createDiv({ cls: "latex-input-info-box" });
        box.createEl("div", { text: title, cls: "latex-input-info-box-title" });
        const ol = box.createEl("ol");
        for (const it of items) ol.createEl("li", { text: it });
    }

    /** 引擎卡内嵌的折叠 info（用原生 <details>） */
    private makeCollapsibleInfo(parent: HTMLElement, title: string, items: string[]) {
        const det = parent.createEl("details", { cls: "latex-input-details" });
        const sum = det.createEl("summary", { text: title });
        const ol = det.createEl("ol");
        for (const it of items) ol.createEl("li", { text: it });
    }
}
