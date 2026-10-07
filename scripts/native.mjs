// Fetch the Electron-ABI prebuilt of better-sqlite3 (no local compiler needed).
// Runs on postinstall; tests also run under Electron (scripts/test.mjs), so one
// binary serves both.
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron/package.json').version
const dir = dirname(require.resolve('better-sqlite3/package.json'))
execSync(`npx prebuild-install --runtime electron --target ${electron} --arch ${process.arch}`, {
  cwd: dir,
  stdio: 'inherit'
})
