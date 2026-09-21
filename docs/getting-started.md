# Getting started

Ember Bridge sends design files from your computer to supported Brother Wi-Fi
machines and Ember Link dongles over your local network. You can use it on its
own without an Ember account or the Ember web app.

You can also send from the Ember web editor through Bridge. Supported Brother
Wi-Fi machines connect directly and need no dongle. Cloud service is managed
exclusively in the Ember web app.

## Your first local transfer

1. Put your computer and machine on the same Wi-Fi network. If you use a new
   Ember Link, open **Set up Ember Link** and configure it over USB first.
2. On **Machines**, click **Scan network**, save the device, and select it.
3. Open **Send**, choose a design from your computer, and click **Send to machine**.
   You can also browse files there and delete them on devices that support it.

Keep Bridge running while sending. It can stay in the menu bar between transfers.

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
when instructed. This configures local Wi-Fi and pairing with this computer.

The sidebar shows **Local bridge ready** when the local service is running, plus
the currently selected target. Connection details are in Settings.
