# Screenshots of a real session: runs `claude` (haiku) in a pseudo-terminal of a given size, opens /office, asks for a
# busy turn (a Read and `sleep 8 && echo hi` at once), and saves PNG + text screens via pyte.
#   python3 -m venv <scratch>/venv && <scratch>/venv/bin/pip install pyte pillow
#   <scratch>/venv/bin/python pixel-office/tools/shots.py COLS ROWS fullscreen|classic OUT_PREFIX FOLDER
# FOLDER: a scratch folder with a notes.txt (the session runs there). Each run is a short real haiku turn (it costs a little).
# OLD_DIR=<a copy of pixel-office> loads that copy instead (to compare with the code before a change).
# OPENING=1 also shoots the office opening (a new session), 1, 3, 6 and 10 s after the picture first shows.
# The folder-trust prompt defaults to "No, exit": the script picks "Yes" (down, Enter).
import os, pty, sys, time, select, fcntl, termios, struct, json
import pyte
from PIL import Image, ImageDraw, ImageFont

cols, rows, mode, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
work = sys.argv[5]
args = ['claude', '--model', 'haiku', '--allowedTools', 'Bash', 'Read']
import json as _j
_set = {}
if mode == 'classic': _set['tui'] = 'default'
# The session loads the installed pixel-office (read from the repo); OLD_DIR swaps it for that copy, so one office loads.
if os.environ.get('OLD_DIR'):
    _set['env'] = {'CLAUDE_CODE_PLUGIN_DIRS': os.environ['OLD_DIR']}
    _set['enabledPlugins'] = {'pixel-office@claude-code-mods': False}
if _set: args += ['--settings', _j.dumps(_set)]
screen = pyte.Screen(cols, rows)
stream = pyte.ByteStream(screen)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(work)
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLORTERM'] = 'truecolor'
    os.execvp(args[0], args)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
t0 = time.time()
def pump(secs):
    end = time.time() + secs
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: data = os.read(fd, 65536)
            except OSError: return
            if not data: return
            stream.feed(data)
def send(s):
    for ch in s:
        os.write(fd, ch.encode()); time.sleep(0.02)
def text(): return '\n'.join(screen.display)
NAMED = {'black': (0,0,0), 'red': (205,49,49), 'green': (13,188,121), 'brown': (229,229,16), 'yellow': (229,229,16), 'blue': (36,114,200), 'magenta': (188,63,188), 'cyan': (17,168,205), 'white': (229,229,229),
         'brightblack': (102,102,102), 'brightred': (241,76,76), 'brightgreen': (35,209,139), 'brightyellow': (245,245,67), 'brightblue': (59,142,234), 'brightmagenta': (214,112,214), 'brightcyan': (41,184,219), 'brightwhite': (255,255,255)}
def col(c, default):
    if c == 'default': return default
    if c in NAMED: return NAMED[c]
    try: return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))
    except Exception: return default
font = ImageFont.load_default()
def shot(name):
    W, H = 8, 16
    img = Image.new('RGB', (cols * W, rows * H), (30, 30, 30))
    d = ImageDraw.Draw(img)
    for y in range(rows):
        line = screen.buffer[y]
        for x in range(cols):
            c = line[x]
            fg = col(c.fg, (210, 210, 210)); bg = col(c.bg, (30, 30, 30))
            if c.reverse: fg, bg = bg, fg
            X, Y = x * W, y * H
            if c.data == '▀':
                d.rectangle([X, Y, X + W - 1, Y + H // 2 - 1], fill=fg); d.rectangle([X, Y + H // 2, X + W - 1, Y + H - 1], fill=bg)
            elif c.data == '▄':
                d.rectangle([X, Y, X + W - 1, Y + H // 2 - 1], fill=bg); d.rectangle([X, Y + H // 2, X + W - 1, Y + H - 1], fill=fg)
            else:
                d.rectangle([X, Y, X + W - 1, Y + H - 1], fill=bg)
                if c.data.strip(): d.text((X, Y + 2), c.data, fill=fg, font=font)
    img.save(f'{out}-{name}.png')
    open(f'{out}-{name}.txt', 'w').write(text())
# The first seconds: the trust prompt, and (OPENING=1) the office opening, shot 1, 3, 6 and 10 s after the picture shows.
opening = bool(os.environ.get('OPENING'))
start, seen, taken = time.time(), None, set()
while time.time() - start < 25:
    pump(0.25)
    if 'trust this folder' in text().lower():
        # (The arrow key in one write: sent a byte at a time, its ESC alone reads as "Esc to cancel" and exits. The prompt
        # takes keys a moment after it shows; Enter only once "Yes" is picked, or it exits.)
        pump(1.5); os.write(fd, b'\x1b[B'); pump(1)
        if any('❯ Yes' in row for row in screen.display): send('\r'); pump(1)
        continue
    if seen is None and any('▀' in row for row in screen.display): seen = time.time()
    if not opening and time.time() - start >= 10: break
    if opening and seen is not None:
        for s in (1, 3, 6, 10):
            if time.time() - seen >= s and s not in taken: taken.add(s); shot(f'0-open{s}s')
        if len(taken) == 4: break
send('/office'); pump(0.6); send('\r'); pump(4)
shot('1-idle')
send('Read the file notes.txt and, in the same reply and at the same time, run the bash command: sleep 8 && echo hi'); pump(0.5); send('\r')
for k, wait in enumerate([3, 3, 4, 5]):
    pump(wait); shot(f'2-busy{k}')
pump(14); shot('3-after')
send('\x03'); pump(1); send('\x03'); pump(2)
try: os.kill(pid, 9)
except Exception: pass
print('done', out)
