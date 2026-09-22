import path from 'node:path';
import { homedir } from 'node:os';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const pathsFor = platform => platform === 'win32' ? path.win32 : path.posix;
export const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const engineFilename = (platform = process.platform) => platform === 'win32' ? 'grok.exe' : 'grok';
export const userHome = (environment = process.env, platform = process.platform) =>
  (platform === 'win32' ? environment.USERPROFILE || environment.HOME : environment.HOME) || homedir();
export const grokHome = (environment = process.env, platform = process.platform) => {
  const paths = pathsFor(platform);
  return paths.resolve(environment.GROK_HOME || paths.join(userHome(environment, platform), '.grok'));
};

export function applicationDataDirectory(environment = process.env, platform = process.platform) {
  const paths = pathsFor(platform), home = userHome(environment, platform);
  const base = platform === 'win32' ? environment.APPDATA || paths.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? paths.join(home, 'Library', 'Application Support')
      : environment.XDG_CONFIG_HOME && paths.isAbsolute(environment.XDG_CONFIG_HOME) ? environment.XDG_CONFIG_HOME : paths.join(home, '.config');
  return paths.join(base, 'GrokDesk');
}

/** A desktop launch can lack shell PATH entries. Keep credentials and other variables intact. */
export function desktopEnvironment(source = process.env, { platform = process.platform, additionalPath = [] } = {}) {
  const environment = { ...source }, paths = pathsFor(platform), home = userHome(source, platform);
  const keys = Object.keys(source).filter(key => platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH');
  const inherited = keys.flatMap(key => String(source[key] || '').split(paths.delimiter));
  const defaults = [paths.join(grokHome(source, platform), 'bin'), paths.join(home, '.grok', 'bin')];
  if (platform !== 'win32') defaults.push(paths.join(home, '.local', 'bin'), paths.join(home, '.cargo', 'bin'),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/opt/local/bin'] : []),
    '/usr/local/bin', '/usr/local/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin');
  const seen = new Set();
  const entries = [...additionalPath, ...inherited, ...defaults].map(entry => String(entry).replace(/^"(.*)"$/, '$1')).filter(entry => {
    if (!entry || !paths.isAbsolute(entry)) return false;
    const key = platform === 'win32' ? paths.normalize(entry).toLowerCase() : paths.normalize(entry);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  for (const key of keys) delete environment[key];
  environment.PATH = entries.join(paths.delimiter);
  return environment;
}

/** Import PATH only, never the login shell's credentials or configuration contents. */
export async function initializeDesktopEnvironment(environment = process.env, { platform = process.platform, run = execute } = {}) {
  let loginPath = '';
  if (platform !== 'win32') {
    const shell = environment.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
    const name = path.posix.basename(shell);
    if (path.posix.isAbsolute(shell) && /^(?:ba|da|k|z)?sh$|^fish$/.test(name)) {
      const marker = '__GROKDESK_PATH__';
      const value = name === 'fish' ? '(string join : $PATH)' : '"$PATH"';
      try {
        const { stdout } = await run(shell, ['-ilc', `printf '\\n${marker}%s${marker}\\n' ${value}`], {
          env: { ...environment }, cwd: userHome(environment, platform), encoding: 'utf8', timeout: 3000,
          maxBuffer: 256 * 1024, windowsHide: true,
        });
        const start = stdout.indexOf(marker), end = start < 0 ? -1 : stdout.indexOf(marker, start + marker.length);
        if (end >= 0) loginPath = stdout.slice(start + marker.length, end);
      } catch { /* Shell startup may be unavailable or interactive; standard paths remain usable. */ }
    }
  }
  const result = desktopEnvironment(environment, { platform, additionalPath: loginPath.split(':') });
  if (platform === 'win32') for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
  environment.PATH = result.PATH;
  return environment;
}

export function findEngineExecutable(override, source = process.env, { platform = process.platform, executable = isExecutable } = {}) {
  const paths = pathsFor(platform), environment = desktopEnvironment(source, { platform });
  const candidates = override ? [paths.resolve(override)]
    : environment.PATH.split(paths.delimiter).map(folder => paths.join(folder, engineFilename(platform)));
  return candidates.find(candidate => executable(candidate, platform)) || null;
}

function isExecutable(filename, platform) {
  try {
    if (!statSync(filename).isFile()) return false;
    accessSync(filename, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
}

// POSIX volumes can be case sensitive, including APFS. Do not lowercase them.
export function sameDirectory(left, right, platform = process.platform) {
  const paths = pathsFor(platform), normalize = value => platform === 'win32' ? paths.resolve(value).toLowerCase() : paths.resolve(value);
  return normalize(left) === normalize(right);
}

export function terminalEnvironment(source = process.env) {
  return { ...source, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}
