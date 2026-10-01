#!/usr/bin/env python3
"""Rainbow terminal menu with animations. Pure stdlib, no installs needed.

Add a tool: write a function and add it to MENU_ITEMS at the bottom.
"""
import math
import os
import random
import shutil
import sys
import time

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"

if os.name == "nt":
    os.system("")  # enables ANSI escape codes on Windows terminals


# ---------- color helpers ----------

def rgb(r, g, b):
    return f"\033[38;2;{r};{g};{b}m"


def rainbow_color(t):
    """Smooth rainbow color for any float t (period ~1.0)."""
    f = 2 * math.pi * t
    r = int(127 * math.sin(f) + 128)
    g = int(127 * math.sin(f + 2 * math.pi / 3) + 128)
    b = int(127 * math.sin(f + 4 * math.pi / 3) + 128)
    return rgb(r, g, b)


def rainbow(text, offset=0.0, spread=0.03):
    out = []
    for i, ch in enumerate(text):
        out.append(ch if ch == " " else rainbow_color(offset + i * spread) + ch)
    return "".join(out) + RESET


def clear():
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def width():
    return shutil.get_terminal_size((80, 24)).columns


def center(text, visible_len=None):
    n = visible_len if visible_len is not None else len(text)
    return " " * max(0, (width() - n) // 2) + text


# ---------- animations ----------

BANNER = [
    "  ██████╗██╗     ██╗   ██╗██████╗ ",
    " ██╔════╝██║     ██║   ██║██╔══██╗",
    " ██║     ██║     ██║   ██║██║  ██║",
    " ██║     ██║     ██║   ██║██║  ██║",
    " ╚██████╗███████╗╚██████╔╝██████╔╝",
    "  ╚═════╝╚══════╝ ╚═════╝ ╚═════╝ ",
]


def draw_banner(offset=0.0):
    for row, line in enumerate(BANNER):
        print(center(rainbow(line, offset + row * 0.05), len(line)))


def intro_animation(duration=1.6):
    """Banner wipes in left to right, then shimmers."""
    sys.stdout.write(HIDE_CURSOR)
    frames = 30
    longest = max(len(l) for l in BANNER)
    for f in range(frames + 1):
        clear()
        print("\n")
        cut = int(longest * f / frames)
        for row, line in enumerate(BANNER):
            part = line[:cut].ljust(len(line))
            print(center(rainbow(part, f * 0.04 + row * 0.05), len(line)))
        time.sleep(duration / frames)


def typewriter(text, delay=0.02, offset=0.0):
    for i, ch in enumerate(text):
        sys.stdout.write(rainbow_color(offset + i * 0.03) + ch + RESET)
        sys.stdout.flush()
        time.sleep(delay)
    print()


def spinner(label="Loading", seconds=1.5):
    frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    end = time.time() + seconds
    i = 0
    sys.stdout.write(HIDE_CURSOR)
    while time.time() < end:
        sys.stdout.write("\r  " + rainbow(f"{frames[i % len(frames)]} {label}...", i * 0.05))
        sys.stdout.flush()
        time.sleep(0.07)
        i += 1
    sys.stdout.write("\r" + " " * (len(label) + 10) + "\r")
    sys.stdout.write(SHOW_CURSOR)


def progress_bar(label="Working", seconds=2.0, size=30):
    steps = 60
    for s in range(steps + 1):
        filled = int(size * s / steps)
        bar = rainbow("█" * filled, s * 0.02) + DIM + "░" * (size - filled) + RESET
        sys.stdout.write(f"\r  {label} [{bar}] {int(100 * s / steps):3d}%")
        sys.stdout.flush()
        time.sleep(seconds / steps)
    print()


def matrix_rain(seconds=2.0):
    cols, rows = width(), shutil.get_terminal_size((80, 24)).lines - 1
    drops = [random.randint(-rows, 0) for _ in range(cols)]
    chars = "01アイウエオカキクケコｱｲｳｴｵ#$%&*"
    sys.stdout.write(HIDE_CURSOR)
    clear()
    end, t = time.time() + seconds, 0
    while time.time() < end:
        buf = []
        for x in range(0, cols, 2):
            y = drops[x]
            if 0 <= y < rows:
                buf.append(f"\033[{y + 1};{x + 1}H{rainbow_color(t + x * 0.01)}{random.choice(chars)}")
            if 0 <= y - 8 < rows:
                buf.append(f"\033[{y - 7};{x + 1}H ")
            drops[x] = y + 1 if y < rows + 8 else random.randint(-rows, 0)
        sys.stdout.write("".join(buf) + RESET)
        sys.stdout.flush()
        t += 0.02
        time.sleep(0.04)
    sys.stdout.write(SHOW_CURSOR)


def outro():
    clear()
    print("\n")
    for i in range(20):
        sys.stdout.write("\r" + center(rainbow("Goodbye! ✦", i * 0.08), 10))
        sys.stdout.flush()
        time.sleep(0.05)
    print("\n" + SHOW_CURSOR)


# ---------- placeholder tools (replace these with real stuff) ----------

def placeholder(name):
    def run():
        print()
        typewriter(f"  >> {name}")
        spinner(f"Starting {name}")
        print(f"  {DIM}This is a placeholder. Put your code in menu.py.{RESET}")
    return run


def demo_animations():
    print()
    typewriter("  Typewriter effect in rainbow!")
    spinner("Spinner demo", 1.2)
    progress_bar("Progress", 1.5)
    matrix_rain(2.0)
    clear()


# Add your tools here: (label, function)
MENU_ITEMS = [
    ("Tool One",        placeholder("Tool One")),
    ("Tool Two",        placeholder("Tool Two")),
    ("Tool Three",      placeholder("Tool Three")),
    ("Tool Four",       placeholder("Tool Four")),
    ("Animation Demo",  demo_animations),
]


# ---------- menu ----------

def draw_menu(offset=0.0):
    clear()
    print()
    draw_banner(offset)
    print()
    print(center(rainbow("─" * 40, offset), 40))
    for i, (label, _) in enumerate(MENU_ITEMS, 1):
        line = f"[{i}]  {label}"
        print(center(rainbow(line.ljust(28), offset + i * 0.08), 28))
    print(center(rainbow("[0]  Exit".ljust(28), offset + 0.6), 28))
    print(center(rainbow("─" * 40, offset + 0.3), 40))
    print()


def main():
    try:
        intro_animation()
        offset = 0.0
        while True:
            draw_menu(offset)
            sys.stdout.write(SHOW_CURSOR)
            choice = input("  " + rainbow("Select ➜ ", offset) + " ").strip()
            offset += 0.15  # colors shift each time the menu redraws
            if choice in ("0", "q", "exit"):
                break
            if choice.isdigit() and 1 <= int(choice) <= len(MENU_ITEMS):
                MENU_ITEMS[int(choice) - 1][1]()
                input(f"\n  {DIM}Press Enter to return...{RESET}")
            else:
                spinner("Invalid option", 0.6)
        outro()
    except (KeyboardInterrupt, EOFError):
        outro()


if __name__ == "__main__":
    main()
