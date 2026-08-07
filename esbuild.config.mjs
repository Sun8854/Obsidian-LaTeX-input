import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const prod = process.argv[2] === "production";

/**
 * 虚拟模块插件：把 MathLive 的 JS 以「ES module」形式 import 进 main.ts
 *   解决 Obsidian Electron 渲染层相对路径解析失败的问题（base URL 是 Obsidian app 目录，不是插件目录）
 *   用法（side-effect import，UMD body 在模块加载时执行，自动注册 <math-field> custom element）：
 *     import "mathlive-js";
 *   vendor/ 目录仅 build 时使用（读 mathlive.min.js），esbuild 会把 UMD 包装后的代码
 *   正常 bundle 进 main.js（不再以字符串形式注入到 <script>，消除动态 script 注入）。
 */
const mathliveVirtualPlugin = {
  name: "mathlive-virtual",
  setup(build) {
    build.onResolve({ filter: /^mathlive-js$/ }, (args) => ({
      path: args.path,
      namespace: "mathlive-virt",
    }));
    build.onLoad({ filter: /.*/, namespace: "mathlive-virt" }, async () => {
      const contents = await readFile(resolve("vendor/mathlive.min.js"), "utf8");
      // loader: 'js' —— esbuild 把内容当 JS 解析并 bundle；UMD 的
      //   `typeof exports === 'object' ? factory(exports) : ...` 分支
      //   在 CJS 上下文里命中第一条，MathLive 被挂到当前模块的 exports，
      //   同时 factory 内部的 customElements.define(...) 副作用会立即执行。
      return { contents, loader: "js" };
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  loader: { ".css": "text" },
  plugins: [mathliveVirtualPlugin],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
