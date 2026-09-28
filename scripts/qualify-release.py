"""Exercise real signed updater installation in a disposable directory on CI.
This verifies artifact/signature/install/launch integration, not interactive UI.
"""
import argparse, contextlib, functools, hashlib, http.server, json, os, pathlib
import shutil, subprocess, sys, threading, time, urllib.request

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--installer', choices=['nsis','msi','appimage'], default='nsis')
p.add_argument('--assets', type=pathlib.Path, required=True)
p.add_argument('--previous', type=pathlib.Path, required=True)
p.add_argument('--probe', type=pathlib.Path, required=True)
p.add_argument('--output', type=pathlib.Path, required=True)
a = p.parse_args()
a.assets = a.assets.resolve(); a.previous = a.previous.resolve(); a.probe = a.probe.resolve()
a.output.mkdir(parents=True, exist_ok=False); a.output = a.output.resolve()
(a.output/'ALLOW_DISPOSABLE_UPDATE').touch()
windows = sys.platform == 'win32'
assert windows or sys.platform == 'linux', 'Hosted probe currently supports Windows and Linux'
target = 'windows-x86_64-'+a.installer if windows else 'linux-x86_64'
pattern = ('*.msi' if a.installer=='msi' else '*-setup.exe') if windows else '*.AppImage'
old, = a.previous.glob(pattern)
new, = a.assets.glob(pattern)
install = a.output/'installed'; install.mkdir()
if windows:
    if a.installer=='msi':
        result=subprocess.run(['msiexec','/i',str(old),'/qn','/norestart','INSTALLDIR='+str(install),'/L*v',str(a.output/'initial-msi.log')],timeout=240)
        assert result.returncode in (0,3010), f'MSI install failed: {result.returncode}'
    else:
        subprocess.run([str(old), '/S', '/D='+str(install)], check=True, timeout=180)
    executables = list(install.glob('*.exe'))
    exe, = [x for x in executables if 'uninstall' not in x.name.lower()]
else:
    exe = install/'EmberBridge.AppImage'; shutil.copy2(old, exe); exe.chmod(0o755)

# The feed uses the actual draft's signature and bytes, served on loopback solely
# because private draft asset downloads require authentication.
feed = json.loads((a.assets/'latest.json').read_text())
entry = feed['platforms'][target].copy()
assert pathlib.PurePosixPath(entry['url']).name == new.name, 'Wrong updater asset'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(Quiet,directory=str(a.assets)))
port = server.server_address[1]
entry['url'] = f'http://127.0.0.1:{port}/{new.name}'
feed['platforms'] = {target:entry}
(a.assets/'qualification-feed.json').write_text(json.dumps(feed))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    subprocess.run([str(a.probe)]+[target,str(exe),f'http://127.0.0.1:{port}/qualification-feed.json','0.4.2',str(a.output)],check=True,timeout=240)
    assert (a.output/'signature-verified.json').is_file()
    if windows:
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            script=f"(Get-Item -LiteralPath '{str(exe).replace(chr(39),chr(39)*2)}').VersionInfo.ProductVersion"
            version=subprocess.check_output(['powershell','-NoProfile','-Command',script],text=True).strip()
            if version.startswith(feed['version']): break
            time.sleep(2)
        else: raise AssertionError('Installed executable version did not change')
    else:
        assert hashlib.sha256(exe.read_bytes()).digest()==hashlib.sha256(new.read_bytes()).digest()
    env=dict(os.environ, APPIMAGE_EXTRACT_AND_RUN='1')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    # An unrelated process must never satisfy the launch check.
    try: opener.open('http://127.0.0.1:17831/api/health',timeout=1)
    except OSError: pass
    else: raise AssertionError('Bridge port already in use before test launch')
    with (a.output/'app.log').open('wb') as log:
        process=subprocess.Popen([str(exe)],env=env,stdout=log,stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+90
            while time.monotonic()<deadline:
                if process.poll() is not None: raise AssertionError('Updated app exited before becoming healthy')
                try:
                    with opener.open('http://127.0.0.1:17831/api/health',timeout=2) as response: health=json.load(response)
                    assert health['version']==feed['version'], health
                    (a.output/'launch-health.json').write_text(json.dumps(health,indent=2));break
                except OSError: time.sleep(1)
            else: raise AssertionError('Updated app did not become healthy')
        finally:
            if process.poll() is None: process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired: process.kill();process.wait()
    print(f'{target}: signed update 0.4.2 -> {feed["version"]}, installation and launch passed')
finally: server.shutdown()
