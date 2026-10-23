// Optional: checks the persistent PowerShell runner against a real PowerShell. Run: VITALS_PWSH=/path/to/pwsh node test/ps-runner.js
const { PowerShell } = require('../src/sys/run.js');
const cases = [
  ['multi', "if ($true) {\n  $x = 5\n  \"multi $x\"\n}"],
  ['empty', "ConvertTo-Json -Depth 4 -Compress -InputObject @(& { @() })"],
  ['throw', "throw 'bad'"],
  ['sleep-timeout', "Start-Sleep -Seconds 5; 'late'", 1500],
  ['after', "'recovered'"],
  ['big', "1..400 | ForEach-Object { [pscustomobject]@{ Id = $_; Name = ('proc ' + $_) } } | ConvertTo-Json -Compress"],
];
(async () => {
  const sh = new PowerShell('t');
  for (const [n, cmd, to] of cases) {
    const t = Date.now(); const r = await sh.exec(cmd, { timeout: to || 8000 });
    console.log(n, Date.now() - t, r.ok, JSON.stringify(r.stdout.slice(0, 80)), r.error || '', r.stdout.length);
  }
  sh.stop();
})();
