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
$pgPort = 5433
$postgresIniciadoAqui = $false
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = "$pgPort"
$env:DB_NAME = 'geocarga_db'
$env:DB_USER = 'postgres'
$env:DEMO_PASSWORD = 'GeoCargaDemo2026!'
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$node = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $node)) {
    throw "No se encontro Node.js en $node"
}

$env:PATH = (Split-Path $node) + ";" + $env:PATH
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
    $postgresIniciadoAqui = $true
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

    # GEOCARGA_ORDEN_RADAR_V1
    $env:GEOCARGA_USAR_RADAR_DEMO = "0"
    $env:DEMO_RADAR_PORT = "8001"
    $env:RADAR_URL = "http://127.0.0.1:8000"
    $radar = Start-DemoService 'radar-demo.js' $env:DEMO_RADAR_PORT '/api/aviones'
    $env:PORT = "3000"
    $web = Start-DemoService 'server.js' $env:PORT '/api/radar/aviones'
    $url = "http://127.0.0.1:$env:PORT"
    Write-Host "GeoCarga demo: $url"
    Write-Host 'Usuario: admin@geocarga.com  Clave: GeoCargaDemo2026!'
    Start-Process $url
    # GEOCARGA_INICIO_COMPLETO_V1
    $python = "C:\GeoCarga\radar\.venv\Scripts\python.exe"

    if (-not (Test-Path $python)) {
        throw "No se encontro Python del radar."
    }

    $env:GEOCARGA_USAR_RADAR_DEMO = "0"

    $visorExistente = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue

    if (-not $visorExistente) {
        $visor = Start-Process $python `
            -ArgumentList "-m uvicorn radar.main:app --host 127.0.0.1 --port 8000" `
            -WorkingDirectory $root `
            -PassThru

        Write-Host "Visor radar iniciado en puerto 8000."
    }

    $simuladorArchivo = Join-Path $root "simulador\simulador_geocarga_suramerica.py"

    # GEOCARGA_SIMULADOR_UNICO_V1
    $simuladoresActivos = @(
        Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "python.exe" -and
            $_.CommandLine -like "*simulador_geocarga_suramerica.py*"
        }
    )

    if ($simuladoresActivos.Count -gt 0) {
        Write-Host "Simulador existente detectado. No se inicia otro."
        $simulador = $null
    }
    else {
        $simulador = Start-Process $python `
            -ArgumentList "`"$simuladorArchivo`"" `
            -WorkingDirectory $root `
            -PassThru

        Write-Host "Simulador de aeronaves iniciado."
    }

    Read-Host 'Pulsa Enter para detener la demo'
} finally {
    # GEOCARGA_CIERRE_CONTROLADO_V3
    Write-Host "Cerrando servicios iniciados por este lanzador..." -ForegroundColor Yellow

    foreach ($proceso in @($simulador, $visor, $web, $radar)) {
        if ($null -ne $proceso) {
            $actual = Get-CimInstance Win32_Process -Filter "ProcessId = $($proceso.Id)" -ErrorAction SilentlyContinue

            if ($actual) {
                & taskkill.exe /PID $proceso.Id /T /F 2>$null
            }
        }
    }

    if ($postgresIniciadoAqui) {
        & "$bin/pg_ctl.exe" -D $data -m fast -w stop
    }

    Write-Host "Cierre finalizado." -ForegroundColor Green
}