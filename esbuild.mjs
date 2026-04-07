import esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  external: ['vscode']
};

const webUiConfig = {
  entryPoints: ['src/webui/app.ts'],
  bundle: true,
  outfile: 'dist/webui/app.js',
  platform: 'browser',
  format: 'esm',
  sourcemap: !production,
  minify: production
};

async function main() {
  if (watch) {
    const extensionContext = await esbuild.context(extensionConfig);
    const webUiContext = await esbuild.context(webUiConfig);
    await Promise.all([extensionContext.watch(), webUiContext.watch()]);
    return;
  }

  await copyWebUiAssets();
  await esbuild.build(extensionConfig);
  await esbuild.build(webUiConfig);
}

async function copyWebUiAssets() {
  const targetDirectory = path.join('dist', 'webui');
  await mkdir(targetDirectory, { recursive: true });
  await cp(path.join('src', 'webui', 'index.html'), path.join(targetDirectory, 'index.html'));
  await cp(path.join('src', 'webui', 'app.css'), path.join(targetDirectory, 'app.css'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
