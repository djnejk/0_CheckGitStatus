# Check Git Status

A small, dependency-free Node.js command-line tool that checks every immediate
subdirectory in a folder and reports its Git status. It is useful when you keep
many repositories next to each other and want one quick overview.

For each directory, the checker reports:

- whether it is a Git repository;
- staged, modified, and untracked files;
- whether the current branch is up to date, ahead, behind, or diverged;
- other local branches that are ahead or behind their upstream;
- local branches without an upstream;
- remote branches without a tracking local branch; and
- fetch failures, without stopping the rest of the scan.

The interactive console output is color-coded for quick scanning. Colors are
automatically disabled when output is redirected. Set the standard `NO_COLOR`
environment variable to disable them manually.

By default, the tool runs `git fetch --all --prune` in every repository before
checking it. Fetching updates remote-tracking references only; it does not merge,
pull, switch branches, or modify working files.

## Requirements

- Windows (for `check.bat`) or any operating system with Node.js
- Node.js 18 or newer
- Git available on `PATH`

No `npm install` is needed.

## Usage

Put this project next to the repositories you want to inspect:

```text
projects/
├── 0_CheckGitStatus/
├── repository-one/
├── repository-two/
└── ordinary-folder/
```

On Windows, run:

```bat
check.bat
```

The batch launcher shows an overall summary and waits for a key press when the
scan finishes, so its window does not close immediately. Running the Node.js
file directly does not pause, which makes it suitable for scripts and CI.

The default scan root is the parent directory of this project. You can scan a
different location or skip network access:

```bat
check.bat --root "C:\path\to\projects"
check.bat --no-fetch
```

The script can also be run directly on any platform:

```sh
node check-git-status.js --root /path/to/projects
```

Run `check.bat --help` for the complete command reference.

## Understanding the output

- **up to date**: the branch matches its configured upstream.
- **local commits to push**: the local branch is ahead of its upstream.
- **remote commits to pull**: the local branch is behind its upstream.
- **diverged**: both local and remote contain commits the other side lacks.
- **local branch without an upstream**: the branch has no tracking relationship.
- **remote branch without a tracking local branch**: no local branch is configured
  to track that remote branch. This can indicate a newly published branch, but it
  may also be intentional.

## Exit codes

- `0`: the scan completed (individual fetch failures are shown as warnings).
- `2`: invalid arguments, missing scan directory, or Git is unavailable.

## License

This project is licensed under the [MIT License](LICENSE).
