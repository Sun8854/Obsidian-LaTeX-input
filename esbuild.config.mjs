import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const prod = process.argv[2] === "production";

/**
 * 虚拟模块插件：把 MathLive 的 JS / CSS 以「字符串」形式 import 进 main.ts
 *   解决 Obsidian Electron 渲染层相对路径解析失败的问题（base URL 是 Obsidian app 目录，不是插件目录）
 *   用法：
 *     import mathliveJs from "mathlive-js";   // string
 *     import mathliveCss from "mathlive-css"; // string
 *   vendor/ 目录仅 build 时使用（读 mathlive.min.js + mathlive-static.inline.css），
 *   不会被打包进 main.js（以字符串形式内嵌），也不会出现在最终插件目录里。
 */
const mathliveVirtualPlugin = {
  name: "mathlive-virtual",
  setup(build) {
    build.onResolve({ filter: /^mathlive-(js|css)$/ }, (args) => ({
      path: args.path,
      namespace: "mathlive-virt",
    }));
    build.onLoad({ filter: /.*/, namespace: "mathlive-virt" }, async (args) => {
      const isJs = args.path === "mathlive-js";
      const file = isJs
        ? resolve("vendor/mathlive.min.js")
        : resolve("vendor/mathlive-static.css");
      const contents = await readFile(file, "utf8");
      // 显式声明 loader: 'text'，让 esbuild 把内容当字符串嵌入
      return { contents, loader: "text" };
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
