const REPO_ROOT = path self ..

def --wrapped run-checked [command: string, ...args: string] {
    ^$command ...$args
    if $env.LAST_EXIT_CODE != 0 {
        error make {msg: $"($command) ($args | str join ' ') failed with exit code ($env.LAST_EXIT_CODE)"}
    }
}

export def --env build-terminal-browser [
    --bin-dir: path = ~/.local/bin
] {
    let bin = ($bin_dir | path expand)
    let launcher = ($bin | path join terminal-browser)
    let entrypoint = ($REPO_ROOT | path join cli dist main.js)
    if ($launcher | path type) == dir {
        error make {msg: $"Cannot replace directory ($launcher) with a launcher"}
    }
    do {
        cd $REPO_ROOT
        run-checked pnpm install --frozen-lockfile
        run-checked pnpm --filter @zenbu-labs/pixel build
        run-checked pnpm --filter @zenbu-labs/pixel build:native -- --release
        run-checked pnpm -r --filter '!./pixel/**' build
        run-checked node $entrypoint --version
        run-checked chmod u+x $entrypoint
    }
    mkdir $bin
    run-checked ln -sfn $entrypoint $launcher
    $env.PATH = ($env.PATH | prepend $bin | uniq | collect)
    print $"Built ($REPO_ROOT) and installed ($launcher)"
}
