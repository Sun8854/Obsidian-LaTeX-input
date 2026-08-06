/**
 * LaTeX 符号库
 *
 * 每条记录的字段：
 *   display — 按钮上显示的字符（用于按钮的标题/aria-label）
 *   insert  — 点击后实际插入到编辑器的 LaTeX 字符串
 *   cursor  — 可选，插入后光标要跳到的占位符（用 {cursor} 标记在 insert 里）
 *   katex   — 可选，用作按钮内 KaTeX 渲染的源码（默认就是 insert 去壳后的形式）
 *
 * 分类键（key）会作为面板的 tab 标签。
 */

export interface SymbolEntry {
    display: string;
    insert: string;
    /** 插入后光标停在 insert 字符串中第一次出现 {cursor} 的位置；若没有则停在末尾。 */
    cursor?: boolean;
    /** 鼠标悬停提示（中文优先），不填则用 insert 字符串（对懂 LaTeX 的人够了，对新手不够） */
    title?: string;
    /**
     * 缩略图 LaTeX 源码 —— 用于在符号面板按钮上渲染迷你预览（取代文字 display）。
     * 设置后该条目在面板上以「LaTeX 渲染图」形式显示，点击时仍按 insert 插入真实 LaTeX。
     * 典型应用：矩阵、方程组、对齐环境等结构性条目，缩略图比文字标签直观得多。
     */
    preview?: string;
}

export type SymbolCategory = {
    key: string;
    label: string;
    icon: string;       // 短标签（按钮中显示，2-4 个字符）
    entries: SymbolEntry[];
};

/* ----------------------------------------------------------- *
 * 希腊字母
 *   小写：24 个基本 + 6 个 LaTeX 变体（amssymb）+ 1 个古典 digamma
 *   大写：24 个基本 + 11 个 \var... 系列（amsmath，物理/特殊学科用得多）
 * ----------------------------------------------------------- */
const lowerGreek: SymbolEntry[] = [
    // 基本 24 个
    { display: "α", insert: "\\alpha" },
    { display: "β", insert: "\\beta" },
    { display: "γ", insert: "\\gamma" },
    { display: "δ", insert: "\\delta" },
    { display: "ε", insert: "\\epsilon" },
    { display: "ζ", insert: "\\zeta" },
    { display: "η", insert: "\\eta" },
    { display: "θ", insert: "\\theta" },
    { display: "ι", insert: "\\iota" },
    { display: "κ", insert: "\\kappa" },
    { display: "λ", insert: "\\lambda" },
    { display: "μ", insert: "\\mu" },
    { display: "ν", insert: "\\nu" },
    { display: "ξ", insert: "\\xi" },
    { display: "ο", insert: "o" },
    { display: "π", insert: "\\pi" },
    { display: "ρ", insert: "\\rho" },
    { display: "σ", insert: "\\sigma" },
    { display: "τ", insert: "\\tau" },
    { display: "υ", insert: "\\upsilon" },
    { display: "φ", insert: "\\phi" },
    { display: "χ", insert: "\\chi" },
    { display: "ψ", insert: "\\psi" },
    { display: "ω", insert: "\\omega" },
    // LaTeX 变体（amssymb）
    { display: "ε", insert: "\\varepsilon" },
    { display: "ϑ", insert: "\\vartheta" },
    { display: "ϖ", insert: "\\varpi" },
    { display: "ϱ", insert: "\\varrho" },
    { display: "ς", insert: "\\varsigma" },
    { display: "φ", insert: "\\varphi" },
    // 古典字母（amssymb）
    { display: "ϝ", insert: "\\digamma" },
];

const upperGreek: SymbolEntry[] = [
    // 基本 24 个
    { display: "Α", insert: "\\Alpha" },
    { display: "Β", insert: "\\Beta" },
    { display: "Γ", insert: "\\Gamma" },
    { display: "Δ", insert: "\\Delta" },
    { display: "Ε", insert: "\\Epsilon" },
    { display: "Ζ", insert: "\\Zeta" },
    { display: "Η", insert: "\\Eta" },
    { display: "Θ", insert: "\\Theta" },
    { display: "Ι", insert: "\\Iota" },
    { display: "Κ", insert: "\\Kappa" },
    { display: "Λ", insert: "\\Lambda" },
    { display: "Μ", insert: "\\Mu" },
    { display: "Ν", insert: "\\Nu" },
    { display: "Ξ", insert: "\\Xi" },
    { display: "Ο", insert: "\\O" },
    { display: "Π", insert: "\\Pi" },
    { display: "Ρ", insert: "\\Rho" },
    { display: "Σ", insert: "\\Sigma" },
    { display: "Τ", insert: "\\Tau" },
    { display: "Υ", insert: "\\Upsilon" },
    { display: "Φ", insert: "\\Phi" },
    { display: "Χ", insert: "\\Chi" },
    { display: "Ψ", insert: "\\Psi" },
    { display: "Ω", insert: "\\Omega" },
    // \var... 系列（amsmath，与上面的字符在数学中视觉上一致，
    //   但 LaTeX 命令不同，用于区分同一字符在不同上下文中的"用途"，
    //   比如某些物理符号、特殊函数会要求 \varTheta 而非 \Theta）
    { display: "Γ", insert: "\\varGamma" },
    { display: "Δ", insert: "\\varDelta" },
    { display: "Θ", insert: "\\varTheta" },
    { display: "Λ", insert: "\\varLambda" },
    { display: "Ξ", insert: "\\varXi" },
    { display: "Π", insert: "\\varPi" },
    { display: "Σ", insert: "\\varSigma" },
    { display: "Υ", insert: "\\varUpsilon" },
    { display: "Φ", insert: "\\varPhi" },
    { display: "Ψ", insert: "\\varPsi" },
    { display: "Ω", insert: "\\varOmega" },
];

/* ----------------------------------------------------------- *
 * 基本数学结构
 *
 * 所有需要"空格子"的 insert 都用 \placeholder{}（MathLive 专属命令）当占位符。
 *   - 点击插入：得到纯结构（无 a/b/x/n 等示例字母），跟矩阵那种体验一致
 *   - 点击占位符：自动选中，再键入就被替换（不用先删示例字母）
 *   - 复制到笔记：cleanLatexForExport 会把残留的 \placeholder{} 剥成空串，渲染正常
 *
 * Display 保留视觉结构符号（a/b, xⁿ, √□ 等），仅当 display 字符本身就是字母时
 *   不会让用户误解成"这就是插入的内容"——display 只是缩略图，不是 LaTeX 真值。
 * ----------------------------------------------------------- */
const structures: SymbolEntry[] = [
    { display: "a/b",     insert: "\\frac{\\placeholder{}}{\\placeholder{}}", cursor: true, title: "分式 \\frac{}{}" },
    { display: "a/b/c",   insert: "\\frac{\\placeholder{}}{\\frac{\\placeholder{}}{\\placeholder{}}}", cursor: true, title: "嵌套分式 \\frac{a}{b/c}" },
    { display: "xⁿ",      insert: "x^{\\placeholder{}}",   cursor: true, title: "上标 x^{}" },
    { display: "xₙ",      insert: "x_{\\placeholder{}}",   cursor: true, title: "下标 x_{}" },
    { display: "√□",      insert: "\\sqrt{\\placeholder{}}", cursor: true, title: "平方根 \\sqrt{}" },
    { display: "ⁿ√□",     insert: "\\sqrt[n]{\\placeholder{}}", cursor: true, title: "n 次根 \\sqrt[n]{}" },
    { display: "logₙ",    insert: "\\log_{\\placeholder{}}\\placeholder{}", cursor: true, title: "对数 \\log_{b}{x}" },
    { display: "ln",      insert: "\\ln ",                  cursor: false, title: "自然对数 \\ln" },
    { display: "eˣ",      insert: "e^{\\placeholder{}}",   cursor: true, title: "e 的幂 e^{}" },
    { display: "x!",      insert: "{\\placeholder{}}!",   cursor: true, title: "阶乘 x!" },
    { display: "Cⁿₖ",     insert: "C_{\\placeholder{}}^{\\placeholder{}}", cursor: true, title: "组合数 C_n^k" },
    { display: "Pⁿₖ",     insert: "P_{\\placeholder{}}^{\\placeholder{}}", cursor: true, title: "排列数 P_n^k" },
    { display: "|□|",     insert: "|\\placeholder{}|",     cursor: true, title: "绝对值 |x|" },
    { display: "‖□‖",     insert: "\\|\\placeholder{}\\|\\|", cursor: true, title: "范数 \\|x\\|" },
    { display: "[]",      insert: "[\\placeholder{},\\placeholder{}]", cursor: true, title: "区间 [a, b]" },
    { display: "()",      insert: "(\\placeholder{},\\placeholder{})", cursor: true, title: "开区间 (a, b)" },
    { display: "{}",      insert: "\\{\\placeholder{},\\placeholder{}\\}", cursor: true, title: "集合 {a, b}" },
    { display: "⌊⌋",      insert: "\\lfloor\\placeholder{}\\rfloor", cursor: true, title: "向下取整 \\lfloor x \\rfloor" },
    { display: "⌈⌉",      insert: "\\lceil\\placeholder{}\\rceil", cursor: true, title: "向上取整 \\lceil x \\rceil" },
    { display: "̄x",      insert: "\\bar{\\placeholder{}}", cursor: true, title: "上划线 \\bar{x}" },
    { display: "→x",      insert: "\\vec{\\placeholder{}}", cursor: true, title: "向量箭头 \\vec{x}" },
    { display: "x̂",       insert: "\\hat{\\placeholder{}}", cursor: true, title: "hat 帽 \\hat{x}" },
    { display: "x̃",       insert: "\\tilde{\\placeholder{}}", cursor: true, title: "波浪 \\tilde{x}" },
    { display: "x⃗",       insert: "\\overrightarrow{\\placeholder{}}", cursor: true, title: "长向量箭头 \\overrightarrow{x}" },
];

/* ----------------------------------------------------------- *
 * 求和 / 积分 / 极限 / 乘积
 * ----------------------------------------------------------- */
const calculus: SymbolEntry[] = [
    { display: "∑",   insert: "\\sum_{}^{}",            cursor: true },
    { display: "∏",   insert: "\\prod_{}^{}",           cursor: true },
    { display: "∐",   insert: "\\coprod_{}^{}",         cursor: true },
    { display: "∫",   insert: "\\int_{}^{}",            cursor: true },
    { display: "∮",   insert: "\\oint_{}^{}",           cursor: true },
    { display: "∬",   insert: "\\iint_{}^{}",           cursor: true },
    { display: "∭",   insert: "\\iiint_{}^{}",          cursor: true },
    { display: "∮∮",  insert: "\\oint\\oint_{}^{}",     cursor: true },
    { display: "lim", insert: "\\lim_{}",               cursor: true },
    { display: "lim sup", insert: "\\limsup_{}",        cursor: true },
    { display: "lim inf", insert: "\\liminf_{}",        cursor: true },
    { display: "→",   insert: "\\to",                   cursor: false },
    { display: "d/dx", insert: "\\frac{{d}}{{dx}}",     cursor: true },
    { display: "∂/∂x", insert: "\\frac{{\\partial}}{{\\partial x}}", cursor: true },
    { display: "∞",   insert: "\\infty",                cursor: false },
];

/* ----------------------------------------------------------- *
 * 关系运算符
 * ----------------------------------------------------------- */
const relations: SymbolEntry[] = [
    "≤","≥","≠","≈","≡","≜","≝","≅","∼","≃","≈","∝",
    "≪","≫","≺","≻","≼","≽","⊂","⊃","⊆","⊇","∈","∉",
    "∋","∩","∪","∅","⊕","⊗","⊖","⊙","¬","∧","∨","⇒",
    "⇐","⇔","↔","↑","↓","←","→","⊥","∥"
].map(s => {
    const map: Record<string,string> = {
        "≤":"\\leq","≥":"\\geq","≠":"\\neq","≈":"\\approx","≡":"\\equiv",
        "≜":"\\triangleq","≝":"\\stackrel{\\text{def}}{=}","≅":"\\cong",
        "∼":"\\sim","≃":"\\simeq","∝":"\\propto","≪":"\\ll","≫":"\\gg",
        "≺":"\\prec","≻":"\\succ","≼":"\\preceq","≽":"\\succeq",
        "⊂":"\\subset","⊃":"\\supset","⊆":"\\subseteq","⊇":"\\supseteq",
        "∈":"\\in","∉":"\\notin","∋":"\\ni","∩":"\\cap","∪":"\\cup",
        "∅":"\\emptyset","⊕":"\\oplus","⊗":"\\otimes","⊖":"\\ominus",
        "⊙":"\\odot","¬":"\\neg","∧":"\\wedge","∨":"\\vee","⇒":"\\Rightarrow",
        "⇐":"\\Leftarrow","⇔":"\\Leftrightarrow","↔":"\\leftrightarrow",
        "↑":"\\uparrow","↓":"\\downarrow","←":"\\leftarrow","→":"\\to",
        "⊥":"\\perp","∥":"\\parallel",
    };
    return { display: s, insert: map[s] || s };
});

/* ----------------------------------------------------------- *
 * 集合
 * ----------------------------------------------------------- */
const sets: SymbolEntry[] = [
    { display: "ℝ",  insert: "\\mathbb{R}" },
    { display: "ℕ",  insert: "\\mathbb{N}" },
    { display: "ℤ",  insert: "\\mathbb{Z}" },
    { display: "ℚ",  insert: "\\mathbb{Q}" },
    { display: "ℂ",  insert: "\\mathbb{C}" },
    { display: "ℙ",  insert: "\\mathbb{P}" },
    { display: "𝔼",  insert: "\\mathbb{E}" },
    { display: "∈",  insert: "\\in" },
    { display: "∉",  insert: "\\notin" },
    { display: "∋",  insert: "\\ni" },
    { display: "⊂",  insert: "\\subset" },
    { display: "⊃",  insert: "\\supset" },
    { display: "⊆",  insert: "\\subseteq" },
    { display: "⊇",  insert: "\\supseteq" },
    { display: "∩",  insert: "\\cap" },
    { display: "∪",  insert: "\\cup" },
    { display: "∖",  insert: "\\setminus" },
    { display: "∅",  insert: "\\emptyset" },
    { display: "∀",  insert: "\\forall" },
    { display: "∃",  insert: "\\exists" },
    { display: "∄",  insert: "\\nexists" },
    { display: "⇒",  insert: "\\Rightarrow" },
    { display: "⇐",  insert: "\\Leftarrow" },
    { display: "⇔",  insert: "\\Leftrightarrow" },
    { display: "⊢",  insert: "\\vdash" },
    { display: "⊨",  insert: "\\models" },
];

/* ----------------------------------------------------------- *
 * 矩阵
 * ----------------------------------------------------------- */
const matrices: SymbolEntry[] = [
    // 括号矩阵 pmatrix —— 缩略图用字母占位（更直观），insert 用 \placeholder 占位
    // 注意：insert 里**不要用 \n**（MathLive 处理多行 LaTeX 时 \n 会破坏解析）
    //
    // 重要历史教训：曾经用空格 ` ` 占位 → MathLive 把空格不当原子，空 cell 整张塌成 (□)。
    //   第一版修复换成 \square → 矩阵结构 OK，但 \square 是普通内容原子，
    //   用户输入数字后变成 `1\square`，方框去不掉。
    //   终极方案：MathLive 的 \placeholder 命令（makePlaceholder 风格）：
    //     - 渲染为浅色 □
    //     - 点击 cell 时自动选中 placeholder
    //     - 接着键入任何字符都把 placeholder 替换掉 → UX 真正"占位"
    //   注意：\placeholder 是 MathLive 专属命令，MathJax 不认。
    //   插件在导出（getWrappedOutput）时把残留的 \placeholder{} 清成空字符串，
    //   所以笔记里渲染没问题；用户忘了填的 cell 在笔记里就是空 cell，结构仍然清晰。
    { display: "( 1×1 )",    insert: "\\begin{pmatrix} \\placeholder{} \\end{pmatrix}", cursor: true, preview: "\\begin{pmatrix} a \\end{pmatrix}" },
    { display: "( 2×2 )",    insert: "\\begin{pmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{pmatrix}", cursor: true, preview: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" },
    { display: "( 3×3 )",    insert: "\\begin{pmatrix} \\placeholder{} & \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} & \\placeholder{} \\end{pmatrix}", cursor: true, preview: "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}" },
    // 方括号矩阵 bmatrix
    { display: "[ 2×2 ]",    insert: "\\begin{bmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{bmatrix}", cursor: true, preview: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
    // 行列式 vmatrix
    { display: "| 2×2 |",    insert: "\\begin{vmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{vmatrix}", cursor: true, preview: "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}" },
    // 花括号矩阵 Bmatrix
    { display: "{ 2×2 }",    insert: "\\begin{Bmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{Bmatrix}", cursor: true, preview: "\\begin{Bmatrix} a & b \\\\ c & d \\end{Bmatrix}" },
    // 2×4 / 4×1
    { display: "2×4",        insert: "\\begin{pmatrix} \\placeholder{} & \\placeholder{} & \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} & \\placeholder{} & \\placeholder{} \\end{pmatrix}", cursor: true, preview: "\\begin{pmatrix} a & b & c & d \\\\ e & f & g & h \\end{pmatrix}" },
    { display: "4×1",        insert: "\\begin{pmatrix} \\placeholder{} \\\\ \\placeholder{} \\\\ \\placeholder{} \\\\ \\placeholder{} \\end{pmatrix}", cursor: true, preview: "\\begin{pmatrix} a \\\\ b \\\\ c \\\\ d \\end{pmatrix}" },
    // ⋮ ⋯ ⋱ 模式（常用通用矩阵）—— 已经有真实原子，不需要 placeholder
    { display: "⋮ ⋯ ⋱",     insert: "\\begin{pmatrix} a_{11} & \\cdots & a_{1n} \\\\ \\vdots & \\ddots & \\vdots \\\\ a_{m1} & \\cdots & a_{mn} \\end{pmatrix}", cursor: true, preview: "\\begin{pmatrix} a_{11} & \\cdots & a_{1n} \\\\ \\vdots & \\ddots & \\vdots \\\\ a_{m1} & \\cdots & a_{mn} \\end{pmatrix}" },
    // cases 方程组
    { display: "cases",      insert: "\\begin{cases} \\placeholder{} \\\\ \\placeholder{} \\end{cases}", cursor: true, preview: "\\begin{cases} a & x > 0 \\\\ b & x \\le 0 \\end{cases}" },
    { display: "{x=;y=}",    insert: "\\begin{cases} x = {cursor} \\\\ y = \\placeholder{} \\end{cases}", cursor: true, preview: "\\begin{cases} x = \\\\ y = \\end{cases}" },
    { display: "{x=;y=;z=}", insert: "\\begin{cases} x = {cursor} \\\\ y = \\placeholder{} \\\\ z = \\placeholder{} \\end{cases}", cursor: true, preview: "\\begin{cases} x = \\\\ y = \\\\ z = \\end{cases}" },
    // aligned 对齐
    { display: "align",      insert: "\\begin{aligned} \\placeholder{} \\\\ \\placeholder{} \\end{aligned}", cursor: true, preview: "\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}" },
    { display: "aligned",    insert: "\\begin{aligned} x &= y \\\\ y &= z  \\end{aligned}", cursor: true, preview: "\\begin{aligned} x &= y \\\\ y &= z \\end{aligned}" },
];

/* ----------------------------------------------------------- *
 * 箭头 / 标注
 * ----------------------------------------------------------- */
const arrows: SymbolEntry[] = [
    { display: "→",  insert: "\\to" },
    { display: "←",  insert: "\\leftarrow" },
    { display: "↔",  insert: "\\leftrightarrow" },
    { display: "⇒",  insert: "\\Rightarrow" },
    { display: "⇐",  insert: "\\Leftarrow" },
    { display: "⇔",  insert: "\\Leftrightarrow" },
    { display: "↦",  insert: "\\mapsto" },
    { display: "→̄",   insert: "\\xrightarrow{}" , cursor: true},
    { display: "←̄",   insert: "\\xleftarrow{}",   cursor: true },
    { display: "↗",  insert: "\\nearrow" },
    { display: "↘",  insert: "\\searrow" },
    { display: "↙",  insert: "\\swarrow" },
    { display: "↖",  insert: "\\nwarrow" },
    { display: "↪",  insert: "\\hookrightarrow" },
    { display: "↩",  insert: "\\hookleftarrow" },
    { display: "⤴",  insert: "\\rightarrowtail" },
    { display: "⤵",  insert: "\\leftarrowtail" },
];

/* ----------------------------------------------------------- *
 * 杂项运算符 / 标点
 * ----------------------------------------------------------- */
const operators: SymbolEntry[] = [
    { display: "±",  insert: "\\pm" },
    { display: "∓",  insert: "\\mp" },
    { display: "×",  insert: "\\times" },
    { display: "÷",  insert: "\\div" },
    { display: "·",  insert: "\\cdot" },
    { display: "∘",  insert: "\\circ" },
    { display: "∗",  insert: "\\ast" },
    { display: "★",  insert: "\\star" },
    { display: "†",  insert: "\\dagger" },
    { display: "‡",  insert: "\\ddagger" },
    { display: "◦",  insert: "\\bullet" },
    { display: "∂",  insert: "\\partial" },
    { display: "∇",  insert: "\\nabla" },
    { display: "∝",  insert: "\\propto" },
    { display: "ℏ",  insert: "\\hbar" },
    { display: "ℓ",  insert: "\\ell" },
    { display: "ℜ",  insert: "\\Re" },
    { display: "ℑ",  insert: "\\Im" },
    { display: "′",  insert: "'" },
    { display: "″",  insert: "''" },
    { display: "‴",  insert: "'''" },
    { display: "°",  insert: "^{\\circ}" },
    { display: "□",  insert: "\\square" },
    { display: "△",  insert: "\\triangle" },
    { display: "○",  insert: "\\bigcirc" },
];

/* ----------------------------------------------------------- *
 * 排版 / 字体
 * ----------------------------------------------------------- */
const typography: SymbolEntry[] = [
    // 字体样式 —— 6 种
    // 历史教训：原代码里 \mathbf / \mathit / \mathrm 的 display 字符 codepoint 错了：
    //   bold 和 italic 都用了 U+1D431（粗体 x），italic 应该是 U+1D465（斜体 x）；
    //   roman (\mathrm) 用了 U+1D465（斜体），应该是普通 x。
    //   导致用户看到的三个"x"长得几乎一样，分不清谁是谁。已修正。
    //   fraktur/script 沿用 ℵ/ℛ 作占位（这两字符系统字体都有，无需依赖数学字体）。
    { display: "𝐱",  insert: "\\mathbf{abc}",   cursor: true, preview: "\\mathbf{abc}",   title: "粗体 \\mathbf{} —— 加粗，\\mathbb 风格的黑板体不归这里" },
    { display: "𝑥",  insert: "\\mathit{abc}",   cursor: true, preview: "\\mathit{abc}",   title: "斜体 \\mathit{} —— 强制斜体（默认变量就是斜体，一般用不上）" },
    { display: "x",  insert: "\\mathrm{abc}",   cursor: true, preview: "\\mathrm{abc}",   title: "正体 \\mathrm{} —— 强制正体，常用于单位（km、kg）" },
    { display: "ℵ",  insert: "\\mathfrak{abc}", cursor: true, preview: "\\mathfrak{abc}", title: "哥特体 \\mathfrak{} —— 德国老派数学字体（abstract algebra 用得多）" },
    { display: "ℛ",  insert: "\\mathscr{abc}",  cursor: true, preview: "\\mathscr{abc}",  title: "花体 \\mathscr{} —— 草书体（集合命名 X、Y 用）" },
    { display: "𝕏",  insert: "\\mathbb{abc}",   cursor: true, preview: "\\mathbb{abc}",   title: "空心体 \\mathbb{} —— 黑板粗体，集合常用（ℝ, ℕ, ℤ, ℚ, ℂ）" },
    // 装饰 —— 4 种
    { display: "x̅",  insert: "\\overline{}",        cursor: true, title: "上划线 \\overline{} —— 平均值、集合闭包常用" },
    { display: "x⃗",  insert: "\\overrightarrow{}",  cursor: true, title: "向量箭头 \\overrightarrow{} —— 完整箭头 \\vec{} 是简写" },
    { display: "x̂",   insert: "\\hat{}",             cursor: true, title: "尖帽 \\hat{} —— 统计里 \\hat{\\theta} 估计算子" },
    { display: "x̃",   insert: "\\tilde{}",           cursor: true, title: "波浪 \\tilde{} —— 波浪号，相似关系 ~" },
    // 撇号 —— 2 种
    { display: "x'",  insert: "'",   title: "一阶撇号（f' 导数）" },
    { display: "x''", insert: "''",  title: "二阶撇号（f'' 二阶导数）" },
    // 文本模式 —— 2 种
    // 改：原 display 直接写 LaTeX 命令名（"text"/"mathrm"），看不懂。换成的具体内容示例。
    { display: "字",  insert: "\\text{字}",   cursor: true, title: "文本模式 \\text{} —— 在公式里塞中文/空格/普通文本" },
    { display: "abc", insert: "\\mathrm{abc}", cursor: true, title: "正体英文 \\mathrm{} —— math 模式里的英文正体" },
    // 粗斜体 —— 1 种
    { display: "B",   insert: "\\boldsymbol{abc}", cursor: true, preview: "\\boldsymbol{abc}", title: "粗斜体 \\boldsymbol{} —— 粗体 + 斜体，向量常用" },
    // 分式 / 二项式 —— 用 MathJax 预览显示大小差异
    // 改：原 display 直接写 "tfrac" / "dfrac" / "binom"，看不出区别。preview 渲染后一眼能看出
    //   tfrac 是行内小分式，dfrac 是行间大分式，binom 是二项式系数（Cₙᵏ / a 选 b）。
    { display: "a/b", insert: "\\tfrac{a}{b}", cursor: true, preview: "\\tfrac{a}{b}", title: "小分式 \\tfrac{} —— 行内用，分子分母压扁" },
    { display: "a/b", insert: "\\dfrac{a}{b}", cursor: true, preview: "\\dfrac{a}{b}", title: "大分式 \\dfrac{} —— 行间用，分子分母撑开（推荐）" },
    { display: "Cₙₖ", insert: "\\binom{n}{k}", cursor: true, preview: "\\binom{n}{k}", title: "二项式系数 \\binom{} —— C(n,k) 组合数" },
];

/* ----------------------------------------------------------- *
 * 导出分类
 * ----------------------------------------------------------- */
export const SYMBOL_CATEGORIES: SymbolCategory[] = [
    { key: "lower",  label: "小写希腊", icon: "αβγ", entries: lowerGreek },
    { key: "upper",  label: "大写希腊", icon: "ΓΔΘ", entries: upperGreek },
    { key: "struct", label: "基本结构", icon: "ab",  entries: structures },
    { key: "calc",   label: "微积分",   icon: "∫∑",  entries: calculus },
    { key: "rel",    label: "关系",     icon: "≤≥",  entries: relations },
    { key: "set",    label: "集合",     icon: "∈∪",  entries: sets },
    { key: "mat",    label: "矩阵",     icon: "[ ]", entries: matrices },
    { key: "arr",    label: "箭头",     icon: "→",   entries: arrows },
    { key: "op",     label: "运算",     icon: "±×",  entries: operators },
    { key: "type",   label: "排版",     icon: "𝐱",   entries: typography },
];

/**
 * 把带 {cursor} 标记的 LaTeX 字符串清理为最终插入文本，并返回光标偏移量。
 * 用 {,} 替代 {cursor} 处的成对花括号。
 */
export interface ParsedInsert {
    text: string;
    cursorOffset: number;
}

export function parseInsert(raw: string): ParsedInsert {
    if (!raw.includes("{cursor}")) {
        return { text: raw, cursorOffset: raw.length };
    }
    const cursorPos = raw.indexOf("{cursor}");
    const cleaned = raw.replace("{cursor}", "");
    return { text: cleaned, cursorOffset: cursorPos };
}
