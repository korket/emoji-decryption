from __future__ import annotations

import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from collections.abc import Callable
from pathlib import Path
from tkinter import messagebox, ttk
import tkinter as tk


ROOT = Path(__file__).resolve().parent
OVERLAY_DIR = ROOT / 'overlay'
BACKEND_URL = 'http://127.0.0.1:3000'
OVERLAY_URL = 'http://127.0.0.1:5173'
GOOGLE_QUOTA_URL = 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas'
LOG_MAX_LINES = 5000

ANSI_RE = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
IS_WINDOWS = sys.platform == 'win32'
CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)


def npm_executable() -> str:
    return shutil.which('npm.cmd') or shutil.which('npm') or 'npm'


def clean_log_line(line: str) -> str:
    return ANSI_RE.sub('', line.rstrip('\r\n'))


class ManagedProcess:
    def __init__(
        self,
        name: str,
        command: list[str],
        cwd: Path,
        log: Callable[[str, str], None],
    ) -> None:
        self.name = name
        self.command = command
        self.cwd = cwd
        self.log = log
        self.process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()

    def is_running(self) -> bool:
        with self._lock:
            return self.process is not None and self.process.poll() is None

    def start(self) -> None:
        with self._lock:
            if self.process is not None and self.process.poll() is None:
                self.log(self.name, f'{self.name} is already running.')
                return

            flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP if IS_WINDOWS else 0
            self.log(self.name, f'Starting: {" ".join(self.command)}')
            try:
                self.process = subprocess.Popen(
                    self.command,
                    cwd=str(self.cwd),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    errors='replace',
                    bufsize=1,
                    creationflags=flags,
                    start_new_session=not IS_WINDOWS,
                )
            except OSError as err:
                self.process = None
                self.log(self.name, f'Failed to start {self.name}: {err}')
                return
            threading.Thread(target=self._read_output, daemon=True).start()

    def stop(self) -> None:
        with self._lock:
            proc = self.process
        if proc is None or proc.poll() is not None:
            self.log(self.name, f'{self.name} is not running.')
            return

        self.log(self.name, f'Stopping process tree pid={proc.pid}...')
        if IS_WINDOWS:
            subprocess.run(
                ['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=CREATE_NO_WINDOW,
                check=False,
            )
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.log(self.name, f'{self.name} did not exit within 5 seconds after taskkill.')
        else:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)

    def restart(self) -> None:
        self.stop()
        time.sleep(0.5)
        self.start()

    def _read_output(self) -> None:
        with self._lock:
            proc = self.process
        if proc is None or proc.stdout is None:
            return

        for line in proc.stdout:
            cleaned = clean_log_line(line)
            if cleaned:
                self.log(self.name, cleaned)

        code = proc.wait()
        self.log(self.name, f'{self.name} exited with code {code}.')


class ApiError(Exception):
    pass


def api_request(method: str, path: str, timeout: int = 10) -> dict:
    data = b'{}' if method != 'GET' else None
    headers = {'Content-Type': 'application/json'} if data is not None else {}
    req = urllib.request.Request(
        f'{BACKEND_URL}{path}',
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode('utf-8')
    except urllib.error.HTTPError as err:
        body = err.read().decode('utf-8', errors='replace')
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {'error': body or err.reason}
        raise ApiError(format_api_error(parsed)) from err
    except urllib.error.URLError as err:
        raise ApiError(f'Backend is not reachable: {err.reason}') from err
    except TimeoutError as err:
        raise ApiError('Request timed out waiting for the backend.') from err

    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {}


def format_api_error(payload: object) -> str:
    if isinstance(payload, dict):
        for key in ('error', 'message'):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return str(payload)


class ControlGui:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title('Emoguessr Control')
        self.root.geometry('1000x720')
        self.root.minsize(820, 560)

        npm = npm_executable()
        self.backend = ManagedProcess('Backend', [npm, 'run', 'dev'], ROOT, self.log)
        self.overlay = ManagedProcess('Overlay', [npm, 'run', 'dev'], OVERLAY_DIR, self.log)
        self.log_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self.text_widgets: dict[str, tk.Text] = {}
        self.buttons: dict[str, ttk.Button] = {}
        self.backend_online = False
        self.game_active = False

        self.backend_status = tk.StringVar(value='Backend: unknown')
        self.game_status = tk.StringVar(value='Game: unknown')
        self.overlay_status = tk.StringVar(value='Overlay: stopped')
        self.youtube_status = tk.StringVar(value='YouTube: unknown')
        self.api_usage_status = tk.StringVar(value='API usage today: unknown')
        self.urls_status = tk.StringVar(value=f'Backend: {BACKEND_URL}    Overlay: {OVERLAY_URL}')
        self.last_status = tk.StringVar(value='Last check: never')
        self.status_after_id: str | None = None

        self._build_ui()
        self.root.protocol('WM_DELETE_WINDOW', self.on_close)
        self.root.after(100, self.drain_logs)
        self.root.after(300, self.refresh_status_async)
        self.root.after(1000, self.update_process_labels)

    def _build_ui(self) -> None:
        style = ttk.Style(self.root)
        style.configure('StatusGreen.TLabel', foreground='#15803d')
        style.configure('StatusAmber.TLabel', foreground='#b45309')
        style.configure('StatusRed.TLabel', foreground='#b91c1c')
        style.configure('StatusGray.TLabel', foreground='#475569')

        outer = ttk.Frame(self.root, padding=10)
        outer.pack(fill='both', expand=True)

        status = ttk.LabelFrame(outer, text='Status', padding=8)
        status.pack(fill='x')

        self.backend_label = ttk.Label(status, textvariable=self.backend_status, style='StatusGray.TLabel')
        self.game_label = ttk.Label(status, textvariable=self.game_status, style='StatusGray.TLabel')
        self.overlay_label = ttk.Label(status, textvariable=self.overlay_status, style='StatusGray.TLabel')
        self.youtube_label = ttk.Label(status, textvariable=self.youtube_status, style='StatusGray.TLabel')
        self.backend_label.grid(row=0, column=0, sticky='w', padx=(0, 24))
        self.game_label.grid(row=0, column=1, sticky='w', padx=(0, 24))
        self.overlay_label.grid(row=0, column=2, sticky='w', padx=(0, 24))
        ttk.Label(status, textvariable=self.last_status).grid(row=0, column=3, sticky='w')
        self.youtube_label.grid(row=1, column=0, columnspan=4, sticky='w', pady=(6, 0))
        ttk.Label(status, textvariable=self.api_usage_status).grid(row=2, column=0, columnspan=4, sticky='w', pady=(6, 0))
        ttk.Label(status, textvariable=self.urls_status).grid(row=3, column=0, columnspan=4, sticky='w', pady=(6, 0))
        status.columnconfigure(3, weight=1)

        controls = ttk.LabelFrame(outer, text='Controls', padding=8)
        controls.pack(fill='x', pady=(10, 10))

        buttons = [
            ('Restart Backend', self.restart_backend),
            ('Stop Backend', self.stop_backend),
            ('Start Overlay', self.start_overlay),
            ('Stop Overlay', self.stop_overlay),
            ('Start Game', self.start_game),
            ('Stop Game', self.stop_game),
            ('Check YouTube', self.check_youtube),
            ('Open Overlay', self.open_overlay),
            ('Open Quota Page', self.open_quota_page),
            ('Copy Logs', self.copy_logs),
            ('Refresh Status', self.refresh_status_async),
        ]
        for i, (label, command) in enumerate(buttons):
            button = ttk.Button(controls, text=label, command=command)
            self.buttons[label] = button
            button.grid(row=i // 5, column=i % 5, sticky='ew', padx=4, pady=4)
            controls.columnconfigure(i % 5, weight=1)

        notebook = ttk.Notebook(outer)
        notebook.pack(fill='both', expand=True)
        for name in ('Backend', 'Overlay', 'Control'):
            frame = ttk.Frame(notebook)
            text = tk.Text(frame, wrap='word', height=12, bg='#101018', fg='#e6edf3', insertbackground='#e6edf3')
            scroll = ttk.Scrollbar(frame, orient='vertical', command=text.yview)
            text.configure(yscrollcommand=scroll.set)
            text.pack(side='left', fill='both', expand=True)
            scroll.pack(side='right', fill='y')
            self.text_widgets[name] = text
            notebook.add(frame, text=name)
        self.notebook = notebook
        self.update_buttons()

    def run_async(self, func: Callable[[], None]) -> None:
        threading.Thread(target=func, daemon=True).start()

    def log(self, tab: str, message: str) -> None:
        timestamp = time.strftime('%H:%M:%S')
        self.log_queue.put((tab, f'[{timestamp}] {message}'))

    def drain_logs(self) -> None:
        while True:
            try:
                tab, message = self.log_queue.get_nowait()
            except queue.Empty:
                break
            text = self.text_widgets.get(tab) or self.text_widgets['Control']
            text.insert('end', message + '\n')
            self.trim_log(text)
            text.see('end')
        self.root.after(100, self.drain_logs)

    def trim_log(self, text: tk.Text) -> None:
        line_count = int(text.index('end-1c').split('.')[0])
        if line_count > LOG_MAX_LINES:
            text.delete('1.0', f'{line_count - LOG_MAX_LINES}.0')

    def update_process_labels(self) -> None:
        overlay_state = 'running' if self.overlay.is_running() else 'stopped'
        self.overlay_status.set(f'Overlay: {overlay_state}')
        self.overlay_label.configure(style='StatusGreen.TLabel' if self.overlay.is_running() else 'StatusGray.TLabel')
        self.update_buttons()
        self.root.after(1000, self.update_process_labels)

    def update_buttons(self) -> None:
        backend_managed = self.backend.is_running()
        overlay_running = self.overlay.is_running()
        backend_external = self.backend_online and not backend_managed

        self.set_button('Restart Backend', not backend_external)
        self.set_button('Stop Backend', backend_managed)
        self.set_button('Start Overlay', not overlay_running)
        self.set_button('Stop Overlay', overlay_running)
        self.set_button('Start Game', self.backend_online and not self.game_active)
        self.set_button('Stop Game', self.backend_online and self.game_active)
        self.set_button('Check YouTube', self.backend_online)

    def set_button(self, label: str, enabled: bool) -> None:
        button = self.buttons.get(label)
        if button is not None:
            button.configure(state='normal' if enabled else 'disabled')

    def restart_backend(self) -> None:
        self.run_async(lambda: self.backend.restart())

    def stop_backend(self) -> None:
        self.run_async(lambda: self.backend.stop())

    def start_overlay(self) -> None:
        self.run_async(lambda: self.overlay.start())

    def stop_overlay(self) -> None:
        self.run_async(lambda: self.overlay.stop())

    def start_game(self) -> None:
        self.run_async(self._start_game)

    def _start_game(self) -> None:
        self.log('Control', 'Requesting game start...')
        try:
            result = api_request('POST', '/game/start', timeout=300)
        except ApiError as err:
            message = str(err)
            self.log('Control', f'Game start failed: {message}')
            self.root.after(0, lambda message=message: messagebox.showerror('Start Game Failed', message))
            return
        self.log('Control', json.dumps(result, indent=2))
        self.refresh_status_async()

    def stop_game(self) -> None:
        self.run_async(self._stop_game)

    def _stop_game(self) -> None:
        self.log('Control', 'Requesting game stop...')
        try:
            result = api_request('POST', '/game/stop', timeout=60)
        except ApiError as err:
            message = str(err)
            self.log('Control', f'Game stop failed: {message}')
            self.root.after(0, lambda message=message: messagebox.showerror('Stop Game Failed', message))
            return
        self.log('Control', json.dumps(result, indent=2))
        self.refresh_status_async()

    def check_youtube(self) -> None:
        self.run_async(self._check_youtube)

    def _check_youtube(self) -> None:
        self.log('Control', 'Checking YouTube API status...')
        try:
            result = api_request('POST', '/youtube/check', timeout=60)
        except ApiError as err:
            message = str(err)
            self.log('Control', f'YouTube check failed: {message}')
            self.root.after(0, lambda message=message: messagebox.showerror('YouTube Check Failed', message))
            return
        self.log('Control', json.dumps(result, indent=2))
        self.refresh_status_async()

    def open_overlay(self) -> None:
        webbrowser.open(OVERLAY_URL)
        self.log('Control', f'Opened {OVERLAY_URL}')

    def open_quota_page(self) -> None:
        webbrowser.open(GOOGLE_QUOTA_URL)
        self.log('Control', f'Opened {GOOGLE_QUOTA_URL}')

    def copy_logs(self) -> None:
        parts = []
        for name, text in self.text_widgets.items():
            parts.append(f'===== {name} =====')
            parts.append(text.get('1.0', 'end-1c'))
        self.root.clipboard_clear()
        self.root.clipboard_append('\n'.join(parts))
        self.log('Control', 'Copied all logs to clipboard.')

    def refresh_status_async(self) -> None:
        if self.status_after_id is not None:
            self.root.after_cancel(self.status_after_id)
            self.status_after_id = None
        self.run_async(self._refresh_status)

    def _refresh_status(self) -> None:
        try:
            result = api_request('GET', '/health', timeout=2)
        except ApiError as err:
            message = str(err)
            self.root.after(0, lambda message=message: self.set_offline_status(message))
            return

        self.root.after(0, lambda: self.set_online_status(result))

    def schedule_status_refresh(self, delay_ms: int = 2500) -> None:
        if self.status_after_id is not None:
            self.root.after_cancel(self.status_after_id)
        self.status_after_id = self.root.after(delay_ms, self.refresh_status_async)

    def set_offline_status(self, error: str) -> None:
        self.backend_online = False
        self.game_active = False
        self.backend_status.set('Backend: offline')
        self.game_status.set('Game: unavailable')
        self.youtube_status.set('YouTube: unavailable')
        self.api_usage_status.set('API usage today: unavailable')
        self.last_status.set(f'Last check: {time.strftime("%H:%M:%S")} ({error})')
        self.backend_label.configure(style='StatusRed.TLabel')
        self.game_label.configure(style='StatusRed.TLabel')
        self.youtube_label.configure(style='StatusRed.TLabel')
        self.update_buttons()
        self.schedule_status_refresh()

    def set_online_status(self, result: dict) -> None:
        active = bool(result.get('active'))
        self.backend_online = True
        self.game_active = active
        round_number = result.get('round', 0)
        restart_scheduled = bool(result.get('restartScheduled'))
        game_state = 'running' if active else 'idle'
        if restart_scheduled:
            game_state = 'session restart scheduled'
        backend_owner = 'managed' if self.backend.is_running() else 'external'
        self.backend_status.set(f'Backend: online ({backend_owner}, {result.get("uptime", 0)}s)')
        self.game_status.set(f'Game: {game_state}, round {round_number}')
        youtube = result.get('youtube')
        self.youtube_status.set(self.format_youtube_status(youtube))
        self.api_usage_status.set(self.format_api_usage(result.get('apiUsage')))
        self.last_status.set(f'Last check: {time.strftime("%H:%M:%S")}')
        self.backend_label.configure(style='StatusGreen.TLabel')
        self.game_label.configure(style='StatusGreen.TLabel' if active else 'StatusAmber.TLabel')
        self.youtube_label.configure(style=self.youtube_style(youtube))
        self.update_buttons()
        self.schedule_status_refresh()

    def youtube_style(self, youtube: object) -> str:
        if not isinstance(youtube, dict):
            return 'StatusGray.TLabel'
        state = youtube.get('state')
        if state in ('connected', 'ready'):
            return 'StatusGreen.TLabel'
        if state in ('checking', 'starting', 'retrying', 'idle', 'stopped', 'no_active_broadcast'):
            return 'StatusAmber.TLabel'
        return 'StatusRed.TLabel'

    def format_youtube_status(self, youtube: object) -> str:
        if not isinstance(youtube, dict):
            return 'YouTube: unknown'
        state = str(youtube.get('state', 'unknown'))
        message = str(youtube.get('message', '')).strip()
        http_status = youtube.get('httpStatus')
        reason = youtube.get('reason')
        suffix_parts = []
        if http_status is not None:
            suffix_parts.append(f'HTTP {http_status}')
        if reason is not None:
            suffix_parts.append(str(reason))
        estimated = youtube.get('estimatedQuotaUnits')
        if estimated is not None:
            suffix_parts.append(f'est. {estimated} units this backend run')
        last_delay = youtube.get('lastPollDelayMs')
        if isinstance(last_delay, int):
            suffix_parts.append(f'poll {last_delay // 1000}s')
        suffix = f' ({", ".join(suffix_parts)})' if suffix_parts else ''
        return f'YouTube: {state} - {message}{suffix}' if message else f'YouTube: {state}{suffix}'

    def format_api_usage(self, usage: object) -> str:
        if not isinstance(usage, dict):
            return 'API usage today: unknown'
        total = usage.get('totalUnits', 0)
        calls = usage.get('calls', 0)
        return f'API usage today: est. {total} units across {calls} calls'

    def on_close(self) -> None:
        running = self.backend.is_running() or self.overlay.is_running()
        if running:
            stop = messagebox.askyesnocancel(
                'Exit Emoguessr Control',
                'Stop backend/overlay processes started by this GUI before exiting?',
            )
            if stop is None:
                return
            if stop:
                self.backend.stop()
                self.overlay.stop()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    ControlGui(root)
    root.mainloop()


if __name__ == '__main__':
    main()
