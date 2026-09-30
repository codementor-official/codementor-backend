param(
  [string]$Ec2Host = "ec2-52-77-97-103.ap-southeast-1.compute.amazonaws.com",
  [string]$Ec2User = "ec2-user",
  [string]$IdentityFile = (Join-Path $PSScriptRoot "..\..\ec2\codementor-service.pem"),
  [int]$LocalKafkaPort = 9092
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $IdentityFile)) {
  throw "Không tìm thấy SSH key: $IdentityFile"
}

$listener = Get-NetTCPConnection -LocalPort $LocalKafkaPort -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  Write-Host "Kafka tunnel đã sẵn sàng tại localhost:$LocalKafkaPort (PID $($listener.OwningProcess), $($owner.ProcessName))."
  exit 0
}

$target = "$Ec2User@$Ec2Host"
$containerIp = (& ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $IdentityFile $target `
  "sudo docker inspect codementor-kafka --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'").Trim()

if (-not $containerIp) {
  throw "Không lấy được địa chỉ container codementor-kafka trên EC2."
}

$sshArgs = @(
  "-N",
  "-o", "BatchMode=yes",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-i", $IdentityFile,
  "-L", "127.0.0.1:${LocalKafkaPort}:${containerIp}:9092",
  $target
)

$process = Start-Process -FilePath "ssh.exe" -ArgumentList $sshArgs -WindowStyle Hidden -PassThru

for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  $listener = Get-NetTCPConnection -LocalPort $LocalKafkaPort -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    Write-Host "Kafka tunnel đã mở tại localhost:$LocalKafkaPort (PID $($process.Id))."
    exit 0
  }
  if ($process.HasExited) {
    throw "SSH tunnel thoát sớm với exit code $($process.ExitCode)."
  }
}

Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
throw "SSH tunnel không mở được cổng localhost:$LocalKafkaPort."
