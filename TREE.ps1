function Show-Tree {
    param(
        [string]$Path = ".",
        [string]$Prefix = "",
        [int]$Depth = 0,
        [bool]$IsLast = $true
    )

    # Box-drawing chars built from code points to avoid encoding issues
    $VBar  = [char]0x2502  # |
    $TBar  = [char]0x251C  # |-
    $LBar  = [char]0x2514  # L-
    $HDash = [string]([char]0x2500) + [char]0x2500  # --

    $branchConn  = "$TBar$HDash "   # +-
    $lastConn    = "$LBar$HDash "   # L-
    $branchPad   = "$VBar   "       # |
    $lastPad     = "    "           #

    # ── Folders to skip ───────────────────────────────────────────────────────
    $excludedFolderPatterns = @(
        'node_modules', 'jspm_packages', 'web_modules',
        'cache', 'downloads', 'bin',
        '.git', '.svn',
        'dist', 'out', '.next', '.nuxt', '.output',
        '.cache', '.parcel-cache',
        'coverage', '.nyc_output', 'lib-cov',
        'build',
        '.grunt', 'bower_components',
        '.npm', '.vite',
        '.vuepress', '.temp', '.svelte-kit',
        '.docusaurus', '.serverless', '.fusebox',
        '.dynamodb', '.firebase',
        '.vscode-test',
        'pids', 'logs',
        'samples',
        '.claude',
        '.tmp*'           # <-- wildcard, covers .tmp, .tmp123, etc.
    )

    # ── File patterns to skip ─────────────────────────────────────────────────
    $excludedFilePatterns = @(
        '*.log',
        'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*', 'lerna-debug.log*',
        'report.[0-9]*.[0-9]*.[0-9]*.[0-9]*.json',
        '*.pid', '*.seed', '*.pid.lock',
        '*.lcov',
        '.lock-wscript',
        '*.tsbuildinfo',
        '.node_repl_history',
        '*.tgz',
        '.yarn-integrity',
        '.env', '.env.*',
        '.eslintcache', '.stylelintcache',
        'vite.config.js.timestamp-*', 'vite.config.ts.timestamp-*',
        '.tmp.*',
        '.pnp.*'
    )

    # Gitignore negations — always keep these
    $allowedFiles = @('.env.example')

    function Test-ExcludedFile {
        param([string]$Name)
        if ($allowedFiles -contains $Name) { return $false }
        foreach ($pattern in $excludedFilePatterns) {
            if ($Name -like $pattern) { return $true }
        }
        return $false
    }

    # ── Print root on first call ──────────────────────────────────────────────
    if ($Depth -eq 0) {
        Write-Host (Resolve-Path $Path).Path
    }

    # ── Gather and filter children ────────────────────────────────────────────
    $items = Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue |
        Where-Object {
            if ($_.PSIsContainer) {
                $excluded = $false
                foreach ($pattern in $excludedFolderPatterns) {
                    if ($_.Name -like $pattern) { $excluded = $true; break }
                }
                -not $excluded
            } else {
                -not (Test-ExcludedFile $_.Name)
            }
        } |
        Sort-Object @(
            @{ Expression = { -not $_.PSIsContainer } },  # folders first
            @{ Expression = 'Name' }
        )

    # ── Recurse ───────────────────────────────────────────────────────────────
    for ($i = 0; $i -lt $items.Count; $i++) {
        $item   = $items[$i]
        $isLast = ($i -eq $items.Count - 1)
        $conn   = if ($isLast) { $lastConn } else { $branchConn }

        Write-Host "$Prefix$conn$($item.Name)"

        if ($item.PSIsContainer) {
            $childPfx = if ($isLast) { "$Prefix$lastPad" } else { "$Prefix$branchPad" }
            Show-Tree -Path $item.FullName -Prefix $childPfx -Depth ($Depth + 1) -IsLast $isLast
        }
    }
}

Show-Tree