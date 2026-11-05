#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FETCH_TIMEOUT_MS = 60_000;
const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const color = (code, text) => useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
const colors = {
  bold: (text) => color('1', text),
  dim: (text) => color('2', text),
  red: (text) => color('31', text),
  green: (text) => color('32', text),
  yellow: (text) => color('33', text),
  blue: (text) => color('34', text),
  magenta: (text) => color('35', text),
  cyan: (text) => color('36', text),
};

function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 15_000,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdoutRaw: result.stdout || '',
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error,
  };
}

function parseArguments(argv) {
  const options = {
    fetch: true,
    root: path.dirname(__dirname),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-fetch') {
      options.fetch = false;
    } else if (argument === '--root') {
      if (!argv[index + 1]) throw new Error('--root requires a directory path.');
      options.root = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function showHelp() {
  console.log(`Check Git Status

Usage:
  check.bat [--no-fetch] [--root <directory>]
  node check-git-status.js [--no-fetch] [--root <directory>]

Options:
  --root <directory>  Scan this directory instead of the script's parent.
  --no-fetch          Do not contact remotes before checking repositories.
  -h, --help          Show this help.`);
}

function isGitRepository(directory) {
  const result = git(directory, ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout === 'true';
}

function getWorkingTree(directory) {
  const result = git(directory, ['status', '--porcelain=v1']);
  if (!result.ok || !result.stdoutRaw) return { staged: 0, modified: 0, untracked: 0 };

  let staged = 0;
  let modified = 0;
  let untracked = 0;
  for (const entry of result.stdoutRaw.split(/\r?\n/).filter(Boolean)) {
    const indexStatus = entry[0];
    const workTreeStatus = entry[1];
    if (indexStatus === '?' && workTreeStatus === '?') {
      untracked += 1;
    } else {
      if (indexStatus && indexStatus !== ' ') staged += 1;
      if (workTreeStatus && workTreeStatus !== ' ') modified += 1;
    }
  }
  return { staged, modified, untracked };
}

function getBranches(directory) {
  const format = '%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)';
  const localResult = git(directory, ['for-each-ref', `--format=${format}`, 'refs/heads/']);
  const locals = localResult.ok && localResult.stdout
    ? localResult.stdout.split(/\r?\n/).map((line) => {
        const [name, upstream, track, head] = line.split('\0');
        const ahead = Number(track.match(/ahead (\d+)/)?.[1] || 0);
        const behind = Number(track.match(/behind (\d+)/)?.[1] || 0);
        return { name, upstream, ahead, behind, current: head === '*' };
      })
    : [];

  const remoteResult = git(directory, [
    'for-each-ref',
    '--format=%(refname:short)%00%(symref)',
    'refs/remotes/',
  ]);
  const remotes = remoteResult.ok && remoteResult.stdout
    ? remoteResult.stdout.split(/\r?\n/)
        .map((line) => line.split('\0'))
        .filter(([, symbolicTarget]) => !symbolicTarget)
        .map(([name]) => name)
    : [];

  const trackedRemotes = new Set(locals.map((branch) => branch.upstream).filter(Boolean));
  return {
    locals,
    localOnly: locals.filter((branch) => !branch.upstream).map((branch) => branch.name),
    remoteOnly: remotes.filter((branch) => !trackedRemotes.has(branch)),
  };
}

function describeRepository(directory, shouldFetch) {
  let fetchWarning = '';
  if (shouldFetch) {
    const remotes = git(directory, ['remote']);
    if (remotes.ok && remotes.stdout) {
      const fetched = git(directory, ['fetch', '--all', '--prune', '--quiet'], {
        timeout: FETCH_TIMEOUT_MS,
      });
      if (!fetched.ok) {
        fetchWarning = fetched.error?.code === 'ETIMEDOUT'
          ? 'Fetch timed out.'
          : `Fetch failed: ${fetched.stderr || fetched.error?.message || 'unknown error'}`;
      }
    }
  }

  const workTree = getWorkingTree(directory);
  const branches = getBranches(directory);
  const current = branches.locals.find((branch) => branch.current);
  return { workTree, branches, current, fetchWarning };
}

function printList(label, items) {
  if (items.length) console.log(`  ${colors.yellow(label)}: ${items.join(', ')}`);
}

function printRepository(name, report) {
  console.log(`\n${colors.green('[Git repository]')} ${colors.bold(name)}`);
  const { staged, modified, untracked } = report.workTree;
  const changes = staged + modified + untracked;
  console.log(changes
    ? `  Working tree: ${colors.yellow('CHANGES')} (staged: ${staged}, modified: ${modified}, untracked: ${untracked})`
    : `  Working tree: ${colors.green('clean')}`);

  if (report.current) {
    const branch = report.current;
    let sync = colors.yellow('no upstream');
    if (branch.upstream) {
      if (branch.ahead && branch.behind) sync = colors.magenta(`diverged (ahead ${branch.ahead}, behind ${branch.behind})`);
      else if (branch.ahead) sync = colors.cyan(`local commits to push: ${branch.ahead}`);
      else if (branch.behind) sync = colors.blue(`remote commits to pull: ${branch.behind}`);
      else sync = colors.green('up to date');
    }
    console.log(`  Current branch: ${colors.bold(branch.name)} -> ${sync}`);
  } else {
    console.log(`  Current branch: ${colors.yellow('detached HEAD or no commits yet')}`);
  }

  const otherUnsynced = report.branches.locals
    .filter((branch) => !branch.current && branch.upstream && (branch.ahead || branch.behind))
    .map((branch) => `${branch.name} (ahead ${branch.ahead}, behind ${branch.behind})`);
  printList('Other unsynced branches', otherUnsynced);
  printList('Local branches without an upstream', report.branches.localOnly);
  printList('Remote branches without a tracking local branch', report.branches.remoteOnly);
  if (report.fetchWarning) console.log(`  ${colors.red('Warning:')} ${report.fetchWarning}`);
}

function createSummary(directoryCount) {
  return {
    directories: directoryCount,
    repositories: 0,
    notRepositories: 0,
    clean: 0,
    changed: 0,
    upToDate: 0,
    ahead: 0,
    behind: 0,
    diverged: 0,
    noUpstream: 0,
    detached: 0,
    fetchWarnings: 0,
  };
}

function addToSummary(summary, report) {
  summary.repositories += 1;
  const { staged, modified, untracked } = report.workTree;
  if (staged + modified + untracked) summary.changed += 1;
  else summary.clean += 1;

  if (report.fetchWarning) summary.fetchWarnings += 1;
  if (!report.current) {
    summary.detached += 1;
  } else if (!report.current.upstream) {
    summary.noUpstream += 1;
  } else if (report.current.ahead && report.current.behind) {
    summary.diverged += 1;
  } else if (report.current.ahead) {
    summary.ahead += 1;
  } else if (report.current.behind) {
    summary.behind += 1;
  } else {
    summary.upToDate += 1;
  }
}

function printSummary(summary) {
  console.log(`\n${colors.bold(colors.cyan('Overall summary'))}`);
  console.log(`  Directories checked:       ${summary.directories}`);
  console.log(`  Git repositories:          ${colors.green(summary.repositories)}`);
  console.log(`  Not Git repositories:      ${colors.dim(summary.notRepositories)}`);
  console.log(`  Clean working trees:       ${colors.green(summary.clean)}`);
  console.log(`  Working trees with changes:${colors.yellow(` ${summary.changed}`)}`);
  console.log(`  Current branches up to date: ${colors.green(summary.upToDate)}`);
  console.log(`  Current branches ahead:      ${colors.cyan(summary.ahead)}`);
  console.log(`  Current branches behind:     ${colors.blue(summary.behind)}`);
  console.log(`  Current branches diverged:   ${colors.magenta(summary.diverged)}`);
  console.log(`  Without upstream:            ${colors.yellow(summary.noUpstream)}`);
  console.log(`  Detached HEAD / no commits:  ${colors.yellow(summary.detached)}`);
  console.log(`  Fetch warnings:              ${summary.fetchWarnings ? colors.red(summary.fetchWarnings) : colors.green(0)}`);
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error('Run with --help for usage information.');
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    showHelp();
    return;
  }
  if (!fs.existsSync(options.root) || !fs.statSync(options.root).isDirectory()) {
    console.error(`Error: directory does not exist: ${options.root}`);
    process.exitCode = 2;
    return;
  }

  const gitVersion = git(options.root, ['--version']);
  if (!gitVersion.ok) {
    console.error('Error: Git is not installed or is not available on PATH.');
    process.exitCode = 2;
    return;
  }

  const directories = fs.readdirSync(options.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  console.log(colors.bold(colors.cyan('Check Git Status')));
  console.log(`${colors.dim('Root:')} ${options.root}`);
  console.log(`${colors.dim('Fetch remotes:')} ${options.fetch ? colors.green('yes') : colors.yellow('no')}`);

  const summary = createSummary(directories.length);
  for (const entry of directories) {
    const directory = path.join(options.root, entry.name);
    if (!isGitRepository(directory)) {
      console.log(`\n${colors.dim('[Not a Git repository]')} ${entry.name}`);
      summary.notRepositories += 1;
      continue;
    }
    const report = describeRepository(directory, options.fetch);
    printRepository(entry.name, report);
    addToSummary(summary, report);
  }

  printSummary(summary);
  console.log(`\n${colors.bold(colors.cyan('Done.'))}`);
}

main();
