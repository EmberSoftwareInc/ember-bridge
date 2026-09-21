# Getting started

Ember Bridge is a small desktop app that lets the **Ember** design editor —
running in your web browser — send embroidery designs to your WiFi-connected
embroidery machine. It runs quietly in the background and does one job: pass
your designs from the browser to the machine on your local network.

You only need it running while you're sending designs, but it's happiest left
running in the menu bar so it's always ready.

## Installing

1. Download the latest release for your system from the Ember Bridge releases
   page (a `.dmg` for macOS, `.exe`/`.msi` for Windows, or `.AppImage`/`.deb`/
   `.rpm` for Linux).
2. On macOS, open the `.dmg` and drag **Ember Bridge** into your Applications
   folder, then launch it from there.

The macOS build is signed and notarized by Apple, so it opens normally without
security warnings.

## First launch on macOS: allow local network access

The first time you open Ember Bridge, macOS asks whether it may find devices on
your local network. **Click Allow.** Ember Bridge talks to your machine over
your home network, so without this permission it simply can't reach it.

> If you missed the prompt, turn it on later under
> **System Settings → Privacy & Security → Local Network** and switch on
> **Ember Bridge**. Symptoms of it being off: your machine looks reachable
> (you can even ping it) but Ember Bridge reports "machine unreachable".

## It lives in the menu bar, not the Dock

Ember Bridge is a background app. On macOS it runs in the **menu bar** (top-right
of your screen) with no Dock icon — look for the **"E"** glyph up there.

- **Left-click** the glyph to open the Ember Bridge window.
- **Right-click** the glyph for the menu: **Show Ember Bridge**, **Launch at
  login**, and **Quit Ember Bridge**.

## Closing vs. quitting

Closing the window (the red button, or Cmd+W) **hides** it back to the menu bar —
it does not quit. The bridge keeps running so in-progress uploads finish and
Ember can still reach your machines.

To fully stop it, choose **Quit Ember Bridge** from the menu-bar menu (or press
Cmd+Q while the window is focused).

## Start automatically at login

Right-click the menu-bar glyph and tick **Launch at login**. Ember Bridge will
start with your computer and sit quietly in the menu bar, ready to go. Untick it
any time to turn this off.

## The window at a glance

The left sidebar holds the main pages:

- **Machines** — find, add, test, and manage your embroidery machines.
- **Send** — pick a machine and send a design to it.
- **Logs** — a running record of what the bridge is doing.
- **Settings** — browser connection help, app updates, and advanced options.
- **Help** — this manual.

The **Set up Ember Link** page guides local USB setup. Connect a dongle over USB
when instructed. For cloud account setup without Bridge, use
[connect.emberdesign.net](https://connect.emberdesign.net).

The sidebar shows **Ready for Ember** when the local service is running, plus
the currently selected target. Connection details are in Settings.
