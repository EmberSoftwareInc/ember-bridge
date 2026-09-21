# Adding machines

The **Machines** page is where you find and manage your embroidery machines.
Ember Bridge works with two kinds:

- **Brother** WiFi-capable embroidery machines.
- Any machine using an **Ember Link** dongle (see
  [Setting up a dongle](dongle-setup.md)).

## Find machines on your network

Click **Scan network** (it reads **Scanning network…** while it works, about
five seconds). Anything found that you haven't saved yet appears under
**Discovered on the network** — click **Save** to keep it.

## Add a machine by IP address

If you know the machine's address, use **Add machine manually**:

1. Type the **IP address**, for example `192.168.1.120`.
2. Optionally add a **Nickname** like "Sewing room".
3. Click **Add**.

The address must be a private/local network address (your home network) — Ember
Bridge won't contact addresses out on the public internet.

## Select, test, and remove

- **Select** — click a saved machine's row to make it the target for sending.
  It gets a green **selected** pill, and the sidebar footer shows it as the
  **Target**.
- **Test** — checks the connection and shows a **Connection test** panel with
  the machine's details: **Machine** (name and model), **Firmware**, **Serial**,
  **Embroidery area**, **Max design size**, and **Formats**. Click **Dismiss**
  to hide it.
- **Remove** — deletes the saved machine from Ember Bridge (it doesn't change
  anything on the machine itself).

## Brother vs. Ember Link

Both kinds appear side by side and work the same way when sending; they differ
in what they report and which file formats they accept:

| | Brother | Ember Link dongle |
|---|---|---|
| Shown as | machine name + model | "Ember Link dongle" |
| Reports memory & area | Yes | Not always |
| Accepted formats | pes, phc, dst, phx | pes, pec, dst, exp, jef, vp3, hus, vip, xxx |

## A note on changing addresses

Machines get their IP address from your router, and it can change (for example
after a reboot). If a saved machine stops responding, run **Scan network**
again, or remove it and re-add it at its new address.

## When a device’s address changes

Bridge remembers the device’s manufacturer and serial when you save a discovered
device, or first successfully connect to a manually added device. A later scan
updates its address while keeping its nickname. Before uploading, Bridge checks
that identity again and rediscovers a moved device. A different serial at the old
address is refused. Devices that do not report a serial can only be tracked by
address; confirm the intended machine when adding one manually.
