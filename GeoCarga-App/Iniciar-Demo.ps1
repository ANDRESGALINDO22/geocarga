$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pg = Get-ChildItem "$env:ProgramFiles/PostgreSQL" -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $pg) { throw 'Instala PostgreSQL para iniciar la demo.' }
$bin = Join-Path $pg.FullName 'bin'
$runtime = Join-Path $root '.demo-local'
New-Item -ItemType Directory -Force $runtime | Out-Null
$data = Join-Path $runtime 'postgres'
function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return $listener.LocalEndpoint.Port
    } finally {
        $listener.Stop()
    }
}
$pgPort = Get-FreeLoopbackPort
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = "$pgPort"
$env:DB_NAME = 'geocarga_db'
$env:DB_USER = 'postgres'
$env:DEMO_PASSWORD = 'GeoCargaDemo2026!'
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$node = (Get-Command node).Source
$backend = Join-Path $root 'backend'
if (Test-Path 'C:/GeoCarga/backend/node_modules/express/package.json') {
    $env:NODE_PATH = 'C:/GeoCarga/backend/node_modules'
} elseif (-not (Test-Path "$backend/node_modules/express/package.json")) {
    Push-Location $backend
    try { npm.cmd ci; if ($LASTEXITCODE) { throw 'No se pudieron instalar las dependencias.' } }
    finally { Pop-Location }
}
if (-not (Test-Path "$data/global/pg_control")) {
    & "$bin/initdb.exe" -D $data -U postgres -A trust -E UTF8 --no-locale
    if ($LASTEXITCODE) { throw 'No se pudo inicializar PostgreSQL.' }
}
& "$bin/pg_ctl.exe" -D $data status *> $null
if ($LASTEXITCODE -eq 0) {
    $pgPort = [int](Get-Content "$data/postmaster.pid" -TotalCount 4)[3]
} else {
    & "$bin/pg_ctl.exe" -D $data -l "$runtime/postgres.log" -o "-h 127.0.0.1 -p $pgPort" -w start
    if ($LASTEXITCODE) {
        Get-Content "$runtime/postgres.log" -Tail 12
        throw 'No se pudo iniciar PostgreSQL.'
    }
}
$env:DB_PORT = "$pgPort"
Write-Host "PostgreSQL de la demo listo en el puerto $pgPort." 
$exists = & "$bin/psql.exe" -h 127.0.0.1 -p $pgPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'geocarga_db'"
if ($LASTEXITCODE) { throw 'No se pudo conectar a PostgreSQL.' }
if ($exists -ne '1') {
    & "$bin/createdb.exe" -h 127.0.0.1 -p $pgPort -U postgres geocarga_db
    if ($LASTEXITCODE) { throw 'No se pudo crear geocarga_db.' }
}
$radar = $null
$web = $null
try {
    & $node "$backend/preparar-demo.js"
    if ($LASTEXITCODE) { throw 'No se pudieron cargar los datos de la demo.' }
    function Start-DemoService($script, $port, $route) {
        $log = Join-Path $runtime "$script.error.log"
        $stdout = Join-Path $runtime "$script.log"
        $child = Start-Process $node -ArgumentList $script -WorkingDirectory $backend -WindowStyle Hidden -RedirectStandardError $log -RedirectStandardOutput $stdout -PassThru
        try {
            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                if ($child.HasExited) { break }
                try {
                    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:${port}$route"
                    if ($response.StatusCode -eq 200 -and !$child.HasExited) { return $child }
                } catch {}
                Start-Sleep -Milliseconds 250
            }
            Get-Content $log -Tail 20 | Write-Host
            throw "No se pudo iniciar $script. Registro: $log"
        } catch {
            if (!$child.HasExited) { Stop-Process -Id $child.Id }
            throw
        }
    }

    $env:DEMO_RADAR_PORT = "$(Get-FreeLoopbackPort)"
    $env:RADAR_URL = "http://127.0.0.1:$env:DEMO_RADAR_PORT"
    $radar = Start-DemoService 'radar-demo.js' $env:DEMO_RADAR_PORT '/api/aviones'
    $env:PORT = "$(Get-FreeLoopbackPort)"
    $web = Start-DemoService 'server.js' $env:PORT '/api/radar/aviones'
    $url = "http://127.0.0.1:$env:PORT"
    Write-Host "GeoCarga demo: $url"
    Write-Host 'Usuario: admin@geocarga.com  Clave: GeoCargaDemo2026!'
    Start-Process $url
    Read-Host 'Pulsa Enter para detener la demo'
} finally {
    if ($web -and !$web.HasExited) { Stop-Process -Id $web.Id }
    if ($radar -and !$radar.HasExited) { Stop-Process -Id $radar.Id }
    & "$bin/pg_ctl.exe" -D $data -w stop
}
