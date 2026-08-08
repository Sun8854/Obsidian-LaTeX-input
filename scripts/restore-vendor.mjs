#!/usr/bin/env node
/**
 * restore-vendor.mjs
 *
 * 目的：保证 fresh clone + npm install 后 `vendor/mathlive.min.js` 和 `vendor/mathlive-static.css` 存在，
 *   这两个文件被 `esbuild.config.mjs` 的 mathliveVirtualPlugin 在 build 时读入，
 *   但 `vendor/` 已被 `.gitignore` 排除，所以必须由本脚本重建。
 *
 * 策略：从 npm registry 拉 mathlive@<version> 的 tarball 到临时目录，
 *   用 tar 包解到指定路径；解完清掉临时文件。失败时打印明确指引给用户手动操作。
 *
 * 选项：
 *   --force           强制重新下载（默认：已存在则跳过）
 *
 * 退出码：
 *   0  成功（已恢复 / 已存在 / 无需操作）
 *   1  恢复失败（网络 / 写文件 / 验证），错误已打印到 stderr
 */

import { existsSync, mkdirSync, statSync, rmSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const VENDOR_DIR = resolve(ROOT, "vendor");

// 版本固定 —— 跟 esbuild.config.mjs 的 mathlive-virt 期望一致。
const MATHLIVE_VERSION = "0.103.0";

const REGISTRY =
    process.env.NPM_REGISTRY?.replace(/\/+$/, "") || "https://registry.npmjs.org";

const FILES_TO_RESTORE = [
    { from: "package/dist/mathlive.min.js", to: "vendor/mathlive.min.js" },
    { from: "package/dist/mathlive-static.css", to: "vendor/mathlive-static.css" },
];

const FORCE = process.argv.includes("--force");
const SKIP_IF_PRESENT = !FORCE;

function log(msg) {
    process.stdout.write(`[restore-vendor] ${msg}\n`);
}
function err(msg) {
    process.stderr.write(`[restore-vendor] ${msg}\n`);
}

async function downloadTarball(version, destPath) {
    const packumentUrl = `${REGISTRY}/mathlive/${encodeURIComponent(version)}`;
    log(`fetching packument: ${packumentUrl}`);
    const r1 = await fetch(packumentUrl, { redirect: "follow" });
    if (!r1.ok) {
        throw new Error(`HTTP ${r1.status} on ${packumentUrl}`);
    }
    const meta = await r1.json();
    const tarballUrl = meta.dist?.tarball;
    if (!tarballUrl) {
        throw new Error(`no dist.tarball in packument for mathlive@${version}`);
    }
    log(`tarball: ${tarballUrl}`);

    const r2 = await fetch(tarballUrl, { redirect: "follow" });
    if (!r2.ok) {
        throw new Error(`HTTP ${r2.status} on ${tarballUrl}`);
    }
    const buf = Buffer.from(await r2.arrayBuffer());
    await writeFile(destPath, buf);
    return destPath;
}

async function extractFromTarball(tarballPath, wantSubpaths, cwd) {
    let tarMod;
    try {
        tarMod = await import("tar");
    } catch {
        throw new Error(
            "需要 'tar' 包来解 tarball。请先在 devDependencies 装 'tar'，或运行 `npm i tar --save-dev`。"
        );
    }
    await tarMod.x({
        gzip: true,
        file: tarballPath,
        cwd,
        // 限定路径前缀为 package/，只解我们想要的两个文件，避免大量无用的 dist 文件落地。
        filter: (p) => wantSubpaths.some((w) => p === w || p.startsWith(w + "/")),
    });
}

async function main() {
    if (!existsSync(VENDOR_DIR)) {
        mkdirSync(VENDOR_DIR, { recursive: true });
        log(`created ${VENDOR_DIR}`);
    }

    if (SKIP_IF_PRESENT) {
        const missing = FILES_TO_RESTORE.filter(
            (f) => !existsSync(resolve(ROOT, f.to))
        );
        if (missing.length === 0) {
            log(
                `vendor/ 已包含全部必需文件（${FILES_TO_RESTORE.map((f) =>
                    f.to.split("/").pop()
                ).join(", ")}），跳过。`
            );
            return;
        }
        log(
            `缺失 ${missing.length} 个文件，开始恢复：${missing.map((f) => f.to).join(", ")}`
        );
    }

    // 临时工作目录：.gitignore 已经把 .probe/ 排了，但我们临时放 vendor-build/ 即可，
    //   走完后 rmSync。位置 .gitignore 不必改，因为是 .gitignore 之外的目录。
    const tmpRoot = resolve(ROOT, `vendor-build-${process.pid}-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
    const tarballPath = join(tmpRoot, `mathlive-${MATHLIVE_VERSION}.tgz`);
    const extractRoot = join(tmpRoot, "extracted");
    mkdirSync(extractRoot, { recursive: true });

    try {
        await downloadTarball(MATHLIVE_VERSION, tarballPath);
        await extractFromTarball(
            tarballPath,
            FILES_TO_RESTORE.map((f) => f.from),
            extractRoot
        );

        // 把解出来的文件 mv 到 vendor/，并验证非空。
        for (const f of FILES_TO_RESTORE) {
            const src = join(extractRoot, f.from);
            const dst = resolve(ROOT, f.to);
            if (!existsSync(src)) {
                throw new Error(`tarball 解出后未找到 ${src}`);
            }
            const buf = await import("node:fs/promises").then((m) => m.readFile(src));
            await writeFile(dst, buf);
            const sz = statSync(dst).size;
            if (sz === 0) {
                throw new Error(`${dst} 写入后大小为 0`);
            }
            log(`wrote ${f.to} (${sz} bytes)`);
        }
        log("done.");
    } catch (e) {
        err(`自动恢复失败：${e.message}`);
        err("");
        err("手动恢复步骤：");
        err(`  mkdir -p vendor`);
        err(`  npm pack mathlive@${MATHLIVE_VERSION} --registry ${REGISTRY}`);
        err(`  tar -xzf mathlive-${MATHLIVE_VERSION}.tgz package/dist/mathlive.min.js package/dist/mathlive-static.css`);
        err(`  mv package/dist/mathlive.min.js vendor/mathlive.min.js`);
        err(`  mv package/dist/mathlive-static.css vendor/mathlive-static.css`);
        err(`  rm -rf package mathlive-${MATHLIVE_VERSION}.tgz`);
        process.exitCode = 1;
    } finally {
        // 清理临时目录（成功失败都清）
        try {
            rmSync(tmpRoot, { recursive: true, force: true });
        } catch {}
    }
}

main().catch((e) => {
    err(`unexpected: ${e?.stack || e?.message || e}`);
    process.exit(1);
});